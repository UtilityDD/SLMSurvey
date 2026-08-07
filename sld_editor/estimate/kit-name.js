/**
 * Fixed-sequence kit display names.
 *
 * Structure example: 11kV-1P-Tan-Sec-NoExt-DOG
 * Sequence: Voltage-Type-Loc-Arr-Ext-Cond[-Wire][-kVA]
 *
 * HT (11/33) never shows wire count — always 3-wire / cable.
 * Pole is a variant, not part of the config name.
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
    var parts = [
      voltagePart(kit),
      typePart(kit),
      locPart(kit),
    ];
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
    return "11kV-1P-Tan-Sec-NoExt-DOG";
  }

  global.SlmKitName = {
    displayName: displayName,
    structureDisplayName: structureDisplayName,
    /** Name from a matched kit, or from pole chips when no kit yet. */
    forPole: function (pole, kit) {
      if (kit) return displayName(kit);
      if (!pole) return "—";
      return structureDisplayName({
        family: "structure",
        voltage: pole.voltage,
        structure: pole.structure,
        dtrMount: pole.dtrMount,
        dtrCapacity: pole.dtrCapacity || pole.dtCapacityKva,
        location: pole.kitLocation || pole.location,
        arrangement: pole.kitArrangement || pole.arrangement,
        extension: pole.kitExtension || pole.extension,
        conductor: pole.conductor,
        conductorShort: pole.conductorShort,
        conductorName: pole.conductorName,
        conductorFamily: pole.conductorFamily,
        wireCount: pole.wireCount,
        wireLabel: pole.wireLabel,
      });
    },
    guide: GUIDE,
    guideExample: guideExample,
    kitTitle: displayName,
  };
})(typeof window !== "undefined" ? window : globalThis);
