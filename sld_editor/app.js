/**
 * SLM Survey Desktop CAD Editor
 * Core Application Logic
 */

// Google Maps–style CAD symbols (soft road / water colors)
function svgDataUrl(svgMarkup) {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgMarkup);
}

// Pale asphalt road with soft curb + dashed center (Maps road look)
const SVG_ROAD = svgDataUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
        <path d="M8,62 C28,28 42,88 60,58 C78,28 92,78 112,52" fill="none" stroke="#c8c4bc" stroke-width="22" stroke-linecap="round"/>
        <path d="M8,62 C28,28 42,88 60,58 C78,28 92,78 112,52" fill="none" stroke="#f5f3ef" stroke-width="16" stroke-linecap="round"/>
        <path d="M8,62 C28,28 42,88 60,58 C78,28 92,78 112,52" fill="none" stroke="#ffffff" stroke-width="1.4" stroke-dasharray="5 7" stroke-linecap="round" opacity="0.9"/>
    </svg>`
);
// Soft Maps water ribbon (muted cyan, no neon)
const SVG_RIVER = svgDataUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
        <path d="M6,95 C22,70 30,78 48,55 C66,32 78,42 96,22 C104,14 110,18 114,28"
              fill="none" stroke="#7eb6d4" stroke-width="18" stroke-linecap="round" opacity="0.45"/>
        <path d="M6,95 C22,70 30,78 48,55 C66,32 78,42 96,22 C104,14 110,18 114,28"
              fill="none" stroke="#aadaff" stroke-width="12" stroke-linecap="round"/>
        <path d="M6,95 C22,70 30,78 48,55 C66,32 78,42 96,22 C104,14 110,18 114,28"
              fill="none" stroke="#c5e7f8" stroke-width="4" stroke-linecap="round" opacity="0.7"/>
    </svg>`
);
// Soft Maps lake / pond (flat #aadaff water fill)
const SVG_POND = svgDataUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
        <path d="M22,58 C26,28 48,22 68,30 C92,40 102,52 98,72 C94,94 72,102 48,96 C24,90 18,78 22,58 Z"
              fill="#aadaff" stroke="#8ec4e0" stroke-width="1.5"/>
        <path d="M38,52 C44,40 58,38 70,44" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" opacity="0.35"/>
    </svg>`
);

const imgCache = {};
function initImageCache() {
    const onReady = () => {
        if (surveyData) drawCanvas();
    };
    ['road', 'river', 'pond'].forEach((key) => {
        const img = new Image();
        img.onload = onReady;
        img.src = key === 'road' ? SVG_ROAD : key === 'river' ? SVG_RIVER : SVG_POND;
        imgCache[key] = img;
    });
}

/** Canvas fallback matching Google Maps soft road / water look. */
function drawShapeSymbol(type, w, h) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (type === 'road') {
        ctx.beginPath();
        ctx.moveTo(-w * 0.42, h * 0.05);
        ctx.bezierCurveTo(-w * 0.2, -h * 0.28, -w * 0.05, h * 0.28, w * 0.05, -h * 0.02);
        ctx.bezierCurveTo(w * 0.2, -h * 0.32, w * 0.28, h * 0.22, w * 0.42, -h * 0.05);
        ctx.lineWidth = Math.max(4, Math.min(w, h) * 0.22);
        ctx.strokeStyle = '#c8c4bc';
        ctx.stroke();
        ctx.lineWidth = Math.max(3, Math.min(w, h) * 0.16);
        ctx.strokeStyle = '#f5f3ef';
        ctx.stroke();
        ctx.setLineDash([5, 7]);
        ctx.lineWidth = Math.max(1, Math.min(w, h) * 0.02);
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.stroke();
        ctx.setLineDash([]);
    } else if (type === 'river') {
        ctx.beginPath();
        ctx.moveTo(-w * 0.42, h * 0.35);
        ctx.bezierCurveTo(-w * 0.2, h * 0.05, -w * 0.05, h * 0.15, w * 0.05, -h * 0.05);
        ctx.bezierCurveTo(w * 0.2, -h * 0.28, w * 0.28, -h * 0.15, w * 0.42, -h * 0.32);
        ctx.lineWidth = Math.max(5, Math.min(w, h) * 0.2);
        ctx.strokeStyle = 'rgba(126,182,212,0.45)';
        ctx.stroke();
        ctx.lineWidth = Math.max(3, Math.min(w, h) * 0.13);
        ctx.strokeStyle = '#aadaff';
        ctx.stroke();
        ctx.lineWidth = Math.max(1.5, Math.min(w, h) * 0.05);
        ctx.strokeStyle = 'rgba(197,231,248,0.75)';
        ctx.stroke();
    } else if (type === 'pond') {
        const r = Math.min(w, h) / 2;
        ctx.beginPath();
        ctx.moveTo(-r * 0.65, -r * 0.05);
        ctx.bezierCurveTo(-r * 0.55, -r * 0.55, -r * 0.1, -r * 0.7, r * 0.2, -r * 0.5);
        ctx.bezierCurveTo(r * 0.65, -r * 0.28, r * 0.8, -r * 0.05, r * 0.7, r * 0.3);
        ctx.bezierCurveTo(r * 0.55, r * 0.7, r * 0.1, r * 0.8, -r * 0.25, r * 0.65);
        ctx.bezierCurveTo(-r * 0.7, r * 0.5, -r * 0.75, r * 0.2, -r * 0.65, -r * 0.05);
        ctx.closePath();
        ctx.fillStyle = '#aadaff';
        ctx.fill();
        ctx.strokeStyle = '#8ec4e0';
        ctx.lineWidth = Math.max(1, r * 0.04);
        ctx.stroke();
    }
    ctx.restore();
}

/** Default geographic scales (meters) for newly placed symbols. */
const DEFAULT_ROAD_SCALE_M = 35;
const DEFAULT_RIVER_SCALE_M = 40;
const DEFAULT_POND_RADIUS_M = 20;
const DEFAULT_TREE_SCALE_M = 11;
const DEFAULT_LANDMARK_SCALE_M = 11;

function defaultLandmarkScaleM(type) {
    // tree, temple (mandir), mosque (masjid), house (home), school
    return DEFAULT_LANDMARK_SCALE_M;
}

/** True geographic scale: meters → map pixels at current zoom (scales with zoom). */
function mapDisplayPixels(meters, zoom) {
    const z = zoom != null ? zoom : (map ? map.getZoom() : 15);
    return Math.max(6, metersToPixels(meters, z));
}

function shapeSvgForKind(kind) {
    if (kind === 'road') return SVG_ROAD;
    if (kind === 'river') return SVG_RIVER;
    return SVG_POND;
}

function mapShapeIconHtml(svgUrl, angle, label) {
    const labelHtml = label
        ? `<span class="map-item-label">${escapeHtml(label)}</span>`
        : '';
    return `<div class="map-shape-root">
        <div class="map-shape-wrap" style="transform: rotate(${angle || 0}deg);">
            <div class="map-shape-img" style="background-image:url('${svgUrl}');"></div>
        </div>
        ${labelHtml}
    </div>`;
}

function mapLandmarkIconHtml(emoji, size, label) {
    const labelHtml = label
        ? `<span class="map-item-label">${escapeHtml(label)}</span>`
        : '';
    return `<div class="map-landmark-root">
        <span class="emoji" style="font-size:${size}px">${emoji}</span>
        ${labelHtml}
    </div>`;
}

function mapTextIconHtml(text, size) {
    return `<div class="map-text-root">
        <span class="map-text-annotation" style="font-size:${size || 15}px">${escapeHtml(text)}</span>
    </div>`;
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Bottom offset for a label below a rotated rectangle (meters → canvas px). */
function shapeLabelOffset(w, h, angleDeg) {
    const rad = ((angleDeg || 0) * Math.PI) / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    return (w * sin + h * cos) / 2 + 6;
}

/** Draw a centered pill label just below an item on the schematic canvas. */
function drawAnnotationLabel(ctx, x, y, text, offsetY) {
    if (!text || !String(text).trim()) return;
    const label = String(text).trim();
    ctx.save();
    ctx.font = 'bold 10px Inter';
    const tw = ctx.measureText(label).width;
    const padX = 6;
    const padY = 3;
    const boxW = tw + padX * 2;
    const boxH = 14;
    const boxX = x - boxW / 2;
    const boxY = y + offsetY;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(boxX, boxY, boxW, boxH);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#334155';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, boxY + boxH / 2);
    ctx.restore();
}

/** Track every selectable map marker for highlight updates. */
let selectableMarkerRefs = [];

function registerSelectableMarker(marker, type, data) {
    selectableMarkerRefs.push({ marker, type, data });
}

function updateMapSelectionHighlights() {
    selectableMarkerRefs.forEach((ref) => {
        const el = ref.marker.getElement();
        if (!el) return;
        const selected = activeSelection
            && activeSelection.type === ref.type
            && activeSelection.data === ref.data;
        el.classList.toggle('map-item-selected', !!selected);
    });
}

/** Shape markers tracked so zoom/resize can update size without full map rebuild. */
let shapeMarkerRefs = [];
let shapeZoomRaf = null;

function shapePixelSize(kind, data, zoom) {
    if (kind === 'pond') {
        const d = mapDisplayPixels((data.radius || DEFAULT_POND_RADIUS_M) * 2, zoom);
        return [d, d];
    }
    if (kind === 'landmark') {
        const d = mapDisplayPixels(data.size || defaultLandmarkScaleM(data.type), zoom);
        return [d, d];
    }
    const fallback = kind === 'road' ? DEFAULT_ROAD_SCALE_M : DEFAULT_RIVER_SCALE_M;
    const w = mapDisplayPixels(data.width || fallback, zoom);
    const h = mapDisplayPixels(data.height || fallback, zoom);
    return [w, h];
}

function buildLandmarkDivIcon(lan, zoom) {
    let emoji = '📍';
    switch (lan.type) {
        case 'tree': emoji = '🌲'; break;
        case 'temple': emoji = '🛕'; break;
        case 'mosque': emoji = '🕌'; break;
        case 'school': emoji = '🏫'; break;
        case 'house': emoji = '🏠'; break;
    }
    const sizeM = lan.size || defaultLandmarkScaleM(lan.type);
    const size = mapDisplayPixels(sizeM, zoom);
    return L.divIcon({
        html: mapLandmarkIconHtml(emoji, size, lan.label),
        className: 'custom-landmark-icon',
        iconSize: [Math.max(72, size + 24), size + (lan.label ? 22 : 10)],
        iconAnchor: [Math.max(36, (size + 24) / 2), size / 2 + 2]
    });
}

function buildShapeDivIcon(kind, data, zoom) {
    const [wPx, hPx] = shapePixelSize(kind, data, zoom);
    const angle = kind === 'pond' ? 0 : (data.angle || 0);
    return L.divIcon({
        html: mapShapeIconHtml(shapeSvgForKind(kind), angle, data.label),
        className: `custom-${kind}-icon map-shape-marker`,
        iconSize: [wPx, hPx],
        iconAnchor: [wPx / 2, hPx / 2]
    });
}

function refreshShapeMarkerIcons() {
    if (!map || !shapeMarkerRefs.length) return;
    const zoom = map.getZoom();
    shapeMarkerRefs.forEach((ref) => {
        if (ref.kind === 'landmark') {
            ref.marker.setIcon(buildLandmarkDivIcon(ref.data, zoom));
            return;
        }
        const [wPx, hPx] = shapePixelSize(ref.kind, ref.data, zoom);
        const el = ref.marker.getElement();
        if (el) {
            el.style.width = `${wPx}px`;
            el.style.height = `${hPx}px`;
            el.style.marginLeft = `${-wPx / 2}px`;
            el.style.marginTop = `${-hPx / 2}px`;
            const wrap = el.querySelector('.map-shape-wrap');
            if (wrap) {
                const angle = ref.kind === 'pond' ? 0 : (ref.data.angle || 0);
                wrap.style.transform = `rotate(${angle}deg)`;
            }
            const labelEl = el.querySelector('.map-item-label');
            if (ref.data.label) {
                if (labelEl) {
                    labelEl.textContent = ref.data.label;
                } else {
                    const root = el.querySelector('.map-shape-root');
                    if (root) {
                        const span = document.createElement('span');
                        span.className = 'map-item-label';
                        span.textContent = ref.data.label;
                        root.appendChild(span);
                    }
                }
            } else if (labelEl) {
                labelEl.remove();
            }
            if (ref.marker.options.icon && ref.marker.options.icon.options) {
                ref.marker.options.icon.options.iconSize = [wPx, hPx];
                ref.marker.options.icon.options.iconAnchor = [wPx / 2, hPx / 2];
            }
        } else {
            ref.marker.setIcon(buildShapeDivIcon(ref.kind, ref.data, zoom));
        }
    });
}

function scheduleShapeZoomRefresh() {
    if (shapeZoomRaf) cancelAnimationFrame(shapeZoomRaf);
    shapeZoomRaf = requestAnimationFrame(() => {
        shapeZoomRaf = null;
        refreshShapeMarkerIcons();
    });
}

function bindMapZoomSync() {
    if (!map || map._shapeZoomBound) return;
    map._shapeZoomBound = true;
    // Continuous zoom: keep geographic size in sync while pinching / scrolling
    map.on('zoom', scheduleShapeZoomRefresh);
    map.on('zoomend', refreshShapeMarkerIcons);
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
    initBasemapControls();
    initResponsiveUi();
});

function initResponsiveUi() {
    const app = document.getElementById('appContainer');
    const toggle = document.getElementById('btnSidebarToggle');
    const backdrop = document.getElementById('sidebarBackdrop');
    const sidebar = document.getElementById('sidebar');

    const closeSidebar = () => {
        if (app) app.classList.remove('sidebar-open');
    };

    const openSidebar = () => {
        if (app) app.classList.add('sidebar-open');
    };

    if (toggle && app) {
        toggle.addEventListener('click', () => {
            app.classList.toggle('sidebar-open');
        });
    }

    if (backdrop) {
        backdrop.addEventListener('click', closeSidebar);
    }

    if (sidebar) {
        sidebar.addEventListener('click', (e) => {
            if (window.innerWidth > 1024) return;
            const target = e.target;
            if (target.closest('.btn, .file-label, .stencil-item, input, select, textarea')) {
                setTimeout(closeSidebar, 120);
            }
        });
    }

    let resizeTimer = null;
    window.addEventListener('resize', () => {
        if (window.innerWidth > 1024) {
            closeSidebar();
        }
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (typeof map !== 'undefined' && map) {
                map.invalidateSize();
            }
            if (window.PrintLayout && typeof window.PrintLayout.refresh === 'function') {
                window.PrintLayout.refresh();
            }
        }, 150);
    });
}

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
        const basemapControls = document.getElementById('basemapControls');
        if (basemapControls) basemapControls.style.display = '';
        if (surveyData) {
            renderMap();
            if (activeSelection && shouldUseMapEditModal(activeSelection.type)) {
                showMapSymbolEditModal(activeSelection.type, activeSelection.data);
            }
        }
    });

    btnGrid.addEventListener('click', () => {
        if (activeView === 'grid') return;
        activeView = 'grid';
        btnGrid.classList.add('active');
        btnMap.classList.remove('active');
        paneGrid.classList.add('active');
        paneMap.classList.remove('active');
        const basemapControls = document.getElementById('basemapControls');
        if (basemapControls) basemapControls.style.display = 'none';
        hideMapSymbolEditModal();
        if (activeSelection) {
            // Fall back to sidebar editor on schematic view
            selectAnnotation(activeSelection.type, activeSelection.data);
        }
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
            assetRef: asset,
            surveyLat: asset.surveyLatitude != null ? asset.surveyLatitude : asset.latitude,
            surveyLng: asset.surveyLongitude != null ? asset.surveyLongitude : asset.longitude
        });
        // Persist survey anchors so later nudges stay relative to original GPS
        if (asset.surveyLatitude == null) asset.surveyLatitude = asset.latitude;
        if (asset.surveyLongitude == null) asset.surveyLongitude = asset.longitude;
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
    if (window.PrintLayout && typeof window.PrintLayout.onWorkspaceLoaded === 'function') {
        window.PrintLayout.onWorkspaceLoaded();
    }
}

// Update route length totals (used by print legend / exports)
function updateStats() {
    if (window.PrintLayout && typeof window.PrintLayout.refresh === 'function') {
        window.PrintLayout.refresh();
    }
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
}

/* ==========================================================================
   Map View Rendering (Leaflet)
   ========================================================================== */
let selectedStencilType = null; // Stored type when a stencil item is clicked for click-to-place
let baseTileLayer = null;
let basemapMode = localStorage.getItem('slm_basemap') || 'osm';
let basemapOpacity = (() => {
    const saved = parseInt(localStorage.getItem('slm_basemap_opacity'), 10);
    return Number.isFinite(saved) ? Math.min(100, Math.max(0, saved)) : 100;
})();

function createBasemapLayer(mode) {
    if (mode === 'google') {
        return L.tileLayer('https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
            maxZoom: 21,
            subdomains: ['0', '1', '2', '3'],
            attribution: '© Google',
            opacity: basemapOpacity / 100,
            crossOrigin: true
        });
    }
    if (mode === 'google_sat') {
        return L.tileLayer('https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
            maxZoom: 21,
            subdomains: ['0', '1', '2', '3'],
            attribution: '© Google',
            opacity: basemapOpacity / 100,
            crossOrigin: true
        });
    }
    if (mode === 'none') {
        return null;
    }
    // Default: OpenStreetMap
    return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors',
        opacity: basemapOpacity / 100,
        crossOrigin: true
    });
}

function syncBasemapOpacityUi() {
    const slider = document.getElementById('basemapOpacity');
    const valueEl = document.getElementById('basemapOpacityValue');
    const controls = document.getElementById('basemapControls');
    if (slider && Number(slider.value) !== basemapOpacity) {
        slider.value = String(basemapOpacity);
    }
    if (valueEl) valueEl.textContent = `${basemapOpacity}%`;
    if (controls) controls.classList.toggle('is-none-map', basemapMode === 'none');
}

function applyBasemapOpacity(percent) {
    const next = Math.min(100, Math.max(0, Math.round(Number(percent))));
    basemapOpacity = Number.isFinite(next) ? next : 100;
    localStorage.setItem('slm_basemap_opacity', String(basemapOpacity));
    syncBasemapOpacityUi();
    if (baseTileLayer) {
        baseTileLayer.setOpacity(basemapOpacity / 100);
    }
}

function applyBasemap(mode) {
    basemapMode = mode || 'osm';
    localStorage.setItem('slm_basemap', basemapMode);

    const mapEl = document.getElementById('mapView');
    if (mapEl) {
        mapEl.classList.toggle('basemap-none', basemapMode === 'none');
    }

    const select = document.getElementById('basemapSelect');
    if (select && select.value !== basemapMode) {
        select.value = basemapMode;
    }

    syncBasemapOpacityUi();

    if (!map) return;

    if (baseTileLayer) {
        map.removeLayer(baseTileLayer);
        baseTileLayer = null;
    }

    const layer = createBasemapLayer(basemapMode);
    if (layer) {
        baseTileLayer = layer;
        // Keep tiles under decorations / network
        baseTileLayer.setZIndex(0);
        baseTileLayer.addTo(map);
        baseTileLayer.bringToBack();
        baseTileLayer.setOpacity(basemapOpacity / 100);
    }
}

function initBasemapControls() {
    const select = document.getElementById('basemapSelect');
    const slider = document.getElementById('basemapOpacity');
    if (select) {
        select.value = basemapMode;
        select.addEventListener('change', () => {
            applyBasemap(select.value);
        });
    }
    if (slider) {
        slider.value = String(basemapOpacity);
        slider.addEventListener('input', () => {
            applyBasemapOpacity(slider.value);
        });
    }
    syncBasemapOpacityUi();
}

/** Fine GIS map zoom step (print framing). */
const MAP_FINE_ZOOM_STEP = 0.15;
/** Leaflet wheel / snap settings for smoother zoom when framing print area. */
const MAP_ZOOM_SNAP = 0.15;
const MAP_WHEEL_PX_PER_ZOOM = 220;

function nudgeMapZoom(delta) {
    if (!map) return;
    const next = map.getZoom() + delta;
    const min = map.getMinZoom();
    const max = map.getMaxZoom();
    map.setZoom(Math.max(min, Math.min(max, next)), { animate: true });
}

function renderMap() {
    // Lazy init map container
    if (!map) {
        map = L.map('mapView', {
            zoomSnap: MAP_ZOOM_SNAP,
            zoomDelta: MAP_FINE_ZOOM_STEP,
            wheelPxPerZoomLevel: MAP_WHEEL_PX_PER_ZOOM
        }).setView([23.25, 77.41], 15);

        // Decorative symbols (road/river/pond/landmarks) sit behind network lines & poles.
        // Leaflet defaults: overlayPane≈400 (polylines), markerPane≈600 (poles).
        map.createPane('decorationPane');
        map.getPane('decorationPane').style.zIndex = 350;

        applyBasemap(basemapMode);

        // Bind Leaflet Map Clicks
        map.on('click', onMapClick);
        bindMapZoomSync();
        map.on('move zoom zoomend', repositionActiveMapSymbolModal);
    } else if (!baseTileLayer && basemapMode !== 'none') {
        applyBasemap(basemapMode);
    }

    // Clear old map layer markers
    mapMarkers.forEach(m => map.removeLayer(m));
    mapPolylines.forEach(p => map.removeLayer(p.polyline || p));
    mapMarkers = [];
    mapPolylines = [];
    shapeMarkerRefs = [];
    selectableMarkerRefs = [];

    if (nodes.length === 0) return;

    // Bounds calculation to fit all markers dynamically
    const latLngs = [];
    const zoom = map.getZoom();

    // ── 1. Decorative symbols FIRST (behind lines & poles via decorationPane) ──
    annotations.roads.forEach(road => {
        const p = [road.lat, road.lng];
        const icon = buildShapeDivIcon('road', road, zoom);

        const marker = L.marker(p, {
            icon: icon,
            draggable: true,
            pane: 'decorationPane',
            zIndexOffset: -1000
        }).addTo(map);

        marker.on('dragend', (e) => {
            const newPos = e.target.getLatLng();
            road.lat = newPos.lat;
            road.lng = newPos.lng;
            drawCanvas(); // sync canvas
        });

        marker.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            selectAnnotation('road', road);
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
        shapeMarkerRefs.push({ marker, kind: 'road', data: road });
        registerSelectableMarker(marker, 'road', road);
    });

    annotations.rivers.forEach(river => {
        const p = [river.lat, river.lng];
        const icon = buildShapeDivIcon('river', river, zoom);

        const marker = L.marker(p, {
            icon: icon,
            draggable: true,
            pane: 'decorationPane',
            zIndexOffset: -1000
        }).addTo(map);

        marker.on('dragend', (e) => {
            const newPos = e.target.getLatLng();
            river.lat = newPos.lat;
            river.lng = newPos.lng;
            drawCanvas(); // sync canvas
        });

        marker.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            selectAnnotation('river', river);
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
        shapeMarkerRefs.push({ marker, kind: 'river', data: river });
        registerSelectableMarker(marker, 'river', river);
    });

    annotations.landmarks.forEach(lan => {
        let marker = null;
        if (lan.type === 'pond') {
            const icon = buildShapeDivIcon('pond', lan, zoom);

            marker = L.marker([lan.lat, lan.lng], {
                icon: icon,
                draggable: true,
                pane: 'decorationPane',
                zIndexOffset: -1000
            }).addTo(map);

            marker.on('click', (e) => {
                L.DomEvent.stopPropagation(e);
                selectAnnotation('landmark', lan);
            });
            shapeMarkerRefs.push({ marker, kind: 'pond', data: lan });
            registerSelectableMarker(marker, 'landmark', lan);
        } else {
            marker = L.marker([lan.lat, lan.lng], {
                icon: buildLandmarkDivIcon(lan, zoom),
                draggable: true,
                pane: 'decorationPane',
                zIndexOffset: -1000
            }).addTo(map);

            marker.on('click', (e) => {
                L.DomEvent.stopPropagation(e);
                selectAnnotation('landmark', lan);
            });
            shapeMarkerRefs.push({ marker, kind: 'landmark', data: lan });
            registerSelectableMarker(marker, 'landmark', lan);
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

    // ── 2. Connection polylines (above decorations, below poles) ──
    const nodesById = {};
    nodes.forEach(n => nodesById[n.id] = n);

    // Draw connection polylines + span length labels on the network
    const preset = getPresetDisplayOptions();
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

        const midLat = (p1[0] + p2[0]) / 2;
        const midLng = (p1[1] + p2[1]) / 2;
        const spanText = formatDistance(edge.spanLengthM || 0, preset.unit, preset.decimals);
        const spanIcon = L.divIcon({
            html: `<div class="map-span-label">${spanText}</div>`,
            className: 'custom-span-label',
            iconSize: [72, 18],
            iconAnchor: [36, 9]
        });
        const spanMarker = L.marker([midLat, midLng], {
            icon: spanIcon,
            interactive: false,
            keyboard: false,
            zIndexOffset: 500
        }).addTo(map);

        mapPolylines.push({
            polyline,
            spanMarker,
            from: edge.from,
            to: edge.to,
            edge
        });
        mapMarkers.push(spanMarker);
    });

    // ── 3. Poles on top (default markerPane) with pole numbers ──
    nodes.forEach(node => {
        ensurePoleSurveyAnchor(node);
        const lat = node.assetRef.latitude;
        const lng = node.assetRef.longitude;
        latLngs.push([lat, lng]);

        const poleNo = node.label || `P-${String(node.sequence).padStart(2, '0')}`;
        const markerIcon = L.divIcon({
            html: `<div class="map-pole-root">
                <div class="map-pole-icon ${String(node.structure || '').toLowerCase()}">${node.structure}</div>
                <div class="map-pole-number">${poleNo}</div>
            </div>`,
            className: 'custom-map-icon',
            iconSize: [56, 44],
            iconAnchor: [28, 14]
        });

        const marker = L.marker([lat, lng], {
            icon: markerIcon,
            draggable: true,
            zIndexOffset: 1000,
            autoPan: false
        }).addTo(map);

        // Bind interactive editing on double click
        marker.on('dblclick', () => {
            openEditModal(node);
        });

        marker.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            selectAnnotation('node', node);
        });

        marker.on('dragstart', () => {
            showEditorToast(
                `Pole nudge only — max ${MAX_POLE_NUDGE_M} m from survey GPS to compensate error. Connections stay linked.`
            );
        });

        // Live clamp while dragging; keep connected lines + span labels attached
        marker.on('drag', (e) => {
            const pos = e.target.getLatLng();
            const result = applyPoleNudge(node, pos.lat, pos.lng);
            if (result.clamped) {
                e.target.setLatLng([result.lat, result.lng]);
            }
            syncMapPolylines();
        });

        // Save position updates on drag finish
        marker.on('dragend', (e) => {
            const newPos = e.target.getLatLng();
            const result = applyPoleNudge(node, newPos.lat, newPos.lng);
            e.target.setLatLng([result.lat, result.lng]);
            recalculateSpans();
            syncMapPolylines();
            updateStats();
            drawCanvas(); // keep canvas synced
            if (result.clamped) {
                showEditorToast(
                    `Limited to ${MAX_POLE_NUDGE_M} m from survey position (error compensation only).`
                );
            }
            if (activeSelection && activeSelection.type === 'node' && activeSelection.data === node) {
                updateSelectionInfoPanels('node', node);
            }
            marker.setPopupContent(`
                <div class="map-popup">
                    <strong>${node.label} (${node.structure})</strong><br>
                    <span>Material: ${node.material}</span><br>
                    <span>GPS: ${result.lat.toFixed(5)}, ${result.lng.toFixed(5)}</span><br>
                    <span>Nudge ≤ ${MAX_POLE_NUDGE_M} m from survey</span><br>
                    <span>Remarks: ${node.remarks || 'None'}</span>
                </div>
            `);
        });

        // Popup details binding
        marker.bindPopup(`
            <div class="map-popup">
                <strong>${node.label} (${node.structure})</strong><br>
                <span>Material: ${node.material}</span><br>
                <span>GPS: ${lat.toFixed(5)}, ${lng.toFixed(5)}</span><br>
                <span>Nudge ≤ ${MAX_POLE_NUDGE_M} m from survey</span><br>
                <span>Remarks: ${node.remarks || 'None'}</span>
            </div>
        `);

        mapMarkers.push(marker);
        registerSelectableMarker(marker, 'node', node);
    });

    // ── 4. Text labels on top of network ──
    annotations.texts.forEach(ann => {
        const icon = L.divIcon({
            html: mapTextIconHtml(ann.text, ann.size),
            className: 'custom-text-icon',
            iconSize: [140, (ann.size || 15) + 12],
            iconAnchor: [70, (ann.size || 15) / 2 + 2]
        });

        const marker = L.marker([ann.lat, ann.lng], {
            icon: icon,
            draggable: true,
            zIndexOffset: 2000
        }).addTo(map);

        marker.on('dragend', (e) => {
            const newPos = e.target.getLatLng();
            ann.lat = newPos.lat;
            ann.lng = newPos.lng;
            drawCanvas(); // keep canvas synchronized
        });

        marker.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            selectAnnotation('text', ann);
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
        registerSelectableMarker(marker, 'text', ann);
    });

    // Zoom map view to contain the workspace poles
    const bounds = L.latLngBounds(latLngs);
    map.fitBounds(bounds, { padding: [40, 40] });
    updateMapSelectionHighlights();
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
        items.forEach(el => el.classList.remove('selected'));
        return;
    }

    clearSelection();
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

/** Max distance a pole may be nudged from its survey GPS (error compensation only). */
const MAX_POLE_NUDGE_M = 4;

/**
 * Clamp a proposed lat/lng so it stays within maxM of the survey anchor.
 * Returns { lat, lng, distanceM, clamped }.
 */
function clampPoleLatLng(lat, lng, surveyLat, surveyLng, maxM = MAX_POLE_NUDGE_M) {
    const distanceM = haversine(surveyLat, surveyLng, lat, lng);
    if (!isFinite(distanceM) || distanceM <= maxM) {
        return { lat, lng, distanceM: distanceM || 0, clamped: false };
    }
    const ratio = maxM / distanceM;
    return {
        lat: surveyLat + (lat - surveyLat) * ratio,
        lng: surveyLng + (lng - surveyLng) * ratio,
        distanceM: maxM,
        clamped: true
    };
}

function ensurePoleSurveyAnchor(node) {
    const asset = node.assetRef;
    if (asset.surveyLatitude == null || asset.surveyLongitude == null) {
        asset.surveyLatitude = asset.latitude;
        asset.surveyLongitude = asset.longitude;
    }
    node.surveyLat = asset.surveyLatitude;
    node.surveyLng = asset.surveyLongitude;
}

function applyPoleNudge(node, lat, lng) {
    ensurePoleSurveyAnchor(node);
    const result = clampPoleLatLng(lat, lng, node.surveyLat, node.surveyLng);
    node.assetRef.latitude = result.lat;
    node.assetRef.longitude = result.lng;
    return result;
}

function syncMapPolylines() {
    const byId = {};
    nodes.forEach(n => { byId[n.id] = n; });
    const preset = getPresetDisplayOptions();
    mapPolylines.forEach(ref => {
        const from = byId[ref.from];
        const to = byId[ref.to];
        if (!from || !to || !ref.polyline) return;
        const p1 = [from.assetRef.latitude, from.assetRef.longitude];
        const p2 = [to.assetRef.latitude, to.assetRef.longitude];
        ref.polyline.setLatLngs([p1, p2]);

        if (ref.spanMarker) {
            const midLat = (p1[0] + p2[0]) / 2;
            const midLng = (p1[1] + p2[1]) / 2;
            ref.spanMarker.setLatLng([midLat, midLng]);
            const spanText = formatDistance(
                (ref.edge && ref.edge.spanLengthM) || 0,
                preset.unit,
                preset.decimals
            );
            const el = ref.spanMarker.getElement();
            const label = el && el.querySelector('.map-span-label');
            if (label) label.textContent = spanText;
        }
    });
}

let toastTimer = null;
function showEditorToast(message, durationMs = 3200) {
    let el = document.getElementById('editorToast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'editorToast';
        el.className = 'editor-toast';
        document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add('visible');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        el.classList.remove('visible');
    }, durationMs);
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
            items.forEach(el => el.classList.remove('selected'));
            
            btnSelect.classList.add('active');
            clearSelection();
            
            const help = document.getElementById('annotationHelp');
            help.textContent = 'Drag or click a symbol to place. Hover for name.';
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
                const threshold = lan.type === 'pond'
                    ? Math.max(20, metersToCanvasPixels(lan.radius || DEFAULT_POND_RADIUS_M))
                    : Math.max(20, metersToCanvasPixels(lan.size || defaultLandmarkScaleM(lan.type)) / 2);
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
                const wPx = metersToCanvasPixels(road.width || DEFAULT_ROAD_SCALE_M);
                const hPx = metersToCanvasPixels(road.height || DEFAULT_ROAD_SCALE_M);
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
                const wPx = metersToCanvasPixels(river.width || DEFAULT_RIVER_SCALE_M);
                const hPx = metersToCanvasPixels(river.height || DEFAULT_RIVER_SCALE_M);
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
                selectAnnotation('node', clickedNode);
            } else {
                // If clicked empty grid, initiate panning
                clearSelection();
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
                const threshold = lan.type === 'pond'
                    ? Math.max(20, metersToCanvasPixels(lan.radius || DEFAULT_POND_RADIUS_M))
                    : Math.max(20, metersToCanvasPixels(lan.size || defaultLandmarkScaleM(lan.type)) / 2);
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
                const wPx = metersToCanvasPixels(road.width || DEFAULT_ROAD_SCALE_M);
                const hPx = metersToCanvasPixels(road.height || DEFAULT_ROAD_SCALE_M);
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
                const wPx = metersToCanvasPixels(river.width || DEFAULT_RIVER_SCALE_M);
                const hPx = metersToCanvasPixels(river.height || DEFAULT_RIVER_SCALE_M);
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
        const wPx = metersToCanvasPixels(road.width || DEFAULT_ROAD_SCALE_M);
        const hPx = metersToCanvasPixels(road.height || DEFAULT_ROAD_SCALE_M);

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((road.angle || 0) * Math.PI / 180);
        if (imgCache.road && imgCache.road.complete && imgCache.road.naturalWidth > 0) {
            ctx.drawImage(imgCache.road, -wPx / 2, -hPx / 2, wPx, hPx);
        } else {
            drawShapeSymbol('road', wPx, hPx);
        }
        ctx.restore();

        if (road.label && road.label.trim()) {
            drawAnnotationLabel(
                ctx,
                p.x,
                p.y,
                road.label,
                shapeLabelOffset(wPx, hPx, road.angle || 0)
            );
        }
    });

    // 3. Draw winding rivers behind the network
    annotations.rivers.forEach(river => {
        const p = latLngToSchematic(river.lat, river.lng);
        const wPx = metersToCanvasPixels(river.width || DEFAULT_RIVER_SCALE_M);
        const hPx = metersToCanvasPixels(river.height || DEFAULT_RIVER_SCALE_M);

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((river.angle || 0) * Math.PI / 180);
        if (imgCache.river && imgCache.river.complete && imgCache.river.naturalWidth > 0) {
            ctx.drawImage(imgCache.river, -wPx / 2, -hPx / 2, wPx, hPx);
        } else {
            drawShapeSymbol('river', wPx, hPx);
        }
        ctx.restore();

        if (river.label && river.label.trim()) {
            drawAnnotationLabel(
                ctx,
                p.x,
                p.y,
                river.label,
                shapeLabelOffset(wPx, hPx, river.angle || 0)
            );
        }
    });

    // 4. Draw landmarks & ponds behind the network (same layer as roads/rivers)
    annotations.landmarks.forEach(lan => {
        const p = latLngToSchematic(lan.lat, lan.lng);
        if (lan.type === 'pond') {
            const rPx = metersToCanvasPixels(lan.radius || DEFAULT_POND_RADIUS_M);
            ctx.save();
            ctx.translate(p.x, p.y);
            if (imgCache.pond && imgCache.pond.complete && imgCache.pond.naturalWidth > 0) {
                ctx.drawImage(imgCache.pond, -rPx, -rPx, rPx * 2, rPx * 2);
            } else {
                drawShapeSymbol('pond', rPx * 2, rPx * 2);
            }
            ctx.restore();

            if (lan.label && lan.label.trim()) {
                drawAnnotationLabel(ctx, p.x, p.y, lan.label, rPx + 4);
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

        const size = metersToCanvasPixels(lan.size || defaultLandmarkScaleM(lan.type));
        ctx.font = `${Math.max(12, size)}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(emoji, p.x, p.y);

        if (lan.label && lan.label.trim()) {
            drawAnnotationLabel(ctx, p.x, p.y, lan.label, size / 2 + 6);
        }
    });

    // 5. Draw edge connections (above decorations)
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

    // 6. Draw nodes (poles) on top of lines & decorations
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

    // 7. Draw custom text annotations on top
    annotations.texts.forEach(ann => {
        const p = latLngToSchematic(ann.lat, ann.lng);
        ctx.fillStyle = '#334155';
        ctx.font = `bold ${ann.size || 15}px Outfit`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(ann.text, p.x, p.y);
    });

    drawSelectionHighlight();

    ctx.restore();
}

function drawSelectionHighlight() {
    if (!activeSelection) return;

    const { type, data } = activeSelection;
    ctx.save();
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);

    if (type === 'node') {
        ctx.beginPath();
        ctx.arc(data.x, data.y, 22, 0, Math.PI * 2);
        ctx.stroke();
    } else if (type === 'road' || type === 'river') {
        const p = latLngToSchematic(data.lat, data.lng);
        const fallback = type === 'road' ? DEFAULT_ROAD_SCALE_M : DEFAULT_RIVER_SCALE_M;
        const wPx = metersToCanvasPixels(data.width || fallback);
        const hPx = metersToCanvasPixels(data.height || fallback);
        ctx.translate(p.x, p.y);
        ctx.rotate(((data.angle || 0) * Math.PI) / 180);
        ctx.strokeRect(-wPx / 2 - 4, -hPx / 2 - 4, wPx + 8, hPx + 8);
    } else if (type === 'landmark') {
        const p = latLngToSchematic(data.lat, data.lng);
        if (data.type === 'pond') {
            const rPx = metersToCanvasPixels(data.radius || DEFAULT_POND_RADIUS_M);
            ctx.beginPath();
            ctx.arc(p.x, p.y, rPx + 4, 0, Math.PI * 2);
            ctx.stroke();
        } else {
            const size = metersToCanvasPixels(data.size || defaultLandmarkScaleM(data.type));
            ctx.strokeRect(p.x - size / 2 - 4, p.y - size / 2 - 4, size + 8, size + 8);
        }
    } else if (type === 'text') {
        const p = latLngToSchematic(data.lat, data.lng);
        const fontSize = data.size || 15;
        const text = data.text || '';
        ctx.font = `bold ${fontSize}px Outfit`;
        const tw = ctx.measureText(text).width;
        ctx.strokeRect(p.x - tw / 2 - 6, p.y - fontSize / 2 - 4, tw + 12, fontSize + 8);
    }

    ctx.setLineDash([]);
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
                    surveyLatitude: memoryNode.surveyLat ?? memoryNode.assetRef.surveyLatitude ?? memoryNode.assetRef.latitude,
                    surveyLongitude: memoryNode.surveyLng ?? memoryNode.assetRef.surveyLongitude ?? memoryNode.assetRef.longitude,
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

    // Print PDF Button Click — professional CAD sheet export
    document.getElementById('btnPrintPdf').addEventListener('click', () => {
        if (window.PrintLayout && typeof window.PrintLayout.exportPdf === 'function') {
            window.PrintLayout.exportPdf();
            return;
        }
        // Fallback: schematic print
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
/** True after the user manually drags the map symbol editor. */
let mapSymbolEditUserMoved = false;

function isMapSymbolType(type) {
    return type === 'road' || type === 'river' || type === 'landmark' || type === 'text';
}

function shouldUseMapEditModal(type) {
    return type === 'node' || isMapSymbolType(type);
}

function getConnectedSpanSummaries(node) {
    const byId = {};
    nodes.forEach(n => { byId[n.id] = n; });
    const preset = getPresetDisplayOptions();
    const lines = [];
    edges.forEach(edge => {
        let otherId = null;
        if (edge.from === node.id) otherId = edge.to;
        else if (edge.to === node.id) otherId = edge.from;
        if (otherId == null) return;
        const other = byId[otherId];
        const otherLabel = other
            ? (other.label || `P-${String(other.sequence).padStart(2, '0')}`)
            : `#${otherId}`;
        const spanText = formatDistance(edge.spanLengthM || 0, preset.unit, preset.decimals);
        lines.push(`${otherLabel} · ${spanText} · ${edge.voltage || ''}`);
    });
    return lines;
}

function buildSelectionInfoHtml(type, data) {
    if (type === 'node') {
        const seq = data.sequence != null ? data.sequence : (data.assetRef?.sequence ?? '—');
        const poleNo = data.label || `P-${String(seq).padStart(2, '0')}`;
        const structure = data.structure || data.assetRef?.structure || '—';
        const material = data.material || data.assetRef?.poleMaterial || '—';
        const voltage = data.assetRef?.voltage || '—';
        const status = data.assetRef?.status || '—';
        const lat = data.assetRef?.latitude;
        const lng = data.assetRef?.longitude;
        const spans = getConnectedSpanSummaries(data);
        const gps = (lat != null && lng != null)
            ? `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`
            : '—';
        const spanHtml = spans.length
            ? `<div class="info-spans"><span class="info-k">Spans</span>${
                spans.map(s => `<span class="info-span-line">${escapeHtml(s)}</span>`).join('')
              }</div>`
            : `<div class="info-spans"><span class="info-k">Spans</span><span class="info-span-line">No connections</span></div>`;
        return `
            <div class="info-row"><span class="info-k">Pole</span><span class="info-v">${escapeHtml(poleNo)}</span></div>
            <div class="info-row"><span class="info-k">No.</span><span class="info-v">#${escapeHtml(seq)}</span></div>
            <div class="info-row"><span class="info-k">Structure</span><span class="info-v">${escapeHtml(structure)}</span></div>
            <div class="info-row"><span class="info-k">Material</span><span class="info-v">${escapeHtml(material)}</span></div>
            <div class="info-row"><span class="info-k">Voltage</span><span class="info-v">${escapeHtml(voltage)}</span></div>
            <div class="info-row"><span class="info-k">Status</span><span class="info-v">${escapeHtml(status)}</span></div>
            <div class="info-row"><span class="info-k">GPS</span><span class="info-v">${escapeHtml(gps)}</span></div>
            ${spanHtml}
            <div class="info-spans"><span class="info-span-line">Nudge ≤ ${MAX_POLE_NUDGE_M} m for GPS error only</span></div>
        `;
    }

    if (isMapSymbolType(type)) {
        const kind = type === 'landmark' ? (data.type || 'landmark') : type;
        const lat = data.lat;
        const lng = data.lng;
        const gps = (lat != null && lng != null)
            ? `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`
            : '—';
        let sizeText = '—';
        if (type === 'road' || type === 'river') {
            sizeText = `${data.width || (type === 'road' ? DEFAULT_ROAD_SCALE_M : DEFAULT_RIVER_SCALE_M)} m`;
        } else if (type === 'landmark' && data.type === 'pond') {
            sizeText = `R ${data.radius || DEFAULT_POND_RADIUS_M} m`;
        } else if (type === 'landmark') {
            sizeText = `${data.size || defaultLandmarkScaleM(data.type)} m`;
        } else if (type === 'text') {
            sizeText = `${data.size || 15} px`;
        }
        return `
            <div class="info-row"><span class="info-k">Type</span><span class="info-v">${escapeHtml(kind)}</span></div>
            <div class="info-row"><span class="info-k">Size</span><span class="info-v">${escapeHtml(sizeText)}</span></div>
            <div class="info-row"><span class="info-k">GPS</span><span class="info-v">${escapeHtml(gps)}</span></div>
        `;
    }
    return '';
}

function updateSelectionInfoPanels(type, data) {
    // Info block (pole no. / spans / etc.) is for network poles only — not CAD symbols.
    const html = type === 'node' ? buildSelectionInfoHtml(type, data) : '';
    const mapInfo = document.getElementById('mapEditInfo');
    const sideInfo = document.getElementById('selectionInfoBlock');
    if (mapInfo) {
        if (html) {
            mapInfo.innerHTML = html;
            mapInfo.classList.remove('hidden');
        } else {
            mapInfo.innerHTML = '';
            mapInfo.classList.add('hidden');
        }
    }
    if (sideInfo) {
        if (html) {
            sideInfo.innerHTML = html;
            sideInfo.classList.remove('hidden');
        } else {
            sideInfo.innerHTML = '';
            sideInfo.classList.add('hidden');
        }
    }
}

function getSelectionLatLng(type, data) {
    if (!data) return null;
    if (type === 'node') {
        return {
            lat: data.assetRef?.latitude ?? data.surveyLat,
            lng: data.assetRef?.longitude ?? data.surveyLng
        };
    }
    if (data.lat != null && data.lng != null) {
        return { lat: data.lat, lng: data.lng };
    }
    return null;
}

function hideMapSymbolEditModal() {
    const modal = document.getElementById('mapSymbolEditModal');
    if (modal) modal.classList.add('hidden');
    mapSymbolEditUserMoved = false;
}

function positionMapSymbolEditModal(lat, lng) {
    const modal = document.getElementById('mapSymbolEditModal');
    const mapEl = document.getElementById('mapView');
    if (!modal || !map || !mapEl || lat == null || lng == null) return;
    if (activeView !== 'map') {
        modal.classList.add('hidden');
        return;
    }
    // Keep user-dragged position until a new symbol is selected
    if (mapSymbolEditUserMoved) return;

    const pt = map.latLngToContainerPoint([lat, lng]);
    const modalW = modal.offsetWidth || 200;
    const modalH = modal.offsetHeight || 170;
    const pad = 8;
    const offsetX = 14;
    const offsetY = -8;

    let left = pt.x + offsetX;
    let top = pt.y + offsetY - modalH / 2;

    const maxLeft = Math.max(pad, mapEl.clientWidth - modalW - pad);
    const maxTop = Math.max(pad, mapEl.clientHeight - modalH - pad);
    left = Math.min(Math.max(pad, left), maxLeft);
    top = Math.min(Math.max(pad, top), maxTop);

    modal.style.left = `${left}px`;
    modal.style.top = `${top}px`;
}

function configureSymbolEditControls(prefix, type, data) {
    const typeLabel = document.getElementById(`${prefix}Title`) ||
        document.getElementById(`${prefix}TypeLabel`);
    const labelInput = document.getElementById(`${prefix}Label`);
    const labelGroup = document.getElementById(`${prefix}LabelGroup`);
    const sizeGroup = document.getElementById(`${prefix}SizeGroup`);
    const sizeLabel = document.getElementById(`${prefix}SizeLabel`);
    const slider = document.getElementById(`${prefix}SizeSlider`);
    const valDisplay = document.getElementById(`${prefix}SizeValue`);
    const rotateGroup = document.getElementById(`${prefix}RotateGroup`);
    const rotateSlider = document.getElementById(`${prefix}RotateSlider`);
    const rotateVal = document.getElementById(`${prefix}RotateValue`);
    const deleteBtn = document.getElementById(prefix === 'mapEdit' ? 'mapEditDelete' : 'btnDeleteSelection');

    let typeName = type.charAt(0).toUpperCase() + type.slice(1);
    if (type === 'landmark') {
        typeName = data.type === 'pond' ? 'Pond' : (data.type || 'Landmark');
        typeName = typeName.charAt(0).toUpperCase() + typeName.slice(1);
    } else if (type === 'node') {
        const seq = data.sequence != null ? data.sequence : '';
        typeName = data.label || `Pole ${seq}`;
    }

    if (typeLabel) {
        typeLabel.textContent = prefix === 'mapEdit'
            ? (type === 'node' ? typeName : `Edit ${typeName}`)
            : `Selected ${type === 'landmark' && data.type !== 'pond' ? `Landmark (${data.type})` : typeName}`;
    }

    if (labelInput) {
        labelInput.value = data.label || data.text || '';
    }
    if (labelGroup) {
        labelGroup.classList.toggle('hidden', type === 'node');
    }

    updateSelectionInfoPanels(type, data);

    if (deleteBtn) {
        deleteBtn.classList.toggle('hidden', type === 'node');
    }

    if (!sizeGroup || !slider || !valDisplay || !sizeLabel) return;

    sizeGroup.classList.remove('hidden');
    if (rotateGroup) rotateGroup.classList.add('hidden');

    if (type === 'node') {
        sizeGroup.classList.add('hidden');
        if (rotateGroup) rotateGroup.classList.add('hidden');
    } else if (type === 'road' || type === 'river') {
        sizeLabel.textContent = prefix === 'mapEdit' ? 'Scale / Width (m)' : 'Scale/Width (meters)';
        slider.min = 10;
        slider.max = 200;
        const fallback = type === 'road' ? DEFAULT_ROAD_SCALE_M : DEFAULT_RIVER_SCALE_M;
        slider.value = data.width || fallback;
        valDisplay.textContent = `${slider.value}m`;
        if (rotateGroup && rotateSlider && rotateVal) {
            rotateGroup.classList.remove('hidden');
            rotateSlider.value = data.angle || 0;
            rotateVal.textContent = `${rotateSlider.value}°`;
        }
    } else if (type === 'landmark' && data.type === 'pond') {
        sizeLabel.textContent = prefix === 'mapEdit' ? 'Radius (m)' : 'Pond Radius (meters)';
        slider.min = 5;
        slider.max = 150;
        slider.value = data.radius || DEFAULT_POND_RADIUS_M;
        valDisplay.textContent = `${slider.value}m`;
    } else if (type === 'landmark') {
        sizeLabel.textContent = prefix === 'mapEdit' ? 'Scale (m)' : 'Scale (meters)';
        slider.min = 10;
        slider.max = 100;
        slider.value = data.size || defaultLandmarkScaleM(data.type);
        valDisplay.textContent = `${slider.value}m`;
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

function showMapSymbolEditModal(type, data) {
    const modal = document.getElementById('mapSymbolEditModal');
    if (!modal) return;
    mapSymbolEditUserMoved = false;
    configureSymbolEditControls('mapEdit', type, data);
    modal.classList.remove('hidden');
    const ll = getSelectionLatLng(type, data);
    if (ll) positionMapSymbolEditModal(ll.lat, ll.lng);
    requestAnimationFrame(() => {
        if (ll) positionMapSymbolEditModal(ll.lat, ll.lng);
    });
}

function repositionActiveMapSymbolModal() {
    if (!activeSelection || activeView !== 'map') return;
    if (!shouldUseMapEditModal(activeSelection.type)) return;
    const modal = document.getElementById('mapSymbolEditModal');
    if (!modal || modal.classList.contains('hidden')) return;
    const ll = getSelectionLatLng(activeSelection.type, activeSelection.data);
    if (ll) positionMapSymbolEditModal(ll.lat, ll.lng);
}

function selectAnnotation(type, data) {
    activeSelection = { type, data };

    const card = document.getElementById('selectionCard');
    const useMapModal = activeView === 'map' && shouldUseMapEditModal(type) && map;

    if (useMapModal) {
        if (card) card.classList.add('hidden');
        showMapSymbolEditModal(type, data);
    } else {
        hideMapSymbolEditModal();
        if (card) {
            card.classList.remove('hidden');
            configureSymbolEditControls('selection', type, data);
        }
    }

    const nudgeHint = document.getElementById('poleNudgeHint');
    if (nudgeHint) {
        // Compact nudge note is included in map pole info; sidebar still shows hint
        nudgeHint.classList.toggle('hidden', type !== 'node' || useMapModal);
    }

    updateMapSelectionHighlights();
    drawCanvas();
}

function clearSelection() {
    activeSelection = null;
    const selectionCard = document.getElementById('selectionCard');
    if (selectionCard) {
        selectionCard.classList.add('hidden');
    }
    const sideInfo = document.getElementById('selectionInfoBlock');
    if (sideInfo) {
        sideInfo.innerHTML = '';
        sideInfo.classList.add('hidden');
    }
    hideMapSymbolEditModal();
    updateMapSelectionHighlights();
    drawCanvas();
}

function applySelectionLabel(value) {
    if (!activeSelection) return;
    const { type, data } = activeSelection;
    if (type === 'text') {
        data.text = value;
        renderMap();
        if (activeView === 'map') showMapSymbolEditModal(type, data);
    } else if (type === 'node') {
        data.label = value;
        renderMap();
    } else {
        data.label = value;
        if (type === 'road' || type === 'river' || (type === 'landmark' && data.type === 'pond')) {
            refreshShapeMarkerIcons();
            updateMapSelectionHighlights();
        } else {
            renderMap();
            if (activeView === 'map' && isMapSymbolType(type)) {
                showMapSymbolEditModal(type, data);
            }
        }
        repositionActiveMapSymbolModal();
    }
    drawCanvas();
}

function applySelectionSize(val) {
    if (!activeSelection) return;
    const { type, data } = activeSelection;

    if (type === 'road' || type === 'river') {
        data.width = val;
        data.height = val;
        refreshShapeMarkerIcons();
    } else if (type === 'landmark' && data.type === 'pond') {
        data.radius = val;
        refreshShapeMarkerIcons();
    } else if (type === 'landmark') {
        data.size = val;
        refreshShapeMarkerIcons();
    } else if (type === 'text') {
        data.size = val;
        renderMap();
        if (activeView === 'map') showMapSymbolEditModal(type, data);
    }
    drawCanvas();
    repositionActiveMapSymbolModal();
}

function applySelectionRotate(val) {
    if (!activeSelection) return;
    const { type, data } = activeSelection;
    if (type === 'road' || type === 'river') {
        data.angle = val;
        refreshShapeMarkerIcons();
        drawCanvas();
        repositionActiveMapSymbolModal();
    }
}

function deleteActiveSelection() {
    if (!activeSelection) return;
    const { type, data } = activeSelection;
    if (type === 'text') {
        annotations.texts = annotations.texts.filter(t => t !== data);
    } else if (type === 'road') {
        annotations.roads = annotations.roads.filter(r => r !== data);
    } else if (type === 'river') {
        annotations.rivers = annotations.rivers.filter(r => r !== data);
    } else if (type === 'landmark') {
        annotations.landmarks = annotations.landmarks.filter(l => l !== data);
    } else if (type === 'node') {
        showEditorToast('Poles cannot be deleted here. They stay as connected network nodes.');
        return;
    }
    clearSelection();
    renderMap();
    drawCanvas();
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
        applySelectionLabel(labelInput.value);
        const mapLabel = document.getElementById('mapEditLabel');
        if (mapLabel && mapLabel !== document.activeElement) mapLabel.value = labelInput.value;
    });

    slider.addEventListener('input', () => {
        if (!activeSelection) return;
        const val = parseInt(slider.value, 10);
        valDisplay.textContent = activeSelection.type === 'text' ? `${val}px` : `${val}m`;
        applySelectionSize(val);
        const mapSlider = document.getElementById('mapEditSizeSlider');
        const mapVal = document.getElementById('mapEditSizeValue');
        if (mapSlider) mapSlider.value = val;
        if (mapVal) mapVal.textContent = valDisplay.textContent;
    });

    rotateSlider.addEventListener('input', () => {
        if (!activeSelection) return;
        const val = parseInt(rotateSlider.value, 10);
        rotateVal.textContent = `${val}°`;
        applySelectionRotate(val);
        const mapRot = document.getElementById('mapEditRotateSlider');
        const mapRotVal = document.getElementById('mapEditRotateValue');
        if (mapRot) mapRot.value = val;
        if (mapRotVal) mapRotVal.textContent = `${val}°`;
    });

    btnDelete.addEventListener('click', deleteActiveSelection);
    btnClose.addEventListener('click', clearSelection);

    const mapLabel = document.getElementById('mapEditLabel');
    const mapSlider = document.getElementById('mapEditSizeSlider');
    const mapVal = document.getElementById('mapEditSizeValue');
    const mapRot = document.getElementById('mapEditRotateSlider');
    const mapRotVal = document.getElementById('mapEditRotateValue');
    const mapDelete = document.getElementById('mapEditDelete');
    const mapDone = document.getElementById('mapEditDone');
    const mapClose = document.getElementById('mapEditClose');
    const mapModal = document.getElementById('mapSymbolEditModal');

    if (mapModal) {
        ['click', 'dblclick', 'wheel', 'touchstart'].forEach((evt) => {
            mapModal.addEventListener(evt, (e) => e.stopPropagation());
        });
        mapModal.addEventListener('mousedown', (e) => e.stopPropagation());

        const dragHandle = document.getElementById('mapEditDragHandle');
        let dragState = null;

        const onPointerMove = (e) => {
            if (!dragState) return;
            const viewport = document.querySelector('.viewer-viewport') || document.getElementById('mapView');
            if (!viewport) return;
            const rect = viewport.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            let left = clientX - rect.left - dragState.offsetX;
            let top = clientY - rect.top - dragState.offsetY;
            const pad = 6;
            const maxLeft = Math.max(pad, viewport.clientWidth - mapModal.offsetWidth - pad);
            const maxTop = Math.max(pad, viewport.clientHeight - mapModal.offsetHeight - pad);
            left = Math.min(Math.max(pad, left), maxLeft);
            top = Math.min(Math.max(pad, top), maxTop);
            mapModal.style.left = `${left}px`;
            mapModal.style.top = `${top}px`;
            e.preventDefault();
        };

        const endDrag = () => {
            if (!dragState) return;
            dragState = null;
            mapModal.classList.remove('is-dragging');
            window.removeEventListener('mousemove', onPointerMove);
            window.removeEventListener('mouseup', endDrag);
            window.removeEventListener('touchmove', onPointerMove);
            window.removeEventListener('touchend', endDrag);
        };

        const startDrag = (e) => {
            if (e.target && e.target.closest && e.target.closest('#mapEditClose')) return;
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            const modalRect = mapModal.getBoundingClientRect();
            dragState = {
                offsetX: clientX - modalRect.left,
                offsetY: clientY - modalRect.top
            };
            mapSymbolEditUserMoved = true;
            mapModal.classList.add('is-dragging');
            window.addEventListener('mousemove', onPointerMove);
            window.addEventListener('mouseup', endDrag);
            window.addEventListener('touchmove', onPointerMove, { passive: false });
            window.addEventListener('touchend', endDrag);
            e.preventDefault();
            e.stopPropagation();
        };

        if (dragHandle) {
            dragHandle.addEventListener('mousedown', startDrag);
            dragHandle.addEventListener('touchstart', startDrag, { passive: false });
        }
    }

    if (mapLabel) {
        mapLabel.addEventListener('input', () => {
            applySelectionLabel(mapLabel.value);
            if (labelInput) labelInput.value = mapLabel.value;
        });
    }
    if (mapSlider && mapVal) {
        mapSlider.addEventListener('input', () => {
            if (!activeSelection) return;
            const val = parseInt(mapSlider.value, 10);
            mapVal.textContent = activeSelection.type === 'text' ? `${val}px` : `${val}m`;
            applySelectionSize(val);
            if (slider) slider.value = val;
            if (valDisplay) valDisplay.textContent = mapVal.textContent;
        });
    }
    if (mapRot && mapRotVal) {
        mapRot.addEventListener('input', () => {
            if (!activeSelection) return;
            const val = parseInt(mapRot.value, 10);
            mapRotVal.textContent = `${val}°`;
            applySelectionRotate(val);
            if (rotateSlider) rotateSlider.value = val;
            if (rotateVal) rotateVal.textContent = `${val}°`;
        });
    }
    if (mapDelete) mapDelete.addEventListener('click', deleteActiveSelection);
    if (mapDone) mapDone.addEventListener('click', clearSelection);
    if (mapClose) mapClose.addEventListener('click', clearSelection);
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
            item.classList.add('selected');
        });

        item.addEventListener('dragend', () => {
            item.classList.remove('selected');
        });

        // Click to add template directly to center of layout
        item.addEventListener('click', () => {
            const type = item.getAttribute('data-type');
            
            // Set clicked stencil state to enable click-to-place on map/canvas
            selectedStencilType = type;
            items.forEach(el => el.classList.remove('selected'));
            item.classList.add('selected');
            
            const help = document.getElementById('annotationHelp');
            help.textContent = `Click map/canvas to place ${type}, or drag the symbol.`;
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
        placedItem = {
            id, lat, lng,
            width: DEFAULT_ROAD_SCALE_M,
            height: DEFAULT_ROAD_SCALE_M,
            angle: 0,
            label: ''
        };
        annotations.roads.push(placedItem);
    } else if (type === 'river') {
        placedItem = {
            id, lat, lng,
            width: DEFAULT_RIVER_SCALE_M,
            height: DEFAULT_RIVER_SCALE_M,
            angle: 0,
            label: ''
        };
        annotations.rivers.push(placedItem);
    } else if (type === 'pond') {
        placedItem = {
            id, lat, lng,
            type: 'pond',
            radius: DEFAULT_POND_RADIUS_M,
            label: ''
        };
        annotations.landmarks.push(placedItem);
    } else if (type === 'text') {
        placedItem = { lat, lng, text: 'Text Label', size: 16 };
        annotations.texts.push(placedItem);
    } else {
        // Tree, temple, mosque, school, house — size in meters
        placedItem = {
            id, lat, lng,
            type,
            size: defaultLandmarkScaleM(type),
            label: ''
        };
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
