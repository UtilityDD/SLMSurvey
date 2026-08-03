/**
 * Estimate — Actual | Contract BOQ for this workspace.
 */
(function (global) {
  "use strict";

  var App = global.SlmWsApp;
  var WS = global.SlmWorkspace;
  var Cat = global.SlmCatalog;
  var esc = App.escapeHtml;
  var lens = "actual"; // actual | contract
  var lastReport = null;

  function buildHits(ws) {
    var Match = global.SlmEstimateMatch;
    var survey = WS.effectiveSurvey(ws);
    var kits = ws.assemblies || [];

    // Concept / override counts win when set
    var counts = {};
    var hasConcept = false;
    kits.forEach(function (kit) {
      if (ws.counts[kit.id] != null && Number(ws.counts[kit.id]) > 0) {
        counts[kit.id] = Number(ws.counts[kit.id]);
        hasConcept = true;
      }
    });

    if (survey && Match.collectKitHits) {
      var fromSurvey = Match.collectKitHits(survey, kits);
      // Overlay concept counts on top of survey hits where set
      if (hasConcept) {
        var merged = Match.hitsFromCounts(kits, {}, {
          title: fromSurvey.title,
          surveyId: fromSurvey.surveyId,
          proposedPoles: fromSurvey.proposedPoles,
          readyPoles: fromSurvey.readyPoles,
          gaps: fromSurvey.gaps.slice(),
        });
        // start from survey, replace where concept set
        fromSurvey.structureQty.forEach(function (entry, id) {
          if (counts[id] == null) merged.structureQty.set(id, entry);
        });
        fromSurvey.conductorHits.forEach(function (entry) {
          if (counts[entry.kit.id] == null) {
            merged.conductorHits.push(entry);
            merged.matchedConductorKm += entry.km;
          }
        });
        Object.keys(counts).forEach(function (id) {
          var kit = kits.find(function (k) {
            return k.id === id;
          });
          if (!kit) return;
          var n = counts[id];
          if (kit.qtyBasis === "per_km" || kit.family === "conductor" || kit.family === "addon") {
            merged.conductorHits = merged.conductorHits.filter(function (h) {
              return h.kit.id !== id;
            });
            merged.conductorHits.push({ kit: kit, km: n });
          } else {
            merged.structureQty.set(id, { kit: kit, n: n });
          }
        });
        var structures = 0;
        var km = 0;
        merged.structureQty.forEach(function (e) {
          structures += e.n;
        });
        merged.conductorHits.forEach(function (e) {
          km += e.km;
        });
        merged.matchedStructures = structures;
        merged.matchedConductorKm = km;
        return merged;
      }
      return fromSurvey;
    }

    if (!hasConcept) return null;
    return Match.hitsFromCounts(kits, counts, {
      title: ws.name || "Concept quantities",
    });
  }

  function buildReport(ws) {
    var Match = global.SlmEstimateMatch;
    var hits = buildHits(ws);
    if (!hits) return null;

    if (lens === "contract") {
      if (!(ws.contract.items || []).length) {
        return { error: "Upload a contract schedule first (Contract section)." };
      }
      var book = WS.scheduleBook(ws);
      var bridge = WS.bridge(ws);
      return Match.buildContractReportFromHits(hits, book, bridge, ws.extras);
    }

    var ratebook = WS.ratebook(ws);
    if (
      !(ratebook.materials || []).length &&
      !(ratebook.labour || []).length &&
      Cat.isLoaded()
    ) {
      // Fall back to bundled rates so Actual BOQ still works out of the box
      ratebook = Cat.bundledRatebook();
    }
    return Match.buildReportFromHits(hits, ratebook, ws.extras);
  }

  function exportText() {
    if (!lastReport || lastReport.error) return App.toast("Generate an estimate first");
    var text = global.SlmEstimateMatch.reportAsText(lastReport);
    App.downloadText(
      (WS.get().name || "estimate").replace(/\s+/g, "-") +
        "-" +
        lens +
        ".txt",
      text
    );
  }

  async function copyText() {
    if (!lastReport || lastReport.error) return App.toast("Generate an estimate first");
    var text = global.SlmEstimateMatch.reportAsText(lastReport);
    try {
      await navigator.clipboard.writeText(text);
      App.toast("Copied to clipboard");
    } catch (err) {
      App.toast("Copy failed");
    }
  }

  function renderScheduleTable(title, rows, total) {
    if (!(rows || []).length) {
      return (
        '<div class="ws-card"><div class="ws-card-head"><div><h2>' +
        esc(title) +
        '</h2><p>No rows</p></div></div></div>'
      );
    }
    return (
      '<div class="ws-card"><div class="ws-card-head"><div><h2>' +
      esc(title) +
      "</h2><p>" +
      rows.length +
      " lines</p></div></div>" +
      '<div class="ws-scroll-y"><table class="ws-table"><thead><tr>' +
      "<th>Sl</th><th>Description</th><th>Code</th><th>Unit</th>" +
      '<th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th>' +
      "</tr></thead><tbody>" +
      rows
        .map(function (r) {
          return (
            "<tr><td>" +
            esc(String(r.sl)) +
            "</td><td>" +
            esc(r.description || "") +
            "</td><td>" +
            esc(r.code || "") +
            "</td><td>" +
            esc(r.unit || "") +
            '</td><td class="num">' +
            App.qty(r.qty) +
            '</td><td class="num">₹' +
            App.money(r.rate) +
            '</td><td class="num">₹' +
            App.money(r.amount) +
            "</td></tr>"
          );
        })
        .join("") +
      '</tbody><tfoot><tr><td colspan="6">Total</td><td class="num">₹' +
      App.money(total) +
      "</td></tr></tfoot></table></div></div>"
    );
  }

  function render(host, ws) {
    if (!Cat.isLoaded()) {
      Cat.load()
        .then(function () {
          App.refresh();
        })
        .catch(function () {});
    }

    var stack = document.createElement("div");
    stack.className = "ws-stack";

    if (!(ws.assemblies || []).length) {
      stack.innerHTML =
        '<div class="ws-blank"><h3>Nothing to estimate yet</h3>' +
        "<p>Add a few assemblies from Survey suggestions or Assemblies search, then come back.</p>" +
        '<div class="ws-blank-actions"><button type="button" class="ws-btn ws-btn-primary" id="eGo">Go to Survey</button></div></div>';
      host.appendChild(stack);
      stack.querySelector("#eGo").addEventListener("click", function () {
        App.go("survey");
      });
      return;
    }

    var report = buildReport(ws);
    lastReport = report;

    stack.innerHTML =
      '<div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between">' +
      '<div class="ws-toggle" id="eLens">' +
      '<button type="button" data-lens="actual"' +
      (lens === "actual" ? ' class="is-active"' : "") +
      ">Actual</button>" +
      '<button type="button" data-lens="contract"' +
      (lens === "contract" ? ' class="is-active"' : "") +
      ">Contract</button></div>" +
      '<div class="ws-note">' +
      (lens === "actual"
        ? "Physical materials & labour from assembly recipes"
        : "Turnkey SoR lines via Bills as") +
      "</div></div>";

    if (report && report.error) {
      stack.innerHTML +=
        '<div class="ws-blank"><h3>Contract lens needs a schedule</h3><p>' +
        esc(report.error) +
        '</p><div class="ws-blank-actions"><button type="button" class="ws-btn ws-btn-primary" id="eCtr">Open Contract</button></div></div>';
      host.appendChild(stack);
      stack.querySelector("#eLens").querySelectorAll("button").forEach(wireLens);
      stack.querySelector("#eCtr").addEventListener("click", function () {
        App.go("contract");
      });
      return;
    }

    if (!report) {
      stack.innerHTML +=
        '<div class="ws-blank"><h3>No quantities yet</h3>' +
        "<p>Import a survey, or set concept quantities on Assemblies.</p></div>";
      host.appendChild(stack);
      stack.querySelector("#eLens").querySelectorAll("button").forEach(wireLens);
      return;
    }

    stack.innerHTML +=
      '<div class="ws-metrics">' +
      metric("Poles / ready", report.proposedPoles + " / " + report.readyPoles) +
      metric("Matched", report.matchedStructures) +
      metric("Conductor km", (report.matchedConductorKm || 0).toFixed(3)) +
      metric(
        "Grand total",
        "₹" +
          App.money(
            (report.abstract && report.abstract.grandTotalRounded) ||
              report.totalAmount ||
              0
          )
      ) +
      "</div>" +
      renderScheduleTable(
        "Schedule of materials",
        report.materialSchedule,
        report.materialTotal
      ) +
      renderScheduleTable(
        "Schedule of labour",
        report.labourSchedule,
        report.labourTotal
      ) +
      abstractCard(report) +
      gapsCard(report.gaps);

    host.appendChild(stack);
    stack.querySelector("#eLens").querySelectorAll("button").forEach(wireLens);
  }

  function wireLens(btn) {
    btn.addEventListener("click", function () {
      lens = btn.getAttribute("data-lens");
      App.refresh();
    });
  }

  function metric(label, value) {
    return (
      '<div class="ws-metric"><div class="ws-metric-label">' +
      esc(label) +
      '</div><div class="ws-metric-value">' +
      esc(String(value)) +
      "</div></div>"
    );
  }

  function abstractCard(report) {
    var abs = report.abstract || {};
    var steps = abs.steps || [];
    if (!steps.length) return "";
    return (
      '<div class="ws-card"><div class="ws-card-head"><div><h2>Abstract</h2>' +
      (abs.amountInWords
        ? "<p>" + esc(abs.amountInWords) + "</p>"
        : "") +
      "</div></div>" +
      '<div class="ws-rows">' +
      steps
        .map(function (s) {
          return (
            '<div class="ws-row"><div class="ws-row-main"><div class="ws-row-title">' +
            esc(s.label) +
            '</div></div><div class="ws-row-num">₹' +
            App.money(s.amount) +
            "</div></div>"
          );
        })
        .join("") +
      '<div class="ws-row"><div class="ws-row-main"><div class="ws-row-title"><strong>Grand total (say)</strong></div></div>' +
      '<div class="ws-row-num"><strong>₹' +
      App.money(abs.grandTotalRounded ?? abs.grandTotal) +
      "</strong></div></div></div></div>"
    );
  }

  function gapsCard(gaps) {
    if (!(gaps || []).length) return "";
    return (
      '<div class="ws-card"><div class="ws-card-head"><div><h2>Gaps</h2><p>' +
      gaps.length +
      ' item(s)</p></div></div><div class="ws-rows">' +
      gaps
        .map(function (g) {
          return (
            '<div class="ws-row"><div class="ws-row-main"><div class="ws-row-title">' +
            esc(g.title) +
            "</div>" +
            (g.detail ? '<div class="ws-row-sub">' + esc(g.detail) + "</div>" : "") +
            "</div></div>"
          );
        })
        .join("") +
      "</div></div>"
    );
  }

  App.register("estimate", {
    label: "Estimate",
    title: "Estimate",
    hint: "Actual BOQ or Contract BOQ",
    badge: function (ws) {
      return (ws.assemblies || []).length || "";
    },
    actions: function () {
      return [
        { label: "Export text", kind: "primary", onClick: exportText },
        { label: "Copy", onClick: copyText },
      ];
    },
    render: render,
  });
})(window);
