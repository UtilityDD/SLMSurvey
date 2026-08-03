/**
 * Contract — descriptive SoR upload (code optional) + Bills as on job assemblies.
 */
(function (global) {
  "use strict";

  var App = global.SlmWsApp;
  var WS = global.SlmWorkspace;
  var Cat = global.SlmCatalog;
  var esc = App.escapeHtml;
  var filterQ = "";
  var viewMode = "schedule"; // schedule | bills

  function importContract() {
    App.importSpreadsheet({
      title: "Import contract schedule",
      fields: [
        { key: "description", label: "Description (required)", required: true },
        { key: "code", label: "Code (optional)", required: false },
        { key: "unit", label: "Unit", required: false },
        { key: "rate", label: "Rate", required: false },
        { key: "type", label: "Type (material/labour)", required: false },
      ],
      onSave: function (rows, meta) {
        var items = rows.map(function (r) {
          var typeHint = String(r.type || "").toLowerCase();
          return {
            id: WS.uid("ctr"),
            code: r.code || "",
            description: r.description,
            unit: r.unit || "NOS",
            rate: Number(String(r.rate).replace(/,/g, "")) || 0,
            type: typeHint.indexOf("lab") === 0 || typeHint === "l" ? "labour" : "material",
          };
        });
        WS.update(function (ws) {
          ws.contract.name = (meta.sourceFile || "Contract schedule").replace(
            /\.(csv|xlsx|xls|txt)$/i,
            ""
          );
          ws.contract.items = items;
          ws.billsAs = {};
        }, "contract");
        App.refresh();
        App.toast("Imported " + items.length + " contract items");
      },
    });
  }

  async function loadDemoContract() {
    try {
      var res = await fetch("../estimate/demo_contract_schedule.json");
      if (!res.ok) throw new Error("HTTP " + res.status);
      var data = await res.json();
      var items = (data.items || []).map(function (it) {
        return {
          id: it.code || WS.uid("ctr"),
          code: it.code || "",
          description: it.description || it.code || "",
          unit: it.unit || "NOS",
          rate: Number(it.rate) || 0,
          type: it.type === "labour" ? "labour" : "material",
        };
      });
      WS.update(function (ws) {
        ws.contract.name = data.name || "Demo turnkey contract";
        ws.contract.items = items;
      }, "contract");
      App.refresh();
      App.toast("Demo contract loaded · " + items.length + " items");
    } catch (err) {
      App.toast("Demo failed: " + (err.message || err));
    }
  }

  function openItemEdit(item) {
    App.openDrawer({
      title: item ? "Edit contract item" : "New contract item",
      subtitle: "Long clear description is the main identity. Code is optional.",
      render: function (body) {
        body.innerHTML =
          '<label class="ws-field"><span>Description *</span><textarea class="ws-input" id="cDesc" rows="3" style="resize:vertical">' +
          esc(item ? item.description : "") +
          "</textarea></label>" +
          '<div class="ws-field-row">' +
          '<label class="ws-field"><span>Code (optional)</span><input class="ws-input" id="cCode" value="' +
          esc(item ? item.code || "" : "") +
          '"></label>' +
          '<label class="ws-field"><span>Unit</span><input class="ws-input" id="cUnit" value="' +
          esc(item ? item.unit || "NOS" : "NOS") +
          '"></label></div>' +
          '<div class="ws-field-row">' +
          '<label class="ws-field"><span>Rate</span><input class="ws-input" type="number" step="0.01" id="cRate" value="' +
          esc(item ? String(item.rate || 0) : "0") +
          '"></label>' +
          '<label class="ws-field"><span>Type</span><select class="ws-select" id="cType">' +
          '<option value="material"' +
          (!item || item.type !== "labour" ? " selected" : "") +
          ">Material</option>" +
          '<option value="labour"' +
          (item && item.type === "labour" ? " selected" : "") +
          ">Labour</option></select></label></div>" +
          '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px">' +
          (item
            ? '<button type="button" class="ws-btn ws-btn-danger" id="cDel" style="margin-right:auto">Delete</button>'
            : "") +
          '<button type="button" class="ws-btn" id="cCancel">Cancel</button>' +
          '<button type="button" class="ws-btn ws-btn-primary" id="cSave">Save</button></div>';

        body.querySelector("#cCancel").addEventListener("click", App.closeDrawer);
        body.querySelector("#cSave").addEventListener("click", function () {
          var description = body.querySelector("#cDesc").value.trim();
          if (!description) return App.toast("Description is required");
          var row = {
            id: (item && item.id) || WS.uid("ctr"),
            code: body.querySelector("#cCode").value.trim(),
            description: description,
            unit: body.querySelector("#cUnit").value.trim() || "NOS",
            rate: Number(body.querySelector("#cRate").value) || 0,
            type: body.querySelector("#cType").value,
          };
          WS.update(function (ws) {
            if (!ws.contract.name) ws.contract.name = "Contract schedule";
            var idx = ws.contract.items.findIndex(function (i) {
              return i.id === row.id;
            });
            if (idx >= 0) ws.contract.items[idx] = row;
            else ws.contract.items.push(row);
          }, "contract");
          App.closeDrawer();
          App.refresh();
        });
        if (item) {
          body.querySelector("#cDel").addEventListener("click", async function () {
            var ok = await global.SlmDialog.confirm({
              title: "Delete item?",
              message: item.description,
              okLabel: "Delete",
              danger: true,
            });
            if (!ok) return;
            WS.update(function (ws) {
              ws.contract.items = ws.contract.items.filter(function (i) {
                return i.id !== item.id;
              });
              Object.keys(ws.billsAs).forEach(function (aid) {
                ws.billsAs[aid] = (ws.billsAs[aid] || []).filter(function (l) {
                  return l.itemId !== item.id;
                });
                if (!ws.billsAs[aid].length) delete ws.billsAs[aid];
              });
            }, "contract");
            App.closeDrawer();
            App.refresh();
          });
        }
      },
    });
  }

  function openBillsAsForAssembly(kit) {
    var ws = WS.get();
    if (!(ws.contract.items || []).length) {
      App.toast("Upload a contract schedule first");
      return;
    }
    App.openDrawer({
      title: "Bills as · " + Cat.title(kit),
      subtitle: "Search the long description. One assembly can bill as several SoR lines.",
      render: function (body) {
        body.innerHTML =
          '<div class="ws-search"><input id="wsBillsQ" placeholder="Search description…" autofocus></div>' +
          '<div class="ws-section-label">Currently linked</div>' +
          '<div class="ws-mini-rows" id="wsBillsLinked"></div>' +
          '<div class="ws-section-label">Add from schedule</div>' +
          '<div class="ws-rows" id="wsBillsPick"></div>';

        function linkedHost() {
          return body.querySelector("#wsBillsLinked");
        }
        function pickHost() {
          return body.querySelector("#wsBillsPick");
        }

        function drawLinked() {
          var links = WS.get().billsAs[kit.id] || [];
          var host = linkedHost();
          if (!links.length) {
            host.innerHTML = '<div class="ws-empty" style="padding:12px">None yet.</div>';
            return;
          }
          host.innerHTML = "";
          links.forEach(function (l) {
            var item = (WS.get().contract.items || []).find(function (i) {
              return i.id === l.itemId;
            });
            if (!item) return;
            var row = document.createElement("div");
            row.className = "ws-mini-row";
            row.innerHTML =
              '<div class="ws-mini-row-main">' +
              esc(item.description) +
              '</div><input class="ws-input ws-mini-qty" type="number" min="0.001" step="0.1" value="' +
              esc(String(l.qtyPerUnit || 1)) +
              '" title="Qty per assembly"><button type="button" class="ws-icon-btn">×</button>';
            row.querySelector("input").addEventListener("change", function (e) {
              var qty = Number(e.target.value) || 1;
              WS.update(function (w) {
                (w.billsAs[kit.id] || []).forEach(function (x) {
                  if (x.itemId === l.itemId) x.qtyPerUnit = qty;
                });
              }, "billsAs");
            });
            row.querySelector("button").addEventListener("click", function () {
              WS.update(function (w) {
                w.billsAs[kit.id] = (w.billsAs[kit.id] || []).filter(function (x) {
                  return x.itemId !== l.itemId;
                });
                if (!w.billsAs[kit.id].length) delete w.billsAs[kit.id];
              }, "billsAs");
              drawLinked();
              drawPick();
            });
            host.appendChild(row);
          });
        }

        function drawPick() {
          var q = body.querySelector("#wsBillsQ").value.trim().toLowerCase();
          var terms = q.split(/\s+/).filter(Boolean);
          var linked = {};
          (WS.get().billsAs[kit.id] || []).forEach(function (l) {
            linked[l.itemId] = true;
          });
          var items = (WS.get().contract.items || []).filter(function (it) {
            if (linked[it.id]) return false;
            if (!terms.length) return true;
            var hay = ((it.description || "") + " " + (it.code || "")).toLowerCase();
            return terms.every(function (t) {
              return hay.indexOf(t) !== -1;
            });
          });
          var host = pickHost();
          host.innerHTML = "";
          if (!items.length) {
            host.innerHTML = '<div class="ws-empty">No matches.</div>';
            return;
          }
          items.slice(0, 40).forEach(function (it) {
            var row = document.createElement("div");
            row.className = "ws-row";
            row.innerHTML =
              '<div class="ws-row-main"><div class="ws-row-title">' +
              esc(it.description) +
              '</div><div class="ws-row-sub">' +
              esc(it.unit || "NOS") +
              " · ₹" +
              App.money(it.rate) +
              (it.code ? " · " + esc(it.code) : "") +
              "</div></div>";
            var btn = document.createElement("button");
            btn.type = "button";
            btn.className = "ws-btn ws-btn-sm ws-btn-primary";
            btn.textContent = "Link";
            btn.addEventListener("click", function () {
              WS.update(function (w) {
                var prev = w.billsAs[kit.id] || [];
                prev.push({ itemId: it.id, qtyPerUnit: 1 });
                w.billsAs[kit.id] = prev;
              }, "billsAs");
              drawLinked();
              drawPick();
            });
            var actions = document.createElement("div");
            actions.className = "ws-row-actions";
            actions.appendChild(btn);
            row.appendChild(actions);
            host.appendChild(row);
          });
        }

        body.querySelector("#wsBillsQ").addEventListener("input", drawPick);
        drawLinked();
        drawPick();
      },
      onClose: function () {
        App.refresh();
      },
    });
  }

  function renderSchedule(host, ws) {
    var items = ws.contract.items || [];
    var q = filterQ.trim().toLowerCase();
    var terms = q.split(/\s+/).filter(Boolean);
    var shown = items.filter(function (it) {
      if (!terms.length) return true;
      var hay = ((it.description || "") + " " + (it.code || "")).toLowerCase();
      return terms.every(function (t) {
        return hay.indexOf(t) !== -1;
      });
    });

    if (!items.length) {
      host.innerHTML =
        '<div class="ws-blank"><h3>No contract schedule</h3>' +
        "<p>Upload your turnkey SoR — long descriptive items are fine. Codes are optional. Then link assemblies under Bills as.</p>" +
        '<div class="ws-blank-actions">' +
        '<button type="button" class="ws-btn ws-btn-primary" id="cUp">Upload schedule</button>' +
        '<button type="button" class="ws-btn" id="cDemo">Load demo</button></div></div>';
      host.querySelector("#cUp").addEventListener("click", importContract);
      host.querySelector("#cDemo").addEventListener("click", loadDemoContract);
      return;
    }

    var card = document.createElement("div");
    card.className = "ws-card";
    card.innerHTML =
      '<div class="ws-card-head"><div><h2>' +
      esc(ws.contract.name || "Contract schedule") +
      "</h2><p>" +
      items.length +
      " items · description-first</p></div>" +
      '<div class="ws-card-head-actions"><input class="ws-input ws-btn-sm" id="cFilter" placeholder="Search description…" value="' +
      esc(filterQ) +
      '" style="min-width:180px"></div></div>' +
      '<div class="ws-scroll-y"><div class="ws-rows" id="cRows"></div></div>';
    host.appendChild(card);

    card.querySelector("#cFilter").addEventListener("input", function (e) {
      filterQ = e.target.value;
      App.refresh();
    });

    var rows = card.querySelector("#cRows");
    shown.slice(0, 400).forEach(function (it) {
      var row = document.createElement("div");
      row.className = "ws-row";
      row.innerHTML =
        '<div class="ws-row-main"><div class="ws-row-title">' +
        esc(it.description) +
        ' <span class="ws-pill">' +
        esc(it.type || "material") +
        "</span></div>" +
        '<div class="ws-row-sub">' +
        esc(it.unit || "NOS") +
        " · ₹" +
        App.money(it.rate) +
        (it.code ? " · " + esc(it.code) : "") +
        "</div></div>";
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ws-btn ws-btn-sm";
      btn.textContent = "Edit";
      btn.addEventListener("click", function () {
        openItemEdit(it);
      });
      var actions = document.createElement("div");
      actions.className = "ws-row-actions";
      actions.appendChild(btn);
      row.appendChild(actions);
      rows.appendChild(row);
    });
  }

  function renderBills(host, ws) {
    if (!(ws.assemblies || []).length) {
      host.innerHTML =
        '<div class="ws-blank"><h3>No assemblies in the job</h3><p>Add assemblies from Survey suggestions or Assemblies search, then link each to a contract line.</p>' +
        '<div class="ws-blank-actions"><button type="button" class="ws-btn ws-btn-primary" id="goAsm">Go to Assemblies</button></div></div>';
      host.querySelector("#goAsm").addEventListener("click", function () {
        App.go("assemblies");
      });
      return;
    }
    if (!(ws.contract.items || []).length) {
      host.innerHTML =
        '<div class="ws-blank"><h3>Upload a contract schedule first</h3><p>Then come back here to set Bills as on each assembly.</p>' +
        '<div class="ws-blank-actions"><button type="button" class="ws-btn ws-btn-primary" id="goSch">Upload schedule</button></div></div>';
      host.querySelector("#goSch").addEventListener("click", function () {
        viewMode = "schedule";
        App.refresh();
      });
      return;
    }

    var card = document.createElement("div");
    card.className = "ws-card";
    card.innerHTML =
      '<div class="ws-card-head"><div><h2>Bills as</h2><p>Each job assembly → one or more descriptive contract lines.</p></div></div>' +
      '<div class="ws-rows" id="bRows"></div>';
    host.appendChild(card);
    var rows = card.querySelector("#bRows");
    ws.assemblies.forEach(function (kit) {
      var links = ws.billsAs[kit.id] || [];
      var labels = links
        .map(function (l) {
          var it = (ws.contract.items || []).find(function (i) {
            return i.id === l.itemId;
          });
          return it ? it.description : null;
        })
        .filter(Boolean);
      var row = document.createElement("div");
      row.className = "ws-row";
      row.innerHTML =
        '<div class="ws-row-main"><div class="ws-row-title">' +
        esc(Cat.title(kit)) +
        (links.length
          ? ' <span class="ws-pill ws-pill-ok">' + links.length + " linked</span>"
          : ' <span class="ws-pill ws-pill-warn">unmapped</span>') +
        '</div><div class="ws-row-sub">' +
        esc(labels.length ? labels.join(" · ").slice(0, 140) : Cat.subtitle(kit)) +
        "</div></div>";
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ws-btn ws-btn-sm" + (links.length ? "" : " ws-btn-primary");
      btn.textContent = links.length ? "Edit links" : "Link…";
      btn.addEventListener("click", function () {
        openBillsAsForAssembly(kit);
      });
      var actions = document.createElement("div");
      actions.className = "ws-row-actions";
      actions.appendChild(btn);
      row.appendChild(actions);
      rows.appendChild(row);
    });
  }

  function render(host, ws) {
    var stack = document.createElement("div");
    stack.className = "ws-stack";
    stack.innerHTML =
      '<div class="ws-toggle" id="cMode">' +
      '<button type="button" data-mode="schedule"' +
      (viewMode === "schedule" ? ' class="is-active"' : "") +
      ">Schedule</button>" +
      '<button type="button" data-mode="bills"' +
      (viewMode === "bills" ? ' class="is-active"' : "") +
      ">Bills as</button></div>" +
      '<div id="cBody"></div>';
    host.appendChild(stack);
    stack.querySelectorAll("#cMode button").forEach(function (btn) {
      btn.addEventListener("click", function () {
        viewMode = btn.getAttribute("data-mode");
        App.refresh();
      });
    });
    var body = stack.querySelector("#cBody");
    if (viewMode === "bills") renderBills(body, ws);
    else renderSchedule(body, ws);
  }

  App.register("contract", {
    label: "Contract",
    title: "Contract",
    hint: "SoR upload · Bills as on assemblies",
    badge: function (ws) {
      return (ws.contract.items || []).length || "";
    },
    actions: function (ws) {
      var list = [
        { label: "Upload schedule", kind: "primary", onClick: importContract },
        {
          label: "Add item",
          onClick: function () {
            openItemEdit(null);
          },
        },
      ];
      if (!(ws.contract.items || []).length) {
        list.push({ label: "Demo", kind: "quiet", onClick: loadDemoContract });
      }
      return list;
    },
    render: render,
  });
})(window);
