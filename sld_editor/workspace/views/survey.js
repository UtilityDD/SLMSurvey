/**
 * Survey view — import the field JSON, see which assemblies it needs, fix poles here.
 */
(function (global) {
  "use strict";

  var App = global.SlmWsApp;
  var WS = global.SlmWorkspace;
  var Cat = global.SlmCatalog;
  var esc = App.escapeHtml;

  var SESSION_KEY = "slm_estimate_workspace_v1";
  var cache = { hits: null, forSurvey: null };
  var poleFilter = "";
  var printMode = false;
  var printOpts = {
    pageSize: "A4",
    orientation: "landscape",
    dpi: "200",
    pageMode: "auto",
    title: "",
    surveyor: "",
    company: "",
    drawingNo: "",
    scale: "NTS",
  };

  function surveyStamp(ws) {
    return (
      (ws.survey ? ws.survey.surveyId || ws.survey.title : "none") +
      "|" +
      JSON.stringify(ws.poleOverrides || {}).length +
      "|" +
      (ws.assemblies || []).length
    );
  }

  /** Match the survey against the whole shared catalog so we can suggest additions. */
  function hits(ws) {
    var stamp = surveyStamp(ws);
    if (cache.hits && cache.forSurvey === stamp) return cache.hits;
    var survey = WS.effectiveSurvey(ws);
    if (!survey || !Cat.isLoaded()) return null;
    var res = global.SlmEstimateMatch.collectKitHits(survey, Cat.all());
    cache.hits = res;
    cache.forSurvey = stamp;
    return res;
  }

  function invalidate() {
    cache.hits = null;
    cache.forSurvey = null;
  }

  function suggestions(ws) {
    var h = hits(ws);
    if (!h) return [];
    var rows = [];
    h.structureQty.forEach(function (entry) {
      rows.push({ kit: entry.kit, n: entry.n, unit: "poles" });
    });
    h.conductorHits.forEach(function (entry) {
      rows.push({ kit: entry.kit, n: entry.km, unit: "km" });
    });
    rows.sort(function (a, b) {
      return b.n - a.n;
    });
    return rows;
  }

  async function importSurveyFile() {
    var input = document.createElement("input");
    input.type = "file";
    input.accept = ".slmmap,.json,application/json,application/octet-stream";
    input.addEventListener("change", async function () {
      var file = input.files && input.files[0];
      if (!file) return;
      try {
        var text = await file.text();
        var opened = await window.SlmSeal.openTransferText(text, window.SlmSeal.KIND_MAP);
        setSurvey(opened.payload, file.name);
        if (opened.license && opened.license.customerName) {
          App.toast("Map from " + opened.license.customerName);
        }
      } catch (err) {
        App.toast("Could not read survey: " + (err.message || err));
      }
    });
    input.click();
  }

  function setSurvey(json, label) {
    if (!json || !Array.isArray(json.assets)) {
      App.toast("That file has no survey assets");
      return;
    }
    WS.update(function (ws) {
      ws.survey = json;
      ws.poleOverrides = {};
      if (!ws.name || ws.name === "Untitled job") {
        ws.name = json.title || json.surveyTitle || label || "Imported survey";
      }
    }, "survey");
    invalidate();
    ensureCatalog(true);
  }

  function takeSessionHandoff() {
    try {
      var raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return false;
      sessionStorage.removeItem(SESSION_KEY);
      setSurvey(JSON.parse(raw), "From CAD");
      return true;
    } catch (err) {
      return false;
    }
  }

  async function loadDemoSurvey() {
    try {
      var res = await fetch("../demo/sample_workspace_33_11_lt.json");
      if (!res.ok) throw new Error("HTTP " + res.status);
      setSurvey(await res.json(), "Demo survey");
      App.toast("Demo survey loaded");
    } catch (err) {
      App.toast("Demo needs a local web server. " + (err.message || err));
    }
  }

  var loadingCatalog = false;

  function ensureCatalog(thenRefresh) {
    if (Cat.isLoaded() || loadingCatalog) {
      if (thenRefresh) App.refresh();
      return;
    }
    loadingCatalog = true;
    Cat.load()
      .then(function () {
        loadingCatalog = false;
        invalidate();
        App.refresh();
      })
      .catch(function (err) {
        loadingCatalog = false;
        App.toast("Assembly catalog failed to load: " + (err.message || err));
      });
    if (thenRefresh) App.refresh();
  }

  function addAssembly(kit, count, unit) {
    WS.update(function (ws) {
      if (!ws.assemblies.some(function (a) {
        return a.id === kit.id;
      })) {
        ws.assemblies.push(
          JSON.parse(JSON.stringify(Object.assign({}, kit, { source: "library" })))
        );
      }
      if (count != null) ws.counts[kit.id] = null;
    }, "assemblies");
  }

  function addAllSuggested(ws) {
    var rows = suggestions(ws);
    var added = 0;
    WS.update(function (w) {
      rows.forEach(function (r) {
        if (!w.assemblies.some(function (a) {
          return a.id === r.kit.id;
        })) {
          w.assemblies.push(
            JSON.parse(JSON.stringify(Object.assign({}, r.kit, { source: "library" })))
          );
          added += 1;
        }
      });
    }, "assemblies");
    App.toast(added ? "Added " + added + " assemblies to this job" : "Already in the job");
    App.refresh();
  }

  var selectedAssetId = null;

  function effectiveAsset(ws, asset) {
    var ov = (ws.poleOverrides || {})[asset.id];
    return ov ? Object.assign({}, asset, ov) : asset;
  }

  function findAsset(ws, id) {
    return ((ws.survey && ws.survey.assets) || []).find(function (a) {
      return String(a.id) === String(id);
    });
  }

  /* ---------- pole editing (inline beside map) ---------- */

  function selectPole(asset) {
    selectedAssetId = asset ? asset.id : null;
    if (global.SlmWsMap) global.SlmWsMap.setSelected(selectedAssetId);
    App.refresh();
  }

  function chipRow(label, key, options, selected, locked) {
    if (!options || !options.length) {
      return (
        '<div class="ws-chip-field"><span class="ws-chip-label">' +
        esc(label) +
        '</span><span class="ws-chip-na">Not used for this combination</span></div>'
      );
    }
    return (
      '<div class="ws-chip-field' +
      (locked ? " is-locked" : "") +
      '"><span class="ws-chip-label">' +
      esc(label) +
      (locked ? " <em>survey</em>" : "") +
      '</span><div class="ws-chips" data-axis="' +
      esc(key) +
      '">' +
      options
        .map(function (o) {
          var val = typeof o === "string" ? o : o.id || o.label;
          var lab = typeof o === "string" ? o : o.label || o.id;
          var on = String(val) === String(selected);
          return (
            '<button type="button" class="ws-chip' +
            (on ? " is-on" : "") +
            '"' +
            (locked ? " disabled" : "") +
            ' data-value="' +
            esc(val) +
            '">' +
            esc(lab) +
            "</button>"
          );
        })
        .join("") +
      "</div></div>"
    );
  }

  function renderPoleEditor(panel, asset, ws) {
    var CatNet = global.SlmNetworkCatalog;
    var ov = (ws.poleOverrides || {})[asset.id] || {};
    var voltage = CatNet
      ? CatNet.normVoltage(asset.voltage)
      : asset.voltage || "11kV";

    var stateDraft = {
      structure: ov.structure != null ? ov.structure : asset.structure,
      kitLocation: ov.kitLocation != null ? ov.kitLocation : asset.kitLocation,
      kitArrangement:
        ov.kitArrangement != null ? ov.kitArrangement : asset.kitArrangement,
      kitExtension: ov.kitExtension != null ? ov.kitExtension : asset.kitExtension,
      conductor: ov.conductor != null ? ov.conductor : asset.conductor,
      poleMaterial: asset.poleMaterial || asset.material,
      dtrMount:
        ov.dtrMount != null
          ? ov.dtrMount
          : String(asset.dtrMount || "")
              .replace(/^DTR/i, "")
              .trim(),
      dtCapacityKva:
        ov.dtCapacityKva != null
          ? String(ov.dtCapacityKva).replace(/\D/g, "")
          : String(asset.dtCapacityKva || "").replace(/\D/g, ""),
    };

    function paint() {
      var pack = CatNet
        ? CatNet.optionsFor(voltage, stateDraft)
        : {
            structures: ["1P", "2P", "3P"],
            locations: ["Tangent", "Angular", "Dead-end", "T-Off"],
            arrangements: ["In-line", "Sectional"],
            extensions: ["No ext"],
            conductors: [],
            dtrMounts: [
              { id: "2P", label: "On 2P" },
              { id: "4P", label: "On 4P" },
            ],
            dtrCapacities: ["16", "25", "63", "100", "160", "250"],
            draft: stateDraft,
          };
      stateDraft = Object.assign(stateDraft, pack.draft);
      var structLabel = voltage === "LT" ? "Phase" : "Structure";
      var isDtr = String(stateDraft.structure) === "DTR";
      var mountOpts =
        pack.dtrMounts && pack.dtrMounts.length
          ? pack.dtrMounts
          : [
              { id: "2P", label: "On 2P" },
              { id: "4P", label: "On 4P" },
            ];
      var capOpts = (
        pack.dtrCapacities && pack.dtrCapacities.length
          ? pack.dtrCapacities
          : ["16", "25", "63", "100", "160", "250"]
      ).map(function (c) {
        var id = String(c).replace(/\D/g, "") || String(c);
        return { id: id, label: id + " kVA" };
      });

      panel.innerHTML =
        '<div class="ws-pole-edit">' +
        '<div class="ws-pole-edit-head">' +
        "<div><h3>Pole " +
        esc(String(asset.sequence != null ? asset.sequence : asset.id)) +
        "</h3>" +
        '<p class="ws-note" style="margin:4px 0 0">Voltage locked from survey · phone combination rules</p></div>' +
        '<button type="button" class="ws-btn ws-btn-quiet ws-btn-sm" id="wsPoleBack">Back</button>' +
        "</div>" +
        chipRow("Voltage", "voltage", [voltage], voltage, true) +
        chipRow("Conductor", "conductor", pack.conductors, stateDraft.conductor, false) +
        chipRow(structLabel, "structure", pack.structures, stateDraft.structure, false) +
        (isDtr
          ? chipRow("DTR mount", "dtrMount", mountOpts, stateDraft.dtrMount, false) +
            chipRow("DTR kVA", "dtCapacityKva", capOpts, stateDraft.dtCapacityKva, false)
          : "") +
        chipRow("Location", "kitLocation", pack.locations, stateDraft.kitLocation, false) +
        chipRow(
          "Arrangement",
          "kitArrangement",
          pack.arrangements,
          stateDraft.kitArrangement,
          false
        ) +
        chipRow("Extension", "kitExtension", pack.extensions, stateDraft.kitExtension, false) +
        '<div class="ws-pole-edit-actions">' +
        '<button type="button" class="ws-btn ws-btn-danger" id="wsPoleClear">Clear</button>' +
        '<button type="button" class="ws-btn ws-btn-primary" id="wsPoleSave">Apply</button>' +
        "</div></div>";

      panel.querySelector("#wsPoleBack").addEventListener("click", function () {
        selectPole(null);
      });
      panel.querySelectorAll(".ws-chips").forEach(function (row) {
        var key = row.getAttribute("data-axis");
        if (key === "voltage") return;
        row.querySelectorAll(".ws-chip").forEach(function (btn) {
          btn.addEventListener("click", function () {
            stateDraft[key] = btn.getAttribute("data-value");
            if (CatNet) stateDraft = Object.assign(stateDraft, CatNet.coerce(voltage, stateDraft));
            paint();
          });
        });
      });
      panel.querySelector("#wsPoleSave").addEventListener("click", function () {
        var next = {};
        [
          "structure",
          "kitLocation",
          "kitArrangement",
          "kitExtension",
          "conductor",
          "dtrMount",
          "dtCapacityKva",
        ].forEach(function (key) {
          var val = String(stateDraft[key] || "").trim();
          var prev = String(asset[key] || "").trim();
          if (key === "dtrMount" || key === "dtCapacityKva") {
            if (String(stateDraft.structure || "") !== "DTR") {
              if (prev) next[key] = "";
              return;
            }
            val =
              key === "dtrMount" ? val.replace(/^DTR/i, "") : val.replace(/\D/g, "");
          }
          if (val && val !== prev) next[key] = val;
        });
        WS.update(function (w) {
          if (Object.keys(next).length) w.poleOverrides[asset.id] = next;
          else delete w.poleOverrides[asset.id];
        }, "poles");
        invalidate();
        App.toast("Pole updated — Save job file to keep it");
        App.refresh();
      });
      panel.querySelector("#wsPoleClear").addEventListener("click", function () {
        WS.update(function (w) {
          delete w.poleOverrides[asset.id];
        }, "poles");
        invalidate();
        App.refresh();
      });
    }

    paint();
  }

  function openPoleDrawer(asset) {
    selectPole(asset);
  }

  /* ---------- render ---------- */

  function renderBlank(host) {
    host.innerHTML =
      '<div class="ws-blank">' +
      "<h3>Load a survey map</h3>" +
      "<p>Import the phone .slmmap / JSON. Then verify poles on the map, fix structures here, add assemblies, and generate the estimate — all in this Job. Use <strong>Save</strong> for a .slmws.json job file.</p>" +
      '<div class="ws-blank-actions">' +
      '<button type="button" class="ws-btn ws-btn-primary" id="wsImportSurvey">Import map</button>' +
      '<button type="button" class="ws-btn" id="wsDemoSurvey">Load demo</button>' +
      "</div>" +
      "</div>";
    host.querySelector("#wsImportSurvey").addEventListener("click", importSurveyFile);
    host.querySelector("#wsDemoSurvey").addEventListener("click", loadDemoSurvey);
  }

  function render(host, ws) {
    if (!ws.survey) return renderBlank(host);

    if (!Cat.isLoaded()) {
      ensureCatalog(false);
      host.innerHTML =
        '<div class="ws-blank"><h3>Matching survey…</h3><p>Loading the shared assembly catalog once for this session.</p></div>';
      return;
    }

    var h = hits(ws);
    var sugg = suggestions(ws);
    var inJob = 0;
    var missing = 0;
    sugg.forEach(function (s) {
      if (WS.hasAssembly(ws, s.kit.id)) inJob += 1;
      else missing += 1;
    });

    var selected = selectedAssetId ? findAsset(ws, selectedAssetId) : null;
    var desk = document.createElement("div");
    desk.className =
      "ws-map-desk" +
      (selected ? " is-editing" : "") +
      (printMode ? " is-print-mode" : "");
    desk.innerHTML =
      '<div class="ws-map-stage">' +
      printToolbarHtml() +
      '<div id="wsMapHost" class="ws-map-host"></div>' +
      '<div class="ws-map-float-actions">' +
      '<button type="button" class="ws-btn ws-btn-sm' +
      (printMode ? " is-active" : "") +
      '" id="wsPrintLayout">Print layout</button>' +
      "</div>" +
      '<div class="ws-map-legend">Structure · voltage colour · span m</div></div>' +
      '<aside class="ws-map-side">' +
      (selected
        ? '<div class="ws-map-side-card ws-map-side-grow" id="wsPolePanel"></div>' +
          '<div class="ws-map-side-foot">' +
          '<button type="button" class="ws-btn ws-btn-sm" id="wsGoAssemblies">Assemblies</button>' +
          '<button type="button" class="ws-btn ws-btn-primary ws-btn-sm" id="wsGoEstimate">Estimate</button>' +
          "</div>"
        : '<div class="ws-metrics ws-metrics-compact">' +
          metric("Poles", h.proposedPoles) +
          metric("Ready", h.readyPoles) +
          metric("Kits", sugg.length) +
          metric("In job", inJob) +
          "</div>" +
          '<div class="ws-map-side-card ws-map-side-actions">' +
          (missing
            ? '<button type="button" class="ws-btn ws-btn-primary ws-btn-sm w-100" id="wsAddAll">Add ' +
              missing +
              " assemblies</button>"
            : '<span class="ws-pill ws-pill-ok">Assemblies ready</span>') +
          '<button type="button" class="ws-btn ws-btn-sm w-100" id="wsGoAssemblies">Assemblies →</button>' +
          '<button type="button" class="ws-btn ws-btn-primary ws-btn-sm w-100" id="wsGoEstimate">Estimate →</button>' +
          "</div>" +
          '<div class="ws-map-side-card ws-map-side-grow" id="wsPolePanel"></div>') +
      "</aside>";

    host.appendChild(desk);

    var effSurvey = WS.effectiveSurvey(ws);
    var mapHost = desk.querySelector("#wsMapHost");
    if (global.SlmWsMap && mapHost) {
      global.SlmWsMap.render(mapHost, effSurvey, {
        selectedId: selectedAssetId,
        onSelect: function (asset) {
          selectPole(asset);
        },
      });
      setTimeout(function () {
        if (global.SlmWsMap && global.SlmWsMap.invalidateSize) {
          global.SlmWsMap.invalidateSize();
        }
      }, 80);
    }

    var addAll = desk.querySelector("#wsAddAll");
    if (addAll) {
      addAll.addEventListener("click", function () {
        addAllSuggested(ws);
      });
    }
    var goAsm = desk.querySelector("#wsGoAssemblies");
    if (goAsm)
      goAsm.addEventListener("click", function () {
        App.go("assemblies");
      });
    var goEst = desk.querySelector("#wsGoEstimate");
    if (goEst)
      goEst.addEventListener("click", function () {
        App.go("estimate");
      });
    var btnPrint = desk.querySelector("#wsPrintLayout");
    if (btnPrint)
      btnPrint.addEventListener("click", function () {
        togglePrintMode();
      });
    wirePrintToolbar(desk);

    var panel = desk.querySelector("#wsPolePanel");
    if (selected) {
      renderPoleEditor(panel, selected, ws);
    } else {
      panel.innerHTML =
        '<div class="ws-card-head"><div><h2>Poles</h2><p>Tap a pole on the map</p></div>' +
        '<input class="ws-input ws-btn-sm" id="wsPoleSearch" placeholder="Find…" style="min-width:100px" value="' +
        esc(poleFilter) +
        '"></div><div class="ws-scroll-y"><div class="ws-rows" id="wsPoleRows"></div></div>';
      wirePoleCard(panel, ws);
    }
  }

  function metric(label, value, small) {
    return (
      '<div class="ws-metric"><div class="ws-metric-label">' +
      esc(label) +
      '</div><div class="ws-metric-value">' +
      esc(String(value)) +
      (small ? " <small>" + esc(small) + "</small>" : "") +
      "</div></div>"
    );
  }

  function suggestionRow(ws, s) {
    var row = document.createElement("div");
    row.className = "ws-row";
    var here = WS.hasAssembly(ws, s.kit.id);
    row.innerHTML =
      '<div class="ws-row-main"><div class="ws-row-title">' +
      esc(Cat.title(s.kit)) +
      (here ? ' <span class="ws-pill ws-pill-ok">in job</span>' : "") +
      '</div><div class="ws-row-sub">' +
      esc(Cat.subtitle(s.kit)) +
      " · " +
      (s.kit.lines || []).length +
      " material/labour lines</div></div>" +
      '<div class="ws-row-num">' +
      App.qty(s.n) +
      " <span class=\"ws-row-sub\" style=\"display:inline\">" +
      esc(s.unit) +
      "</span></div>";

    var actions = document.createElement("div");
    actions.className = "ws-row-actions";
    if (!here) {
      var add = document.createElement("button");
      add.type = "button";
      add.className = "ws-btn ws-btn-sm ws-btn-primary";
      add.textContent = "Add";
      add.addEventListener("click", function () {
        addAssembly(s.kit);
        App.refresh();
        App.toast("Added to this job");
      });
      actions.appendChild(add);
    } else {
      var open = document.createElement("button");
      open.type = "button";
      open.className = "ws-btn ws-btn-sm";
      open.textContent = "Customize";
      open.addEventListener("click", function () {
        App.go("assemblies");
        global.SlmWsAssemblies.openDetail(s.kit.id);
      });
      actions.appendChild(open);
    }
    row.appendChild(actions);
    return row;
  }

  function gapsCard(gaps) {
    return (
      '<div class="ws-card"><div class="ws-card-head"><div><h2>Needs attention</h2>' +
      "<p>" +
      gaps.length +
      " item(s) could not be matched to an assembly</p></div></div>" +
      '<div class="ws-rows">' +
      gaps
        .slice(0, 25)
        .map(function (g) {
          return (
            '<div class="ws-row"><div class="ws-row-main"><div class="ws-row-title">' +
            esc(g.title) +
            "</div>" +
            (g.detail ? '<div class="ws-row-sub">' + esc(g.detail) + "</div>" : "") +
            '</div><div class="ws-row-num">' +
            App.qty(g.qty) +
            " " +
            esc(g.unit || "") +
            "</div></div>"
          );
        })
        .join("") +
      "</div></div>"
    );
  }

  function poleCard(ws) {
    var total = (ws.survey.assets || []).filter(function (a) {
      return a.status === "Proposed";
    }).length;
    var overrides = Object.keys(ws.poleOverrides || {}).length;
    return (
      '<div class="ws-card"><div class="ws-card-head"><div><h2>Poles</h2>' +
      "<p>" +
      total +
      " proposed" +
      (overrides ? " · " + overrides + " changed on desktop" : "") +
      "</p></div>" +
      '<div class="ws-card-head-actions"><input class="ws-input ws-btn-sm" id="wsPoleSearch" placeholder="Find pole…" style="min-width:150px" value="' +
      esc(poleFilter) +
      '"></div></div>' +
      '<div class="ws-scroll-y"><div class="ws-rows" id="wsPoleRows"></div></div></div>'
    );
  }

  function wirePoleCard(stack, ws) {
    var rowsHost = stack.querySelector("#wsPoleRows");
    var search = stack.querySelector("#wsPoleSearch");
    if (!rowsHost) return;

    function draw() {
      var q = poleFilter.trim().toLowerCase();
      var assets = (ws.survey.assets || []).filter(function (a) {
        if (a.status !== "Proposed") return false;
        if (!q) return true;
        return (
          String(a.sequence || "").toLowerCase().indexOf(q) !== -1 ||
          String(a.voltage || "").toLowerCase().indexOf(q) !== -1 ||
          String(a.structure || "").toLowerCase().indexOf(q) !== -1 ||
          String(a.kitLocation || "").toLowerCase().indexOf(q) !== -1
        );
      });
      if (!assets.length) {
        rowsHost.innerHTML = '<div class="ws-empty">No poles match.</div>';
        return;
      }
      rowsHost.innerHTML = "";
      assets.slice(0, 400).forEach(function (a) {
        var ov = (ws.poleOverrides || {})[a.id];
        var eff = ov ? Object.assign({}, a, ov) : a;
        var row = document.createElement("div");
        row.className = "ws-row";
        row.innerHTML =
          '<div class="ws-row-main"><div class="ws-row-title">Pole ' +
          esc(String(a.sequence != null ? a.sequence : a.id)) +
          (ov ? ' <span class="ws-pill ws-pill-warn">changed</span>' : "") +
          '</div><div class="ws-row-sub">' +
          esc(
            [
              eff.voltage,
              eff.structure,
              eff.kitLocation,
              eff.kitArrangement,
              eff.kitExtension,
              eff.conductor,
            ]
              .filter(Boolean)
              .join(" · ") || "no structure details"
          ) +
          "</div></div>";
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ws-btn ws-btn-sm";
        btn.textContent = "Edit";
        btn.addEventListener("click", function () {
          selectPole(a);
        });
        row.addEventListener("click", function (e) {
          if (e.target.closest("button")) return;
          selectPole(a);
        });
        row.style.cursor = "pointer";
        if (selectedAssetId != null && String(a.id) === String(selectedAssetId)) {
          row.classList.add("is-selected");
        }
        var wrap = document.createElement("div");
        wrap.className = "ws-row-actions";
        wrap.appendChild(btn);
        row.appendChild(wrap);
        rowsHost.appendChild(row);
      });
    }

    if (search) {
      search.addEventListener("input", function () {
        poleFilter = search.value;
        draw();
      });
    }
    draw();
  }

  function printToolbarHtml() {
    var o = printOpts;
    function opt(val, label, cur) {
      return (
        '<option value="' +
        val +
        '"' +
        (String(cur) === String(val) ? " selected" : "") +
        ">" +
        label +
        "</option>"
      );
    }
    return (
      '<div class="ws-print-toolbar' +
      (printMode ? " is-open" : "") +
      '" id="wsPrintToolbar">' +
      '<div class="ws-print-toolbar-group">' +
      '<label class="ws-print-lbl" for="wsPrintPageSize">Size</label>' +
      '<select id="wsPrintPageSize" class="ws-print-select">' +
      opt("A4", "A4", o.pageSize) +
      opt("A3", "A3", o.pageSize) +
      opt("A2", "A2", o.pageSize) +
      opt("Letter", "Letter", o.pageSize) +
      opt("Legal", "Legal", o.pageSize) +
      "</select>" +
      '<label class="ws-print-lbl" for="wsPrintOrientation">Orient</label>' +
      '<select id="wsPrintOrientation" class="ws-print-select">' +
      opt("landscape", "Landscape", o.orientation) +
      opt("portrait", "Portrait", o.orientation) +
      "</select>" +
      '<label class="ws-print-lbl" for="wsPrintDpi">DPI</label>' +
      '<select id="wsPrintDpi" class="ws-print-select">' +
      opt("150", "150", o.dpi) +
      opt("200", "200", o.dpi) +
      opt("300", "300", o.dpi) +
      "</select>" +
      '<label class="ws-print-lbl" for="wsPrintPageMode">Pages</label>' +
      '<select id="wsPrintPageMode" class="ws-print-select">' +
      opt("auto", "Auto", o.pageMode) +
      opt("single", "Single", o.pageMode) +
      opt("multi", "Multi", o.pageMode) +
      "</select>" +
      "</div>" +
      '<div class="ws-print-toolbar-group ws-print-meta">' +
      '<input type="text" id="wsPrintTitle" class="ws-print-input" placeholder="Drawing title" value="' +
      esc(o.title) +
      '">' +
      '<input type="text" id="wsPrintSurveyor" class="ws-print-input" placeholder="Surveyor" value="' +
      esc(o.surveyor) +
      '">' +
      '<input type="text" id="wsPrintCompany" class="ws-print-input ws-print-input-sm" placeholder="Org" value="' +
      esc(o.company) +
      '">' +
      '<input type="text" id="wsPrintDrg" class="ws-print-input ws-print-input-sm" placeholder="Drg No." value="' +
      esc(o.drawingNo) +
      '">' +
      '<input type="text" id="wsPrintScale" class="ws-print-input ws-print-input-xs" placeholder="Scale" value="' +
      esc(o.scale) +
      '">' +
      "</div>" +
      '<div class="ws-print-toolbar-group ws-print-actions">' +
      '<button type="button" class="ws-btn ws-btn-primary ws-btn-sm" id="wsPrintPreview">Print preview</button>' +
      '<button type="button" class="ws-btn ws-btn-sm" id="wsPrintPng">PNG</button>' +
      '<button type="button" class="ws-btn ws-btn-sm" id="wsPrintPdf">PDF</button>' +
      '<button type="button" class="ws-btn ws-btn-sm" id="wsPrintClose">Close</button>' +
      "</div>" +
      "</div>"
    );
  }

  function readPrintOptsFromDom(root) {
    var g = function (id) {
      var el = root.querySelector("#" + id);
      return el ? el.value : "";
    };
    printOpts.pageSize = g("wsPrintPageSize") || printOpts.pageSize;
    printOpts.orientation = g("wsPrintOrientation") || printOpts.orientation;
    printOpts.dpi = g("wsPrintDpi") || printOpts.dpi;
    printOpts.pageMode = g("wsPrintPageMode") || printOpts.pageMode;
    printOpts.title = g("wsPrintTitle");
    printOpts.surveyor = g("wsPrintSurveyor");
    printOpts.company = g("wsPrintCompany");
    printOpts.drawingNo = g("wsPrintDrg");
    printOpts.scale = g("wsPrintScale") || "NTS";
  }

  function wirePrintToolbar(desk) {
    var bar = desk.querySelector("#wsPrintToolbar");
    if (!bar) return;
    bar.querySelectorAll("select, input").forEach(function (el) {
      el.addEventListener("change", function () {
        readPrintOptsFromDom(desk);
      });
      el.addEventListener("input", function () {
        readPrintOptsFromDom(desk);
      });
    });
    var preview = desk.querySelector("#wsPrintPreview");
    if (preview)
      preview.addEventListener("click", function () {
        readPrintOptsFromDom(desk);
        openPrintCad({ print: true });
      });
    var png = desk.querySelector("#wsPrintPng");
    if (png)
      png.addEventListener("click", function () {
        readPrintOptsFromDom(desk);
        openPrintCad({ print: true, exportKind: "png" });
      });
    var pdf = desk.querySelector("#wsPrintPdf");
    if (pdf)
      pdf.addEventListener("click", function () {
        readPrintOptsFromDom(desk);
        openPrintCad({ print: true, exportKind: "pdf" });
      });
    var close = desk.querySelector("#wsPrintClose");
    if (close)
      close.addEventListener("click", function () {
        printMode = false;
        App.refresh();
      });
  }

  function togglePrintMode() {
    printMode = !printMode;
    if (printMode) {
      var ws = WS.get();
      var survey = WS.effectiveSurvey(ws);
      if (survey) {
        if (!printOpts.title) printOpts.title = survey.title || "";
        if (!printOpts.surveyor) printOpts.surveyor = survey.linemanName || "";
      }
    }
    App.refresh();
  }

  function openPrintCad(opts) {
    opts = opts || {};
    var ws = WS.get();
    var survey = WS.effectiveSurvey(ws);
    if (!survey || !Array.isArray(survey.assets) || !survey.assets.length) {
      App.toast("Import a map first");
      return;
    }
    var payload = {
      survey: Object.assign({}, survey, {
        connections: Array.isArray(survey.connections) ? survey.connections : [],
        assets: survey.assets,
      }),
      settings: Object.assign({}, printOpts),
      exportKind: opts.exportKind || "",
    };
    try {
      sessionStorage.setItem("slm_job_print_map_v1", JSON.stringify(payload));
    } catch (err) {
      App.toast("Could not hand off map for print");
      return;
    }
    var q = "cad=1";
    if (opts.print) q += "&print=1";
    if (opts.exportKind) q += "&export=" + encodeURIComponent(opts.exportKind);
    window.open("../index.html?" + q, "_blank");
  }

  App.register("survey", {
    label: "Map",
    title: "Map & poles",
    hint: function (ws) {
      return ws.survey
        ? "Click a pole to verify / change · Save job file anytime"
        : "Import a field map to start";
    },
    badge: function (ws) {
      if (!ws.survey) return "";
      var n = (ws.survey.assets || []).filter(function (a) {
        return a.status === "Proposed";
      }).length;
      return n || "";
    },
    actions: function (ws) {
      var list = [
        { label: ws.survey ? "Replace map" : "Import map", kind: "primary", onClick: importSurveyFile },
      ];
      if (!ws.survey) list.push({ label: "Demo", kind: "quiet", onClick: loadDemoSurvey });
      if (ws.survey) {
        list.push({
          label: printMode ? "Hide print tools" : "Print layout",
          onClick: togglePrintMode,
        });
      }
      return list;
    },
    render: render,
  });

  global.SlmWsSurvey = {
    invalidate: invalidate,
    hits: hits,
    ensureCatalog: ensureCatalog,
    takeSessionHandoff: takeSessionHandoff,
    selectPole: selectPole,
  };
})(window);
