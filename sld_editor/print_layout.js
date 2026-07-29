/**
 * Professional printable CAD sheet layout for the GIS map view.
 * Page frame overlay + high-res PNG/PDF export with SLD header & legend.
 */
(function () {
    'use strict';

    const PAGE_SIZES_MM = {
        A4: { w: 210, h: 297 },
        A3: { w: 297, h: 420 },
        A2: { w: 420, h: 594 },
        Letter: { w: 215.9, h: 279.4 },
        Legal: { w: 215.9, h: 355.6 }
    };

    const MM_PER_INCH = 25.4;
    const HEADER_FRAC = 0.11;
    const FOOTER_FRAC = 0.075;
    const LEGEND_W_FRAC = 0.34;
    const LEGEND_H_FRAC = 0.52;

    const VOLTAGE_COLORS = {
        '33kV': '#ef4444',
        KV_33: '#ef4444',
        '11kV': '#f59e0b',
        KV_11: '#f59e0b',
        LT: '#22c55e',
        'LT': '#22c55e'
    };

    const STRUCTURE_COLOR = '#1565c0';

    /** Overlap between adjacent atlas sheets (keeps edge poles readable). */
    const SHEET_OVERLAP = 0.08;
    /** Max ground width (m) across the map hole before Auto/Multi splits pages. */
    const MAX_CLEAR_MAP_WIDTH_M = 850;
    /** Padding around network bounds when planning sheets (m). */
    const NETWORK_BOUNDS_PAD_M = 45;

    let printEnabled = false;
    let frameLeft = 0;
    let frameTop = 0;
    let frameWidth = 520;
    let frameHeight = 368;
    let dragState = null;

    /** @type {{bounds: any, row: number, col: number, rows: number, cols: number, index: number}[]} */
    let sheetPlan = [];
    let currentSheetIndex = 0;
    let lastCrowdingToastKey = '';
    let exportCancelRequested = false;
    let exportInProgress = false;
    let mapAnimBackup = null;

    function $(id) {
        return document.getElementById(id);
    }

    function getPageMm() {
        const size = ($('printPageSize') && $('printPageSize').value) || 'A4';
        const orient = ($('printOrientation') && $('printOrientation').value) || 'landscape';
        const base = PAGE_SIZES_MM[size] || PAGE_SIZES_MM.A4;
        if (orient === 'portrait') {
            return { w: base.w, h: base.h, size, orient };
        }
        return { w: base.h, h: base.w, size, orient };
    }

    function getDpi() {
        const v = parseInt(($('printDpi') && $('printDpi').value) || '200', 10);
        return Number.isFinite(v) ? v : 200;
    }

    function pagePixels(pageMm, dpi) {
        return {
            w: Math.round((pageMm.w / MM_PER_INCH) * dpi),
            h: Math.round((pageMm.h / MM_PER_INCH) * dpi)
        };
    }

    function viewportRect() {
        const vp = document.querySelector('.viewer-viewport');
        if (!vp) return { w: 800, h: 600 };
        const r = vp.getBoundingClientRect();
        return { w: r.width, h: r.height };
    }

    function computeDefaultFrameSize() {
        const page = getPageMm();
        const aspect = page.w / page.h;
        const vp = viewportRect();
        const margin = 48;
        let w = Math.min(vp.w - margin * 2, vp.h * aspect - margin);
        let h = w / aspect;
        if (h > vp.h - margin * 2) {
            h = vp.h - margin * 2;
            w = h * aspect;
        }
        w = Math.max(280, w);
        h = w / aspect;
        return { w, h };
    }

    function clampFrame() {
        const vp = viewportRect();
        frameWidth = Math.min(frameWidth, vp.w - 16);
        frameHeight = Math.min(frameHeight, vp.h - 16);
        frameLeft = Math.max(8, Math.min(frameLeft, vp.w - frameWidth - 8));
        frameTop = Math.max(8, Math.min(frameTop, vp.h - frameHeight - 8));
    }

    function centerFrame() {
        const size = computeDefaultFrameSize();
        frameWidth = size.w;
        frameHeight = size.h;
        const vp = viewportRect();
        frameLeft = (vp.w - frameWidth) / 2;
        frameTop = (vp.h - frameHeight) / 2;
        clampFrame();
        applyFrameStyle();
    }

    function applyFrameStyle() {
        const frame = $('printFrame');
        if (!frame) return;
        frame.style.left = `${frameLeft}px`;
        frame.style.top = `${frameTop}px`;
        frame.style.width = `${frameWidth}px`;
        frame.style.height = `${frameHeight}px`;
        requestAnimationFrame(() => fitLegendPanelInFrame());
    }

    function formatDistanceLocal(meters) {
        const preset = (typeof getPresetDisplayOptions === 'function')
            ? getPresetDisplayOptions()
            : { unit: 'meter', decimals: 1 };
        if (typeof formatDistance === 'function') {
            return formatDistance(meters, preset.unit || 'meter', preset.decimals != null ? preset.decimals : 1);
        }
        return `${meters.toFixed(1)} m`;
    }

    const POLE_TYPES = ['1P', '2P', '3P', '4P'];
    const POLES_PER_STRUCTURE = { '1P': 1, '2P': 2, '3P': 3, '4P': 4, 'DTR': 2 };
    const VOLTAGE_ORDER = ['33kV', '11kV', 'LT'];

    function isProposedStatus(status) {
        return String(status || 'proposed').toLowerCase().includes('proposed');
    }

    function normalizeStructure(s) {
        const u = String(s || '1P').toUpperCase();
        if (u === '2P' || u === 'P2') return '2P';
        if (u === '3P' || u === 'P3') return '3P';
        if (u === '4P' || u === 'P4') return '4P';
        if (u === 'DTR') return 'DTR';
        return '1P';
    }

    function physicalPolesForStructure(structure, assetCount) {
        const per = POLES_PER_STRUCTURE[normalizeStructure(structure)] || 1;
        return per * assetCount;
    }

    function poleStatsByStatus() {
        const existing = { '1P': 0, '2P': 0, '3P': 0, '4P': 0, DTR: 0 };
        const proposed = { '1P': 0, '2P': 0, '3P': 0, '4P': 0, DTR: 0 };
        (nodes || []).forEach((n) => {
            const struct = normalizeStructure(n.structure);
            const bucket = isProposedStatus(n.assetRef && n.assetRef.status) ? proposed : existing;
            if (bucket[struct] != null) bucket[struct] += 1;
        });
        return { existing, proposed };
    }

    function networkLengthsByStatus() {
        const existing = { '33kV': 0, '11kV': 0, LT: 0, total: 0 };
        const proposed = { '33kV': 0, '11kV': 0, LT: 0, total: 0 };
        (edges || []).forEach((e) => {
            const key = normalizeVoltage(e.voltage);
            const len = parseFloat(e.spanLengthM) || 0;
            const bucket = isProposedStatus(e.status) ? proposed : existing;
            bucket[key] = (bucket[key] || 0) + len;
            bucket.total += len;
        });
        return { existing, proposed };
    }

    function buildLegendTable() {
        const poles = poleStatsByStatus();
        const lengths = networkLengthsByStatus();
        const groups = [];

        const lineRows = [];
        ['Existing', 'Proposed'].forEach((statusLabel) => {
            const bucket = statusLabel === 'Existing' ? lengths.existing : lengths.proposed;
            VOLTAGE_ORDER.forEach((v) => {
                const len = bucket[v] || 0;
                if (len > 0) {
                    lineRows.push({
                        key: `${statusLabel} — ${v}`,
                        qty: formatDistanceLocal(len),
                        lineColor: VOLTAGE_COLORS[v],
                        dashed: statusLabel === 'Proposed'
                    });
                }
            });
        });
        if (!lineRows.length) lineRows.push({ key: '—', qty: '—' });
        groups.push({ name: 'Line', rows: lineRows });

        const poleRows = [];
        ['Existing', 'Proposed'].forEach((statusLabel) => {
            const bucket = statusLabel === 'Existing' ? poles.existing : poles.proposed;
            POLE_TYPES.forEach((t) => {
                const assets = bucket[t] || 0;
                if (assets > 0) {
                    poleRows.push({
                        key: `${statusLabel} — ${t}`,
                        qty: String(physicalPolesForStructure(t, assets))
                    });
                }
            });
        });
        if (!poleRows.length) poleRows.push({ key: '—', qty: '—' });
        groups.push({ name: 'Pole', rows: poleRows });

        const dtrRows = [];
        ['Existing', 'Proposed'].forEach((statusLabel) => {
            const bucket = statusLabel === 'Existing' ? poles.existing : poles.proposed;
            const assets = bucket.DTR || 0;
            if (assets > 0) {
                dtrRows.push({
                    key: `${statusLabel} — DTR`,
                    qty: String(physicalPolesForStructure('DTR', assets))
                });
            }
        });
        if (!dtrRows.length) dtrRows.push({ key: '—', qty: '—' });
        groups.push({ name: 'DTR', rows: dtrRows });

        return groups;
    }

    function getLegendLayoutInMapHole() {
        const hole = getMapHoleRectInViewport();
        const legendEl = $('printFrameLegend');
        const vp = document.querySelector('.viewer-viewport');
        if (!hole || !legendEl || !vp) return null;
        const lr = legendEl.getBoundingClientRect();
        const vr = vp.getBoundingClientRect();
        const legendLeft = lr.left - vr.left;
        const legendTop = lr.top - vr.top;
        return {
            relLeft: (legendLeft - hole.left) / hole.w,
            relTop: (legendTop - hole.top) / hole.h,
            relWidth: lr.width / hole.w,
            relHeight: lr.height / hole.h
        };
    }

    /** Scale live legend so the full table fits inside the print frame (no scroll/clip). */
    function fitLegendPanelInFrame() {
        const el = $('printFrameLegend');
        const frame = $('printFrame');
        if (!el || !frame) return;

        el.style.transform = 'none';
        el.style.zoom = '';
        el.style.maxHeight = 'none';
        el.style.overflow = 'visible';

        const frameH = frame.getBoundingClientRect().height;
        const header = $('printFrameHeader');
        const footer = $('printFrameFooter');
        const headerH = header ? header.getBoundingClientRect().height : frameH * HEADER_FRAC;
        const footerH = footer ? footer.getBoundingClientRect().height : frameH * FOOTER_FRAC;
        const avail = Math.max(80, frameH - headerH - footerH - 16);

        const natural = el.scrollHeight || el.getBoundingClientRect().height;
        if (natural <= avail + 1) {
            el.style.maxHeight = `${avail}px`;
            return;
        }
        // zoom shrinks layout + paint (avoids parent overflow clipping a CSS transform)
        const z = Math.max(0.55, Math.min(1, avail / natural));
        el.style.zoom = String(Number(z.toFixed(4)));
        el.style.maxHeight = 'none';
    }

    async function captureLegendPanel(captureScale) {
        const el = $('printFrameLegend');
        if (!el || typeof html2canvas !== 'function') return null;

        refreshFrameChrome();
        const prevMaxH = el.style.maxHeight;
        const prevOverflow = el.style.overflow;
        const prevTransform = el.style.transform;
        const prevZoom = el.style.zoom;
        // Capture at full size (unscaled) so export can draw the complete panel
        el.style.maxHeight = 'none';
        el.style.overflow = 'visible';
        el.style.transform = 'none';
        el.style.zoom = '';

        try {
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
            const shot = await html2canvas(el, {
                backgroundColor: '#ffffff',
                scale: Math.max(2, captureScale),
                logging: false,
                useCORS: true,
                allowTaint: false,
                height: el.scrollHeight,
                windowHeight: el.scrollHeight + 40
            });
            return shot;
        } catch (err) {
            console.warn('Legend capture failed, using vector fallback.', err);
            return null;
        } finally {
            el.style.maxHeight = prevMaxH;
            el.style.overflow = prevOverflow;
            el.style.transform = prevTransform;
            el.style.zoom = prevZoom;
        }
    }

    /**
     * Fit the full legend image into the map area (bottom-right) without cropping.
     * Preserves aspect ratio so every legend row stays readable.
     */
    function legendExportRect(mapX, mapY, mapW, mapH, legendImg) {
        const margin = Math.max(10, mapW * 0.012);
        const aspect = legendImg.height / Math.max(1, legendImg.width);
        let w = Math.min(mapW * 0.38, mapW * 0.46);
        let h = w * aspect;
        const maxH = mapH - margin * 2;
        const maxW = mapW * 0.48;
        if (h > maxH) {
            h = maxH;
            w = h / aspect;
        }
        if (w > maxW) {
            w = maxW;
            h = w * aspect;
            if (h > maxH) {
                h = maxH;
                w = h / aspect;
            }
        }
        return {
            x: mapX + mapW - w - margin,
            y: mapY + mapH - h - margin,
            w,
            h
        };
    }

    function drawLegendImage(ctx, legendImg, mapX, mapY, mapW, mapH) {
        const rect = legendExportRect(mapX, mapY, mapW, mapH, legendImg);
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.15)';
        ctx.shadowBlur = 6;
        ctx.shadowOffsetY = 2;
        ctx.drawImage(legendImg, rect.x, rect.y, rect.w, rect.h);
        ctx.shadowColor = 'transparent';
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = Math.max(1.5, rect.w * 0.004);
        ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
        ctx.restore();
    }
    function poleLegendSwatchHtml(struct) {
        const label = struct === 'DTR' ? 'DTR' : struct;
        const fontSize = label === 'DTR' ? 5.2 : 7.5;
        return `<svg class="pf-pole-swatch" width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" role="presentation">
            <circle cx="10" cy="10" r="8.5" fill="${STRUCTURE_COLOR}" stroke="#ffffff" stroke-width="1.25"/>
            <text x="10" y="10" text-anchor="middle" dominant-baseline="central" fill="#ffffff"
                font-size="${fontSize}" font-weight="700" font-family="Inter, Arial, sans-serif">${label}</text>
        </svg>`;
    }

    function drawPoleLegendSwatch(ctx, centerX, centerY, struct, scale) {
        const r = 7 * scale;
        ctx.fillStyle = STRUCTURE_COLOR;
        ctx.beginPath();
        ctx.arc(centerX, centerY, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(1, 1.25 * scale);
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        const fontSize = struct === 'DTR' ? 4.8 * scale : 6.8 * scale;
        ctx.font = `700 ${fontSize}px Inter, Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(struct, centerX, centerY);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        return r * 2 + 6 * scale;
    }

    function buildLegendHtml() {
        const groups = buildLegendTable();
        const body = groups.map((g) => `
            <tr class="pf-legend-group-row"><td colspan="2">${g.name}</td></tr>
            ${g.rows.map((r) => `
                <tr class="pf-legend-data-row">
                    <td class="pf-legend-key">${legendKeyCellHtml(r)}</td>
                    <td class="pf-legend-qty">${r.qty}</td>
                </tr>`).join('')}
        `).join('');
        return `
            <table class="pf-legend-table">
                <thead>
                    <tr><th>Key</th><th>Quantity</th></tr>
                </thead>
                <tbody>${body}</tbody>
            </table>`;
    }

    function legendKeyCellHtml(row) {
        if (row.lineColor) {
            const dash = row.dashed ? ' dashed' : '';
            return `<span class="pf-line-swatch${dash}" style="border-color:${row.lineColor}"></span><span class="pf-legend-key-text">${row.key}</span>`;
        }
        if (row.key.includes('DTR')) {
            return `${poleLegendSwatchHtml('DTR')}<span class="pf-legend-key-text">${row.key}</span>`;
        }
        const struct = row.key.split('—').pop().trim();
        if (POLE_TYPES.includes(struct)) {
            return `${poleLegendSwatchHtml(struct)}<span class="pf-legend-key-text">${row.key}</span>`;
        }
        return row.key;
    }

    function todayStr() {
        const d = new Date();
        return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
    }

    function syncMetaFromSurvey() {
        if (!surveyData) return;
        const titleEl = $('printDrawingTitle');
        const surveyorEl = $('printSurveyor');
        const companyEl = $('printCompany');
        const drgEl = $('printDrawingNo');
        if (titleEl && !titleEl.value) {
            titleEl.value = surveyData.title || 'Single Line Diagram';
        }
        if (surveyorEl && !surveyorEl.value) {
            surveyorEl.value = surveyData.linemanName || '';
        }
        if (companyEl && !companyEl.value) {
            companyEl.value = surveyData.organization || surveyData.utility || 'SLM Survey';
        }
        if (drgEl && !drgEl.value) {
            drgEl.value = surveyData.surveyId ? `SLD-${surveyData.surveyId}` : '';
        }
        refreshFrameChrome();
    }

    function printMeta() {
        return {
            title: ($('printDrawingTitle') && $('printDrawingTitle').value.trim()) || 'Single Line Diagram',
            surveyor: ($('printSurveyor') && $('printSurveyor').value.trim()) || (surveyData && surveyData.linemanName) || '—',
            company: ($('printCompany') && $('printCompany').value.trim()) || 'SLM Survey',
            drawingNo: ($('printDrawingNo') && $('printDrawingNo').value.trim()) || '—',
            scale: ($('printScale') && $('printScale').value.trim()) || 'NTS',
            date: todayStr(),
            mobile: (surveyData && surveyData.linemanMobile) || ''
        };
    }

    function normalizeVoltage(v) {
        const s = String(v || '').toUpperCase();
        if (s.includes('33')) return '33kV';
        if (s.includes('11')) return '11kV';
        return 'LT';
    }

    function totalRouteM() {
        return (edges || []).reduce((sum, e) => sum + (parseFloat(e.spanLengthM) || 0), 0);
    }

    function refreshFrameChrome() {
        const meta = printMeta();
        const set = (id, text) => {
            const el = $(id);
            if (el) el.textContent = text;
        };
        set('pfOrg', meta.company);
        set('pfTitle', meta.title);
        set('pfDrgNo', meta.drawingNo);
        set('pfScale', meta.scale);
        set('pfDate', meta.date);
        set('pfSurveyor', meta.mobile ? `${meta.surveyor} · ${meta.mobile}` : meta.surveyor);

        if (!sheetPlan.length && nodes && nodes.length) {
            buildSheetPlan(false);
        }
        const total = Math.max(1, sheetPlan.length || 1);
        const idx = Math.min(currentSheetIndex, total - 1);
        const sheet = sheetPlan[idx];
        set('pfSheet', `${idx + 1} of ${total}`);

        const stats = sheet
            ? sheetStatsForBounds(sheet.bounds)
            : { poles: (nodes || []).length, spans: (edges || []).length, routeM: totalRouteM() };
        const scope = total > 1 ? ' · this sheet' : '';
        set('pfStats', `${stats.poles} poles · ${stats.spans} spans${scope}`);
        set('pfRoute', formatDistanceLocal(stats.routeM));

        const legendBody = $('pfLegendBody');
        if (legendBody) legendBody.innerHTML = buildLegendHtml();
        updateSheetNavUI();
        refreshLiveKeyPlan();
        // Defer fit until layout paints full table height
        requestAnimationFrame(() => fitLegendPanelInFrame());
    }

    function setPrintEnabled(on) {
        printEnabled = !!on;
        const overlay = $('printOverlay');
        const btn = $('btnTogglePrintLayout');
        if (overlay) {
            overlay.classList.toggle('hidden', !printEnabled);
            overlay.setAttribute('aria-hidden', printEnabled ? 'false' : 'true');
        }
        if (btn) btn.classList.toggle('is-active', printEnabled);
        if (printEnabled) {
            if (typeof activeView !== 'undefined' && activeView !== 'map') {
                const mapBtn = $('btnViewMap');
                if (mapBtn) mapBtn.click();
            }
            syncMetaFromSurvey();
            centerFrame();
            buildSheetPlan(false);
            maybeCrowdingToast();
            updateSheetNavUI();
            refreshFrameChrome();
            const sheet = currentSheet();
            if (sheet && map && nodes && nodes.length) {
                // Defer until frame/hole layout settles
                setTimeout(() => fitBoundsToMapHole(sheet.bounds, true), 60);
            }
            if (typeof hideMapSymbolEditModal === 'function') hideMapSymbolEditModal();
        }
    }

    function getPrintMode() {
        const el = $('printPageMode');
        const v = el && el.value;
        return (v === 'single' || v === 'multi') ? v : 'auto';
    }

    function mapHoleAspect() {
        const hole = getMapHoleRectInViewport();
        if (hole && hole.w > 40 && hole.h > 40) return hole.w / hole.h;
        const page = getPageMm();
        const mapHFrac = 1 - HEADER_FRAC - FOOTER_FRAC;
        return page.w / (page.h * mapHFrac);
    }

    function metersPerDeg(lat) {
        const mLat = 111320;
        const mLng = 111320 * Math.cos((lat * Math.PI) / 180);
        return { mLat, mLng: Math.max(1e-6, mLng) };
    }

    function padLatLngBounds(bounds, padM) {
        if (!bounds || !bounds.isValid()) return bounds;
        const c = bounds.getCenter();
        const { mLat, mLng } = metersPerDeg(c.lat);
        const dLat = padM / mLat;
        const dLng = padM / mLng;
        return L.latLngBounds(
            [bounds.getSouth() - dLat, bounds.getWest() - dLng],
            [bounds.getNorth() + dLat, bounds.getEast() + dLng]
        );
    }

    function getNetworkBounds() {
        if (!nodes || !nodes.length) return null;
        const latLngs = nodes.map((n) => [n.assetRef.latitude, n.assetRef.longitude]);
        const bounds = L.latLngBounds(latLngs);
        if (!bounds.isValid()) return null;
        return padLatLngBounds(bounds, NETWORK_BOUNDS_PAD_M);
    }

    function boundsSizeMeters(bounds) {
        const c = bounds.getCenter();
        const { mLat, mLng } = metersPerDeg(c.lat);
        return {
            w: Math.max(1, (bounds.getEast() - bounds.getWest()) * mLng),
            h: Math.max(1, (bounds.getNorth() - bounds.getSouth()) * mLat),
            midLat: c.lat
        };
    }

    function pointInBounds(lat, lng, bounds) {
        return bounds.contains(L.latLng(lat, lng));
    }

    function sheetStatsForBounds(bounds) {
        if (!bounds || !bounds.isValid()) {
            return { poles: 0, spans: 0, routeM: 0 };
        }
        const inView = (nodes || []).filter((n) =>
            pointInBounds(n.assetRef.latitude, n.assetRef.longitude, bounds)
        );
        const ids = new Set(inView.map((n) => n.id));
        let spans = 0;
        let routeM = 0;
        (edges || []).forEach((e) => {
            const a = ids.has(e.from);
            const b = ids.has(e.to);
            if (a || b) {
                spans += 1;
                routeM += parseFloat(e.spanLengthM) || 0;
            }
        });
        return { poles: inView.length, spans, routeM };
    }

    function neighborSheetIndex(sheet, dir) {
        if (!sheet || !sheetPlan.length) return null;
        let r = sheet.row;
        let c = sheet.col;
        if (dir === 'n') r -= 1;
        if (dir === 's') r += 1;
        if (dir === 'w') c -= 1;
        if (dir === 'e') c += 1;
        const hit = sheetPlan.find((s) => s.row === r && s.col === c);
        return hit ? hit.index : null;
    }

    /**
     * Build atlas tiles at a readable ground scale. Returns one sheet when the
     * network fits, or a left→right / top→bottom grid with overlap.
     */
    function buildSheetPlan(forceMulti) {
        const net = getNetworkBounds();
        if (!net) {
            sheetPlan = [];
            currentSheetIndex = 0;
            return sheetPlan;
        }

        const aspect = mapHoleAspect();
        const size = boundsSizeMeters(net);
        const mode = getPrintMode();
        const maxW = MAX_CLEAR_MAP_WIDTH_M;
        const maxH = maxW / aspect;
        const fits =
            size.w <= maxW * 1.02 &&
            size.h <= maxH * 1.02;

        const wantMulti = mode === 'multi' || (mode === 'auto' && !fits) || (forceMulti && !fits);
        if (mode === 'single' || !wantMulti || (mode === 'auto' && fits)) {
            sheetPlan = [{
                bounds: net,
                row: 0,
                col: 0,
                rows: 1,
                cols: 1,
                index: 0
            }];
            currentSheetIndex = 0;
            return sheetPlan;
        }

        const tileW = maxW;
        const tileH = maxH;
        const stepW = tileW * (1 - SHEET_OVERLAP);
        const stepH = tileH * (1 - SHEET_OVERLAP);
        const cols = Math.max(1, Math.ceil(size.w / stepW));
        const rows = Math.max(1, Math.ceil(size.h / stepH));

        const { mLat, mLng } = metersPerDeg(size.midLat);
        const west0 = net.getWest();
        const north0 = net.getNorth();

        const tiles = [];
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const west = west0 + (c * stepW) / mLng;
                const east = west + tileW / mLng;
                const north = north0 - (r * stepH) / mLat;
                const south = north - tileH / mLat;
                tiles.push({
                    bounds: L.latLngBounds([south, west], [north, east]),
                    row: r,
                    col: c,
                    rows,
                    cols,
                    index: tiles.length
                });
            }
        }

        // Drop empty edge tiles (no poles) but keep at least one.
        const nonempty = tiles.filter((t) => sheetStatsForBounds(t.bounds).poles > 0);
        sheetPlan = (nonempty.length ? nonempty : tiles).map((t, i) => ({ ...t, index: i }));
        // Re-index neighbors still use row/col from original grid — good.

        if (currentSheetIndex >= sheetPlan.length) currentSheetIndex = 0;
        return sheetPlan;
    }

    function currentSheet() {
        return sheetPlan[currentSheetIndex] || null;
    }

    function fitBoundsToMapHole(bounds, animate) {
        if (!map || !bounds || !bounds.isValid()) return;
        const hole = getMapHoleRectInViewport();
        if (!hole || hole.w < 40 || hole.h < 40) {
            map.fitBounds(bounds, { padding: [36, 36], animate: !!animate, maxZoom: 19 });
            return;
        }
        const pad = 22;
        map.invalidateSize();
        map.fitBounds(bounds, {
            paddingTopLeft: [hole.left + pad, hole.top + pad],
            paddingBottomRight: [
                Math.max(0, viewportRect().w - (hole.left + hole.w) + pad),
                Math.max(0, viewportRect().h - (hole.top + hole.h) + pad)
            ],
            animate: !!animate,
            maxZoom: 19
        });
    }

    function maybeCrowdingToast() {
        if (getPrintMode() !== 'auto') return;
        if (sheetPlan.length <= 1) return;
        const key = `${(surveyData && surveyData.surveyId) || 'x'}:${sheetPlan.length}`;
        if (key === lastCrowdingToastKey) return;
        lastCrowdingToastKey = key;
        showToast(`Network is large — using ${sheetPlan.length} sheets for clarity.`);
    }

    function updateSheetNavUI() {
        const nav = $('printSheetNav');
        const strip = $('printSheetStrip');
        const prev = $('btnPrintSheetPrev');
        const next = $('btnPrintSheetNext');
        const multi = sheetPlan.length > 1;
        if (nav) nav.classList.toggle('is-hidden', !multi);
        if (!strip) return;
        strip.innerHTML = '';
        sheetPlan.forEach((s, i) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'print-sheet-chip' + (i === currentSheetIndex ? ' is-active' : '');
            btn.textContent = String(i + 1);
            btn.title = `Sheet ${i + 1} of ${sheetPlan.length}` +
                (s.rows > 1 || s.cols > 1 ? ` (R${s.row + 1}·C${s.col + 1})` : '');
            btn.addEventListener('click', () => goToSheet(i, true));
            strip.appendChild(btn);
        });
        if (prev) prev.disabled = !multi || currentSheetIndex <= 0;
        if (next) next.disabled = !multi || currentSheetIndex >= sheetPlan.length - 1;
    }

    function goToSheet(index, animate) {
        if (!sheetPlan.length) buildSheetPlan(false);
        if (!sheetPlan.length) return;
        currentSheetIndex = Math.max(0, Math.min(index, sheetPlan.length - 1));
        const sheet = currentSheet();
        if (sheet) fitBoundsToMapHole(sheet.bounds, animate !== false);
        refreshFrameChrome();
        updateSheetNavUI();
    }

    function rebuildSheetsAndShow(opts) {
        const options = opts || {};
        buildSheetPlan(!!options.forceMulti);
        maybeCrowdingToast();
        updateSheetNavUI();
        const sheet = currentSheet();
        if (sheet) fitBoundsToMapHole(sheet.bounds, options.animate !== false);
        refreshFrameChrome();
    }

    function fitNetworkInFrame(ev) {
        if (!map || !nodes || nodes.length === 0) {
            showToast('Load a survey with poles first.');
            return;
        }
        if (!printEnabled) setPrintEnabled(true);
        const hole = getMapHoleRectInViewport();
        if (!hole || hole.w < 40 || hole.h < 40) {
            showToast('Print frame is too small.');
            return;
        }
        const shift = ev && ev.shiftKey;
        if (shift || !sheetPlan.length || getPrintMode() !== 'single') {
            rebuildSheetsAndShow({ animate: true, forceMulti: shift && getPrintMode() === 'multi' });
            return;
        }
        // Single mode: fit whole network
        const net = getNetworkBounds();
        if (net) fitBoundsToMapHole(net, true);
        refreshFrameChrome();
    }

    function getMapHoleRectInViewport() {
        const hole = $('printMapHole');
        const vp = document.querySelector('.viewer-viewport');
        if (!hole || !vp) return null;
        const hr = hole.getBoundingClientRect();
        const vr = vp.getBoundingClientRect();
        return {
            left: hr.left - vr.left,
            top: hr.top - vr.top,
            w: hr.width,
            h: hr.height
        };
    }

    function getFrameLayoutFractions() {
        return {
            headerH: HEADER_FRAC,
            footerH: FOOTER_FRAC,
            legendW: LEGEND_W_FRAC,
            legendH: LEGEND_H_FRAC
        };
    }

    function showToast(msg) {
        if (typeof showEditorToast === 'function') showEditorToast(msg);
        else console.log(msg);
    }

    /* ── Drag frame ── */
    function initFrameDrag() {
        const frame = $('printFrame');
        if (!frame) return;

        const startDrag = (e) => {
            if (!printEnabled) return;
            if (e.button != null && e.button !== 0) return;
            const target = e.target;
            // Only drag from chrome (header/footer/legend), not through hole
            if (!target.closest('.print-frame-chrome')) return;
            e.preventDefault();
            e.stopPropagation();
            dragState = {
                startX: e.clientX,
                startY: e.clientY,
                origLeft: frameLeft,
                origTop: frameTop
            };
            document.addEventListener('mousemove', onDragMove);
            document.addEventListener('mouseup', onDragEnd);
        };

        frame.addEventListener('mousedown', startDrag);
    }

    function onDragMove(e) {
        if (!dragState) return;
        frameLeft = dragState.origLeft + (e.clientX - dragState.startX);
        frameTop = dragState.origTop + (e.clientY - dragState.startY);
        clampFrame();
        applyFrameStyle();
    }

    function onDragEnd() {
        dragState = null;
        document.removeEventListener('mousemove', onDragMove);
        document.removeEventListener('mouseup', onDragEnd);
    }

    function onPageSettingsChanged() {
        const aspect = (() => {
            const p = getPageMm();
            return p.w / p.h;
        })();
        // Keep width, recompute height for new aspect; re-center if needed
        frameHeight = frameWidth / aspect;
        clampFrame();
        applyFrameStyle();
        if (printEnabled && nodes && nodes.length) {
            rebuildSheetsAndShow({ animate: false });
        } else {
            refreshFrameChrome();
        }
    }

    function onPrintModeChanged() {
        lastCrowdingToastKey = '';
        if (!printEnabled) setPrintEnabled(true);
        else rebuildSheetsAndShow({ animate: true });
    }

    /* ── High-res export ── */
    function drawLegendTableOnCanvas(ctx, x, y, w, h, scale) {
        const groups = buildLegendTable();
        const pad = 6 * scale;
        const colKeyW = w * 0.68;
        const rowH = 13 * scale;
        const headerH = 16 * scale;
        const groupH = 14 * scale;

        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,0.98)';
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = Math.max(1.5, 1.5 * scale);
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);

        let cy = y + pad + 10 * scale;
        ctx.fillStyle = '#0f172a';
        ctx.font = `bold ${11 * scale}px Inter, Arial, sans-serif`;
        ctx.fillText('Legend', x + pad, cy);
        cy += 8 * scale;

        // Table header
        const tableTop = cy;
        ctx.fillStyle = '#f1f5f9';
        ctx.fillRect(x + pad, tableTop, w - pad * 2, headerH);
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 1 * scale;
        ctx.strokeRect(x + pad, tableTop, w - pad * 2, headerH);
        ctx.beginPath();
        ctx.moveTo(x + pad + colKeyW, tableTop);
        ctx.lineTo(x + pad + colKeyW, tableTop + headerH);
        ctx.stroke();

        ctx.fillStyle = '#0f172a';
        ctx.font = `bold ${8.5 * scale}px Inter, Arial, sans-serif`;
        ctx.fillText('Key', x + pad + 4 * scale, tableTop + 11 * scale);
        ctx.fillText('Quantity', x + pad + colKeyW + 4 * scale, tableTop + 11 * scale);
        cy = tableTop + headerH;

        groups.forEach((group) => {
            // Group row
            ctx.fillStyle = '#e2e8f0';
            ctx.fillRect(x + pad, cy, w - pad * 2, groupH);
            ctx.strokeStyle = '#94a3b8';
            ctx.strokeRect(x + pad, cy, w - pad * 2, groupH);
            ctx.fillStyle = '#0f172a';
            ctx.font = `bold ${8.5 * scale}px Inter, Arial, sans-serif`;
            ctx.fillText(group.name, x + pad + 4 * scale, cy + 10 * scale);
            cy += groupH;

            group.rows.forEach((row) => {
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(x + pad, cy, w - pad * 2, rowH);
                ctx.strokeStyle = '#cbd5e1';
                ctx.strokeRect(x + pad, cy, w - pad * 2, rowH);
                ctx.beginPath();
                ctx.moveTo(x + pad + colKeyW, cy);
                ctx.lineTo(x + pad + colKeyW, cy + rowH);
                ctx.stroke();

                let keyX = x + pad + 4 * scale;
                const keyY = cy + 9 * scale;

                if (row.lineColor) {
                    ctx.strokeStyle = row.lineColor;
                    ctx.lineWidth = row.dashed ? 2 * scale : 2.5 * scale;
                    if (row.dashed) ctx.setLineDash([4 * scale, 3 * scale]);
                    ctx.beginPath();
                    ctx.moveTo(keyX, keyY - 2 * scale);
                    ctx.lineTo(keyX + 14 * scale, keyY - 2 * scale);
                    ctx.stroke();
                    ctx.setLineDash([]);
                    keyX += 18 * scale;
                } else if (row.key.includes('DTR') || POLE_TYPES.some((t) => row.key.endsWith(t))) {
                    const struct = row.key.includes('DTR') ? 'DTR' : row.key.split('—').pop().trim();
                    const swatchW = drawPoleLegendSwatch(ctx, keyX + 7 * scale, keyY - 1 * scale, struct, scale);
                    keyX += swatchW;
                }

                ctx.fillStyle = '#334155';
                ctx.font = `${8 * scale}px Inter, Arial, sans-serif`;
                ctx.fillText(row.key, keyX, keyY);

                ctx.fillStyle = '#0f172a';
                ctx.font = `bold ${8 * scale}px Inter, Arial, sans-serif`;
                ctx.textAlign = 'right';
                ctx.fillText(row.qty, x + w - pad - 4 * scale, keyY);
                ctx.textAlign = 'left';
                cy += rowH;
            });
        });

        ctx.restore();
    }

    function drawLegendOnCanvas(ctx, x, y, w, h, scale) {
        drawLegendTableOnCanvas(ctx, x, y, w, h, scale);
    }

    function drawHeaderFooter(ctx, pageW, pageH, scale, sheetCtx) {
        const meta = printMeta();
        const headerH = pageH * HEADER_FRAC;
        const footerH = pageH * FOOTER_FRAC;
        const total = (sheetCtx && sheetCtx.total) || Math.max(1, sheetPlan.length || 1);
        const num = (sheetCtx && sheetCtx.number) || (currentSheetIndex + 1);
        const stats = (sheetCtx && sheetCtx.stats) || {
            poles: (nodes || []).length,
            spans: (edges || []).length,
            routeM: totalRouteM()
        };

        // Header band
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, pageW, headerH);
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = Math.max(2, 2 * scale);
        ctx.beginPath();
        ctx.moveTo(0, headerH);
        ctx.lineTo(pageW, headerH);
        ctx.stroke();

        const pad = 14 * scale;
        ctx.fillStyle = '#1565c0';
        ctx.font = `bold ${10 * scale}px Inter, Arial, sans-serif`;
        ctx.fillText(meta.company.toUpperCase(), pad, pad + 10 * scale);

        ctx.fillStyle = '#0f172a';
        ctx.font = `bold ${18 * scale}px Inter, Arial, sans-serif`;
        ctx.fillText(meta.title, pad, pad + 32 * scale);

        ctx.fillStyle = '#64748b';
        ctx.font = `${10 * scale}px Inter, Arial, sans-serif`;
        const subtitle = total > 1
            ? `Electrical Network · Single Line Diagram (GIS Sheet) · Atlas ${num}/${total}`
            : 'Electrical Network · Single Line Diagram (GIS Sheet)';
        ctx.fillText(subtitle, pad, pad + 48 * scale);

        // Meta block right
        const metaX = pageW * 0.62;
        const rows = [
            ['Drg No.', meta.drawingNo],
            ['Scale', meta.scale],
            ['Date', meta.date],
            ['Sheet', `${num} of ${total}`]
        ];
        rows.forEach((row, i) => {
            const y = pad + 12 * scale + i * 16 * scale;
            ctx.fillStyle = '#64748b';
            ctx.font = `${10 * scale}px Inter, Arial, sans-serif`;
            ctx.fillText(row[0], metaX, y);
            ctx.fillStyle = '#0f172a';
            ctx.font = `bold ${10 * scale}px Inter, Arial, sans-serif`;
            ctx.fillText(row[1], metaX + 70 * scale, y);
            ctx.strokeStyle = '#e2e8f0';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(metaX, y + 4 * scale);
            ctx.lineTo(pageW - pad, y + 4 * scale);
            ctx.stroke();
        });

        // Footer band
        const fy = pageH - footerH;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, fy, pageW, footerH);
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = Math.max(2, 2 * scale);
        ctx.beginPath();
        ctx.moveTo(0, fy);
        ctx.lineTo(pageW, fy);
        ctx.stroke();

        const poleLabel = total > 1 ? 'Poles / Spans (sheet)' : 'Poles / Spans';
        const routeLabel = total > 1 ? 'Route (sheet)' : 'Route Length';
        const cols = [
            { label: 'Surveyor', value: meta.mobile ? `${meta.surveyor} · ${meta.mobile}` : meta.surveyor },
            { label: poleLabel, value: `${stats.poles} / ${stats.spans}` },
            { label: routeLabel, value: formatDistanceLocal(stats.routeM) },
            { label: 'Signature', value: '' }
        ];
        const colW = pageW / cols.length;
        cols.forEach((c, i) => {
            const x = i * colW;
            if (i > 0) {
                ctx.strokeStyle = '#cbd5e1';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(x, fy);
                ctx.lineTo(x, pageH);
                ctx.stroke();
            }
            ctx.fillStyle = '#64748b';
            ctx.font = `${9 * scale}px Inter, Arial, sans-serif`;
            ctx.fillText(c.label.toUpperCase(), x + 10 * scale, fy + 14 * scale);
            if (c.label === 'Signature') {
                ctx.strokeStyle = '#475569';
                ctx.beginPath();
                ctx.moveTo(x + 10 * scale, pageH - 10 * scale);
                ctx.lineTo(x + colW - 10 * scale, pageH - 10 * scale);
                ctx.stroke();
            } else {
                ctx.fillStyle = '#0f172a';
                ctx.font = `bold ${11 * scale}px Inter, Arial, sans-serif`;
                ctx.fillText(c.value, x + 10 * scale, fy + 30 * scale);
            }
        });

        // Outer page border
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = Math.max(2, 2.5 * scale);
        ctx.strokeRect(1, 1, pageW - 2, pageH - 2);
    }

    function drawMatchLines(ctx, mapX, mapY, mapW, mapH, scale, sheet) {
        if (!sheet || sheetPlan.length <= 1) return;
        const tick = 14 * scale;
        const dirs = [
            { dir: 'n', x1: mapX + mapW * 0.35, y1: mapY, x2: mapX + mapW * 0.65, y2: mapY, tx: mapX + mapW / 2, ty: mapY + 16 * scale },
            { dir: 's', x1: mapX + mapW * 0.35, y1: mapY + mapH, x2: mapX + mapW * 0.65, y2: mapY + mapH, tx: mapX + mapW / 2, ty: mapY + mapH - 8 * scale },
            { dir: 'w', x1: mapX, y1: mapY + mapH * 0.35, x2: mapX, y2: mapY + mapH * 0.65, tx: mapX + 8 * scale, ty: mapY + mapH / 2 },
            { dir: 'e', x1: mapX + mapW, y1: mapY + mapH * 0.35, x2: mapX + mapW, y2: mapY + mapH * 0.65, tx: mapX + mapW - 8 * scale, ty: mapY + mapH / 2 }
        ];
        dirs.forEach((d) => {
            const ni = neighborSheetIndex(sheet, d.dir);
            if (ni == null) return;
            ctx.save();
            ctx.strokeStyle = '#0f172a';
            ctx.setLineDash([5 * scale, 4 * scale]);
            ctx.lineWidth = Math.max(1.5, 1.8 * scale);
            ctx.beginPath();
            ctx.moveTo(d.x1, d.y1);
            ctx.lineTo(d.x2, d.y2);
            ctx.stroke();
            ctx.setLineDash([]);
            // Corner ticks
            ctx.beginPath();
            if (d.dir === 'n' || d.dir === 's') {
                ctx.moveTo(d.x1, d.y1 - (d.dir === 'n' ? 0 : tick));
                ctx.lineTo(d.x1, d.y1 + (d.dir === 'n' ? tick : 0));
                ctx.moveTo(d.x2, d.y2 - (d.dir === 'n' ? 0 : tick));
                ctx.lineTo(d.x2, d.y2 + (d.dir === 'n' ? tick : 0));
            } else {
                ctx.moveTo(d.x1 - (d.dir === 'w' ? 0 : tick), d.y1);
                ctx.lineTo(d.x1 + (d.dir === 'w' ? tick : 0), d.y1);
                ctx.moveTo(d.x2 - (d.dir === 'w' ? 0 : tick), d.y2);
                ctx.lineTo(d.x2 + (d.dir === 'w' ? tick : 0), d.y2);
            }
            ctx.stroke();
            ctx.fillStyle = '#0f172a';
            ctx.font = `bold ${9 * scale}px Inter, Arial, sans-serif`;
            ctx.textAlign = d.dir === 'e' ? 'right' : d.dir === 'w' ? 'left' : 'center';
            ctx.textBaseline = d.dir === 'n' ? 'top' : d.dir === 's' ? 'bottom' : 'middle';
            ctx.fillText(`→ Sheet ${ni + 1}`, d.tx, d.ty);
            ctx.restore();
        });
    }

    function keyPlanProjectors(net, ix, iy, iw, ih) {
        const south = net.getSouth();
        const west = net.getWest();
        const nSpan = Math.max(1e-9, net.getNorth() - south);
        const eSpan = Math.max(1e-9, net.getEast() - west);
        const toXY = (lat, lng) => ({
            x: ix + ((lng - west) / eSpan) * iw,
            y: iy + ((net.getNorth() - lat) / nSpan) * ih
        });
        const clampRect = (x, y, w, h) => {
            let x1 = Math.max(ix, Math.min(ix + iw, x));
            let y1 = Math.max(iy, Math.min(iy + ih, y));
            let x2 = Math.max(ix, Math.min(ix + iw, x + w));
            let y2 = Math.max(iy, Math.min(iy + ih, y + h));
            return {
                x: Math.min(x1, x2),
                y: Math.min(y1, y2),
                w: Math.max(0, Math.abs(x2 - x1)),
                h: Math.max(0, Math.abs(y2 - y1))
            };
        };
        return { toXY, clampRect };
    }

    function drawKeyPlanNetworkLines(ctx, toXY, scale) {
        if (!nodes || !nodes.length || !edges || !edges.length) return;
        const byId = {};
        nodes.forEach((n) => { byId[n.id] = n; });
        // Draw by voltage so HT sits above LT visually when overlapping
        const order = ['LT', '11kV', '33kV'];
        order.forEach((volt) => {
            edges.forEach((e) => {
                if (normalizeVoltage(e.voltage) !== volt) return;
                const a = byId[e.from];
                const b = byId[e.to];
                if (!a || !b) return;
                const p1 = toXY(a.assetRef.latitude, a.assetRef.longitude);
                const p2 = toXY(b.assetRef.latitude, b.assetRef.longitude);
                ctx.beginPath();
                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
                ctx.strokeStyle = VOLTAGE_COLORS[volt] || '#334155';
                ctx.lineWidth = Math.max(1.6, (volt === '33kV' ? 2.4 : volt === '11kV' ? 2.0 : 1.7) * scale);
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.setLineDash([]);
                ctx.stroke();
            });
        });
    }

    function drawKeyPlanPoleDots(ctx, toXY, scale) {
        if (!nodes || !nodes.length) return;
        const r = Math.max(1.8, 2.4 * scale);
        nodes.forEach((n) => {
            const p = toXY(n.assetRef.latitude, n.assetRef.longitude);
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            ctx.fillStyle = '#0f172a';
            ctx.fill();
        });
    }

    function drawKeyPlan(ctx, mapX, mapY, mapW, mapH, scale, sheet) {
        if (!sheet || sheetPlan.length <= 1) return;
        const net = getNetworkBounds();
        if (!net) return;

        const boxW = Math.min(Math.max(mapW * 0.26, 190 * scale), mapW * 0.36);
        const boxH = Math.min(Math.max(mapH * 0.28, 160 * scale), mapH * 0.38);
        const margin = 14 * scale;
        const bx = mapX + margin;
        const by = mapY + margin;

        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.28)';
        ctx.shadowBlur = 8 * scale;
        ctx.shadowOffsetY = 2 * scale;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(bx, by, boxW, boxH);
        ctx.shadowColor = 'transparent';

        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = Math.max(2, 2.4 * scale);
        ctx.strokeRect(bx, by, boxW, boxH);

        const titleH = 20 * scale;
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(bx, by, boxW, titleH);
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${10 * scale}px Inter, Arial, sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('KEY PLAN', bx + 8 * scale, by + titleH / 2);
        ctx.textAlign = 'right';
        ctx.fillText(`${sheet.index + 1} / ${sheetPlan.length}`, bx + boxW - 8 * scale, by + titleH / 2);

        const pad = 8 * scale;
        const noteH = 16 * scale;
        const ix = bx + pad;
        const iy = by + titleH + pad;
        const iw = boxW - pad * 2;
        const ih = boxH - titleH - pad * 2 - noteH;

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(ix, iy, iw, ih);
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = Math.max(1, 1.2 * scale);
        ctx.strokeRect(ix, iy, iw, ih);

        // Clip drawing to plot so sheet frames never spill out
        ctx.save();
        ctx.beginPath();
        ctx.rect(ix, iy, iw, ih);
        ctx.clip();

        const { toXY, clampRect } = keyPlanProjectors(net, ix, iy, iw, ih);

        // Sheet frames under lines (outline only, clipped)
        sheetPlan.forEach((t) => {
            const a = toXY(t.bounds.getNorth(), t.bounds.getWest());
            const b = toXY(t.bounds.getSouth(), t.bounds.getEast());
            const raw = {
                x: Math.min(a.x, b.x),
                y: Math.min(a.y, b.y),
                w: Math.abs(b.x - a.x),
                h: Math.abs(b.y - a.y)
            };
            const r = clampRect(raw.x, raw.y, raw.w, raw.h);
            if (r.w < 1 || r.h < 1) return;
            const active = t.index === sheet.index;
            ctx.strokeStyle = active ? '#1565c0' : '#94a3b8';
            ctx.lineWidth = active ? Math.max(2, 2.2 * scale) : Math.max(1, 1.1 * scale);
            ctx.setLineDash(active ? [] : [4 * scale, 3 * scale]);
            ctx.strokeRect(r.x + 0.5, r.y + 0.5, Math.max(0, r.w - 1), Math.max(0, r.h - 1));
            ctx.setLineDash([]);
            if (active) {
                ctx.fillStyle = 'rgba(21, 101, 192, 0.08)';
                ctx.fillRect(r.x, r.y, r.w, r.h);
            }
        });

        // Clean network lines + simple pole dots (no labels / structure text)
        drawKeyPlanNetworkLines(ctx, toXY, scale);
        drawKeyPlanPoleDots(ctx, toXY, scale);

        ctx.restore(); // end clip

        ctx.fillStyle = '#475569';
        ctx.font = `${8.5 * scale}px Inter, Arial, sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('Blue frame = this sheet · lines + poles', bx + pad, by + boxH - noteH / 2);
        ctx.restore();
    }

    function refreshLiveKeyPlan() {
        const panel = $('printFrameKeyPlan');
        const body = $('pfKeyPlanBody');
        const note = $('pfKeyPlanNote');
        if (!panel || !body) return;

        const multi = sheetPlan.length > 1;
        panel.classList.toggle('is-hidden', !multi);
        if (!multi) {
            body.innerHTML = '';
            return;
        }

        const net = getNetworkBounds();
        const sheet = currentSheet();
        if (!net || !sheet) {
            panel.classList.add('is-hidden');
            return;
        }

        const vbW = 200;
        const vbH = 140;
        const { toXY, clampRect } = keyPlanProjectors(net, 0, 0, vbW, vbH);
        const byId = {};
        (nodes || []).forEach((n) => { byId[n.id] = n; });

        const frameParts = sheetPlan.map((t) => {
            const a = toXY(t.bounds.getNorth(), t.bounds.getWest());
            const b = toXY(t.bounds.getSouth(), t.bounds.getEast());
            const r = clampRect(
                Math.min(a.x, b.x),
                Math.min(a.y, b.y),
                Math.abs(b.x - a.x),
                Math.abs(b.y - a.y)
            );
            if (r.w < 1 || r.h < 1) return '';
            const active = t.index === sheet.index;
            return `<rect x="${r.x.toFixed(1)}" y="${r.y.toFixed(1)}" width="${r.w.toFixed(1)}" height="${r.h.toFixed(1)}"
                fill="${active ? 'rgba(21,101,192,0.08)' : 'none'}"
                stroke="${active ? '#1565c0' : '#94a3b8'}"
                stroke-width="${active ? 2.2 : 1}"
                stroke-dasharray="${active ? 'none' : '4 3'}"
                data-sheet="${t.index}"
                style="cursor:pointer" />`;
        }).join('');

        const lineOrder = ['LT', '11kV', '33kV'];
        const lineParts = [];
        lineOrder.forEach((volt) => {
            (edges || []).forEach((e) => {
                if (normalizeVoltage(e.voltage) !== volt) return;
                const a = byId[e.from];
                const b = byId[e.to];
                if (!a || !b) return;
                const p1 = toXY(a.assetRef.latitude, a.assetRef.longitude);
                const p2 = toXY(b.assetRef.latitude, b.assetRef.longitude);
                const sw = volt === '33kV' ? 2.4 : volt === '11kV' ? 2.0 : 1.7;
                lineParts.push(
                    `<line x1="${p1.x.toFixed(1)}" y1="${p1.y.toFixed(1)}" x2="${p2.x.toFixed(1)}" y2="${p2.y.toFixed(1)}"
                        stroke="${VOLTAGE_COLORS[volt]}" stroke-width="${sw}" stroke-linecap="round" />`
                );
            });
        });

        const dotParts = (nodes || []).map((n) => {
            const p = toXY(n.assetRef.latitude, n.assetRef.longitude);
            return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.2" fill="#0f172a" />`;
        }).join('');

        // Invisible hit targets for sheet navigation (clipped)
        const hitParts = sheetPlan.map((t) => {
            const a = toXY(t.bounds.getNorth(), t.bounds.getWest());
            const b = toXY(t.bounds.getSouth(), t.bounds.getEast());
            const r = clampRect(
                Math.min(a.x, b.x),
                Math.min(a.y, b.y),
                Math.abs(b.x - a.x),
                Math.abs(b.y - a.y)
            );
            if (r.w < 1 || r.h < 1) return '';
            return `<rect class="pf-keyplan-hit" data-sheet="${t.index}"
                x="${r.x.toFixed(1)}" y="${r.y.toFixed(1)}" width="${r.w.toFixed(1)}" height="${r.h.toFixed(1)}"
                fill="transparent" style="cursor:pointer" />`;
        }).join('');

        body.innerHTML = `
            <svg class="pf-keyplan-svg" viewBox="0 0 ${vbW} ${vbH}" preserveAspectRatio="xMidYMid meet" aria-label="Key plan">
                <rect x="0" y="0" width="${vbW}" height="${vbH}" fill="#ffffff"/>
                ${frameParts}
                ${lineParts.join('')}
                ${dotParts}
                ${hitParts}
            </svg>`;

        body.querySelectorAll('[data-sheet]').forEach((el) => {
            el.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const i = parseInt(el.getAttribute('data-sheet'), 10);
                if (Number.isFinite(i)) goToSheet(i, true);
            });
        });

        if (note) {
            note.textContent = `Sheet ${sheet.index + 1} of ${sheetPlan.length} · blue frame = here`;
        }
    }

    /**
     * Project current map view into the print map rectangle and draw crisp network vectors.
     * Pole numbers + span lengths use collision-aware placement so they do not overlap.
     */
    function drawNetworkIntoMapArea(ctx, mapX, mapY, mapW, mapH) {
        if (!map || !nodes || nodes.length === 0) return;

        const hole = $('printMapHole');
        const mapEl = $('mapView');
        if (!hole || !mapEl) return;

        const mapRect = mapEl.getBoundingClientRect();
        const holeRect = hole.getBoundingClientRect();
        const holeLeft = holeRect.left - mapRect.left;
        const holeTop = holeRect.top - mapRect.top;
        const holeW = holeRect.width;
        const holeH = holeRect.height;
        if (holeW < 2 || holeH < 2) return;

        const toPage = (lat, lng) => {
            const pt = map.latLngToContainerPoint([lat, lng]);
            return {
                x: mapX + ((pt.x - holeLeft) / holeW) * mapW,
                y: mapY + ((pt.y - holeTop) / holeH) * mapH
            };
        };

        const scale = Math.max(mapW, mapH) / 900;
        const pad = 4 * scale;
        const nodesById = {};
        nodes.forEach((n) => { nodesById[n.id] = n; });

        const inMap = (x, y, margin) => {
            const m = margin == null ? 0 : margin;
            return x >= mapX - m && x <= mapX + mapW + m && y >= mapY - m && y <= mapY + mapH + m;
        };

        const occupied = []; // axis-aligned boxes already taken

        const overlaps = (box, list, gap) => {
            const g = gap == null ? 2 * scale : gap;
            for (let i = 0; i < list.length; i++) {
                const o = list[i];
                if (box.x < o.x + o.w + g && box.x + box.w + g > o.x &&
                    box.y < o.y + o.h + g && box.y + box.h + g > o.y) {
                    return true;
                }
            }
            return false;
        };

        const clampBox = (box) => {
            let x = box.x;
            let y = box.y;
            let w = box.w;
            let h = box.h;
            if (x < mapX + pad) x = mapX + pad;
            if (y < mapY + pad) y = mapY + pad;
            if (x + w > mapX + mapW - pad) x = mapX + mapW - pad - w;
            if (y + h > mapY + mapH - pad) y = mapY + mapH - pad - h;
            return { x, y, w, h };
        };

        const placeBox = (candidates, hardObstacles) => {
            for (let i = 0; i < candidates.length; i++) {
                const c = clampBox(candidates[i]);
                if (c.w < 2 || c.h < 2) continue;
                if (overlaps(c, hardObstacles) || overlaps(c, occupied)) continue;
                occupied.push(c);
                return c;
            }
            // Last resort: first candidate even if tight, but still avoid hard obstacles if possible
            for (let i = 0; i < candidates.length; i++) {
                const c = clampBox(candidates[i]);
                if (!overlaps(c, hardObstacles, scale)) {
                    occupied.push(c);
                    return c;
                }
            }
            return null;
        };

        const drawLabelBox = (box, text, opts) => {
            if (!box) return;
            const o = opts || {};
            ctx.save();
            ctx.font = o.font || `${9 * scale}px Inter, Arial, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const cx = box.x + box.w / 2;
            const cy = box.y + box.h / 2 + 0.5 * scale;
            // Soft halo for readability on map tiles — no solid white pill
            ctx.lineJoin = 'round';
            ctx.miterLimit = 2;
            ctx.strokeStyle = o.halo || 'rgba(255,255,255,0.92)';
            ctx.lineWidth = Math.max(2.5, 3.2 * scale);
            ctx.strokeText(text, cx, cy);
            ctx.fillStyle = o.color || '#0f172a';
            ctx.fillText(text, cx, cy);
            ctx.restore();
        };

        // --- Geometry pass ---
        const polePts = [];
        nodes.forEach((node) => {
            const p = toPage(node.assetRef.latitude, node.assetRef.longitude);
            const r = Math.max(7, 9 * scale);
            polePts.push({ node, p, r });
            // Reserve marker area as hard obstacle
            occupied.push({
                x: p.x - r - 0.5 * scale,
                y: p.y - r - 0.5 * scale,
                w: r * 2 + 1 * scale,
                h: r * 2 + 1 * scale,
                hard: true
            });
        });
        const hardObstacles = occupied.slice();

        // --- Draw edges (lines only first) ---
        const spanJobs = [];
        (edges || []).forEach((edge, edgeIdx) => {
            const from = nodesById[edge.from];
            const to = nodesById[edge.to];
            if (!from || !to) return;
            const p1 = toPage(from.assetRef.latitude, from.assetRef.longitude);
            const p2 = toPage(to.assetRef.latitude, to.assetRef.longitude);
            if (!inMap(p1.x, p1.y, 40 * scale) && !inMap(p2.x, p2.y, 40 * scale)) return;

            const color = VOLTAGE_COLORS[normalizeVoltage(edge.voltage)] || '#22c55e';
            ctx.save();
            ctx.strokeStyle = color;
            ctx.lineWidth = Math.max(2, 2.8 * scale);
            ctx.lineCap = 'round';
            const proposed = String(edge.status || '').toLowerCase().includes('proposed');
            if (proposed) ctx.setLineDash([8 * scale, 6 * scale]);
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();

            const span = parseFloat(edge.spanLengthM) || 0;
            if (span <= 0) return;

            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const len = Math.hypot(dx, dy) || 1;
            // Skip labels on extremely short on-page segments (unreadable anyway)
            if (len < 28 * scale) return;

            const mx = (p1.x + p2.x) / 2;
            const my = (p1.y + p2.y) / 2;
            if (!inMap(mx, my, 8 * scale)) return;

            const nx = -dy / len;
            const ny = dx / len;
            const side = (edgeIdx % 2 === 0) ? 1 : -1;
            spanJobs.push({
                label: formatDistanceLocal(span),
                mx,
                my,
                nx,
                ny,
                side,
                ux: dx / len,
                uy: dy / len
            });
        });

        // --- Draw pole markers (structure glyph only; number placed later) ---
        polePts.forEach(({ node, p, r }) => {
            if (!inMap(p.x, p.y, r)) return;
            ctx.save();
            ctx.fillStyle = STRUCTURE_COLOR;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = Math.max(1.5, 1.8 * scale);
            ctx.stroke();
            ctx.fillStyle = '#ffffff';
            ctx.font = `bold ${Math.max(7, 8 * scale)}px Inter, Arial, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(node.structure || '1P', p.x, p.y + 0.5);
            ctx.restore();
        });

        // --- Place pole numbers first (higher priority than spans) ---
        const poleFont = `bold ${Math.max(8, 9 * scale)}px Inter, Arial, sans-serif`;
        ctx.font = poleFont;
        polePts.forEach(({ node, p, r }) => {
            if (!inMap(p.x, p.y, r * 2)) return;
            const poleNo = node.label || `P-${String(node.sequence).padStart(2, '0')}`;
            const tw = ctx.measureText(poleNo).width;
            const th = Math.max(10, 9.5 * scale);
            const bw = tw + 2 * scale;
            const bh = th;
            // Keep numbers snug to the marker; only step out if crowded
            const gaps = [r + 1 * scale, r + 3 * scale, r + 6 * scale, r + 10 * scale];
            const candidates = [];
            gaps.forEach((gap) => {
                candidates.push(
                    { x: p.x - bw / 2, y: p.y + gap, w: bw, h: bh },                 // below
                    { x: p.x - bw / 2, y: p.y - gap - bh, w: bw, h: bh },             // above
                    { x: p.x + gap, y: p.y - bh / 2, w: bw, h: bh },                  // right
                    { x: p.x - gap - bw, y: p.y - bh / 2, w: bw, h: bh },             // left
                    { x: p.x + gap * 0.65, y: p.y + gap * 0.65, w: bw, h: bh },       // SE
                    { x: p.x - gap * 0.65 - bw, y: p.y + gap * 0.65, w: bw, h: bh },  // SW
                    { x: p.x + gap * 0.65, y: p.y - gap * 0.65 - bh, w: bw, h: bh },  // NE
                    { x: p.x - gap * 0.65 - bw, y: p.y - gap * 0.65 - bh, w: bw, h: bh } // NW
                );
            });
            const box = placeBox(candidates, hardObstacles);
            drawLabelBox(box, poleNo, {
                font: poleFont,
                color: '#0f172a'
            });
        });

        // --- Place span lengths (perpendicular offset, then along-line shifts) ---
        const spanFont = `${Math.max(8, 9 * scale)}px Inter, Arial, sans-serif`;
        ctx.font = spanFont;
        spanJobs.forEach((job) => {
            const tw = ctx.measureText(job.label).width;
            const th = Math.max(11, 10 * scale);
            const bw = tw + 8 * scale;
            const bh = th + 3 * scale;
            const offsets = [12, 18, 26, 34, 44].map((d) => d * scale);
            const along = [0, 0.18, -0.18, 0.32, -0.32];
            const candidates = [];
            [job.side, -job.side].forEach((side) => {
                offsets.forEach((off) => {
                    along.forEach((a) => {
                        // Approximate mid-point shift along edge using unit vector stored earlier
                        // Recompute from mx/my + along * half-length estimate via off scale
                        const cx = job.mx + job.ux * (a * 40 * scale) + job.nx * side * off;
                        const cy = job.my + job.uy * (a * 40 * scale) + job.ny * side * off;
                        candidates.push({ x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh });
                    });
                });
            });
            const box = placeBox(candidates, hardObstacles);
            drawLabelBox(box, job.label, {
                font: spanFont,
                color: '#334155'
            });
        });
    }

    async function captureMapRegion(scale) {
        if (typeof html2canvas !== 'function') {
            return null;
        }
        if (!map) return null;

        map.invalidateSize();
        await new Promise((r) => setTimeout(r, 280));

        const mapEl = $('mapView');
        const hole = $('printMapHole');
        if (!mapEl || !hole) return null;

        const mapRect = mapEl.getBoundingClientRect();
        const holeRect = hole.getBoundingClientRect();
        const sx = holeRect.left - mapRect.left;
        const sy = holeRect.top - mapRect.top;
        const sw = holeRect.width;
        const sh = holeRect.height;

        try {
            const captured = await html2canvas(mapEl, {
                useCORS: true,
                allowTaint: false,
                backgroundColor: '#e8eef5',
                scale: Math.max(1, scale),
                logging: false,
                imageTimeout: 12000
            });

            const crop = document.createElement('canvas');
            crop.width = Math.max(1, Math.round(sw * scale));
            crop.height = Math.max(1, Math.round(sh * scale));
            const cctx = crop.getContext('2d');
            cctx.drawImage(
                captured,
                Math.round(sx * scale),
                Math.round(sy * scale),
                crop.width,
                crop.height,
                0,
                0,
                crop.width,
                crop.height
            );
            return crop;
        } catch (err) {
            console.warn('Map tile capture unavailable, using vector network only.', err);
            return null;
        }
    }

    async function composePrintCanvas(sheetOverride) {
        const pageMm = getPageMm();
        const dpi = getDpi();
        const px = pagePixels(pageMm, dpi);
        const scale = dpi / 96;
        const sheet = sheetOverride || currentSheet();
        const total = Math.max(1, sheetPlan.length || 1);
        const number = sheet ? (sheet.index + 1) : 1;
        const stats = sheet
            ? sheetStatsForBounds(sheet.bounds)
            : { poles: (nodes || []).length, spans: (edges || []).length, routeM: totalRouteM() };
        const sheetCtx = { number, total, stats, sheet };

        const canvas = document.createElement('canvas');
        canvas.width = px.w;
        canvas.height = px.h;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, px.w, px.h);

        const headerH = px.h * HEADER_FRAC;
        const footerH = px.h * FOOTER_FRAC;
        const mapY = headerH;
        const mapH = px.h - headerH - footerH;
        const mapX = 0;
        const mapW = px.w;

        // Capture on-screen legend first (matches layout exactly)
        const hole = getMapHoleRectInViewport();
        const captureScale = hole && hole.w > 0
            ? Math.min(3.5, Math.max(2, (mapW / hole.w)))
            : 2.5;
        let legendShot = null;
        if (!printEnabled) setPrintEnabled(true);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        legendShot = await captureLegendPanel(captureScale);

        const overlay = $('printOverlay');
        const chromeEls = overlay
            ? overlay.querySelectorAll('.print-frame-chrome, .print-frame-handle')
            : [];
        chromeEls.forEach((el) => { el.style.visibility = 'hidden'; });
        if (overlay) overlay.classList.add('is-exporting');

        let mapShot = null;
        const hiddenLayers = [];
        try {
            if (typeof mapMarkers !== 'undefined' && Array.isArray(mapMarkers)) {
                mapMarkers.forEach((m) => {
                    if (m && map && map.hasLayer(m)) {
                        map.removeLayer(m);
                        hiddenLayers.push(m);
                    }
                });
            }
            if (typeof mapPolylines !== 'undefined' && Array.isArray(mapPolylines)) {
                mapPolylines.forEach((p) => {
                    const poly = p && (p.polyline || p);
                    const span = p && p.spanMarker;
                    if (poly && map && map.hasLayer(poly)) {
                        map.removeLayer(poly);
                        hiddenLayers.push(poly);
                    }
                    if (span && map && map.hasLayer(span)) {
                        map.removeLayer(span);
                        hiddenLayers.push(span);
                    }
                });
            }

            mapShot = await captureMapRegion(captureScale);
        } finally {
            hiddenLayers.forEach((layer) => {
                try { if (map) map.addLayer(layer); } catch (e) { /* ignore */ }
            });
            chromeEls.forEach((el) => { el.style.visibility = ''; });
            if (overlay) overlay.classList.remove('is-exporting');
        }

        if (mapShot) {
            ctx.drawImage(mapShot, mapX, mapY, mapW, mapH);
            ctx.fillStyle = 'rgba(255,255,255,0.12)';
            ctx.fillRect(mapX, mapY, mapW, mapH);
        } else {
            ctx.fillStyle = '#f1f5f9';
            ctx.fillRect(mapX, mapY, mapW, mapH);
        }

        drawNetworkIntoMapArea(ctx, mapX, mapY, mapW, mapH);
        drawMatchLines(ctx, mapX, mapY, mapW, mapH, scale, sheet);

        if (legendShot) {
            drawLegendImage(ctx, legendShot, mapX, mapY, mapW, mapH);
        } else {
            const legendW = mapW * LEGEND_W_FRAC;
            const legendH = Math.min(mapH * 0.58, mapH * LEGEND_H_FRAC + 80 * scale);
            const legendX = mapX + mapW - legendW - 12 * scale;
            const legendY = mapY + mapH - legendH - 12 * scale;
            drawLegendTableOnCanvas(ctx, legendX, legendY, legendW, legendH, scale);
        }

        // Draw last so key plan stays clearly readable above map + legend
        drawKeyPlan(ctx, mapX, mapY, mapW, mapH, scale, sheet);

        drawHeaderFooter(ctx, px.w, px.h, scale, sheetCtx);

        return { canvas, pageMm, dpi, px, sheetCtx };
    }

    function waitForMapSettle(ms) {
        return new Promise((resolve) => {
            if (!map) {
                setTimeout(resolve, ms || 200);
                return;
            }
            let done = false;
            const finish = () => {
                if (done) return;
                done = true;
                map.off('moveend', onEnd);
                setTimeout(resolve, ms || 180);
            };
            const onEnd = () => finish();
            map.once('moveend', onEnd);
            setTimeout(finish, 700);
        });
    }

    function setMapAnimationsEnabled(on) {
        if (!map) return;
        if (!on) {
            mapAnimBackup = {
                zoomAnimation: map.options.zoomAnimation,
                fadeAnimation: map.options.fadeAnimation,
                markerZoomAnimation: map.options.markerZoomAnimation,
                animate: map.options.animate
            };
            map.options.zoomAnimation = false;
            map.options.fadeAnimation = false;
            map.options.markerZoomAnimation = false;
            if (map._fadeAnimated != null) map._fadeAnimated = false;
            if (map._zoomAnimated != null) map._zoomAnimated = false;
        } else if (mapAnimBackup) {
            map.options.zoomAnimation = mapAnimBackup.zoomAnimation;
            map.options.fadeAnimation = mapAnimBackup.fadeAnimation;
            map.options.markerZoomAnimation = mapAnimBackup.markerZoomAnimation;
            mapAnimBackup = null;
        }
    }

    function showExportProgress(title, subtitle) {
        const el = $('printExportProgress');
        const vp = document.querySelector('.viewer-viewport');
        const bar = $('printToolbar');
        if (!el) return;
        el.classList.remove('hidden', 'is-leaving');
        el.setAttribute('aria-busy', 'true');
        if (vp) vp.classList.add('is-print-exporting');
        if (bar) bar.classList.add('is-print-exporting');
        updateExportProgress(0, title || 'Preparing print…', subtitle || 'Please wait');
    }

    function updateExportProgress(pct, title, subtitle) {
        const t = $('printExportTitle');
        const s = $('printExportSubtitle');
        const fill = $('printExportBarFill');
        const p = $('printExportPct');
        const value = Math.max(0, Math.min(100, Math.round(pct)));
        if (t && title) t.textContent = title;
        if (s && subtitle != null) s.textContent = subtitle;
        if (fill) fill.style.width = `${value}%`;
        if (p) p.textContent = `${value}%`;
    }

    async function hideExportProgress(delayMs) {
        const el = $('printExportProgress');
        const vp = document.querySelector('.viewer-viewport');
        const bar = $('printToolbar');
        if (!el) return;
        el.classList.add('is-leaving');
        await new Promise((r) => setTimeout(r, delayMs != null ? delayMs : 280));
        el.classList.add('hidden');
        el.classList.remove('is-leaving');
        el.setAttribute('aria-busy', 'false');
        if (vp) vp.classList.remove('is-print-exporting');
        if (bar) bar.classList.remove('is-print-exporting');
        const fill = $('printExportBarFill');
        if (fill) fill.style.width = '0%';
    }

    async function prepareSheetForExport(sheet, opts) {
        if (!sheet) return;
        const options = opts || {};
        currentSheetIndex = sheet.index;
        // Avoid sheet-nav / chrome thrash while covered by progress UI
        if (!options.quiet) {
            refreshFrameChrome();
        } else {
            // Still keep legend/stats coherent for capture without rebuilding nav strip
            const legendBody = $('pfLegendBody');
            if (legendBody && !legendBody.innerHTML) legendBody.innerHTML = buildLegendHtml();
        }
        fitBoundsToMapHole(sheet.bounds, false);
        if (map) {
            try { map.invalidateSize(false); } catch (e) { /* ignore */ }
        }
        await waitForMapSettle(options.settleMs != null ? options.settleMs : 200);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    async function exportPng() {
        if (exportInProgress) return;
        if (!surveyData) {
            showToast('Load a workspace before exporting.');
            return;
        }
        if (!printEnabled) setPrintEnabled(true);
        if (!sheetPlan.length) buildSheetPlan(false);
        const sheet = currentSheet();
        const total = Math.max(1, sheetPlan.length);
        const prevCenter = map ? map.getCenter() : null;
        const prevZoom = map ? map.getZoom() : null;
        exportInProgress = true;
        setMapAnimationsEnabled(false);
        showExportProgress(
            'Exporting PNG',
            total > 1 ? `Sheet ${currentSheetIndex + 1} of ${total}` : 'Rendering high-resolution sheet…'
        );
        try {
            updateExportProgress(12, 'Exporting PNG', 'Framing map…');
            if (sheet) await prepareSheetForExport(sheet, { quiet: true, settleMs: 220 });
            updateExportProgress(45, 'Exporting PNG', 'Composing sheet…');
            const { canvas, dpi } = await composePrintCanvas(sheet);
            updateExportProgress(82, 'Exporting PNG', 'Encoding image…');
            const suffix = total > 1 ? `_p${currentSheetIndex + 1}of${total}` : '';
            const name = `SLD_${(surveyData && surveyData.surveyId) || 'sheet'}${suffix}_${dpi}dpi.png`;
            await new Promise((resolve, reject) => {
                canvas.toBlob((blob) => {
                    if (!blob) {
                        reject(new Error('PNG encode failed'));
                        return;
                    }
                    downloadBlob(blob, name);
                    resolve();
                }, 'image/png');
            });
            updateExportProgress(100, 'Export complete', name);
            await new Promise((r) => setTimeout(r, 320));
            showToast(total > 1
                ? `Exported ${name} (use PDF for all sheets)`
                : `Exported ${name}`);
        } catch (err) {
            console.error(err);
            showToast('PNG export failed: ' + (err.message || err));
        } finally {
            if (map && prevCenter != null && prevZoom != null) {
                map.setView(prevCenter, prevZoom, { animate: false });
            }
            setMapAnimationsEnabled(true);
            exportInProgress = false;
            await hideExportProgress(300);
            refreshFrameChrome();
        }
    }

    async function exportPdf() {
        if (exportInProgress) return;
        if (!surveyData) {
            showToast('Load a workspace before exporting.');
            return;
        }
        if (!printEnabled) setPrintEnabled(true);
        const jsPdfNs = window.jspdf;
        if (!jsPdfNs || !jsPdfNs.jsPDF) {
            showToast('PDF library not loaded.');
            return;
        }
        buildSheetPlan(false);
        maybeCrowdingToast();
        updateSheetNavUI();
        if (!sheetPlan.length) {
            showToast('Nothing to print — load poles first.');
            return;
        }

        const { jsPDF } = jsPdfNs;
        const pageMm = getPageMm();
        const dpi = getDpi();
        const pdf = new jsPDF({
            orientation: pageMm.w >= pageMm.h ? 'landscape' : 'portrait',
            unit: 'mm',
            format: [pageMm.w, pageMm.h],
            compress: true
        });

        const prevIndex = currentSheetIndex;
        const prevCenter = map ? map.getCenter() : null;
        const prevZoom = map ? map.getZoom() : null;
        const total = sheetPlan.length;
        exportCancelRequested = false;
        exportInProgress = true;
        setMapAnimationsEnabled(false);
        showExportProgress(
            'Preparing PDF',
            total > 1 ? `Rendering ${total} sheets…` : 'Rendering sheet…'
        );

        try {
            for (let i = 0; i < total; i++) {
                if (exportCancelRequested) throw new Error('Export cancelled');
                const sheet = sheetPlan[i];
                const base = (i / total) * 90;
                updateExportProgress(
                    base + 2,
                    total > 1 ? `Rendering sheet ${i + 1} of ${total}` : 'Rendering sheet',
                    'Framing map…'
                );
                await prepareSheetForExport(sheet, { quiet: true, settleMs: 200 });
                updateExportProgress(
                    base + (90 / total) * 0.45,
                    total > 1 ? `Rendering sheet ${i + 1} of ${total}` : 'Rendering sheet',
                    'Composing CAD sheet…'
                );
                const { canvas } = await composePrintCanvas(sheet);
                updateExportProgress(
                    base + (90 / total) * 0.85,
                    total > 1 ? `Rendering sheet ${i + 1} of ${total}` : 'Rendering sheet',
                    'Adding to PDF…'
                );
                const img = canvas.toDataURL('image/png');
                if (i > 0) pdf.addPage([pageMm.w, pageMm.h], pageMm.w >= pageMm.h ? 'landscape' : 'portrait');
                pdf.addImage(img, 'PNG', 0, 0, pageMm.w, pageMm.h, undefined, 'FAST');
                updateExportProgress(
                    ((i + 1) / total) * 90,
                    total > 1 ? `Sheet ${i + 1} of ${total} ready` : 'Sheet ready',
                    'Continuing…'
                );
                // Let the progress bar animate smoothly between sheets
                await new Promise((r) => setTimeout(r, 40));
            }
            updateExportProgress(95, 'Finalizing PDF', 'Saving file…');
            const name = `SLD_${(surveyData && surveyData.surveyId) || 'sheet'}_${total}p_${dpi}dpi.pdf`;
            pdf.save(name);
            updateExportProgress(100, 'Export complete', `${total} sheet${total > 1 ? 's' : ''} · ${name}`);
            await new Promise((r) => setTimeout(r, 380));
            showToast(`Exported ${name} (${total} sheet${total > 1 ? 's' : ''})`);
        } catch (err) {
            console.error(err);
            showToast('PDF export failed: ' + (err.message || err));
        } finally {
            currentSheetIndex = Math.min(prevIndex, Math.max(0, sheetPlan.length - 1));
            if (map && prevCenter != null && prevZoom != null) {
                map.setView(prevCenter, prevZoom, { animate: false });
            }
            setMapAnimationsEnabled(true);
            exportInProgress = false;
            await hideExportProgress(320);
            refreshFrameChrome();
            updateSheetNavUI();
        }
    }

    function syncToolbarVisibility() {
        const bar = $('printToolbar');
        if (!bar) return;
        const isMap = typeof activeView === 'undefined' || activeView === 'map';
        bar.classList.toggle('is-sld-hidden', !isMap);
        if (!isMap && printEnabled) {
            // Keep state but hide overlay with map
            const overlay = $('printOverlay');
            if (overlay) overlay.classList.add('hidden');
        } else if (isMap && printEnabled) {
            const overlay = $('printOverlay');
            if (overlay) overlay.classList.remove('hidden');
            applyFrameStyle();
        }
    }

    function onWorkspaceLoaded() {
        lastCrowdingToastKey = '';
        syncMetaFromSurvey();
        buildSheetPlan(false);
        updateSheetNavUI();
        refreshFrameChrome();
    }

    const MAP_PRINT_ZOOM_STEP = 0.15;

    function initPrintLayout() {
        const toggle = $('btnTogglePrintLayout');
        if (toggle) {
            toggle.addEventListener('click', () => setPrintEnabled(!printEnabled));
        }
        const zoomInBtn = $('btnMapZoomIn');
        const zoomOutBtn = $('btnMapZoomOut');
        if (zoomInBtn) {
            zoomInBtn.addEventListener('click', () => {
                if (typeof map !== 'undefined' && map) {
                    const z = map.getZoom() + MAP_PRINT_ZOOM_STEP;
                    map.setZoom(z, { animate: true });
                }
            });
        }
        if (zoomOutBtn) {
            zoomOutBtn.addEventListener('click', () => {
                if (typeof map !== 'undefined' && map) {
                    const z = map.getZoom() - MAP_PRINT_ZOOM_STEP;
                    map.setZoom(z, { animate: true });
                }
            });
        }
        ['printPageSize', 'printOrientation'].forEach((id) => {
            const el = $(id);
            if (el) el.addEventListener('change', onPageSettingsChanged);
        });
        const modeEl = $('printPageMode');
        if (modeEl) modeEl.addEventListener('change', onPrintModeChanged);
        ['printDrawingTitle', 'printSurveyor', 'printCompany', 'printDrawingNo', 'printScale'].forEach((id) => {
            const el = $(id);
            if (el) {
                el.addEventListener('input', refreshFrameChrome);
                el.addEventListener('change', refreshFrameChrome);
            }
        });
        const fitBtn = $('btnFitPrintFrame');
        if (fitBtn) fitBtn.addEventListener('click', fitNetworkInFrame);
        const centerBtn = $('btnCenterPrintFrame');
        if (centerBtn) centerBtn.addEventListener('click', () => {
            if (!printEnabled) setPrintEnabled(true);
            else centerFrame();
        });
        const prevBtn = $('btnPrintSheetPrev');
        const nextBtn = $('btnPrintSheetNext');
        if (prevBtn) {
            prevBtn.addEventListener('click', () => goToSheet(currentSheetIndex - 1, true));
        }
        if (nextBtn) {
            nextBtn.addEventListener('click', () => goToSheet(currentSheetIndex + 1, true));
        }
        const pngBtn = $('btnExportPrintPng');
        if (pngBtn) pngBtn.addEventListener('click', exportPng);
        const pdfBtn = $('btnExportPrintPdf');
        if (pdfBtn) pdfBtn.addEventListener('click', exportPdf);

        // Sidebar Print CAD PDF is wired in app.js → PrintLayout.exportPdf

        initFrameDrag();
        window.addEventListener('resize', () => {
            if (!printEnabled) return;
            clampFrame();
            applyFrameStyle();
            if (typeof map !== 'undefined' && map) {
                map.invalidateSize();
            }
        });

        // Hook view toggles
        const btnMap = $('btnViewMap');
        const btnGrid = $('btnViewGrid');
        if (btnMap) btnMap.addEventListener('click', () => setTimeout(syncToolbarVisibility, 0));
        if (btnGrid) btnGrid.addEventListener('click', () => setTimeout(syncToolbarVisibility, 0));

        syncToolbarVisibility();
        refreshFrameChrome();
    }

    // Expose hooks for app.js
    window.PrintLayout = {
        init: initPrintLayout,
        onWorkspaceLoaded,
        setEnabled: setPrintEnabled,
        refresh: refreshFrameChrome,
        syncToolbarVisibility,
        exportPdf,
        exportPng,
        isEnabled: () => printEnabled,
        rebuildSheets: () => rebuildSheetsAndShow({ animate: true }),
        goToSheet: (i) => goToSheet(i, true),
        sheetCount: () => sheetPlan.length
    };

    window.addEventListener('DOMContentLoaded', () => {
        initPrintLayout();
    });
})();
