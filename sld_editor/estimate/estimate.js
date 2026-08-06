(() => {
  const STORAGE_KEY = "slm_estimate_kits_v7";
  /** Full definitions for user-created kits (survive matrix regenerate). */
  const CUSTOM_KITS_KEY = "slm_estimate_custom_kits_v1";

  const state = {
    ratebook: null,
    matrix: null,
    kitsById: {},
    tab: "structure",
    activeKitId: null,
    catalogType: "material",
    editorView: "review",
    draft: null,
    suggestions: [],
    selectedSuggestionId: null,
    pendingSuggestionCount: 0,
    licenses: [],
    boqSurvey: null,
    boqReport: null,
    /** Editable abstract % extras (WB-style). */
    boqExtras: null,
    /** Expanded family keys on the structure board (By family view). */
    expandedFamilies: new Set(),
    /** Pending CSV/Excel import before column map save. */
    schImportTable: null,
    schImportColumnMap: null,
    activeBridgeId: "",
  };

  const $ = (id) => document.getElementById(id);

  function toast(msg) {
    const el = $("estToast");
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.add("hidden"), 2200);
  }

  function money(n) {
    if (n == null || Number.isNaN(n)) return "—";
    return "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  }

  function itemIndex() {
    const map = new Map();
    if (!state.ratebook) return map;
    for (const m of state.ratebook.materials) map.set(m.code, m);
    for (const l of state.ratebook.labour) map.set(l.code, l);
    return map;
  }

  function allCatalogItems() {
    if (!state.ratebook) return [];
    return [...state.ratebook.materials, ...state.ratebook.labour];
  }

  function kitStatus(kit) {
    if (!kit.enabled) return "off";
    if (!(kit.lines || []).length) return "empty";
    if (kit.complete) return "final";
    return "draft";
  }

  function statusLabel(st) {
    if (st === "final") return "Final";
    if (st === "draft") return "Draft";
    if (st === "off") return "Off";
    return "Empty";
  }

  function kitTitle(kit) {
    if (kit.custom) {
      const name = kit.customLabel || kit.label || kit.id;
      return `${kit.voltage || "—"} · ${name} · Custom`;
    }
    if (kit.family === "structure") {
      const loc = kit.locationLabel || kit.position || "";
      const arr = kit.arrangementLabel ? ` · ${kit.arrangementLabel}` : "";
      const agnostic = !!kit.conductorSizeAgnostic;
      const cond = agnostic
          ? ""
          : kit.conductorShort
            ? ` · ${kit.conductorShort}`
            : "";
      const wire = kit.wireLabel ? ` · ${kit.wireLabel}` : "";
      const fam =
        agnostic && kit.conductorFamily === "ABC"
          ? " · ABC"
          : agnostic && kit.conductorFamily === "ACSR"
            ? " · ACSR"
            : "";
      const ext = kit.extensionLabel ? ` · ${kit.extensionLabel}` : "";
      const dtr = kit.dtrCapacityLabel ? ` · ${kit.dtrCapacityLabel}` : "";
      // Pole is a variant (code + chips), not part of the config name — avoid
      // "9m PCC" in the title when 8M/RL/… are also allowed on the same kit.
      return `${kit.voltage} · ${kit.structureLabel} · ${loc}${arr}${cond}${fam}${wire}${ext}${dtr}`;
    }
    if (kit.family === "conductor") {
      const wire = kit.wireLabel ? ` · ${kit.wireLabel}` : "";
      return `${kit.voltage} · ${kit.conductorName}${wire}`;
    }
    if (kit.family === "addon") {
      const struct = kit.structureLabel ? ` · ${kit.structureLabel}` : "";
      return `${kit.voltage} · ${kit.label}${struct}`;
    }
    return `${kit.voltage} · ${kit.label}`;
  }

  function kitCode(kit, preferredPoleToken) {
    if (!kit) return "";
    if (preferredPoleToken && Array.isArray(kit.poleVariants)) {
      const hit = kit.poleVariants.find((v) => v.poleToken === preferredPoleToken);
      if (hit?.code) return hit.code;
    }
    return kit.code || "";
  }

  function activePoleFilter() {
    return ($("filterPole")?.value || "").trim();
  }

  function kitSearchBlob(kit) {
    const bits = [
      kitTitle(kit),
      kitCode(kit),
      kit.familyKey || "",
      kit.poleToken || "",
      kit.poleLabel || "",
      kit.id || "",
    ];
    for (const v of kit.poleVariants || []) {
      bits.push(v.code || "", v.poleToken || "", v.poleLabel || "");
    }
    return bits.join(" ").toLowerCase();
  }

  function kitLineCounts(kit) {
    const idx = itemIndex();
    let mat = 0;
    let lab = 0;
    for (const ln of kit.lines || []) {
      if (lineType(ln, idx.get(ln.code)) === "labour") lab += 1;
      else mat += 1;
    }
    return { mat, lab, total: mat + lab };
  }

  function kitSubtitle(kit) {
    const basis =
      state.matrix?.qtyBasisLabels?.[kit.qtyBasis] || kit.qtyBasis || "";
    const { mat, lab, total } = kitLineCounts(kit);
    if (kit.family === "addon") {
      return `${kit.hint || ""} · ${basis} · ${mat} mat · ${lab} lab`;
    }
    // Custom kits may still carry a free-text pole hint; matrix poles use chips.
    const height =
      kit.custom && (kit.poleLabel || kit.poleHeightHint)
        ? ` · Pole ${kit.poleLabel || kit.poleHeightHint}`
        : "";
    return `${basis}${height} · ${mat} mat · ${lab} lab · ${total} items`;
  }

  function loadEdits() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function loadCustomKits() {
    try {
      const raw = localStorage.getItem(CUSTOM_KITS_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  function saveCustomKits(list) {
    localStorage.setItem(CUSTOM_KITS_KEY, JSON.stringify(list || []));
  }

  /** Custom kits from matrix publish + local overrides (local wins by id). */
  function allCustomKitDefs() {
    const fromMatrix = Array.isArray(state.matrix?.customKits)
      ? state.matrix.customKits
      : [];
    const local = loadCustomKits();
    const byId = new Map();
    for (const k of fromMatrix) {
      if (k?.id) byId.set(k.id, { ...k, custom: true });
    }
    for (const k of local) {
      if (k?.id) byId.set(k.id, { ...k, custom: true });
    }
    return [...byId.values()];
  }

  function persistCustomKitDefsFromState() {
    const customs = Object.values(state.kitsById)
      .filter((k) => k.custom)
      .map((k) => ({
        id: k.id,
        family: k.family || "structure",
        custom: true,
        voltage: k.voltage || "",
        customLabel: k.customLabel || k.label || "",
        label: k.customLabel || k.label || "",
        structure: k.structure || "CUSTOM",
        structureLabel: k.structureLabel || "Custom",
        location: k.location || null,
        locationLabel: k.locationLabel || null,
        arrangement: k.arrangement || null,
        arrangementLabel: k.arrangementLabel || null,
        conductorId: k.conductorId || null,
        conductorShort: k.conductorShort || null,
        conductorName: k.conductorName || null,
        wireCount: k.wireCount || null,
        wireLabel: k.wireLabel || null,
        extension: k.extension || null,
        extensionLabel: k.extensionLabel || null,
        qtyBasis: k.qtyBasis || "per_structure",
        poleHeightHint: k.poleHeightHint || "",
        notes: k.notes || "",
        enabled: k.enabled !== false,
        complete: !!k.complete,
        lines: k.lines || [],
        hint: k.hint || "User-defined structure kit",
      }));
    saveCustomKits(customs);
    if (state.matrix) state.matrix.customKits = customs;
  }

  function saveEdits() {
    const payload = {};
    for (const [id, kit] of Object.entries(state.kitsById)) {
      payload[id] = {
        enabled: kit.enabled,
        complete: kit.complete,
        lines: kit.lines || [],
        notes: kit.notes || "",
      };
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    persistCustomKitDefsFromState();
  }

  function mergeKits() {
    const edits = loadEdits();
    const kits = {};
    const lists = [
      ...(state.matrix.structureKits || []),
      ...(state.matrix.conductorKits || []),
      ...(state.matrix.addonKits || []),
      ...allCustomKitDefs(),
    ];
    for (const base of lists) {
      const e = edits[base.id] || {};
      kits[base.id] = {
        ...base,
        custom: !!base.custom,
        enabled: e.enabled != null ? e.enabled : base.enabled !== false,
        complete: e.complete != null ? e.complete : !!base.complete,
        lines: Array.isArray(e.lines)
          ? e.lines
          : Array.isArray(base.lines)
            ? base.lines
            : [],
        notes: e.notes != null ? e.notes : base.notes || "",
      };
    }
    state.kitsById = kits;
  }

  function newCustomKitId() {
    const slug = Date.now().toString(36);
    return `CUSTOM|STR|${slug}`;
  }

  function createCustomStructure(fields) {
    const label = String(fields.customLabel || "").trim();
    if (!label) {
      toast("Enter a name for the custom structure");
      return null;
    }
    const voltage = fields.voltage || "11kV";
    const kit = {
      id: newCustomKitId(),
      family: "structure",
      custom: true,
      voltage,
      customLabel: label,
      label,
      structure: "CUSTOM",
      structureLabel: "Custom",
      location: fields.location || null,
      locationLabel: fields.location || null,
      arrangement: null,
      arrangementLabel: null,
      conductorId: null,
      conductorShort: fields.conductorNote || null,
      conductorName: fields.conductorNote || null,
      wireCount: null,
      wireLabel: null,
      extension: null,
      extensionLabel: null,
      qtyBasis: "per_structure",
      poleHeightHint: fields.poleHeightHint || "",
      enabled: true,
      complete: false,
      lines: [],
      notes: fields.notes || "",
      hint: "User-defined structure — not in the standard matrix",
    };
    state.kitsById[kit.id] = kit;
    saveEdits();
    renderStats();
    return kit;
  }

  async function deleteCustomKit(kitId) {
    const kit = state.kitsById[kitId];
    if (!kit?.custom) return;
    const ok = await window.SlmDialog.confirm({
      title: "Delete custom kit?",
      message: `Delete “${kitTitle(kit)}”?\n\nThis cannot be undone on this computer.`,
      okLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    delete state.kitsById[kitId];
    const edits = loadEdits();
    delete edits[kitId];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(edits));
    persistCustomKitDefsFromState();
    await closeEditor({ force: true });
    renderStats();
    showTab("structure");
    toast("Custom kit deleted");
  }

  function kitsForTab() {
    const family =
      state.tab === "structure"
        ? "structure"
        : state.tab === "conductor"
          ? "conductor"
          : "addon";
    return Object.values(state.kitsById).filter((k) => k.family === family);
  }

  function countByStatus(kits) {
    const out = { empty: 0, draft: 0, final: 0, off: 0, total: kits.length };
    for (const k of kits) out[kitStatus(k)] += 1;
    return out;
  }

  function renderStats() {
    const all = Object.values(state.kitsById);
    const byFamily = {
      structure: all.filter((k) => k.family === "structure"),
      conductor: all.filter((k) => k.family === "conductor"),
      addon: all.filter((k) => k.family === "addon"),
    };
    const mat = state.ratebook.materials.length;
    const lab = state.ratebook.labour.length;

    // Counts live on tabs — no card strip.
    const tabLabel = (kits) => {
      const s = countByStatus(kits);
      return `${s.final}/${kits.length}`;
    };
    $("tabCountStructure").textContent = tabLabel(byFamily.structure);
    $("tabCountConductor").textContent = tabLabel(byFamily.conductor);
    $("tabCountAddon").textContent = tabLabel(byFamily.addon);
    $("tabCountRatebook").textContent = String(mat + lab);
  }

  function filteredBoardRows() {
    syncStructureFilterOptions();
    const q = ($("boardSearch").value || "").trim().toLowerCase();
    const voltage = $("filterVoltage").value;
    const structure = $("filterStructure")?.value || "";
    const conductor = $("filterConductor")?.value || "";
    const wire = $("filterWire")?.value || "";
    const dtrCap = $("filterDtrCapacity")?.value || "";
    const location = $("filterLocation")?.value || "";
    const arrangement = $("filterArrangement")?.value || "";
    const extension = $("filterExtension")?.value || "";
    const pole = $("filterPole")?.value || "";
    const status = $("filterStatus").value;
    const origin = $("filterOrigin")?.value || "";
    const showDtr = !!$("filterShowDtr")?.checked;

    let rows = kitsForTab();
    const tabTotal = rows.length;
    if (voltage) rows = rows.filter((k) => k.voltage === voltage);
    if (structure) {
      if (structure === "CUSTOM") {
        rows = rows.filter((k) => k.custom || k.structure === "CUSTOM");
      } else {
        rows = rows.filter((k) => k.structure === structure);
      }
    } else if (
      state.tab === "structure" &&
      !showDtr &&
      !String(structure || "").startsWith("DTR")
    ) {
      // Default: hide DTR mount kits until Show DTR is on (or structure=DTR*).
      rows = rows.filter((k) => !k.isDtr && !(k.structure || "").startsWith("DTR"));
    }
    if (conductor) rows = rows.filter((k) => k.conductorId === conductor);
    if (wire) {
      if (wire === "cable") {
        rows = rows.filter(
          (k) => k.wireLabel === "cable" || k.conductorFamily === "ABC"
        );
      } else {
        rows = rows.filter((k) => k.wireCount === wire);
      }
    }
    if (dtrCap) rows = rows.filter((k) => k.dtrCapacity === dtrCap);
    if (location) {
      rows = rows.filter((k) => (k.location || k.position) === location);
    }
    if (arrangement) rows = rows.filter((k) => k.arrangement === arrangement);
    if (extension) rows = rows.filter((k) => k.extension === extension);
    if (pole) {
      rows = rows.filter((k) => {
        if (k.poleToken === pole) return true;
        return (k.poleVariants || []).some((v) => v.poleToken === pole);
      });
    }
    if (status) rows = rows.filter((k) => kitStatus(k) === status);
    if (origin === "custom") rows = rows.filter((k) => k.custom);
    if (origin === "matrix") rows = rows.filter((k) => !k.custom);
    if (q) {
      rows = rows.filter((k) => kitSearchBlob(k).includes(q));
    }
    return { rows, tabTotal };
  }

  function renderBoardSummary(rows, tabTotal) {
    const el = $("boardSummary");
    if (!el) return;
    const s = countByStatus(rows);
    const parts = [`${rows.length} of ${tabTotal}`];
    if (
      state.tab === "structure" &&
      ($("boardViewMode")?.value || "family") === "family"
    ) {
      const fams = new Set(rows.map((k) => familyKeyOf(k)));
      parts.push(`${fams.size} families`);
    }
    if (s.final) parts.push(`${s.final} final`);
    if (s.draft) parts.push(`${s.draft} draft`);
    if (s.empty) parts.push(`${s.empty} empty`);
    el.textContent = parts.join(" · ");
  }

  function populateConductorFilter() {
    const sel = $("filterConductor");
    if (!sel) return;
    const seen = new Map();
    for (const kit of Object.values(state.kitsById)) {
      if (!kit.conductorId) continue;
      const label = kit.conductorShort || kit.conductorName || kit.conductorId;
      if (!seen.has(kit.conductorId)) seen.set(kit.conductorId, label);
    }
    const current = sel.value;
    sel.innerHTML =
      `<option value="">All conductors</option>` +
      [...seen.entries()]
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(
          ([id, label]) =>
            `<option value="${escapeAttr(id)}">${escapeHtml(label)}</option>`
        )
        .join("");
    if ([...seen.keys()].includes(current)) sel.value = current;
  }

  function populateDtrCapacityFilter() {
    const sel = $("filterDtrCapacity");
    if (!sel) return;
    const caps = state.matrix?.dtrCapacities || [];
    const current = sel.value;
    sel.innerHTML =
      `<option value="">All DTR kVA</option>` +
      caps
        .map(
          (d) =>
            `<option value="${escapeAttr(d.id)}">${escapeHtml(d.label)}</option>`
        )
        .join("");
    if (caps.some((d) => d.id === current)) sel.value = current;
  }

  function syncStructureFilterOptions() {
    const sel = $("filterStructure");
    const extSel = $("filterExtension");
    const locSel = $("filterLocation");
    const arrSel = $("filterArrangement");
    const wireSel = $("filterWire");
    const dtrSel = $("filterDtrCapacity");
    if (!sel) return;
    const showStructFilter = state.tab === "structure";
    const showWireFilter = state.tab === "structure" || state.tab === "conductor";
    sel.style.display = showStructFilter ? "" : "none";
    if (extSel) extSel.style.display = showStructFilter ? "" : "none";
    if (locSel) locSel.style.display = showStructFilter ? "" : "none";
    if (arrSel) arrSel.style.display = showStructFilter ? "" : "none";
    if (wireSel) wireSel.style.display = showWireFilter ? "" : "none";

    const voltage = $("filterVoltage").value;
    if (dtrSel) {
      const showDtr = showStructFilter && (!voltage || voltage === "11kV");
      dtrSel.style.display = showDtr ? "" : "none";
    }

    const condSel = $("filterConductor");
    if (condSel) {
      // LT structure kits ignore conductor size — hide that filter on LT structure board.
      const showCond =
        state.tab === "conductor" ||
        (state.tab === "structure" && voltage !== "LT");
      condSel.style.display = showCond ? "" : "none";
      if (!showCond) condSel.value = "";
    }

    // Dead-end has no arrangement — hide arrangement filter when location is Dead-end
    if (arrSel && locSel) {
      const loc = locSel.value;
      const hideArr = loc === "Dead-end";
      [...arrSel.options].forEach((opt) => {
        if (!opt.value) {
          opt.hidden = false;
          return;
        }
        opt.hidden = hideArr;
      });
      if (hideArr) arrSel.value = "";
    }

    // HT: hide 2W/4W options in wire filter
    if (wireSel) {
      const htOnly3 = voltage === "33kV" || voltage === "11kV";
      [...wireSel.options].forEach((opt) => {
        if (!opt.value || opt.value === "3W" || opt.value === "cable") {
          opt.hidden = false;
          return;
        }
        opt.hidden = htOnly3;
      });
      if (htOnly3 && (wireSel.value === "2W" || wireSel.value === "4W")) {
        wireSel.value = "";
      }
    }

    if (!showStructFilter) return;

    const rules = state.matrix?.domainRules || {};
    const loc = locSel?.value || "";
    let allowed = voltage && rules[voltage]?.structures
      ? new Set(rules[voltage].structures)
      : null;
    // 33kV T-Off allowed for 1P–4P (see domainRules.tOffOnly)
    if (allowed && voltage === "33kV" && loc === "T-Off") {
      const tOffOnly = rules["33kV"]?.tOffOnly || ["1P", "2P", "3P", "4P"];
      allowed = new Set(tOffOnly);
    }
    [...sel.options].forEach((opt) => {
      if (!opt.value) {
        opt.hidden = false;
        return;
      }
      opt.hidden = !!(allowed && !allowed.has(opt.value));
    });
    if (sel.value && allowed && !allowed.has(sel.value)) {
      sel.value = "";
    }
  }

  function familyKeyOf(kit) {
    if (kit.familyKey) return kit.familyKey;
    const v = (kit.voltage || "?").replace("kV", "");
    return `${v}|${kit.structure || "?"}`;
  }

  function familyHeading(familyKey, sample) {
    if (sample) {
      const label = sample.structureLabel || sample.structure || "";
      return `${sample.voltage || "?"} · ${label}`.trim();
    }
    return String(familyKey || "?").replace("|", " · ");
  }

  function renderKitRow(kit) {
    const st = kitStatus(kit);
    const counts = kitLineCounts(kit);
    const items =
      counts.total > 0 ? `${counts.mat + counts.lab} items` : "No items yet";
    const poleFilter = activePoleFilter();
    const code = kitCode(kit, poleFilter || undefined);
    const poles = (kit.poleVariants || [])
      .map((v) => v.poleToken)
      .filter(Boolean);
    const poleHtml =
      poles.length > 0
        ? `<span class="est-row-poles">${poles
            .map((t) => {
              const on =
                (poleFilter && t === poleFilter) ||
                (!poleFilter && t === kit.poleToken);
              return `<span class="est-pole-chip${on ? " is-active" : ""}">${escapeHtml(
                t
              )}</span>`;
            })
            .join("")}</span>`
        : "";
    const bits = [kitSubtitle(kit), items];
    if (kit.custom) bits.push("custom");
    const codeHtml = code
      ? `<span class="est-kit-code" title="Kit code">${escapeHtml(code)}</span>`
      : "";
    return `
      <button type="button" class="est-row ${st === "off" ? "disabled-row" : ""}" data-open="${escapeAttr(kit.id)}">
        <span class="est-row-main">
          ${codeHtml}
          <span class="est-row-title">${escapeHtml(kitTitle(kit))}</span>
          ${poleHtml}
          <span class="est-row-meta">${escapeHtml(bits.filter(Boolean).join(" · "))}</span>
        </span>
        <span class="est-badge ${st}">${statusLabel(st)}</span>
      </button>
    `;
  }

  function renderBoard() {
    const { rows, tabTotal } = filteredBoardRows();
    renderBoardSummary(rows, tabTotal);

    const list = $("boardList");
    const customBtn = $("btnAddCustomStructure");
    if (customBtn) customBtn.classList.toggle("hidden", state.tab !== "structure");

    if (!rows.length) {
      list.innerHTML = `<div class="est-empty">No kits match. Clear search or adjust filters.</div>`;
      return;
    }

    const byFamily =
      state.tab === "structure" &&
      ($("boardViewMode")?.value || "family") === "family";

    if (!byFamily) {
      list.innerHTML = rows.map((kit) => renderKitRow(kit)).join("");
      list.querySelectorAll("[data-open]").forEach((btn) => {
        btn.addEventListener("click", () => openEditor(btn.getAttribute("data-open")));
      });
      return;
    }

    const byFam = new Map();
    for (const kit of rows) {
      const fk = familyKeyOf(kit);
      if (!byFam.has(fk)) byFam.set(fk, []);
      byFam.get(fk).push(kit);
    }
    const familyKeys = [...byFam.keys()].sort((a, b) => a.localeCompare(b));
    const forceExpand =
      !!($("boardSearch").value || "").trim() || familyKeys.length === 1;

    list.innerHTML = familyKeys
      .map((fk) => {
        const famRows = byFam.get(fk);
        const sample = famRows[0];
        const expanded = forceExpand || state.expandedFamilies.has(fk);
        const s = countByStatus(famRows);
        const poleSet = [
          ...new Set(
            famRows.flatMap((k) =>
              (k.poleVariants || []).map((v) => v.poleToken).filter(Boolean)
            )
          ),
        ].sort();
        const body = expanded
          ? `<div class="est-family-body">${famRows.map((k) => renderKitRow(k)).join("")}</div>`
          : "";
        return `<div class="est-family ${expanded ? "is-open" : ""}" data-family="${escapeAttr(fk)}">
          <button type="button" class="est-family-head" data-family-toggle="${escapeAttr(fk)}">
            <span class="est-family-chevron" aria-hidden="true">${expanded ? "▾" : "▸"}</span>
            <span class="est-family-title">${escapeHtml(familyHeading(fk, sample))}</span>
            <span class="est-family-meta">${famRows.length} kits · ${s.final || 0} final · ${s.draft || 0} draft</span>
            <span class="est-family-poles">${poleSet
              .map((t) => `<span class="est-pole-chip">${escapeHtml(t)}</span>`)
              .join("")}</span>
          </button>
          ${body}
        </div>`;
      })
      .join("");

    list.querySelectorAll("[data-family-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const fk = btn.getAttribute("data-family-toggle");
        if (state.expandedFamilies.has(fk)) state.expandedFamilies.delete(fk);
        else state.expandedFamilies.add(fk);
        renderBoard();
      });
    });
    list.querySelectorAll("[data-open]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        openEditor(btn.getAttribute("data-open"));
      });
    });
  }

  function setEditorView(view) {
    state.editorView = view;
    document.querySelectorAll(".ed-view-tab").forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.edView === view);
    });
    $("edReviewView").classList.toggle("hidden", view !== "review");
    $("edAddView").classList.toggle("hidden", view !== "add");
    if (view === "add") {
      if (!state.catalogType || state.catalogType === "all") {
        state.catalogType = "material";
        document.querySelectorAll(".est-mini-tab").forEach((b) => {
          b.classList.toggle("active", b.dataset.cat === "material");
        });
      }
      renderCatalog();
      $("catalogSearch")?.focus();
    }
  }

  function renderEditorSummary() {
    const chips = $("editorSummaryChips");
    if (!chips || !state.draft) return;
    const fakeKit = { lines: state.draft.lines };
    const { mat, lab } = kitLineCounts(fakeKit);
    chips.innerHTML = `
      <span class="est-chip" style="background:#e8f1ff;color:#1e40af;"><strong>${mat}</strong> mat</span>
      <span class="est-chip" style="background:#ecfdf3;color:#166534;"><strong>${lab}</strong> lab</span>
      <span class="est-chip ${state.draft.complete ? "complete" : "partial"}">${
        state.draft.complete ? "Final" : "Draft"
      }</span>
    `;
  }

  function polesQty(kit) {
    const st = String(kit?.structure || "");
    if (st === "DTR2P" || st === "2P") return 2;
    if (st === "3P") return 3;
    if (st === "DTR4P" || st === "4P") return 4;
    return 1;
  }

  function poleMatCodeSet() {
    const set = new Set();
    for (const p of state.matrix?.poleOptions || []) {
      if (p.code) set.add(p.code);
    }
    // Fallback known Mat pole codes
    for (const c of [
      "110030141",
      "110030241",
      "110010341",
      "110011541",
      "110010741",
      "110020711",
      "110051211",
    ]) {
      set.add(c);
    }
    return set;
  }

  function erectionLabCodeSet(kit) {
    const set = new Set([
      "L0005",
      "L0006",
      "L0007",
      "L0008",
      "L0009",
      "L0010",
      "L0011",
      "L0084",
      "L0085",
      "L0086",
      "L0091",
      "L0092",
      "L0093",
    ]);
    for (const v of kit?.poleVariants || []) {
      for (const c of v.labourCodes || []) set.add(c);
    }
    return set;
  }

  function labourCodesForVariant(kit, variant) {
    if (Array.isArray(variant?.labourCodes) && variant.labourCodes.length) {
      return variant.labourCodes;
    }
    // Fallback if matrix predates labourCodes on variants
    const st = String(kit?.structure || "");
    const m =
      st === "DTR2P" || st === "2P"
        ? "2P"
        : st === "3P"
          ? "3P"
          : st === "DTR4P" || st === "4P"
            ? "4P"
            : "1P";
    const tok = variant?.poleToken || "";
    const voltage = kit?.voltage || "";
    if (tok === "RL" || tok === "WF") {
      return { "1P": ["L0084"], "2P": ["L0085"], "3P": ["L0085"], "4P": ["L0086"] }[m];
    }
    if (tok === "8M") {
      if (voltage === "LT" && m === "1P") return ["L0007"];
      return { "1P": ["L0006"], "2P": ["L0009"], "3P": ["L0010"], "4P": ["L0091"] }[m];
    }
    if (voltage === "LT" && m === "1P") return ["L0007"];
    return { "1P": ["L0005"], "2P": ["L0008"], "3P": ["L0010"], "4P": ["L0011"] }[m];
  }

  /** Swap kit lines to the selected pole mat (+ erection lab if in ratebook). */
  function applyPoleVariant(kit, variant) {
    if (!state.draft || !variant) return;
    const idx = itemIndex();
    const matCode = variant.matCode || variant.poleCode || "";
    const labCodes = labourCodesForVariant(kit, variant);
    const poleMats = poleMatCodeSet();
    const erectionLabs = erectionLabCodeSet(kit);
    const qty = polesQty(kit);

    state.draft.lines = (state.draft.lines || []).filter(
      (l) => !poleMats.has(l.code) && !erectionLabs.has(l.code)
    );

    let addedMat = false;
    let addedLab = 0;
    if (matCode && idx.has(matCode)) {
      const item = idx.get(matCode);
      state.draft.lines.unshift({
        code: matCode,
        type: item.type || "material",
        qty,
      });
      addedMat = true;
    }
    for (const lc of labCodes) {
      if (!idx.has(lc)) continue;
      const item = idx.get(lc);
      state.draft.lines.push({
        code: lc,
        type: item.type || "labour",
        qty: 1,
      });
      addedLab += 1;
    }

    state.draft.activePoleToken = variant.poleToken || "";
    state.draft.activePoleCode = matCode;
    markDraftDirty();
    renderKitLines();
    renderEditorSummary();

    const kitCodeStr = variant.code || "";
    if ($("editorSub") && kitCodeStr) {
      const bits = ($("editorSub").textContent || "")
        .split(" · ")
        .filter((b) => b && !b.startsWith("Code "));
      $("editorSub").textContent = [`Code ${kitCodeStr}`, ...bits].join(" · ");
      $("editorSub").classList.remove("hidden");
    }

    if (!addedMat && !addedLab) {
      toast(
        matCode
          ? `Pole ${variant.poleToken || matCode} not found in ratebook`
          : "No pole code on this variant"
      );
      return;
    }
    const parts = [];
    if (addedMat) parts.push(variant.poleLabel || variant.poleToken || matCode);
    if (addedLab) parts.push(`${addedLab} lab`);
    toast(`Pole set · ${parts.join(" · ")}`);
  }

  function renderEditorPoleVariants(kit) {
    const host = $("editorPoleVariants");
    if (!host) return;
    const variants = kit.poleVariants || [];
    if (kit.family !== "structure" || variants.length < 1) {
      host.classList.add("hidden");
      host.innerHTML = "";
      return;
    }
    const idx = itemIndex();
    const activeToken =
      state.draft?.activePoleToken || kit.poleToken || "";
    host.classList.remove("hidden");
    host.innerHTML =
      `<span class="ed-pole-label">Pole variants</span>` +
      variants
        .map((v, i) => {
          const matCode = v.matCode || v.poleCode || "";
          const hasMat = !!(matCode && idx.has(matCode));
          const labCodes = labourCodesForVariant(kit, v);
          const hasLab = labCodes.some((c) => idx.has(c));
          const active = activeToken
            ? v.poleToken === activeToken
            : !!v.isDefault;
          const tip = [
            v.poleLabel || v.poleToken || "",
            hasMat ? `Mat ${matCode}` : matCode ? `Mat ${matCode} missing` : "No mat",
            hasLab
              ? `Lab ${labCodes.filter((c) => idx.has(c)).join(",")}`
              : labCodes.length
                ? "Lab missing"
                : "No lab",
            "Click to load into kit",
          ].join(" · ");
          return `<button type="button" class="est-pole-chip est-pole-chip-btn ${
            active ? "is-active" : ""
          } ${!hasMat ? "is-missing" : ""}" data-pole-idx="${i}" title="${escapeAttr(
            tip
          )}">${escapeHtml(v.poleToken || "?")}<span class="est-pole-chip-code">${escapeHtml(
            v.code || matCode || ""
          )}</span></button>`;
        })
        .join("");
    host.querySelectorAll("[data-pole-idx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = Number(btn.getAttribute("data-pole-idx"));
        const variant = variants[i];
        if (!variant) return;
        applyPoleVariant(kit, variant);
        renderEditorPoleVariants(kit);
      });
    });
  }

  function openEditor(kitId) {
    const kit = state.kitsById[kitId];
    if (!kit) return;
    const L = window.SlmLicense;
    const licensedOff = !L || !L.enabled;
    const canEdit = licensedOff || !!(L.canEditKits && L.canEditKits());
    if (!canEdit) {
      toast("Your license cannot edit kits (needs Suggest or Approve)");
      return;
    }
    state.activeKitId = kitId;
    state.draft = {
      enabled: kit.enabled,
      complete: kit.complete,
      notes: kit.notes || "",
      lines: (kit.lines || []).map((l) => ({ ...l })),
      activePoleToken: kit.poleToken || "",
      activePoleCode: kit.poleCode || "",
      _dirty: false,
    };

    $("boardPanel").classList.add("hidden");
    $("ratebookPanel").classList.add("hidden");
    $("boqPanel")?.classList.add("hidden");
    $("schedulesPanel")?.classList.add("hidden");
    $("editorPanel").classList.remove("hidden");
    $("edMorePanel")?.classList.add("hidden");

    $("editorTitle").textContent = kitTitle(kit);
    if ($("editorSub")) {
      const bits = [
        kit.voltage,
        kit.structureLabel || kit.structure,
        kit.location,
        kit.conductorShort || kit.conductorFamily,
      ].filter(Boolean);
      $("editorSub").textContent = bits.length
        ? bits.join(" · ")
        : "Review materials & labour, then save or send a suggestion.";
      $("editorSub").classList.remove("hidden");
    }
    const pill = $("editorStatusPill");
    if (pill) {
      const empty = !(kit.lines || []).length;
      const final = !!kit.complete;
      pill.textContent = empty ? "Empty" : final ? "Final" : "Draft";
      pill.className =
        "ed-status-pill" +
        (final ? " is-final" : empty ? " is-empty" : "");
    }
    renderEditorPoleVariants(kit);
    $("kitEnabled").checked = !!state.draft.enabled;
    if ($("kitFinal")) $("kitFinal").checked = !!state.draft.complete;
    if ($("kitComplete")) $("kitComplete").checked = !!state.draft.complete;
    $("kitNotes").value = state.draft.notes || "";

    const delBtn = $("btnDeleteCustomKit");
    if (delBtn) delBtn.classList.toggle("hidden", !kit.custom);

    const seedBtn = $("btnSeedConductor");
    seedBtn.hidden = !(kit.family === "conductor" && kit.seedMatCode);
    const fitBtn = $("btnSeedFittings");
    const canSeedFits =
      !kit.custom &&
      (kit.family === "structure" || kit.family === "addon") &&
      Array.isArray(kit.seedFittingCodes) &&
      kit.seedFittingCodes.length;
    fitBtn.hidden = !canSeedFits;
    fitBtn.textContent =
      kit.family === "addon" && kit.addonType === "Guarding"
        ? "Fill GI wire starters"
        : kit.isDtr
          ? "Fill DTR starters"
          : "Fill starter fittings";

    renderEditorSummary();
    setEditorView("review");
    renderKitLines();
    updateSuggestButton();
    updateEditorAuthUi();
  }

  function updateSuggestButton() {
    const btn = $("btnSuggestKit");
    if (!btn) return;
    const L = window.SlmLicense;
    const licensedOff = !L || !L.enabled;
    const can = licensedOff || !!(L && L.canSuggest());
    btn.classList.toggle("hidden", !can);
    btn.disabled = !can;
    btn.title = can
      ? "Send this kit change for approval"
      : "Needs can_suggest on your license";
  }

  function updateEditorAuthUi() {
    const L = window.SlmLicense;
    const licensedOff = !L || !L.enabled;
    const canApprove = licensedOff || !!(L && L.canApprove());
    const canEdit = licensedOff || !!(L && L.canEditKits && L.canEditKits());
    const finalWrap = $("kitFinalWrap");
    const finalBox = $("kitFinal");
    if (finalWrap) {
      finalWrap.classList.toggle("is-locked", !canApprove);
      finalWrap.title = canApprove
        ? "Mark ready for estimates (approvers)"
        : "Mark Final needs can_approve on your license";
    }
    if (finalBox) {
      finalBox.disabled = !canApprove;
      if (!canApprove && state.draft) {
        // keep visual in sync with kit, but cannot toggle
        finalBox.checked = !!state.draft.complete;
      }
    }
    const saveBtn = $("btnSaveKit");
    if (saveBtn) {
      saveBtn.disabled = !canEdit;
      saveBtn.title = canEdit
        ? "Save kit changes on this computer"
        : "Needs Suggest or Approve on your license";
    }
  }

  function setBtnEnabled(el, enabled, whenOffTitle, whenOnTitle) {
    if (!el) return;
    el.disabled = !enabled;
    el.classList.toggle("is-disabled", !enabled);
    if (!enabled && whenOffTitle) el.title = whenOffTitle;
    else if (enabled && whenOnTitle) el.title = whenOnTitle;
  }

  function hasPublishKeyConfigured() {
    const cfg = window.SLM_LICENSE_CONFIG || {};
    if ((cfg.CATALOG_PUBLISH_KEY || "").trim()) return true;
    try {
      if ((sessionStorage.getItem("slm_catalog_publish_key") || "").trim()) return true;
    } catch (_) {}
    return false;
  }

  function updatePermissionUi() {
    const L = window.SlmLicense;
    const licensedOff = !L || !L.enabled;
    const prefs = L?.readPrefs?.() || {};
    const canSuggest = licensedOff ? true : !!(L && L.canSuggest());
    const canApprove = licensedOff ? true : !!(L && L.canApprove());
    const canEditKits = licensedOff ? true : !!(L && L.canEditKits && L.canEditKits());
    // Dev mode (no Supabase): treat as full admin for local testing.
    const canPublish = licensedOff ? true : canApprove;

    const roleEl = $("estPermRole");
    const chips = $("estPermChips");
    let roleLabel = "Browse only";
    if (licensedOff) roleLabel = "Dev mode (licensing off) — all tools enabled";
    else if (canApprove && canSuggest) roleLabel = "Admin — suggest, approve, publish";
    else if (canApprove) roleLabel = "Approver — review suggestions & publish";
    else if (canSuggest) roleLabel = "Suggestor — edit kits & suggest changes";
    else roleLabel = "Viewer — browse catalog only";
    if (roleEl) {
      const code = prefs.licenseCode ? ` · ${prefs.licenseCode}` : "";
      roleEl.textContent = roleLabel + code;
    }
    if (chips) {
      chips.innerHTML = `
        <span class="est-chip ${canEditKits ? "complete" : "disabled"}">Edit ${canEditKits ? "ON" : "OFF"}</span>
        <span class="est-chip ${canSuggest ? "complete" : "disabled"}">Suggest ${canSuggest ? "ON" : "OFF"}</span>
        <span class="est-chip ${canApprove ? "complete" : "disabled"}">Approve ${canApprove ? "ON" : "OFF"}</span>
        <span class="est-chip ${canPublish ? "complete" : "disabled"}">Publish ${canPublish ? "ON" : "OFF"}</span>
      `;
    }

    setBtnEnabled(
      $("btnPublishCatalog"),
      canPublish,
      "Publish needs can_approve on your license (admin)",
      hasPublishKeyConfigured()
        ? "Push rate book + kits online for the phone app"
        : "Push to phones (you will be asked for the publish key)"
    );
    setBtnEnabled(
      $("btnExportKits"),
      canEditKits,
      "Export needs Suggest or Approve on your license",
      "Download a backup of kit edits from this browser"
    );
    setBtnEnabled(
      $("btnImportKits"),
      canEditKits,
      "Import needs Suggest or Approve on your license",
      "Load a kit backup into this browser"
    );
    setBtnEnabled(
      $("btnResetKits"),
      canEditKits,
      "Reset needs Suggest or Approve on your license",
      "Clear kit edits on this computer"
    );
    setBtnEnabled(
      $("btnAddCustomStructure"),
      canEditKits,
      "Custom kits need Suggest or Approve on your license",
      "Create a non-standard structure kit"
    );

    updateSuggestButton();
    updateEditorAuthUi();
    updateSuggestionsTabVisibility();
    updateLicensesTabVisibility();
  }

  function markDraftDirty() {
    if (state.draft) state.draft._dirty = true;
  }

  function isDraftDirty() {
    return !!(state.draft && state.draft._dirty);
  }

  function isSoloEmbed() {
    return new URLSearchParams(location.search).get("solo") === "1";
  }

  function notifySoloParent(type, extra) {
    if (!isSoloEmbed() || window.parent === window) return;
    try {
      window.parent.postMessage(
        Object.assign({ type: type, kitId: state.activeKitId }, extra || {}),
        "*"
      );
    } catch (e) {
      /* ignore */
    }
  }

  async function closeEditor(opts) {
    opts = opts || {};
    if (!opts.force && isDraftDirty()) {
      const leave = await window.SlmDialog.confirm({
        title: "Discard unsaved edits?",
        message: "You have unsaved changes in this kit. Leave without saving?",
        okLabel: "Discard",
        cancelLabel: "Keep editing",
        danger: true,
      });
      if (!leave) return;
    }
    if (isSoloEmbed()) {
      notifySoloParent("slm_kit_solo_done", { dirty: false });
      return;
    }
    state.activeKitId = null;
    state.draft = null;
    $("editorPanel").classList.add("hidden");
    showTab(state.tab);
  }

  function lineType(line, catalogItem) {
    const t = (catalogItem?.type || line.type || "").toLowerCase();
    if (t === "labour") return "labour";
    if (String(line.code || "").toUpperCase().startsWith("L")) return "labour";
    return "material";
  }

  function adjustQty(i, delta) {
    if (!state.draft?.lines[i]) return;
    const cur = Number(state.draft.lines[i].qty) || 0;
    const next = Math.max(0, Math.round((cur + delta) * 10000) / 10000);
    state.draft.lines[i].qty = next;
    markDraftDirty();
    renderKitLines();
    renderEditorSummary();
  }

  function renderKitLines() {
    const box = $("kitLines");
    const lines = state.draft?.lines || [];
    const idx = itemIndex();
    if (!lines.length) {
      box.innerHTML = `
        <div class="est-empty">
          No items in this kit yet.<br>
          Tap <strong>Add item</strong> above to pick from the rate book.
        </div>`;
      return;
    }

    const materials = [];
    const labour = [];
    lines.forEach((line, i) => {
      const item = idx.get(line.code) || {};
      const row = { line, i, item };
      if (lineType(line, item) === "labour") labour.push(row);
      else materials.push(row);
    });

    function renderGroup(title, className, rows) {
      if (!rows.length) {
        return `
          <div class="est-line-group">
            <div class="est-line-group-head ${className}">
              ${title}<span>0</span>
            </div>
            <div class="est-empty" style="padding:14px;">Nothing here yet</div>
          </div>`;
      }
      return `
        <div class="est-line-group">
          <div class="est-line-group-head ${className}">
            ${title}<span>${rows.length}</span>
          </div>
          ${rows
            .map(
              ({ line, i, item }) => `
            <div class="est-line" data-i="${i}">
              <div>
                <div class="est-line-name">${escapeHtml(item.description || line.description || line.code)}</div>
                <div class="est-line-meta">${escapeHtml(line.code)} · ${escapeHtml(item.unit || "")} · ${money(item.rate)}</div>
              </div>
              <div class="est-qty-wrap">
                <button type="button" class="est-qty-btn" data-dec="${i}" aria-label="Decrease">−</button>
                <input class="est-qty" type="number" min="0" step="any" value="${line.qty ?? 1}" data-qty="${i}">
                <button type="button" class="est-qty-btn" data-inc="${i}" aria-label="Increase">+</button>
              </div>
              <button type="button" class="est-btn est-btn-danger est-btn-sm" data-rm="${i}" title="Remove">×</button>
            </div>`
            )
            .join("")}
        </div>`;
    }

    box.innerHTML =
      renderGroup("Materials", "materials", materials) +
      renderGroup("Labour", "labour", labour);

    box.querySelectorAll("[data-qty]").forEach((input) => {
      input.addEventListener("change", () => {
        const i = Number(input.getAttribute("data-qty"));
        const v = Number(input.value);
        if (!Number.isFinite(v) || v < 0) return;
        state.draft.lines[i].qty = v;
        markDraftDirty();
        renderEditorSummary();
      });
    });
    box.querySelectorAll("[data-inc]").forEach((btn) => {
      btn.addEventListener("click", () => adjustQty(Number(btn.getAttribute("data-inc")), 1));
    });
    box.querySelectorAll("[data-dec]").forEach((btn) => {
      btn.addEventListener("click", () => adjustQty(Number(btn.getAttribute("data-dec")), -1));
    });
    box.querySelectorAll("[data-rm]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const i = Number(btn.getAttribute("data-rm"));
        const line = state.draft?.lines[i];
        if (!line) return;
        const item = itemIndex().get(line.code);
        const ok = await window.SlmDialog.confirm({
          title: "Remove item?",
          message: `Remove ${item?.description || line.code} from this kit?`,
          okLabel: "Remove",
          danger: true,
        });
        if (!ok) return;
        state.draft.lines.splice(i, 1);
        markDraftDirty();
        renderKitLines();
        renderEditorSummary();
      });
    });
  }

  function renderCatalog() {
    const q = ($("catalogSearch").value || "").trim().toLowerCase();
    const kit = state.activeKitId ? state.kitsById[state.activeKitId] : null;
    const allowedPoles = new Set(kit?.allowedPoleCodes || []);
    let items = allCatalogItems();

    if (state.catalogType === "poles") {
      if (allowedPoles.size) {
        items = items.filter((x) => allowedPoles.has(x.code));
      } else {
        // Fallback: descriptions that look like poles
        items = items.filter(
          (x) =>
            x.type === "material" &&
            /pole|rail pole|wide flange|tubular/i.test(x.description)
        );
      }
    } else if (state.catalogType === "material") {
      items = items.filter((x) => x.type === "material");
      // For 33kV structure kits, hide 8m PCC from general materials too when picking
      if (kit?.voltage === "33kV" && kit.family === "structure") {
        const excluded = new Set(
          state.matrix?.domainRules?.["33kV"]?.excludedPoleCodes || ["110030141"]
        );
        items = items.filter((x) => !excluded.has(x.code));
      }
    } else if (state.catalogType === "labour") {
      items = items.filter((x) => x.type === "labour");
    } else if (kit?.voltage === "33kV" && kit.family === "structure") {
      // "All" still hides excluded 8m PCC for 33kV structure kits
      const excluded = new Set(
        state.matrix?.domainRules?.["33kV"]?.excludedPoleCodes || ["110030141"]
      );
      items = items.filter((x) => !excluded.has(x.code));
    }

    if (q) {
      items = items.filter(
        (x) =>
          x.code.toLowerCase().includes(q) ||
          x.description.toLowerCase().includes(q)
      );
    }
    items = items.slice(0, 120);
    const list = $("catalogList");
    const poleHint =
      kit?.family === "structure" && kit.allowedPoleCodes?.length
        ? `<div class="est-empty" style="padding:8px 10px;text-align:left;">
            Pole for this kit: pick from <strong>Poles</strong> tab
            ${kit.voltage === "33kV" ? "(8m PCC not allowed)" : ""}
            ${kit.voltage === "LT" ? "(8m PCC only)" : ""}.
          </div>`
        : "";
    if (!items.length) {
      list.innerHTML = poleHint + `<div class="est-empty">No matches.</div>`;
      return;
    }
    list.innerHTML =
      poleHint +
      items
        .map(
          (item) => `
        <button type="button" class="est-cat-item" data-code="${escapeAttr(item.code)}">
          <div class="est-line-name">${escapeHtml(item.description)}</div>
          <div class="est-line-meta">${escapeHtml(item.code)} · ${escapeHtml(item.unit)} · ${money(item.rate)}</div>
          <strong class="add-hint">Tap to add</strong>
        </button>
      `
        )
        .join("");

    list.querySelectorAll("[data-code]").forEach((btn) => {
      btn.addEventListener("click", () => addCatalogItem(btn.getAttribute("data-code")));
    });
  }

  function addCatalogItem(code, { silent = false, bumpIfExists = true } = {}) {
    if (!state.draft) return false;
    const item = itemIndex().get(code);
    if (!item) return false;
    const existing = state.draft.lines.find((l) => l.code === code);
    if (existing) {
      if (bumpIfExists) existing.qty = Number(existing.qty || 0) + 1;
      else return false;
    } else {
      state.draft.lines.push({
        code: item.code,
        type: item.type,
        qty: 1,
      });
    }
    renderKitLines();
    renderEditorSummary();
    markDraftDirty();
    if (!silent) toast(`Added · ${item.description?.slice(0, 42) || item.code}`);
    return true;
  }

  async function saveKit() {
    if (!state.activeKitId || !state.draft) return;
    const kit = state.kitsById[state.activeKitId];
    const ok = await window.SlmDialog.confirm({
      title: "Save kit?",
      message: `Save changes to “${kitTitle(kit)}”?`,
      okLabel: "Save",
    });
    if (!ok) return;
    kit.enabled = $("kitEnabled").checked;
    kit.complete = !!$("kitFinal")?.checked;
    kit.notes = $("kitNotes").value || "";
    kit.lines = state.draft.lines.map((l) => ({
      code: l.code,
      type: l.type,
      qty: Number(l.qty) || 0,
    }));
    state.draft.enabled = kit.enabled;
    state.draft.complete = kit.complete;
    if (kit.complete && !kit.lines.length) {
      kit.complete = false;
      state.draft.complete = false;
      if ($("kitFinal")) $("kitFinal").checked = false;
      toast("Add items before marking Final");
      return;
    }
    saveEdits();
    state.draft._dirty = false;
    renderStats();
    renderEditorSummary();
    toast(kit.complete ? "Saved · Final" : "Saved · Draft");
    notifySoloParent("slm_kit_solo_saved", { complete: !!kit.complete });
  }

  function seedConductor() {
    const kit = state.kitsById[state.activeKitId];
    if (!kit?.seedMatCode || !state.draft) return;
    addCatalogItem(kit.seedMatCode);
    setEditorView("review");
  }

  function seedFittings() {
    const kit = state.kitsById[state.activeKitId];
    if (!kit?.seedFittingCodes?.length || !state.draft) return;
    let added = 0;
    for (const code of kit.seedFittingCodes) {
      if (addCatalogItem(code, { silent: true, bumpIfExists: false })) added += 1;
    }
    renderKitLines();
    renderEditorSummary();
    toast(
      added
        ? `Added ${added} suggested item(s)`
        : "Suggested items already in kit or missing from rate book"
    );
  }

  function openCopyModal() {
    const current = state.activeKitId;
    const cur = state.kitsById[current];
    const family = cur?.family;
    let options = Object.values(state.kitsById).filter(
      (k) => k.family === family && k.id !== current && (k.lines || []).length
    );
    // Prefer siblings: same voltage/structure/position/conductor, flip extension
    if (family === "structure" && cur) {
      options.sort((a, b) => {
        const score = (k) =>
          (k.voltage === cur.voltage ? 4 : 0) +
          (k.structure === cur.structure ? 4 : 0) +
          (k.location === cur.location || k.position === cur.position ? 4 : 0) +
          (k.arrangement === cur.arrangement ? 3 : 0) +
          (k.conductorId === cur.conductorId ? 4 : 0) +
          (k.wireCount === cur.wireCount ? 3 : 0) +
          ((k.arrangement !== cur.arrangement &&
            (k.location || k.position) === (cur.location || cur.position))
            ? 5
            : 0) +
          (k.extension !== cur.extension ? 2 : 0);
        return score(b) - score(a) || kitTitle(a).localeCompare(kitTitle(b));
      });
    } else {
      options.sort((a, b) => kitTitle(a).localeCompare(kitTitle(b)));
    }
    const sel = $("copySource");
    if (!options.length) {
      toast("No other kits with lines to copy");
      return;
    }
    sel.innerHTML = options
      .map((k) => `<option value="${escapeAttr(k.id)}">${escapeHtml(kitTitle(k))} (${k.lines.length})</option>`)
      .join("");
    $("copyModal").classList.remove("hidden");
  }

  function applyCopy() {
    const srcId = $("copySource").value;
    const src = state.kitsById[srcId];
    if (!src || !state.draft) return;
    state.draft.lines = (src.lines || []).map((l) => ({ ...l }));
    markDraftDirty();
    renderKitLines();
    $("copyModal").classList.add("hidden");
    toast("Lines copied — save when ready");
  }

  function renderRatebook() {
    const q = ($("rateSearch").value || "").trim().toLowerCase();
    const type = $("rateType").value;
    const all = allCatalogItems();
    const matN = all.filter((x) => x.type === "material").length;
    const labN = all.filter((x) => x.type === "labour").length;
    let items = all;
    if (type) items = items.filter((x) => x.type === type);
    if (q) {
      items = items.filter(
        (x) =>
          x.code.toLowerCase().includes(q) ||
          x.description.toLowerCase().includes(q)
      );
    }
    const list = $("rateList");
    const shown = Math.min(items.length, 400);
    list.innerHTML =
      `<div class="est-board-summary" style="border-bottom:1px solid var(--line);">
        <span>Showing <strong>${shown}</strong> of <strong>${items.length}</strong> matches</span>
        <span class="est-chip"><strong>${matN}</strong> materials</span>
        <span class="est-chip"><strong>${labN}</strong> labour</span>
        <span class="est-chip"><strong>${matN + labN}</strong> total in rate book</span>
      </div>` +
      `<div class="est-rate-row" style="font-weight:600;background:#f8fafc">
        <div>Code</div><div>Description</div><div>Unit</div><div>Rate</div><div>Type</div>
      </div>` +
      items
        .slice(0, 400)
        .map(
          (item) => `
        <div class="est-rate-row">
          <code>${escapeHtml(item.code)}</code>
          <div>${escapeHtml(item.description)}</div>
          <div>${escapeHtml(item.unit)}</div>
          <div>${money(item.rate)}</div>
          <div>${escapeHtml(item.type)}${item.origin ? " · " + escapeHtml(item.origin) : ""}</div>
        </div>
      `
        )
        .join("");
  }

  function showTab(tab) {
    state.tab = tab;
    document.querySelectorAll(".est-tab").forEach((el) => {
      el.classList.toggle("active", el.dataset.tab === tab);
    });
    $("editorPanel").classList.add("hidden");
    $("boardPanel").classList.add("hidden");
    $("ratebookPanel").classList.add("hidden");
    $("boqPanel")?.classList.add("hidden");
    $("schedulesPanel")?.classList.add("hidden");
    $("suggestionsPanel")?.classList.add("hidden");
    $("licensesPanel")?.classList.add("hidden");

    if (tab === "ratebook") {
      $("ratebookPanel").classList.remove("hidden");
      renderRatebook();
    } else if (tab === "boq") {
      $("boqPanel")?.classList.remove("hidden");
      syncLensControls();
      renderBoqPanel();
    } else if (tab === "suggestions") {
      $("suggestionsPanel")?.classList.remove("hidden");
      loadSuggestions();
    } else if (tab === "licenses") {
      $("licensesPanel")?.classList.remove("hidden");
      loadLicenses();
    } else {
      $("boardPanel").classList.remove("hidden");
      renderBoard();
    }
  }

  function setBoqSurvey(survey, sourceLabel) {
    if (!survey || !Array.isArray(survey.assets)) {
      toast("Invalid survey workspace (missing assets)");
      return;
    }
    state.boqSurvey = survey;
    state.boqReport = null;
    const meta = $("boqMeta");
    if (meta) {
      const title = survey.title || survey.surveyTitle || "Survey";
      const n = survey.assets.length;
      const prop = survey.assets.filter((a) => a.status === "Proposed").length;
      meta.textContent = `${title} · ${n} poles · ${prop} Proposed · ${sourceLabel || "loaded"}`;
    }
    $("btnBoqGenerate").disabled = false;
    $("btnBoqExport").disabled = true;
    $("btnBoqCopy").disabled = true;
    renderBoqPanel();
  }

  const BOQ_EXTRAS_KEY = "slm_estimate_boq_extras_v1";

  function loadBoqExtras() {
    try {
      const raw = localStorage.getItem(BOQ_EXTRAS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) return parsed;
      }
    } catch {
      /* ignore */
    }
    return window.SlmEstimateMatch
      ? window.SlmEstimateMatch.defaultExtras()
      : [
          { id: "cont_mat", label: "Contingency on Material", applyTo: "material", pct: 3 },
          { id: "cont_lab", label: "Contingency on Labour", applyTo: "labour", pct: 3 },
          { id: "gst", label: "GST", applyTo: "after_extras", pct: 18 },
          { id: "cess", label: "Labour Cess", applyTo: "after_gst", pct: 1 },
        ];
  }

  function saveBoqExtras() {
    try {
      localStorage.setItem(BOQ_EXTRAS_KEY, JSON.stringify(state.boqExtras || []));
    } catch {
      /* ignore */
    }
  }

  function refreshBoqAbstract() {
    const report = state.boqReport;
    if (!report || !window.SlmEstimateMatch) return;
    report.abstract = window.SlmEstimateMatch.computeAbstract(
      report.materialTotal || 0,
      report.labourTotal || 0,
      state.boqExtras
    );
    report.totalAmount = report.abstract.grandTotal;
    renderBoqPanel();
  }

  function generateBoq() {
    if (!state.boqSurvey) {
      toast("Import a survey workspace first");
      return;
    }
    if (!window.SlmEstimateMatch) {
      toast("Estimate matcher failed to load");
      return;
    }
    if (!state.boqExtras) state.boqExtras = loadBoqExtras();
    mergeKits();
    const kits = Object.values(state.kitsById);
    const SB = window.SlmScheduleBooks;
    const prefs = SB ? SB.loadPrefs() : { mode: "actual" };
    let report;

    if (prefs.mode === "contract") {
      const book = SB?.getBook(prefs.contractBookId);
      const bridge = SB?.getBridge(prefs.bridgeId);
      if (!book) {
        toast("Pick a contract schedule book (Schedules tab or lens dropdown)");
        return;
      }
      if (!bridge) {
        toast("Pick or create a Bridge pack for this contract");
        return;
      }
      report = window.SlmEstimateMatch.buildContractReport(
        state.boqSurvey,
        kits,
        book,
        bridge,
        state.boqExtras
      );
    } else {
      let ratebook = state.ratebook;
      if (SB && prefs.actualBookId) {
        const book = SB.getBook(prefs.actualBookId);
        if (book) {
          ratebook = SB.mergeRatebooks(state.ratebook, SB.bookAsRatebook(book));
        }
      }
      report = window.SlmEstimateMatch.buildReport(
        state.boqSurvey,
        kits,
        ratebook,
        state.boqExtras
      );
    }

    state.boqReport = report;
    $("btnBoqExport").disabled = false;
    $("btnBoqCopy").disabled = false;
    const countEl = $("tabCountBoq");
    const n =
      (report.materialSchedule?.length || 0) + (report.labourSchedule?.length || 0);
    if (countEl) countEl.textContent = String(n);
    renderBoqPanel();
    const bridgeN = report.bridgeGaps?.length || 0;
    toast(
      n
        ? `${prefs.mode === "contract" ? "Contract" : "Actual"}: ${
            report.materialSchedule.length
          } mat · ${report.labourSchedule.length} lab · ${report.gaps.length} gap(s)${
            bridgeN ? ` · ${bridgeN} unmapped` : ""
          }`
        : `No schedule lines — ${report.gaps.length} gap(s)`
    );
  }

  function fmtQty(q) {
    if (q == null || Number.isNaN(q)) return "—";
    return q === Math.floor(q) ? String(q) : Number(q).toFixed(3);
  }

  function renderScheduleTable(title, rows, total) {
    if (!rows?.length) {
      return `<h3 class="boq-section">${escapeHtml(title)}</h3>
        <div class="est-empty">No items</div>`;
    }
    const body = rows
      .map(
        (r) => `<tr>
        <td class="boq-num">${r.sl}</td>
        <td class="boq-code">${escapeHtml(r.code)}</td>
        <td class="boq-desc">${escapeHtml(r.description)}</td>
        <td>${escapeHtml(r.unit)}</td>
        <td class="boq-num">${escapeHtml(fmtQty(r.qty))}</td>
        <td class="boq-num">${escapeHtml(window.SlmEstimateMatch.moneyPlain(r.rate))}</td>
        <td class="boq-num">${escapeHtml(window.SlmEstimateMatch.moneyPlain(r.amount))}</td>
      </tr>`
      )
      .join("");
    return `<h3 class="boq-section">${escapeHtml(title)}</h3>
      <div class="boq-table-wrap">
        <table class="boq-table">
          <thead>
            <tr>
              <th>Sl.</th>
              <th>Code</th>
              <th>Description of item</th>
              <th>Unit</th>
              <th>Qty</th>
              <th>Rate (₹)</th>
              <th>Amount (₹)</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
          <tfoot>
            <tr>
              <td colspan="6" class="boq-total-label">Total</td>
              <td class="boq-num">${escapeHtml(
                window.SlmEstimateMatch.moneyPlain(total)
              )}</td>
            </tr>
          </tfoot>
        </table>
      </div>`;
  }

  function renderAbstractBlock(report) {
    if (!state.boqExtras) state.boqExtras = loadBoqExtras();
    const abs = report.abstract || {};
    const applyLabels = {
      material: "on Material",
      labour: "on Labour",
      both: "on Mat+Lab",
      after_extras: "after extras",
      after_gst: "after GST",
    };
    const extraRows = state.boqExtras
      .map((ex, i) => {
        return `<tr>
          <td>${escapeHtml(ex.label)}</td>
          <td class="boq-muted">${escapeHtml(applyLabels[ex.applyTo] || ex.applyTo)}</td>
          <td>
            <input type="number" class="boq-pct-input" data-extra-idx="${i}" min="0" max="100" step="0.1" value="${
              Number(ex.pct) || 0
            }" /> %
          </td>
        </tr>`;
      })
      .join("");

    const steps = (abs.steps || [])
      .map(
        (s) => `<tr class="${s.id === "subtotal" || s.id === "mat" || s.id === "lab" ? "boq-abs-key" : ""}">
          <td colspan="2">${escapeHtml(s.label)}</td>
          <td class="boq-num">${escapeHtml(
            window.SlmEstimateMatch.moneyPlain(s.amount)
          )}</td>
        </tr>`
      )
      .join("");

    return `<h3 class="boq-section">Abstract / Summary</h3>
      <div class="boq-abstract-grid">
        <div class="boq-extras-card">
          <div class="boq-extras-title">Editable extras (%)</div>
          <table class="boq-table boq-extras-table">
            <thead><tr><th>Item</th><th>Applies</th><th>%</th></tr></thead>
            <tbody>${extraRows}</tbody>
          </table>
          <p class="boq-hint">Change % and totals update (saved in this browser).</p>
        </div>
        <div class="boq-abs-card">
          <table class="boq-table">
            <tbody>
              ${steps}
              <tr class="boq-grand">
                <td colspan="2"><strong>Grand Total (say)</strong></td>
                <td class="boq-num"><strong>${escapeHtml(
                  window.SlmEstimateMatch.moneyPlain(
                    abs.grandTotalRounded ?? abs.grandTotal
                  )
                )}</strong></td>
              </tr>
            </tbody>
          </table>
          <p class="boq-words"><strong>Amount in words:</strong> ${escapeHtml(
            abs.amountInWords || ""
          )}</p>
        </div>
      </div>`;
  }

  function renderBoqPanel() {
    const summary = $("boqSummary");
    const list = $("boqList");
    if (!summary || !list) return;
    const report = state.boqReport;
    if (!state.boqSurvey) {
      summary.innerHTML = "";
      list.innerHTML = `<div class="est-empty">Import a phone workspace JSON, or open <strong>Generate estimate</strong> from CAD with a loaded survey.</div>`;
      return;
    }
    if (!report) {
      summary.innerHTML = `<span class="est-chip">Survey ready</span> <span class="muted">Click <strong>Generate BOQ</strong> for WB-style Mat / Lab schedules.</span>`;
      list.innerHTML = "";
      return;
    }
    const M = window.SlmEstimateMatch;
    const lensLabel =
      report.lens === "contract"
        ? `Contract${report.scheduleBookName ? " · " + escapeHtml(report.scheduleBookName) : ""}`
        : "Actual requirements";
    summary.innerHTML = `
      <span class="est-chip">${lensLabel}</span>
      <span class="est-chip"><strong>${report.proposedPoles}</strong> Proposed</span>
      <span class="est-chip"><strong>${report.matchedStructures}</strong> structures</span>
      <span class="est-chip"><strong>${(report.matchedConductorKm || 0).toFixed(3)}</strong> km conductor</span>
      <span class="est-chip"><strong>${M.money(report.materialTotal)}</strong> Mat</span>
      <span class="est-chip"><strong>${M.money(report.labourTotal)}</strong> Lab</span>
      <span class="est-chip complete"><strong>${M.money(
        report.abstract?.grandTotalRounded ?? report.totalAmount
      )}</strong> Grand</span>
    `;

    let html = "";
    html += renderScheduleTable(
      "Schedule of Materials",
      report.materialSchedule,
      report.materialTotal
    );
    html += renderScheduleTable(
      "Schedule of Labour",
      report.labourSchedule,
      report.labourTotal
    );
    html += renderAbstractBlock(report);

    if (report.gaps?.length) {
      html += `<h3 class="boq-section boq-section-gap">Gaps</h3>`;
      html += report.gaps
        .map(
          (row) => `<div class="boq-row boq-row-gap">
            <div class="boq-kind">gap</div>
            <div class="boq-row-main">
              <div class="boq-row-title">${escapeHtml(row.title)}</div>
              ${row.detail ? `<div class="boq-row-detail">${escapeHtml(row.detail)}</div>` : ""}
            </div>
          </div>`
        )
        .join("");
    }
    list.innerHTML = html;

    list.querySelectorAll("[data-extra-idx]").forEach((input) => {
      input.addEventListener("change", () => {
        const i = Number(input.getAttribute("data-extra-idx"));
        if (!state.boqExtras?.[i]) return;
        state.boqExtras[i].pct = Number(input.value) || 0;
        saveBoqExtras();
        refreshBoqAbstract();
      });
      input.addEventListener("input", () => {
        const i = Number(input.getAttribute("data-extra-idx"));
        if (!state.boqExtras?.[i]) return;
        state.boqExtras[i].pct = Number(input.value) || 0;
        saveBoqExtras();
        refreshBoqAbstract();
      });
    });
  }

  function exportBoq() {
    const report = state.boqReport;
    if (!report || !window.SlmEstimateMatch) return;
    const text = window.SlmEstimateMatch.reportAsText(report);
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const slug = String(report.title || "survey").replace(/[^\w\-]+/g, "_");
    a.download = `slm-boq_${slug}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast("BOQ exported");
  }

  async function copyBoq() {
    const report = state.boqReport;
    if (!report || !window.SlmEstimateMatch) return;
    const text = window.SlmEstimateMatch.reportAsText(report);
    try {
      await navigator.clipboard.writeText(text);
      toast("BOQ copied");
    } catch {
      toast("Could not copy — use Export instead");
    }
  }

  function tryLoadBoqFromSession() {
    try {
      const raw = sessionStorage.getItem("slm_estimate_workspace_v1");
      if (!raw) return false;
      const survey = JSON.parse(raw);
      setBoqSurvey(survey, "CAD session");
      sessionStorage.removeItem("slm_estimate_workspace_v1");
      return true;
    } catch {
      return false;
    }
  }

  function wireBoqUi() {
    $("btnBoqImport")?.addEventListener("click", () => $("boqImportFile")?.click());
    $("boqImportFile")?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const text = String(reader.result || "");
          const opened = window.SlmSeal
            ? await window.SlmSeal.openTransferText(text, window.SlmSeal.KIND_MAP)
            : { payload: JSON.parse(text) };
          setBoqSurvey(opened.payload, file.name);
        } catch (err) {
          toast("Import failed: " + (err.message || err));
        }
      };
      reader.readAsText(file);
    });
    $("btnBoqLoadDemo")?.addEventListener("click", async () => {
      try {
        const res = await fetch("../demo/sample_workspace_33_11_lt.json");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setBoqSurvey(data, "demo survey");
        toast("Demo survey loaded");
      } catch (err) {
        toast(
          "Demo load failed — serve sld_editor over HTTP. " +
            (err.message || err)
        );
      }
    });
    $("btnBoqDemoContract")?.addEventListener("click", () => loadDemoContractFlow());
    $("btnBoqFromCad")?.addEventListener("click", () => {
      if (tryLoadBoqFromSession()) {
        toast("Loaded survey from CAD session");
        return;
      }
      toast("No CAD session found — use Generate estimate from CAD, or Import JSON");
    });
    $("btnBoqGenerate")?.addEventListener("click", () => generateBoq());
    $("btnBoqExport")?.addEventListener("click", () => exportBoq());
    $("btnBoqCopy")?.addEventListener("click", () => copyBoq());
    wireLensUi();
  }

  /* ── Contract Lens / local schedules ── */

  function syncLensControls() {
    const SB = window.SlmScheduleBooks;
    if (!SB) return;
    const prefs = SB.loadPrefs();
    document.querySelectorAll(".lens-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.lens === prefs.mode);
    });
    const books = SB.listBooks();
    const bridges = SB.listBridges();
    const fill = (sel, opts, emptyLabel) => {
      if (!sel) return;
      const cur = sel.value;
      sel.innerHTML =
        `<option value="">${emptyLabel}</option>` +
        opts
          .map(
            (o) =>
              `<option value="${escapeHtml(o.id)}">${escapeHtml(o.label)}</option>`
          )
          .join("");
      if (opts.some((o) => o.id === cur)) sel.value = cur;
    };
    fill(
      $("lensActualBook"),
      books.map((b) => ({
        id: b.id,
        label: `${b.name} · ${b.kind || "book"} (${b.itemCount || b.items?.length || 0})`,
      })),
      "App ratebook only"
    );
    fill(
      $("lensContractBook"),
      books.map((b) => ({
        id: b.id,
        label: `${b.name} (${b.itemCount || b.items?.length || 0})`,
      })),
      "Select contract schedule…"
    );
    fill(
      $("lensBridge"),
      bridges.map((b) => ({ id: b.id, label: b.name })),
      "Select bridge pack…"
    );
    if (prefs.actualBookId) $("lensActualBook").value = prefs.actualBookId;
    if (prefs.contractBookId) $("lensContractBook").value = prefs.contractBookId;
    if (prefs.bridgeId) $("lensBridge").value = prefs.bridgeId;
    const contractMode = prefs.mode === "contract";
    $("lensActualBookWrap")?.classList.toggle("hidden", contractMode);
    $("lensContractBookWrap")?.classList.toggle("hidden", !contractMode);
    $("lensBridgeWrap")?.classList.toggle("hidden", !contractMode);
  }

  function setLensMode(mode) {
    const SB = window.SlmScheduleBooks;
    if (!SB) return;
    const prefs = SB.loadPrefs();
    prefs.mode = mode === "contract" ? "contract" : "actual";
    SB.savePrefs(prefs);
    syncLensControls();
    state.boqReport = null;
    renderBoqPanel();
  }

  function kitsFromHits(survey) {
    mergeKits();
    const kits = Object.values(state.kitsById);
    if (!survey || !window.SlmEstimateMatch?.collectKitHits) return kits;
    const hits = window.SlmEstimateMatch.collectKitHits(survey, kits);
    const out = [];
    for (const { kit } of hits.structureQty.values()) out.push(kit);
    for (const { kit } of hits.conductorHits) out.push(kit);
    return out;
  }

  async function fetchDemoContractPayload() {
    const res = await fetch("./demo_contract_schedule.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function installDemoContractForSurvey(survey) {
    const SB = window.SlmScheduleBooks;
    if (!SB) throw new Error("Schedule module missing");
    const payload = await fetchDemoContractPayload();
    const kits = kitsFromHits(survey);
    return SB.installDemoContract(payload, kits);
  }

  /** One-click: demo survey + demo contract + auto-bridge + generate. */
  async function loadDemoContractFlow() {
    try {
      const res = await fetch("../demo/sample_workspace_33_11_lt.json");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const survey = await res.json();
      setBoqSurvey(survey, "demo survey");
      const { book, mappedCount } = await installDemoContractForSurvey(survey);
      state.activeBridgeId = "demo_bridge_v1";
      syncLensControls();
      setLensMode("contract");
      generateBoq();
      toast(
        `Demo contract “${book.name}”: ${mappedCount} kits mapped · Contract BOQ ready`
      );
    } catch (err) {
      toast(
        "Demo contract failed — serve sld_editor over HTTP. " +
          (err.message || err)
      );
    }
  }

  function wireLensUi() {
    $("btnLensActual")?.addEventListener("click", () => setLensMode("actual"));
    $("btnLensContract")?.addEventListener("click", () => setLensMode("contract"));
    $("lensActualBook")?.addEventListener("change", () => {
      const SB = window.SlmScheduleBooks;
      if (!SB) return;
      const prefs = SB.loadPrefs();
      prefs.actualBookId = $("lensActualBook").value;
      SB.savePrefs(prefs);
    });
    $("lensContractBook")?.addEventListener("change", () => {
      const SB = window.SlmScheduleBooks;
      if (!SB) return;
      const prefs = SB.loadPrefs();
      prefs.contractBookId = $("lensContractBook").value;
      SB.savePrefs(prefs);
    });
    $("lensBridge")?.addEventListener("change", () => {
      const SB = window.SlmScheduleBooks;
      if (!SB) return;
      const prefs = SB.loadPrefs();
      prefs.bridgeId = $("lensBridge").value;
      SB.savePrefs(prefs);
    });
  }

  function canUseSuggestionsUi() {
    const L = window.SlmLicense;
    if (!L || !L.enabled) return false;
    return !!(L.canSuggest() || L.canApprove());
  }

  function updateSuggestionsTabVisibility() {
    const tab = $("tabSuggestions");
    if (!tab) return;
    const show = canUseSuggestionsUi();
    tab.classList.toggle("hidden", !show);
    if (!show && state.tab === "suggestions") showTab("structure");
    $("tabCountSuggestions").textContent = String(state.pendingSuggestionCount || 0);
  }

  function canUseLicensesUi() {
    const L = window.SlmLicense;
    if (!L || !L.enabled) return false;
    return !!L.canApprove();
  }

  function updateLicensesTabVisibility() {
    const tab = $("tabLicenses");
    if (!tab) return;
    const show = canUseLicensesUi();
    tab.classList.toggle("hidden", !show);
    if (!show && state.tab === "licenses") showTab("structure");
    $("tabCountLicenses").textContent = String((state.licenses || []).length);
  }

  function formatExpiry(iso) {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return String(iso);
      return d.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch (_) {
      return String(iso);
    }
  }

  function filteredLicenses() {
    const q = (($("licSearch")?.value || "") + "").trim().toLowerCase();
    const status = ($("licStatusFilter")?.value || "").trim();
    return (state.licenses || []).filter((row) => {
      if (status && String(row.status || "") !== status) return false;
      if (!q) return true;
      const hay = `${row.code || ""} ${row.customer_name || ""} ${row.customer_phone || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }

  function renderLicenses() {
    const wrap = $("licTableWrap");
    if (!wrap) return;
    const rows = filteredLicenses();
    $("tabCountLicenses").textContent = String((state.licenses || []).length);
    if (!rows.length) {
      wrap.innerHTML = `<div class="est-empty">${
        (state.licenses || []).length ? "No licenses match this filter." : "No licenses yet."
      }</div>`;
      return;
    }
    wrap.innerHTML = `
      <table class="lic-table">
        <thead>
          <tr>
            <th>Code</th>
            <th>Customer</th>
            <th>Status</th>
            <th>Expires</th>
            <th>Devices</th>
            <th>Flags</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map((r) => {
              const flags = [
                r.can_suggest ? "suggest" : null,
                r.can_approve ? "approve" : null,
              ]
                .filter(Boolean)
                .join(" · ") || "—";
              const st = escapeHtml(r.status || "");
              return `
            <tr data-lic-id="${escapeHtml(r.id)}">
              <td><code>${escapeHtml(r.code || "")}</code></td>
              <td>
                <div>${escapeHtml(r.customer_name || "—")}</div>
                <div class="lic-muted">${escapeHtml(r.customer_phone || "")}</div>
              </td>
              <td><span class="est-chip ${st}">${st}</span></td>
              <td>${escapeHtml(formatExpiry(r.expires_at))}</td>
              <td>${Number(r.activation_count) || 0} / ${Number(r.max_devices) || 1}</td>
              <td class="lic-muted">${escapeHtml(flags)}</td>
              <td class="lic-actions">
                <button type="button" class="est-btn est-btn-ghost est-btn-sm" data-lic-edit="${escapeHtml(r.id)}">Edit</button>
                <button type="button" class="est-btn est-btn-ghost est-btn-sm" data-lic-extend="${escapeHtml(r.id)}">+30d</button>
                ${
                  r.status === "blocked"
                    ? `<button type="button" class="est-btn est-btn-ghost est-btn-sm" data-lic-unblock="${escapeHtml(r.id)}">Unblock</button>`
                    : `<button type="button" class="est-btn est-btn-ghost est-btn-sm" data-lic-block="${escapeHtml(r.id)}">Block</button>`
                }
              </td>
            </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    `;
    wrap.querySelectorAll("[data-lic-edit]").forEach((btn) => {
      btn.addEventListener("click", () => openLicenseModal(btn.getAttribute("data-lic-edit")));
    });
    wrap.querySelectorAll("[data-lic-extend]").forEach((btn) => {
      btn.addEventListener("click", () => extendLicense(btn.getAttribute("data-lic-extend"), 30));
    });
    wrap.querySelectorAll("[data-lic-block]").forEach((btn) => {
      btn.addEventListener("click", () => setLicenseStatus(btn.getAttribute("data-lic-block"), "blocked"));
    });
    wrap.querySelectorAll("[data-lic-unblock]").forEach((btn) => {
      btn.addEventListener("click", () => setLicenseStatus(btn.getAttribute("data-lic-unblock"), "active"));
    });
  }

  async function loadLicenses() {
    const wrap = $("licTableWrap");
    if (!canUseLicensesUi()) {
      if (wrap) wrap.innerHTML = `<div class="est-empty">Admin license required (can_approve). Activate SLM-ADMIN-001.</div>`;
      return;
    }
    if (wrap) wrap.innerHTML = `<div class="est-empty">Loading…</div>`;
    try {
      let json = await catalogPost("/functions/v1/license-admin", { action: "list" });

      // Stale local unlock after activation wipe / new browser id — re-activate once.
      if (!json.ok && (json.error === "not_activated" || json.error === "not_allowed")) {
        const code = (window.SlmLicense.readPrefs?.().licenseCode || "").trim();
        if (code && window.SlmLicense.activate) {
          const again = await window.SlmLicense.activate(code);
          if (again.ok) {
            updatePermissionUi();
            json = await catalogPost("/functions/v1/license-admin", { action: "list" });
          }
        }
      }

      if (!json.ok) {
        const err = json.error || "unknown";
        const detail = json.detail ? ` — ${json.detail}` : "";
        let hint = "";
        if (err === "not_activated") {
          hint = " Sign out and activate SLM-ADMIN-001 again.";
        } else if (err === "not_allowed") {
          hint = " This code has no can_approve — use SLM-ADMIN-001.";
        } else if (err === "functions_missing") {
          hint = " license-admin Edge Function missing on this project.";
        }
        toast(`Licenses failed: ${err}`);
        if (wrap) {
          wrap.innerHTML = `<div class="est-empty">Could not load licenses (${escapeHtml(
            err
          )}${escapeHtml(detail)}).${escapeHtml(hint)}</div>`;
        }
        return;
      }
      state.licenses = json.licenses || [];
      renderLicenses();
    } catch (err) {
      console.error(err);
      toast("Licenses failed (network)");
      if (wrap) wrap.innerHTML = `<div class="est-empty">Network error loading licenses. Is localhost running?</div>`;
    }
  }

  function openLicenseModal(id) {
    const modal = $("licenseModal");
    if (!modal) return;
    const row = id ? (state.licenses || []).find((x) => x.id === id) : null;
    $("licEditId").value = row?.id || "";
    $("licenseModalTitle").textContent = row ? "Edit license" : "New license";
    $("licenseModalSub").textContent = row
      ? "Update customer, devices, flags, or reset expiry from today."
      : "Create a rental code for a customer.";
    $("licCode").value = row?.code || "";
    $("licCode").disabled = !!row;
    $("licCustomer").value = row?.customer_name || "";
    $("licPhone").value = row?.customer_phone || "";
    $("licDays").value = row ? "" : "30";
    $("licMaxDevices").value = String(row?.max_devices || 1);
    $("licCanSuggest").checked = !!row?.can_suggest;
    $("licCanApprove").checked = !!row?.can_approve;
    $("licNotes").value = row?.notes || "";
    modal.classList.remove("hidden");
  }

  function closeLicenseModal() {
    $("licenseModal")?.classList.add("hidden");
  }

  async function saveLicenseModal() {
    const id = ($("licEditId")?.value || "").trim();
    const code = (($("licCode")?.value || "") + "").replace(/\s+/g, "").toUpperCase();
    const daysRaw = ($("licDays")?.value || "").trim();
    const days = daysRaw === "" ? null : Math.max(1, Math.min(Number(daysRaw) || 30, 730));
    const max_devices = Math.max(1, Math.min(Number($("licMaxDevices")?.value) || 1, 5));
    const payload = {
      customer_name: ($("licCustomer")?.value || "").trim(),
      customer_phone: ($("licPhone")?.value || "").trim(),
      max_devices,
      can_suggest: !!$("licCanSuggest")?.checked,
      can_approve: !!$("licCanApprove")?.checked,
      notes: ($("licNotes")?.value || "").trim(),
    };
    const btn = $("btnLicModalSave");
    if (btn) btn.disabled = true;
    try {
      let json;
      if (id) {
        const body = { action: "update", id, ...payload };
        if (days != null) body.set_days = days;
        json = await catalogPost("/functions/v1/license-admin", body);
      } else {
        if (!code || code.length < 4) {
          toast("Enter a license code (min 4 chars)");
          return;
        }
        json = await catalogPost("/functions/v1/license-admin", {
          action: "create",
          code,
          days: days != null ? days : 30,
          ...payload,
        });
      }
      if (!json.ok) {
        toast(`Save failed: ${json.error || "unknown"}`);
        return;
      }
      toast(id ? "License updated" : "License created");
      closeLicenseModal();
      await loadLicenses();
    } catch (err) {
      console.error(err);
      toast("Save failed (network)");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function extendLicense(id, days) {
    const row = (state.licenses || []).find((x) => x.id === id);
    if (!row) return;
    const ok = await window.SlmDialog.confirm({
      title: "Extend license",
      message: `Add ${days} days to ${row.code}?`,
      okLabel: "Extend",
    });
    if (!ok) return;
    try {
      const json = await catalogPost("/functions/v1/license-admin", {
        action: "update",
        id,
        extend_days: days,
      });
      if (!json.ok) {
        toast(`Extend failed: ${json.error || "unknown"}`);
        return;
      }
      toast("Extended +30 days");
      await loadLicenses();
    } catch (err) {
      console.error(err);
      toast("Extend failed (network)");
    }
  }

  async function setLicenseStatus(id, status) {
    const row = (state.licenses || []).find((x) => x.id === id);
    if (!row) return;
    const ok = await window.SlmDialog.confirm({
      title: status === "blocked" ? "Block license" : "Unblock license",
      message:
        status === "blocked"
          ? `Block ${row.code}? Devices will stop validating.`
          : `Set ${row.code} back to active?`,
      okLabel: status === "blocked" ? "Block" : "Unblock",
    });
    if (!ok) return;
    try {
      const json = await catalogPost("/functions/v1/license-admin", {
        action: "update",
        id,
        status,
      });
      if (!json.ok) {
        toast(`Update failed: ${json.error || "unknown"}`);
        return;
      }
      toast(status === "blocked" ? "Blocked" : "Unblocked");
      await loadLicenses();
    } catch (err) {
      console.error(err);
      toast("Update failed (network)");
    }
  }

  async function catalogPost(path, body) {
    const L = window.SlmLicense;
    if (!L || !L.enabled) throw new Error("licensing_disabled");
    const json = await L.post(path, {
      device_id: L.deviceId(),
      ...body,
    });
    return json;
  }

  async function submitSuggestion() {
    if (!window.SlmLicense?.canSuggest()) {
      toast("Your license cannot suggest edits");
      return;
    }
    const kit = state.kitsById[state.activeKitId];
    if (!kit || !state.draft) {
      toast("Open a kit first");
      return;
    }
    // Prefer draft (unsaved) so user can suggest without local Save.
    // Suggestions never set Final — only you mark Final after Accept.
    const proposed = {
      enabled: $("kitEnabled")?.checked ?? !!state.draft.enabled,
      complete: false,
      notes: ($("kitNotes")?.value || state.draft.notes || "").trim(),
      lines: (state.draft.lines || []).map((l) => ({
        code: l.code,
        qty: Number(l.qty) || 0,
        type: l.type || undefined,
      })),
    };
    if (!proposed.lines.length) {
      toast("Add at least one line before suggesting");
      return;
    }
    const messageRaw = await window.SlmDialog.prompt({
      title: "Suggest this kit change",
      message: "Optional message for the reviewer.",
      inputLabel: "Message",
      placeholder: "Why this change…",
      okLabel: "Send suggestion",
    });
    if (messageRaw === null) {
      toast("Suggest cancelled");
      return;
    }
    const message = String(messageRaw || "").trim();
    const btn = $("btnSuggestKit");
    if (btn) btn.disabled = true;
    try {
      const json = await catalogPost("/functions/v1/catalog-suggest", {
        kit_id: kit.id,
        kit_family: kit.family,
        kit_label: kitTitle(kit),
        base_version_label: String(state.matrix?.seedVersion ?? state.matrix?.version ?? ""),
        proposed,
        message,
      });
      if (!json.ok) {
        toast(`Suggest failed: ${json.error || "unknown"}`);
        return;
      }
      toast("Suggestion sent for review");
      refreshPendingBadge();
    } catch (err) {
      console.error(err);
      toast("Suggest failed (network)");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function refreshPendingBadge() {
    if (!window.SlmLicense?.canApprove() && !window.SlmLicense?.canSuggest()) return;
    try {
      const json = await catalogPost("/functions/v1/catalog-suggestions-list", {
        status: "pending",
      });
      if (json.ok) {
        state.pendingSuggestionCount = json.pending_count ?? (json.suggestions || []).length;
        updateSuggestionsTabVisibility();
      }
    } catch (_) {
      /* ignore */
    }
  }

  async function loadSuggestions() {
    const list = $("sugList");
    const detail = $("sugDetail");
    if (!list) return;
    if (!canUseSuggestionsUi()) {
      list.innerHTML = `<div class="est-empty">Suggestions require can_suggest or can_approve on your license.</div>`;
      return;
    }
    list.innerHTML = `<div class="est-empty">Loading…</div>`;
    if (detail) {
      detail.innerHTML = `<p class="ed-help">Select a suggestion to compare with the current kit.</p>`;
    }
    const status = $("sugStatusFilter")?.value ?? "pending";
    try {
      const json = await catalogPost("/functions/v1/catalog-suggestions-list", {
        status: status || undefined,
      });
      if (!json.ok) {
        list.innerHTML = `<div class="est-empty">Failed: ${escapeHtml(json.error || "unknown")}</div>`;
        return;
      }
      state.suggestions = json.suggestions || [];
      state.pendingSuggestionCount = json.pending_count ?? 0;
      updateSuggestionsTabVisibility();
      renderSuggestionList();
      if (state.selectedSuggestionId) {
        const still = state.suggestions.find((s) => s.id === state.selectedSuggestionId);
        if (still) renderSuggestionDetail(still);
        else state.selectedSuggestionId = null;
      }
    } catch (err) {
      console.error(err);
      list.innerHTML = `<div class="est-empty">Network error loading suggestions.</div>`;
    }
  }

  function renderSuggestionList() {
    const list = $("sugList");
    if (!list) return;
    const rows = state.suggestions;
    if (!rows.length) {
      list.innerHTML = `<div class="est-empty">No suggestions in this filter.</div>`;
      return;
    }
    const canApprove = !!(window.SlmLicense && window.SlmLicense.canApprove());
    list.innerHTML = rows
      .map((s) => {
        const active = s.id === state.selectedSuggestionId ? " active" : "";
        const lines = Array.isArray(s.proposed?.lines) ? s.proposed.lines.length : 0;
        return `
        <button type="button" class="sug-row${active}" data-sug-id="${escapeAttr(s.id)}">
          <div class="sug-row-top">
            <strong>${escapeHtml(s.kit_label || s.kit_id)}</strong>
            <span class="est-chip ${s.status}">${escapeHtml(s.status)}</span>
          </div>
          <div class="sug-row-meta">
            ${escapeHtml(s.submitter_code || "—")} · ${lines} lines
            ${s.message ? " · " + escapeHtml(s.message.slice(0, 80)) : ""}
          </div>
          ${canApprove && s.status === "pending" ? "" : ""}
        </button>`;
      })
      .join("");
    list.querySelectorAll("[data-sug-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-sug-id");
        const s = state.suggestions.find((x) => x.id === id);
        if (!s) return;
        state.selectedSuggestionId = id;
        renderSuggestionList();
        renderSuggestionDetail(s);
      });
    });
  }

  function linesDiffHtml(currentLines, proposedLines) {
    const curMap = new Map((currentLines || []).map((l) => [l.code, Number(l.qty) || 0]));
    const propMap = new Map((proposedLines || []).map((l) => [l.code, Number(l.qty) || 0]));
    const codes = new Set([...curMap.keys(), ...propMap.keys()]);
    const idx = itemIndex();
    const rows = [];
    for (const code of [...codes].sort()) {
      const a = curMap.has(code) ? curMap.get(code) : null;
      const b = propMap.has(code) ? propMap.get(code) : null;
      let tone = "";
      if (a == null) tone = "added";
      else if (b == null) tone = "removed";
      else if (a !== b) tone = "changed";
      const desc = idx.get(code)?.description || "";
      rows.push(`
        <div class="sug-diff-row ${tone}">
          <code>${escapeHtml(code)}</code>
          <span>${escapeHtml(desc)}</span>
          <span>${a == null ? "—" : a}</span>
          <span>${b == null ? "—" : b}</span>
        </div>`);
    }
    if (!rows.length) return `<div class="est-empty">No lines</div>`;
    return `
      <div class="sug-diff-head">
        <span>Code</span><span>Description</span><span>Current</span><span>Proposed</span>
      </div>
      ${rows.join("")}`;
  }

  function renderSuggestionDetail(s) {
    const detail = $("sugDetail");
    if (!detail || !s) return;
    const kit = state.kitsById[s.kit_id];
    const currentLines = kit?.lines || [];
    const proposed = s.proposed || {};
    const canApprove =
      !!(window.SlmLicense && window.SlmLicense.canApprove()) && s.status === "pending";
    detail.innerHTML = `
      <div class="sug-detail-head">
        <div>
          <h3>${escapeHtml(s.kit_label || s.kit_id)}</h3>
          <p class="ed-help">
            From <strong>${escapeHtml(s.submitter_code || "—")}</strong>
            · ${escapeHtml(s.status)}
            · kit <code>${escapeHtml(s.kit_id)}</code>
            ${!kit ? " · <em>kit not in local matrix</em>" : ""}
          </p>
          ${s.message ? `<p class="sug-message">${escapeHtml(s.message)}</p>` : ""}
          ${s.review_note ? `<p class="sug-message">Review note: ${escapeHtml(s.review_note)}</p>` : ""}
        </div>
        ${
          canApprove
            ? `<div class="sug-detail-actions">
                <button type="button" class="est-btn est-btn-ghost" id="btnRejectSug">Reject</button>
                <button type="button" class="est-btn est-btn-primary" id="btnAcceptSug">Accept into maker</button>
              </div>`
            : ""
        }
      </div>
      <div class="sug-diff">${linesDiffHtml(currentLines, proposed.lines || [])}</div>
    `;
    $("btnAcceptSug")?.addEventListener("click", () => reviewSuggestion(s.id, "accept"));
    $("btnRejectSug")?.addEventListener("click", () => reviewSuggestion(s.id, "reject"));
  }

  function applyProposedToKit(kitId, proposed) {
    const kit = state.kitsById[kitId];
    if (!kit || !proposed) return false;
    kit.enabled = proposed.enabled !== false;
    // Accepted suggestion → Draft until you tick Final yourself.
    kit.complete = false;
    kit.notes = String(proposed.notes || "");
    kit.lines = Array.isArray(proposed.lines)
      ? proposed.lines.map((l) => ({
          code: l.code,
          qty: Number(l.qty) || 0,
          type: l.type,
        }))
      : [];
    saveEdits();
    return true;
  }

  async function reviewSuggestion(id, action) {
    if (!window.SlmLicense?.canApprove()) {
      toast("Your license cannot approve");
      return;
    }
    let review_note = "";
    if (action === "reject") {
      const note = await window.SlmDialog.prompt({
        title: "Reject suggestion",
        message: "Optional note for the suggestor.",
        inputLabel: "Review note",
        placeholder: "Reason for rejection…",
        okLabel: "Reject",
      });
      if (note === null) return;
      review_note = String(note || "").trim();
    } else {
      const ok = await window.SlmDialog.confirm({
        title: "Accept into maker?",
        message:
          "Merge this suggestion into your local kit edits. Phones update only after Publish to app.",
        okLabel: "Accept & merge",
      });
      if (!ok) return;
    }
    try {
      const json = await catalogPost("/functions/v1/catalog-suggestion-review", {
        suggestion_id: id,
        action,
        review_note,
      });
      if (!json.ok) {
        toast(`Review failed: ${json.error || "unknown"}`);
        return;
      }
      if (action === "accept") {
        const ok = applyProposedToKit(json.kit_id, json.proposed);
        toast(ok ? "Merged as Draft — tick Final when you’re happy" : "Accepted (kit missing locally)");
        renderStats();
      } else {
        toast("Suggestion rejected");
      }
      state.selectedSuggestionId = null;
      await loadSuggestions();
    } catch (err) {
      console.error(err);
      toast("Review failed (network)");
    }
  }

  function exportKits() {
    const payload = {
      exportedAt: new Date().toISOString(),
      kits: loadEdits(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "slm-estimate-kits.json";
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Kits exported");
  }

  function importKits(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const kits = data.kits || data;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(kits));
        mergeKits();
        renderStats();
        showTab(state.tab);
        toast("Kits imported");
      } catch {
        toast("Invalid kits file");
      }
    };
    reader.readAsText(file);
  }

  async function resetKits() {
    const ok = await window.SlmDialog.confirm({
      title: "Reset kit edits?",
      message:
        "Clear all kit edits on this computer? The rate book stays. Online catalog is not changed.",
      okLabel: "Reset edits",
      danger: true,
    });
    if (!ok) return;
    localStorage.removeItem(STORAGE_KEY);
    mergeKits();
    renderStats();
    showTab(state.tab);
    toast("Kit edits cleared");
  }

  async function publishKey() {
    const cfg = window.SLM_LICENSE_CONFIG || {};
    let key = (cfg.CATALOG_PUBLISH_KEY || "").trim();
    if (!key) {
      key = (sessionStorage.getItem("slm_catalog_publish_key") || "").trim();
    }
    if (!key) {
      const entered = await window.SlmDialog.prompt({
        title: "Publish key",
        message: "Enter the Supabase secret CATALOG_PUBLISH_KEY.",
        inputLabel: "Publish key",
        inputType: "password",
        placeholder: "Secret key…",
        okLabel: "Continue",
      });
      if (entered === null) return "";
      key = String(entered || "").trim();
      if (key) sessionStorage.setItem("slm_catalog_publish_key", key);
    }
    return key;
  }

  async function publishCatalog() {
    if (window.SlmLicense?.enabled && !window.SlmLicense.canApprove()) {
      toast("Publish needs admin (can_approve) on your license");
      return;
    }
    const cfg = window.SLM_LICENSE_CONFIG || {};
    const base = (cfg.SUPABASE_URL || "").replace(/\/$/, "");
    const anon = cfg.SUPABASE_ANON_KEY || "";
    if (!base || !anon) {
      await window.SlmDialog.alert({
        title: "Missing config",
        message: "Supabase URL / anon key missing in license-config.js",
      });
      return;
    }
    if (!state.ratebook || !state.matrix) {
      toast("Catalog not loaded yet");
      return;
    }
    const key = await publishKey();
    if (!key) {
      toast("Publish cancelled");
      return;
    }
    const defaultLabel =
      (state.matrix.seedVersion != null
        ? `seed-${state.matrix.seedVersion}`
        : "catalog") +
      "-" +
      new Date().toISOString().slice(0, 10);
    const versionEntered = await window.SlmDialog.prompt({
      title: "Version label",
      message: "Label for this publish (phones use this to detect updates).",
      inputLabel: "Version",
      defaultValue: defaultLabel,
      okLabel: "Next",
    });
    if (versionEntered === null) {
      toast("Publish cancelled");
      return;
    }
    const version_label = String(versionEntered || "").trim();
    if (!version_label) {
      toast("Publish cancelled");
      return;
    }
    const notesEntered = await window.SlmDialog.prompt({
      title: "Publish notes",
      message: "Optional notes for this catalog version.",
      inputLabel: "Notes",
      placeholder: "What changed…",
      okLabel: "Publish",
    });
    if (notesEntered === null) {
      toast("Publish cancelled");
      return;
    }
    const notes = String(notesEntered || "").trim();
    const go = await window.SlmDialog.confirm({
      title: "Publish to app?",
      message: `Upload rate book + kits as “${version_label}”?\nActivated phones will download this version.`,
      okLabel: "Publish",
    });
    if (!go) return;

    const btn = $("btnPublishCatalog");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Publishing…";
    }
    toast("Uploading catalog (~4 MB)…");
    try {
      persistCustomKitDefsFromState();
      const kit_matrix = {
        ...state.matrix,
        customKits: allCustomKitDefs().map((k) => {
          const live = state.kitsById[k.id] || k;
          return {
            ...k,
            ...live,
            custom: true,
            lines: live.lines || [],
            enabled: live.enabled !== false,
            complete: !!live.complete,
            notes: live.notes || "",
          };
        }),
      };
      const res = await fetch(`${base}/functions/v1/catalog-publish`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${anon}`,
          apikey: anon,
        },
        body: JSON.stringify({
          publish_key: key,
          version_label,
          notes,
          ratebook: state.ratebook,
          kit_matrix,
          kit_edits: loadEdits(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        await window.SlmDialog.alert({
          title: "Publish failed",
          message: String(data.error || res.status),
        });
        return;
      }
      toast(`Published ${data.version_label}`);
    } catch (err) {
      console.error(err);
      await window.SlmDialog.alert({
        title: "Publish failed",
        message: "Network error while uploading the catalog.",
      });
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Publish to app";
        updatePermissionUi();
      }
    }
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, "&#39;");
  }

  async function boot() {
    if (window.SlmLicense) {
      await window.SlmLicense.ensureLicensed();
    }

    const [ratebook, matrix] = await Promise.all([
      fetch("./ratebook.json").then((r) => r.json()),
      fetch("./kit-matrix.json").then((r) => r.json()),
    ]);
    state.ratebook = ratebook;
    state.matrix = matrix;
    mergeKits();
    populateConductorFilter();
    populateDtrCapacityFilter();
    renderStats();
    updatePermissionUi();
    refreshPendingBadge();
    wireBoqUi();
    syncLensControls();
    state.boqExtras = loadBoqExtras();

    const params = new URLSearchParams(location.search);
    const startTab = params.get("tab");
    const kitId = params.get("kit");
    const solo = params.get("solo") === "1";
    if (solo) {
      document.documentElement.classList.add("est-solo-page");
      $("estShell")?.classList.add("est-solo");
    }
    const fromSession = tryLoadBoqFromSession();
    if (solo && kitId) {
      // Focused single-kit editor — skip board tabs.
      if (kitId && state.kitsById[kitId]) openEditor(kitId);
      else toast("Kit not found in catalog");
    } else if (startTab === "boq" || fromSession) {
      showTab("boq");
      if (fromSession && state.boqSurvey) generateBoq();
    } else {
      showTab("structure");
    }
    if (!solo && kitId && state.kitsById[kitId]) {
      openEditor(kitId);
    }

    document.querySelectorAll(".est-tab").forEach((tab) => {
      tab.addEventListener("click", () => showTab(tab.dataset.tab));
    });
    ["boardSearch", "filterVoltage", "filterStructure", "filterConductor", "filterWire", "filterDtrCapacity", "filterLocation", "filterArrangement", "filterExtension", "filterPole", "filterStatus", "filterOrigin", "boardViewMode"].forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener("input", renderBoard);
      el.addEventListener("change", renderBoard);
    });
    $("filterShowDtr")?.addEventListener("change", renderBoard);
    $("btnCloseEditor").addEventListener("click", () => closeEditor());
    $("btnSaveKit").addEventListener("click", () => saveKit());
    $("btnSuggestKit")?.addEventListener("click", () => submitSuggestion());
    $("btnGuide")?.addEventListener("click", () =>
      $("guideModal")?.classList.remove("hidden")
    );
    $("btnGuideClose")?.addEventListener("click", () =>
      $("guideModal")?.classList.add("hidden")
    );
    $("guideModal")?.addEventListener("click", (e) => {
      if (e.target === $("guideModal")) $("guideModal").classList.add("hidden");
    });
    $("btnSignOutLicense")?.addEventListener("click", async () => {
      if (await window.SlmLicense?.signOut()) {
        updatePermissionUi();
      }
    });
    window.addEventListener("slm-license-changed", () => updatePermissionUi());
    $("btnDeleteCustomKit")?.addEventListener("click", async () => {
      if (state.activeKitId) await deleteCustomKit(state.activeKitId);
    });
    $("btnAddCustomStructure")?.addEventListener("click", () => {
      $("customModal")?.classList.remove("hidden");
      $("customLabel")?.focus();
    });
    $("btnCustomCancel")?.addEventListener("click", () =>
      $("customModal")?.classList.add("hidden")
    );
    $("btnCustomCreate")?.addEventListener("click", () => {
      const kit = createCustomStructure({
        customLabel: $("customLabel")?.value,
        voltage: $("customVoltage")?.value,
        location: $("customLocation")?.value,
        conductorNote: $("customConductorNote")?.value,
        poleHeightHint: $("customPoleHint")?.value,
        notes: $("customNotes")?.value,
      });
      if (!kit) return;
      $("customModal")?.classList.add("hidden");
      if ($("customLabel")) $("customLabel").value = "";
      if ($("customConductorNote")) $("customConductorNote").value = "";
      if ($("customPoleHint")) $("customPoleHint").value = "";
      if ($("customNotes")) $("customNotes").value = "";
      toast("Custom structure created");
      openEditor(kit.id);
    });
    $("btnMoreActions")?.addEventListener("click", () => {
      $("edMorePanel")?.classList.toggle("hidden");
    });
    document.querySelectorAll(".ed-view-tab").forEach((tab) => {
      tab.addEventListener("click", () => setEditorView(tab.dataset.edView));
    });
    $("kitFinal")?.addEventListener("change", () => {
      const L = window.SlmLicense;
      const canApprove = !L || !L.enabled || !!(L && L.canApprove());
      if (!canApprove) {
        if ($("kitFinal") && state.draft) $("kitFinal").checked = !!state.draft.complete;
        toast("Mark Final needs Approve on your license");
        return;
      }
      if (state.draft) {
        state.draft.complete = $("kitFinal").checked;
        if ($("kitComplete")) $("kitComplete").checked = state.draft.complete;
        markDraftDirty();
        renderEditorSummary();
        const pill = $("editorStatusPill");
        if (pill) {
          pill.textContent = state.draft.complete ? "Final" : "Draft";
          pill.className =
            "ed-status-pill" + (state.draft.complete ? " is-final" : "");
        }
      }
    });
    $("kitComplete")?.addEventListener("change", () => {
      if (state.draft) {
        state.draft.complete = $("kitComplete").checked;
        if ($("kitFinal")) $("kitFinal").checked = state.draft.complete;
        markDraftDirty();
        renderEditorSummary();
      }
    });
    $("kitEnabled")?.addEventListener("change", () => {
      if (state.draft) {
        state.draft.enabled = $("kitEnabled").checked;
        markDraftDirty();
      }
    });
    $("kitNotes")?.addEventListener("input", () => markDraftDirty());
    $("btnSeedConductor").addEventListener("click", seedConductor);
    $("btnSeedFittings").addEventListener("click", () => {
      seedFittings();
      setEditorView("review");
    });
    $("btnCopyFrom").addEventListener("click", openCopyModal);
    $("btnCopyCancel").addEventListener("click", () =>
      $("copyModal").classList.add("hidden")
    );
    $("btnCopyApply").addEventListener("click", () => {
      applyCopy();
      setEditorView("review");
    });
    $("catalogSearch").addEventListener("input", renderCatalog);
    document.querySelectorAll(".est-mini-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.catalogType = btn.dataset.cat;
        document.querySelectorAll(".est-mini-tab").forEach((b) =>
          b.classList.toggle("active", b === btn)
        );
        renderCatalog();
      });
    });
    $("rateSearch").addEventListener("input", renderRatebook);
    $("rateType").addEventListener("change", renderRatebook);
    $("btnExportKits").addEventListener("click", exportKits);
    $("btnImportKits").addEventListener("click", () => $("importKitsFile").click());
    $("importKitsFile").addEventListener("change", (e) => {
      const f = e.target.files?.[0];
      if (f) importKits(f);
      e.target.value = "";
    });
    $("btnResetKits").addEventListener("click", resetKits);
    $("btnPublishCatalog")?.addEventListener("click", () => {
      publishCatalog();
    });
    $("btnRefreshSuggestions")?.addEventListener("click", loadSuggestions);
    $("sugStatusFilter")?.addEventListener("change", loadSuggestions);
    $("btnRefreshLicenses")?.addEventListener("click", loadLicenses);
    $("licSearch")?.addEventListener("input", renderLicenses);
    $("licStatusFilter")?.addEventListener("change", renderLicenses);
    $("btnNewLicense")?.addEventListener("click", () => openLicenseModal(null));
    $("btnLicModalCancel")?.addEventListener("click", closeLicenseModal);
    $("btnLicModalSave")?.addEventListener("click", () => saveLicenseModal());
    $("licenseModal")?.addEventListener("click", (e) => {
      if (e.target === $("licenseModal")) closeLicenseModal();
    });
  }

  boot().catch((err) => {
    console.error(err);
    toast("Failed to load rate book / kit matrix");
  });
})();
