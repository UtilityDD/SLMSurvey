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

  function materialsFor(voltage) {
    voltage = normVoltage(voltage);
    if (voltage === "33kV") {
      // No 8m PCC on 33kV
      return ["9m PCC", "Rail", "H-Pole"];
    }
    if (voltage === "11kV") {
      return [
        "8m PCC",
        "9m PCC",
        "Rail",
        "H-Pole",
        "Steel pole 9m",
        "Steel pole 11m",
      ];
    }
    return ["8m PCC"]; // LT
  }

  function rulesPack() {
    return global.SlmSurveyRules || null;
  }

  function rulesVoltage(voltage) {
    var pack = rulesPack();
    if (!pack || !pack.byVoltage) return null;
    return pack.byVoltage[normVoltage(voltage)] || null;
  }

  function structuresFor(voltage) {
    voltage = normVoltage(voltage);
    var rv = rulesVoltage(voltage);
    if (rv && Array.isArray(rv.structures) && rv.structures.length) {
      return rv.structures.slice();
    }
    if (voltage === "33kV") return ["1P", "2P", "3P", "4P"];
    if (voltage === "11kV") return ["1P", "2P", "3P", "4P", "DTR"];
    return ["1P", "2P", "3P"]; // LT phases
  }

  function allowsDeadEnd(voltage, structure) {
    structure = normStructure(structure);
    if (!structure) return true;
    voltage = normVoltage(voltage);
    var rv = rulesVoltage(voltage);
    if (rv && Array.isArray(rv.deadEndStructures)) {
      return rv.deadEndStructures.indexOf(structure) >= 0;
    }
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
    var rv = rulesVoltage(voltage);
    if (rv && Array.isArray(rv.conductors) && rv.conductors.length) {
      return rv.conductors.slice();
    }
    if (voltage === "33kV") return ["100", "150", "200"];
    if (voltage === "11kV") return ["30", "50", "100", "ABC"];
    return ["30", "50", "ABC", "PVC"];
  }

  /**
   * Field pole types (survey Mat). Prefer survey-rules.json when loaded.
   * Desktop includes phone:false options (e.g. Steel pole 9m / 11m).
   */
  function materialsFor(voltage) {
    voltage = normVoltage(voltage);
    var rv = rulesVoltage(voltage);
    if (rv && Array.isArray(rv.materials) && rv.materials.length) {
      return rv.materials.map(function (m) {
        if (typeof m === "string") return { id: m, label: m };
        return { id: m.id || m.label, label: m.label || m.id };
      });
    }
    if (voltage === "33kV") {
      return [
        { id: "9m PCC", label: "9m PCC" },
        { id: "Rail", label: "Rail" },
        { id: "H-Pole", label: "H-Pole" },
      ];
    }
    if (voltage === "11kV") {
      return [
        { id: "8m PCC", label: "8m PCC" },
        { id: "9m PCC", label: "9m PCC" },
        { id: "Rail", label: "Rail" },
        { id: "H-Pole", label: "H-Pole" },
        { id: "Steel pole 9m", label: "Steel pole 9m" },
        { id: "Steel pole 11m", label: "Steel pole 11m" },
      ];
    }
    return [{ id: "8m PCC", label: "8m PCC" }];
  }

  function materialIdsFor(voltage) {
    return materialsFor(voltage).map(function (m) {
      return m.id;
    });
  }

  function normMaterial(s, voltage) {
    var t = String(s || "").trim();
    if (!t) return "";
    var allowed = materialIdsFor(voltage);
    if (allowed.indexOf(t) !== -1) return t;
    var lower = t.toLowerCase();
    if (lower.indexOf("8") !== -1 && lower.indexOf("pcc") !== -1) return "8m PCC";
    if (lower.indexOf("9") !== -1 && lower.indexOf("pcc") !== -1) return "9m PCC";
    if (lower.indexOf("rail") !== -1) return "Rail";
    if (lower.indexOf("steel") !== -1 && lower.indexOf("11") !== -1) {
      return "Steel pole 11m";
    }
    if (
      lower.indexOf("steel") !== -1 ||
      lower.indexOf("tubular") !== -1 ||
      lower.indexOf("9.5") !== -1
    ) {
      if (lower.indexOf("11") !== -1) return "Steel pole 11m";
      if (normVoltage(voltage) === "11kV") return "Steel pole 9m";
      return "H-Pole";
    }
    if (lower.indexOf("h") === 0 || lower.indexOf("h-pole") !== -1) return "H-Pole";
    if (lower === "pcc-8m" || lower === "pcc_8m") return "8m PCC";
    if (lower === "pcc-9m" || lower === "pcc_9m") return "9m PCC";
    return allowed[0] || t;
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
    voltage = normVoltage(voltage);
    var pack = rulesPack();
    var mat = String(material || "").trim();
    if (pack && pack.rules && pack.rules.extensionAllowedMaterials) {
      var allowed = pack.rules.extensionAllowedMaterials[voltage] || [];
      if (!mat) return allowed.length > 0;
      return allowed.indexOf(mat) >= 0;
    }
    if (voltage === "LT") return false;
    var m = String(material || "").toUpperCase();
    if (!m) return true;
    if (m.indexOf("8") !== -1 && m.indexOf("PCC") !== -1) return false;
    return (
      m.indexOf("H") === 0 ||
      m.indexOf("RAIL") !== -1 ||
      m.indexOf("STEEL") !== -1 ||
      m.indexOf("TUBULAR") !== -1 ||
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
    var materials = materialsFor(voltage);
    var material = normMaterial(draft.poleMaterial || draft.material || "", voltage);
    if (!material && materials.length) material = materials[0].id;

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
      materials: materials,
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
        poleMaterial: material,
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
    materialsFor: materialsFor,
    kitLocationsFor: kitLocationsFor,
    kitArrangementsFor: kitArrangementsFor,
    kitExtensionsFor: kitExtensionsFor,
    optionsFor: optionsFor,
    coerce: coerce,
    /** Load shared survey-rules.json (desktop). Safe to call multiple times. */
    loadRules: function (url) {
      var href = url || "../estimate/survey-rules.json";
      return fetch(href, { cache: "no-store" })
        .then(function (r) {
          if (!r.ok) throw new Error("rules " + r.status);
          return r.json();
        })
        .then(function (data) {
          global.SlmSurveyRules = data;
          return data;
        });
    },
    setRules: function (data) {
      global.SlmSurveyRules = data || null;
    },
  };

  // Best-effort auto-load when served over HTTP.
  if (typeof fetch === "function") {
    global.SlmNetworkCatalog.loadRules().catch(function () {
      /* bundled fallbacks in materialsFor / structuresFor */
    });
  }
})(window);
