/**
 * Desktop auto-estimate matcher (Draft or Final kits × survey workspace).
 * Prefers Final when both exist; Draft is allowed for BOQ / field check.
 */
(function (global) {
  "use strict";

  function isAbc(tag) {
    return String(tag || "").toUpperCase() === "ABC";
  }
  function isPvc(tag) {
    return String(tag || "").toUpperCase() === "PVC";
  }
  function isCable(tag) {
    return isAbc(tag) || isPvc(tag);
  }

  function sizedConductorIds(voltage, tag) {
    const t = String(tag || "").trim();
    if (!t || isCable(t)) return [];
    if (voltage === "33kV") {
      if (t === "100") return ["ACSR|Dog|100"];
      if (t === "150") return ["ACSR|Wolf|150"];
      if (t === "200") return ["ACSR|Panther|200"];
    }
    if (voltage === "11kV") {
      if (t === "30") return ["ACSR|Weasel|30"];
      if (t === "50") return ["ACSR|Rabbit|50"];
      if (t === "100") return ["ACSR|Dog|100"];
    }
    if (voltage === "LT") {
      if (t === "20") return ["ACSR|Squirrel|20"];
      if (t === "30") return ["ACSR|Weasel|30"];
      if (t === "50") return ["ACSR|Rabbit|50"];
    }
    return [];
  }

  function agnosticConductorIds(voltage, tag) {
    if (!tag) return [];
    if (voltage === "LT") {
      if (isPvc(tag)) return ["LT|ANY|PVC"];
      return isAbc(tag) ? ["LT|ANY|ABC"] : ["LT|ANY|ACSR"];
    }
    if (voltage === "11kV") {
      if (isPvc(tag)) return [];
      return isAbc(tag) ? ["11kV|ANY|ABC", "ABC|HT|3x95"] : ["11kV|ANY|ACSR"];
    }
    return [];
  }

  function conductorFamily(tag) {
    if (!tag) return null;
    if (isPvc(tag)) return "PVC";
    return isAbc(tag) ? "ABC" : "ACSR";
  }

  function arrangementId(label) {
    if (!label) return null;
    const s = String(label);
    if (/in[\s-]*line/i.test(s) || s === "InlineArr") return "InlineArr";
    if (/sectional/i.test(s)) return "Sectional";
    return s;
  }

  function extensionId(label) {
    if (!label) return null;
    const s = String(label);
    if (/with\s*ext/i.test(s) || s === "WithExt") return "WithExt";
    if (/no\s*ext/i.test(s) || s === "NoExt") return "NoExt";
    return s;
  }

  function deriveKitWire(asset) {
    if (asset.kitWire) return asset.kitWire;
    if (isCable(asset.conductor)) return null;
    if (asset.voltage === "LT") {
      if (asset.structure === "2P") return "3W";
      if (asset.structure === "3P") return "4W";
      return "2W";
    }
    return "3W";
  }

  function isEstimateReady(asset) {
    if (String(asset.status || "") !== "Proposed") return true;
    if (!asset.structure || !asset.conductor) return false;
    if (!asset.kitLocation || !asset.kitExtension) return false;
    if (asset.kitLocation !== "Dead-end" && !arrangementId(asset.kitArrangement)) return false;
    if (asset.structure === "DTR") {
      if (!asset.dtrMount || !asset.dtCapacityKva) return false;
    }
    return true;
  }

  function structureKey(asset) {
    if (asset.structure === "DTR") {
      const m = asset.dtrMount;
      if (!m) return null;
      return m.startsWith("DTR") ? m : `DTR${m}`;
    }
    if (asset.voltage === "LT") return "1P";
    return asset.structure || null;
  }

  function normalizeKva(raw) {
    if (raw == null || raw === "") return null;
    const digits = String(raw).replace(/\D/g, "");
    return digits || null;
  }

  function kitTitle(kit) {
    if (kit.family === "conductor") {
      const wire = kit.wireLabel ? ` · ${kit.wireLabel}` : "";
      return `${kit.voltage} · ${kit.conductorShort || kit.conductorName || kit.conductorId}${wire}`;
    }
    const loc = kit.location ? ` · ${kit.location}` : "";
    const arr = kit.arrangementLabel ? ` · ${kit.arrangementLabel}` : "";
    let cond = "";
    if (kit.conductorSizeAgnostic) {
      cond = ` · ${kit.conductorFamily || "ANY"}${kit.wireLabel ? ` · ${kit.wireLabel}` : ""}`;
    } else if (kit.conductorShort) {
      cond = ` · ${kit.conductorShort}`;
    }
    const ext = kit.extensionLabel ? ` · ${kit.extensionLabel}` : "";
    const dtr = kit.dtrCapacity ? ` · ${kit.dtrCapacity}` : "";
    return `${kit.voltage} · ${kit.structureLabel || kit.structure}${loc}${arr}${cond}${ext}${dtr}`;
  }

  function wireMatchesStructure(kit, asset) {
    const want = deriveKitWire(asset);
    if (isCable(asset.conductor)) {
      return (
        !kit.wireCount ||
        String(kit.wireLabel || "").toLowerCase() === "cable" ||
        kit.conductorFamily === "ABC" ||
        kit.conductorFamily === "PVC"
      );
    }
    if (!want) return !kit.wireCount;
    return kit.wireCount === want;
  }

  function conductorMatchesStructure(kit, asset) {
    if (kit.conductorSizeAgnostic) {
      const fam = conductorFamily(asset.conductor);
      if (!fam) return false;
      return (
        kit.conductorFamily === fam ||
        (kit.conductorId && kit.conductorId.includes(`|${fam}`)) ||
        agnosticConductorIds(asset.voltage, asset.conductor).includes(kit.conductorId)
      );
    }
    const sized = sizedConductorIds(asset.voltage, asset.conductor);
    const agn = agnosticConductorIds(asset.voltage, asset.conductor);
    return sized.includes(kit.conductorId) || agn.includes(kit.conductorId);
  }

  function findStructureKit(asset, kits, finalOnly) {
    const voltage = asset.voltage;
    const sKey = structureKey(asset);
    if (!sKey) return null;
    const location = asset.kitLocation;
    const ext = extensionId(asset.kitExtension);
    const arrWant =
      location === "Dead-end" ? null : arrangementId(asset.kitArrangement);
    const candidates = kits.filter((kit) => {
      if (kit.voltage !== voltage) return false;
      if (finalOnly && !kit.complete) return false;
      if (!kit.enabled) return false;
      const structOk =
        kit.structure === sKey ||
        (asset.structure === "DTR" &&
          kit.isDtr &&
          kit.dtrMount === String(asset.dtrMount || "").replace(/^DTR/, ""));
      if (!structOk) return false;
      if (kit.location !== location) return false;
      if (String(kit.extension || "") !== String(ext || "")) return false;
      if (location === "Dead-end") {
        if (kit.arrangement) return false;
      } else if (kit.arrangement !== arrWant) {
        return false;
      }
      if (!wireMatchesStructure(kit, asset)) return false;
      if (!conductorMatchesStructure(kit, asset)) return false;
      if (asset.structure === "DTR" && kit.isDtr && kit.dtrCapacity) {
        if (normalizeKva(kit.dtrCapacity) !== normalizeKva(asset.dtCapacityKva)) {
          return false;
        }
      }
      return true;
    });
    return candidates.find((k) => k.complete) || candidates[0] || null;
  }

  function findConductorKit(sample, kits, finalOnly) {
    const voltage = sample.voltage;
    const tag = sample.conductor;
    if (isCable(tag)) {
      const wantFam = conductorFamily(tag); // ABC or PVC
      const familyKits = kits.filter(
        (k) =>
          k.voltage === voltage &&
          k.enabled !== false &&
          (!finalOnly || k.complete) &&
          (k.conductorFamily === wantFam ||
            (wantFam && k.conductorId && String(k.conductorId).includes(wantFam)))
      );
      const finals = familyKits.filter((k) => k.complete);
      // Prefer Final; Draft allowed when finalOnly is false
      if (finals.length >= 1) return finals[0];
      if (finalOnly) return null;
      return familyKits[0] || null;
    }
    const sized = sizedConductorIds(voltage, tag);
    if (!sized.length) return null;
    const wire = deriveKitWire(sample);
    const candidates = kits.filter((kit) => {
      if (kit.voltage !== voltage || kit.enabled === false) return false;
      if (finalOnly && !kit.complete) return false;
      if (!sized.includes(kit.conductorId)) return false;
      if (!wire) {
        return !kit.wireCount || String(kit.wireLabel || "").toLowerCase() === "cable";
      }
      return kit.wireCount === wire;
    });
    return candidates.find((k) => k.complete) || candidates[0] || null;
  }

  function money(n) {
    if (n == null || Number.isNaN(n)) return "—";
    return (
      "₹" +
      Number(n).toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  }

  function moneyPlain(n) {
    if (n == null || Number.isNaN(n)) return "—";
    return Number(n).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function buildItemIndex(ratebook) {
    const idx = {};
    for (const m of ratebook?.materials || []) {
      if (!m.code) continue;
      idx[m.code] = {
        code: m.code,
        description: m.description || m.code,
        unit: m.unit || "NOS",
        rate: Number(m.rate) || 0,
        type: "material",
      };
    }
    for (const l of ratebook?.labour || []) {
      if (!l.code) continue;
      idx[l.code] = {
        code: l.code,
        description: l.description || l.code,
        unit: l.unit || "NOS",
        rate: Number(l.rate) || 0,
        type: "labour",
      };
    }
    return idx;
  }

  function lineIsLabour(line, item) {
    if (item?.type === "labour") return true;
    if (item?.type === "material") return false;
    if (line?.type === "labour") return true;
    const code = String(line?.code || line?.matCode || "");
    return /^L/i.test(code);
  }

  /** Default WB-style abstract extras (editable in UI). */
  function defaultExtras() {
    return [
      {
        id: "cont_mat",
        label: "Contingency on Material",
        applyTo: "material",
        pct: 3,
      },
      {
        id: "cont_lab",
        label: "Contingency on Labour",
        applyTo: "labour",
        pct: 3,
      },
      {
        id: "gst",
        label: "GST",
        applyTo: "after_extras",
        pct: 18,
      },
      {
        id: "cess",
        label: "Labour Cess",
        applyTo: "after_gst",
        pct: 1,
      },
    ];
  }

  function accumulateKitLines(acc, kit, factor, itemIndex) {
    if (!kit || !Array.isArray(kit.lines)) return;
    const f = Number(factor) || 0;
    if (f <= 0) return;
    for (const line of kit.lines) {
      const code = line.code || line.matCode;
      if (!code) continue;
      const q = (Number(line.qty ?? line.quantity ?? 0) || 0) * f;
      if (q === 0) continue;
      const item = itemIndex[code];
      const labour = lineIsLabour(line, item);
      const bucket = labour ? acc.labour : acc.material;
      const prev = bucket.get(code) || {
        code,
        description: item?.description || code,
        unit: item?.unit || "NOS",
        rate: item?.rate != null ? Number(item.rate) : Number(line.rate) || 0,
        qty: 0,
      };
      prev.qty += q;
      if (item?.description) prev.description = item.description;
      if (item?.unit) prev.unit = item.unit;
      if (item?.rate != null) prev.rate = Number(item.rate);
      bucket.set(code, prev);
    }
  }

  function scheduleFromMap(map) {
    const rows = [...map.values()]
      .filter((r) => r.qty > 0)
      .sort((a, b) => String(a.code).localeCompare(String(b.code)));
    return rows.map((r, i) => {
      const amount = (Number(r.rate) || 0) * (Number(r.qty) || 0);
      return {
        sl: i + 1,
        code: r.code,
        description: r.description,
        unit: r.unit,
        qty: Number(r.qty) || 0,
        rate: Number(r.rate) || 0,
        amount,
      };
    });
  }

  function sumSchedule(rows) {
    return rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  }

  /**
   * Compute abstract from schedule totals + editable extras.
   * applyTo: material | labour | both | after_extras | after_gst
   */
  function computeAbstract(materialTotal, labourTotal, extras) {
    const list = Array.isArray(extras) && extras.length ? extras : defaultExtras();
    const mat = Number(materialTotal) || 0;
    const lab = Number(labourTotal) || 0;
    const steps = [];
    steps.push({ id: "mat", label: "Total Material", amount: mat, pct: null });
    steps.push({ id: "lab", label: "Total Labour", amount: lab, pct: null });

    let afterMat = mat;
    let afterLab = lab;
    let runningExtras = 0;

    for (const ex of list) {
      const pct = Number(ex.pct) || 0;
      if (!pct || ex.applyTo === "after_extras" || ex.applyTo === "after_gst") continue;
      let base = 0;
      if (ex.applyTo === "material") base = mat;
      else if (ex.applyTo === "labour") base = lab;
      else if (ex.applyTo === "both") base = mat + lab;
      else continue;
      const amt = (base * pct) / 100;
      runningExtras += amt;
      if (ex.applyTo === "material") afterMat += amt;
      if (ex.applyTo === "labour") afterLab += amt;
      steps.push({
        id: ex.id,
        label: `${ex.label} (${pct}%)`,
        amount: amt,
        pct,
        applyTo: ex.applyTo,
      });
    }

    const subtotal = mat + lab + runningExtras;
    steps.push({
      id: "subtotal",
      label: "Sub-total (Mat + Lab + extras)",
      amount: subtotal,
      pct: null,
    });

    let withGst = subtotal;
    for (const ex of list) {
      if (ex.applyTo !== "after_extras") continue;
      const pct = Number(ex.pct) || 0;
      if (!pct) continue;
      const amt = (subtotal * pct) / 100;
      withGst += amt;
      steps.push({
        id: ex.id,
        label: `${ex.label} (${pct}%)`,
        amount: amt,
        pct,
        applyTo: ex.applyTo,
      });
    }

    let grand = withGst;
    for (const ex of list) {
      if (ex.applyTo !== "after_gst") continue;
      const pct = Number(ex.pct) || 0;
      if (!pct) continue;
      const amt = (withGst * pct) / 100;
      grand += amt;
      steps.push({
        id: ex.id,
        label: `${ex.label} (${pct}%)`,
        amount: amt,
        pct,
        applyTo: ex.applyTo,
      });
    }

    const rounded = Math.round(grand);
    return {
      materialTotal: mat,
      labourTotal: lab,
      extras: list,
      steps,
      subtotal,
      grandTotal: grand,
      grandTotalRounded: rounded,
      amountInWords: amountInWordsINR(rounded),
    };
  }

  /** Indian numbering: Rupees … Only */
  function amountInWordsINR(num) {
    const n = Math.round(Number(num) || 0);
    if (n === 0) return "Rupees Zero Only";
    const ones = [
      "",
      "One",
      "Two",
      "Three",
      "Four",
      "Five",
      "Six",
      "Seven",
      "Eight",
      "Nine",
      "Ten",
      "Eleven",
      "Twelve",
      "Thirteen",
      "Fourteen",
      "Fifteen",
      "Sixteen",
      "Seventeen",
      "Eighteen",
      "Nineteen",
    ];
    const tens = [
      "",
      "",
      "Twenty",
      "Thirty",
      "Forty",
      "Fifty",
      "Sixty",
      "Seventy",
      "Eighty",
      "Ninety",
    ];
    function two(x) {
      if (x < 20) return ones[x];
      return (tens[Math.floor(x / 10)] + " " + ones[x % 10]).trim();
    }
    function three(x) {
      if (x === 0) return "";
      if (x < 100) return two(x);
      return (ones[Math.floor(x / 100)] + " Hundred " + two(x % 100)).trim();
    }
    const crore = Math.floor(n / 10000000);
    const lakh = Math.floor((n % 10000000) / 100000);
    const thousand = Math.floor((n % 100000) / 1000);
    const rem = n % 1000;
    const parts = [];
    if (crore) parts.push(three(crore) + " Crore");
    if (lakh) parts.push(three(lakh) + " Lakh");
    if (thousand) parts.push(three(thousand) + " Thousand");
    if (rem) parts.push(three(rem));
    return ("Rupees " + parts.join(" ") + " Only").replace(/\s+/g, " ").trim();
  }

  /**
   * Match survey poles/spans to kits without rolling up Mat/Lab.
   * Shared by Actual BOQ and Contract Lens bridge.
   */
  function collectKitHits(survey, kits) {
    const assets = survey?.assets || [];
    const connections = survey?.connections || [];
    const structures = kits.filter((k) => k.family === "structure" && k.enabled !== false);
    const conductors = kits.filter((k) => k.family === "conductor" && k.enabled !== false);

    const proposed = assets.filter((a) => a.status === "Proposed");
    const gaps = [];
    const structureHits = [];

    for (const pole of [...proposed].sort((a, b) => (a.sequence || 0) - (b.sequence || 0))) {
      if (!isEstimateReady(pole)) {
        gaps.push({
          kind: "gap",
          title: `Pole #${pole.sequence}: needs kit details`,
          qty: 1,
          unit: "pole",
          detail: `${pole.voltage || "?"} · ${pole.structure || "?"} · ${pole.conductor || "?"}`,
          amount: null,
        });
        continue;
      }
      const hit = findStructureKit(pole, structures, false);
      if (hit) {
        structureHits.push(hit);
        continue;
      }
      gaps.push({
        kind: "gap",
        title: `Pole #${pole.sequence}: no matching kit`,
        qty: 1,
        unit: "pole",
        detail: [
          pole.voltage,
          pole.structure,
          pole.kitLocation,
          pole.kitArrangement,
          pole.kitExtension,
          pole.conductor,
        ]
          .filter(Boolean)
          .join(" · "),
        amount: null,
      });
    }

    const structureQty = new Map();
    for (const kit of structureHits) {
      const prev = structureQty.get(kit.id);
      structureQty.set(kit.id, { kit, n: (prev?.n || 0) + 1 });
    }

    const byId = new Map(assets.map((a) => [a.id, a]));
    const spanGroups = new Map();
    for (const conn of connections) {
      if (conn.status !== "Proposed") continue;
      const to = byId.get(conn.toAssetId);
      if (!to || to.status !== "Proposed") continue;
      const wire = deriveKitWire(to) || "cable";
      const key = `${to.voltage}|${to.conductor}|${wire}`;
      if (!spanGroups.has(key)) spanGroups.set(key, []);
      spanGroups.get(key).push(conn);
    }

    let matchedKm = 0;
    const conductorHits = [];
    for (const [key, conns] of spanGroups) {
      const sample = byId.get(conns[0].toAssetId);
      if (!sample) continue;
      const metres = conns.reduce(
        (s, c) => s + (parseFloat(c.spanLengthM) || 0),
        0
      );
      if (metres <= 0) {
        gaps.push({
          kind: "gap",
          title: `Span length missing for ${sample.voltage} ${sample.conductor}`,
          qty: conns.length,
          unit: "spans",
          detail: key,
          amount: null,
        });
        continue;
      }
      const km = metres / 1000;
      const hit = findConductorKit(sample, conductors, false);
      if (hit) {
        matchedKm += km;
        conductorHits.push({ kit: hit, km });
        continue;
      }
      gaps.push({
        kind: "gap",
        title: `Conductor ${sample.voltage} ${sample.conductor}: no matching kit`,
        qty: km,
        unit: "km",
        detail:
          isAbc(sample.conductor) && sample.voltage === "LT"
            ? "No ABC conductor kit in catalog"
            : isPvc(sample.conductor)
              ? "No PVC conductor kit in catalog"
              : key,
        amount: null,
      });
    }

    return {
      title: survey.title || survey.surveyTitle || "Survey",
      surveyId: survey.surveyId || survey.id || "",
      proposedPoles: proposed.length,
      readyPoles: proposed.filter(isEstimateReady).length,
      matchedStructures: structureHits.length,
      matchedConductorKm: matchedKm,
      structureQty,
      conductorHits,
      gaps,
    };
  }

  function accumulateMappedLines(acc, mappings, factor, itemIndex, bridgeGaps, kitLabel) {
    const f = Number(factor) || 0;
    if (f <= 0) return;
    const lines = Array.isArray(mappings) ? mappings : [];
    if (!lines.length) {
      bridgeGaps.push({
        kind: "gap",
        title: `Unmapped for contract: ${kitLabel}`,
        qty: f,
        unit: "units",
        detail: "Add this field kit to the Bridge pack",
        amount: null,
      });
      return;
    }
    for (const line of lines) {
      const code = String(line.code || "").trim();
      if (!code) continue;
      const q = (Number(line.qtyPerUnit) > 0 ? Number(line.qtyPerUnit) : 1) * f;
      const item = itemIndex[code];
      const labour =
        line.type === "labour" ||
        item?.type === "labour" ||
        /^L/i.test(code);
      const bucket = labour ? acc.labour : acc.material;
      const prev = bucket.get(code) || {
        code,
        description: item?.description || code,
        unit: item?.unit || "NOS",
        rate: item?.rate != null ? Number(item.rate) : 0,
        qty: 0,
      };
      prev.qty += q;
      if (item?.description) prev.description = item.description;
      if (item?.unit) prev.unit = item.unit;
      if (item?.rate != null) prev.rate = Number(item.rate);
      bucket.set(code, prev);
    }
  }

  /**
   * Hit set built from explicit per-assembly counts instead of a survey.
   * Lets a workspace price concept quantities (pre-survey) or desktop overrides.
   * @param {object[]} kits
   * @param {object} counts { [kitId]: number } — poles for per_structure, km for per_km
   */
  function hitsFromCounts(kits, counts, meta) {
    const structureQty = new Map();
    const conductorHits = [];
    let matchedKm = 0;
    for (const kit of kits || []) {
      const n = Number(counts?.[kit.id]) || 0;
      if (n <= 0) continue;
      if (kit.qtyBasis === "per_km" || kit.family === "conductor" || kit.family === "addon") {
        conductorHits.push({ kit, km: n });
        matchedKm += n;
      } else {
        structureQty.set(kit.id, { kit, n });
      }
    }
    let structures = 0;
    for (const { n } of structureQty.values()) structures += n;
    return {
      title: meta?.title || "Concept quantities",
      surveyId: meta?.surveyId || "",
      proposedPoles: meta?.proposedPoles ?? structures,
      readyPoles: meta?.readyPoles ?? structures,
      matchedStructures: structures,
      matchedConductorKm: matchedKm,
      structureQty,
      conductorHits,
      gaps: meta?.gaps || [],
    };
  }

  /**
   * Contract Lens BOQ: same field kit hits, rolled up via bridge → schedule book.
   * @param {object} scheduleBook local uploaded schedule
   * @param {object} bridge { mappings: { kitId: [{code,type,qtyPerUnit}] } }
   */
  function buildContractReport(survey, kits, scheduleBook, bridge, extras) {
    return buildContractReportFromHits(
      collectKitHits(survey, kits),
      scheduleBook,
      bridge,
      extras
    );
  }

  function buildContractReportFromHits(hits, scheduleBook, bridge, extras) {
    const itemIndex = buildItemIndex({
      materials: (scheduleBook?.items || []).filter((i) => i.type !== "labour"),
      labour: (scheduleBook?.items || []).filter((i) => i.type === "labour"),
    });
    // Also index any item regardless of type tag
    for (const it of scheduleBook?.items || []) {
      if (!it.code || itemIndex[it.code]) continue;
      itemIndex[it.code] = {
        code: it.code,
        description: it.description || it.code,
        unit: it.unit || "NOS",
        rate: Number(it.rate) || 0,
        type: it.type === "labour" ? "labour" : "material",
      };
    }

    const mappings = (bridge && bridge.mappings) || {};
    const acc = { material: new Map(), labour: new Map() };
    const bridgeGaps = [];

    for (const { kit, n } of hits.structureQty.values()) {
      accumulateMappedLines(
        acc,
        mappings[kit.id],
        n,
        itemIndex,
        bridgeGaps,
        kit.code || kit.title || kit.id
      );
    }
    for (const { kit, km } of hits.conductorHits) {
      accumulateMappedLines(
        acc,
        mappings[kit.id],
        km,
        itemIndex,
        bridgeGaps,
        kit.code || kit.title || kit.id
      );
    }

    const materialSchedule = scheduleFromMap(acc.material);
    const labourSchedule = scheduleFromMap(acc.labour);
    const materialTotal = sumSchedule(materialSchedule);
    const labourTotal = sumSchedule(labourSchedule);
    const abstract = computeAbstract(materialTotal, labourTotal, extras);
    const gaps = [...hits.gaps, ...bridgeGaps];

    return {
      title: hits.title,
      surveyId: hits.surveyId,
      proposedPoles: hits.proposedPoles,
      readyPoles: hits.readyPoles,
      matchedStructures: hits.matchedStructures,
      matchedConductorKm: hits.matchedConductorKm,
      materialSchedule,
      labourSchedule,
      materialTotal,
      labourTotal,
      abstract,
      gaps,
      bridgeGaps,
      totalAmount: abstract.grandTotal,
      lens: "contract",
      scheduleBookName: scheduleBook?.name || "",
      bridgeName: bridge?.name || "",
      money,
      moneyPlain,
    };
  }

  /**
   * @param {object} survey workspace JSON { assets, connections, title, ... }
   * @param {object[]} kits merged kits from Assembly Builder (state.kitsById values)
   * @param {object} [ratebook]
   * @param {object[]} [extras] abstract % rows
   */
  function buildReport(survey, kits, ratebook, extras) {
    return buildReportFromHits(collectKitHits(survey, kits), ratebook, extras);
  }

  function buildReportFromHits(hits, ratebook, extras) {
    const itemIndex = buildItemIndex(ratebook || {});
    const acc = { material: new Map(), labour: new Map() };

    for (const { kit, n } of hits.structureQty.values()) {
      accumulateKitLines(acc, kit, n, itemIndex);
    }
    for (const { kit, km } of hits.conductorHits) {
      accumulateKitLines(acc, kit, km, itemIndex);
    }

    const materialSchedule = scheduleFromMap(acc.material);
    const labourSchedule = scheduleFromMap(acc.labour);
    const materialTotal = sumSchedule(materialSchedule);
    const labourTotal = sumSchedule(labourSchedule);
    const abstract = computeAbstract(materialTotal, labourTotal, extras);

    return {
      title: hits.title,
      surveyId: hits.surveyId,
      proposedPoles: hits.proposedPoles,
      readyPoles: hits.readyPoles,
      matchedStructures: hits.matchedStructures,
      matchedConductorKm: hits.matchedConductorKm,
      materialSchedule,
      labourSchedule,
      materialTotal,
      labourTotal,
      abstract,
      gaps: hits.gaps,
      totalAmount: abstract.grandTotal,
      lens: "actual",
      money,
      moneyPlain,
    };
  }

  function reportAsText(report) {
    const lines = [];
    const lensLabel =
      report.lens === "contract"
        ? `Contract Lens${report.scheduleBookName ? " · " + report.scheduleBookName : ""}`
        : "Actual requirements";
    lines.push(`SLM Estimate (West Bengal style) — ${lensLabel}`);
    if (report.bridgeName) lines.push(`Bridge: ${report.bridgeName}`);
    lines.push(`Survey: ${report.title}`);
    lines.push(
      `Proposed poles: ${report.proposedPoles} · ready: ${report.readyPoles} · matched: ${report.matchedStructures}`
    );
    if (report.matchedConductorKm > 0) {
      lines.push(`Conductor km matched: ${report.matchedConductorKm.toFixed(3)}`);
    }
    lines.push("");

    function dumpSchedule(title, rows, total) {
      lines.push(title);
      lines.push(
        "Sl.\tCode\tDescription\tUnit\tQty\tRate (Rs.)\tAmount (Rs.)"
      );
      for (const r of rows || []) {
        const qty =
          r.qty === Math.floor(r.qty) ? String(r.qty) : r.qty.toFixed(3);
        lines.push(
          `${r.sl}\t${r.code}\t${r.description}\t${r.unit}\t${qty}\t${moneyPlain(
            r.rate
          )}\t${moneyPlain(r.amount)}`
        );
      }
      lines.push(`Total\t\t\t\t\t\t${moneyPlain(total)}`);
      lines.push("");
    }

    dumpSchedule(
      "SCHEDULE OF MATERIALS",
      report.materialSchedule,
      report.materialTotal
    );
    dumpSchedule(
      "SCHEDULE OF LABOUR",
      report.labourSchedule,
      report.labourTotal
    );

    lines.push("ABSTRACT / SUMMARY");
    const abs = report.abstract || {};
    for (const s of abs.steps || []) {
      lines.push(`${s.label}\t${moneyPlain(s.amount)}`);
    }
    lines.push(
      `Grand Total (say)\t${moneyPlain(abs.grandTotalRounded ?? abs.grandTotal)}`
    );
    if (abs.amountInWords) {
      lines.push(`Amount in words: ${abs.amountInWords}`);
    }
    lines.push("");

    if (report.gaps?.length) {
      lines.push("Gaps");
      for (const row of report.gaps) {
        lines.push(`• ${row.title}`);
        if (row.detail) lines.push(`  ${row.detail}`);
      }
    }
    return lines.join("\n");
  }

  global.SlmEstimateMatch = {
    buildReport,
    buildReportFromHits,
    buildContractReport,
    buildContractReportFromHits,
    hitsFromCounts,
    collectKitHits,
    reportAsText,
    computeAbstract,
    defaultExtras,
    amountInWordsINR,
    isEstimateReady,
    kitTitle,
    money,
    moneyPlain,
  };
})(typeof window !== "undefined" ? window : globalThis);
