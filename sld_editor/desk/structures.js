/**
 * Structures desk — browse kits by voltage, open detail, edit in embed.
 */
(function (global) {
  "use strict";

  var Desk = global.SlmDesk;
  var esc = function (s) {
    return Desk.escapeHtml(s);
  };

  var MATRIX_URL = "../estimate/kit-matrix.json";
  var state = {
    matrix: null,
    voltage: "11kV",
    q: "",
    selected: null,
    mode: "browse", // browse | edit
    pendingKitId: null,
  };

  function allKits() {
    var m = state.matrix;
    if (!m) return [];
    return []
      .concat(m.structureKits || [])
      .concat(m.conductorKits || [])
      .concat(m.addonKits || []);
  }

  function kitTitle(k) {
    return k.name || k.label || k.id || "Kit";
  }

  function kitSub(k) {
    return [k.structure || k.structureLabel, k.kitLocation || k.location, k.conductorFamily || k.conductor]
      .filter(Boolean)
      .join(" · ");
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

  function filtered() {
    var q = state.q.toLowerCase();
    return allKits().filter(function (k) {
      if (!matchesVoltage(k)) return false;
      if (!q) return true;
      return (
        (kitTitle(k) + " " + kitSub(k) + " " + (k.id || ""))
          .toLowerCase()
          .indexOf(q) !== -1
      );
    });
  }

  function loadMatrix() {
    if (state.matrix) return Promise.resolve(state.matrix);
    return fetch(MATRIX_URL)
      .then(function (r) {
        return r.json();
      })
      .then(function (m) {
        state.matrix = m;
        return m;
      });
  }

  function canEdit() {
    var L = global.SlmLicense;
    if (!L || !L.enabled) return true;
    return !!(L.canEditKits && L.canEditKits());
  }

  function renderDetail(host) {
    var k = state.selected;
    if (!k) {
      host.innerHTML =
        '<div class="dk-detail-empty">Select a structure to see its recipe.</div>';
      return;
    }
    var lines = k.lines || [];
    host.innerHTML =
      '<h2 class="dk-kit-title">' +
      esc(kitTitle(k)) +
      "</h2>" +
      '<p class="dk-kit-sub">' +
      esc(kitSub(k)) +
      "</p>" +
      '<p class="dk-kit-meta">' +
      esc(k.id || "") +
      " · " +
      lines.length +
      " lines</p>" +
      '<div class="dk-stack" style="margin:14px 0">' +
      (canEdit()
        ? '<button type="button" class="dk-btn dk-btn-primary" id="dkEditKit">Edit kit</button>'
        : "<p>Browse only on this license.</p>") +
      "</div>" +
      '<div class="dk-table-wrap"><table class="dk-table"><thead><tr><th>Code</th><th>Type</th><th class="dk-num">Qty</th></tr></thead><tbody>' +
      lines
        .map(function (l) {
          return (
            "<tr><td>" +
            esc(l.itemId || l.code || "—") +
            "</td><td>" +
            esc(l.type || "") +
            '</td><td class="dk-num">' +
            esc(String(l.qtyPerUnit != null ? l.qtyPerUnit : l.qty || 1)) +
            "</td></tr>"
          );
        })
        .join("") +
      "</tbody></table></div>";

    var edit = host.querySelector("#dkEditKit");
    if (edit) {
      edit.addEventListener("click", function () {
        state.mode = "edit";
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
    state.mode = "browse";
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

  function renderBrowse(page) {
    if (state.pendingKitId) selectKitById(state.pendingKitId);
    var kits = filtered();
    page.innerHTML =
      '<div class="dk-split">' +
      '<div class="dk-split-main">' +
      '<div class="dk-page-head"><h1>Structures</h1><p>Browse every kit by voltage. Open one to review or edit its recipe.</p></div>' +
      '<div class="dk-filters">' +
      '<div class="dk-seg" id="dkVolt">' +
      ["33kV", "11kV", "LT"]
        .map(function (v) {
          return (
            '<button type="button" data-v="' +
            v +
            '" class="' +
            (state.voltage === v ? "is-on" : "") +
            '">' +
            v +
            "</button>"
          );
        })
        .join("") +
      '</div><input class="dk-search" id="dkKitQ" placeholder="Search structures…" value="' +
      esc(state.q) +
      '"><span style="color:var(--dk-muted);font-size:0.85rem">' +
      kits.length +
      " kits</span></div>" +
      '<div class="dk-kit-grid" id="dkKits"></div></div>' +
      '<aside class="dk-split-detail" id="dkKitDetail"></aside></div>';

    var grid = page.querySelector("#dkKits");
    kits.slice(0, 200).forEach(function (k) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "dk-kit";
      btn.innerHTML =
        '<div class="dk-kit-title">' +
        esc(kitTitle(k)) +
        '</div><div class="dk-kit-sub">' +
        esc(kitSub(k)) +
        '</div><div class="dk-kit-meta">' +
        esc((k.lines || []).length + " lines") +
        "</div>";
      btn.addEventListener("click", function () {
        state.selected = k;
        renderDetail(page.querySelector("#dkKitDetail"));
      });
      grid.appendChild(btn);
    });

    page.querySelector("#dkVolt").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-v]");
      if (!b) return;
      state.voltage = b.getAttribute("data-v");
      Desk.refresh();
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

  function renderEdit(page) {
    var kitQ = state.pendingKitId
      ? "&kit=" + encodeURIComponent(state.pendingKitId)
      : "";
    page.innerHTML =
      '<div class="dk-page" style="height:100%">' +
      '<div style="display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--dk-line);background:#fff">' +
      '<button type="button" class="dk-btn dk-btn-sm" id="dkBackBrowse">← Browse</button>' +
      "<strong>Edit kits</strong>" +
      '<span style="color:var(--dk-muted);font-size:0.85rem">Recipes, rates, publish</span></div>' +
      '<iframe class="dk-embed" title="Kit editor" src="../estimate/?embed=1' +
      kitQ +
      '"></iframe></div>';
    page.querySelector("#dkBackBrowse").addEventListener("click", function () {
      state.mode = "browse";
      Desk.refresh();
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
        if (state.mode === "edit" && canEdit()) renderEdit(page);
        else renderBrowse(page);
      })
      .catch(function () {
        page.innerHTML =
          '<div class="dk-blank"><h2>Could not load kits</h2><p>Check estimate/kit-matrix.json</p></div>';
      });
  }

  Desk.register("structures", {
    tools: function () {
      var list = [
        {
          label: "Browse kits",
          active: state.mode !== "edit",
          onClick: function () {
            state.mode = "browse";
            Desk.refresh();
          },
        },
      ];
      if (canEdit()) {
        list.push({
          label: "Edit kits",
          active: state.mode === "edit",
          kind: state.mode === "edit" ? "primary" : "",
          onClick: function () {
            state.mode = "edit";
            Desk.refresh();
          },
        });
      }
      return list;
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
