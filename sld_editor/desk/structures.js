/**
 * Structures desk — browse kits by voltage → type, review recipe, edit in-panel.
 */
(function (global) {
  "use strict";

  var Desk = global.SlmDesk;
  var Cat = global.SlmCatalog;
  var esc = function (s) {
    return Desk.escapeHtml(s);
  };

  var MATRIX_URL = "../estimate/kit-matrix.json";
  var EDITS_KEY = "slm_estimate_kits_v7";
  var CUSTOM_KITS_KEY = "slm_estimate_custom_kits_v1";
  var PENDING_KITS_KEY = "slm_pending_kit_suggestions_v1";
  var pendingSync = { loading: false, lastAt: 0 };
  /** Full pending suggestion rows from server (for Accept / Reject on desk). */
  var pendingSuggestionRows = [];
  /** Cached localStorage maps — avoid JSON.parse per leaf. */
  var editsCache = { raw: null, map: null };
  var pendingCache = { raw: null, map: null };
  var matrixEditStamp = null;

  function writePendingFromSuggestions(rows) {
    var PS = global.SlmPoleScope;
    pendingSuggestionRows = (rows || []).filter(function (s) {
      return s && s.status === "pending" && s.kit_id;
    });
    var next = PS
      ? PS.pendingMapFromSuggestions(pendingSuggestionRows)
      : {};
    if (!PS) {
      pendingSuggestionRows.forEach(function (s) {
        var prop = s.proposed || {};
        next[String(s.kit_id)] = {
          poleToken: String(prop.poleToken || prop.pole_token || "").trim(),
          poleMaterial: String(prop.poleMaterial || prop.pole_material || "").trim(),
          label: String(s.kit_label || "").trim(),
          suggestionId: String(s.id || ""),
          proposed: prop,
        };
      });
    }
    try {
      var encoded = JSON.stringify(next);
      var prev = localStorage.getItem(PENDING_KITS_KEY) || "";
      pendingCache.raw = encoded;
      pendingCache.map = next;
      if (prev === encoded) return;
      localStorage.setItem(PENDING_KITS_KEY, encoded);
      window.dispatchEvent(new CustomEvent("slm-pending-kits-changed"));
    } catch (e) {
      /* ignore */
    }
  }

  function canApproveOnDesk() {
    var L = global.SlmLicense;
    if (!L || !L.enabled) return true;
    return !!(L.canApprove && L.canApprove());
  }

  function pendingRowForKit(kitId, poleToken) {
    var id = String(kitId || "");
    var PS = global.SlmPoleScope;
    var want = PS ? PS.normalizeToken(poleToken) : String(poleToken || "").trim();
    var fallback = null;
    for (var i = 0; i < pendingSuggestionRows.length; i++) {
      var row = pendingSuggestionRows[i];
      if (String(row.kit_id) !== id) continue;
      var prop = row.proposed || {};
      var tok = PS
        ? PS.normalizeToken(prop.poleToken || prop.pole_token || "")
        : String(prop.poleToken || prop.pole_token || "").trim();
      if (want && tok && want === tok) return row;
      if (!want && !tok) return row;
      if (!fallback) fallback = row;
    }
    // Exact pole required when leaf has a pole — do not fall back to another pole.
    if (want) return null;
    return fallback;
  }

  function catalogPost(path, body) {
    var L = global.SlmLicense;
    var cfg = global.SLM_LICENSE_CONFIG || {};
    var base = String(cfg.SUPABASE_URL || "").replace(/\/$/, "");
    var anon = cfg.SUPABASE_ANON_KEY || "";
    if (!base || !anon || !L || !L.deviceId) {
      return Promise.reject(new Error("licensing_disabled"));
    }
    return fetch(base + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + anon,
        apikey: anon,
      },
      body: JSON.stringify(
        Object.assign({ device_id: L.deviceId() }, body || {})
      ),
    }).then(function (r) {
      return r.json();
    });
  }

  function applyProposedLocally(kitId, proposed, asFinal) {
    if (!state.matrix || !kitId || !proposed) return false;
    var hit = null;
    []
      .concat(state.matrix.structureKits || [])
      .concat(state.matrix.conductorKits || [])
      .concat(state.matrix.addonKits || [])
      .concat(state.matrix.customKits || [])
      .forEach(function (k) {
        if (k && String(k.id) === String(kitId)) hit = k;
      });
    if (!hit) return false;
    var lines = Array.isArray(proposed.lines)
      ? proposed.lines.map(function (l) {
          return {
            code: l.code,
            qty: Number(l.qty) || 0,
            type: l.type,
          };
        })
      : [];
    var complete = !!asFinal;
    if (asFinal && !lines.length) complete = false;
    var poleTok = String(
      proposed.poleToken || proposed.pole_token || ""
    ).trim();
    var patch = {
      enabled: proposed.enabled !== false,
      complete: complete,
      notes: String(proposed.notes || ""),
      lines: lines,
    };
    try {
      var edits = JSON.parse(localStorage.getItem(EDITS_KEY) || "{}") || {};
      var PS = global.SlmPoleScope;
      if (PS && poleTok) {
        PS.writeOverlay(edits, kitId, poleTok, patch);
      } else {
        edits[kitId] = patch;
        hit.enabled = patch.enabled;
        hit.complete = patch.complete;
        hit.notes = patch.notes;
        hit.lines = lines;
      }
      localStorage.setItem(EDITS_KEY, JSON.stringify(edits));
      editsCache.raw = JSON.stringify(edits);
      editsCache.map = edits;
      matrixEditStamp = null;
    } catch (e) {
      /* ignore */
    }
    return true;
  }

  function reviewDeskSuggestion(suggestionId, action, asFinal) {
    if (!canApproveOnDesk()) {
      Desk.toast("Your license cannot approve");
      return Promise.resolve();
    }
    var go = Promise.resolve(true);
    if (action === "reject") {
      go = global.SlmDialog.prompt({
        title: "Reject suggestion",
        message: "Optional note for the suggestor.",
        inputLabel: "Review note",
        placeholder: "Reason…",
        okLabel: "Reject",
      }).then(function (note) {
        if (note === null) return false;
        return catalogPost("/functions/v1/catalog-suggestion-review", {
          suggestion_id: suggestionId,
          action: "reject",
          review_note: String(note || "").trim(),
        });
      });
    } else {
      go = global.SlmDialog.confirm({
        title: asFinal ? "Accept as Final?" : "Accept as Draft?",
        message: asFinal
          ? "Merge into the kit and mark Final."
          : "Merge into the kit as Draft.",
        okLabel: asFinal ? "Accept as Final" : "Accept as Draft",
      }).then(function (ok) {
        if (!ok) return false;
        return catalogPost("/functions/v1/catalog-suggestion-review", {
          suggestion_id: suggestionId,
          action: "accept",
          review_note: "",
        });
      });
    }
    return go
      .then(function (json) {
        if (json === false || json == null) return;
        if (!json || !json.ok) {
          Desk.toast("Review failed: " + ((json && json.error) || "unknown"));
          return;
        }
        if (action === "accept") {
          applyProposedLocally(json.kit_id, json.proposed, !!asFinal);
          Desk.toast(asFinal ? "Accepted as Final" : "Accepted as Draft");
        } else {
          Desk.toast("Suggestion rejected");
        }
        return syncPendingSuggestions(true).then(function () {
          softRefresh();
        });
      })
      .catch(function () {
        Desk.toast("Review failed (network)");
      });
  }

  /** Pull pending suggestions so Structures Suggested counts stay accurate. */
  function syncPendingSuggestions(force) {
    var L = global.SlmLicense;
    var cfg = global.SLM_LICENSE_CONFIG || {};
    if (!L || !L.enabled || !L.deviceId) return Promise.resolve(false);
    if (!L.canSuggest || (!L.canSuggest() && !(L.canApprove && L.canApprove()))) {
      return Promise.resolve(false);
    }
    var now = Date.now();
    if (pendingSync.loading) return Promise.resolve(false);
    // Even forced syncs debounce briefly to avoid refresh loops.
    if (now - pendingSync.lastAt < (force ? 1500 : 8000)) {
      return Promise.resolve(false);
    }
    var base = String(cfg.SUPABASE_URL || "").replace(/\/$/, "");
    var anon = cfg.SUPABASE_ANON_KEY || "";
    if (!base || !anon) return Promise.resolve(false);
    pendingSync.loading = true;
    var finished = false;
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = setTimeout(function () {
      if (finished) return;
      finished = true;
      pendingSync.loading = false;
      try {
        if (ctrl) ctrl.abort();
      } catch (e) {
        /* ignore */
      }
    }, 4000);
    return fetch(base + "/functions/v1/catalog-suggestions-list", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + anon,
        apikey: anon,
      },
      body: JSON.stringify({
        device_id: L.deviceId(),
        status: "pending",
      }),
      signal: ctrl ? ctrl.signal : undefined,
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (json) {
        if (finished) return false;
        finished = true;
        clearTimeout(timer);
        pendingSync.loading = false;
        pendingSync.lastAt = Date.now();
        if (!json || !json.ok) return false;
        writePendingFromSuggestions(json.suggestions || []);
        return true;
      })
      .catch(function () {
        if (finished) return false;
        finished = true;
        clearTimeout(timer);
        pendingSync.loading = false;
        return false;
      });
  }
  var COLS_KEY = "slm_st_col_widths_v1";
  var COL_MIN = { tree: 160, kits: 220, detail: 200 };
  var colWidths = loadColWidths();

  var state = {
    matrix: null,
    voltage: "11kV",
    /** "catalog" = voltage rail (33/11/LT); "mykits" = My Kits rail item */
    panel: "catalog",
    q: "",
    statusFilter: "", // "" | draft | suggested | final
    selected: null,
    selectedPoleMaterial: null,
    selectedPoleToken: null,
    focusKey: null, // tree node key whose kits show in the middle pane
    mode: "browse", // browse | edit
    pendingKitId: null,
    collapsed: {}, // tree group keys → true when collapsed
  };

  function loadColWidths() {
    var defaults = { tree: 240, detail: 300 };
    try {
      var raw = JSON.parse(localStorage.getItem(COLS_KEY) || "{}");
      if (raw && raw.tree) defaults.tree = Number(raw.tree) || defaults.tree;
      if (raw && raw.detail) defaults.detail = Number(raw.detail) || defaults.detail;
    } catch (e) {
      /* ignore */
    }
    return defaults;
  }

  function saveColWidths() {
    try {
      localStorage.setItem(
        COLS_KEY,
        JSON.stringify({ tree: colWidths.tree, detail: colWidths.detail })
      );
    } catch (e) {
      /* ignore */
    }
  }

  function applyColWidths(shell) {
    if (!shell) return;
    var tree = colWidths.tree;
    var detail = colWidths.detail;
    var kitsMin = COL_MIN.kits;
    // Give the kit editor room while editing — tree/kits stay as pickers.
    if (state.mode === "edit") {
      var total = shell.getBoundingClientRect().width || 1100;
      var splitW = 12;
      tree = Math.min(tree, 200);
      detail = Math.max(
        detail,
        Math.min(580, Math.floor(total * 0.5))
      );
      kitsMin = 180;
      var used = tree + detail + splitW;
      if (total - used < kitsMin) {
        detail = Math.max(320, total - kitsMin - tree - splitW);
      }
      shell.classList.add("is-kit-editing");
    } else {
      shell.classList.remove("is-kit-editing");
    }
    shell.style.gridTemplateColumns =
      Math.round(tree) +
      "px 6px minmax(" +
      kitsMin +
      "px, 1fr) 6px " +
      Math.round(detail) +
      "px";
  }

  function wireColumnResize(shell) {
    if (!shell) return;
    applyColWidths(shell);

    shell.querySelectorAll(".dk-st-split").forEach(function (handle) {
      handle.addEventListener("pointerdown", function (e) {
        if (e.button != null && e.button !== 0) return;
        e.preventDefault();
        var which = handle.getAttribute("data-split"); // "tree" | "detail"
        var startX = e.clientX;
        var startTree = colWidths.tree;
        var startDetail = colWidths.detail;
        var total = shell.getBoundingClientRect().width;
        var splitW = 12; // both splitters
        var maxTree = Math.max(
          COL_MIN.tree,
          total - COL_MIN.kits - COL_MIN.detail - splitW
        );
        var maxDetail = Math.max(
          COL_MIN.detail,
          total - COL_MIN.kits - COL_MIN.tree - splitW
        );

        handle.classList.add("is-dragging");
        document.body.classList.add("dk-st-resizing");
        try {
          handle.setPointerCapture(e.pointerId);
        } catch (err) {
          /* ignore */
        }

        function onMove(ev) {
          var dx = ev.clientX - startX;
          if (which === "tree") {
            colWidths.tree = Math.min(
              maxTree,
              Math.max(COL_MIN.tree, startTree + dx)
            );
          } else {
            colWidths.detail = Math.min(
              maxDetail,
              Math.max(COL_MIN.detail, startDetail - dx)
            );
          }
          // Keep kits above minimum by clamping the other pane if needed
          var used = colWidths.tree + colWidths.detail + splitW;
          if (total - used < COL_MIN.kits) {
            var overflow = COL_MIN.kits - (total - used);
            if (which === "tree") colWidths.tree = Math.max(COL_MIN.tree, colWidths.tree - overflow);
            else colWidths.detail = Math.max(COL_MIN.detail, colWidths.detail - overflow);
          }
          applyColWidths(shell);
        }

        function onUp(ev) {
          handle.classList.remove("is-dragging");
          document.body.classList.remove("dk-st-resizing");
          saveColWidths();
          try {
            handle.releasePointerCapture(ev.pointerId);
          } catch (err) {
            /* ignore */
          }
          handle.removeEventListener("pointermove", onMove);
          handle.removeEventListener("pointerup", onUp);
          handle.removeEventListener("pointercancel", onUp);
        }

        handle.addEventListener("pointermove", onMove);
        handle.addEventListener("pointerup", onUp);
        handle.addEventListener("pointercancel", onUp);
      });
    });
  }

  var TYPE_ORDER = ["1P", "2P", "3P", "4P", "1NP", "DTR"];
  var POS_ORDER = ["Tangent", "Angular", "Dead-end", "T-Off", "Tap"];
  var ARR_ORDER = ["In-line", "Sectional", "Other"];

  function loadLocalCustomKits() {
    try {
      var list = JSON.parse(localStorage.getItem(CUSTOM_KITS_KEY) || "[]");
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function allKits() {
    var m = state.matrix;
    if (!m) return [];
    return []
      .concat(m.structureKits || [])
      .concat(m.conductorKits || [])
      .concat(m.addonKits || [])
      .concat(m.customKits || []);
  }

  function isMyKit(k) {
    if (!k) return false;
    if (k.myKit || k.custom) return true;
    var id = String(k.id || "");
    return (
      id.indexOf("MYKIT|") === 0 ||
      id.indexOf("CUSTOM|") === 0 ||
      String(k.structure || "") === "CUSTOM"
    );
  }

  function kitFamily(k) {
    return String((k && k.family) || "structure").toLowerCase();
  }

  function kitType(k) {
    if (kitFamily(k) === "conductor") return "Conductor";
    if (kitFamily(k) === "addon") return k.addonType || k.label || "Add-on";
    var st = String(k.structure || k.structureLabel || "").trim();
    // Older My Kits copies used structure:"CUSTOM" — recover type from source id.
    if (
      (!st || /^CUSTOM$/i.test(st) || /^My Kits$/i.test(st)) &&
      (k.sourceKitId || k.id)
    ) {
      var src = String(k.sourceKitId || k.id).replace(/^MYKIT\|/i, "");
      var fromId = src.match(/(?:^|\|)(1NP|1P|2P|3P|4P|DTR)\b/i);
      if (fromId) st = fromId[1];
    }
    if (/^DTR/i.test(st) || k.isDtr) return "DTR";
    if (/^1NP$/i.test(st) || /^P1N$/i.test(st)) return "1NP";
    var m = st.match(/^(1P|2P|3P|4P)\b/i);
    if (m) return m[1].toUpperCase();
    // Fall back: structureLabel like "DTR on 2P" already handled; plain ids next.
    if (TYPE_ORDER.indexOf(st) >= 0) return st;
    if (/^CUSTOM$/i.test(st) || /^My Kits$/i.test(st)) return "Custom";
    return st || "?";
  }

  function kitVoltage(k) {
    return String(k.voltage || (k.voltageHints && k.voltageHints[0]) || "").trim();
  }

  function matchesVoltage(k) {
    var v = kitVoltage(k);
    if (!state.voltage) return true;
    if (state.voltage === "LT") return v.toUpperCase() === "LT";
    return v === state.voltage || v.toLowerCase() === state.voltage.toLowerCase();
  }

  function arrLabel(a) {
    if (!a) return "Other";
    if (a === "InlineArr") return "In-line";
    if (a === "Sectional") return "Sectional";
    return String(a).replace(/Arr$/, "") || "Other";
  }

  function posLabel(k) {
    return (
      (k && (k.locationLabel || k.location || k.position || k.positionLabel)) ||
      "Other"
    );
  }

  function poleMaterialsForVoltage(voltage) {
    var Net = global.SlmNetworkCatalog;
    var v = voltage || state.voltage;
    if (Net && Net.materialsFor) {
      return Net.materialsFor(v).map(function (m) {
        return m.id || m.label || m;
      });
    }
    if (v === "33kV") return ["9m PCC", "Rail", "H-Pole"];
    if (v === "11kV") {
      return [
        "8m PCC",
        "9m PCC",
        "Rail",
        "H-Pole",
        "Steel pole 9m",
        "Steel pole 11m",
      ];
    }
    return ["8m PCC"];
  }

  /** Map catalog pole tokens → field pole-type labels (by voltage). */
  function materialForToken(token, voltage) {
    var t = String(token || "").trim().toUpperCase();
    var v = voltage || state.voltage;
    if (t === "8M") return "8m PCC";
    if (t === "9M") return "9m PCC";
    if (t === "RL") return "Rail";
    if (v === "33kV") {
      if (t === "T9" || t === "T95" || t === "T11" || t === "WF") return "H-Pole";
    } else if (v === "11kV") {
      if (t === "WF") return "H-Pole";
      if (t === "T9" || t === "T95") return "Steel pole 9m";
      if (t === "T11") return "Steel pole 11m";
    } else if (t === "T9" || t === "T95" || t === "T11" || t === "WF") {
      return "H-Pole";
    }
    return "";
  }

  function preferredTokenForMaterial(material, kit) {
    var want = String(material || "");
    var variants = (kit && kit.poleVariants) || [];
    var order = {
      "8m PCC": ["8M"],
      "9m PCC": ["9M"],
      Rail: ["RL"],
      "H-Pole": ["WF", "T9", "T95", "T11"],
      "Steel pole 9m": ["T9", "T95"],
      "Steel pole 11m": ["T11"],
    };
    var prefs = order[want] || [];
    for (var i = 0; i < prefs.length; i += 1) {
      for (var j = 0; j < variants.length; j += 1) {
        if (String(variants[j].poleToken || "") === prefs[i]) {
          return prefs[i];
        }
      }
    }
    // Fallback: any variant that maps to this material
    for (j = 0; j < variants.length; j += 1) {
      var tok = variants[j].poleToken;
      if (materialForToken(tok, kitVoltage(kit) || state.voltage) === want) {
        return tok;
      }
    }
    return prefs[0] || poleToken(kit);
  }

  /** Materials this kit supports for the current voltage filter. */
  function kitPoleMaterials(k) {
    var allowed = poleMaterialsForVoltage(kitVoltage(k) || state.voltage);
    var seen = Object.create(null);
    var out = [];
    var variants = (k && k.poleVariants) || [];
    if (!variants.length) {
      var one = materialForToken(poleToken(k), kitVoltage(k) || state.voltage);
      if (one && allowed.indexOf(one) >= 0) return [one];
      return allowed.slice(0, 1);
    }
    variants.forEach(function (v) {
      var mat = materialForToken(v.poleToken, kitVoltage(k) || state.voltage);
      if (mat && allowed.indexOf(mat) >= 0 && !seen[mat]) {
        seen[mat] = true;
        out.push(mat);
      }
    });
    return out;
  }

  function poleLabel(k) {
    if (k && k._poleMaterial) return k._poleMaterial;
    if (state.selectedPoleMaterial && state.selected && k && state.selected.id === k.id) {
      return state.selectedPoleMaterial;
    }
    var mats = kitPoleMaterials(k);
    if (mats.length) return mats[0];
    var t = (k && (k.poleToken || k.activePoleToken || k.poleLabel)) || "";
    t = String(t).trim();
    if (!t) return "Unspecified pole";
    return materialForToken(t, kitVoltage(k) || state.voltage) || t;
  }

  function poleToken(k) {
    if (k && k._poleToken) return String(k._poleToken);
    if (state.selectedPoleToken && state.selected && k && state.selected.id === k.id) {
      return state.selectedPoleToken;
    }
    return String((k && (k.poleToken || k.activePoleToken)) || "").trim() || "_";
  }

  function kitTitle(k) {
    var KN = global.SlmKitName;
    if (KN && KN.displayName) return KN.displayName(k);
    if (kitFamily(k) === "conductor") {
      return k.conductorShort || k.conductorName || k.label || k.id || "Conductor";
    }
    if (kitFamily(k) === "addon") {
      return k.label || k.addonType || k.id || "Add-on";
    }
    return k.code || k.id || "Kit";
  }

  function namingGuideHtml(opts) {
    opts = opts || {};
    var KN = global.SlmKitName;
    var rows =
      KN && KN.guide
        ? KN.guide
            .map(function (g) {
              return (
                "<tr><th>" +
                esc(g.token) +
                "</th><td>" +
                esc(g.meaning) +
                "</td></tr>"
              );
            })
            .join("")
        : "";
    var example = (KN && KN.guideExample && KN.guideExample()) || "11kV-1P-Tan-Sec-NoExt-DOG";
    return (
      '<details class="dk-st-name-guide' +
      (opts.highlight ? " is-highlight" : "") +
      '"' +
      (opts.open ? " open" : "") +
      ">" +
      "<summary>Naming guide</summary>" +
      '<p class="dk-st-name-guide-ex"><code>' +
      esc(example) +
      "</code></p>" +
      '<p class="dk-st-name-guide-note">Fixed order includes pole after type (e.g. 1P-9M). HT omits wire — always 3-wire.</p>' +
      '<p class="dk-st-name-guide-note"><strong>Pole types · ' +
      esc(state.voltage) +
      ":</strong> " +
      esc(poleMaterialsForVoltage(state.voltage).join(" · ")) +
      " → 8M · 9M · RL · HP · S9 · S11</p>" +
      '<table class="dk-st-name-guide-table"><tbody>' +
      rows +
      "</tbody></table></details>"
    );
  }

  function kitSearchText(k) {
    return [
      kitTitle(k),
      kitType(k),
      k.id,
      k.code,
      k.location,
      k.position,
      k.arrangement,
      k.conductorShort,
      k.conductorFamily,
      k.extension,
      k.poleToken,
      k.poleLabel,
      kitPoleMaterials(k).join(" "),
      k.label,
      k.addonType,
    ]
      .filter(Boolean)
      .join(" ");
  }

  function filtered() {
    var q = state.q.toLowerCase().trim();
    return allKits().filter(function (k) {
      if (k.enabled === false) return false;
      // My Kits: show all voltages in the left tree (grouped under My Kits).
      if (!isMyKit(k) && !matchesVoltage(k)) return false;
      if (!q) return true;
      return kitSearchText(k).toLowerCase().indexOf(q) !== -1;
    });
  }

  function sortByOrder(list, order, getKey) {
    return list.slice().sort(function (a, b) {
      var ka = getKey(a);
      var kb = getKey(b);
      var ia = order.indexOf(ka);
      var ib = order.indexOf(kb);
      if (ia < 0) ia = 900;
      if (ib < 0) ib = 900;
      if (ia !== ib) return ia - ib;
      return String(ka).localeCompare(String(kb));
    });
  }

  /**
   * Forest for the left panel:
   *   My Kits  → 33kV/11kV/LT → Type → Position → Arrangement → Pole
   *   {rail V} → Type → Position → Arrangement → Pole   (catalog only)
   * My Kits is a sibling of the voltage catalog — not inside it.
   */
  function buildTree(kits) {
    var catalog = {
      key: "v:" + state.voltage,
      label: state.voltage,
      kits: [],
      children: Object.create(null),
      kind: "catalog",
    };
    var myKits = {
      key: "my:My Kits",
      label: "My Kits",
      kits: [],
      children: Object.create(null),
      kind: "mykits",
    };

    function ensureChild(parent, keyPart, label, kind, extra) {
      if (!parent.children[keyPart]) {
        parent.children[keyPart] = Object.assign(
          {
            key: parent.key + "/" + keyPart,
            label: label,
            kits: [],
            children: Object.create(null),
            kind: kind,
          },
          extra || {}
        );
      }
      return parent.children[keyPart];
    }

    function placeStructureLeaf(parent, k, voltageForPoles) {
      var type = kitType(k);
      var pos = posLabel(k);
      var arr = arrLabel(k.arrangement);
      var mats = kitPoleMaterials(
        Object.assign({}, k, {
          voltage: voltageForPoles || kitVoltage(k) || state.voltage,
        })
      );
      if (!mats.length) mats = ["Unspecified pole"];

      var typeNode = ensureChild(parent, "t:" + type, type, "type");
      var posNode = ensureChild(typeNode, "p:" + pos, pos, "position");
      var arrNode = ensureChild(posNode, "a:" + arr, arr, "arrangement");

      mats.forEach(function (mat) {
        var tok = preferredTokenForMaterial(mat, k);
        var poleNode = ensureChild(
          arrNode,
          "pole:" + encodeURIComponent(mat),
          mat,
          "pole",
          { poleMaterial: mat, poleToken: tok }
        );
        poleNode.kits.push(
          Object.assign({}, k, {
            _poleMaterial: mat,
            _poleToken: tok,
            activePoleToken: tok,
          })
        );
      });
    }

    function placeOtherLeaf(parent, k, family) {
      var otherKey = family === "conductor" ? "Conductors" : "Add-ons";
      var node = ensureChild(parent, "o:" + otherKey, otherKey, "other");
      node.kits.push(k);
    }

    kits.forEach(function (k) {
      var family = kitFamily(k);
      if (isMyKit(k)) {
        var vLabel = kitVoltage(k) || "—";
        if (/^LT$/i.test(vLabel)) vLabel = "LT";
        else if (/33/i.test(vLabel)) vLabel = "33kV";
        else if (/11/i.test(vLabel)) vLabel = "11kV";
        var vNode = ensureChild(myKits, "mv:" + vLabel, vLabel, "myvoltage");
        if (family !== "structure") {
          placeOtherLeaf(vNode, k, family);
        } else {
          placeStructureLeaf(vNode, k, vLabel);
        }
        return;
      }
      if (family !== "structure") {
        placeOtherLeaf(catalog, k, family);
        return;
      }
      placeStructureLeaf(catalog, k, state.voltage);
    });

    function countNode(node) {
      var n = node.kits.length;
      Object.keys(node.children).forEach(function (ck) {
        n += countNode(node.children[ck]);
      });
      node.count = n;
      return n;
    }

    function childList(node, order, keyFn) {
      var keys = Object.keys(node.children);
      if (order) {
        keys = sortByOrder(keys, order, function (k) {
          return keyFn ? keyFn(node.children[k], k) : k;
        });
      } else {
        keys.sort();
      }
      return keys.map(function (k) {
        return node.children[k];
      });
    }

    function orderStructureBranch(typeParent, voltageForPoles) {
      typeParent.ordered = childList(typeParent, POS_ORDER, function (n) {
        return n.label;
      });
      typeParent.ordered.forEach(function (posNode) {
        posNode.ordered = childList(posNode, ARR_ORDER, function (n) {
          return n.label;
        });
        posNode.ordered.forEach(function (arrNode) {
          var poleOrder = poleMaterialsForVoltage(
            voltageForPoles || state.voltage
          );
          arrNode.ordered = childList(arrNode, poleOrder, function (n) {
            return n.poleMaterial || n.label;
          });
          arrNode.ordered.forEach(function (poleNode) {
            poleNode.kits.sort(function (a, b) {
              var ca = String(a.conductorShort || "");
              var cb = String(b.conductorShort || "");
              if (ca !== cb) return ca.localeCompare(cb);
              var ma = String(a.dtrCapacity || a.dtrCapacityLabel || "");
              var mb = String(b.dtrCapacity || b.dtrCapacityLabel || "");
              if (ma !== mb) return ma.localeCompare(mb);
              var la = String(a.customLabel || a.label || a.id || "");
              var lb = String(b.customLabel || b.label || b.id || "");
              if (la !== lb) return la.localeCompare(lb);
              return String(a.id || "").localeCompare(String(b.id || ""));
            });
          });
        });
      });
    }

    function orderTypeChildren(parent, voltageForPoles) {
      parent.ordered = childList(
        parent,
        TYPE_ORDER.concat(["Custom", "Conductors", "Add-ons"]),
        function (n) {
          return n.label;
        }
      );
      parent.ordered.forEach(function (child) {
        if (child.kind === "other") {
          child.kits.sort(function (a, b) {
            var la = String(a.customLabel || a.label || a.id || "");
            var lb = String(b.customLabel || b.label || b.id || "");
            return la.localeCompare(lb);
          });
          return;
        }
        orderStructureBranch(child, voltageForPoles);
      });
    }

    countNode(myKits);
    countNode(catalog);

    myKits.ordered = childList(myKits, ["33kV", "11kV", "LT"], function (n) {
      return n.label;
    });
    myKits.ordered.forEach(function (vNode) {
      orderTypeChildren(vNode, vNode.label);
    });

    catalog.ordered = childList(
      catalog,
      TYPE_ORDER.concat(["Conductors", "Add-ons"]),
      function (n) {
        return n.label;
      }
    );
    catalog.ordered.forEach(function (node) {
      if (node.kind === "other") {
        node.kits.sort(function (a, b) {
          var la = String(a.customLabel || a.label || a.id || "");
          var lb = String(b.customLabel || b.label || b.id || "");
          return la.localeCompare(lb);
        });
        return;
      }
      orderStructureBranch(node, state.voltage);
    });

    // Rail chooses panel: My Kits OR catalog voltage — never nest My Kits under voltage.
    if (state.panel === "mykits") {
      return myKits;
    }
    return catalog;
  }

  function typeSortKey(type) {
    var i = TYPE_ORDER.indexOf(type);
    if (i >= 0) return "0-" + String(i).padStart(2, "0");
    return "5-" + String(type).toLowerCase();
  }

  function isCollapsed(key) {
    return !!state.collapsed[key];
  }

  function toggleCollapsed(key) {
    state.collapsed[key] = !state.collapsed[key];
  }

  function findNode(node, key) {
    if (!node) return null;
    if (node.key === key) return node;
    var kids = node.ordered || [];
    for (var i = 0; i < kids.length; i += 1) {
      var hit = findNode(kids[i], key);
      if (hit) return hit;
    }
    return null;
  }

  /** All kits under a tree node (includes nested children). */
  function collectKits(node) {
    if (!node) return [];
    var out = (node.kits || []).slice();
    (node.ordered || []).forEach(function (ch) {
      out = out.concat(collectKits(ch));
    });
    return out;
  }

  function focusPath(node) {
    if (!node) return "";
    // Rebuild from key segments for a clean breadcrumb when possible
    var parts = String(node.key || "")
      .split("/")
      .map(function (p) {
        if (p.indexOf("my:") === 0) return p.slice(3);
        if (p.indexOf("v:") === 0) return p.slice(2);
        if (p.indexOf("mv:") === 0) return p.slice(3);
        if (p.indexOf("t:") === 0) return p.slice(2);
        if (p.indexOf("p:") === 0) return p.slice(2);
        if (p.indexOf("a:") === 0) return p.slice(2);
        if (p.indexOf("pole:") === 0) {
          try {
            return decodeURIComponent(p.slice(5));
          } catch (e) {
            return node.label || p.slice(5);
          }
        }
        if (p.indexOf("o:") === 0) return p.slice(2);
        return "";
      })
      .filter(Boolean);
    if (parts.length) return parts.join(" · ");
    return node.label || "";
  }

  function applyLocalEdits(m) {
    if (!m) return m;
    var edits = loadEditsMap();
    var byId = Object.create(null);
    (m.customKits || []).forEach(function (k) {
      if (k && k.id) byId[k.id] = Object.assign({}, k, { custom: true, myKit: true });
    });
    loadLocalCustomKits().forEach(function (k) {
      if (k && k.id) byId[k.id] = Object.assign({}, k, { custom: true, myKit: true });
    });
    m.customKits = Object.keys(byId).map(function (id) {
      return byId[id];
    });
    function patch(k) {
      if (!k || !k.id || !edits[k.id]) return;
      var e = edits[k.id];
      if (Array.isArray(e.lines)) k.lines = e.lines;
      if (e.notes != null) k.notes = e.notes;
      if (e.enabled != null) k.enabled = e.enabled;
      if (e.complete != null) k.complete = e.complete;
    }
    []
      .concat(m.structureKits || [])
      .concat(m.conductorKits || [])
      .concat(m.addonKits || [])
      .concat(m.customKits || [])
      .forEach(patch);
    return m;
  }

  var matrixFetch = null;

  function loadMatrix(force) {
    if (force) {
      state.matrix = null;
      matrixEditStamp = null;
      matrixFetch = null;
    }
    if (state.matrix) {
      var raw = "";
      try {
        raw = localStorage.getItem(EDITS_KEY) || "{}";
      } catch (e) {
        raw = "{}";
      }
      if (matrixEditStamp !== raw) {
        // Invalidate edits cache so apply sees fresh map.
        editsCache.raw = null;
        editsCache.map = null;
        applyLocalEdits(state.matrix);
        matrixEditStamp = raw;
      }
      return Promise.resolve(state.matrix);
    }
    if (matrixFetch) return matrixFetch;
    // Warm catalog in background — do not block kit tree on rates.
    if (Cat && Cat.load) Cat.load(false).catch(function () {});
    matrixFetch = fetch(MATRIX_URL)
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        state.matrix = applyLocalEdits(data);
        try {
          matrixEditStamp = localStorage.getItem(EDITS_KEY) || "{}";
        } catch (e) {
          matrixEditStamp = "{}";
        }
        matrixFetch = null;
        return state.matrix;
      })
      .catch(function (err) {
        matrixFetch = null;
        throw err;
      });
    return matrixFetch;
  }

  function canEdit() {
    var L = global.SlmLicense;
    if (!L || !L.enabled) return true;
    return !!(L.canEditKits && L.canEditKits());
  }

  function myKitIdFor(kit) {
    if (!kit || !kit.id) return "";
    if (isMyKit(kit)) return String(kit.id);
    return "MYKIT|" + String(kit.id);
  }

  function persistLocalCustomKit(copy) {
    if (!copy || !copy.id) return;
    var list = loadLocalCustomKits().filter(function (k) {
      return k && String(k.id) !== String(copy.id);
    });
    list.push(copy);
    try {
      localStorage.setItem(CUSTOM_KITS_KEY, JSON.stringify(list));
    } catch (e) {
      throw e;
    }
    // Keep in-memory matrix in sync without full refetch.
    if (state.matrix) {
      var byId = Object.create(null);
      (state.matrix.customKits || []).forEach(function (k) {
        if (k && k.id) byId[k.id] = k;
      });
      byId[copy.id] = copy;
      state.matrix.customKits = Object.keys(byId).map(function (id) {
        return byId[id];
      });
      matrixEditStamp = null;
    }
  }

  /** Any user: copy the selected kit recipe into Structures → My Kits on this PC. */
  function copyKitToMyKits(sourceKit) {
    if (!sourceKit || !sourceKit.id) return;
    var recipe = resolvedRecipeForLeaf(sourceKit);
    var poleTok = activePoleToken(sourceKit);
    var poleMat = activePoleMaterial(sourceKit);
    var already = isMyKit(sourceKit);
    var title = kitTitle(sourceKit);
    var go =
      global.SlmDialog && global.SlmDialog.confirm
        ? global.SlmDialog.confirm({
            title: already ? "Update My Kit?" : "Copy to My Kits?",
            message: already
              ? "Update “" +
                title +
                "” under Structures → My Kits on this computer?"
              : "Save a personal copy of “" +
                title +
                "”" +
                (poleMat ? " (" + poleMat + ")" : "") +
                " under Structures → My Kits on this computer?\n\nThis does not change the shared catalog.",
            okLabel: already ? "Update My Kit" : "Copy to My Kits",
          })
        : Promise.resolve(true);
    Promise.resolve(go).then(function (ok) {
      if (!ok) return;
      var id = myKitIdFor(sourceKit);
      var lines = (recipe.lines || []).map(function (l) {
        return {
          code: lineCode(l) || l.code,
          qty: lineQty(l),
          type: lineIsLabour(l) ? "labour" : l.type || "material",
        };
      });
      var srcStruct = String(sourceKit.structure || "").trim();
      if (!srcStruct || /^CUSTOM$/i.test(srcStruct)) {
        srcStruct = kitType(sourceKit);
        if (srcStruct === "Custom" || srcStruct === "?") srcStruct = "CUSTOM";
      }
      var copy = {
        id: id,
        family: kitFamily(sourceKit) || "structure",
        custom: true,
        myKit: true,
        sourceKitId: already
          ? sourceKit.sourceKitId || null
          : sourceKit.id,
        voltage: kitVoltage(sourceKit) || state.voltage || "",
        customLabel: sourceKit.customLabel || sourceKit.label || title,
        label: sourceKit.customLabel || sourceKit.label || title,
        structure: srcStruct,
        structureLabel:
          sourceKit.structureLabel &&
          String(sourceKit.structureLabel) !== "My Kits"
            ? sourceKit.structureLabel
            : srcStruct,
        isDtr: !!sourceKit.isDtr,
        location: sourceKit.location || null,
        locationLabel:
          sourceKit.locationLabel || sourceKit.location || null,
        arrangement: sourceKit.arrangement || null,
        arrangementLabel: sourceKit.arrangementLabel || null,
        conductorId: sourceKit.conductorId || null,
        conductorShort: sourceKit.conductorShort || null,
        conductorName: sourceKit.conductorName || null,
        wireCount: sourceKit.wireCount || null,
        wireLabel: sourceKit.wireLabel || null,
        extension: sourceKit.extension || null,
        extensionLabel: sourceKit.extensionLabel || null,
        qtyBasis: sourceKit.qtyBasis || "per_structure",
        poleHeightHint: poleMat || sourceKit.poleHeightHint || "",
        poleToken: poleTok || sourceKit.poleToken || "",
        poleVariants: sourceKit.poleVariants || null,
        dtrCapacity: sourceKit.dtrCapacity || null,
        dtrCapacityLabel: sourceKit.dtrCapacityLabel || null,
        notes: recipe.notes || sourceKit.notes || "",
        enabled: recipe.enabled !== false,
        complete: !!recipe.complete,
        lines: lines,
        hint: "Saved on this PC — Structures → My Kits",
      };
      try {
        persistLocalCustomKit(copy);
      } catch (e) {
        Desk.toast("Could not save My Kit (storage full?)");
        return;
      }
      var keepPole = poleMat;
      var keepTok = poleTok;
      state.mode = "browse";
      state.pendingKitId = null;
      state.selected = Object.assign({}, copy, {
        _poleMaterial: keepPole || null,
        _poleToken: keepTok || null,
        activePoleToken: keepTok || copy.poleToken,
      });
      state.selectedPoleMaterial = keepPole || null;
      state.selectedPoleToken = keepTok || null;
      selectKitById(copy.id);
      if (Desk.syncTools) Desk.syncTools();
      softRefresh();
      Desk.toast(
        already
          ? "Updated My Kit"
          : "Copied to My Kits" + (poleMat ? " · " + poleMat : "")
      );
    });
  }

  function lineCode(line) {
    return line.itemId || line.code || line.matCode || "";
  }

  function lineName(line) {
    var code = lineCode(line);
    var rate = Cat && Cat.rateFor ? Cat.rateFor(code) : null;
    return (
      (rate && (rate.description || rate.name)) ||
      line.description ||
      line.name ||
      code ||
      "—"
    );
  }

  function lineQty(line) {
    if (line.qtyPerUnit != null) return line.qtyPerUnit;
    if (line.qty != null) return line.qty;
    return 1;
  }

  function lineIsLabour(line) {
    var code = lineCode(line);
    var rate = Cat && Cat.rateFor ? Cat.rateFor(code) : null;
    if (rate && rate.type === "labour") return true;
    if (rate && rate.type === "material") return false;
    if (String(line.type || "").toLowerCase() === "labour") return true;
    return /^L/i.test(String(code));
  }

  function recipeGroupHtml(label, lines) {
    return (
      '<div class="dk-st-recipe-group">' +
      '<div class="dk-st-recipe-head">' +
      esc(label) +
      "<span>" +
      lines.length +
      "</span></div>" +
      (lines.length
        ? '<table class="dk-table dk-table-compact"><thead><tr><th>Item</th><th>Code</th><th class="dk-num">Qty</th></tr></thead><tbody>' +
          lines
            .map(function (l) {
              return (
                "<tr><td>" +
                esc(lineName(l)) +
                '</td><td class="dk-kit-line-code">' +
                esc(lineCode(l) || "—") +
                '</td><td class="dk-num">' +
                esc(String(lineQty(l))) +
                "</td></tr>"
              );
            })
            .join("") +
          "</tbody></table>"
        : '<p class="dk-st-recipe-empty">None</p>') +
      "</div>"
    );
  }

  function detailPath(k) {
    if (kitFamily(k) !== "structure") return kitTitle(k);
    return [
      kitVoltage(k) || state.voltage,
      kitType(k),
      posLabel(k),
      arrLabel(k.arrangement),
      poleLabel(k),
    ].join(" · ");
  }

  function activePoleMaterial(k) {
    return (
      (k && k._poleMaterial) ||
      state.selectedPoleMaterial ||
      poleLabel(k)
    );
  }

  function activePoleToken(k) {
    return (
      (k && k._poleToken) ||
      state.selectedPoleToken ||
      preferredTokenForMaterial(activePoleMaterial(k), k) ||
      poleToken(k)
    );
  }

  function loadEditsMap() {
    try {
      var raw = localStorage.getItem(EDITS_KEY) || "{}";
      if (editsCache.raw === raw && editsCache.map) return editsCache.map;
      var map = JSON.parse(raw) || {};
      editsCache.raw = raw;
      editsCache.map = map;
      return map;
    } catch (e) {
      editsCache.raw = null;
      editsCache.map = {};
      return {};
    }
  }

  function loadPendingMap() {
    try {
      var raw = localStorage.getItem(PENDING_KITS_KEY) || "{}";
      if (pendingCache.raw === raw && pendingCache.map) return pendingCache.map;
      var map = JSON.parse(raw) || {};
      pendingCache.raw = raw;
      pendingCache.map = map;
      return map;
    } catch (e) {
      pendingCache.raw = null;
      pendingCache.map = {};
      return {};
    }
  }

  /** Pole-aware recipe for a stamped leaf (or selected kit). */
  function resolvedRecipeForLeaf(k) {
    var PS = global.SlmPoleScope;
    var tok = activePoleToken(k);
    if (PS) {
      return PS.resolveRecipeWithPending(
        loadEditsMap(),
        loadPendingMap(),
        k,
        tok
      );
    }
    return {
      enabled: k.enabled !== false,
      complete: !!k.complete,
      lines: k.lines || [],
      notes: k.notes || "",
      source: "matrix",
    };
  }

  function isKitPendingSuggestion(kitId, poleToken) {
    if (!kitId) return false;
    var PS = global.SlmPoleScope;
    if (!PS) return false;
    return PS.isPendingForLeaf(loadPendingMap(), kitId, poleToken || "");
  }

  function kitPublishStatus(k) {
    if (!k || k.enabled === false) return "off";
    var tok = activePoleToken(k);
    if (isKitPendingSuggestion(k.id, tok)) return "suggested";
    var recipe = resolvedRecipeForLeaf(k);
    if (recipe.enabled === false) return "off";
    if (!(recipe.lines || []).length) return "empty";
    if (recipe.complete) return "final";
    return "draft";
  }

  function kitPublishLabel(st) {
    if (st === "final") return "Final";
    if (st === "suggested") return "Suggested";
    if (st === "draft") return "Draft";
    if (st === "off") return "Off";
    return "Empty";
  }

  function statusPillHtml(k, stOpt) {
    var st = stOpt || kitPublishStatus(k);
    return (
      '<span class="dk-st-status dk-st-status-' +
      st +
      '" title="' +
      (st === "final"
        ? "Finalized by admin — used in BOQ"
        : st === "suggested"
          ? "Suggestion waiting for admin review"
          : st === "draft"
            ? "Draft — suggested or not yet finalized"
            : st === "off"
              ? "Disabled"
              : "No recipe lines yet") +
      '">' +
      esc(kitPublishLabel(st)) +
      "</span>"
    );
  }

  function renderDetail(host) {
    var k = state.selected;
    if (!k) {
      state.mode = "browse";
      host.classList.remove("is-editing");
      host.innerHTML =
        '<div class="dk-detail-empty">' +
        "<strong>Kit detail</strong>" +
        "<p>Select a kit in the middle pane to review its recipe.</p>" +
        namingGuideHtml({ open: true, highlight: true }) +
        "</div>";
      return;
    }

    // In-place editor inside the detail pane — tree + kits stay put.
    if (state.mode === "edit" && canEdit()) {
      state.pendingKitId = k.id;
      host.classList.add("is-editing");
      host.innerHTML =
        '<div class="dk-st-detail dk-st-detail-edit">' +
        '<div class="dk-st-edit-bar">' +
        '<button type="button" class="dk-btn dk-btn-sm" id="dkBackBrowse" title="Back to recipe">← Recipe</button>' +
        '<div class="dk-st-edit-bar-meta">' +
        '<span class="dk-st-type-pill">' +
        esc(kitType(k)) +
        "</span>" +
        '<span class="dk-st-band-pill">' +
        esc(activePoleMaterial(k)) +
        "</span>" +
        '<strong class="dk-st-edit-title">' +
        esc(kitTitle(k)) +
        "</strong>" +
        '<span class="dk-st-edit-sub">' +
        esc(detailPath(k)) +
        "</span></div></div>" +
        '<iframe class="dk-st-edit-frame" id="dkStEditFrame" title="Edit kit" src="../estimate/?embed=1&solo=1&theme=desk&kit=' +
        encodeURIComponent(k.id || "") +
        "&pole=" +
        encodeURIComponent(activePoleToken(k) || "") +
        '"></iframe></div>';
      wireSoloMessages();
      var shell = document.getElementById("dkStPage");
      if (shell) applyColWidths(shell);
      var back = host.querySelector("#dkBackBrowse");
      if (back) {
        back.addEventListener("click", function () {
          leaveEdit();
        });
      }
      return;
    }

    host.classList.remove("is-editing");
    var recipe = resolvedRecipeForLeaf(k);
    var lines = recipe.lines || [];
    var materials = [];
    var labour = [];
    lines.forEach(function (l) {
      if (lineIsLabour(l)) labour.push(l);
      else materials.push(l);
    });

    var type = kitType(k);

    host.innerHTML =
      '<div class="dk-st-detail">' +
      '<div class="dk-st-drawer-head">' +
      '<div class="dk-st-detail-top">' +
      '<span class="dk-st-type-pill">' +
      esc(type) +
      "</span>" +
      '<span class="dk-st-band-pill">' +
      esc(activePoleMaterial(k)) +
      "</span>" +
      statusPillHtml(k) +
      "</div></div>" +
      "<h2>" +
      esc(kitTitle(k)) +
      "</h2>" +
      '<p class="dk-st-detail-line">' +
      esc(detailPath(k)) +
      "</p>" +
      (recipe.source === "pending"
        ? '<p class="dk-st-pending-note">Showing <strong>proposed</strong> materials from the pending suggestion — Accept to merge, or open Estimate → Suggestions.</p>'
        : "") +
      '<p class="dk-st-detail-meta">' +
      lines.length +
      " lines · Pole " +
      esc(activePoleMaterial(k)) +
      (canEdit()
        ? kitPublishStatus(k) === "draft"
          ? " · Draft until an approver marks Final"
          : kitPublishStatus(k) === "suggested"
            ? " · Suggestion pending review"
            : kitPublishStatus(k) === "final"
              ? " · Finalized for estimate"
              : ""
        : kitPublishStatus(k) === "final"
          ? " · Finalized for estimate"
          : "") +
      "</p>" +
      '<div class="dk-st-detail-actions">' +
      '<button type="button" class="dk-btn dk-btn-primary" id="dkCopyMyKit" title="Save a personal copy on this computer">' +
      (isMyKit(k) ? "Update My Kit" : "Copy to My Kits") +
      "</button>" +
      (canEdit()
        ? '<button type="button" class="dk-btn dk-btn-ghost" id="dkEditKit">Edit kit</button>'
        : "") +
      "</div>" +
      (kitPublishStatus(k) === "suggested" && canApproveOnDesk()
        ? '<div class="dk-st-review-bar" id="dkReviewBar">' +
          '<p class="dk-st-review-label">Pending suggestion — review</p>' +
          '<div class="dk-st-review-actions">' +
          '<button type="button" class="dk-btn dk-btn-primary" id="dkAcceptFinal">Accept as Final</button>' +
          '<button type="button" class="dk-btn dk-btn-ghost" id="dkAcceptDraft">Accept as Draft</button>' +
          '<button type="button" class="dk-btn dk-btn-danger" id="dkRejectSug">Reject</button>' +
          "</div></div>"
        : "") +
      '<div class="dk-st-recipe">' +
      recipeGroupHtml("Materials", materials) +
      recipeGroupHtml("Labour", labour) +
      "</div></div>";

    var copyBtn = host.querySelector("#dkCopyMyKit");
    if (copyBtn) {
      copyBtn.addEventListener("click", function () {
        copyKitToMyKits(k);
      });
    }

    var edit = host.querySelector("#dkEditKit");
    if (edit) {
      edit.addEventListener("click", function () {
        state.mode = "edit";
        state.pendingKitId = k.id;
        softRefresh();
      });
    }

    function wireReview(btnId, action, asFinal) {
      var btn = host.querySelector(btnId);
      if (!btn) return;
      btn.addEventListener("click", function () {
        var tok = activePoleToken(k);
        var row = pendingRowForKit(k.id, tok);
        var ensureRow = row
          ? Promise.resolve(row)
          : syncPendingSuggestions(true).then(function () {
              return pendingRowForKit(k.id, tok);
            });
        ensureRow.then(function (sug) {
          if (!sug || !sug.id) {
            Desk.toast(
              "No pending suggestion for this pole (" +
                (tok || "—") +
                ") — Refresh Suggested"
            );
            return;
          }
          reviewDeskSuggestion(sug.id, action, asFinal);
        });
      });
    }
    wireReview("#dkAcceptFinal", "accept", true);
    wireReview("#dkAcceptDraft", "accept", false);
    wireReview("#dkRejectSug", "reject", false);
  }

  function selectKitById(kitId) {
    if (!kitId) return false;
    var hit = allKits().find(function (k) {
      return String(k.id) === String(kitId);
    });
    if (!hit) return false;
    state.selected = hit;
    var mats = kitPoleMaterials(hit);
    state.selectedPoleMaterial = mats[0] || null;
    state.selectedPoleToken = state.selectedPoleMaterial
      ? preferredTokenForMaterial(state.selectedPoleMaterial, hit)
      : null;
    var v = kitVoltage(hit);
    if (v) {
      if (/^LT$/i.test(v)) state.voltage = "LT";
      else if (/33/i.test(v)) state.voltage = "33kV";
      else if (/11/i.test(v)) state.voltage = "11kV";
    }
    if (isMyKit(hit)) state.panel = "mykits";
    else state.panel = "catalog";
    // Focus deepest tree path for this kit
    var poleMat = state.selectedPoleMaterial || "Unspecified pole";
    if (isMyKit(hit)) {
      var myV = kitVoltage(hit) || state.voltage || "—";
      if (/^LT$/i.test(myV)) myV = "LT";
      else if (/33/i.test(myV)) myV = "33kV";
      else if (/11/i.test(myV)) myV = "11kV";
      if (kitFamily(hit) === "structure") {
        state.focusKey =
          "my:My Kits/mv:" +
          myV +
          "/t:" +
          kitType(hit) +
          "/p:" +
          posLabel(hit) +
          "/a:" +
          arrLabel(hit.arrangement) +
          "/pole:" +
          encodeURIComponent(poleMat);
      } else {
        state.focusKey =
          "my:My Kits/mv:" +
          myV +
          "/o:" +
          (kitFamily(hit) === "conductor" ? "Conductors" : "Add-ons");
      }
    } else if (kitFamily(hit) === "structure") {
      state.focusKey =
        "v:" +
        state.voltage +
        "/t:" +
        kitType(hit) +
        "/p:" +
        posLabel(hit) +
        "/a:" +
        arrLabel(hit.arrangement) +
        "/pole:" +
        encodeURIComponent(poleMat);
    } else {
      state.focusKey =
        "v:" +
        state.voltage +
        "/o:" +
        (kitFamily(hit) === "conductor" ? "Conductors" : "Add-ons");
    }
    state.pendingKitId = null;
    return true;
  }

  function openKit(kitId) {
    state.pendingKitId = kitId || null;
    state.mode = "browse";
    if (state.matrix && kitId) selectKitById(kitId);
    Desk.go("structures");
  }

  function openKitEdit(kitId) {
    state.pendingKitId = kitId || null;
    if (state.matrix && kitId) selectKitById(kitId);
    state.mode = canEdit() ? "edit" : "browse";
    Desk.go("structures");
  }

  function leafHtml(k) {
    var selected =
      state.selected &&
      String(state.selected.id) === String(k.id) &&
      (!k._poleMaterial ||
        String(state.selectedPoleMaterial || "") === String(k._poleMaterial || ""));
    var recipe = resolvedRecipeForLeaf(k);
    var n = (recipe.lines || []).length;
    var title = kitTitle(k);
    var st = kitPublishStatus(k);
    return (
      '<button type="button" class="dk-st-leaf is-' +
      st +
      (selected ? " is-selected" : "") +
      '" data-id="' +
      esc(k.id) +
      '" data-pole="' +
      esc(k._poleMaterial || "") +
      '" data-pole-token="' +
      esc(k._poleToken || "") +
      '" title="' +
      esc(title + (k._poleMaterial ? " · " + k._poleMaterial : "") + " · " + kitPublishLabel(st)) +
      '">' +
      '<span class="dk-st-leaf-main">' +
      '<span class="dk-st-leaf-title">' +
      esc(title) +
      "</span>" +
      statusPillHtml(k, st) +
      "</span>" +
      '<span class="dk-st-leaf-n">' +
      n +
      "</span></button>"
    );
  }

  /** Structure tree only — kits open in the wider middle pane. */
  function treeGroupHtml(node, depth, siblings, index) {
    var collapsed = isCollapsed(node.key);
    var focused = state.focusKey === node.key;
    var isLast = index === siblings.length - 1;
    var kidsHtml = "";
    var childList = node.ordered || [];
    if (childList.length) {
      kidsHtml = childList
        .map(function (ch, i) {
          return treeGroupHtml(ch, depth + 1, childList, i);
        })
        .join("");
    }

    return (
      '<div class="dk-st-tree-node' +
      (isLast ? " is-last" : "") +
      (focused ? " is-focused" : "") +
      (node.kind === "mykits" ? " is-mykits" : "") +
      (node.kind === "catalog" ? " is-catalog" : "") +
      '" data-depth="' +
      depth +
      '" data-kind="' +
      esc(node.kind || "") +
      '">' +
      '<div class="dk-st-tree-row">' +
      '<button type="button" class="dk-st-tree-twist" data-twist="' +
      esc(node.key) +
      '" aria-label="Toggle">' +
      (childList.length ? (collapsed ? "▸" : "▾") : "·") +
      "</button>" +
      '<button type="button" class="dk-st-tree-head' +
      (focused ? " is-on" : "") +
      '" data-focus="' +
      esc(node.key) +
      '">' +
      '<span class="dk-st-tree-label">' +
      esc(node.label) +
      '</span><span class="dk-st-tree-count">(' +
      node.count +
      ")</span></button></div>" +
      '<div class="dk-st-tree-kids' +
      (collapsed ? " is-collapsed" : "") +
      '">' +
      kidsHtml +
      "</div></div>"
    );
  }

  function setVoltage(v) {
    if (!v) return;
    state.panel = "catalog";
    state.voltage = v;
    state.selected = null;
    state.selectedPoleMaterial = null;
    state.selectedPoleToken = null;
    state.focusKey = null;
    state.mode = "browse";
    state.pendingKitId = null;
    if (Desk.syncTools) Desk.syncTools();
    softRefresh();
  }

  function setMyKitsPanel() {
    state.panel = "mykits";
    state.selected = null;
    state.selectedPoleMaterial = null;
    state.selectedPoleToken = null;
    state.focusKey = null;
    state.mode = "browse";
    state.pendingKitId = null;
    if (Desk.syncTools) Desk.syncTools();
    softRefresh();
  }

  /** Re-paint Structures in place — avoid full desk remount / loading flash. */
  function softRefresh() {
    if (!state.matrix || !(Desk.active && Desk.active() === "structures")) {
      Desk.refresh();
      return;
    }
    var host = document.getElementById("dkMain");
    var page = host && host.querySelector(".dk-page");
    if (!page) {
      Desk.refresh();
      return;
    }
    var tree = page.querySelector(".dk-st-gallery");
    var list = page.querySelector("#dkKitList");
    var treeScroll = tree ? tree.scrollTop : 0;
    var listScroll = list ? list.scrollTop : 0;
    try {
      renderBrowse(page);
    } catch (err) {
      console.error(err);
      Desk.refresh();
      return;
    }
    tree = page.querySelector(".dk-st-gallery");
    list = page.querySelector("#dkKitList");
    if (tree) tree.scrollTop = treeScroll;
    if (list) list.scrollTop = listScroll;
  }

  function countStatusIn(kits) {
    var out = { all: kits.length, draft: 0, suggested: 0, final: 0, empty: 0, off: 0 };
    kits.forEach(function (k) {
      var st = kitPublishStatus(k);
      if (out[st] != null) out[st] += 1;
    });
    return out;
  }

  function statusFilterTabsHtml(counts) {
    var tabs = [
      { id: "", label: "All", n: counts.all },
      { id: "final", label: "Final", n: counts.final },
    ];
    // Draft / Suggested are maker workflow — hide from simple viewers.
    if (canEdit()) {
      tabs.splice(
        1,
        0,
        { id: "draft", label: "Draft", n: counts.draft },
        { id: "suggested", label: "Suggested", n: counts.suggested }
      );
    } else if (
      state.statusFilter === "draft" ||
      state.statusFilter === "suggested"
    ) {
      state.statusFilter = "";
    }
    return (
      '<div class="dk-st-status-tabs" role="tablist" aria-label="Kit status filter">' +
      tabs
        .map(function (t) {
          return (
            '<button type="button" class="dk-st-status-tab is-' +
            (t.id || "all") +
            (state.statusFilter === t.id ? " is-on" : "") +
            '" data-status-filter="' +
            esc(t.id) +
            '" role="tab" aria-selected="' +
            (state.statusFilter === t.id ? "true" : "false") +
            '">' +
            esc(t.label) +
            '<span class="dk-st-status-tab-n">' +
            t.n +
            "</span></button>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function renderBrowse(page) {
    if (state.pendingKitId) selectKitById(state.pendingKitId);
    var kits = filtered();
    var tree = buildTree(kits);
    if (!state.focusKey || !findNode(tree, state.focusKey)) {
      var firstTop = tree.ordered && tree.ordered[0];
      if (state.panel === "mykits" && firstTop) {
        // Voltage → first type group
        state.focusKey =
          (firstTop.ordered && firstTop.ordered[0] && firstTop.ordered[0].key) ||
          firstTop.key;
      } else if (firstTop) {
        state.focusKey = firstTop.key;
      } else {
        state.focusKey = tree.key;
      }
    }
    var focusNode = findNode(tree, state.focusKey) || tree;
    var focusKits = collectKits(focusNode);
    var statusCounts = countStatusIn(focusKits);
    var visibleKits = state.statusFilter
      ? focusKits.filter(function (k) {
          return kitPublishStatus(k) === state.statusFilter;
        })
      : focusKits;

    var treeHtml = (tree.ordered || [])
      .map(function (n, i) {
        return treeGroupHtml(n, 0, tree.ordered, i);
      })
      .join("");

    var headTitle = state.panel === "mykits" ? "My Kits" : "Structures";
    var headBadge =
      state.panel === "mykits"
        ? '<span class="dk-st-rail-volt is-mykits" title="Your personal kit copies">Personal</span>'
        : '<span class="dk-st-rail-volt" title="Catalog voltage filter">' +
          esc(state.voltage) +
          "</span>";
    var emptyTree =
      state.panel === "mykits"
        ? "No My Kits yet. Select a catalog kit (33kV / 11kV / LT) and tap Copy to My Kits."
        : "No kits";

    page.innerHTML =
      '<div class="dk-st-page" id="dkStPage">' +
      '<section class="dk-st-col dk-st-col-tree">' +
      '<div class="dk-st-col-head"><h1>' +
      esc(headTitle) +
      "</h1>" +
      headBadge +
      '<input class="dk-search dk-st-search" id="dkKitQ" placeholder="Search…" value="' +
      esc(state.q) +
      '"></div>' +
      '<div class="dk-st-gallery">' +
      (!(tree.ordered && tree.ordered.length)
        ? '<div class="dk-st-empty">' + esc(emptyTree) + "</div>"
        : '<div class="dk-st-tree">' + treeHtml + "</div>") +
      "</div></section>" +
      '<div class="dk-st-split" data-split="tree" role="separator" aria-orientation="vertical" aria-label="Resize tree" tabindex="0"></div>' +
      '<section class="dk-st-col dk-st-col-kits">' +
      '<div class="dk-st-col-head"><h2>Kits</h2>' +
      '<span class="dk-st-col-sub">' +
      esc(focusPath(focusNode)) +
      " · " +
      visibleKits.length +
      (state.statusFilter ? " / " + focusKits.length : "") +
      "</span>" +
      namingGuideHtml() +
      "</div>" +
      statusFilterTabsHtml(statusCounts) +
      '<div class="dk-st-kit-list" id="dkKitList">' +
      (visibleKits.length
        ? visibleKits.map(leafHtml).join("")
        : '<div class="dk-st-empty">' +
          (focusKits.length
            ? "No " +
              (state.statusFilter || "matching") +
              " kits in this group."
            : state.panel === "mykits"
              ? esc(emptyTree)
              : "No kits in this group.") +
          "</div>") +
      "</div></section>" +
      '<div class="dk-st-split" data-split="detail" role="separator" aria-orientation="vertical" aria-label="Resize detail" tabindex="0"></div>' +
      '<aside class="dk-st-col dk-st-col-detail" id="dkKitDetail" aria-label="Kit detail"></aside>' +
      "</div>";

    wireColumnResize(page.querySelector("#dkStPage"));

    page.querySelectorAll("[data-status-filter]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.statusFilter = btn.getAttribute("data-status-filter") || "";
        if (state.statusFilter === "suggested") {
          syncPendingSuggestions(true).then(function () {
            softRefresh();
          });
          return;
        }
        softRefresh();
      });
    });

    page.querySelectorAll("[data-twist]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var key = btn.getAttribute("data-twist");
        var node = findNode(tree, key);
        if (node && !(node.ordered && node.ordered.length)) return;
        toggleCollapsed(key);
        var row = btn.closest(".dk-st-tree-node");
        var kids = row && row.querySelector(":scope > .dk-st-tree-kids");
        var collapsed = !!(state.collapsed && state.collapsed[key]);
        if (kids) kids.classList.toggle("is-collapsed", collapsed);
        btn.textContent = collapsed ? "▸" : "▾";
      });
    });

    page.querySelectorAll("[data-focus]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.focusKey = btn.getAttribute("data-focus");
        // Expand ancestors by clearing collapse on path
        var key = state.focusKey;
        while (key) {
          state.collapsed[key] = false;
          var slash = key.lastIndexOf("/");
          key = slash >= 0 ? key.slice(0, slash) : "";
        }
        softRefresh();
      });
    });

    page.querySelectorAll(".dk-st-leaf").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-id");
        var poleMat = btn.getAttribute("data-pole") || "";
        var poleTok = btn.getAttribute("data-pole-token") || "";
        var next = allKits().find(function (k) {
          return String(k.id) === String(id);
        });
        if (!next) return;
        var stamped = Object.assign({}, next, {
          _poleMaterial: poleMat || null,
          _poleToken: poleTok || null,
          activePoleToken: poleTok || next.poleToken,
        });
        var same =
          state.selected &&
          String(state.selected.id) === String(id) &&
          String(state.selectedPoleMaterial || "") === String(poleMat || "");
        // While editing, switch the in-pane editor to the clicked kit.
        if (state.mode === "edit") {
          state.selected = stamped;
          state.selectedPoleMaterial = poleMat || null;
          state.selectedPoleToken = poleTok || null;
          state.pendingKitId = next.id;
          softRefresh();
          return;
        }
        if (same) {
          state.selected = null;
          state.selectedPoleMaterial = null;
          state.selectedPoleToken = null;
        } else {
          state.selected = stamped;
          state.selectedPoleMaterial = poleMat || null;
          state.selectedPoleToken = poleTok || null;
        }
        // Browse: update selection + detail only — skip full tree rebuild.
        page.querySelectorAll(".dk-st-leaf.is-selected").forEach(function (el) {
          el.classList.remove("is-selected");
        });
        if (state.selected) btn.classList.add("is-selected");
        renderDetail(page.querySelector("#dkKitDetail"));
      });
    });

    page.querySelector("#dkKitQ").addEventListener("input", function (e) {
      state.q = e.target.value;
      clearTimeout(renderBrowse._t);
      renderBrowse._t = setTimeout(function () {
        softRefresh();
      }, 200);
    });

    renderDetail(page.querySelector("#dkKitDetail"));
  }

  function leaveEdit(opts) {
    opts = opts || {};
    var kitId =
      state.pendingKitId || (state.selected && state.selected.id) || null;
    state.mode = "browse";
    var refresh = function () {
      if (kitId) {
        var fresh = allKits().find(function (k) {
          return String(k.id) === String(kitId);
        });
        if (fresh) {
          state.selected = Object.assign({}, fresh, {
            _poleMaterial: state.selectedPoleMaterial || null,
            _poleToken: state.selectedPoleToken || null,
            activePoleToken: state.selectedPoleToken || fresh.poleToken,
          });
        }
      }
      softRefresh();
    };
    var catReload =
      Cat && Cat.reload
        ? Cat.reload()
        : Cat && Cat.load
          ? Cat.load(true)
          : Promise.resolve();
    Promise.all([loadMatrix(true), catReload])
      .then(refresh)
      .catch(refresh);
    if (opts.toast) Desk.toast(opts.toast);
  }

  function wireSoloMessages() {
    if (wireSoloMessages._bound) return;
    wireSoloMessages._bound = true;
    window.addEventListener("message", function (ev) {
      if (!ev.data) return;
      if (state.mode !== "edit") return;
      if (ev.data.type === "slm_kit_solo_saved") {
        Desk.toast(
          ev.data.myKitId ? "Saved · copy in My Kits" : "Kit saved"
        );
        // Reload so Structures → My Kits shows the copy after leaving edit.
        loadMatrix(true).catch(function () {});
        return;
      }
      if (ev.data.type === "slm_kit_solo_suggested") {
        Desk.toast("Suggestion sent — marked Suggested");
        leaveEdit();
        return;
      }
      if (ev.data.type === "slm_kit_solo_done") {
        leaveEdit();
      }
    });
  }

  function render(host) {
    var page = document.createElement("div");
    page.className = "dk-page";
    host.appendChild(page);
    // Instant paint when matrix already in memory (voltage switch / re-entry).
    if (state.matrix) {
      try {
        renderBrowse(page);
      } catch (err) {
        console.error(err);
        page.innerHTML =
          '<div class="dk-blank"><h2>Could not render kits</h2><p>Check the browser console for details.</p></div>';
      }
      syncPendingSuggestions(false).catch(function () {});
      return;
    }
    page.innerHTML = '<div class="dk-blank"><h2>Loading structures…</h2></div>';
    var painted = false;
    var paint = function () {
      if (painted) return;
      painted = true;
      loadMatrix()
        .then(function () {
          page.innerHTML = "";
          try {
            renderBrowse(page);
          } catch (err) {
            console.error(err);
            page.innerHTML =
              '<div class="dk-blank"><h2>Could not render kits</h2><p>Check the browser console for details.</p></div>';
          }
        })
        .catch(function () {
          page.innerHTML =
            '<div class="dk-blank"><h2>Could not load kits</h2><p>Check estimate/kit-matrix.json</p></div>';
        });
    };
    // Never block the tree on a slow/hung suggestions sync.
    paint();
    syncPendingSuggestions(false).catch(function () {});
  }

  Desk.register("structures", {
    tools: function () {
      var volts = ["33kV", "11kV", "LT"].map(function (v) {
        return {
          label: v,
          active: state.panel === "catalog" && state.voltage === v,
          onClick: function () {
            setVoltage(v);
          },
        };
      });
      return [
        {
          label: "My Kits",
          active: state.panel === "mykits",
          onClick: function () {
            setMyKitsPanel();
          },
        },
        { kind: "sep" },
      ].concat(volts);
    },
    render: render,
    openKit: openKit,
    openKitEdit: openKitEdit,
  });

  if (!global.__slmPendingKitsWired) {
    global.__slmPendingKitsWired = true;
    window.addEventListener("slm-pending-kits-changed", function () {
      if (Desk.active && Desk.active() === "structures") softRefresh();
    });
    window.addEventListener("storage", function (ev) {
      if (ev.key === PENDING_KITS_KEY && Desk.active && Desk.active() === "structures") {
        pendingCache.raw = null;
        pendingCache.map = null;
        softRefresh();
      }
    });
  }

  // Prefetch ~6MB matrix while user is on Map — Structures opens warm.
  loadMatrix().catch(function () {});

  global.SlmStructuresDesk = {
    openKit: openKit,
    openKitEdit: openKitEdit,
  };
})(window);
