/**
 * Fixed-sequence kit display names.
 *
 * Structure example: 11kV-1P-9M-Tan-Sec-NoExt-DOG
 * Sequence: Voltage-Type-Pole-Loc-Arr-Ext-Cond[-Wire][-kVA]
 *
 * HT (11/33) never shows wire count — always 3-wire / cable.
 */
(function (global) {
  "use strict";

  var LOC = {
    Tangent: "Tan",
    Angular: "Ang",
    "Dead-end": "DE",
    "T-Off": "TOff",
    Tap: "Tap",
  };

  var ARR = {
    InlineArr: "Inl",
    Sectional: "Sec",
    "In-line": "Inl",
    "In-line arr.": "Inl",
  };

  var COND = [
    ["SQUIRREL", "SQR"],
    ["WEASEL", "WEA"],
    ["RABBIT", "RAB"],
    ["DOG", "DOG"],
    ["WOLF", "WLF"],
    ["PANTHER", "PTH"],
    ["ABC", "ABC"],
    ["PVC", "PVC"],
  ];

  /** Field pole type / token → short name token. */
  var POLE_ABBR = {
    "8m PCC": "8M",
    "9m PCC": "9M",
    Rail: "RL",
    "H-Pole": "HP",
    "Steel pole 9m": "S9",
    "Steel pole 11m": "S11",
    "8M": "8M",
    "9M": "9M",
    RL: "RL",
    HP: "HP",
    WF: "HP",
    T9: "S9",
    T95: "S9",
    T11: "S11",
    S9: "S9",
    S11: "S11",
  };

  function voltagePart(kit) {
    var v = String((kit && kit.voltage) || "").trim();
    if (/^33/i.test(v)) return "33kV";
    if (/^11/i.test(v)) return "11kV";
    if (/^LT$/i.test(v)) return "LT";
    return v || "—";
  }

  function typePart(kit) {
    var st = String((kit && kit.structure) || "").trim();
    if (!st && kit && kit.structureLabel) {
      st = String(kit.structureLabel).replace(/\s+/g, "");
    }
    if (/^DTR/i.test(st)) {
      var mount =
        (kit && kit.dtrMount) ||
        st.replace(/^DTR/i, "").replace(/on/i, "") ||
        "2P";
      mount = String(mount).toUpperCase();
      if (mount.indexOf("4") >= 0) return "DTR4P";
      return "DTR2P";
    }
    return st || "1P";
  }

  function polePart(kit) {
    if (!kit) return null;
    var raw =
      kit._poleMaterial ||
      kit.poleMaterial ||
      kit.material ||
      kit.poleLabel ||
      kit._poleToken ||
      kit.activePoleToken ||
      kit.poleToken ||
      "";
    raw = String(raw).trim();
    if (!raw) return null;

    if (POLE_ABBR[raw]) return POLE_ABBR[raw];

    var upper = raw.toUpperCase();
    if (POLE_ABBR[upper]) return POLE_ABBR[upper];

    var lower = raw.toLowerCase();
    if (lower.indexOf("8") !== -1 && lower.indexOf("pcc") !== -1) return "8M";
    if (lower.indexOf("9") !== -1 && lower.indexOf("pcc") !== -1) return "9M";
    if (lower.indexOf("rail") !== -1) return "RL";
    if (lower.indexOf("steel") !== -1 && lower.indexOf("11") !== -1) return "S11";
    if (lower.indexOf("steel") !== -1 && lower.indexOf("9") !== -1) return "S9";
    if (lower.indexOf("tubular") !== -1 && lower.indexOf("11") !== -1) return "S11";
    if (lower.indexOf("tubular") !== -1) return "S9";
    if (lower.indexOf("wide") !== -1 || lower.indexOf("h-pole") !== -1 || lower === "h-pole") {
      return "HP";
    }
    if (lower.indexOf("h") === 0 && lower.indexOf("pole") !== -1) return "HP";

    // 33kV steel tokens collapse to H-Pole abbreviation
    if (voltagePart(kit) === "33kV" && (upper === "T9" || upper === "T95" || upper === "T11")) {
      return "HP";
    }
    return upper.slice(0, 4);
  }

  function locPart(kit) {
    var loc =
      (kit &&
        (kit.location ||
          kit.kitLocation ||
          kit.position ||
          kit.locationLabel ||
          kit.positionLabel)) ||
      "";
    loc = String(loc).trim();
    if (LOC[loc]) return LOC[loc];
    var lower = loc.toLowerCase();
    if (lower.indexOf("tangent") >= 0) return "Tan";
    if (lower.indexOf("angular") >= 0) return "Ang";
    if (lower.indexOf("dead") >= 0) return "DE";
    if (lower.indexOf("t-off") >= 0 || lower.indexOf("toff") >= 0) return "TOff";
    if (lower.indexOf("tap") >= 0) return "Tap";
    return loc ? loc.slice(0, 4) : "—";
  }

  function arrPart(kit) {
    var a =
      (kit &&
        (kit.arrangement ||
          kit.kitArrangement ||
          kit.arrangementLabel)) ||
      "";
    a = String(a).trim();
    if (!a) return null;
    if (ARR[a]) return ARR[a];
    if (/section/i.test(a)) return "Sec";
    if (/inline|in-line|in line/i.test(a)) return "Inl";
    return null;
  }

  function extPart(kit) {
    if (!kit) return "NoExt";
    if (
      kit.hasExtension === true ||
      kit.extension === "WithExt" ||
      kit.kitExtension === "WithExt"
    ) {
      return "WithExt";
    }
    if (
      kit.extension === "NoExt" ||
      kit.kitExtension === "NoExt" ||
      kit.hasExtension === false
    ) {
      return "NoExt";
    }
    if (/with/i.test(String(kit.extensionLabel || kit.kitExtension || ""))) {
      return "WithExt";
    }
    return "NoExt";
  }

  function condPart(kit) {
    if (!kit) return "—";
    if (kit.conductorSizeAgnostic) {
      var fam = String(kit.conductorFamily || "").toUpperCase();
      if (fam === "ABC") return "ABC";
      if (fam === "PVC") return "PVC";
      return "ACSR";
    }
    var blob = (
      String(kit.conductorId || "") +
      "|" +
      String(kit.conductorShort || "") +
      "|" +
      String(kit.conductorName || "") +
      "|" +
      String(kit.conductor || "")
    ).toUpperCase();
    for (var i = 0; i < COND.length; i++) {
      if (blob.indexOf(COND[i][0]) >= 0) return COND[i][1];
    }
    var short = String(kit.conductorShort || kit.conductor || "").trim();
    if (short) {
      var animal = short.replace(/\s+\d+.*$/, "").trim();
      if (animal) return animal.toUpperCase().slice(0, 4);
    }
    fam = String(kit.conductorFamily || "").toUpperCase();
    return fam ? fam.slice(0, 4) : "—";
  }

  function wirePart(kit) {
    var v = voltagePart(kit);
    // 11kV / 33kV ACSR is always 3-wire — omit from the name.
    if (v === "11kV" || v === "33kV") return null;
    var fam = String((kit && kit.conductorFamily) || "");
    if (fam === "ABC" || fam === "PVC" || (kit && kit.wireLabel) === "cable") {
      return "CAB";
    }
    var wc = kit && kit.wireCount;
    if (wc === "2W" || wc === "3W" || wc === "4W") return wc;
    var wl = String((kit && kit.wireLabel) || "");
    if (/2/.test(wl)) return "2W";
    if (/4/.test(wl)) return "4W";
    if (/3/.test(wl)) return "3W";
    return null;
  }

  function dtrPart(kit) {
    var raw =
      (kit && (kit.dtrCapacity || kit.dtrCapacityLabel)) || "";
    raw = String(raw).trim();
    if (!raw) return null;
    var digits = raw.replace(/\D/g, "");
    return digits ? digits + "kVA" : raw.replace(/\s+/g, "");
  }

  /** Fixed-sequence display name for structure kits. */
  function structureDisplayName(kit) {
    var parts = [voltagePart(kit), typePart(kit)];
    var pole = polePart(kit);
    if (pole) parts.push(pole);
    parts.push(locPart(kit));
    var arr = arrPart(kit);
    if (arr) parts.push(arr);
    parts.push(extPart(kit));
    parts.push(condPart(kit));
    var wire = wirePart(kit);
    if (wire) parts.push(wire);
    var dtr = dtrPart(kit);
    if (dtr) parts.push(dtr);
    return parts.join("-");
  }

  function conductorDisplayName(kit) {
    var bits = [voltagePart(kit), condPart(kit)];
    var wire = wirePart(kit);
    if (wire) bits.push(wire);
    var name = (kit && (kit.conductorShort || kit.conductorName)) || "";
    if (name && bits.indexOf(String(name)) < 0 && condPart(kit) === "—") {
      bits[1] = String(name).replace(/\s+/g, "");
    }
    return bits.filter(Boolean).join("-");
  }

  function addonDisplayName(kit) {
    var label = (kit && (kit.label || kit.addonType || kit.id)) || "Add-on";
    return [voltagePart(kit), String(label).replace(/\s+/g, "")].join("-");
  }

  function displayName(kit) {
    if (!kit) return "—";
    if (kit.custom) {
      var custom =
        kit.customLabel || kit.label || kit.id || "Custom";
      return [voltagePart(kit), String(custom).replace(/\s+/g, ""), "Custom"].join(
        "-"
      );
    }
    var fam = String(kit.family || "structure").toLowerCase();
    if (fam === "conductor") return conductorDisplayName(kit);
    if (fam === "addon") return addonDisplayName(kit);
    return structureDisplayName(kit);
  }

  /** Segments for the naming guide UI. */
  var GUIDE = [
    {
      token: "Voltage",
      meaning: "11kV · 33kV · LT",
    },
    {
      token: "Type",
      meaning: "1P · 2P · 3P · 4P · DTR2P · DTR4P",
    },
    {
      token: "Pole",
      meaning: "8M · 9M · RL · HP · S9 · S11 (after type)",
    },
    {
      token: "Loc",
      meaning: "Tan (tangent) · Ang · DE (dead-end) · TOff",
    },
    {
      token: "Arr",
      meaning: "Inl (in-line) · Sec (sectional) — omitted on dead-end",
    },
    {
      token: "Ext",
      meaning: "NoExt · WithExt",
    },
    {
      token: "Cond",
      meaning: "DOG · WEA · RAB · WLF · PTH · ACSR · ABC · PVC",
    },
    {
      token: "Wire",
      meaning: "LT only (2W · 3W · 4W · CAB). HT is always 3-wire — not shown.",
    },
    {
      token: "kVA",
      meaning: "DTR capacity when present (e.g. 16kVA)",
    },
  ];

  function guideExample() {
    return "11kV-1P-9M-Tan-Sec-NoExt-DOG";
  }

  global.SlmKitName = {
    displayName: displayName,
    structureDisplayName: structureDisplayName,
    poleAbbr: polePart,
    /** Name from a matched kit, or from pole chips when no kit yet. */
    forPole: function (pole, kit) {
      var base = kit ? Object.assign({}, kit) : { family: "structure" };
      if (pole) {
        base.voltage = base.voltage || pole.voltage;
        base.structure = base.structure || pole.structure;
        base.dtrMount = base.dtrMount || pole.dtrMount;
        base.dtrCapacity =
          base.dtrCapacity || pole.dtrCapacity || pole.dtCapacityKva;
        base.location = pole.kitLocation || pole.location || base.location;
        base.arrangement =
          pole.kitArrangement || pole.arrangement || base.arrangement;
        base.extension =
          pole.kitExtension || pole.extension || base.extension;
        base.conductor = pole.conductor || base.conductor;
        base.conductorShort = pole.conductorShort || base.conductorShort;
        base.conductorName = pole.conductorName || base.conductorName;
        base.conductorFamily = pole.conductorFamily || base.conductorFamily;
        base.wireCount = pole.wireCount || base.wireCount;
        base.wireLabel = pole.wireLabel || base.wireLabel;
        base.poleMaterial =
          pole.poleMaterial || pole.material || base.poleMaterial;
        base._poleMaterial =
          pole.poleMaterial || pole.material || base._poleMaterial;
      }
      return displayName(base);
    },
    guide: GUIDE,
    guideExample: guideExample,
    kitTitle: displayName,
  };
})(typeof window !== "undefined" ? window : globalThis);
