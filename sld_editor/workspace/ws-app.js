/**
 * Workspace shell — fixed side nav, one view at a time, right drawer for detail.
 * Views register themselves with SlmWsApp.register(id, def).
 */
(function (global) {
  "use strict";

  var ORDER = ["survey", "assemblies", "rates", "contract", "estimate"];
  // presets parked with phone survey presets — re-add "presets" when field packs return
  var views = {};
  var activeId = null;
  var drawerCloser = null;

  var WS = global.SlmWorkspace;

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function money(n) {
    var v = Number(n) || 0;
    return v.toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function qty(n) {
    var v = Number(n) || 0;
    return v === Math.floor(v) ? String(v) : v.toFixed(3);
  }

  function toast(msg) {
    var el = $("wsToast");
    if (!el) return;
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () {
      el.classList.add("hidden");
    }, 2600);
  }

  function register(id, def) {
    views[id] = def;
  }

  function renderNav() {
    var nav = $("wsNav");
    if (!nav) return;
    var ws = WS.get();
    nav.innerHTML = ORDER.filter(function (id) {
      return views[id];
    })
      .map(function (id) {
        var def = views[id];
        var badge = def.badge ? def.badge(ws) : "";
        return (
          '<button type="button" class="slm-rail-item' +
          (id === activeId ? " is-active" : "") +
          '" data-view="' +
          id +
          '"><span>' +
          escapeHtml(def.label) +
          "</span>" +
          (badge
            ? '<span class="slm-rail-badge">' + escapeHtml(String(badge)) + "</span>"
            : "") +
          "</button>"
        );
      })
      .join("");
    nav.querySelectorAll("[data-view]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        go(btn.getAttribute("data-view"));
      });
    });
  }

  /** All page tools live in the left rail — never the main header. */
  function renderActions(def) {
    var host = $("wsTools") || $("wsActions");
    if (!host) return;
    host.innerHTML = "";
    var list = (def.actions && def.actions(WS.get())) || [];
    if (!list.length) {
      host.innerHTML =
        '<p class="slm-rail-empty">No tools for this page</p>';
      return;
    }
    list.forEach(function (a) {
      if (a.html) {
        var wrap = document.createElement("div");
        wrap.innerHTML = a.html;
        var node = wrap.firstElementChild;
        if (node) {
          node.classList.add("slm-rail-tool");
          host.appendChild(node);
        }
        if (a.mount) a.mount(node);
        return;
      }
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "slm-rail-tool" +
        (a.kind === "primary"
          ? " slm-rail-tool-primary"
          : a.kind === "quiet"
            ? " slm-rail-tool-quiet"
            : "");
      btn.textContent = a.label;
      if (a.disabled) btn.disabled = true;
      btn.addEventListener("click", a.onClick);
      host.appendChild(btn);
    });
  }

  function go(id) {
    if (!views[id]) id = ORDER.find(function (x) {
      return views[x];
    });
    if (activeId === "survey" && id !== "survey" && global.SlmWsMap) {
      try {
        global.SlmWsMap.destroy();
      } catch (e) {
        /* ignore */
      }
    }
    activeId = id;
    var def = views[id];
    var titleEl = $("wsTitle");
    if (titleEl) titleEl.textContent = def.title || def.label;
    var hint =
      typeof def.hint === "function" ? def.hint(WS.get()) : def.hint || "";
    var hintEl = $("wsHint");
    if (hintEl) hintEl.textContent = hint;
    renderActions(def);
    var content = $("wsContent");
    content.innerHTML = "";
    content.scrollTop = 0;
    content.classList.toggle("is-map-page", id === "survey");

    if (id === "survey") {
      // Full-height map desk — title lives in the rail tools / hint
      var body = document.createElement("div");
      body.className = "ws-page-body ws-page-body-map";
      content.appendChild(body);
      def.render(body, WS.get());
    } else {
      var head = document.createElement("div");
      head.className = "ws-page-head";
      head.innerHTML =
        "<h1>" +
        escapeHtml(def.title || def.label) +
        "</h1>" +
        (hint ? "<p>" + escapeHtml(hint) + "</p>" : "");
      content.appendChild(head);
      var page = document.createElement("div");
      page.className = "ws-page-body";
      content.appendChild(page);
      def.render(page, WS.get());
    }
    renderNav();
    try {
      history.replaceState(null, "", "#" + id);
    } catch (err) {
      /* ignore */
    }
  }

  /** Re-render the current view (after a data change). */
  function refresh() {
    if (activeId) go(activeId);
    else renderNav();
  }

  function syncFileName() {
    var el = $("wsFileName");
    if (el) el.textContent = WS.get().name || "Untitled job";
  }

  /* ---------- drawer ---------- */

  function openDrawer(opts) {
    var o = opts || {};
    $("wsDrawerTitle").textContent = o.title || "Details";
    $("wsDrawerSub").textContent = o.subtitle || "";
    var body = $("wsDrawerBody");
    body.innerHTML = "";
    body.scrollTop = 0;
    if (typeof o.render === "function") o.render(body);
    drawerCloser = o.onClose || null;
    $("wsDrawer").classList.remove("hidden");
    $("wsScrim").classList.remove("hidden");
  }

  function closeDrawer() {
    $("wsDrawer").classList.add("hidden");
    $("wsScrim").classList.add("hidden");
    var fn = drawerCloser;
    drawerCloser = null;
    if (fn) fn();
  }

  /* ---------- spreadsheet import (shared by rates + contract) ---------- */

  /**
   * Ask for a file, then map its columns in the drawer.
   * fields: [{ key, label, required }]  onSave(rows, meta)
   */
  function importSpreadsheet(opts) {
    var o = opts || {};
    var input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,.txt,.xlsx,.xls";
    input.addEventListener("change", async function () {
      var file = input.files && input.files[0];
      if (!file) return;
      try {
        var table = await global.SlmScheduleBooks.parseSpreadsheetFile(file);
        openColumnMapper(table, o);
      } catch (err) {
        toast(err.message || String(err));
      }
    });
    input.click();
  }

  /** Header guess that never invents a code column — description leads here. */
  var HEADER_HINTS = {
    code: [/^code$/, /item\s*(code|no)/, /^sl\.?\s*no/, /^ref/],
    description: [/desc/, /particular/, /^item$/, /^name$/, /nature of work/, /work/],
    unit: [/^unit$/, /^uom$/, /^u\/m$/],
    rate: [/^rate/, /price/, /amount per/, /^value$/],
    qty: [/^qty/, /quantity/, /^nos$/],
    type: [/^type$/, /categ/, /mat.*lab/],
  };

  function guessHeaders(headers, fields) {
    var map = {};
    var used = {};
    (fields || []).forEach(function (f) {
      var pats = HEADER_HINTS[f.key] || [];
      for (var p = 0; p < pats.length; p += 1) {
        for (var i = 0; i < headers.length; i += 1) {
          var h = String(headers[i] || "").trim().toLowerCase();
          if (!used[headers[i]] && pats[p].test(h)) {
            map[f.key] = headers[i];
            used[headers[i]] = true;
            return;
          }
        }
      }
    });
    // Longest-looking text column is a fair guess for description if nothing matched.
    if (!map.description && headers.length) {
      var pick = headers.find(function (h) {
        return !used[h];
      });
      if (pick) map.description = pick;
    }
    return map;
  }

  function openColumnMapper(table, o) {
    var headers = table.headers || [];
    var map = guessHeaders(headers, o.fields);

    openDrawer({
      title: o.title || "Import file",
      subtitle:
        (table.sourceFile || "File") + " · " + (table.rows || []).length + " rows",
      render: function (body) {
        var optionHtml =
          '<option value="">—</option>' +
          headers
            .map(function (h) {
              return '<option value="' + escapeHtml(h) + '">' + escapeHtml(h) + "</option>";
            })
            .join("");

        body.innerHTML =
          '<p class="ws-note">Pick which column holds each field. Description is what you will search later; a code is optional.</p>' +
          '<div class="ws-section-label">Columns</div>' +
          (o.fields || [])
            .map(function (f) {
              return (
                '<label class="ws-field"><span>' +
                escapeHtml(f.label) +
                (f.required ? " *" : "") +
                '</span><select class="ws-select" data-map="' +
                f.key +
                '">' +
                optionHtml +
                "</select></label>"
              );
            })
            .join("") +
          '<div class="ws-section-label">Preview</div>' +
          '<div class="ws-card ws-card-pad" id="wsMapPreview"></div>' +
          '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px">' +
          '<button type="button" class="ws-btn" id="wsMapCancel">Cancel</button>' +
          '<button type="button" class="ws-btn ws-btn-primary" id="wsMapSave">Import</button>' +
          "</div>";

        body.querySelectorAll("[data-map]").forEach(function (sel) {
          var key = sel.getAttribute("data-map");
          if (map[key]) sel.value = map[key];
          sel.addEventListener("change", function () {
            map[key] = sel.value;
            preview();
          });
        });

        function rowsFromMap() {
          return (table.rows || [])
            .map(function (r) {
              var out = {};
              (o.fields || []).forEach(function (f) {
                var col = map[f.key];
                var cell = col ? r[col] : "";
                out[f.key] = cell == null ? "" : String(cell).trim();
              });
              return out;
            })
            .filter(function (row) {
              return (o.fields || []).every(function (f) {
                return !f.required || row[f.key];
              });
            });
        }

        function preview() {
          var rows = rowsFromMap();
          var host = body.querySelector("#wsMapPreview");
          if (!rows.length) {
            host.innerHTML =
              '<div class="ws-note">No usable rows yet — map the required columns.</div>';
            return;
          }
          host.innerHTML =
            '<div class="ws-note" style="margin-bottom:8px"><strong>' +
            rows.length +
            "</strong> rows ready</div>" +
            rows
              .slice(0, 4)
              .map(function (r) {
                return (
                  '<div class="ws-row-sub" style="margin-bottom:4px">' +
                  escapeHtml(
                    (o.fields || [])
                      .map(function (f) {
                        return r[f.key];
                      })
                      .filter(Boolean)
                      .join(" · ")
                      .slice(0, 120)
                  ) +
                  "</div>"
                );
              })
              .join("");
        }

        body.querySelector("#wsMapCancel").addEventListener("click", closeDrawer);
        body.querySelector("#wsMapSave").addEventListener("click", function () {
          var rows = rowsFromMap();
          if (!rows.length) return toast("Map the required columns first");
          o.onSave(rows, { sourceFile: table.sourceFile });
          closeDrawer();
        });

        preview();
      },
    });
  }

  function downloadText(name, text, mime) {
    var blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* ---------- shell wiring ---------- */

  function wireShell() {
    $("btnWsDrawerClose").addEventListener("click", closeDrawer);
    $("wsScrim").addEventListener("click", closeDrawer);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !$("wsDrawer").classList.contains("hidden")) {
        closeDrawer();
      }
    });

    $("btnWsSave").addEventListener("click", async function () {
      try {
        var name = await WS.saveToFile(false);
        toast("Saved " + name);
      } catch (err) {
        if (err && err.name === "AbortError") return;
        toast("Save failed: " + (err.message || err));
      }
    });

    $("btnWsOpen").addEventListener("click", async function () {
      try {
        var name = await WS.openFromFile();
        if (name) {
          syncFileName();
          refresh();
          toast("Opened " + name);
        }
      } catch (err) {
        if (err && err.name === "AbortError") return;
        toast("Could not open: " + (err.message || err));
      }
    });

    $("btnWsNew").addEventListener("click", async function () {
      var ok = await global.SlmDialog.confirm({
        title: "Start a new job?",
        message:
          "This clears the current workspace from the browser. Save to a file first if you want to keep it.",
        okLabel: "New job",
        danger: true,
      });
      if (!ok) return;
      var name = await global.SlmDialog.prompt({
        title: "Job name",
        inputLabel: "Name",
        defaultValue: "Untitled job",
      });
      WS.reset(name || "Untitled job");
      syncFileName();
      refresh();
      toast("New workspace");
    });

    $("wsFileName").addEventListener("click", async function () {
      var name = await global.SlmDialog.prompt({
        title: "Rename job",
        inputLabel: "Name",
        defaultValue: WS.get().name,
      });
      if (name == null) return;
      WS.update(function (ws) {
        ws.name = name.trim() || ws.name;
      });
      syncFileName();
    });
  }

  function start() {
    wireShell();
    WS.restore();
    syncFileName();
    WS.subscribe(function () {
      renderNav();
      syncFileName();
    });
    var hash = (location.hash || "").replace("#", "");
    go(views[hash] ? hash : "survey");
  }

  global.SlmWsApp = {
    register: register,
    go: go,
    refresh: refresh,
    start: start,
    toast: toast,
    openDrawer: openDrawer,
    closeDrawer: closeDrawer,
    importSpreadsheet: importSpreadsheet,
    downloadText: downloadText,
    escapeHtml: escapeHtml,
    money: money,
    qty: qty,
  };
})(window);
