/**
 * Desktop auto-estimate matcher (Final kits × survey workspace).
 * Mirrors Android EstimateMatcher — desktop is the primary BOQ device.
 */
(function (global) {
  "use strict";

  function isAbc(tag) {
    return String(tag || "").toUpperCase() === "ABC";
  }
  function isPvc(tag) {
    return String(tag || "").toUpperCase() === "PVC";
  }
  function isCable(tag) {
    return isAbc(tag) || isPvc(tag);
  }

  function sizedConductorIds(voltage, tag) {
    const t = String(tag || "").trim();
    if (!t || isCable(t)) return [];
    if (voltage === "33kV") {
      if (t === "100") return ["ACSR|Dog|100"];
      if (t === "150") return ["ACSR|Wolf|150"];
      if (t === "200") return ["ACSR|Panther|200"];
    }
    if (voltage === "11kV") {
      if (t === "30") return ["ACSR|Weasel|30"];
      if (t === "50") return ["ACSR|Rabbit|50"];
      if (t === "100") return ["ACSR|Dog|100"];
    }
    if (voltage === "LT") {
      if (t === "20") return ["ACSR|Squirrel|20"];
      if (t === "30") return ["ACSR|Weasel|30"];
      if (t === "50") return ["ACSR|Rabbit|50"];
    }
    return [];
  }

  function agnosticConductorIds(voltage, tag) {
    if (!tag || isPvc(tag)) return [];
    if (voltage === "LT") return isAbc(tag) ? ["LT|ANY|ABC"] : ["LT|ANY|ACSR"];
    if (voltage === "11kV") {
      return isAbc(tag) ? ["11kV|ANY|ABC", "ABC|HT|3x95"] : ["11kV|ANY|ACSR"];
    }
    return [];
  }

  function conductorFamily(tag) {
    if (!tag || isPvc(tag)) return null;
    return isAbc(tag) ? "ABC" : "ACSR";
  }

  function arrangementId(label) {
    if (!label) return null;
    const s = String(label);
    if (/in[\s-]*line/i.test(s) || s === "InlineArr") return "InlineArr";
    if (/sectional/i.test(s)) return "Sectional";
    return s;
  }

  function extensionId(label) {
    if (!label) return null;
    const s = String(label);
    if (/with\s*ext/i.test(s) || s === "WithExt") return "WithExt";
    if (/no\s*ext/i.test(s) || s === "NoExt") return "NoExt";
    return s;
  }

  function deriveKitWire(asset) {
    if (asset.kitWire) return asset.kitWire;
    if (isCable(asset.conductor)) return null;
    if (asset.voltage === "LT") {
      if (asset.structure === "2P") return "3W";
      if (asset.structure === "3P") return "4W";
      return "2W";
    }
    return "3W";
  }

  function isEstimateReady(asset) {
    if (String(asset.status || "") !== "Proposed") return true;
    if (!asset.structure || !asset.conductor) return false;
    if (!asset.kitLocation || !asset.kitExtension) return false;
    if (asset.kitLocation !== "Dead-end" && !arrangementId(asset.kitArrangement)) return false;
    if (asset.structure === "DTR") {
      if (!asset.dtrMount || !asset.dtCapacityKva) return false;
    }
    return true;
  }

  function structureKey(asset) {
    if (asset.structure === "DTR") {
      const m = asset.dtrMount;
      if (!m) return null;
      return m.startsWith("DTR") ? m : `DTR${m}`;
    }
    if (asset.voltage === "LT") return "1P";
    return asset.structure || null;
  }

  function normalizeKva(raw) {
    if (raw == null || raw === "") return null;
    const digits = String(raw).replace(/\D/g, "");
    return digits || null;
  }

  function kitTitle(kit) {
    if (kit.family === "conductor") {
      const wire = kit.wireLabel ? ` · ${kit.wireLabel}` : "";
      return `${kit.voltage} · ${kit.conductorShort || kit.conductorName || kit.conductorId}${wire}`;
    }
    const loc = kit.location ? ` · ${kit.location}` : "";
    const arr = kit.arrangementLabel ? ` · ${kit.arrangementLabel}` : "";
    let cond = "";
    if (kit.conductorSizeAgnostic) {
      cond = ` · ${kit.conductorFamily || "ANY"}${kit.wireLabel ? ` · ${kit.wireLabel}` : ""}`;
    } else if (kit.conductorShort) {
      cond = ` · ${kit.conductorShort}`;
    }
    const ext = kit.extensionLabel ? ` · ${kit.extensionLabel}` : "";
    const dtr = kit.dtrCapacity ? ` · ${kit.dtrCapacity}` : "";
    return `${kit.voltage} · ${kit.structureLabel || kit.structure}${loc}${arr}${cond}${ext}${dtr}`;
  }

  function wireMatchesStructure(kit, asset) {
    const want = deriveKitWire(asset);
    if (isCable(asset.conductor)) {
      return (
        !kit.wireCount ||
        String(kit.wireLabel || "").toLowerCase() === "cable" ||
        kit.conductorFamily === "ABC"
      );
    }
    if (!want) return !kit.wireCount;
    return kit.wireCount === want;
  }

  function conductorMatchesStructure(kit, asset) {
    if (kit.conductorSizeAgnostic) {
      const fam = conductorFamily(asset.conductor);
      if (!fam) return false;
      return (
        kit.conductorFamily === fam ||
        (kit.conductorId && kit.conductorId.includes(`|${fam}`)) ||
        agnosticConductorIds(asset.voltage, asset.conductor).includes(kit.conductorId)
      );
    }
    const sized = sizedConductorIds(asset.voltage, asset.conductor);
    const agn = agnosticConductorIds(asset.voltage, asset.conductor);
    return sized.includes(kit.conductorId) || agn.includes(kit.conductorId);
  }

  function findStructureKit(asset, kits, finalOnly) {
    const voltage = asset.voltage;
    const sKey = structureKey(asset);
    if (!sKey) return null;
    const location = asset.kitLocation;
    const ext = extensionId(asset.kitExtension);
    const arrWant =
      location === "Dead-end" ? null : arrangementId(asset.kitArrangement);
    const candidates = kits.filter((kit) => {
      if (kit.voltage !== voltage) return false;
      if (finalOnly && !kit.complete) return false;
      if (!kit.enabled) return false;
      const structOk =
        kit.structure === sKey ||
        (asset.structure === "DTR" &&
          kit.isDtr &&
          kit.dtrMount === String(asset.dtrMount || "").replace(/^DTR/, ""));
      if (!structOk) return false;
      if (kit.location !== location) return false;
      if (String(kit.extension || "") !== String(ext || "")) return false;
      if (location === "Dead-end") {
        if (kit.arrangement) return false;
      } else if (kit.arrangement !== arrWant) {
        return false;
      }
      if (!wireMatchesStructure(kit, asset)) return false;
      if (!conductorMatchesStructure(kit, asset)) return false;
      if (asset.structure === "DTR" && kit.isDtr && kit.dtrCapacity) {
        if (normalizeKva(kit.dtrCapacity) !== normalizeKva(asset.dtCapacityKva)) {
          return false;
        }
      }
      return true;
    });
    return candidates.find((k) => k.complete) || candidates[0] || null;
  }

  function findConductorKit(sample, kits, finalOnly) {
    const voltage = sample.voltage;
    const tag = sample.conductor;
    if (isCable(tag)) {
      const familyKits = kits.filter(
        (k) =>
          k.voltage === voltage &&
          k.enabled !== false &&
          (!finalOnly || k.complete) &&
          (k.conductorFamily === "ABC" ||
            (k.conductorId && k.conductorId.includes("ABC")))
      );
      const finals = familyKits.filter((k) => k.complete);
      if (finalOnly) {
        if (finals.length === 1) return finals[0];
        return null;
      }
      return familyKits.length === 1 ? familyKits[0] : familyKits[0] || null;
    }
    const sized = sizedConductorIds(voltage, tag);
    if (!sized.length) return null;
    const wire = deriveKitWire(sample);
    const candidates = kits.filter((kit) => {
      if (kit.voltage !== voltage || kit.enabled === false) return false;
      if (finalOnly && !kit.complete) return false;
      if (!sized.includes(kit.conductorId)) return false;
      if (!wire) {
        return !kit.wireCount || String(kit.wireLabel || "").toLowerCase() === "cable";
      }
      return kit.wireCount === wire;
    });
    return candidates.find((k) => k.complete) || candidates[0] || null;
  }

  function money(n) {
    if (n == null || Number.isNaN(n)) return "—";
    return Number(n).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function kitMaterialAmount(kit, rateIndex) {
    if (!kit || !Array.isArray(kit.lines) || !kit.lines.length) return null;
    let sum = 0;
    let any = false;
    for (const line of kit.lines) {
      const code = line.code || line.matCode;
      const qty = Number(line.qty ?? line.quantity ?? 0);
      const rate =
        line.rate != null
          ? Number(line.rate)
          : rateIndex[code] != null
            ? Number(rateIndex[code])
            : null;
      if (rate == null || Number.isNaN(qty)) continue;
      sum += qty * rate;
      any = true;
    }
    return any ? sum : null;
  }

  function buildRateIndex(ratebook) {
    const idx = {};
    const mats = ratebook?.materials || [];
    const labs = ratebook?.labour || [];
    for (const m of mats) if (m.code) idx[m.code] = m.rate;
    for (const l of labs) if (l.code) idx[l.code] = l.rate;
    return idx;
  }

  /**
   * @param {object} survey workspace JSON { assets, connections, title, ... }
   * @param {object[]} kits merged kits from Assembly Builder (state.kitsById values)
   * @param {object} [ratebook]
   */
  function buildReport(survey, kits, ratebook) {
    const assets = survey?.assets || [];
    const connections = survey?.connections || [];
    const rateIndex = buildRateIndex(ratebook || {});
    const structures = kits.filter((k) => k.family === "structure" && k.enabled !== false);
    const conductors = kits.filter((k) => k.family === "conductor" && k.enabled !== false);

    const proposed = assets.filter((a) => a.status === "Proposed");
    const gaps = [];
    const structureHits = [];

    for (const pole of [...proposed].sort((a, b) => (a.sequence || 0) - (b.sequence || 0))) {
      if (!isEstimateReady(pole)) {
        gaps.push({
          kind: "gap",
          title: `Pole #${pole.sequence}: needs kit details`,
          qty: 1,
          unit: "pole",
          detail: `${pole.voltage || "?"} · ${pole.structure || "?"} · ${pole.conductor || "?"}`,
          amount: null,
        });
        continue;
      }
      const finalHit = findStructureKit(pole, structures, true);
      if (finalHit) {
        structureHits.push(finalHit);
        continue;
      }
      const draftHit = findStructureKit(pole, structures, false);
      gaps.push(
        draftHit
          ? {
              kind: "gap",
              title: `Pole #${pole.sequence}: no Final kit`,
              qty: 1,
              unit: "pole",
              kitId: draftHit.id,
              detail: `Draft exists — mark Final: ${kitTitle(draftHit)}`,
              amount: null,
            }
          : {
              kind: "gap",
              title: `Pole #${pole.sequence}: no matching kit`,
              qty: 1,
              unit: "pole",
              detail: [
                pole.voltage,
                pole.structure,
                pole.kitLocation,
                pole.kitArrangement,
                pole.kitExtension,
                pole.conductor,
              ]
                .filter(Boolean)
                .join(" · "),
              amount: null,
            }
      );
    }

    const structureQty = new Map();
    for (const kit of structureHits) {
      const prev = structureQty.get(kit.id);
      structureQty.set(kit.id, { kit, n: (prev?.n || 0) + 1 });
    }
    const lines = [];
    for (const { kit, n } of structureQty.values()) {
      const unitAmt = kitMaterialAmount(kit, rateIndex);
      lines.push({
        kind: "structure",
        title: kitTitle(kit),
        qty: n,
        unit: "nos",
        kitId: kit.id,
        detail: null,
        amount: unitAmt != null ? unitAmt * n : null,
      });
    }

    const byId = new Map(assets.map((a) => [a.id, a]));
    const spanGroups = new Map();
    for (const conn of connections) {
      if (conn.status !== "Proposed") continue;
      const to = byId.get(conn.toAssetId);
      if (!to || to.status !== "Proposed") continue;
      const wire = deriveKitWire(to) || "cable";
      const key = `${to.voltage}|${to.conductor}|${wire}`;
      if (!spanGroups.has(key)) spanGroups.set(key, []);
      spanGroups.get(key).push(conn);
    }

    let matchedKm = 0;
    const condAgg = new Map();
    for (const [key, conns] of spanGroups) {
      const sample = byId.get(conns[0].toAssetId);
      if (!sample) continue;
      const metres = conns.reduce(
        (s, c) => s + (parseFloat(c.spanLengthM) || 0),
        0
      );
      if (metres <= 0) {
        gaps.push({
          kind: "gap",
          title: `Span length missing for ${sample.voltage} ${sample.conductor}`,
          qty: conns.length,
          unit: "spans",
          detail: key,
          amount: null,
        });
        continue;
      }
      const km = metres / 1000;
      const finalHit = findConductorKit(sample, conductors, true);
      if (finalHit) {
        matchedKm += km;
        const unitAmt = kitMaterialAmount(finalHit, rateIndex);
        const prev = condAgg.get(finalHit.id);
        const amount = unitAmt != null ? unitAmt * km : null;
        if (prev) {
          prev.qty += km;
          if (amount != null) prev.amount = (prev.amount || 0) + amount;
          prev.detail = `${prev.detail || ""} · ${metres.toFixed(0)} m`.trim();
        } else {
          condAgg.set(finalHit.id, {
            kind: "conductor",
            title: kitTitle(finalHit),
            qty: km,
            unit: "km",
            kitId: finalHit.id,
            detail: `${metres.toFixed(0)} m · ${conns.length} span(s)`,
            amount,
          });
        }
        continue;
      }
      const draftHit = findConductorKit(sample, conductors, false);
      gaps.push(
        draftHit
          ? {
              kind: "gap",
              title: `Conductor ${sample.voltage} ${sample.conductor}: no Final kit`,
              qty: km,
              unit: "km",
              kitId: draftHit.id,
              detail: `Draft exists — mark Final: ${kitTitle(draftHit)}`,
              amount: null,
            }
          : {
              kind: "gap",
              title: `Conductor ${sample.voltage} ${sample.conductor}: no matching kit`,
              qty: km,
              unit: "km",
              detail:
                isAbc(sample.conductor) && sample.voltage === "LT"
                  ? "ABC size ambiguous — finalize one ABC conductor kit on desktop"
                  : key,
              amount: null,
            }
      );
    }

    for (const row of condAgg.values()) lines.push(row);

    const totalAmount = lines.reduce(
      (s, r) => s + (r.amount != null ? r.amount : 0),
      0
    );
    const hasAmounts = lines.some((r) => r.amount != null);

    return {
      title: survey.title || survey.surveyTitle || "Survey",
      surveyId: survey.surveyId || survey.id || "",
      proposedPoles: proposed.length,
      readyPoles: proposed.filter(isEstimateReady).length,
      matchedStructures: structureHits.length,
      matchedConductorKm: matchedKm,
      lines,
      gaps,
      totalAmount: hasAmounts ? totalAmount : null,
      money,
    };
  }

  function reportAsText(report) {
    const lines = [];
    lines.push("SLM Auto-estimate (desktop)");
    lines.push(`Survey: ${report.title}`);
    lines.push(
      `Proposed poles: ${report.proposedPoles} · ready: ${report.readyPoles} · matched: ${report.matchedStructures}`
    );
    if (report.matchedConductorKm > 0) {
      lines.push(`Conductor km matched: ${report.matchedConductorKm.toFixed(3)}`);
    }
    lines.push("");
    if (report.lines.length) {
      lines.push("BOQ (Final kits)");
      for (const row of report.lines) {
        const qty =
          row.qty === Math.floor(row.qty) ? String(row.qty) : row.qty.toFixed(3);
        let line = `• ${row.title}: ${qty} ${row.unit}`;
        if (row.amount != null) line += ` = ${money(row.amount)}`;
        lines.push(line);
      }
      if (report.totalAmount != null) {
        lines.push(`Total (from kit lines): ${money(report.totalAmount)}`);
      }
      lines.push("");
    }
    if (report.gaps.length) {
      lines.push("Gaps");
      for (const row of report.gaps) {
        lines.push(`• ${row.title}`);
        if (row.detail) lines.push(`  ${row.detail}`);
      }
    }
    return lines.join("\n");
  }

  global.SlmEstimateMatch = {
    buildReport,
    reportAsText,
    isEstimateReady,
    kitTitle,
    money,
  };
})(typeof window !== "undefined" ? window : globalThis);
