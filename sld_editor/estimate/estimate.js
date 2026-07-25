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
    if (!kit.enabled) return "disabled";
    const n = (kit.lines || []).length;
    if (n === 0) return "empty";
    if (kit.complete) return "complete";
    return "partial";
  }

  function kitTitle(kit) {
    if (kit.custom) {
      const name = kit.customLabel || kit.label || kit.id;
      return `${kit.voltage || "—"} · ${name} · Custom`;
    }
    if (kit.family === "structure") {
      const loc = kit.locationLabel || kit.position || "";
      const arr = kit.arrangementLabel ? ` · ${kit.arrangementLabel}` : "";
      const cond = kit.conductorShort || kit.conductorName || "";
      const wire = kit.wireLabel ? ` · ${kit.wireLabel}` : "";
      const ext = kit.extensionLabel ? ` · ${kit.extensionLabel}` : "";
      const dtr = kit.dtrCapacityLabel ? ` · ${kit.dtrCapacityLabel}` : "";
      return `${kit.voltage} · ${kit.structureLabel} · ${loc}${arr} · ${cond}${wire}${ext}${dtr}`;
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
    const height =
      kit.poleHeightHint ? ` · Pole ${kit.poleHeightHint}` : "";
    if (kit.family === "addon") {
      return `${kit.hint || ""} · ${basis} · ${mat} mat · ${lab} lab`;
    }
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
    const out = { empty: 0, partial: 0, complete: 0, disabled: 0, total: kits.length };
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
    const allStatus = countByStatus(all);
    const mat = state.ratebook.materials.length;
    const lab = state.ratebook.labour.length;

    $("estStats").innerHTML = `
      <div class="est-stat"><strong>${mat}</strong><span>Materials</span></div>
      <div class="est-stat"><strong>${lab}</strong><span>Labour</span></div>
      <div class="est-stat"><strong>${byFamily.structure.length}</strong><span>Structure kits</span></div>
      <div class="est-stat"><strong>${byFamily.conductor.length}</strong><span>Conductor kits</span></div>
      <div class="est-stat"><strong>${byFamily.addon.length}</strong><span>Guarding add-ons</span></div>
      <div class="est-stat tone-ok"><strong>${allStatus.complete}</strong><span>Complete</span></div>
      <div class="est-stat tone-warn"><strong>${allStatus.partial}</strong><span>In progress</span></div>
      <div class="est-stat"><strong>${allStatus.empty}</strong><span>Empty</span></div>
      <div class="est-stat tone-muted"><strong>${allStatus.disabled}</strong><span>Disabled</span></div>
    `;
    const seedNote = state.matrix?.seedNote;
    if (seedNote && !$("estSeedBanner")) {
      const ban = document.createElement("div");
      ban.id = "estSeedBanner";
      ban.className = "est-board-summary";
      ban.style.marginBottom = "12px";
      ban.style.borderRadius = "10px";
      ban.style.border = "1px solid var(--line)";
      ban.innerHTML = `<span>${escapeHtml(seedNote)}</span>`;
      $("estStats").after(ban);
    }

    const tabLabel = (kits) => {
      const s = countByStatus(kits);
      return `${s.complete}/${kits.length}`;
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
    const status = $("filterStatus").value;
    const origin = $("filterOrigin")?.value || "";

    let rows = kitsForTab();
    const tabTotal = rows.length;
    if (voltage) rows = rows.filter((k) => k.voltage === voltage);
    if (structure) {
      if (structure === "CUSTOM") {
        rows = rows.filter((k) => k.custom || k.structure === "CUSTOM");
      } else {
        rows = rows.filter((k) => k.structure === structure);
      }
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
    if (status) rows = rows.filter((k) => kitStatus(k) === status);
    if (origin === "custom") rows = rows.filter((k) => k.custom);
    if (origin === "matrix") rows = rows.filter((k) => !k.custom);
    if (q) {
      rows = rows.filter((k) => kitTitle(k).toLowerCase().includes(q));
    }
    return { rows, tabTotal };
  }

  function renderBoardSummary(rows, tabTotal) {
    const el = $("boardSummary");
    if (!el) return;
    const s = countByStatus(rows);
    const voltageCounts = {};
    for (const k of rows) {
      voltageCounts[k.voltage] = (voltageCounts[k.voltage] || 0) + 1;
    }
    const voltageChips = Object.entries(voltageCounts)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(
        ([v, n]) =>
          `<span class="est-chip voltage">${escapeHtml(v)} <strong>${n}</strong></span>`
      )
      .join("");

    el.innerHTML = `
      <span>Showing <strong>${rows.length}</strong> of <strong>${tabTotal}</strong> kits</span>
      <span class="est-chip complete">Complete ${s.complete}</span>
      <span class="est-chip partial">In progress ${s.partial}</span>
      <span class="est-chip empty">Empty ${s.empty}</span>
      <span class="est-chip disabled">Disabled ${s.disabled}</span>
      ${voltageChips}
    `;
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
    const allowed = voltage && rules[voltage]?.structures
      ? new Set(rules[voltage].structures)
      : null;
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

  function renderBoard() {
    const { rows, tabTotal } = filteredBoardRows();
    renderBoardSummary(rows, tabTotal);

    const list = $("boardList");
    if (!rows.length) {
      list.innerHTML = `<div class="est-empty">No kits match these filters.</div>`;
      return;
    }

    list.innerHTML = rows
      .map((kit) => {
        const st = kitStatus(kit);
        const counts = kitLineCounts(kit);
        const seeded = kit.seeded && counts.total > 0;
        return `
          <div class="est-row ${st === "disabled" ? "disabled-row" : ""}" data-kit="${escapeAttr(kit.id)}">
            <div>
              <div class="est-row-title">${escapeHtml(kitTitle(kit))}</div>
              <div class="est-row-meta">${escapeHtml(kitSubtitle(kit))}${seeded ? " · pre-seeded" : ""}${kit.custom ? " · custom" : ""}</div>
            </div>
            <div style="display:flex;gap:8px;align-items:center;justify-content:flex-end;flex-wrap:wrap;">
              ${kit.custom ? `<span class="est-chip custom">Custom</span>` : ""}
              <span class="est-chip" style="background:#e8f1ff;color:#1e40af;" title="Materials"><strong>${counts.mat}</strong> mat</span>
              <span class="est-chip" style="background:#ecfdf3;color:#166534;" title="Labour"><strong>${counts.lab}</strong> lab</span>
              <span class="est-badge ${st}">${st}</span>
            </div>
            <button type="button" class="est-btn est-btn-ghost est-btn-sm" data-open="${escapeAttr(kit.id)}">Edit</button>
          </div>
        `;
      })
      .join("");

    list.querySelectorAll("[data-open]").forEach((btn) => {
      btn.addEventListener("click", () => openEditor(btn.getAttribute("data-open")));
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
      <span class="est-chip" style="background:#e8f1ff;color:#1e40af;"><strong>${mat}</strong> materials</span>
      <span class="est-chip" style="background:#ecfdf3;color:#166534;"><strong>${lab}</strong> labour</span>
      <span class="est-chip ${state.draft.complete ? "complete" : "partial"}">${state.draft.complete ? "Reviewed" : "Needs review"}</span>
    `;
  }

  function openEditor(kitId) {
    const kit = state.kitsById[kitId];
    if (!kit) return;
    state.activeKitId = kitId;
    state.draft = {
      enabled: kit.enabled,
      complete: kit.complete,
      notes: kit.notes || "",
      lines: (kit.lines || []).map((l) => ({ ...l })),
      _dirty: false,
    };

    $("boardPanel").classList.add("hidden");
    $("ratebookPanel").classList.add("hidden");
    $("editorPanel").classList.remove("hidden");
    $("edMorePanel")?.classList.add("hidden");

    $("editorTitle").textContent = kitTitle(kit);
    $("editorSub").textContent = kit.custom
      ? "Custom structure — build the BOQ from the rate book. Survives matrix regenerate."
      : "Change quantity, remove items, or add from the rate book.";
    $("kitEnabled").checked = !!state.draft.enabled;
    $("kitComplete").checked = !!state.draft.complete;
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
          : "Fill suggested fittings";

    renderEditorSummary();
    setEditorView("review");
    renderKitLines();
    updateSuggestButton();
  }

  function updateSuggestButton() {
    const btn = $("btnSuggestKit");
    if (!btn) return;
    const can = !!(window.SlmLicense && window.SlmLicense.canSuggest());
    btn.classList.toggle("hidden", !can);
    btn.disabled = !can;
    btn.title = can
      ? "Send this kit edit for approval"
      : "Needs can_suggest on your license";
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
    // Dev mode (no Supabase): treat as full admin for local testing.
    const canPublish = licensedOff ? true : canApprove;

    const roleEl = $("estPermRole");
    const chips = $("estPermChips");
    let roleLabel = "Local edit only";
    if (licensedOff) roleLabel = "Dev mode (licensing off) — all tools enabled";
    else if (canApprove && canSuggest) roleLabel = "Admin — suggest, approve, publish";
    else if (canApprove) roleLabel = "Approver — review suggestions & publish";
    else if (canSuggest) roleLabel = "Suggestor — edit kits & suggest changes";
    else roleLabel = "Editor — local kits only (Export / Import / Reset)";
    if (roleEl) {
      const code = prefs.licenseCode ? ` · ${prefs.licenseCode}` : "";
      roleEl.textContent = roleLabel + code;
    }
    if (chips) {
      chips.innerHTML = `
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
      true,
      "",
      "Download a backup of kit edits from this browser"
    );
    setBtnEnabled(
      $("btnImportKits"),
      true,
      "",
      "Load a kit backup into this browser"
    );
    setBtnEnabled(
      $("btnResetKits"),
      true,
      "",
      "Clear kit edits on this computer"
    );
    setBtnEnabled(
      $("btnAddCustomStructure"),
      true,
      "",
      "Create a non-standard structure kit"
    );

    updateSuggestButton();
    updateSuggestionsTabVisibility();
  }

  function markDraftDirty() {
    if (state.draft) state.draft._dirty = true;
  }

  function isDraftDirty() {
    return !!(state.draft && state.draft._dirty);
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
              <button type="button" class="est-btn est-btn-danger est-btn-sm" data-rm="${i}" title="Remove">Remove</button>
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
    kit.complete = $("kitComplete").checked;
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
      $("kitComplete").checked = false;
      toast("Add at least one item before marking reviewed");
      return;
    }
    saveEdits();
    state.draft._dirty = false;
    renderStats();
    renderEditorSummary();
    toast("Saved");
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
    $("suggestionsPanel")?.classList.add("hidden");

    if (tab === "ratebook") {
      $("ratebookPanel").classList.remove("hidden");
      renderRatebook();
    } else if (tab === "suggestions") {
      $("suggestionsPanel")?.classList.remove("hidden");
      loadSuggestions();
    } else {
      $("boardPanel").classList.remove("hidden");
      const toolbar = $("boardToolbar");
      if (toolbar) toolbar.classList.toggle("hidden", tab !== "structure");
      renderBoard();
    }
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
    const proposed = {
      enabled: $("kitEnabled")?.checked ?? !!state.draft.enabled,
      complete: $("kitComplete")?.checked ?? !!state.draft.complete,
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
    kit.complete = !!proposed.complete;
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
        toast(ok ? "Merged — publish when ready" : "Accepted (kit missing locally)");
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
    showTab("structure");

    document.querySelectorAll(".est-tab").forEach((tab) => {
      tab.addEventListener("click", () => showTab(tab.dataset.tab));
    });
    ["boardSearch", "filterVoltage", "filterStructure", "filterConductor", "filterWire", "filterDtrCapacity", "filterLocation", "filterArrangement", "filterExtension", "filterStatus", "filterOrigin"].forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener("input", renderBoard);
      el.addEventListener("change", renderBoard);
    });
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
    $("kitComplete")?.addEventListener("change", () => {
      if (state.draft) {
        state.draft.complete = $("kitComplete").checked;
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
  }

  boot().catch((err) => {
    console.error(err);
    toast("Failed to load rate book / kit matrix");
  });
})();
