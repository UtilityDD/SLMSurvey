/**
 * Local schedule books (CSV/Excel) + kit→contract bridge packs.
 * Stored in browser localStorage — user's own Mat/Lab / contract format.
 */
(function (global) {
  "use strict";

  const BOOKS_KEY = "slm_schedule_books_v1";
  const BRIDGES_KEY = "slm_bridge_packs_v1";
  const PREFS_KEY = "slm_contract_lens_prefs_v1";

  function uid() {
    return "sb_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch {
      return fallback;
    }
  }

  function saveJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function listBooks() {
    const books = loadJson(BOOKS_KEY, []);
    return Array.isArray(books) ? books : [];
  }

  function saveBooks(books) {
    saveJson(BOOKS_KEY, books);
  }

  function getBook(id) {
    return listBooks().find((b) => b.id === id) || null;
  }

  function upsertBook(book) {
    const books = listBooks();
    const i = books.findIndex((b) => b.id === book.id);
    if (i >= 0) books[i] = book;
    else books.push(book);
    saveBooks(books);
    return book;
  }

  function deleteBook(id) {
    saveBooks(listBooks().filter((b) => b.id !== id));
    const bridges = listBridges().filter((b) => b.scheduleBookId !== id);
    saveBridges(bridges);
    const prefs = loadPrefs();
    if (prefs.contractBookId === id) prefs.contractBookId = "";
    if (prefs.actualBookId === id) prefs.actualBookId = "";
    savePrefs(prefs);
  }

  function listBridges() {
    const rows = loadJson(BRIDGES_KEY, []);
    return Array.isArray(rows) ? rows : [];
  }

  function saveBridges(rows) {
    saveJson(BRIDGES_KEY, rows);
  }

  function getBridge(id) {
    return listBridges().find((b) => b.id === id) || null;
  }

  function upsertBridge(bridge) {
    const rows = listBridges();
    const i = rows.findIndex((b) => b.id === bridge.id);
    if (i >= 0) rows[i] = bridge;
    else rows.push(bridge);
    saveBridges(rows);
    return bridge;
  }

  function deleteBridge(id) {
    saveBridges(listBridges().filter((b) => b.id !== id));
    const prefs = loadPrefs();
    if (prefs.bridgeId === id) prefs.bridgeId = "";
    savePrefs(prefs);
  }

  function loadPrefs() {
    return Object.assign(
      {
        mode: "actual", // actual | contract
        actualBookId: "",
        contractBookId: "",
        bridgeId: "",
      },
      loadJson(PREFS_KEY, {})
    );
  }

  function savePrefs(prefs) {
    saveJson(PREFS_KEY, prefs);
  }

  /** Split CSV line respecting quotes. */
  function splitCsvLine(line) {
    const out = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            cur += '"';
            i++;
          } else inQ = false;
        } else cur += ch;
      } else if (ch === '"') {
        inQ = true;
      } else if (ch === "," || ch === "\t" || ch === ";") {
        out.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  }

  function parseCsvText(text) {
    const raw = String(text || "").replace(/^\uFEFF/, "");
    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length);
    if (!lines.length) return { headers: [], rows: [] };
    const headers = splitCsvLine(lines[0]).map((h) => h.trim());
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = splitCsvLine(lines[i]);
      if (!cells.some((c) => c)) continue;
      const obj = {};
      headers.forEach((h, j) => {
        obj[h] = cells[j] != null ? cells[j] : "";
      });
      rows.push(obj);
    }
    return { headers, rows };
  }

  function sheetToMatrix(sheet) {
    if (typeof XLSX === "undefined") {
      throw new Error("Excel support needs SheetJS (xlsx) loaded");
    }
    return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
  }

  function matrixToTable(matrix) {
    if (!matrix?.length) return { headers: [], rows: [] };
    const headers = (matrix[0] || []).map((h, i) =>
      String(h || "").trim() || `Column ${i + 1}`
    );
    const rows = [];
    for (let i = 1; i < matrix.length; i++) {
      const cells = matrix[i] || [];
      if (!cells.some((c) => String(c || "").trim())) continue;
      const obj = {};
      headers.forEach((h, j) => {
        obj[h] = cells[j] != null ? String(cells[j]).trim() : "";
      });
      rows.push(obj);
    }
    return { headers, rows };
  }

  async function parseSpreadsheetFile(file) {
    const name = (file && file.name) || "import";
    const lower = name.toLowerCase();
    if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
      const text = await file.text();
      return { ...parseCsvText(text), sourceFile: name };
    }
    if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
      if (typeof XLSX === "undefined") {
        throw new Error("Excel library not loaded — use CSV, or check network for SheetJS");
      }
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const matrix = sheetToMatrix(sheet);
      return { ...matrixToTable(matrix), sourceFile: name };
    }
    throw new Error("Use .csv, .xlsx, or .xls");
  }

  const FIELD_ALIASES = {
    code: ["code", "item code", "item_code", "sor", "sor code", "sch code", "schedule code", "sl no", "item no", "itemno"],
    description: ["description", "desc", "item", "particulars", "particular", "name", "item description", "description of item"],
    unit: ["unit", "uom", "unit of measurement", "units"],
    rate: ["rate", "rate (rs)", "rate rs", "rate (₹)", "unit rate", "rs", "amount rate", "rate_rs"],
    type: ["type", "kind", "mat/lab", "mat lab", "category", "schedule", "m/l"],
  };

  function normHeader(h) {
    return String(h || "")
      .toLowerCase()
      .replace(/[₹]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function guessColumnMap(headers) {
    const map = { code: "", description: "", unit: "", rate: "", type: "" };
    const norms = headers.map((h) => ({ raw: h, n: normHeader(h) }));
    for (const field of Object.keys(FIELD_ALIASES)) {
      const aliases = FIELD_ALIASES[field];
      const hit = norms.find((x) => aliases.includes(x.n));
      if (hit) map[field] = hit.raw;
    }
    // Fallbacks by position if code/desc missing
    if (!map.code && headers[0]) map.code = headers[0];
    if (!map.description && headers[1]) map.description = headers[1];
    if (!map.unit && headers[2]) map.unit = headers[2];
    if (!map.rate && headers[3]) map.rate = headers[3];
    return map;
  }

  function detectType(raw, code) {
    const s = String(raw || "").toLowerCase().trim();
    if (/^lab/.test(s) || s === "l" || s === "labour" || s === "labor") return "labour";
    if (/^mat/.test(s) || s === "m" || s === "material" || s === "materials") return "material";
    if (/^l[\d\-_/]/i.test(String(code || ""))) return "labour";
    return "material";
  }

  function applyColumnMap(table, columnMap, opts) {
    const cm = columnMap || {};
    const items = [];
    const seen = new Set();
    for (const row of table.rows || []) {
      const code = String(row[cm.code] || "").trim();
      if (!code) continue;
      const key = code.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const description = String(row[cm.description] || code).trim();
      const unit = String(row[cm.unit] || "NOS").trim() || "NOS";
      const rateRaw = String(row[cm.rate] || "0").replace(/,/g, "");
      const rate = Number(rateRaw) || 0;
      const type = detectType(cm.type ? row[cm.type] : "", code);
      items.push({ code, description, unit, rate, type });
    }
    if (!items.length) throw new Error("No rows with a Code column — check column mapping");
    const book = {
      id: (opts && opts.id) || uid(),
      name: (opts && opts.name) || table.sourceFile || "Schedule",
      kind: (opts && opts.kind) || "contract", // contract | actual
      sourceFile: table.sourceFile || "",
      updatedAt: new Date().toISOString(),
      itemCount: items.length,
      items,
    };
    return book;
  }

  function bookAsRatebook(book) {
    if (!book) return { materials: [], labour: [] };
    const materials = [];
    const labour = [];
    for (const it of book.items || []) {
      const row = {
        code: it.code,
        description: it.description,
        unit: it.unit,
        rate: Number(it.rate) || 0,
        type: it.type,
        origin: "local-schedule",
      };
      if (it.type === "labour") labour.push(row);
      else materials.push(row);
    }
    return { materials, labour };
  }

  function mergeRatebooks(base, overlay) {
    if (!overlay) return base;
    const idx = {};
    const materials = [...(base?.materials || [])];
    const labour = [...(base?.labour || [])];
    materials.forEach((m) => {
      idx[m.code] = m;
    });
    labour.forEach((l) => {
      idx[l.code] = l;
    });
    for (const m of overlay.materials || []) {
      if (idx[m.code]) Object.assign(idx[m.code], m);
      else {
        materials.push(m);
        idx[m.code] = m;
      }
    }
    for (const l of overlay.labour || []) {
      if (idx[l.code]) Object.assign(idx[l.code], l);
      else {
        labour.push(l);
        idx[l.code] = l;
      }
    }
    return { materials, labour };
  }

  function csvTemplate() {
    return [
      "Code,Description,Unit,Rate,Type",
      "M-HT-DE-01,HT Dead-end structure complete,NOS,12500,material",
      "M-LT-ABC-KM,LT ABC conductor stringing,KM,85000,material",
      "L-HT-ERECT,Erection of HT structure,NOS,2200,labour",
      "L-LT-STRING,Stringing labour LT,KM,15000,labour",
    ].join("\n");
  }

  function downloadTemplate() {
    const blob = new Blob([csvTemplate()], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "slm_schedule_template.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function emptyBridge(name, scheduleBookId) {
    return {
      id: uid(),
      name: name || "Bridge pack",
      scheduleBookId: scheduleBookId || "",
      mappings: {}, // kitId -> [{ code, type, qtyPerUnit }]
      contents: {}, // contractCode -> [{ code, type, qty }] actual mats inside turnkey item
      updatedAt: new Date().toISOString(),
    };
  }

  function setMappingLines(bridge, kitId, lines) {
    const next = { ...bridge, mappings: { ...(bridge.mappings || {}) } };
    const cleaned = (lines || [])
      .map((l) => ({
        code: String(l.code || "").trim(),
        type: l.type === "labour" ? "labour" : "material",
        qtyPerUnit: Number(l.qtyPerUnit) > 0 ? Number(l.qtyPerUnit) : 1,
      }))
      .filter((l) => l.code);
    if (cleaned.length) next.mappings[kitId] = cleaned;
    else delete next.mappings[kitId];
    next.updatedAt = new Date().toISOString();
    return next;
  }

  /**
   * Attach kit → contract code (additive). One kit may map to many schedule rows;
   * one schedule row may receive many kits. Existing other lines are kept.
   */
  function linkKitToContract(bridge, kitId, contractCode, opts) {
    const o = opts || {};
    const code = String(contractCode || "").trim();
    if (!kitId || !code) return bridge;
    const prev = (bridge.mappings && bridge.mappings[kitId]) || [];
    const qty =
      Number(o.qtyPerUnit) > 0
        ? Number(o.qtyPerUnit)
        : Number(prev.find((l) => l.code === code)?.qtyPerUnit) > 0
          ? Number(prev.find((l) => l.code === code).qtyPerUnit)
          : 1;
    const line = {
      code,
      type: o.type === "labour" ? "labour" : "material",
      qtyPerUnit: qty,
    };
    const rest = prev.filter((l) => l.code !== code);
    return setMappingLines(bridge, kitId, [...rest, line]);
  }

  function unlinkKitFromContract(bridge, kitId, contractCode) {
    const prev = (bridge.mappings && bridge.mappings[kitId]) || [];
    const next = prev.filter((l) => l.code !== contractCode);
    return setMappingLines(bridge, kitId, next);
  }

  /** Actual materials covered by one turnkey schedule row (one → many). */
  function setContents(bridge, contractCode, items) {
    const next = {
      ...bridge,
      contents: { ...(bridge.contents || {}) },
    };
    const code = String(contractCode || "").trim();
    if (!code) return next;
    const cleaned = (items || [])
      .map((l) => ({
        code: String(l.code || "").trim(),
        type: l.type === "labour" ? "labour" : "material",
        qty: Number(l.qty) > 0 ? Number(l.qty) : 1,
      }))
      .filter((l) => l.code);
    if (cleaned.length) next.contents[code] = cleaned;
    else delete next.contents[code];
    next.updatedAt = new Date().toISOString();
    return next;
  }

  function addContentItem(bridge, contractCode, item) {
    const code = String(contractCode || "").trim();
    if (!code || !item?.code) return bridge;
    const prev = (bridge.contents && bridge.contents[code]) || [];
    if (prev.some((p) => p.code === item.code)) return bridge;
    return setContents(bridge, code, [
      ...prev,
      {
        code: item.code,
        type: item.type === "labour" ? "labour" : "material",
        qty: Number(item.qty) > 0 ? Number(item.qty) : 1,
      },
    ]);
  }

  function removeContentItem(bridge, contractCode, matCode) {
    const prev = (bridge.contents && bridge.contents[contractCode]) || [];
    return setContents(
      bridge,
      contractCode,
      prev.filter((p) => p.code !== matCode)
    );
  }

  /** Reverse index: contract code -> kit ids linked for BOQ. */
  function kitsByContractCode(bridge) {
    const out = {};
    const mappings = (bridge && bridge.mappings) || {};
    for (const [kitId, lines] of Object.entries(mappings)) {
      for (const line of lines || []) {
        if (!line.code) continue;
        if (!out[line.code]) out[line.code] = [];
        if (!out[line.code].includes(kitId)) out[line.code].push(kitId);
      }
    }
    return out;
  }

  function locToken(kit) {
    const loc = String(kit.location || kit.kitLocation || "").toLowerCase();
    if (loc.includes("dead")) return "DE";
    if (loc.includes("t-off") || loc.includes("toff") || loc.includes("t off")) return "TOF";
    if (loc.includes("ang")) return "ANG";
    return "TAN";
  }

  function structToken(kit) {
    const s = String(kit.structure || "").toUpperCase();
    if (s.includes("DTR") || /DTR/i.test(kit.id || "") || /DTR/i.test(kit.code || "")) {
      return "DTR";
    }
    if (s === "1P" || s === "2P" || s === "3P" || s === "4P") return s;
    if (/D2|DTR2/i.test(s) || /D2|DTR2/i.test(kit.code || "")) return "DTR";
    if (/D4|DTR4/i.test(s) || /D4|DTR4/i.test(kit.code || "")) return "DTR";
    return "1P";
  }

  function voltToken(kit) {
    const v = String(kit.voltage || "").toUpperCase();
    if (v.includes("33")) return "33";
    if (v.includes("11")) return "11";
    if (v === "LT" || v.includes("LT")) return "LT";
    const id = String(kit.id || kit.code || "").toUpperCase();
    if (id.includes("33KV") || id.includes("|33")) return "33";
    if (id.includes("11KV") || id.includes("|11")) return "11";
    if (id.includes("|LT|") || id.startsWith("LT-") || id.includes("CON|LT")) return "LT";
    return "LT";
  }

  /**
   * Suggest simplified turnkey contract lines for a field kit (demo / starter mapping).
   * Returns [{ code, type, qtyPerUnit }] using Demo Turnkey Contract codes.
   */
  function suggestDemoMapping(kit) {
    if (!kit) return [];
    if (kit.family === "conductor") {
      const v = voltToken(kit);
      const id = String(kit.id || kit.code || "").toUpperCase();
      let mat = "CTR-COND-LT-ACSR";
      if (v === "33") mat = "CTR-COND-33";
      else if (v === "11") mat = "CTR-COND-11";
      else if (id.includes("|ABC|") || /\bABC\b/.test(id)) mat = "CTR-COND-LT-ABC";
      else if (id.includes("|PVC|") || /\bPVC\b/.test(id)) mat = "CTR-COND-LT-PVC";
      const lab =
        v === "33" ? "CTR-L-STRING-33" : v === "11" ? "CTR-L-STRING-11" : "CTR-L-STRING-LT";
      return [
        { code: mat, type: "material", qtyPerUnit: 1 },
        { code: lab, type: "labour", qtyPerUnit: 1 },
      ];
    }
    const v = voltToken(kit);
    const st = structToken(kit);
    const loc = locToken(kit);
    if (st === "DTR" || v === "11" && /DTR/i.test(kit.code || kit.id || "")) {
      return [
        { code: "CTR-11-DTR", type: "material", qtyPerUnit: 1 },
        { code: "CTR-L-11-DTR", type: "labour", qtyPerUnit: 1 },
      ];
    }
    let matStruct = st;
    if (v === "LT") matStruct = "1P";
    if (v === "33" && loc === "TOF" && st !== "4P" && st !== "1P") matStruct = "4P";
    if (v === "11" && loc === "DE") matStruct = "2P";
    if (v === "11" && loc === "TOF") matStruct = "1P";
    const matCode = `CTR-${v}-${loc}-${matStruct}`;
    const labCode = `CTR-L-${v}-ERECT`;
    return [
      { code: matCode, type: "material", qtyPerUnit: 1 },
      { code: labCode, type: "labour", qtyPerUnit: 1 },
    ];
  }

  /**
   * Install bundled demo contract book + bridge, mapping kits that appear in hits
   * (or all provided kits). Returns { book, bridge, mappedCount }.
   */
  function installDemoContract(payload, kitsToMap) {
    const data = payload || {};
    const book = {
      id: data.id || "demo_contract_v1",
      name: data.name || "Demo Turnkey Contract (sample)",
      kind: "contract",
      sourceFile: data.sourceFile || "demo_contract_schedule.json",
      updatedAt: new Date().toISOString(),
      itemCount: (data.items || []).length,
      items: data.items || [],
    };
    upsertBook(book);

    let bridge = getBridge("demo_bridge_v1");
    if (!bridge) {
      bridge = {
        id: "demo_bridge_v1",
        name: "Demo bridge · field kits → turnkey SoR",
        scheduleBookId: book.id,
        mappings: {},
        contents: {},
        updatedAt: new Date().toISOString(),
      };
    } else {
      bridge = {
        ...bridge,
        scheduleBookId: book.id,
        name: bridge.name || "Demo bridge · field kits → turnkey SoR",
        contents: bridge.contents || {},
      };
    }

    const codes = new Set((book.items || []).map((i) => i.code));
    let mappedCount = 0;
    for (const kit of kitsToMap || []) {
      if (!kit?.id) continue;
      const lines = suggestDemoMapping(kit).filter((l) => codes.has(l.code));
      if (!lines.length) continue;
      bridge = setMappingLines(bridge, kit.id, lines);
      mappedCount += 1;
    }
    upsertBridge(bridge);

    const prefs = loadPrefs();
    prefs.mode = "contract";
    prefs.contractBookId = book.id;
    prefs.bridgeId = bridge.id;
    savePrefs(prefs);

    return { book, bridge, mappedCount };
  }

  global.SlmScheduleBooks = {
    listBooks,
    getBook,
    upsertBook,
    deleteBook,
    listBridges,
    getBridge,
    upsertBridge,
    deleteBridge,
    loadPrefs,
    savePrefs,
    parseSpreadsheetFile,
    guessColumnMap,
    applyColumnMap,
    bookAsRatebook,
    mergeRatebooks,
    downloadTemplate,
    csvTemplate,
    emptyBridge,
    setMappingLines,
    linkKitToContract,
    unlinkKitFromContract,
    setContents,
    addContentItem,
    removeContentItem,
    kitsByContractCode,
    suggestDemoMapping,
    installDemoContract,
    uid,
  };
})(typeof window !== "undefined" ? window : globalThis);
