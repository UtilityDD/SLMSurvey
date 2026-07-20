/**
 * SLM Survey Desktop CAD Editor
 * Core Application Logic
 */

// Custom Irregular Shape SVG Assets
const SVG_ROAD = `data:image/svg+xml;utf8,<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><path d="M10,35 C30,10 70,80 90,45" fill="none" stroke="%23cbd5e1" stroke-width="24" stroke-linecap="round"/><path d="M10,35 C30,10 70,80 90,45" fill="none" stroke="%2364748b" stroke-width="20" stroke-linecap="round"/><path d="M10,35 C30,10 70,80 90,45" fill="none" stroke="white" stroke-width="1.5" stroke-dasharray="6,6" stroke-linecap="round"/></svg>`;
const SVG_RIVER = `data:image/svg+xml;utf8,<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><path d="M10,80 C30,40 50,60 90,20" fill="none" stroke="%2393c5fd" stroke-width="20" stroke-linecap="round"/><path d="M10,80 C30,40 50,60 90,20" fill="none" stroke="%2360a5fa" stroke-width="16" stroke-linecap="round"/></svg>`;
const SVG_POND = `data:image/svg+xml;utf8,<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><defs><radialGradient id="g" cx="50%25" cy="50%25" r="50%25"><stop offset="0%25" stop-color="%23bae6fd"/><stop offset="100%25" stop-color="%2393c5fd"/></radialGradient></defs><path d="M15,40 C25,15 50,20 85,35 C95,65 70,80 30,85 C5,65 15,40 Z" fill="url(%23g)" stroke="%233b82f6" stroke-width="2.5"/></svg>`;

const imgCache = {};
function initImageCache() {
    imgCache.road = new Image();
    imgCache.road.src = SVG_ROAD;
    imgCache.river = new Image();
    imgCache.river.src = SVG_RIVER;
    imgCache.pond = new Image();
    imgCache.pond.src = SVG_POND;
}

// Application State
let surveyData = null;
let activeView = 'map'; // 'map' or 'grid'
let map = null;
let mapMarkers = [];
let mapPolylines = [];

// Canvas Properties
const canvas = document.getElementById('sldCanvas');
const ctx = canvas.getContext('2d');
let zoomScale = 1.0;
let panX = 0;
let panY = 0;

// Grid layout variables
let nodes = [];       // { id, sequence, label, structure, material, remarks, x, y, assetRef }
let edges = [];       // { from, to, voltage, status, spanLengthM }
let annotations = {
    texts: [],        // { lat, lng, text, size }
    roads: [],        // { id, lat, lng, width, height, angle, label }
    rivers: [],       // { id, lat, lng, width, height, angle, label }
    landmarks: []     // { id, lat, lng, type, size, radius, label }
};

// Selection & Dragging States
let selectedTool = 'select'; // 'select' mode is the default and only active tool
let draggedNode = null;
let draggedText = null;
let draggedLandmark = null;
let draggedRoad = null;
let draggedRiver = null;
let isPanning = false;
let startPanX = 0;
let startPanY = 0;
let clickStartPos = null;

// Modal States
let activeEditNode = null;

// Init Event Listeners on Load
window.addEventListener('DOMContentLoaded', () => {
    initImageCache();
    initDragAndDrop();
    initViewToggles();
    initToolbarEvents();
    initCanvasEvents();
    initModalEvents();
    initExportEvents();
    initSelectionEvents();
    initStencilDragListeners();
});

// View Toggle Binding
function initViewToggles() {
    const btnMap = document.getElementById('btnViewMap');
    const btnGrid = document.getElementById('btnViewGrid');
    const paneMap = document.getElementById('mapView');
    const paneGrid = document.getElementById('canvasView');

    btnMap.addEventListener('click', () => {
        if (activeView === 'map') return;
        activeView = 'map';
        btnMap.classList.add('active');
        btnGrid.classList.remove('active');
        paneMap.classList.add('active');
        paneGrid.classList.remove('active');
        if (surveyData) {
            renderMap();
        }
    });

    btnGrid.addEventListener('click', () => {
        if (activeView === 'grid') return;
        activeView = 'grid';
        btnGrid.classList.add('active');
        btnMap.classList.remove('active');
        paneGrid.classList.add('active');
        paneMap.classList.remove('active');
        if (surveyData) {
            resetCanvasView();
            drawCanvas();
        }
    });
}

// Drag & Drop Setup
function initDragAndDrop() {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');

    // Prevent defaults
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    // Highlight drop zone
    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.add('dragover'), false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.remove('dragover'), false);
    });

    // Handle dropped files
    dropZone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length) {
            handleFile(files[0]);
        }
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) {
            handleFile(e.target.files[0]);
        }
    });

    // Clicking dropzone triggers file picker
    dropZone.addEventListener('click', (e) => {
        if (e.target !== fileInput && !e.target.classList.contains('btn')) {
            fileInput.click();
        }
    });
}

// Process imported JSON workspace
function handleFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (!data.surveyId || !data.assets) {
                alert('Invalid SLM Workspace file structure.');
                return;
            }
            loadWorkspace(data);
        } catch (err) {
            alert('Failed to parse file: ' + err.message);
        }
    };
    reader.readAsText(file);
}

// Load workspace variables
function loadWorkspace(data) {
    surveyData = data;

    // Display survey details
    document.getElementById('infoTitle').textContent = data.title || 'N/A';
    document.getElementById('infoLineman').textContent = data.linemanName || 'N/A';
    document.getElementById('infoMobile').textContent = data.linemanMobile || 'N/A';
    document.getElementById('infoStatus').textContent = data.isLiveAtSite ? 'Live GPS Verified' : 'Standard Drawing';

    // Show sections
    document.getElementById('infoCard').classList.remove('hidden');
    document.getElementById('toolsCard').classList.remove('hidden');
    document.getElementById('actionsCard').classList.remove('hidden');
    document.getElementById('statsChip').classList.remove('hidden');

    // Parse assets and connections
    nodes = [];
    edges = [];
    
    // Check if custom schematic layout coordinates already exist
    const hasCustomLayout = data.assets.some(a => a.x !== undefined && a.y !== undefined);

    data.assets.forEach((asset, idx) => {
        let x = asset.x;
        let y = asset.y;

        // Fallback default grid spacing layout if not previously customized
        if (x === undefined || y === undefined) {
            const col = idx % 5;
            const row = Math.floor((idx % 10) / 5);
            const page = Math.floor(idx / 10);
            x = 100 + col * 260 + page * 1400;
            y = 200 + row * 350;
        }

        nodes.push({
            id: asset.id,
            sequence: asset.sequence,
            label: `P-${asset.sequence.toString().padStart(2, '0')}`,
            structure: asset.structure || '1P',
            material: asset.poleMaterial || 'PCC-9M',
            remarks: asset.remarks || '',
            x: x,
            y: y,
            assetRef: asset
        });
    });

    data.connections.forEach(conn => {
        edges.push({
            id: conn.id,
            from: conn.fromAssetId,
            to: conn.toAssetId,
            voltage: conn.voltage || '11kV',
            status: conn.status || 'Proposed',
            spanLengthM: conn.spanLengthM ? parseFloat(conn.spanLengthM) : 0
        });
    });

    // Load annotations if present
    if (data.annotations) {
        // Build nodes coordinates baseline first to make sure schematicToLatLng can project correctly
        const loadedTexts = (data.annotations.texts || []).map(t => {
            if (t.lat !== undefined && t.lng !== undefined) return t;
            const coords = schematicToLatLng(t.x, t.y);
            return { ...t, lat: coords.lat, lng: coords.lng };
        });

        const loadedRoads = (data.annotations.roads || []).map(r => {
            if (r.lat1 !== undefined && r.lng1 !== undefined) return r;
            const c1 = schematicToLatLng(r.x1, r.y1);
            const c2 = schematicToLatLng(r.x2, r.y2);
            return { lat1: c1.lat, lng1: c1.lng, lat2: c2.lat, lng2: c2.lng };
        });

        const loadedRivers = (data.annotations.rivers || []).map(riv => {
            if (riv.lat1 !== undefined && riv.lng1 !== undefined) return riv;
            const c1 = schematicToLatLng(riv.x1, riv.y1);
            const c2 = schematicToLatLng(riv.x2, riv.y2);
            return { lat1: c1.lat, lng1: c1.lng, lat2: c2.lat, lng2: c2.lng };
        });

        const loadedLandmarks = (data.annotations.landmarks || []).map(l => {
            if (l.lat !== undefined && l.lng !== undefined) return l;
            const coords = schematicToLatLng(l.x, l.y);
            return { ...l, lat: coords.lat, lng: coords.lng };
        });

        annotations = {
            texts: loadedTexts,
            roads: loadedRoads,
            rivers: loadedRivers,
            landmarks: loadedLandmarks
        };
    } else {
        annotations = { texts: [], roads: [], rivers: [], landmarks: [] };
    }

    // Refresh UI
    updateStats();
    if (activeView === 'map') {
        renderMap();
    } else {
        resetCanvasView();
        drawCanvas();
    }
}

// Update Toolbar stats chip banner
function updateStats() {
    const totalPoles = nodes.length;
    const totalSpans = edges.length;

    // Sum spans in the preset preference unit
    let totalLength = 0;
    edges.forEach(e => {
        totalLength += e.spanLengthM;
    });

    const preset = getPresetDisplayOptions();
    const formattedLength = formatDistance(totalLength, preset.unit, preset.decimals);

    document.getElementById('statPoles').textContent = `${totalPoles} Poles`;
    document.getElementById('statSpans').textContent = `${totalSpans} Spans`;
    document.getElementById('statLength').textContent = `Total R/L: ${formattedLength}`;
}

// Get display formatting parameters
function getPresetDisplayOptions() {
    if (surveyData && surveyData.displayUnit) {
        return {
            unit: surveyData.displayUnit,
            decimals: surveyData.displayDecimals || 1
        };
    }
    return { unit: 'meter', decimals: 1 };
}

// Format distance converter
function formatDistance(metres, unit, decimals) {
    let converted = metres;
    let unitStr = 'm';

    if (unit.toLowerCase() === 'foot' || unit.toLowerCase() === 'ft') {
        converted = metres * 3.28084;
        unitStr = 'ft';
    } else if (unit.toLowerCase() === 'km') {
        converted = metres / 1000.0;
        unitStr = 'km';
    }

    return `${converted.toFixed(decimals)} ${unitStr}`;
/* ==========================================================================
   Map View Rendering (Leaflet)
   ========================================================================== */
let selectedStencilType = null; // Stored type when a stencil item is clicked for click-to-place

function renderMap() {
    // Lazy init map container
    if (!map) {
        map = L.map('mapView').setView([23.25, 77.41], 15);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© OpenStreetMap contributors'
        }).addTo(map);

        // Bind Leaflet Map Clicks
        map.on('click', onMapClick);
    }

    // Clear old map layer markers
    mapMarkers.forEach(m => map.removeLayer(m));
    mapPolylines.forEach(p => map.removeLayer(p));
    mapMarkers = [];
    mapPolylines = [];

    if (nodes.length === 0) return;

    // Bounds calculation to fit all markers dynamically
    const latLngs = [];

    // Map each node to a leaflet marker
    nodes.forEach(node => {
        const lat = node.assetRef.latitude;
        const lng = node.assetRef.longitude;
        latLngs.push([lat, lng]);

        // Custom div icon to reflect structure layout matching our app branding
        const markerIcon = L.divIcon({
            html: `<div class="map-pole-icon ${node.structure.toLowerCase()}">${node.structure}</div>`,
            className: 'custom-map-icon',
            iconSize: [28, 28],
            iconAnchor: [14, 14]
        });

        const marker = L.marker([lat, lng], {
            icon: markerIcon,
            draggable: true
        }).addTo(map);

        // Bind interactive editing on double click
        marker.on('dblclick', () => {
            openEditModal(node);
        });

        // Save position updates on drag finish
        marker.on('dragend', (e) => {
            const newPos = e.target.getLatLng();
            node.assetRef.latitude = newPos.lat;
            node.assetRef.longitude = newPos.lng;
            recalculateSpans();
            updateStats();
            drawCanvas(); // keep canvas synced
        });

        // Popup details binding
        marker.bindPopup(`
            <div class="map-popup">
                <strong>${node.label} (${node.structure})</strong><br>
                <span>Material: ${node.material}</span><br>
                <span>GPS: ${lat.toFixed(5)}, ${lng.toFixed(5)}</span><br>
                <span>Remarks: ${node.remarks || 'None'}</span>
            </div>
        `);

        mapMarkers.push(marker);
    });

    // Draw connection polylines
    const nodesById = {};
    nodes.forEach(n => nodesById[n.id] = n);

    edges.forEach(edge => {
        const fromNode = nodesById[edge.from];
        const toNode = nodesById[edge.to];
        if (!fromNode || !toNode) return;

        const p1 = [fromNode.assetRef.latitude, fromNode.assetRef.longitude];
        const p2 = [toNode.assetRef.latitude, toNode.assetRef.longitude];

        // Match voltage coloring (Red, Yellow/Orange, Green)
        let strokeColor = '#22c55e'; // LT: green
        if (edge.voltage === '33kV') {
            strokeColor = '#ef4444'; // 33kV: red
        } else if (edge.voltage === '11kV') {
            strokeColor = '#f97316'; // 11kV: orange
        }

        const isDashed = edge.status.toLowerCase() === 'proposed';

        const polyline = L.polyline([p1, p2], {
            color: strokeColor,
            weight: 4,
            dashArray: isDashed ? '10, 8' : null
        }).addTo(map);

        mapPolylines.push(polyline);
    });

    // Draw irregular Roads on geographical map (using rotated scaled SVG)
    annotations.roads.forEach(road => {
        const p = [road.lat, road.lng];
        const wPx = metersToPixels(road.width || 40, map.getZoom());
        const hPx = metersToPixels(road.height || 40, map.getZoom());

        const icon = L.divIcon({
            html: `<div style="width: 100%; height: 100%; transform: rotate(${road.angle || 0}deg); display: flex; align-items: center; justify-content: center; position: relative;">
                    <img src="${SVG_ROAD}" style="width: 100%; height: 100%; object-fit: fill;" />
                    ${road.label ? `<span class="lbl" style="position: absolute; bottom: -16px; background: rgba(255,255,255,0.95); padding: 1px 5px; border: 1px solid %23cbd5e1; border-radius: 4px; font-size: 9px; font-weight: bold; color: %23334155; white-space: nowrap; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">${road.label}</span>` : ''}
                  </div>`,
            className: 'custom-road-icon',
            iconSize: [wPx, hPx],
            iconAnchor: [wPx / 2, hPx / 2]
        });

        const marker = L.marker(p, {
            icon: icon,
            draggable: true
        }).addTo(map);

        marker.on('dragend', (e) => {
            const newPos = e.target.getLatLng();
            road.lat = newPos.lat;
            road.lng = newPos.lng;
            drawCanvas(); // sync canvas
        });

        marker.on('click', (e) => {
            if (selectedTool === 'select') {
                L.DomEvent.stopPropagation(e);
                selectAnnotation('road', road);
            }
        });

        marker.on('dblclick', (e) => {
            L.DomEvent.stopPropagation(e);
            const display = road.label || 'Road';
            if (confirm(`Do you want to delete the road "${display}"?`)) {
                annotations.roads = annotations.roads.filter(r => r !== road);
                clearSelection();
                renderMap();
                drawCanvas();
            }
        });

        mapMarkers.push(marker);
    });

    // Draw winding Rivers on geographical map (using rotated scaled SVG)
    annotations.rivers.forEach(river => {
        const p = [river.lat, river.lng];
        const wPx = metersToPixels(river.width || 40, map.getZoom());
        const hPx = metersToPixels(river.height || 40, map.getZoom());

        const icon = L.divIcon({
            html: `<div style="width: 100%; height: 100%; transform: rotate(${river.angle || 0}deg); display: flex; align-items: center; justify-content: center; position: relative;">
                    <img src="${SVG_RIVER}" style="width: 100%; height: 100%; object-fit: fill;" />
                    ${river.label ? `<span class="lbl" style="position: absolute; bottom: -16px; background: rgba(255,255,255,0.95); padding: 1px 5px; border: 1px solid %23cbd5e1; border-radius: 4px; font-size: 9px; font-weight: bold; color: %23334155; white-space: nowrap; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">${river.label}</span>` : ''}
                  </div>`,
            className: 'custom-river-icon',
            iconSize: [wPx, hPx],
            iconAnchor: [wPx / 2, hPx / 2]
        });

        const marker = L.marker(p, {
            icon: icon,
            draggable: true
        }).addTo(map);

        marker.on('dragend', (e) => {
            const newPos = e.target.getLatLng();
            river.lat = newPos.lat;
            river.lng = newPos.lng;
            drawCanvas(); // sync canvas
        });

        marker.on('click', (e) => {
            if (selectedTool === 'select') {
                L.DomEvent.stopPropagation(e);
                selectAnnotation('river', river);
            }
        });

        marker.on('dblclick', (e) => {
            L.DomEvent.stopPropagation(e);
            const display = river.label || 'River';
            if (confirm(`Do you want to delete the river "${display}"?`)) {
                annotations.rivers = annotations.rivers.filter(r => r !== river);
                clearSelection();
                renderMap();
                drawCanvas();
            }
        });

        mapMarkers.push(marker);
    });

    // Draw point Landmarks & irregular Ponds on geographical map
    annotations.landmarks.forEach(lan => {
        let marker = null;
        if (lan.type === 'pond') {
            const wPx = metersToPixels((lan.radius || 20) * 2, map.getZoom());
            const hPx = metersToPixels((lan.radius || 20) * 2, map.getZoom());

            const icon = L.divIcon({
                html: `<div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; position: relative;">
                        <img src="${SVG_POND}" style="width: 100%; height: 100%; object-fit: fill;" />
                        ${lan.label ? `<span class="lbl" style="position: absolute; bottom: -16px; background: rgba(255,255,255,0.95); padding: 1px 5px; border: 1px solid %23cbd5e1; border-radius: 4px; font-size: 9px; font-weight: bold; color: %23334155; white-space: nowrap; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">${lan.label}</span>` : ''}
                      </div>`,
                className: 'custom-pond-icon',
                iconSize: [wPx, hPx],
                iconAnchor: [wPx / 2, hPx / 2]
            });

            marker = L.marker([lan.lat, lan.lng], {
                icon: icon,
                draggable: true
            }).addTo(map);

            marker.on('click', (e) => {
                if (selectedTool === 'select') {
                    L.DomEvent.stopPropagation(e);
                    selectAnnotation('landmark', lan);
                }
            });
        } else {
            let emoji = '📍';
            switch (lan.type) {
                case 'tree': emoji = '🌲'; break;
                case 'temple': emoji = '🛕'; break;
                case 'mosque': emoji = '🕌'; break;
                case 'school': emoji = '🏫'; break;
                case 'house': emoji = '🏠'; break;
            }

            const size = lan.size || 24;
            const icon = L.divIcon({
                html: `<div class="map-landmark-icon" style="font-size: ${size}px;">
                        <span class="emoji">${emoji}</span>
                        ${lan.label ? `<span class="lbl">${lan.label}</span>` : ''}
                      </div>`,
                className: 'custom-landmark-icon',
                iconSize: [60, size + 16],
                iconAnchor: [30, size / 2]
            });

            marker = L.marker([lan.lat, lan.lng], {
                icon: icon,
                draggable: true
            }).addTo(map);

            marker.on('click', (e) => {
                if (selectedTool === 'select') {
                    L.DomEvent.stopPropagation(e);
                    selectAnnotation('landmark', lan);
                }
            });
        }

        marker.on('dragend', (e) => {
            const newPos = e.target.getLatLng();
            lan.lat = newPos.lat;
            lan.lng = newPos.lng;
            drawCanvas(); // sync canvas
        });

        marker.on('dblclick', (e) => {
            L.DomEvent.stopPropagation(e);
            const display = lan.label || lan.type;
            if (confirm(`Do you want to delete the landmark "${display}"?`)) {
                annotations.landmarks = annotations.landmarks.filter(l => l !== lan);
                clearSelection();
                renderMap();
                drawCanvas();
            }
        });

        mapMarkers.push(marker);
    });

    // Draw text Annotations on geographical map
    annotations.texts.forEach(ann => {
        const icon = L.divIcon({
            html: `<div class="map-text-annotation" style="font-size: ${ann.size || 15}px;">
                    ${ann.text}
                  </div>`,
            className: 'custom-text-icon',
            iconSize: [120, 24],
            iconAnchor: [60, 12]
        });

        const marker = L.marker([ann.lat, ann.lng], {
            icon: icon,
            draggable: true
        }).addTo(map);

        marker.on('dragend', (e) => {
            const newPos = e.target.getLatLng();
            ann.lat = newPos.lat;
            ann.lng = newPos.lng;
            drawCanvas(); // keep canvas synchronized
        });

        marker.on('click', (e) => {
            if (selectedTool === 'select') {
                L.DomEvent.stopPropagation(e);
                selectAnnotation('text', ann);
            }
        });

        marker.on('dblclick', (e) => {
            L.DomEvent.stopPropagation(e);
            if (confirm(`Do you want to delete the text label "${ann.text}"?`)) {
                annotations.texts = annotations.texts.filter(t => t !== ann);
                clearSelection();
                renderMap();
                drawCanvas();
            }
        });

        mapMarkers.push(marker);
    });

    // Zoom map view to contain the workspace poles
    const bounds = L.latLngBounds(latLngs);
    map.fitBounds(bounds, { padding: [40, 40] });
}

function onMapClick(e) {
    if (!surveyData) return;
    const latlng = e.latlng;

    // Handle click-to-place if a stencil is active
    if (selectedStencilType) {
        addStencilAnnotation(selectedStencilType, latlng.lat, latlng.lng);
        selectedStencilType = null;
        
        // Reset active stencil styling
        const items = document.querySelectorAll('.stencil-item');
        items.forEach(el => el.style.borderColor = '');
    }
}

function clearMapDrawingHelpers() {
    if (mapDrawingStartMarker) {
        map.removeLayer(mapDrawingStartMarker);
        mapDrawingStartMarker = null;
    }
    if (mapDrawingPreviewLine) {
        map.removeLayer(mapDrawingPreviewLine);
        mapDrawingPreviewLine = null;
    }
    mapDrawingStartPos = null;
}

// Recalculate span distance dynamically based on updated GPS coords (Haversine formula)
function recalculateSpans() {
    const nodesById = {};
    nodes.forEach(n => nodesById[n.id] = n);

    edges.forEach(edge => {
        const fromNode = nodesById[edge.from];
        const toNode = nodesById[edge.to];
        if (!fromNode || !toNode) return;

        const distanceM = haversine(
            fromNode.assetRef.latitude, fromNode.assetRef.longitude,
            toNode.assetRef.latitude, toNode.assetRef.longitude
        );
        edge.spanLengthM = distanceM;
        if (edge.assetRef) {
            edge.assetRef.spanLengthM = distanceM.toFixed(1);
        }
    });
}

function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000.0; // earth radius in metres
    const phi1 = lat1 * Math.PI / 180.0;
    const phi2 = lat2 * Math.PI / 180.0;
    const deltaPhi = (lat2 - lat1) * Math.PI / 180.0;
    const deltaLambda = (lon2 - lon1) * Math.PI / 180.0;

    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

// Convert geographic coordinates (latitude, longitude) to schematic grid coordinates (x, y)
function latLngToSchematic(lat, lng) {
    if (nodes.length === 0) return { x: 800, y: 550 };

    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;
    nodes.forEach(n => {
        const latRef = n.assetRef.latitude;
        const lngRef = n.assetRef.longitude;
        if (latRef < minLat) minLat = latRef;
        if (latRef > maxLat) maxLat = latRef;
        if (lngRef < minLng) minLng = lngRef;
        if (lngRef > maxLng) maxLng = lngRef;
    });

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    nodes.forEach(n => {
        if (n.x < minX) minX = n.x;
        if (n.x > maxX) maxX = n.x;
        if (n.y < minY) minY = n.y;
        if (n.y > maxY) maxY = n.y;
    });

    // Handle single-point surveys gracefully
    if (maxLat === minLat || maxLng === minLng || maxX === minX || maxY === minY) {
        return { x: 800, y: 550 };
    }

    // Normalize geographical coordinate
    const pctX = (lng - minLng) / (maxLng - minLng);
    const pctY = (maxLat - lat) / (maxLat - minLat); // Latitudes decrease going south, y-axis increases going down

    // Map to schematic canvas bounds
    const x = minX + pctX * (maxX - minX);
    const y = minY + pctY * (maxY - minY);

    return { x: Math.round(x), y: Math.round(y) };
}

// Convert schematic grid coordinates (x, y) back to geographic coordinates (latitude, longitude)
function schematicToLatLng(x, y) {
    if (nodes.length === 0) return { lat: 23.25, lng: 77.41 };

    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;
    nodes.forEach(n => {
        const latRef = n.assetRef.latitude;
        const lngRef = n.assetRef.longitude;
        if (latRef < minLat) minLat = latRef;
        if (latRef > maxLat) maxLat = latRef;
        if (lngRef < minLng) minLng = lngRef;
        if (lngRef > maxLng) maxLng = lngRef;
    });

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    nodes.forEach(n => {
        if (n.x < minX) minX = n.x;
        if (n.x > maxX) maxX = n.x;
        if (n.y < minY) minY = n.y;
        if (n.y > maxY) maxY = n.y;
    });

    const widthX = maxX - minX;
    const heightY = maxY - minY;

    if (widthX === 0 || heightY === 0) {
        return { lat: minLat, lng: minLng };
    }

    // Normalize schematic coordinate
    const pctX = (x - minX) / widthX;
    const pctY = (y - minY) / heightY;

    // Map back to lat/lng space
    const lng = minLng + pctX * (maxLng - minLng);
    const lat = maxLat - pctY * (maxLat - minLat);

    return { lat: lat, lng: lng };
}

/* ==========================================================================
   CAD Schematic Canvas Editor
   ========================================================================== */
function resetCanvasView() {
    zoomScale = 1.0;
    panX = 0;
    panY = 0;
}

function initToolbarEvents() {
    const btnSelect = document.getElementById('toolSelect');
    if (btnSelect) {
        btnSelect.addEventListener('click', () => {
            selectedTool = 'select';
            selectedStencilType = null;
            
            // Clear styling highlights from stencil items
            const items = document.querySelectorAll('.stencil-item');
            items.forEach(el => el.style.borderColor = '');
            
            btnSelect.classList.add('active');
            clearSelection();
            
            const help = document.getElementById('annotationHelp');
            help.textContent = 'Drag elements onto map/grid canvas, or click them to place. Use "Select & Resize" mode to move, rotate, and resize items.';
        });
    }

    // Canvas floating zoom buttons
    document.getElementById('btnZoomIn').addEventListener('click', () => {
        zoomScale = Math.min(zoomScale + 0.15, 3.0);
        drawCanvas();
    });

    document.getElementById('btnZoomOut').addEventListener('click', () => {
        zoomScale = Math.max(zoomScale - 0.15, 0.4);
        drawCanvas();
    });

    document.getElementById('btnResetView').addEventListener('click', () => {
        resetCanvasView();
        drawCanvas();
    });

    document.getElementById('btnClearAnnotations').addEventListener('click', () => {
        if (confirm('Are you sure you want to clear all road drawings, rivers, landmarks, and text labels?')) {
            annotations = { texts: [], roads: [], rivers: [], landmarks: [] };
            clearSelection();
            renderMap();
            drawCanvas();
        }
    });
}

// Convert screen mouse coordinate to canvas grid coordinates taking zoom & pan into account
function getGridCoords(e) {
    const rect = canvas.getBoundingClientRect();
    // Screen position relative to canvas element bounding box
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Apply zoom & pan translation inversion
    return {
        x: (x - panX) / zoomScale,
        y: (y - panY) / zoomScale
    };
}

// Helper to calculate distance from point (px, py) to line segment (x1, y1) - (x2, y2)
function distanceToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - x1, py - y1);
    
    let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t)); // clamp to segment
    
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

// Convert meters width/radius to canvas pixels based on pole coordinates spacing scale
function metersToCanvasPixels(meters) {
    if (nodes.length < 2) return meters * 2.0; // fallback 2 pixels per meter
    const n1 = nodes[0];
    const n2 = nodes[nodes.length - 1];
    const distGeographic = haversine(
        n1.assetRef.latitude, n1.assetRef.longitude,
        n2.assetRef.latitude, n2.assetRef.longitude
    );
    const distSchematic = Math.hypot(n1.x - n2.x, n1.y - n2.y);
    if (distGeographic === 0) return meters * 2.0;
    return meters * (distSchematic / distGeographic);
}

// Convert meters width/radius to map pixels based on current Leaflet zoom level
function metersToPixels(meters, zoom) {
    const lat = nodes.length ? nodes[0].assetRef.latitude : 23.25;
    // Standard Leaflet meters per pixel approximation
    const metersPerPixel = (156543.03392 * Math.cos(lat * Math.PI / 180)) / Math.pow(2, zoom);
    return Math.max(4, meters / metersPerPixel);
}

function initCanvasEvents() {
    canvas.addEventListener('mousedown', (e) => {
        if (!surveyData) return;
        const gridPos = getGridCoords(e);
        clickStartPos = { x: e.clientX, y: e.clientY };

        if (selectedTool === 'select') {
            // 1. Check if clicking a landmark annotation
            let clickedLandmark = null;
            annotations.landmarks.forEach((lan, idx) => {
                const p = latLngToSchematic(lan.lat, lan.lng);
                const dist = Math.hypot(p.x - gridPos.x, p.y - gridPos.y);
                const threshold = lan.type === 'pond' ? Math.max(20, metersToCanvasPixels(lan.radius || 20)) : 20;
                if (dist <= threshold) {
                    clickedLandmark = lan;
                }
            });

            if (clickedLandmark) {
                draggedLandmark = clickedLandmark;
                selectAnnotation('landmark', clickedLandmark);
                return;
            }

            // 2. Check if clicking a text annotation
            let clickedText = null;
            annotations.texts.forEach((ann, idx) => {
                const p = latLngToSchematic(ann.lat, ann.lng);
                const textWidth = ctx.measureText(ann.text).width;
                const textHeight = ann.size || 14;
                if (gridPos.x >= p.x - textWidth / 2 - 5 && gridPos.x <= p.x + textWidth / 2 + 5 &&
                    gridPos.y >= p.y - textHeight - 2 && gridPos.y <= p.y + 5) {
                    clickedText = ann;
                }
            });

            if (clickedText) {
                draggedText = clickedText;
                selectAnnotation('text', clickedText);
                return;
            }

            // 3. Check if clicking a road bounding box
            let clickedRoad = null;
            annotations.roads.forEach(road => {
                const p = latLngToSchematic(road.lat, road.lng);
                const wPx = metersToCanvasPixels(road.width || 40);
                const hPx = metersToCanvasPixels(road.height || 40);
                if (gridPos.x >= p.x - wPx / 2 && gridPos.x <= p.x + wPx / 2 &&
                    gridPos.y >= p.y - hPx / 2 && gridPos.y <= p.y + hPx / 2) {
                    clickedRoad = road;
                }
            });

            if (clickedRoad) {
                draggedRoad = clickedRoad;
                selectAnnotation('road', clickedRoad);
                return;
            }

            // 4. Check if clicking a river bounding box
            let clickedRiver = null;
            annotations.rivers.forEach(river => {
                const p = latLngToSchematic(river.lat, river.lng);
                const wPx = metersToCanvasPixels(river.width || 40);
                const hPx = metersToCanvasPixels(river.height || 40);
                if (gridPos.x >= p.x - wPx / 2 && gridPos.x <= p.x + wPx / 2 &&
                    gridPos.y >= p.y - hPx / 2 && gridPos.y <= p.y + hPx / 2) {
                    clickedRiver = river;
                }
            });

            if (clickedRiver) {
                draggedRiver = clickedRiver;
                selectAnnotation('river', clickedRiver);
                return;
            }

            // 5. Check if clicking a pole node
            let clickedNode = null;
            nodes.forEach(node => {
                const dist = Math.hypot(node.x - gridPos.x, node.y - gridPos.y);
                if (dist <= 18) {
                    clickedNode = node;
                }
            });

            if (clickedNode) {
                draggedNode = clickedNode;
            } else {
                // If clicked empty grid, initiate panning
                isPanning = true;
                startPanX = e.clientX - panX;
                startPanY = e.clientY - panY;
            }
        } else if (selectedTool === 'road' || selectedTool === 'river') {
            drawingStartPos = gridPos;
        } else if (selectedTool === 'landmark') {
            const type = document.getElementById('landmarkType').value;
            const label = document.getElementById('landmarkLabel').value.trim();
            const latlng = schematicToLatLng(gridPos.x, gridPos.y);
            annotations.landmarks.push({
                lat: latlng.lat,
                lng: latlng.lng,
                type: type,
                label: label
            });
            document.getElementById('landmarkLabel').value = ''; // Reset input after dropping
            renderMap();
            drawCanvas();
        }
    });

    canvas.addEventListener('mousemove', (e) => {
        if (!surveyData) return;

        if (isPanning) {
            panX = e.clientX - startPanX;
            panY = e.clientY - startPanY;
            drawCanvas();
        } else if (draggedNode) {
            const gridPos = getGridCoords(e);
            draggedNode.x = gridPos.x;
            draggedNode.y = gridPos.y;
            drawCanvas();
        } else if (draggedText) {
            const gridPos = getGridCoords(e);
            const latlng = schematicToLatLng(gridPos.x, gridPos.y);
            draggedText.lat = latlng.lat;
            draggedText.lng = latlng.lng;
            renderMap(); // keep map synced
            drawCanvas();
        } else if (draggedLandmark) {
            const gridPos = getGridCoords(e);
            const latlng = schematicToLatLng(gridPos.x, gridPos.y);
            draggedLandmark.lat = latlng.lat;
            draggedLandmark.lng = latlng.lng;
            renderMap(); // keep map synced
            drawCanvas();
        } else if (draggedRoad) {
            const gridPos = getGridCoords(e);
            const latlng = schematicToLatLng(gridPos.x, gridPos.y);
            draggedRoad.lat = latlng.lat;
            draggedRoad.lng = latlng.lng;
            renderMap();
            drawCanvas();
        } else if (draggedRiver) {
            const gridPos = getGridCoords(e);
            const latlng = schematicToLatLng(gridPos.x, gridPos.y);
            draggedRiver.lat = latlng.lat;
            draggedRiver.lng = latlng.lng;
            renderMap();
            drawCanvas();
        } else if (drawingStartPos && (selectedTool === 'road' || selectedTool === 'river')) {
            // Redraw canvas with temporary indicator line
            drawCanvas();
            const currentGridPos = getGridCoords(e);
            
            // Draw temporary helper line
            ctx.save();
            ctx.translate(panX, panY);
            ctx.scale(zoomScale, zoomScale);
            ctx.strokeStyle = selectedTool === 'road' ? '#cbd5e1' : '#93c5fd';
            ctx.lineWidth = 24;
            ctx.lineCap = 'round';
            ctx.globalAlpha = 0.4;
            ctx.beginPath();
            ctx.moveTo(drawingStartPos.x, drawingStartPos.y);
            ctx.lineTo(currentGridPos.x, currentGridPos.y);
            ctx.stroke();
            ctx.restore();
        }
    });

    window.addEventListener('mouseup', (e) => {
        if (isPanning) {
            isPanning = false;
        }

        if (draggedNode) {
            // Update node reference for save
            if (draggedNode.assetRef) {
                draggedNode.assetRef.x = Math.round(draggedNode.x);
                draggedNode.assetRef.y = Math.round(draggedNode.y);
            }
            draggedNode = null;
        }

        if (draggedText) {
            draggedText = null;
        }

        if (draggedLandmark) {
            draggedLandmark = null;
        }

        if (draggedRoad) {
            draggedRoad = null;
        }

        if (draggedRiver) {
            draggedRiver = null;
        }

        if (drawingStartPos) {
            const gridPos = getGridCoords(e);
            const dist = Math.hypot(gridPos.x - drawingStartPos.x, gridPos.y - drawingStartPos.y);

            // Verify they dragged a meaningful segment length
            if (dist > 15) {
                const c1 = schematicToLatLng(drawingStartPos.x, drawingStartPos.y);
                const c2 = schematicToLatLng(gridPos.x, gridPos.y);
                if (selectedTool === 'road') {
                    annotations.roads.push({
                        lat1: c1.lat,
                        lng1: c1.lng,
                        lat2: c2.lat,
                        lng2: c2.lng
                    });
                } else if (selectedTool === 'river') {
                    annotations.rivers.push({
                        lat1: c1.lat,
                        lng1: c1.lng,
                        lat2: c2.lat,
                        lng2: c2.lng
                    });
                }
                renderMap();
            }
            drawingStartPos = null;
            drawCanvas();
        }
    });

    // Double click to add labels or edit pole attributes / delete items
    canvas.addEventListener('dblclick', (e) => {
        if (!surveyData) return;
        const gridPos = getGridCoords(e);

        if (selectedTool === 'select') {
            // 1. Check if clicked a landmark annotation (Double click to delete)
            let clickedLandmark = null;
            annotations.landmarks.forEach((lan) => {
                const p = latLngToSchematic(lan.lat, lan.lng);
                const dist = Math.hypot(p.x - gridPos.x, p.y - gridPos.y);
                const threshold = lan.type === 'pond' ? Math.max(20, metersToCanvasPixels(lan.radius || 20)) : 20;
                if (dist <= threshold) {
                    clickedLandmark = lan;
                }
            });

            if (clickedLandmark) {
                const display = clickedLandmark.label || clickedLandmark.type;
                if (confirm(`Do you want to delete the landmark "${display}"?`)) {
                    annotations.landmarks = annotations.landmarks.filter(l => l !== clickedLandmark);
                    clearSelection();
                    renderMap();
                    drawCanvas();
                }
                return;
            }

            // 2. Check if clicked a text annotation (Double click to delete)
            let clickedText = null;
            annotations.texts.forEach((ann) => {
                const p = latLngToSchematic(ann.lat, ann.lng);
                const textWidth = ctx.measureText(ann.text).width;
                const textHeight = ann.size || 14;
                if (gridPos.x >= p.x - textWidth / 2 - 5 && gridPos.x <= p.x + textWidth / 2 + 5 &&
                    gridPos.y >= p.y - textHeight - 2 && gridPos.y <= p.y + 5) {
                    clickedText = ann;
                }
            });

            if (clickedText) {
                if (confirm(`Do you want to delete the text label "${clickedText.text}"?`)) {
                    annotations.texts = annotations.texts.filter(t => t !== clickedText);
                    clearSelection();
                    renderMap();
                    drawCanvas();
                }
                return;
            }

            // 3. Check if clicked a road (Double click to delete)
            let clickedRoad = null;
            annotations.roads.forEach(road => {
                const p = latLngToSchematic(road.lat, road.lng);
                const wPx = metersToCanvasPixels(road.width || 40);
                const hPx = metersToCanvasPixels(road.height || 40);
                if (gridPos.x >= p.x - wPx / 2 && gridPos.x <= p.x + wPx / 2 &&
                    gridPos.y >= p.y - hPx / 2 && gridPos.y <= p.y + hPx / 2) {
                    clickedRoad = road;
                }
            });

            if (clickedRoad) {
                const display = clickedRoad.label || 'Road';
                if (confirm(`Do you want to delete the road "${display}"?`)) {
                    annotations.roads = annotations.roads.filter(r => r !== clickedRoad);
                    clearSelection();
                    renderMap();
                    drawCanvas();
                }
                return;
            }

            // 4. Check if clicked a river (Double click to delete)
            let clickedRiver = null;
            annotations.rivers.forEach(river => {
                const p = latLngToSchematic(river.lat, river.lng);
                const wPx = metersToCanvasPixels(river.width || 40);
                const hPx = metersToCanvasPixels(river.height || 40);
                if (gridPos.x >= p.x - wPx / 2 && gridPos.x <= p.x + wPx / 2 &&
                    gridPos.y >= p.y - hPx / 2 && gridPos.y <= p.y + hPx / 2) {
                    clickedRiver = river;
                }
            });

            if (clickedRiver) {
                const display = clickedRiver.label || 'River';
                if (confirm(`Do you want to delete the river "${display}"?`)) {
                    annotations.rivers = annotations.rivers.filter(r => r !== clickedRiver);
                    clearSelection();
                    renderMap();
                    drawCanvas();
                }
                return;
            }

            // 5. Check if double clicked on a node
            let clickedNode = null;
            nodes.forEach(node => {
                const dist = Math.hypot(node.x - gridPos.x, node.y - gridPos.y);
                if (dist <= 18) {
                    clickedNode = node;
                }
            });

            if (clickedNode) {
            openEditModal(clickedNode);
            }
        } else if (selectedTool === 'text') {
            // Open Text dialog
            openTextModal(gridPos.x, gridPos.y, false);
        }
    });
}

// Drawing core canvas elements
function drawCanvas() {
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    
    // Apply panning and zoom modifications
    ctx.translate(panX, panY);
    ctx.scale(zoomScale, zoomScale);

    // 1. Draw grid background lines
    drawGridPattern();

    // 2. Draw irregular roads
    annotations.roads.forEach(road => {
        const p = latLngToSchematic(road.lat, road.lng);
        const wPx = metersToCanvasPixels(road.width || 40);
        const hPx = metersToCanvasPixels(road.height || 40);

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((road.angle || 0) * Math.PI / 180);
        ctx.drawImage(imgCache.road, -wPx / 2, -hPx / 2, wPx, hPx);
        ctx.restore();

        if (road.label && road.label.trim()) {
            ctx.fillStyle = '#475569';
            ctx.font = 'bold 10px Inter';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(road.label, p.x, p.y + hPx / 2 + 4);
        }
    });

    // 3. Draw winding rivers
    annotations.rivers.forEach(river => {
        const p = latLngToSchematic(river.lat, river.lng);
        const wPx = metersToCanvasPixels(river.width || 40);
        const hPx = metersToCanvasPixels(river.height || 40);

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((river.angle || 0) * Math.PI / 180);
        ctx.drawImage(imgCache.river, -wPx / 2, -hPx / 2, wPx, hPx);
        ctx.restore();

        if (river.label && river.label.trim()) {
            ctx.fillStyle = '#475569';
            ctx.font = 'bold 10px Inter';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(river.label, p.x, p.y + hPx / 2 + 4);
        }
    });

    // 4. Draw edge connections
    const nodesById = {};
    nodes.forEach(n => nodesById[n.id] = n);

    edges.forEach(edge => {
        const fromNode = nodesById[edge.from];
        const toNode = nodesById[edge.to];
        if (!fromNode || !toNode) return;

        // Match voltage coloring (Red, Yellow/Orange, Green)
        let strokeColor = '#22c55e'; // LT: green
        if (edge.voltage === '33kV') {
            strokeColor = '#ef4444'; // 33kV: red
        } else if (edge.voltage === '11kV') {
            strokeColor = '#f97316'; // 11kV: orange
        }

        const isDashed = edge.status.toLowerCase() === 'proposed';

        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 4;
        if (isDashed) {
            ctx.setLineDash([8, 6]);
        }
        ctx.beginPath();
        ctx.moveTo(fromNode.x, fromNode.y);
        ctx.lineTo(toNode.x, toNode.y);
        ctx.stroke();
        ctx.setLineDash([]); // Reset dash

        // Draw span label text at the midpoint of line segment
        const midX = (fromNode.x + toNode.x) / 2;
        const midY = (fromNode.y + toNode.y) / 2;

        const preset = getPresetDisplayOptions();
        const spanText = formatDistance(edge.spanLengthM, preset.unit, preset.decimals);

        ctx.fillStyle = '#1e293b';
        ctx.font = 'bold 11px Inter';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Draw text background bubble box for readability
        const textWidth = ctx.measureText(spanText).width;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.fillRect(midX - textWidth / 2 - 4, midY - 8, textWidth + 8, 16);
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(midX - textWidth / 2 - 4, midY - 8, textWidth + 8, 16);

        ctx.fillStyle = '#475569';
        ctx.fillText(spanText, midX, midY);
    });

    // 5. Draw nodes (poles)
    nodes.forEach(node => {
        const isExisting = node.assetRef?.status?.toLowerCase() === 'existing';
        
        // Main circle drop shadow/glow
        ctx.shadowColor = 'rgba(15, 23, 42, 0.08)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetY = 2;

        // Draw outer ring
        ctx.fillStyle = isExisting ? '#2563eb' : '#f97316'; // Blue for existing, orange for proposed
        ctx.beginPath();
        ctx.arc(node.x, node.y, 16, 0, 2 * Math.PI);
        ctx.fill();

        // Clear shadow for interior text
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;

        // Draw inner body circle
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(node.x, node.y, 13, 0, 2 * Math.PI);
        ctx.fill();

        // Draw structure type text inside the circle (e.g. 1P, DTR)
        ctx.fillStyle = isExisting ? '#1e40af' : '#c2410c';
        ctx.font = 'bold 10px Outfit';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(node.structure, node.x, node.y + 0.5);

        // Draw pole labels text (Sequence title e.g. P-01) below the node
        ctx.fillStyle = '#1e293b';
        ctx.font = 'bold 11px Inter';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(node.label, node.x, node.y + 20);

        // If remarks are present, render a small info indicator icon or prefix text
        if (node.remarks.trim()) {
            ctx.fillStyle = '#64748b';
            ctx.font = 'italic 9px Inter';
            // Truncated remarks
            const remText = node.remarks.length > 15 ? node.remarks.substring(0, 12) + '...' : node.remarks;
            ctx.fillText(remText, node.x, node.y + 34);
        }
    });

    // 6. Draw custom text annotations
    annotations.texts.forEach(ann => {
        const p = latLngToSchematic(ann.lat, ann.lng);
        ctx.fillStyle = '#334155';
        ctx.font = `bold ${ann.size || 15}px Outfit`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(ann.text, p.x, p.y);
    });

    // 7. Draw custom point landmarks & Ponds
    annotations.landmarks.forEach(lan => {
        const p = latLngToSchematic(lan.lat, lan.lng);
        if (lan.type === 'pond') {
            const rPx = metersToCanvasPixels(lan.radius || 20);
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.drawImage(imgCache.pond, -rPx, -rPx, rPx * 2, rPx * 2);
            ctx.restore();

            if (lan.label && lan.label.trim()) {
                ctx.fillStyle = '#475569';
                ctx.font = 'bold 10px Inter';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                ctx.fillText(lan.label, p.x, p.y + rPx + 4);
            }
            return;
        }

        let emoji = '📍';
        switch (lan.type) {
            case 'tree': emoji = '🌲'; break;
            case 'temple': emoji = '🛕'; break;
            case 'mosque': emoji = '🕌'; break;
            case 'school': emoji = '🏫'; break;
            case 'house': emoji = '🏠'; break;
        }

        const size = lan.size || 24;
        ctx.font = `${size}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(emoji, p.x, p.y);

        if (lan.label && lan.label.trim()) {
            ctx.fillStyle = '#475569';
            ctx.font = 'bold 10px Inter';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(lan.label, p.x, p.y + size / 2 + 4);
        }
    });

    ctx.restore();
}

function drawGridPattern() {
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 0.5;

    // Draw horizontal grid lines
    for (let y = 0; y < canvas.height; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
    }

    // Draw vertical grid lines
    for (let x = 0; x < canvas.width; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
    }
}

/* ==========================================================================
   Modal dialogs Event Binding
   ========================================================================== */
function initModalEvents() {
    // Edit attributes modal cancel/save
    const editModal = document.getElementById('editModal');
    document.getElementById('modalCancel').addEventListener('click', () => {
        editModal.classList.add('hidden');
        activeEditNode = null;
    });

    document.getElementById('modalSave').addEventListener('click', () => {
        if (!activeEditNode) return;

        const struct = document.getElementById('editStructure').value;
        const mat = document.getElementById('editMaterial').value;
        const rem = document.getElementById('editRemarks').value;

        // Save back to memory model
        activeEditNode.structure = struct;
        activeEditNode.material = mat;
        activeEditNode.remarks = rem;

        // Save to parent reference
        if (activeEditNode.assetRef) {
            activeEditNode.assetRef.structure = struct;
            activeEditNode.assetRef.poleStructure = getStructureEnum(struct);
            activeEditNode.assetRef.poleMaterial = mat;
            activeEditNode.assetRef.remarks = rem;
        }

        editModal.classList.add('hidden');
        activeEditNode = null;

        // Redraw
        if (activeView === 'map') {
            renderMap();
        } else {
            drawCanvas();
        }
    });

    // Text modal cancel/confirm
    const textModal = document.getElementById('textModal');
    let textModalCallback = null;

    window.openTextModal = (x, y, isMap = false, lat = null, lng = null) => {
        document.getElementById('textInput').value = '';
        textModal.classList.remove('hidden');
        document.getElementById('textInput').focus();

        textModalCallback = (text, size) => {
            if (isMap) {
                annotations.texts.push({
                    lat: lat,
                    lng: lng,
                    text: text,
                    size: size
                });
                renderMap();
            } else {
                const latlng = schematicToLatLng(x, y);
                annotations.texts.push({
                    lat: latlng.lat,
                    lng: latlng.lng,
                    text: text,
                    size: size
                });
            }
            drawCanvas();
        };
    };

    document.getElementById('textModalCancel').addEventListener('click', () => {
        textModal.classList.add('hidden');
        textModalCallback = null;
    });

    document.getElementById('textModalConfirm').addEventListener('click', () => {
        const textVal = document.getElementById('textInput').value.trim();
        const sizeVal = parseInt(document.getElementById('textSizeInput').value);

        if (textVal && textModalCallback) {
            textModalCallback(textVal, sizeVal);
        }
        textModal.classList.add('hidden');
        textModalCallback = null;
    });
}

function openEditModal(node) {
    activeEditNode = node;
    document.getElementById('editLabel').value = node.label;
    document.getElementById('editStructure').value = node.structure;
    document.getElementById('editMaterial').value = node.material;
    document.getElementById('editRemarks').value = node.remarks;

    document.getElementById('editModal').classList.remove('hidden');
}

// Convert structures string labels back into android database enum format
function getStructureEnum(label) {
    switch (label) {
        case '2P': return 'P2';
        case '3P': return 'P3';
        case '4P': return 'P4';
        case 'DTR': return 'DTR';
        default: return 'P1';
    }
}

/* ==========================================================================
   Export Events & Data Synthesis
   ========================================================================== */
function initExportEvents() {
    // Save JSON Button click
    document.getElementById('btnSaveJson').addEventListener('click', () => {
        if (!surveyData) return;

        // Synchronize drawing coordinates and annotations into surveyData object
        const syncedAssets = surveyData.assets.map(asset => {
            const memoryNode = nodes.find(n => n.id === asset.id);
            if (memoryNode) {
                return {
                    ...asset,
                    latitude: memoryNode.assetRef.latitude,
                    longitude: memoryNode.assetRef.longitude,
                    poleStructure: getStructureEnum(memoryNode.structure),
                    structure: memoryNode.structure,
                    poleMaterial: memoryNode.material,
                    remarks: memoryNode.remarks,
                    x: Math.round(memoryNode.x),
                    y: Math.round(memoryNode.y)
                };
            }
            return asset;
        });

        // Construct final synthesized JSON object
        const outputJson = {
            ...surveyData,
            assets: syncedAssets,
            annotations: annotations
        };

        // Trigger local file download directly in browser
        const jsonStr = JSON.stringify(outputJson, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `workspace_${surveyData.surveyId}_edited.json`;
        document.body.appendChild(a);
        a.click();
        
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });

    // Print PDF Button Click
    document.getElementById('btnPrintPdf').addEventListener('click', () => {
        // Toggle view to Grid before printing so the canvas draws
        if (activeView !== 'grid') {
            document.getElementById('btnViewGrid').click();
            setTimeout(() => {
                window.print();
            }, 300);
        } else {
            window.print();
        }
    });
}

/* ==========================================================================
   Active Selection Annotation Editor & Resizer
   ========================================================================== */
let activeSelection = null;

function selectAnnotation(type, data) {
    activeSelection = { type, data };

    const card = document.getElementById('selectionCard');
    const typeLabel = document.getElementById('selectionTypeLabel');
    const labelInput = document.getElementById('selectionLabel');
    const sizeGroup = document.getElementById('selectionSizeGroup');
    const sizeLabel = document.getElementById('selectionSizeLabel');
    const slider = document.getElementById('selectionSizeSlider');
    const valDisplay = document.getElementById('selectionSizeValue');
    const rotateGroup = document.getElementById('selectionRotateGroup');
    const rotateSlider = document.getElementById('selectionRotateSlider');
    const rotateVal = document.getElementById('selectionRotateValue');

    card.classList.remove('hidden');

    let typeName = type.charAt(0).toUpperCase() + type.slice(1);
    if (type === 'landmark') {
        typeName = data.type === 'pond' ? 'Pond Shape' : `Landmark (${data.type})`;
    }
    typeLabel.textContent = `Selected ${typeName}`;
    labelInput.value = data.label || data.text || '';

    // Configure sizing controls
    sizeGroup.classList.remove('hidden');
    rotateGroup.classList.add('hidden');

    if (type === 'road' || type === 'river') {
        sizeLabel.textContent = 'Scale/Width (meters)';
        slider.min = 10;
        slider.max = 200;
        slider.value = data.width || 40;
        valDisplay.textContent = `${slider.value}m`;

        // Show rotation
        rotateGroup.classList.remove('hidden');
        rotateSlider.value = data.angle || 0;
        rotateVal.textContent = `${rotateSlider.value}°`;
    } else if (type === 'landmark' && data.type === 'pond') {
        sizeLabel.textContent = 'Pond Radius (meters)';
        slider.min = 5;
        slider.max = 150;
        slider.value = data.radius || 20;
        valDisplay.textContent = `${slider.value}m`;
    } else if (type === 'landmark') {
        sizeLabel.textContent = 'Icon Scale (px)';
        slider.min = 16;
        slider.max = 48;
        slider.value = data.size || 24;
        valDisplay.textContent = `${slider.value}px`;
    } else if (type === 'text') {
        sizeLabel.textContent = 'Font Size (px)';
        slider.min = 10;
        slider.max = 60;
        slider.value = data.size || 15;
        valDisplay.textContent = `${slider.value}px`;
    } else {
        sizeGroup.classList.add('hidden');
    }
}

function clearSelection() {
    activeSelection = null;
    const selectionCard = document.getElementById('selectionCard');
    if (selectionCard) {
        selectionCard.classList.add('hidden');
    }
}

function initSelectionEvents() {
    const labelInput = document.getElementById('selectionLabel');
    const slider = document.getElementById('selectionSizeSlider');
    const valDisplay = document.getElementById('selectionSizeValue');
    const rotateSlider = document.getElementById('selectionRotateSlider');
    const rotateVal = document.getElementById('selectionRotateValue');
    const btnDelete = document.getElementById('btnDeleteSelection');
    const btnClose = document.getElementById('btnDeselect');

    labelInput.addEventListener('input', () => {
        if (!activeSelection) return;
        const { type, data } = activeSelection;
        if (type === 'text') {
            data.text = labelInput.value;
        } else {
            data.label = labelInput.value;
        }
        renderMap();
        drawCanvas();
    });

    slider.addEventListener('input', () => {
        if (!activeSelection) return;
        const { type, data } = activeSelection;
        const val = parseInt(slider.value);

        if (type === 'road' || type === 'river') {
            data.width = val;
            data.height = val; // proportional scale
            valDisplay.textContent = `${val}m`;
        } else if (type === 'landmark' && data.type === 'pond') {
            data.radius = val;
            valDisplay.textContent = `${val}m`;
        } else if (type === 'landmark') {
            data.size = val;
            valDisplay.textContent = `${val}px`;
        } else if (type === 'text') {
            data.size = val;
            valDisplay.textContent = `${val}px`;
        }
        renderMap();
        drawCanvas();
    });

    rotateSlider.addEventListener('input', () => {
        if (!activeSelection) return;
        const { type, data } = activeSelection;
        if (type === 'road' || type === 'river') {
            const val = parseInt(rotateSlider.value);
            data.angle = val;
            rotateVal.textContent = `${val}°`;
            renderMap();
            drawCanvas();
        }
    });

    btnDelete.addEventListener('click', () => {
        if (!activeSelection) return;
        const { type, data } = activeSelection;
        
        if (type === 'road') {
            annotations.roads = annotations.roads.filter(r => r !== data);
        } else if (type === 'river') {
            annotations.rivers = annotations.rivers.filter(r => r !== data);
        } else if (type === 'text') {
            annotations.texts = annotations.texts.filter(t => t !== data);
        } else if (type === 'landmark') {
            annotations.landmarks = annotations.landmarks.filter(l => l !== data);
        }

        clearSelection();
        renderMap();
        drawCanvas();
    });

    btnClose.addEventListener('click', () => {
        clearSelection();
    });
}

/* ==========================================================================
   Stencil Drag and Drop Events & Handlers
   ========================================================================== */
function initStencilDragListeners() {
    const items = document.querySelectorAll('.stencil-item');
    items.forEach(item => {
        item.addEventListener('dragstart', (e) => {
            const type = item.getAttribute('data-type');
            e.dataTransfer.setData('text/plain', type);
            // Highlight stencil
            item.style.borderColor = 'var(--primary-color)';
        });

        item.addEventListener('dragend', () => {
            item.style.borderColor = '';
        });

        // Click to add template directly to center of layout
        item.addEventListener('click', () => {
            const type = item.getAttribute('data-type');
            
            // Set clicked stencil state to enable click-to-place on map/canvas
            selectedStencilType = type;
            items.forEach(el => el.style.borderColor = '');
            item.style.borderColor = 'var(--primary-color)';
            
            // Show notification help bubble
            const help = document.getElementById('annotationHelp');
            help.textContent = `Click anywhere on the map/grid canvas to place the ${type.toUpperCase()}, or drag it directly!`;
        });
    });

    // Hook drop listeners on map view and grid canvas wrapper
    const mapView = document.getElementById('mapView');
    const canvasView = document.getElementById('sldCanvas');

    // Map View drop
    mapView.addEventListener('dragover', (e) => {
        e.preventDefault();
    });

    mapView.addEventListener('drop', (e) => {
        e.preventDefault();
        if (!surveyData) return;
        const type = e.dataTransfer.getData('text/plain');
        if (!type) return;

        const rect = mapView.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const latlng = map.containerPointToLatLng([x, y]);

        addStencilAnnotation(type, latlng.lat, latlng.lng);
    });

    // Canvas View drop
    canvasView.addEventListener('dragover', (e) => {
        e.preventDefault();
    });

    canvasView.addEventListener('drop', (e) => {
        e.preventDefault();
        if (!surveyData) return;
        const type = e.dataTransfer.getData('text/plain');
        if (!type) return;

        const gridPos = getGridCoords(e);
        const latlng = schematicToLatLng(gridPos.x, gridPos.y);

        addStencilAnnotation(type, latlng.lat, latlng.lng);
    });
}

function addStencilAnnotation(type, lat, lng) {
    const id = Date.now().toString();
    let placedItem = null;

    if (type === 'road') {
        placedItem = { id, lat, lng, width: 60, height: 60, angle: 0, label: '' };
        annotations.roads.push(placedItem);
    } else if (type === 'river') {
        placedItem = { id, lat, lng, width: 60, height: 60, angle: 0, label: '' };
        annotations.rivers.push(placedItem);
    } else if (type === 'pond') {
        placedItem = { id, lat, lng, type: 'pond', radius: 25, label: '' };
        annotations.landmarks.push(placedItem);
    } else if (type === 'text') {
        placedItem = { lat, lng, text: 'Text Label', size: 16 };
        annotations.texts.push(placedItem);
    } else {
        // Tree, temple, mosque, school, house point landmarks
        placedItem = { id, lat, lng, type, size: 24, label: '' };
        annotations.landmarks.push(placedItem);
    }

    renderMap();
    drawCanvas();

    // Select the new annotation so user sees handles instantly
    if (type === 'road') {
        selectAnnotation('road', placedItem);
    } else if (type === 'river') {
        selectAnnotation('river', placedItem);
    } else if (type === 'pond') {
        selectAnnotation('landmark', placedItem);
    } else if (type === 'text') {
        selectAnnotation('text', placedItem);
    } else {
        selectAnnotation('landmark', placedItem);
    }
}
