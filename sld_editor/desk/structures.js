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
  var COLS_KEY = "slm_st_col_widths_v1";
  var COL_MIN = { tree: 160, kits: 220, detail: 200 };
  var colWidths = loadColWidths();

  var state = {
    matrix: null,
    voltage: "11kV",
    q: "",
    selected: null,
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
  var POLE_ORDER = ["8M", "9M", "T9", "T95", "T11", "RL", "WF"];

  function allKits() {
    var m = state.matrix;
    if (!m) return [];
    return []
      .concat(m.structureKits || [])
      .concat(m.conductorKits || [])
      .concat(m.addonKits || []);
  }

  function kitFamily(k) {
    return String((k && k.family) || "structure").toLowerCase();
  }

  function kitType(k) {
    if (kitFamily(k) === "conductor") return "Conductor";
    if (kitFamily(k) === "addon") return k.addonType || k.label || "Add-on";
    return k.structureLabel || k.structure || "?";
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

  function extLabel(e) {
    if (!e || e === "NoExt") return "";
    if (e === "WithExt") return "With ext";
    return String(e);
  }

  function posLabel(k) {
    return (
      (k && (k.locationLabel || k.location || k.position || k.positionLabel)) ||
      "Other"
    );
  }

  function poleLabel(k) {
    var t = (k && (k.poleToken || k.activePoleToken || k.poleLabel)) || "";
    t = String(t).trim();
    if (!t) return "Unspecified pole";
    if (t === "8M") return "8m PCC";
    if (t === "9M") return "9m PCC";
    if (t === "T9") return "Tubular 9m";
    if (t === "T95") return "Tubular 9.5m";
    if (t === "T11") return "Tubular 11m";
    if (t === "RL") return "Rail";
    if (t === "WF") return "Wide flange";
    return t;
  }

  function poleToken(k) {
    return String((k && (k.poleToken || k.activePoleToken)) || "").trim() || "_";
  }

  function kitTitle(k) {
    if (kitFamily(k) === "conductor") {
      return k.conductorShort || k.conductorName || k.label || k.id || "Conductor";
    }
    if (kitFamily(k) === "addon") {
      return k.label || k.addonType || k.id || "Add-on";
    }
    // Leaf under Position → Arrangement → Pole: show structure + conductor
    var bits = [kitType(k)];
    var cond = k.conductorShort || k.conductorFamily || "";
    if (cond) bits.push(cond);
    var ext = extLabel(k.extension);
    if (ext) bits.push(ext);
    if (k.wireLabel || k.wireCount) bits.push(k.wireLabel || k.wireCount);
    return bits.join(" · ") || k.id || "Kit";
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
   * Tree: Voltage → Position → Arrangement → Pole → kits
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

      var pos = posLabel(k);
      var arr = arrLabel(k.arrangement);
      var pole = poleLabel(k);
      var poleKey = poleToken(k);

      if (!root.children[pos]) {
        root.children[pos] = {
          key: root.key + "/p:" + pos,
          label: pos,
          kits: [],
          children: Object.create(null),
          kind: "position",
        };
      }
      var posNode = root.children[pos];

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

      var pk = poleKey + "|" + pole;
      if (!arrNode.children[pk]) {
        arrNode.children[pk] = {
          key: arrNode.key + "/pole:" + poleKey,
          label: pole,
          kits: [],
          children: Object.create(null),
          kind: "pole",
          poleToken: poleKey,
        };
      }
      arrNode.children[pk].kits.push(k);
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

    root.ordered = childList(root, POS_ORDER.concat(["Conductors", "Add-ons"]), function (n, k) {
      return n.kind === "other" ? n.label : k;
    });
    root.ordered.forEach(function (posNode) {
      if (posNode.kind === "other") return;
      posNode.ordered = childList(posNode, ARR_ORDER, function (n) {
        return n.label;
      });
      posNode.ordered.forEach(function (arrNode) {
        arrNode.ordered = childList(arrNode, POLE_ORDER, function (n) {
          return n.poleToken || n.label;
        });
        arrNode.ordered.forEach(function (poleNode) {
          poleNode.kits.sort(function (a, b) {
            var ta = typeSortKey(kitType(a));
            var tb = typeSortKey(kitType(b));
            if (ta !== tb) return ta < tb ? -1 : 1;
            var ca = String(a.conductorShort || "");
            var cb = String(b.conductorShort || "");
            if (ca !== cb) return ca.localeCompare(cb);
            return String(a.id || "").localeCompare(String(b.id || ""));
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
        if (p.indexOf("p:") === 0) return p.slice(2);
        if (p.indexOf("a:") === 0) return p.slice(2);
        if (p.indexOf("pole:") === 0) return node.label;
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
      posLabel(k),
      arrLabel(k.arrangement),
      poleLabel(k),
    ].join(" · ");
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
      "</span></div></div>" +
      "<h2>" +
      esc(kitTitle(k)) +
      "</h2>" +
      '<p class="dk-st-detail-line">' +
      esc(detailPath(k)) +
      "</p>" +
      '<p class="dk-st-detail-meta">' +
      lines.length +
      " lines</p>" +
      '<div class="dk-st-detail-actions">' +
      (canEdit()
        ? '<button type="button" class="dk-btn dk-btn-primary" id="dkEditKit">Edit kit</button>'
        : '<p class="dk-st-browse-only">Browse only on this license.</p>') +
      "</div>" +
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
  }

  function selectKitById(kitId) {
    if (!kitId) return false;
    var hit = allKits().find(function (k) {
      return String(k.id) === String(kitId);
    });
    if (!hit) return false;
    state.selected = hit;
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
        "/p:" +
        posLabel(hit) +
        "/a:" +
        arrLabel(hit.arrangement) +
        "/pole:" +
        poleToken(hit);
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
      state.selected && String(state.selected.id) === String(k.id);
    var n = (k.lines || []).length;
    return (
      '<button type="button" class="dk-st-leaf' +
      (selected ? " is-selected" : "") +
      '" data-id="' +
      esc(k.id) +
      '">' +
      '<span class="dk-st-leaf-title">' +
      esc(kitTitle(k)) +
      '</span><span class="dk-st-leaf-n">' +
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
    state.focusKey = "v:" + v;
    state.mode = "browse";
    state.pendingKitId = null;
    Desk.refresh();
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
      focusKits.length +
      "</span></div>" +
      '<div class="dk-st-kit-list" id="dkKitList">' +
      (focusKits.length
        ? focusKits.map(leafHtml).join("")
        : '<div class="dk-st-empty">No kits in this group.</div>') +
      "</div></section>" +
      '<div class="dk-st-split" data-split="detail" role="separator" aria-orientation="vertical" aria-label="Resize detail" tabindex="0"></div>' +
      '<aside class="dk-st-col dk-st-col-detail" id="dkKitDetail" aria-label="Kit detail"></aside>' +
      "</div>";

    wireColumnResize(page.querySelector("#dkStPage"));

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
        var next = allKits().find(function (k) {
          return String(k.id) === String(id);
        });
        if (!next) return;
        // While editing, switch the in-pane editor to the clicked kit.
        if (state.mode === "edit") {
          state.selected = next;
          state.pendingKitId = next.id;
        } else if (
          state.selected &&
          String(state.selected.id) === String(next.id)
        ) {
          state.selected = null;
        } else {
          state.selected = next;
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
        Desk.toast("Kit saved");
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
    loadMatrix()
      .then(function () {
        page.innerHTML = "";
        renderBrowse(page);
      })
      .catch(function () {
        page.innerHTML =
          '<div class="dk-blank"><h2>Could not load kits</h2><p>Check estimate/kit-matrix.json</p></div>';
      });
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

  global.SlmStructuresDesk = {
    openKit: openKit,
    openKitEdit: openKitEdit,
  };
})(window);
