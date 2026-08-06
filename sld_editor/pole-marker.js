/**
 * Shared Android-matching pole marker helpers (SurveyMapRenderer.createMarkerBitmap).
 * Voltage-colored circle (diamond for 1NP); existing = filled, proposed = hollow.
 */
(function (global) {
  "use strict";

  var COLORS = {
    kv33: "#d32f2f",
    kv11: "#f9a825",
    lt: "#388e3c",
    selection: "#ff6f00",
  };

  function voltColor(v) {
    var s = String(v || "");
    if (s.indexOf("33") >= 0) return COLORS.kv33;
    if (s.indexOf("11") >= 0) return COLORS.kv11;
    return COLORS.lt;
  }

  function structureLabel(raw) {
    if (raw == null || raw === "") return "1P";
    if (typeof raw === "object" && raw.label) return String(raw.label);
    var t = String(raw).trim();
    var u = t.toUpperCase();
    if (u === "P1" || u === "1P") return "1P";
    if (u === "P2" || u === "2P") return "2P";
    if (u === "P3" || u === "3P") return "3P";
    if (u === "P4" || u === "4P") return "4P";
    if (u === "P1N" || u === "1NP" || u === "1N") return "1NP";
    if (u === "DTR") return "DTR";
    return t;
  }

  function structureOf(assetOrNode) {
    if (!assetOrNode) return "1P";
    return structureLabel(
      assetOrNode.structure ||
        assetOrNode.poleStructure ||
        (assetOrNode.assetRef &&
          (assetOrNode.assetRef.structure || assetOrNode.assetRef.poleStructure))
    );
  }

  function isProposed(assetOrNode) {
    var status =
      (assetOrNode && assetOrNode.status) ||
      (assetOrNode && assetOrNode.assetRef && assetOrNode.assetRef.status) ||
      "";
    return String(status).toLowerCase() === "proposed";
  }

  function isExtra(struct) {
    var s = structureLabel(struct);
    return s === "1NP";
  }

  function isVerified(asset) {
    if (!asset) return true;
    if (asset.locationVerified === false || asset.locationVerified === "false") return false;
    if (asset.assetRef && (asset.assetRef.locationVerified === false || asset.assetRef.locationVerified === "false")) {
      return false;
    }
    return true;
  }

  /**
   * HTML for Leaflet divIcon — same look as Android map markers.
   * @param {object} asset survey asset
   * @param {{selected?:boolean}} opts
   */
  function poleIconHtml(asset, opts) {
    opts = opts || {};
    var color = voltColor(asset && asset.voltage);
    var struct = structureOf(asset);
    var proposed = isProposed(asset);
    var extra = isExtra(struct);
    var unverified = !isVerified(asset);
    var selected = !!opts.selected;
    var labelClass =
      "slm-pole-label" +
      (struct === "DTR" ? " is-dtr" : "") +
      (extra ? " is-1np" : "");
    var classes =
      "slm-pole" +
      (proposed ? " is-proposed" : " is-existing") +
      (extra ? " is-extra" : "") +
      (unverified ? " is-unverified" : "") +
      (selected ? " is-selected" : "");
    return (
      '<div class="' +
      classes +
      '" style="--pole:' +
      color +
      '"><span class="slm-pole-mark"><span class="' +
      labelClass +
      '">' +
      struct +
      "</span></span></div>"
    );
  }

  /** Leaflet icon options — centre of circle = GPS. */
  function leafletIconOptions(asset, opts) {
    return {
      className: "slm-map-pole-icon",
      html: poleIconHtml(asset, opts),
      iconSize: [40, 40],
      iconAnchor: [20, 20],
    };
  }

  /**
   * Draw Android-style pole on a 2D canvas (schematic / print).
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x
   * @param {number} y
   * @param {object} nodeOrAsset
   * @param {{radius?:number, selected?:boolean}} opts
   */
  function drawPoleOnCanvas(ctx, x, y, nodeOrAsset, opts) {
    opts = opts || {};
    var asset = nodeOrAsset.assetRef || nodeOrAsset;
    var color = voltColor(asset.voltage || (nodeOrAsset && nodeOrAsset.voltage));
    var struct = structureOf(nodeOrAsset);
    var proposed = isProposed(nodeOrAsset);
    var extra = isExtra(struct);
    var unverified = !isVerified(asset);
    var r = opts.radius != null ? opts.radius : extra ? 14 : 16;

    ctx.save();
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    if (opts.selected) {
      ctx.beginPath();
      ctx.arc(x, y, r + 7, 0, Math.PI * 2);
      ctx.strokeStyle = COLORS.selection;
      ctx.lineWidth = 3.5;
      ctx.stroke();
    }

    if (extra) {
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.stroke();
    } else if (proposed) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 3.5;
      ctx.stroke();
      if (unverified) {
        ctx.beginPath();
        ctx.arc(x, y, r + 4, 0, Math.PI * 2);
        ctx.strokeStyle = "#ff0000";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    } else {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = unverified ? "#ff0000" : "#ffffff";
      ctx.lineWidth = 2.5;
      if (unverified) ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.fillStyle = extra || proposed ? color : "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    var fontSize = struct === "DTR" ? Math.round(r * 0.72) : extra ? Math.round(r * 0.6) : Math.round(r * 0.85);
    ctx.font = "bold " + fontSize + "px Outfit, Inter, sans-serif";
    ctx.fillText(struct, x, y + 0.5);
    ctx.restore();
  }

  global.SlmPoleSymbol = {
    COLORS: COLORS,
    voltColor: voltColor,
    structureLabel: structureLabel,
    structureOf: structureOf,
    isProposed: isProposed,
    isExtra: isExtra,
    isVerified: isVerified,
    poleIconHtml: poleIconHtml,
    leafletIconOptions: leafletIconOptions,
    drawPoleOnCanvas: drawPoleOnCanvas,
  };
})(typeof window !== "undefined" ? window : globalThis);
