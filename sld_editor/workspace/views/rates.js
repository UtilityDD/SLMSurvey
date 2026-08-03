/**
 * My rates — material + labour schedules for this workspace (upload / search / edit).
 */
(function (global) {
  "use strict";

  var App = global.SlmWsApp;
  var WS = global.SlmWorkspace;
  var Cat = global.SlmCatalog;
  var esc = App.escapeHtml;
  var tab = "material"; // material | labour
  var filterQ = "";

  function pool(ws) {
    return tab === "labour" ? ws.rates.labour || [] : ws.rates.materials || [];
  }

  function importRates() {
    App.importSpreadsheet({
      title: "Import " + (tab === "labour" ? "labour" : "material") + " schedule",
      fields: [
        { key: "description", label: "Description", required: true },
        { key: "code", label: "Code (optional)", required: false },
        { key: "unit", label: "Unit", required: false },
        { key: "rate", label: "Rate", required: false },
      ],
      onSave: function (rows, meta) {
        var type = tab === "labour" ? "labour" : "material";
        var mapped = rows.map(function (r) {
          return {
            code: r.code || WS.uid(type === "labour" ? "L" : "M"),
            description: r.description,
            unit: r.unit || "NOS",
            rate: Number(String(r.rate).replace(/,/g, "")) || 0,
            type: type,
            origin: meta.sourceFile || "upload",
          };
        });
        WS.update(function (ws) {
          if (type === "labour") {
            ws.rates.labour = mergeByCode(ws.rates.labour, mapped);
          } else {
            ws.rates.materials = mergeByCode(ws.rates.materials, mapped);
          }
        }, "rates");
        App.refresh();
        App.toast("Imported " + mapped.length + " " + type + " rows");
      },
    });
  }

  function mergeByCode(prev, next) {
    var map = {};
    (prev || []).forEach(function (r) {
      if (r.code) map[r.code] = r;
    });
    next.forEach(function (r) {
      map[r.code] = Object.assign({}, map[r.code] || {}, r);
    });
    return Object.keys(map).map(function (k) {
      return map[k];
    });
  }

  async function seedFromBundled() {
    if (!Cat.isLoaded()) {
      try {
        await Cat.load();
      } catch (err) {
        App.toast(err.message || String(err));
        return;
      }
    }
    var ok = await global.SlmDialog.confirm({
      title: "Copy bundled rates?",
      message:
        "Copies the built-in material and labour ratebook into this workspace so you can edit locally. Existing codes are updated.",
      okLabel: "Copy rates",
    });
    if (!ok) return;
    var bundled = Cat.bundledRatebook();
    WS.update(function (ws) {
      ws.rates.materials = mergeByCode(
        ws.rates.materials,
        (bundled.materials || []).map(function (r) {
          return Object.assign({}, r, { type: "material", origin: "bundled" });
        })
      );
      ws.rates.labour = mergeByCode(
        ws.rates.labour,
        (bundled.labour || []).map(function (r) {
          return Object.assign({}, r, { type: "labour", origin: "bundled" });
        })
      );
    }, "rates");
    App.refresh();
    App.toast("Bundled rates copied into this workspace");
  }

  function openEdit(item, type) {
    App.openDrawer({
      title: item ? "Edit rate" : "New rate",
      subtitle: type === "labour" ? "Labour" : "Material",
      render: function (body) {
        body.innerHTML =
          '<label class="ws-field"><span>Description *</span><input class="ws-input" id="rDesc" value="' +
          esc(item ? item.description : "") +
          '"></label>' +
          '<div class="ws-field-row">' +
          '<label class="ws-field"><span>Code (optional)</span><input class="ws-input" id="rCode" value="' +
          esc(item ? item.code : "") +
          '"></label>' +
          '<label class="ws-field"><span>Unit</span><input class="ws-input" id="rUnit" value="' +
          esc(item ? item.unit || "NOS" : "NOS") +
          '"></label></div>' +
          '<label class="ws-field"><span>Rate</span><input class="ws-input" type="number" step="0.01" id="rRate" value="' +
          esc(item ? String(item.rate || 0) : "0") +
          '"></label>' +
          '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px">' +
          (item
            ? '<button type="button" class="ws-btn ws-btn-danger" id="rDel" style="margin-right:auto">Delete</button>'
            : "") +
          '<button type="button" class="ws-btn" id="rCancel">Cancel</button>' +
          '<button type="button" class="ws-btn ws-btn-primary" id="rSave">Save</button></div>';

        body.querySelector("#rCancel").addEventListener("click", App.closeDrawer);
        body.querySelector("#rSave").addEventListener("click", function () {
          var description = body.querySelector("#rDesc").value.trim();
          if (!description) return App.toast("Description is required");
          var code =
            body.querySelector("#rCode").value.trim() ||
            (item && item.code) ||
            WS.uid(type === "labour" ? "L" : "M");
          var row = {
            code: code,
            description: description,
            unit: body.querySelector("#rUnit").value.trim() || "NOS",
            rate: Number(body.querySelector("#rRate").value) || 0,
            type: type,
            origin: (item && item.origin) || "manual",
          };
          WS.update(function (ws) {
            var list = type === "labour" ? ws.rates.labour : ws.rates.materials;
            var idx = list.findIndex(function (r) {
              return r.code === (item && item.code);
            });
            if (item && idx >= 0) list[idx] = row;
            else list.push(row);
          }, "rates");
          App.closeDrawer();
          App.refresh();
        });
        if (item) {
          body.querySelector("#rDel").addEventListener("click", async function () {
            var ok = await global.SlmDialog.confirm({
              title: "Delete rate?",
              message: item.description || item.code,
              okLabel: "Delete",
              danger: true,
            });
            if (!ok) return;
            WS.update(function (ws) {
              if (type === "labour") {
                ws.rates.labour = ws.rates.labour.filter(function (r) {
                  return r.code !== item.code;
                });
              } else {
                ws.rates.materials = ws.rates.materials.filter(function (r) {
                  return r.code !== item.code;
                });
              }
            }, "rates");
            App.closeDrawer();
            App.refresh();
          });
        }
      },
    });
  }

  function render(host, ws) {
    var mats = ws.rates.materials || [];
    var labs = ws.rates.labour || [];
    var list = pool(ws);
    var q = filterQ.trim().toLowerCase();
    var terms = q.split(/\s+/).filter(Boolean);
    var shown = list.filter(function (r) {
      if (!terms.length) return true;
      var hay = ((r.description || "") + " " + (r.code || "")).toLowerCase();
      return terms.every(function (t) {
        return hay.indexOf(t) !== -1;
      });
    });

    var stack = document.createElement("div");
    stack.className = "ws-stack";
    stack.innerHTML =
      '<div class="ws-metrics">' +
      '<div class="ws-metric"><div class="ws-metric-label">Materials</div><div class="ws-metric-value">' +
      mats.length +
      "</div></div>" +
      '<div class="ws-metric"><div class="ws-metric-label">Labour</div><div class="ws-metric-value">' +
      labs.length +
      "</div></div></div>" +
      '<div class="ws-card"><div class="ws-card-head"><div class="ws-toggle" id="wsRateTabs">' +
      '<button type="button" data-tab="material"' +
      (tab === "material" ? ' class="is-active"' : "") +
      ">Materials</button>" +
      '<button type="button" data-tab="labour"' +
      (tab === "labour" ? ' class="is-active"' : "") +
      ">Labour</button></div>" +
      '<div class="ws-card-head-actions">' +
      '<input class="ws-input ws-btn-sm" id="wsRateFilter" placeholder="Search…" value="' +
      esc(filterQ) +
      '" style="min-width:160px">' +
      "</div></div>" +
      (list.length
        ? '<div class="ws-scroll-y"><table class="ws-table"><thead><tr><th>Description</th><th>Code</th><th>Unit</th><th class="num">Rate</th><th></th></tr></thead><tbody id="wsRateBody"></tbody></table></div>'
        : '<div class="ws-empty">No ' +
          (tab === "labour" ? "labour" : "material") +
          " rates yet. Upload a CSV/Excel schedule, or copy the bundled rates to start.</div>") +
      "</div>";
    host.appendChild(stack);

    stack.querySelectorAll("#wsRateTabs button").forEach(function (btn) {
      btn.addEventListener("click", function () {
        tab = btn.getAttribute("data-tab");
        App.refresh();
      });
    });
    var filter = stack.querySelector("#wsRateFilter");
    if (filter) {
      filter.addEventListener("input", function () {
        filterQ = filter.value;
        App.refresh();
      });
    }

    var tbody = stack.querySelector("#wsRateBody");
    if (!tbody) return;
    shown.slice(0, 500).forEach(function (r) {
      var tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" +
        esc(r.description || "") +
        "</td><td>" +
        esc(r.code || "") +
        "</td><td>" +
        esc(r.unit || "") +
        '</td><td class="num">₹' +
        App.money(r.rate) +
        '</td><td class="num"></td>';
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ws-btn ws-btn-sm";
      btn.textContent = "Edit";
      btn.addEventListener("click", function () {
        openEdit(r, tab === "labour" ? "labour" : "material");
      });
      tr.lastElementChild.appendChild(btn);
      tbody.appendChild(tr);
    });
  }

  App.register("rates", {
    label: "Rates",
    title: "Rates",
    hint: "Material & labour for this job",
    badge: function (ws) {
      var n = (ws.rates.materials || []).length + (ws.rates.labour || []).length;
      return n || "";
    },
    actions: function () {
      return [
        { label: "Upload schedule", kind: "primary", onClick: importRates },
        {
          label: "Add row",
          onClick: function () {
            openEdit(null, tab === "labour" ? "labour" : "material");
          },
        },
        { label: "Copy bundled", kind: "quiet", onClick: seedFromBundled },
      ];
    },
    render: render,
  });
})(window);
