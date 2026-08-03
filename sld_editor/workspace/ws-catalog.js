/**
 * Shared catalog for Workspace — loads estimate/kit-matrix.json (+ ratebook).
 * Exposes window.SlmCatalog used by survey / assemblies / contract / estimate views.
 */
(function (global) {
  "use strict";

  var MATRIX_URL = "../estimate/kit-matrix.json";
  var RATEBOOK_URL = "../estimate/ratebook.json";

  var matrix = null;
  var ratebook = null;
  var byId = Object.create(null);
  var rateByCode = Object.create(null);
  var loadPromise = null;

  function isLoaded() {
    return !!matrix;
  }

  function allKits() {
    if (!matrix) return [];
    return []
      .concat(matrix.structureKits || [])
      .concat(matrix.conductorKits || [])
      .concat(matrix.addonKits || []);
  }

  function indexMatrix() {
    byId = Object.create(null);
    allKits().forEach(function (k) {
      if (k && k.id) byId[k.id] = k;
    });
  }

  function indexRates() {
    rateByCode = Object.create(null);
    if (!ratebook) return;
    []
      .concat(ratebook.materials || [])
      .concat(ratebook.labour || [])
      .forEach(function (r) {
        if (r && r.code) rateByCode[r.code] = r;
      });
  }

  function load() {
    if (matrix) return Promise.resolve(matrix);
    if (loadPromise) return loadPromise;
    loadPromise = Promise.all([
      fetch(MATRIX_URL).then(function (r) {
        if (!r.ok) throw new Error("kit-matrix HTTP " + r.status);
        return r.json();
      }),
      fetch(RATEBOOK_URL)
        .then(function (r) {
          return r.ok ? r.json() : null;
        })
        .catch(function () {
          return null;
        }),
    ]).then(function (pair) {
      matrix = pair[0];
      ratebook = pair[1];
      indexMatrix();
      indexRates();
      return matrix;
    });
    return loadPromise;
  }

  function getById(id) {
    if (!id) return null;
    return byId[id] || null;
  }

  function all() {
    return allKits();
  }

  function arrLabel(a) {
    if (!a) return "";
    if (a === "InlineArr") return "In-line";
    if (a === "Sectional") return "Sectional";
    return String(a);
  }

  function title(kit) {
    if (!kit) return "—";
    if (kit.custom) return kit.customLabel || kit.label || kit.id || "Custom";
    if (kit.family === "conductor") {
      return (
        (kit.voltage || "") +
        " · " +
        (kit.conductorShort || kit.conductorFamily || kit.id || "Conductor")
      );
    }
    if (kit.family === "addon") {
      return (kit.voltage || "") + " · " + (kit.label || kit.addonType || kit.id);
    }
    var type = kit.structureLabel || kit.structure || "Structure";
    var loc = kit.location ? " · " + kit.location : "";
    return (kit.voltage || "") + " · " + type + loc;
  }

  function subtitle(kit) {
    if (!kit) return "";
    if (kit.family === "conductor") {
      return [kit.wireCount, kit.qtyBasis].filter(Boolean).join(" · ");
    }
    var bits = [];
    if (kit.arrangement) bits.push(arrLabel(kit.arrangement));
    if (kit.conductorShort || kit.conductorFamily)
      bits.push(kit.conductorShort || kit.conductorFamily);
    if (kit.extension && kit.extension !== "NoExt") bits.push(kit.extension);
    if (kit.code) bits.push(kit.code);
    return bits.join(" · ");
  }

  function search(q, opts) {
    opts = opts || {};
    var limit = opts.limit || 40;
    var withLinesOnly = !!opts.withLinesOnly;
    var needle = String(q || "")
      .trim()
      .toLowerCase();
    var out = [];
    var kits = allKits();
    for (var i = 0; i < kits.length && out.length < limit; i += 1) {
      var k = kits[i];
      if (withLinesOnly && !(k.lines || []).length) continue;
      if (k.enabled === false) continue;
      if (!needle) {
        out.push(k);
        continue;
      }
      var hay = [
        k.id,
        k.code,
        k.voltage,
        k.structure,
        k.structureLabel,
        k.location,
        k.arrangement,
        k.conductorFamily,
        k.conductorShort,
        k.label,
        k.addonType,
      ]
        .join(" ")
        .toLowerCase();
      if (hay.indexOf(needle) !== -1) out.push(k);
    }
    return out;
  }

  function searchRates(q, opts) {
    opts = opts || {};
    var limit = opts.limit || 40;
    var needle = String(q || "")
      .trim()
      .toLowerCase();
    var rows = []
      .concat((ratebook && ratebook.materials) || [])
      .concat((ratebook && ratebook.labour) || []);
    if (!needle) return rows.slice(0, limit);
    return rows
      .filter(function (r) {
        var hay = [r.code, r.description, r.type, r.unit].join(" ").toLowerCase();
        return hay.indexOf(needle) !== -1;
      })
      .slice(0, limit);
  }

  function bundledRatebook() {
    return (
      ratebook || {
        materials: [],
        labour: [],
      }
    );
  }

  function rateFor(code) {
    if (!code) return null;
    return rateByCode[code] || null;
  }

  function matchKey(kit) {
    if (!kit) return "";
    return kit.id || kit.code || "";
  }

  function captureFromKit(kit) {
    if (!kit) return null;
    return {
      voltage: kit.voltage || "11kV",
      status: "Proposed",
      structure: kit.structure || kit.structureLabel || null,
      conductor: kit.conductorShort || kit.conductorId || kit.conductorFamily || "",
      kitLocation: kit.location || null,
      kitArrangement: kit.arrangement || null,
      kitExtension: kit.extension || null,
      kitWire: kit.wireCount || kit.wireLabel || null,
      dtrMount: kit.dtrMount || null,
      dtCapacityKva: kit.dtCapacityKva || null,
    };
  }

  global.SlmCatalog = {
    isLoaded: isLoaded,
    load: load,
    all: all,
    getById: getById,
    title: title,
    subtitle: subtitle,
    search: search,
    searchRates: searchRates,
    bundledRatebook: bundledRatebook,
    rateFor: rateFor,
    matchKey: matchKey,
    captureFromKit: captureFromKit,
  };
})(window);
