/**
 * Assemblies — search the shared catalog, keep only a few in this job, customize recipes.
 */
(function (global) {
  "use strict";

  var App = global.SlmWsApp;
  var WS = global.SlmWorkspace;
  var Cat = global.SlmCatalog;
  var esc = App.escapeHtml;
  var searchQ = "";
  var pendingOpenId = null;

  function ensureCatalogThen(cb) {
    if (Cat.isLoaded()) {
      if (cb) cb();
      return;
    }
    Cat.load()
      .then(function () {
        if (cb) cb();
        else App.refresh();
      })
      .catch(function (err) {
        App.toast("Catalog failed: " + (err.message || err));
      });
  }

  function cloneKit(kit) {
    return JSON.parse(JSON.stringify(Object.assign({}, kit, { source: kit.source || "library" })));
  }

  function addToJob(kit) {
    WS.update(function (ws) {
      if (ws.assemblies.some(function (a) {
        return a.id === kit.id;
      }))
        return;
      ws.assemblies.push(cloneKit(kit));
    }, "assemblies");
  }

  function removeFromJob(id) {
    WS.update(function (ws) {
      ws.assemblies = ws.assemblies.filter(function (a) {
        return a.id !== id;
      });
      delete ws.counts[id];
      delete ws.billsAs[id];
    }, "assemblies");
  }

  function setCount(id, n) {
    WS.update(function (ws) {
      var v = Number(n);
      if (!v || v <= 0) delete ws.counts[id];
      else ws.counts[id] = v;
    }, "counts");
  }

  function surveyCount(ws, kitId) {
    if (!ws.survey || !global.SlmWsSurvey) return null;
    var h = global.SlmWsSurvey.hits(ws);
    if (!h) return null;
    if (h.structureQty.has(kitId)) return { n: h.structureQty.get(kitId).n, unit: "poles" };
    for (var i = 0; i < h.conductorHits.length; i += 1) {
      if (h.conductorHits[i].kit.id === kitId)
        return { n: h.conductorHits[i].km, unit: "km" };
    }
    return null;
  }

  function effectiveCount(ws, kit) {
    if (ws.counts[kit.id] != null && Number(ws.counts[kit.id]) > 0) {
      return {
        n: Number(ws.counts[kit.id]),
        unit: kit.qtyBasis === "per_km" || kit.family === "conductor" ? "km" : "poles",
        source: "concept",
      };
    }
    var s = surveyCount(ws, kit.id);
    if (s) return Object.assign({ source: "survey" }, s);
    return {
      n: 0,
      unit: kit.qtyBasis === "per_km" || kit.family === "conductor" ? "km" : "poles",
      source: "none",
    };
  }

  /* ---------- detail drawer ---------- */

  function openDetail(kitId) {
    var ws = WS.get();
    var kit = WS.assemblyById(ws, kitId);
    if (!kit) {
      pendingOpenId = kitId;
      return;
    }
    pendingOpenId = null;

    App.openDrawer({
      title: Cat.title(kit),
      subtitle: Cat.subtitle(kit),
      render: function (body) {
        renderDetail(body, kit);
      },
    });
  }

  function renderDetail(body, kit) {
    var ws = WS.get();
    var ratebook = WS.ratebook(ws);
    var rateIndex = {};
    (ratebook.materials || []).concat(ratebook.labour || []).forEach(function (r) {
      if (r.code) rateIndex[r.code] = r;
    });
    // Fall back to bundled rates for display when My rates is empty
    if (!Object.keys(rateIndex).length && Cat.isLoaded()) {
      var bundled = Cat.bundledRatebook();
      (bundled.materials || []).concat(bundled.labour || []).forEach(function (r) {
        if (r.code) rateIndex[r.code] = r;
      });
    }

    var lines = kit.lines || [];
    var cnt = effectiveCount(ws, kit);
    var bills = (ws.billsAs[kit.id] || [])
      .map(function (l) {
        var item = (ws.contract.items || []).find(function (i) {
          return i.id === l.itemId;
        });
        return { link: l, item: item };
      })
      .filter(function (x) {
        return x.item;
      });

    body.innerHTML =
      '<div class="ws-field-row">' +
      '<label class="ws-field"><span>Quantity (' +
      esc(cnt.unit) +
      ")</span>" +
      '<input class="ws-input" type="number" min="0" step="0.001" id="wsAsmQty" value="' +
      (ws.counts[kit.id] != null ? esc(String(ws.counts[kit.id])) : "") +
      '" placeholder="' +
      (cnt.source === "survey" ? "Survey: " + App.qty(cnt.n) : "Concept qty") +
      '"></label>' +
      '<label class="ws-field"><span>Source</span><div class="ws-input" style="background:#f7f9fc">' +
      esc(
        cnt.source === "survey"
          ? "From survey (" + App.qty(cnt.n) + ")"
          : cnt.source === "concept"
            ? "Concept override"
            : "Not set"
      ) +
      "</div></label></div>" +
      '<p class="ws-note">Leave quantity blank to use the survey count. Enter a number for pre-survey planning.</p>' +
      '<div class="ws-section-label">Recipe · ' +
      lines.length +
      " lines</div>" +
      '<div class="ws-mini-rows" id="wsAsmLines"></div>' +
      '<div style="display:flex;gap:8px;margin-top:10px">' +
      '<button type="button" class="ws-btn ws-btn-sm" id="wsAsmAddLine">+ Add line</button>' +
      '<button type="button" class="ws-btn ws-btn-sm" id="wsAsmSearchRate">Search My rates</button>' +
      "</div>" +
      '<div class="ws-section-label">Bills as (contract)</div>' +
      (bills.length
        ? '<div class="ws-mini-rows">' +
          bills
            .map(function (b) {
              return (
                '<div class="ws-mini-row"><div class="ws-mini-row-main">' +
                esc(b.item.description || b.item.id) +
                ' <span class="ws-pill">×' +
                App.qty(b.link.qtyPerUnit) +
                "</span></div>" +
                '<button type="button" class="ws-icon-btn" data-unlink="' +
                esc(b.item.id) +
                '">×</button></div>'
              );
            })
            .join("") +
          "</div>"
        : '<p class="ws-note">No contract line yet. Open <strong>Contract</strong> to upload a schedule, then link from there — or pick below.</p>') +
      '<button type="button" class="ws-btn ws-btn-sm" id="wsAsmBillsAs" style="margin-top:8px">Link contract item…</button>' +
      '<div style="display:flex;gap:8px;justify-content:space-between;margin-top:22px">' +
      '<button type="button" class="ws-btn ws-btn-danger" id="wsAsmRemove">Remove from job</button>' +
      '<button type="button" class="ws-btn ws-btn-primary" id="wsAsmSave">Save</button>' +
      "</div>";

    var linesHost = body.querySelector("#wsAsmLines");
    lines.forEach(function (line, idx) {
      var rate = rateIndex[line.code] || Cat.rateFor(line.code) || {};
      var row = document.createElement("div");
      row.className = "ws-mini-row";
      row.innerHTML =
        '<div class="ws-mini-row-main"><strong>' +
        esc(line.code || "—") +
        "</strong> · " +
        esc(rate.description || line.description || line.type || "") +
        '</div><input class="ws-input ws-mini-qty" type="number" min="0" step="0.001" data-line-qty="' +
        idx +
        '" value="' +
        esc(String(line.qty != null ? line.qty : 1)) +
        '"><button type="button" class="ws-icon-btn" data-line-del="' +
        idx +
        '">×</button>';
      linesHost.appendChild(row);
    });
    if (!lines.length) {
      linesHost.innerHTML = '<div class="ws-empty" style="padding:14px">No materials yet — add from My rates.</div>';
    }

    body.querySelector("#wsAsmSave").addEventListener("click", function () {
      var qtyVal = body.querySelector("#wsAsmQty").value;
      var nextLines = (kit.lines || []).map(function (line, idx) {
        var inp = body.querySelector('[data-line-qty="' + idx + '"]');
        return Object.assign({}, line, {
          qty: inp ? Number(inp.value) || 0 : line.qty,
        });
      });
      WS.update(function (w) {
        var a = WS.assemblyById(w, kit.id);
        if (!a) return;
        a.lines = nextLines.filter(function (l) {
          return l.qty > 0;
        });
        if (qtyVal === "" || qtyVal == null) delete w.counts[kit.id];
        else w.counts[kit.id] = Number(qtyVal) || 0;
      }, "assemblies");
      App.closeDrawer();
      App.refresh();
      App.toast("Assembly saved");
    });

    body.querySelector("#wsAsmRemove").addEventListener("click", async function () {
      var ok = await global.SlmDialog.confirm({
        title: "Remove assembly?",
        message: "It leaves this job. The shared catalog is unchanged.",
        okLabel: "Remove",
        danger: true,
      });
      if (!ok) return;
      removeFromJob(kit.id);
      App.closeDrawer();
      App.refresh();
    });

    body.querySelectorAll("[data-line-del]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var idx = Number(btn.getAttribute("data-line-del"));
        WS.update(function (w) {
          var a = WS.assemblyById(w, kit.id);
          if (!a || !a.lines) return;
          a.lines.splice(idx, 1);
        }, "assemblies");
        openDetail(kit.id);
      });
    });

    body.querySelector("#wsAsmAddLine").addEventListener("click", function () {
      pickRateForAssembly(kit.id);
    });
    body.querySelector("#wsAsmSearchRate").addEventListener("click", function () {
      pickRateForAssembly(kit.id);
    });
    body.querySelector("#wsAsmBillsAs").addEventListener("click", function () {
      pickContractItem(kit.id);
    });
    body.querySelectorAll("[data-unlink]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var itemId = btn.getAttribute("data-unlink");
        WS.update(function (w) {
          w.billsAs[kit.id] = (w.billsAs[kit.id] || []).filter(function (l) {
            return l.itemId !== itemId;
          });
          if (!w.billsAs[kit.id].length) delete w.billsAs[kit.id];
        }, "billsAs");
        openDetail(kit.id);
      });
    });
  }

  function pickRateForAssembly(kitId) {
    App.openDrawer({
      title: "Add material / labour",
      subtitle: "Search My rates, or the bundled catalog if My rates is empty.",
      render: function (body) {
        body.innerHTML =
          '<div class="ws-search"><input id="wsPickRateQ" placeholder="Search description or code…" autofocus><span class="ws-search-hint">Enter</span></div>' +
          '<div class="ws-rows" id="wsPickRateList" style="margin-top:12px"></div>';
        var input = body.querySelector("#wsPickRateQ");
        var list = body.querySelector("#wsPickRateList");

        function draw() {
          var ws = WS.get();
          var q = input.value.trim();
          var mine = (ws.rates.materials || []).concat(ws.rates.labour || []);
          var pool = mine.length
            ? mine.filter(function (r) {
                if (!q) return true;
                var hay = (r.code + " " + (r.description || "")).toLowerCase();
                return q
                  .toLowerCase()
                  .split(/\s+/)
                  .every(function (t) {
                    return hay.indexOf(t) !== -1;
                  });
              })
            : Cat.searchRates(q, { limit: 40 });
          list.innerHTML = "";
          if (!pool.length) {
            list.innerHTML =
              '<div class="ws-empty">No matches. Upload My rates under the Rates section, or try different words.</div>';
            return;
          }
          pool.slice(0, 40).forEach(function (r) {
            var row = document.createElement("div");
            row.className = "ws-row";
            row.innerHTML =
              '<div class="ws-row-main"><div class="ws-row-title">' +
              esc(r.description || r.code) +
              '</div><div class="ws-row-sub">' +
              esc(r.code || "") +
              " · " +
              esc(r.unit || "NOS") +
              " · ₹" +
              App.money(r.rate) +
              "</div></div>";
            var btn = document.createElement("button");
            btn.type = "button";
            btn.className = "ws-btn ws-btn-sm ws-btn-primary";
            btn.textContent = "Add";
            btn.addEventListener("click", function () {
              WS.update(function (w) {
                var a = WS.assemblyById(w, kitId);
                if (!a) return;
                a.lines = a.lines || [];
                if (a.lines.some(function (l) {
                  return l.code === r.code;
                }))
                  return;
                a.lines.push({
                  code: r.code,
                  type: r.type === "labour" ? "labour" : "material",
                  qty: 1,
                  description: r.description,
                });
              }, "assemblies");
              openDetail(kitId);
              App.toast("Line added");
            });
            var actions = document.createElement("div");
            actions.className = "ws-row-actions";
            actions.appendChild(btn);
            row.appendChild(actions);
            list.appendChild(row);
          });
        }
        input.addEventListener("input", draw);
        draw();
        setTimeout(function () {
          input.focus();
        }, 40);
      },
    });
  }

  function pickContractItem(kitId) {
    var ws = WS.get();
    if (!(ws.contract.items || []).length) {
      App.toast("Upload a contract schedule first (Contract section)");
      App.go("contract");
      return;
    }
    App.openDrawer({
      title: "Bills as…",
      subtitle: "Search by the long description — code is optional.",
      render: function (body) {
        body.innerHTML =
          '<div class="ws-search"><input id="wsPickCtrQ" placeholder="Search contract description…" autofocus></div>' +
          '<div class="ws-rows" id="wsPickCtrList" style="margin-top:12px"></div>';
        var input = body.querySelector("#wsPickCtrQ");
        var list = body.querySelector("#wsPickCtrList");
        function draw() {
          var q = input.value.trim().toLowerCase();
          var terms = q.split(/\s+/).filter(Boolean);
          var items = (WS.get().contract.items || []).filter(function (it) {
            if (!terms.length) return true;
            var hay = ((it.description || "") + " " + (it.code || "")).toLowerCase();
            return terms.every(function (t) {
              return hay.indexOf(t) !== -1;
            });
          });
          list.innerHTML = "";
          items.slice(0, 40).forEach(function (it) {
            var row = document.createElement("div");
            row.className = "ws-row";
            row.innerHTML =
              '<div class="ws-row-main"><div class="ws-row-title">' +
              esc(it.description || it.code || it.id) +
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
                var prev = w.billsAs[kitId] || [];
                if (prev.some(function (l) {
                  return l.itemId === it.id;
                }))
                  return;
                w.billsAs[kitId] = prev.concat([{ itemId: it.id, qtyPerUnit: 1 }]);
              }, "billsAs");
              openDetail(kitId);
              App.toast("Linked");
            });
            var actions = document.createElement("div");
            actions.className = "ws-row-actions";
            actions.appendChild(btn);
            row.appendChild(actions);
            list.appendChild(row);
          });
          if (!items.length)
            list.innerHTML = '<div class="ws-empty">No contract items match.</div>';
        }
        input.addEventListener("input", draw);
        draw();
        setTimeout(function () {
          input.focus();
        }, 40);
      },
    });
  }

  /* ---------- search / add ---------- */

  function openSearchAdd() {
    ensureCatalogThen(function () {
      App.openDrawer({
        title: "Add assembly",
        subtitle: "Search by words — e.g. “11 angle 2p”. Only add what this job needs.",
        render: function (body) {
          body.innerHTML =
            '<div class="ws-search"><input id="wsAsmSearchQ" placeholder="11kV tangent 1P…" autofocus><span class="ws-search-hint">type to search</span></div>' +
            '<div class="ws-rows" id="wsAsmSearchList" style="margin-top:12px"></div>';
          var input = body.querySelector("#wsAsmSearchQ");
          var list = body.querySelector("#wsAsmSearchList");
          function draw() {
            var q = input.value.trim();
            list.innerHTML = "";
            if (q.length < 2) {
              list.innerHTML =
                '<div class="ws-empty">Type at least 2 characters. The full catalog is hidden on purpose.</div>';
              return;
            }
            var kits = Cat.search(q, { limit: 35, withLinesOnly: false });
            if (!kits.length) {
              list.innerHTML = '<div class="ws-empty">No assemblies match those words.</div>';
              return;
            }
            kits.forEach(function (kit) {
              var here = WS.hasAssembly(WS.get(), kit.id);
              var row = document.createElement("div");
              row.className = "ws-row";
              row.innerHTML =
                '<div class="ws-row-main"><div class="ws-row-title">' +
                esc(Cat.title(kit)) +
                (kit.complete ? ' <span class="ws-pill ws-pill-ok">final</span>' : ' <span class="ws-pill">draft</span>') +
                (here ? ' <span class="ws-pill ws-pill-accent">in job</span>' : "") +
                '</div><div class="ws-row-sub">' +
                esc(Cat.subtitle(kit)) +
                " · " +
                (kit.lines || []).length +
                " lines</div></div>";
              if (!here) {
                var btn = document.createElement("button");
                btn.type = "button";
                btn.className = "ws-btn ws-btn-sm ws-btn-primary";
                btn.textContent = "Add";
                btn.addEventListener("click", function () {
                  addToJob(kit);
                  App.refresh();
                  App.toast("Added");
                  draw();
                });
                var actions = document.createElement("div");
                actions.className = "ws-row-actions";
                actions.appendChild(btn);
                row.appendChild(actions);
              }
              list.appendChild(row);
            });
          }
          input.addEventListener("input", draw);
          draw();
          setTimeout(function () {
            input.focus();
          }, 40);
        },
      });
    });
  }

  /* ---------- main render ---------- */

  function render(host, ws) {
    if (!Cat.isLoaded()) ensureCatalogThen();

    var stack = document.createElement("div");
    stack.className = "ws-stack";

    if (!(ws.assemblies || []).length) {
      stack.innerHTML =
        '<div class="ws-blank">' +
        "<h3>No assemblies in this job yet</h3>" +
        "<p>Import a survey to get suggestions, or search the shared catalog and add only what you need. You will customize a few — not browse 150+ filters.</p>" +
        '<div class="ws-blank-actions">' +
        '<button type="button" class="ws-btn ws-btn-primary" id="wsAsmBlankAdd">Search &amp; add</button>' +
        '<button type="button" class="ws-btn" id="wsAsmBlankSurvey">Go to Survey</button>' +
        "</div></div>";
      host.appendChild(stack);
      stack.querySelector("#wsAsmBlankAdd").addEventListener("click", openSearchAdd);
      stack.querySelector("#wsAsmBlankSurvey").addEventListener("click", function () {
        App.go("survey");
      });
      return;
    }

    stack.innerHTML =
      '<div class="ws-card"><div class="ws-card-head"><div><h2>This job · ' +
      ws.assemblies.length +
      " assemblies</h2>" +
      "<p>Customize recipes and quantities. Contract billing is set under Bills as.</p></div></div>" +
      '<div class="ws-rows" id="wsAsmRows"></div></div>';
    host.appendChild(stack);

    var rows = stack.querySelector("#wsAsmRows");
    ws.assemblies.forEach(function (kit) {
      var cnt = effectiveCount(ws, kit);
      var linked = (ws.billsAs[kit.id] || []).length;
      var row = document.createElement("div");
      row.className = "ws-row";
      row.innerHTML =
        '<div class="ws-row-main"><div class="ws-row-title">' +
        esc(Cat.title(kit)) +
        (linked
          ? ' <span class="ws-pill ws-pill-accent">bills as</span>'
          : "") +
        '</div><div class="ws-row-sub">' +
        esc(Cat.subtitle(kit)) +
        " · " +
        (kit.lines || []).length +
        " lines" +
        (cnt.source === "survey"
          ? " · survey " + App.qty(cnt.n) + " " + cnt.unit
          : cnt.source === "concept"
            ? " · concept " + App.qty(cnt.n) + " " + cnt.unit
            : "") +
        "</div></div>";
      var actions = document.createElement("div");
      actions.className = "ws-row-actions";
      var qtyInp = document.createElement("input");
      qtyInp.className = "ws-input ws-btn-sm";
      qtyInp.style.width = "72px";
      qtyInp.type = "number";
      qtyInp.min = "0";
      qtyInp.step = "0.001";
      qtyInp.placeholder = cnt.source === "survey" ? App.qty(cnt.n) : "qty";
      qtyInp.value = ws.counts[kit.id] != null ? String(ws.counts[kit.id]) : "";
      qtyInp.title = "Concept quantity (blank = use survey)";
      qtyInp.addEventListener("change", function () {
        setCount(kit.id, qtyInp.value);
        App.refresh();
      });
      var edit = document.createElement("button");
      edit.type = "button";
      edit.className = "ws-btn ws-btn-sm";
      edit.textContent = "Customize";
      edit.addEventListener("click", function () {
        openDetail(kit.id);
      });
      actions.appendChild(qtyInp);
      actions.appendChild(edit);
      row.appendChild(actions);
      rows.appendChild(row);
    });

    if (pendingOpenId) {
      var id = pendingOpenId;
      pendingOpenId = null;
      setTimeout(function () {
        openDetail(id);
      }, 0);
    }
  }

  App.register("assemblies", {
    label: "Assemblies",
    title: "Assemblies",
    hint: "Job kits — search, add, customize",
    badge: function (ws) {
      return (ws.assemblies || []).length || "";
    },
    actions: function () {
      return [
        { label: "Search & add", kind: "primary", onClick: openSearchAdd },
      ];
    },
    render: render,
  });

  global.SlmWsAssemblies = {
    openDetail: openDetail,
    addToJob: addToJob,
    effectiveCount: effectiveCount,
  };
})(window);
