/**
 * Desktop port of NetworkCatalog.kt — allowed survey combinations only.
 * Voltage is locked from the field survey when editing a pole.
 */
(function (global) {
  "use strict";

  var LOCATIONS = ["Tangent", "Angular", "Dead-end", "T-Off"];
  var ARRANGEMENTS = ["In-line", "Sectional"];
  var EXTENSIONS = ["No ext", "With ext"];

  function normVoltage(v) {
    var s = String(v || "").trim();
    if (s === "33" || /^33/i.test(s)) return "33kV";
    if (s === "11" || /^11/i.test(s)) return "11kV";
    if (/^lt/i.test(s) || s === "LT") return "LT";
    return s || "11kV";
  }

  function normStructure(s) {
    var t = String(s || "").trim().toUpperCase();
    if (t === "DTR" || t === "DT") return "DTR";
    if (t === "1" || t === "P1" || t === "1P" || t === "1-PHASE") return "1P";
    if (t === "2" || t === "P2" || t === "2P" || t === "2-PHASE") return "2P";
    if (t === "3" || t === "P3" || t === "3P" || t === "3-PHASE") return "3P";
    if (t === "4" || t === "P4" || t === "4P") return "4P";
    return s || "";
  }

  function normLocation(s) {
    var t = String(s || "").trim().toLowerCase();
    if (!t) return "";
    if (t.indexOf("dead") === 0) return "Dead-end";
    if (t.indexOf("ang") === 0) return "Angular";
    if (t.indexOf("t") === 0 && t.indexOf("off") !== -1) return "T-Off";
    if (t.indexOf("tan") === 0) return "Tangent";
    return s;
  }

  function normArrangement(s) {
    var t = String(s || "").trim().toLowerCase();
    if (!t) return "";
    if (t.indexOf("section") === 0 || t === "sectional") return "Sectional";
    if (t.indexOf("in") === 0 || t === "inline" || t === "in-line") return "In-line";
    return s;
  }

  function normExtension(s) {
    var t = String(s || "").trim().toLowerCase();
    if (!t) return "";
    if (t.indexOf("with") === 0 || t === "withext" || t === "with-ext") return "With ext";
    if (t.indexOf("no") === 0) return "No ext";
    return s;
  }

  function isHt(v) {
    v = normVoltage(v);
    return v === "33kV" || v === "11kV";
  }

  function structuresFor(voltage) {
    voltage = normVoltage(voltage);
    if (voltage === "33kV") return ["1P", "2P", "3P", "4P"];
    if (voltage === "11kV") return ["1P", "2P", "3P", "4P", "DTR"];
    return ["1P", "2P", "3P"]; // LT phases
  }

  function allowsDeadEnd(voltage, structure) {
    structure = normStructure(structure);
    if (!structure) return true;
    voltage = normVoltage(voltage);
    if (voltage === "LT") return true;
    if (voltage === "33kV") return structure === "2P" || structure === "3P" || structure === "4P";
    if (voltage === "11kV")
      return structure === "2P" || structure === "3P" || structure === "4P" || structure === "DTR";
    return true;
  }

  function structuresForLocation(voltage, location) {
    var base = structuresFor(voltage);
    location = normLocation(location);
    if (location !== "Dead-end") return base;
    return base.filter(function (s) {
      return allowsDeadEnd(voltage, s);
    });
  }

  function conductorsFor(voltage) {
    voltage = normVoltage(voltage);
    if (voltage === "33kV") return ["100", "150", "200"];
    if (voltage === "11kV") return ["30", "50", "100", "ABC"];
    return ["30", "50", "ABC", "PVC"];
  }

  function ltPhasesForConductor(conductor) {
    var c = String(conductor || "").toUpperCase();
    if (c === "ABC") return ["1P", "2P", "3P"];
    if (c === "PVC") return ["1P", "3P"];
    return ["1P", "2P", "3P"];
  }

  function kitLocationsFor(voltage, structure) {
    if (allowsDeadEnd(voltage, structure)) return LOCATIONS.slice();
    return LOCATIONS.filter(function (l) {
      return l !== "Dead-end";
    });
  }

  function kitArrangementsFor(voltage, structure, location) {
    location = normLocation(location);
    structure = normStructure(structure);
    if (location === "Dead-end") return [];
    if (isHt(voltage) && structure && structure !== "1P") return ["Sectional"];
    return ARRANGEMENTS.slice();
  }

  function allowsPoleExtension(voltage, material) {
    if (normVoltage(voltage) === "LT") return false;
    var m = String(material || "").toUpperCase();
    return (
      m.indexOf("H") === 0 ||
      m.indexOf("RAIL") !== -1 ||
      m.indexOf("9") !== -1 ||
      m === "PCC-9M" ||
      m === "PCC_9M"
    );
  }

  function kitExtensionsFor(voltage, material) {
    return allowsPoleExtension(voltage, material) ? EXTENSIONS.slice() : ["No ext"];
  }

  /**
   * Cascading options for a draft. Voltage is fixed from survey.
   * draft: { structure, kitLocation, kitArrangement, kitExtension, conductor, poleMaterial }
   */
  function optionsFor(voltage, draft) {
    draft = draft || {};
    voltage = normVoltage(voltage);
    var location = normLocation(draft.kitLocation);
    var structure = normStructure(draft.structure);
    var conductor = draft.conductor || "";
    var material = draft.poleMaterial || draft.material || "";

    var structures =
      voltage === "LT" && conductor
        ? ltPhasesForConductor(conductor)
        : structuresForLocation(voltage, location || null);

    if (structure && structures.indexOf(structure) === -1) {
      structure = structures[0] || "";
    }

    var locations = kitLocationsFor(voltage, structure || structures[0]);
    if (location && locations.indexOf(location) === -1) {
      location = locations[0] || "";
    }

    var arrangements = kitArrangementsFor(voltage, structure, location);
    var arrangement = normArrangement(draft.kitArrangement);
    if (arrangements.length === 0) arrangement = "";
    else if (arrangement && arrangements.indexOf(arrangement) === -1) {
      arrangement = arrangements[0];
    } else if (!arrangement && arrangements.length === 1) {
      arrangement = arrangements[0];
    }

    var extensions = kitExtensionsFor(voltage, material);
    var extension = normExtension(draft.kitExtension);
    if (extension && extensions.indexOf(extension) === -1) {
      extension = extensions[0];
    } else if (!extension) {
      extension = extensions[0] || "No ext";
    }

    var conductors = conductorsFor(voltage);

    return {
      voltage: voltage,
      structures: structures,
      locations: locations,
      arrangements: arrangements,
      extensions: extensions,
      conductors: conductors,
      draft: {
        structure: structure,
        kitLocation: location,
        kitArrangement: arrangement,
        kitExtension: extension,
        conductor: conductor,
      },
    };
  }

  /** After a chip change, coerce draft into a legal combination. */
  function coerce(voltage, draft) {
    return optionsFor(voltage, draft).draft;
  }

  global.SlmNetworkCatalog = {
    normVoltage: normVoltage,
    normStructure: normStructure,
    structuresFor: structuresFor,
    conductorsFor: conductorsFor,
    kitLocationsFor: kitLocationsFor,
    kitArrangementsFor: kitArrangementsFor,
    kitExtensionsFor: kitExtensionsFor,
    optionsFor: optionsFor,
    coerce: coerce,
  };
})(window);
