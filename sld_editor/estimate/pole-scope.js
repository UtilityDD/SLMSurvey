/**
 * Pole-scoped kit overlays — address (kitId + poleToken) without splitting matrix kits.
 * Shared by Estimate + Structures + Map kit modal.
 *
 * Edit / pending keys:
 *   kitId              → legacy / kit-wide base
 *   kitId|9M           → pole overlay (normalized token)
 */
(function (global) {
  "use strict";

  var SEP = "|";

  /** Normalize pole tokens so T9/T95 match Structures preferred tokens where needed. */
  function normalizeToken(tok) {
    var t = String(tok || "")
      .trim()
      .toUpperCase();
    if (!t) return "";
    if (t === "T9" || t === "T95") return "T9";
    if (t === "T11") return "T11";
    if (t === "WF") return "WF";
    if (t === "S9") return "T9";
    if (t === "S11") return "T11";
    if (t === "HP") return "WF";
    return t;
  }

  function overlayKey(kitId, poleToken) {
    var id = String(kitId || "").trim();
    if (!id) return "";
    var tok = normalizeToken(poleToken);
    if (!tok) return id;
    return id + SEP + tok;
  }

  function parseKey(key) {
    var raw = String(key || "");
    if (!raw) return { kitId: "", poleToken: "" };
    // Composite keys append |TOKEN after the full STR|… kit id.
    // Kit ids themselves contain | — take the last segment only if it looks like a pole token.
    var last = raw.lastIndexOf(SEP);
    if (last <= 0) return { kitId: raw, poleToken: "" };
    var maybeTok = raw.slice(last + 1);
    var idPart = raw.slice(0, last);
    if (/^(8M|9M|RL|HP|WF|T9|T95|T11|S9|S11)$/i.test(maybeTok)) {
      return { kitId: idPart, poleToken: normalizeToken(maybeTok) };
    }
    return { kitId: raw, poleToken: "" };
  }

  function isCompositeKey(key) {
    var p = parseKey(key);
    return !!(p.kitId && p.poleToken && overlayKey(p.kitId, p.poleToken) === String(key));
  }

  /**
   * Resolve recipe for a leaf: pole overlay wins, else kit-wide base edit, else matrix base.
   * edits: localStorage map; baseKit: matrix/custom kit object.
   */
  function resolveRecipe(edits, baseKit, poleToken) {
    var kitId = baseKit && baseKit.id;
    var base = {
      enabled: baseKit && baseKit.enabled !== false,
      complete: !!(baseKit && baseKit.complete),
      lines: Array.isArray(baseKit && baseKit.lines) ? baseKit.lines : [],
      notes: (baseKit && baseKit.notes) || "",
      source: "matrix",
    };
    if (!kitId || !edits) return base;

    var wide = edits[kitId];
    if (wide && typeof wide === "object") {
      base = {
        enabled: wide.enabled != null ? wide.enabled : base.enabled,
        complete: wide.complete != null ? !!wide.complete : base.complete,
        lines: Array.isArray(wide.lines) ? wide.lines : base.lines,
        notes: wide.notes != null ? wide.notes : base.notes,
        source: "base",
      };
    }

    var tok = normalizeToken(poleToken);
    if (!tok) return base;
    var ov = edits[overlayKey(kitId, tok)];
    if (ov && typeof ov === "object") {
      return {
        enabled: ov.enabled != null ? ov.enabled : base.enabled,
        complete: ov.complete != null ? !!ov.complete : base.complete,
        lines: Array.isArray(ov.lines) ? ov.lines : base.lines,
        notes: ov.notes != null ? ov.notes : base.notes,
        source: "pole",
      };
    }
    return base;
  }

  function writeOverlay(edits, kitId, poleToken, patch) {
    var map = edits && typeof edits === "object" ? edits : {};
    var key = overlayKey(kitId, poleToken);
    if (!key) return map;
    var prev = map[key] && typeof map[key] === "object" ? map[key] : {};
    map[key] = {
      enabled: patch.enabled != null ? patch.enabled : prev.enabled,
      complete: patch.complete != null ? !!patch.complete : !!prev.complete,
      lines: Array.isArray(patch.lines) ? patch.lines : prev.lines || [],
      notes: patch.notes != null ? patch.notes : prev.notes || "",
    };
    return map;
  }

  /** Pending map keys are composite when pole known. */
  function pendingKey(kitId, poleToken) {
    return overlayKey(kitId, poleToken);
  }

  /**
   * True if this leaf has a pending suggestion.
   * Exact pole match only. Legacy kit-only keys apply only when leaf has no pole
   * OR when explicitly marked legacyWide.
   */
  function isPendingForLeaf(pendingMap, kitId, poleToken) {
    if (!kitId || !pendingMap) return false;
    var tok = normalizeToken(poleToken);
    var id = String(kitId);

    if (tok) {
      var ck = pendingKey(id, tok);
      if (pendingMap[ck]) return true;
      // Legacy: meta stored under bare kitId with matching poleToken field.
      var legacy = pendingMap[id];
      if (legacy && legacy !== true && typeof legacy === "object") {
        var legTok = normalizeToken(legacy.poleToken);
        if (legTok && legTok === tok) return true;
        // Old unscoped pending under bare id — do NOT paint all poles.
        return false;
      }
      return false;
    }

    // Kit-level row (no pole leaf): any pending for this kit.
    if (pendingMap[id]) return true;
    var prefix = id + SEP;
    return Object.keys(pendingMap).some(function (k) {
      return k === id || k.indexOf(prefix) === 0;
    });
  }

  function setPendingEntry(pendingMap, kitId, poleToken, meta) {
    var map = pendingMap && typeof pendingMap === "object" ? pendingMap : {};
    var tok = normalizeToken(poleToken);
    var key = pendingKey(kitId, tok);
    if (!key) return map;
    // Drop legacy bare-kit entry so it cannot mark every pole.
    if (tok && map[String(kitId)]) delete map[String(kitId)];
    var prev = map[key] && typeof map[key] === "object" ? map[key] : {};
    var proposed =
      meta && meta.proposed && typeof meta.proposed === "object"
        ? meta.proposed
        : prev.proposed || null;
    map[key] = {
      poleToken: tok,
      poleMaterial: String((meta && meta.poleMaterial) || prev.poleMaterial || "").trim(),
      label: String((meta && meta.label) || prev.label || "").trim(),
      suggestionId: String((meta && meta.suggestionId) || prev.suggestionId || "").trim(),
      proposed: proposed,
    };
    return map;
  }

  function clearPendingEntry(pendingMap, kitId, poleToken) {
    var map = pendingMap && typeof pendingMap === "object" ? pendingMap : {};
    var tok = normalizeToken(poleToken);
    var id = String(kitId || "");
    if (!id) return map;
    if (tok) {
      delete map[pendingKey(id, tok)];
      // Also clear legacy bare entry if it pointed at this pole.
      var leg = map[id];
      if (leg && typeof leg === "object" && normalizeToken(leg.poleToken) === tok) {
        delete map[id];
      }
      return map;
    }
    delete map[id];
    var prefix = id + SEP;
    Object.keys(map).forEach(function (k) {
      if (k.indexOf(prefix) === 0) delete map[k];
    });
    return map;
  }

  /** Build pending map from server suggestion rows (multi-pole safe). */
  function pendingMapFromSuggestions(rows) {
    var next = {};
    (rows || []).forEach(function (s) {
      if (!s || s.status !== "pending" || !s.kit_id) return;
      var prop = s.proposed || {};
      var tok = prop.poleToken || prop.pole_token || "";
      // Fallback: parse abbr from kit_label (…-9M-…).
      if (!tok && s.kit_label) {
        String(s.kit_label)
          .split(/[-·|]/)
          .forEach(function (p) {
            if (/^(8M|9M|RL|HP|WF|T9|T95|T11|S9|S11)$/i.test(p)) tok = p;
          });
      }
      setPendingEntry(next, s.kit_id, tok, {
        poleMaterial: prop.poleMaterial || prop.pole_material || "",
        label: s.kit_label || "",
        suggestionId: s.id || "",
        proposed: prop,
      });
    });
    return next;
  }

  /** Pending meta for a leaf (composite key, then legacy). */
  function pendingEntryForLeaf(pendingMap, kitId, poleToken) {
    if (!kitId || !pendingMap) return null;
    var tok = normalizeToken(poleToken);
    var id = String(kitId);
    if (tok) {
      var hit = pendingMap[pendingKey(id, tok)];
      if (hit) return hit;
      var legacy = pendingMap[id];
      if (legacy && legacy !== true && typeof legacy === "object") {
        var legTok = normalizeToken(legacy.poleToken);
        if (legTok && legTok === tok) return legacy;
      }
      return null;
    }
    if (pendingMap[id] && typeof pendingMap[id] === "object") return pendingMap[id];
    var prefix = id + SEP;
    var keys = Object.keys(pendingMap);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i] === id || keys[i].indexOf(prefix) === 0) return pendingMap[keys[i]];
    }
    return null;
  }

  /**
   * Prefer pending proposed recipe when reviewing a Suggested leaf.
   * Falls back to resolveRecipe(edits, kit, poleToken).
   */
  function resolveRecipeWithPending(edits, pendingMap, baseKit, poleToken) {
    var entry = pendingEntryForLeaf(pendingMap, baseKit && baseKit.id, poleToken);
    var prop = entry && entry.proposed;
    if (prop && Array.isArray(prop.lines) && prop.lines.length) {
      return {
        enabled: prop.enabled !== false,
        complete: !!prop.complete,
        lines: prop.lines,
        notes: prop.notes != null ? String(prop.notes) : "",
        source: "pending",
        suggestionId: (entry && entry.suggestionId) || "",
      };
    }
    return resolveRecipe(edits, baseKit, poleToken);
  }

  function publishStatus(recipe, pending, kitId, poleToken) {
    if (!recipe || recipe.enabled === false) return "off";
    if (pending && isPendingForLeaf(pending, kitId, poleToken)) return "suggested";
    if (!(recipe.lines || []).length) return "empty";
    if (recipe.complete) return "final";
    return "draft";
  }

  global.SlmPoleScope = {
    normalizeToken: normalizeToken,
    overlayKey: overlayKey,
    parseKey: parseKey,
    isCompositeKey: isCompositeKey,
    resolveRecipe: resolveRecipe,
    resolveRecipeWithPending: resolveRecipeWithPending,
    writeOverlay: writeOverlay,
    pendingKey: pendingKey,
    isPendingForLeaf: isPendingForLeaf,
    pendingEntryForLeaf: pendingEntryForLeaf,
    setPendingEntry: setPendingEntry,
    clearPendingEntry: clearPendingEntry,
    pendingMapFromSuggestions: pendingMapFromSuggestions,
    publishStatus: publishStatus,
    SEP: SEP,
  };
})(typeof window !== "undefined" ? window : globalThis);
