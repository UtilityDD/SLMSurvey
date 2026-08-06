/**
 * Job map — Android SurveyMapRenderer pole symbols via SlmPoleSymbol.
 */
(function (global) {
  "use strict";

  var map = null;
  var layer = null;
  var hostEl = null;
  var selectedId = null;
  var onSelect = null;

  function sym() {
    return global.SlmPoleSymbol;
  }

  function voltColor(v) {
    return sym() ? sym().voltColor(v) : "#388e3c";
  }

  function latLngOf(asset) {
    if (!asset) return null;
    var lat = asset.latitude != null ? asset.latitude : asset.surveyLatitude;
    var lng = asset.longitude != null ? asset.longitude : asset.surveyLongitude;
    if (lat == null || lng == null) return null;
    var la = Number(lat);
    var ln = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
    return [la, ln];
  }

  function formatSpan(m) {
    var n = Number(m);
    if (!Number.isFinite(n) || n <= 0) return "";
    return Math.round(n) + " m";
  }

  function ensureMap(host) {
    if (!host || typeof L === "undefined") return null;
    if (map && hostEl === host) {
      setTimeout(function () {
        map.invalidateSize();
      }, 40);
      return map;
    }
    destroy();
    hostEl = host;
    host.innerHTML = "";
    map = L.map(host, {
      zoomControl: true,
      attributionControl: true,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap",
    }).addTo(map);
    layer = L.layerGroup().addTo(map);
    map.setView([22.57, 88.36], 12);
    return map;
  }

  function destroy() {
    if (map) {
      try {
        map.remove();
      } catch (e) {
        /* ignore */
      }
    }
    map = null;
    layer = null;
    hostEl = null;
  }

  function render(host, survey, opts) {
    opts = opts || {};
    onSelect = opts.onSelect || null;
    selectedId = opts.selectedId != null ? opts.selectedId : selectedId;
    if (!ensureMap(host)) return;

    layer.clearLayers();
    var assets = (survey && survey.assets) || [];
    var byId = Object.create(null);
    var bounds = [];

    assets.forEach(function (asset) {
      byId[String(asset.id)] = asset;
    });

    ((survey && survey.connections) || []).forEach(function (conn) {
      var a = byId[String(conn.fromAssetId)];
      var b = byId[String(conn.toAssetId)];
      if (!a || !b) return;
      var p1 = latLngOf(a);
      var p2 = latLngOf(b);
      if (!p1 || !p2) return;
      var color = voltColor(conn.voltage || a.voltage || b.voltage);
      var dashed = String(conn.status || "").toLowerCase() === "proposed";
      L.polyline([p1, p2], {
        color: color,
        weight: 4,
        opacity: 0.95,
        dashArray: dashed ? "10, 8" : null,
        interactive: false,
      }).addTo(layer);

      var spanRaw =
        conn.spanLengthM != null && conn.spanLengthM !== ""
          ? conn.spanLengthM
          : null;
      var spanText = formatSpan(spanRaw);
      if (spanText) {
        var mid = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
        L.marker(mid, {
          interactive: false,
          keyboard: false,
          zIndexOffset: 400,
          icon: L.divIcon({
            className: "ws-map-span-wrap",
            html: '<div class="ws-map-span">' + spanText + "</div>",
            iconSize: [64, 20],
            iconAnchor: [32, 10],
          }),
        }).addTo(layer);
      }
    });

    assets.forEach(function (asset) {
      var ll = latLngOf(asset);
      if (!ll) return;
      bounds.push(ll);
      var isSel = selectedId != null && String(asset.id) === String(selectedId);
      var iconOpts =
        sym() && sym().leafletIconOptions
          ? sym().leafletIconOptions(asset, { selected: isSel })
          : {
              className: "slm-map-pole-icon",
              html: "<div class='slm-pole is-existing'><span class='slm-pole-mark'><span class='slm-pole-label'>1P</span></span></div>",
              iconSize: [40, 40],
              iconAnchor: [20, 20],
            };
      var marker = L.marker(ll, {
        icon: L.divIcon(iconOpts),
        zIndexOffset: isSel ? 900 : 700,
      });
      marker.on("click", function () {
        selectedId = asset.id;
        if (onSelect) onSelect(asset);
      });
      marker.addTo(layer);
    });

    if (bounds.length === 1) {
      map.setView(bounds[0], 16);
    } else if (bounds.length > 1) {
      try {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });
      } catch (e) {
        map.setView(bounds[0], 14);
      }
    }

    setTimeout(function () {
      if (map) map.invalidateSize();
    }, 80);
  }

  function setSelected(id) {
    selectedId = id;
  }

  global.SlmWsMap = {
    render: render,
    destroy: destroy,
    setSelected: setSelected,
  };
})(typeof window !== "undefined" ? window : globalThis);
