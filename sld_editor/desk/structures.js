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

  function writePendingFromSuggestions(rows) {
    pendingSuggestionRows = (rows || []).filter(function (s) {
      return s && s.status === "pending" && s.kit_id;
    });
    var next = {};
    pendingSuggestionRows.forEach(function (s) {
      var prop = s.proposed || {};
      next[String(s.kit_id)] = {
        poleToken: String(prop.poleToken || prop.pole_token || "").trim(),
        poleMaterial: String(prop.poleMaterial || prop.pole_material || "").trim(),
        label: String(s.kit_label || "").trim(),
        suggestionId: String(s.id || ""),
      };
    });
    try {
      var encoded = JSON.stringify(next);
      var prev = localStorage.getItem(PENDING_KITS_KEY) || "";
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

  function pendingRowForKit(kitId) {
    var id = String(kitId || "");
    for (var i = 0; i < pendingSuggestionRows.length; i++) {
      if (String(pendingSuggestionRows[i].kit_id) === id) {
        return pendingSuggestionRows[i];
      }
    }
    return null;
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
    hit.enabled = proposed.enabled !== false;
    hit.complete = !!asFinal;
    hit.notes = String(proposed.notes || "");
    hit.lines = Array.isArray(proposed.lines)
      ? proposed.lines.map(function (l) {
          return {
            code: l.code,
            qty: Number(l.qty) || 0,
            type: l.type,
          };
        })
      : [];
    if (asFinal && !hit.lines.length) hit.complete = false;
    try {
      var edits = JSON.parse(localStorage.getItem(EDITS_KEY) || "{}") || {};
      edits[kitId] = {
        enabled: hit.enabled,
        complete: hit.complete,
        lines: hit.lines,
        notes: hit.notes || "",
      };
      localStorage.setItem(EDITS_KEY, JSON.stringify(edits));
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
          Desk.refresh();
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
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (json) {
        pendingSync.loading = false;
        pendingSync.lastAt = Date.now();
        if (!json || !json.ok) return false;
        writePendingFromSuggestions(json.suggestions || []);
        return true;
      })
      .catch(function () {
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
    if (/^DTR/i.test(st) || k.isDtr) return "DTR";
    if (/^1NP$/i.test(st) || /^P1N$/i.test(st)) return "1NP";
    var m = st.match(/^(1P|2P|3P|4P)\b/i);
    if (m) return m[1].toUpperCase();
    // Fall back: structureLabel like "DTR on 2P" already handled; plain ids next.
    if (TYPE_ORDER.indexOf(st) >= 0) return st;
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

  function namingGuideHtml() {
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
      '<details class="dk-st-name-guide">' +
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
      if (!matchesVoltage(k)) return false;
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
   * Tree: Voltage → Type (1P…DTR) → Position → Arrangement → Pole → kits
   * (voltage is the selected rail filter; shown as root for the path)
   */
  function buildTree(kits) {
    var root = {
      key: "v:" + state.voltage,
      label: state.voltage,
      kits: [],
      children: Object.create(null),
    };

    kits.forEach(function (k) {
      var family = kitFamily(k);
      if (isMyKit(k)) {
        var myKey = "My Kits";
        if (!root.children[myKey]) {
          root.children[myKey] = {
            key: root.key + "/o:" + myKey,
            label: myKey,
            kits: [],
            children: Object.create(null),
            kind: "other",
          };
        }
        root.children[myKey].kits.push(k);
        return;
      }
      if (family !== "structure") {
        var otherKey = family === "conductor" ? "Conductors" : "Add-ons";
        if (!root.children[otherKey]) {
          root.children[otherKey] = {
            key: root.key + "/o:" + otherKey,
            label: otherKey,
            kits: [],
            children: Object.create(null),
            kind: "other",
          };
        }
        root.children[otherKey].kits.push(k);
        return;
      }

      var type = kitType(k);
      var pos = posLabel(k);
      var arr = arrLabel(k.arrangement);
      var mats = kitPoleMaterials(k);
      if (!mats.length) mats = ["Unspecified pole"];

      if (!root.children[type]) {
        root.children[type] = {
          key: root.key + "/t:" + type,
          label: type,
          kits: [],
          children: Object.create(null),
          kind: "type",
        };
      }
      var typeNode = root.children[type];

      if (!typeNode.children[pos]) {
        typeNode.children[pos] = {
          key: typeNode.key + "/p:" + pos,
          label: pos,
          kits: [],
          children: Object.create(null),
          kind: "position",
        };
      }
      var posNode = typeNode.children[pos];

      if (!posNode.children[arr]) {
        posNode.children[arr] = {
          key: posNode.key + "/a:" + arr,
          label: arr,
          kits: [],
          children: Object.create(null),
          kind: "arrangement",
        };
      }
      var arrNode = posNode.children[arr];

      mats.forEach(function (mat) {
        var tok = preferredTokenForMaterial(mat, k);
        var pk = mat;
        if (!arrNode.children[pk]) {
          arrNode.children[pk] = {
            key: arrNode.key + "/pole:" + encodeURIComponent(mat),
            label: mat,
            kits: [],
            children: Object.create(null),
            kind: "pole",
            poleMaterial: mat,
            poleToken: tok,
          };
        }
        // Stamp material on a shallow copy so list/detail know the pole type.
        arrNode.children[pk].kits.push(
          Object.assign({}, k, {
            _poleMaterial: mat,
            _poleToken: tok,
            activePoleToken: tok,
          })
        );
      });
    });

    function countNode(node) {
      var n = node.kits.length;
      Object.keys(node.children).forEach(function (ck) {
        n += countNode(node.children[ck]);
      });
      node.count = n;
      return n;
    }
    countNode(root);

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

    root.ordered = childList(
      root,
      ["My Kits"].concat(TYPE_ORDER).concat(["Conductors", "Add-ons"]),
      function (n, k) {
        return n.kind === "other" ? n.label : k;
      }
    );
    root.ordered.forEach(function (typeNode) {
      if (typeNode.kind === "other") {
        typeNode.kits.sort(function (a, b) {
          var la = String(a.customLabel || a.label || a.id || "");
          var lb = String(b.customLabel || b.label || b.id || "");
          return la.localeCompare(lb);
        });
        return;
      }
      typeNode.ordered = childList(typeNode, POS_ORDER, function (n) {
        return n.label;
      });
      typeNode.ordered.forEach(function (posNode) {
        posNode.ordered = childList(posNode, ARR_ORDER, function (n) {
          return n.label;
        });
        posNode.ordered.forEach(function (arrNode) {
          var poleOrder = poleMaterialsForVoltage(state.voltage);
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
              return String(a.id || "").localeCompare(String(b.id || ""));
            });
          });
        });
      });
    });

    return root;
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
        if (p.indexOf("v:") === 0) return p.slice(2);
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
    var edits = {};
    try {
      edits = JSON.parse(localStorage.getItem(EDITS_KEY) || "{}") || {};
    } catch (e) {
      edits = {};
    }
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

  function loadMatrix(force) {
    if (force) state.matrix = null;
    if (state.matrix) {
      applyLocalEdits(state.matrix);
      return Promise.resolve(state.matrix);
    }
    var loadCat = Cat && Cat.load ? Cat.load(force).catch(function () {}) : Promise.resolve();
    return Promise.all([
      fetch(MATRIX_URL).then(function (r) {
        return r.json();
      }),
      loadCat,
    ]).then(function (pair) {
      state.matrix = applyLocalEdits(pair[0]);
      return state.matrix;
    });
  }

  function canEdit() {
    var L = global.SlmLicense;
    if (!L || !L.enabled) return true;
    return !!(L.canEditKits && L.canEditKits());
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

  function isKitPendingSuggestion(kitId, poleToken, poleMaterial) {
    if (!kitId) return false;
    try {
      var raw = JSON.parse(localStorage.getItem(PENDING_KITS_KEY) || "{}");
      var meta = raw[String(kitId)];
      if (!meta) return false;
      if (meta === true) meta = { poleToken: "", poleMaterial: "", label: "" };

      var wantTok = String(meta.poleToken || "").trim();
      var wantMat = String(meta.poleMaterial || "").trim();
      var wantAbbr = "";
      String(meta.label || "")
        .split("-")
        .forEach(function (p) {
          if (/^(8M|9M|RL|HP|S9|S11|T9|T95|T11)$/i.test(p)) {
            wantAbbr = String(p).toUpperCase();
            if (wantAbbr === "T9" || wantAbbr === "T95") wantAbbr = "S9";
            if (wantAbbr === "T11") wantAbbr = "S11";
          }
        });
      if (wantTok === "T9" || wantTok === "T95") wantAbbr = wantAbbr || "S9";
      if (wantTok === "T11") wantAbbr = wantAbbr || "S11";
      if (wantTok === "8M" || wantTok === "9M" || wantTok === "RL" || wantTok === "HP") {
        wantAbbr = wantAbbr || wantTok;
      }
      if (wantTok === "S9" || wantTok === "S11") wantAbbr = wantAbbr || wantTok;

      // No pole on suggestion → still mark this kit's leaves (legacy / unscoped).
      if (!wantTok && !wantMat && !wantAbbr) {
        return true;
      }

      var leafTok = String(poleToken || "").trim();
      var leafMat = String(poleMaterial || "").trim();
      var leafAbbr = "";
      if (global.SlmKitName && global.SlmKitName.poleAbbr) {
        leafAbbr =
          global.SlmKitName.poleAbbr({
            _poleMaterial: leafMat,
            poleMaterial: leafMat,
            _poleToken: leafTok,
            poleToken: leafTok,
            activePoleToken: leafTok,
          }) || "";
      } else {
        leafAbbr = leafTok.toUpperCase();
      }
      if (wantTok && leafTok && wantTok === leafTok) return true;
      if (wantMat && leafMat && wantMat === leafMat) return true;
      if (
        wantAbbr &&
        leafAbbr &&
        String(wantAbbr).toUpperCase() === String(leafAbbr).toUpperCase()
      ) {
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  function kitPublishStatus(k) {
    if (!k || k.enabled === false) return "off";
    if (!(k.lines || []).length) return "empty";
    if (
      isKitPendingSuggestion(
        k.id,
        k._poleToken || k.activePoleToken || "",
        k._poleMaterial || ""
      )
    ) {
      return "suggested";
    }
    if (k.complete) return "final";
    return "draft";
  }

  function kitPublishLabel(st) {
    if (st === "final") return "Final";
    if (st === "suggested") return "Suggested";
    if (st === "draft") return "Draft";
    if (st === "off") return "Off";
    return "Empty";
  }

  function statusPillHtml(k) {
    var st = kitPublishStatus(k);
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
      host.innerHTML =
        '<div class="dk-detail-empty">' +
        "<strong>Kit detail</strong>" +
        "<p>Select a kit in the middle pane to review its recipe.</p>" +
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
    var lines = k.lines || [];
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
      (canEdit()
        ? '<button type="button" class="dk-btn dk-btn-primary" id="dkEditKit">Edit kit</button>'
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

    var edit = host.querySelector("#dkEditKit");
    if (edit) {
      edit.addEventListener("click", function () {
        state.mode = "edit";
        state.pendingKitId = k.id;
        Desk.refresh();
      });
    }

    function wireReview(btnId, action, asFinal) {
      var btn = host.querySelector(btnId);
      if (!btn) return;
      btn.addEventListener("click", function () {
        var row = pendingRowForKit(k.id);
        var ensureRow = row
          ? Promise.resolve(row)
          : syncPendingSuggestions(true).then(function () {
              return pendingRowForKit(k.id);
            });
        ensureRow.then(function (sug) {
          if (!sug || !sug.id) {
            Desk.toast("No pending suggestion found for this kit — Refresh Suggested");
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
    // Focus deepest tree path for this kit
    if (kitFamily(hit) === "structure") {
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
        encodeURIComponent(state.selectedPoleMaterial || "Unspecified pole");
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
    var n = (k.lines || []).length;
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
      statusPillHtml(k) +
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
      '" data-depth="' +
      depth +
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
    state.voltage = v;
    state.selected = null;
    state.selectedPoleMaterial = null;
    state.selectedPoleToken = null;
    state.focusKey = "v:" + v;
    state.mode = "browse";
    state.pendingKitId = null;
    Desk.refresh();
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
      state.focusKey = tree.key;
    }
    var focusNode = findNode(tree, state.focusKey) || tree;
    var focusKits = collectKits(focusNode);
    var statusCounts = countStatusIn(focusKits);
    var visibleKits = state.statusFilter
      ? focusKits.filter(function (k) {
          return kitPublishStatus(k) === state.statusFilter;
        })
      : focusKits;

    page.innerHTML =
      '<div class="dk-st-page" id="dkStPage">' +
      '<section class="dk-st-col dk-st-col-tree">' +
      '<div class="dk-st-col-head"><h1>' +
      esc(state.voltage) +
      '</h1><input class="dk-search dk-st-search" id="dkKitQ" placeholder="Search…" value="' +
      esc(state.q) +
      '"></div>' +
      '<div class="dk-st-gallery">' +
      (!kits.length
        ? '<div class="dk-st-empty">No kits</div>'
        : '<div class="dk-st-tree">' +
          treeGroupHtml(tree, 0, [tree], 0) +
          "</div>") +
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
            Desk.refresh();
          });
          return;
        }
        Desk.refresh();
      });
    });

    page.querySelectorAll("[data-twist]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var key = btn.getAttribute("data-twist");
        var node = findNode(tree, key);
        if (node && !(node.ordered && node.ordered.length)) return;
        toggleCollapsed(key);
        Desk.refresh();
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
        Desk.refresh();
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
        } else if (same) {
          state.selected = null;
          state.selectedPoleMaterial = null;
          state.selectedPoleToken = null;
        } else {
          state.selected = stamped;
          state.selectedPoleMaterial = poleMat || null;
          state.selectedPoleToken = poleTok || null;
        }
        Desk.refresh();
      });
    });

    page.querySelector("#dkKitQ").addEventListener("input", function (e) {
      state.q = e.target.value;
      clearTimeout(renderBrowse._t);
      renderBrowse._t = setTimeout(function () {
        Desk.refresh();
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
        if (fresh) state.selected = fresh;
      }
      Desk.refresh();
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
    page.innerHTML = '<div class="dk-blank"><h2>Loading structures…</h2></div>';
    var paint = function () {
      loadMatrix()
        .then(function () {
          page.innerHTML = "";
          renderBrowse(page);
        })
        .catch(function () {
          page.innerHTML =
            '<div class="dk-blank"><h2>Could not load kits</h2><p>Check estimate/kit-matrix.json</p></div>';
        });
    };
    // Always pull pending from server so Suggested counts work across browsers.
    syncPendingSuggestions(true).then(paint).catch(paint);
  }

  Desk.register("structures", {
    tools: function () {
      return ["33kV", "11kV", "LT"].map(function (v) {
        return {
          label: v,
          active: state.voltage === v,
          onClick: function () {
            setVoltage(v);
          },
        };
      });
    },
    render: render,
    openKit: openKit,
    openKitEdit: openKitEdit,
  });

  if (!global.__slmPendingKitsWired) {
    global.__slmPendingKitsWired = true;
    window.addEventListener("slm-pending-kits-changed", function () {
      if (Desk.active && Desk.active() === "structures") Desk.refresh();
    });
    window.addEventListener("storage", function (ev) {
      if (ev.key === PENDING_KITS_KEY && Desk.active && Desk.active() === "structures") {
        Desk.refresh();
      }
    });
  }

  global.SlmStructuresDesk = {
    openKit: openKit,
    openKitEdit: openKitEdit,
  };
})(window);
