/**
 * Phone survey rules — read-only view of survey-rules.json (publish via Estimate).
 */
(function (global) {
  "use strict";

  var Desk = global.SlmDesk;
  var esc = function (s) {
    return Desk.escapeHtml(s);
  };

  var RULES_URL = "../estimate/survey-rules.json";
  var state = { rules: null, err: "" };

  function loadRules() {
    if (state.rules) return Promise.resolve(state.rules);
    return fetch(RULES_URL, { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (data) {
        state.rules = data;
        state.err = "";
        if (global.SlmNetworkCatalog && global.SlmNetworkCatalog.setRules) {
          global.SlmNetworkCatalog.setRules(data);
        }
        return data;
      });
  }

  function matLabel(m) {
    if (typeof m === "string") return m;
    var id = m.id || m.label || "";
    var phone = m.phone !== false;
    return id + (phone ? "" : " (desk only)");
  }

  function voltageCard(v, block) {
    if (!block) return "";
    var mats = (block.materials || []).map(matLabel).join(", ") || "—";
    var phoneSt =
      (block.structuresPhone || block.structures || []).join(", ") || "—";
    var kitExtra = (block.kitStructuresExtra || []).join(", ");
    var cond = (block.conductors || []).join(", ") || "—";
    var dead = (block.deadEndStructures || []).join(", ") || "—";
    return (
      '<section class="dk-rules-card">' +
      "<h2>" +
      esc(v) +
      "</h2>" +
      "<dl>" +
      "<dt>Materials</dt><dd>" +
      esc(mats) +
      "</dd>" +
      "<dt>Phone structures</dt><dd>" +
      esc(phoneSt) +
      (kitExtra
        ? ' <span class="dk-rules-extra">+ kit-only: ' +
          esc(kitExtra) +
          "</span>"
        : "") +
      "</dd>" +
      "<dt>Conductors</dt><dd>" +
      esc(cond) +
      "</dd>" +
      "<dt>Dead-end structures</dt><dd>" +
      esc(dead) +
      "</dd>" +
      "</dl></section>"
    );
  }

  function paint(page) {
    var r = state.rules;
    if (!r) {
      page.innerHTML =
        '<div class="dk-blank"><h2>No rules loaded</h2><p>' +
        esc(state.err || "Missing survey-rules.json") +
        "</p></div>";
      return;
    }
    var volts = r.voltages || Object.keys(r.byVoltage || {});
    var cards = volts
      .map(function (v) {
        return voltageCard(v, (r.byVoltage || {})[v]);
      })
      .join("");

    page.innerHTML =
      '<div class="dk-page-pad">' +
      '<div class="dk-page-head"><h1>Phone rules</h1><p>' +
      esc(r.label || "survey-rules") +
      (r.version != null ? " · v" + esc(String(r.version)) : "") +
      " — chips on Map and phone wizard. Kits stay on Structures / Estimate.</p></div>" +
      '<div class="dk-rules-actions">' +
      '<a class="dk-btn dk-btn-primary" href="../estimate/" target="_blank" rel="noopener">Open Estimate → Publish to app</a>' +
      '<a class="dk-btn dk-btn-ghost" href="../estimate/survey-rules.json" target="_blank" rel="noopener">Raw JSON</a>' +
      "</div>" +
      '<div class="dk-rules-grid">' +
      cards +
      "</div>" +
      '<p class="dk-rules-note">' +
      esc(
        r.notes ||
          "Edit estimate/survey-rules.json, then Publish to app so phones sync."
      ) +
      "</p></div>";
  }

  function render(host) {
    var page =
      host && host.classList && host.classList.contains("dk-page")
        ? host
        : (function () {
            var el = document.createElement("div");
            el.className = "dk-page";
            host.appendChild(el);
            return el;
          })();
    page.innerHTML = '<div class="dk-blank"><h2>Loading phone rules…</h2></div>';
    loadRules()
      .then(function () {
        paint(page);
      })
      .catch(function (e) {
        state.err = String((e && e.message) || e);
        paint(page);
      });
  }

  /** Mounted as Rates desk tab via rates.js */
  global.SlmDeskRules = {
    render: render,
    reload: function () {
      state.rules = null;
    },
  };
})(window);
