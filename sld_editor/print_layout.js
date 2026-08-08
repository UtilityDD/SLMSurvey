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
    const LEGEND_W_FRAC = 0.26;
    const LEGEND_H_FRAC = 0.38;
    /** Fallback keep-out size (fraction of map hole) when live panels are not measurable. */
    const LEGEND_KEEPOUT_W_FRAC = 0.30;
    const LEGEND_KEEPOUT_H_FRAC = 0.34;
    const KEYPLAN_KEEPOUT_W_FRAC = 0.30;
    const KEYPLAN_KEEPOUT_H_FRAC = 0.34;
    /** Extra clear gap around overlay panels so poles/labels are not flush against them. */
    const KEEPOUT_GUTTER_FRAC = 0.014;

    const VOLTAGE_COLORS = {
        '33kV': '#d32f2f',
        KV_33: '#d32f2f',
        '11kV': '#f9a825',
        KV_11: '#f9a825',
        LT: '#388e3c',
        'LT': '#388e3c'
    };

    const STRUCTURE_COLOR = '#1565c0';

    /** Max ground width (m) across the printed map hole before Auto/Multi splits pages. */
    const MAX_CLEAR_MAP_WIDTH_M = 380;
    /** Overlap between adjacent atlas sheets (keeps edge poles readable). */
    const SHEET_OVERLAP = 0.06;
    /** Padding around network bounds when planning sheets (m). */
    const NETWORK_BOUNDS_PAD_M = 20;

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
    /** User-framed page 1 atlas (zoom/pan), used for review + PDF. */
    let manualAtlasLocked = false;
    let pageOneBounds = null;
    /** Per-sheet custom frames: index → {south,west,north,east} */
    let sheetOverrides = Object.create(null);
    /** After Fit pages: free pan/zoom per sheet; frame size/aspect stays fixed. */
    let previewLayoutActive = false;
    /** index → true once user clicked Save this page */
    let sheetFinalized = Object.create(null);
    /** Ignore map move/zoom from fitBounds while navigating sheets. */
    let suppressMapDirty = false;

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
        if (lr.width < 8 || lr.height < 8) return null;
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

    function getKeyPlanLayoutInMapHole() {
        const hole = getMapHoleRectInViewport();
        const el = $('printFrameKeyPlan');
        const vp = document.querySelector('.viewer-viewport');
        if (!hole || !el || !vp || el.classList.contains('is-hidden')) return null;
        const kr = el.getBoundingClientRect();
        if (kr.width < 8 || kr.height < 8) return null;
        const vr = vp.getBoundingClientRect();
        const left = kr.left - vr.left;
        const top = kr.top - vr.top;
        return {
            relLeft: (left - hole.left) / hole.w,
            relTop: (top - hole.top) / hole.h,
            relWidth: kr.width / hole.w,
            relHeight: kr.height / hole.h
        };
    }

    /**
     * Pixel insets inside the map hole that must stay clear of network framing.
     * Legend = bottom-right; key plan = top-left (multi-sheet only).
     * @param {{includeKeyPlan?: boolean}} [opts]
     */
    function getHoleKeepOutPads(hole, opts) {
        if (!hole || hole.w < 40 || hole.h < 40) {
            return { left: 0, top: 0, right: 0, bottom: 0 };
        }
        const gutter = Math.max(8, Math.min(hole.w, hole.h) * KEEPOUT_GUTTER_FRAC);
        const includeKeyPlan = opts && opts.includeKeyPlan != null
            ? !!opts.includeKeyPlan
            : sheetPlan.length > 1;

        let right = hole.w * LEGEND_KEEPOUT_W_FRAC + gutter;
        let bottom = hole.h * LEGEND_KEEPOUT_H_FRAC + gutter;
        const liveLeg = getLegendLayoutInMapHole();
        if (liveLeg && liveLeg.relWidth > 0.05 && liveLeg.relHeight > 0.05) {
            // Reserve from legend's left/top edges out to the BR corner of the hole
            right = Math.max(0, (1 - liveLeg.relLeft) * hole.w) + gutter;
            bottom = Math.max(0, (1 - liveLeg.relTop) * hole.h) + gutter;
        }

        let left = 0;
        let top = 0;
        if (includeKeyPlan) {
            left = hole.w * KEYPLAN_KEEPOUT_W_FRAC + gutter;
            top = hole.h * KEYPLAN_KEEPOUT_H_FRAC + gutter;
            const liveKp = getKeyPlanLayoutInMapHole();
            if (liveKp && liveKp.relWidth > 0.05 && liveKp.relHeight > 0.05) {
                left = Math.max(0, (liveKp.relLeft + liveKp.relWidth) * hole.w) + gutter;
                top = Math.max(0, (liveKp.relTop + liveKp.relHeight) * hole.h) + gutter;
            }
        }

        // Keep a large clear rectangle so framing stays readable (map not under overlays).
        // Clear area must stay ≥ ~48% of the hole on each axis.
        const maxSide = (frac) => Math.floor(hole.w * frac);
        const maxVert = (frac) => Math.floor(hole.h * frac);
        right = Math.min(right, maxSide(0.38));
        bottom = Math.min(bottom, maxVert(0.42));
        left = Math.min(left, maxSide(0.28));
        top = Math.min(top, maxVert(0.30));
        if (left + right > hole.w * 0.52) {
            const scale = (hole.w * 0.52) / Math.max(1, left + right);
            left *= scale;
            right *= scale;
        }
        if (top + bottom > hole.h * 0.52) {
            const scale = (hole.h * 0.52) / Math.max(1, top + bottom);
            top *= scale;
            bottom *= scale;
        }
        return { left, top, right, bottom };
    }

    /** Export-page AABB for the key plan box (matches drawKeyPlan). */
    function keyPlanExportRect(mapX, mapY, mapW, mapH, scale) {
        const boxW = Math.min(Math.max(mapW * 0.26, 190 * scale), mapW * 0.36);
        const boxH = Math.min(Math.max(mapH * 0.28, 160 * scale), mapH * 0.38);
        const margin = 14 * scale;
        return {
            x: mapX + margin,
            y: mapY + margin,
            w: boxW,
            h: boxH
        };
    }

    /**
     * Overlay panels to treat as hard obstacles for labels / framing helpers.
     * @param {HTMLCanvasElement|HTMLImageElement|null} [legendImg]
     */
    function mapOverlayKeepOutBoxes(mapX, mapY, mapW, mapH, scale, legendImg) {
        const gutter = Math.max(8, mapW * 0.01);
        const boxes = [];
        if (legendImg && legendImg.width && legendImg.height) {
            const lr = legendExportRect(mapX, mapY, mapW, mapH, legendImg);
            boxes.push({
                x: lr.x - gutter,
                y: lr.y - gutter,
                w: lr.w + gutter * 2,
                h: lr.h + gutter * 2
            });
        } else {
            const legendW = Math.min(mapW * LEGEND_KEEPOUT_W_FRAC, mapW * 0.48);
            const legendH = Math.min(mapH * LEGEND_KEEPOUT_H_FRAC, mapH * 0.55);
            boxes.push({
                x: mapX + mapW - legendW - gutter,
                y: mapY + mapH - legendH - gutter,
                w: legendW + gutter,
                h: legendH + gutter
            });
        }
        if (sheetPlan.length > 1) {
            const kp = keyPlanExportRect(mapX, mapY, mapW, mapH, scale);
            boxes.push({
                x: kp.x - gutter,
                y: kp.y - gutter,
                w: kp.w + gutter * 2,
                h: kp.h + gutter * 2
            });
        }
        return boxes;
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
        let w = Math.min(mapW * 0.28, mapW * 0.34);
        let h = w * aspect;
        const maxH = mapH - margin * 2;
        const maxW = mapW * 0.36;
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
        return `<svg class="pf-pole-swatch" width="14" height="14" viewBox="0 0 20 20" aria-hidden="true" role="presentation">
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
        // Defer fit until layout paints full table height, then re-frame
        // network into the clear area (legend / key plan reserved).
        requestAnimationFrame(() => {
            fitLegendPanelInFrame();
            if (!printEnabled) return;
            // In layout preview, do not snap the map — user pans/zooms freely.
            if (previewLayoutActive) return;
            const s = currentSheet();
            if (s && map && nodes && nodes.length) {
                fitBoundsToMapHole(s.bounds, false);
            }
        });
    }

    function enterPreviewLayout(opts) {
        const options = opts || {};
        previewLayoutActive = true;
        if (!options.keepFinalized) sheetFinalized = Object.create(null);
        const overlay = $('printOverlay');
        if (overlay) overlay.classList.add('is-preview-layout');
        if (sheetPlan[0] && sheetPlan[0].bounds) {
            pageOneBounds = sheetPlan[0].bounds;
        }
        syncPreviewToolbar();
        syncReviewModeUi();
        updateSheetNavUI();
    }

    function exitPreviewLayout() {
        previewLayoutActive = false;
        sheetFinalized = Object.create(null);
        const overlay = $('printOverlay');
        if (overlay) overlay.classList.remove('is-preview-layout');
        syncPreviewToolbar();
    }

    function finalizedCount() {
        return Object.keys(sheetFinalized).filter(function (k) {
            return sheetFinalized[k] && sheetPlan[Number(k)];
        }).length;
    }

    function unfinalizedPageNumbers() {
        const out = [];
        for (let i = 0; i < sheetPlan.length; i++) {
            if (!sheetFinalized[i]) out.push(i + 1);
        }
        return out;
    }

    function syncPreviewToolbar() {
        const setBtn = $('btnSetPrintPageOne');
        if (setBtn) {
            const n = currentSheetIndex + 1;
            const saved = !!sheetFinalized[currentSheetIndex];
            setBtn.classList.remove('print-simple-hide');
            setBtn.classList.toggle('is-active', previewLayoutActive);
            setBtn.classList.toggle('is-saved', saved);
            if (!previewLayoutActive || !sheetPlan.length) {
                setBtn.textContent = 'Save this page';
                setBtn.title = 'After Fit pages: pan/zoom the map, then save this page’s layout';
            } else {
                setBtn.textContent = saved ? `Page ${n} saved ✓` : `Save page ${n}`;
                setBtn.title = saved
                    ? 'Layout saved for print. Pan/zoom and save again to update.'
                    : 'Save the current map view for this page (print frame stays fixed)';
            }
            setBtn.disabled = !printEnabled || !sheetPlan.length;
        }
        const pdfBtn = $('btnExportPrintPdf');
        if (pdfBtn && previewLayoutActive && sheetPlan.length) {
            const done = finalizedCount();
            const total = sheetPlan.length;
            pdfBtn.title =
                done < total
                    ? `Print PDF (${done}/${total} pages saved — unsaved pages use planned framing)`
                    : `Print PDF — all ${total} pages saved`;
        }
    }

    function setPrintEnabled(on) {
        printEnabled = !!on;
        const overlay = $('printOverlay');
        const btn = $('btnTogglePrintLayout');
        const headerBtn = $('btnHeaderPrint');
        const bar = $('printToolbar');
        if (overlay) {
            overlay.classList.toggle('hidden', !printEnabled);
            overlay.setAttribute('aria-hidden', printEnabled ? 'false' : 'true');
        }
        if (btn) btn.classList.toggle('is-active', printEnabled);
        if (headerBtn) {
            headerBtn.classList.toggle('active', printEnabled);
            headerBtn.classList.toggle('is-active', printEnabled);
        }
        if (bar) bar.classList.toggle('is-print-active', printEnabled);
        syncToolbarVisibility();
        if (printEnabled) {
            if (typeof activeView !== 'undefined' && activeView !== 'map') {
                const mapBtn = $('btnViewMap');
                if (mapBtn) mapBtn.click();
            }
            syncMetaFromSurvey();
            centerFrame();
            wirePreviewMapDirty();
            if (manualAtlasLocked && pageOneBounds) {
                buildSheetPlanFromPageOne(pageOneBounds);
            } else {
                buildSheetPlan(false);
            }
            maybeCrowdingToast();
            updateSheetNavUI();
            refreshFrameChrome();
            syncReviewModeUi();
            const sheet = currentSheet();
            if (sheet && map && nodes && nodes.length) {
                // Defer until frame/hole layout settles
                setTimeout(() => fitBoundsToMapHole(sheet.bounds, true), 60);
            }
            if (typeof hideMapSymbolEditModal === 'function') hideMapSymbolEditModal();
            if (!manualAtlasLocked) {
                const target = getTargetPageCount();
                showToast(target === 'auto'
                    ? 'Choose Fit in pages, click Fit pages, then Print PDF.'
                    : `Click Fit pages for ${target} page${target === 1 ? '' : 's'}, review, then Print PDF.`);
            }
        } else {
            exitPreviewLayout();
            syncReviewModeUi();
        }
    }

    function getPrintMode() {
        const el = $('printPageMode');
        const v = el && el.value;
        return (v === 'single' || v === 'multi') ? v : 'auto';
    }

    /** User "Fit in" control: 'auto' or integer page count. */
    function getTargetPageCount() {
        const el = $('printPageCount');
        const v = el && el.value;
        if (!v || v === 'auto') return 'auto';
        const n = parseInt(v, 10);
        return Number.isFinite(n) && n >= 1 ? Math.min(16, n) : 'auto';
    }

    function setLegacyModeFromPageCount(count) {
        const modeEl = $('printPageMode');
        if (!modeEl) return;
        if (count === 'auto') modeEl.value = 'auto';
        else if (count === 1) modeEl.value = 'single';
        else modeEl.value = 'multi';
    }

    /**
     * Choose rows×cols with cells ≤ targetPages that best matches network shape.
     * Prefers using more pages (clearer) when aspect is similar.
     */
    function choosePageGrid(targetPages, netW, netH, pageAspect) {
        const n = Math.max(1, targetPages | 0);
        let best = null;
        for (let cols = 1; cols <= n; cols++) {
            for (let rows = 1; rows <= Math.floor(n / cols); rows++) {
                const cells = rows * cols;
                const tileAspect = (netW / cols) / Math.max(1e-6, netH / rows);
                const aspectPenalty = Math.abs(Math.log(Math.max(1e-6, tileAspect / pageAspect)));
                const underusePenalty = (n - cells) * 0.08;
                const score = aspectPenalty + underusePenalty;
                if (
                    !best ||
                    score < best.score - 1e-9 ||
                    (Math.abs(score - best.score) < 1e-9 && cells > best.rows * best.cols)
                ) {
                    best = { rows, cols, score };
                }
            }
        }
        return best || { rows: 1, cols: 1, score: 0 };
    }

    /** Tile the whole network into ≤ N pages (fit-within-N). */
    function buildSheetPlanForCount(targetPages) {
        const net = getNetworkBounds();
        if (!net) {
            sheetPlan = [];
            currentSheetIndex = 0;
            return sheetPlan;
        }
        const n = Math.max(1, targetPages | 0);
        if (n === 1) {
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

        let aspect = mapHoleAspect(n > 1);
        if (!(aspect > 0.2 && aspect < 8)) aspect = mapHoleAspect(false);
        if (!(aspect > 0.2 && aspect < 8)) {
            const page = getPageMm();
            aspect = page.w / (page.h * (1 - HEADER_FRAC - FOOTER_FRAC));
        }

        const size = boundsSizeMeters(net);
        const grid = choosePageGrid(n, size.w, size.h, aspect);
        const rows = grid.rows;
        const cols = grid.cols;

        // Cover the whole network: tile size so rows×cols spans net with overlap.
        const tileW = size.w / Math.max(1e-6, cols - (cols - 1) * SHEET_OVERLAP);
        const tileH = size.h / Math.max(1e-6, rows - (rows - 1) * SHEET_OVERLAP);
        const stepW = tileW * (1 - SHEET_OVERLAP);
        const stepH = tileH * (1 - SHEET_OVERLAP);
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

        // Drop empty edge tiles; keep full cover if everything has poles.
        const nonempty = tiles.filter((t) => sheetStatsForBounds(t.bounds).poles > 0);
        sheetPlan = (nonempty.length ? nonempty : tiles).map((t, i) => ({ ...t, index: i }));
        currentSheetIndex = 0;
        return sheetPlan;
    }

    function mapHoleAspect(includeKeyPlan) {
        const hole = getMapHoleRectInViewport();
        if (hole && hole.w > 40 && hole.h > 40) {
            const ko = getHoleKeepOutPads(hole, { includeKeyPlan: !!includeKeyPlan });
            const clearW = Math.max(48, hole.w - ko.left - ko.right);
            const clearH = Math.max(48, hole.h - ko.top - ko.bottom);
            return clearW / clearH;
        }
        const page = getPageMm();
        const mapHFrac = 1 - HEADER_FRAC - FOOTER_FRAC;
        // Approximate clear aspect when hole is not ready (legend BR + optional key plan TL)
        const legW = LEGEND_KEEPOUT_W_FRAC;
        const legH = LEGEND_KEEPOUT_H_FRAC;
        const kpW = includeKeyPlan ? KEYPLAN_KEEPOUT_W_FRAC : 0;
        const kpH = includeKeyPlan ? KEYPLAN_KEEPOUT_H_FRAC : 0;
        const clearW = Math.max(0.35, 1 - legW - kpW);
        const clearH = Math.max(0.35, 1 - legH - kpH);
        return (page.w * clearW) / (page.h * mapHFrac * clearH);
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
     * Build atlas tiles. Uses "Fit in N pages" when set; otherwise Auto scale tiling.
     */
    function buildSheetPlan(forceMulti) {
        clearManualAtlasSoft();
        const target = getTargetPageCount();
        if (target !== 'auto') {
            setLegacyModeFromPageCount(target);
            return buildSheetPlanForCount(target);
        }
        setLegacyModeFromPageCount('auto');

        const net = getNetworkBounds();
        if (!net) {
            sheetPlan = [];
            currentSheetIndex = 0;
            return sheetPlan;
        }

        const mode = forceMulti ? 'multi' : getPrintMode();
        // Tile aspect matches the clear framing area (legend / key plan reserved).
        const multiLikely = mode === 'multi' || forceMulti;
        let aspect = mapHoleAspect(multiLikely);
        if (!(aspect > 0.2 && aspect < 8)) {
            aspect = mapHoleAspect(false);
        }
        if (!(aspect > 0.2 && aspect < 8)) {
            const page = getPageMm();
            const mapHFrac = 1 - HEADER_FRAC - FOOTER_FRAC;
            aspect = page.w / (page.h * mapHFrac);
        }
        const size = boundsSizeMeters(net);
        const maxW = MAX_CLEAR_MAP_WIDTH_M;
        let maxH = maxW / aspect;
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

        maxH = maxW / aspect;
        let tileW = maxW;
        let tileH = maxH;
        let stepW = tileW * (1 - SHEET_OVERLAP);
        let stepH = tileH * (1 - SHEET_OVERLAP);
        let cols = Math.max(1, Math.ceil(size.w / stepW));
        let rows = Math.max(1, Math.ceil(size.h / stepH));

        // Explicit Multi with a network that still fits one tile: split on the
        // long axis so pages are not identical copies of the whole map.
        if ((mode === 'multi' || forceMulti) && cols === 1 && rows === 1 && (nodes || []).length > 2) {
            if (size.w >= size.h) {
                cols = 2;
                tileW = size.w / (2 - SHEET_OVERLAP);
                stepW = tileW * (1 - SHEET_OVERLAP);
                tileH = tileW / aspect;
                stepH = tileH * (1 - SHEET_OVERLAP);
                rows = Math.max(1, Math.ceil(size.h / stepH));
            } else {
                rows = 2;
                tileH = size.h / (2 - SHEET_OVERLAP);
                stepH = tileH * (1 - SHEET_OVERLAP);
                tileW = tileH * aspect;
                stepW = tileW * (1 - SHEET_OVERLAP);
                cols = Math.max(1, Math.ceil(size.w / stepW));
            }
        }

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

        if (currentSheetIndex >= sheetPlan.length) currentSheetIndex = 0;
        return sheetPlan;
    }

    function clearManualAtlasSoft() {
        // Drop per-page overrides when rebuilding from Fit in N / Auto — keep
        // locked flag only if still using page-1 atlas path elsewhere.
        sheetOverrides = Object.create(null);
        manualAtlasLocked = false;
        pageOneBounds = null;
        sheetFinalized = Object.create(null);
    }

    function currentSheet() {
        return sheetPlan[currentSheetIndex] || null;
    }

    /** Geographic bounds currently visible in the clear map-hole area (not under legend). */
    function getClearMapLatLngBounds() {
        if (!map || typeof L === 'undefined') return null;
        const hole = getMapHoleRectInViewport();
        if (!hole || hole.w < 40 || hole.h < 40) return null;
        const ko = getHoleKeepOutPads(hole, {
            includeKeyPlan: sheetPlan.length > 1 || manualAtlasLocked
        });
        const edgePad = 12;
        let left = hole.left + edgePad + ko.left;
        let top = hole.top + edgePad + ko.top;
        let right = hole.left + hole.w - edgePad - ko.right;
        let bottom = hole.top + hole.h - edgePad - ko.bottom;
        if (right - left < 48 || bottom - top < 48) {
            left = hole.left + edgePad;
            top = hole.top + edgePad;
            right = hole.left + hole.w - edgePad;
            bottom = hole.top + hole.h - edgePad;
        }

        const mapEl = map.getContainer();
        const vp = document.querySelector('.viewer-viewport');
        if (!mapEl || !vp) return null;
        const mr = mapEl.getBoundingClientRect();
        const vr = vp.getBoundingClientRect();
        const ox = vr.left - mr.left;
        const oy = vr.top - mr.top;

        const nw = map.containerPointToLatLng(L.point(left + ox, top + oy));
        const se = map.containerPointToLatLng(L.point(right + ox, bottom + oy));
        const bounds = L.latLngBounds(nw, se);
        return bounds.isValid() ? bounds : null;
    }

    function offsetBoundsMeters(bounds, eastM, southM) {
        const c = bounds.getCenter();
        const { mLat, mLng } = metersPerDeg(c.lat);
        const dLat = -southM / mLat;
        const dLng = eastM / mLng;
        return L.latLngBounds(
            [bounds.getSouth() + dLat, bounds.getWest() + dLng],
            [bounds.getNorth() + dLat, bounds.getEast() + dLng]
        );
    }

    function boundsToPlain(b) {
        if (!b || !b.isValid()) return null;
        return {
            south: b.getSouth(),
            west: b.getWest(),
            north: b.getNorth(),
            east: b.getEast()
        };
    }

    function plainToBounds(p) {
        if (!p) return null;
        const b = L.latLngBounds([p.south, p.west], [p.north, p.east]);
        return b.isValid() ? b : null;
    }

    function applySheetOverrides() {
        Object.keys(sheetOverrides).forEach((key) => {
            const i = Number(key);
            if (!sheetPlan[i]) return;
            const b = plainToBounds(sheetOverrides[key]);
            if (b) sheetPlan[i].bounds = b;
        });
    }

    /**
     * Save the current map view into the active sheet — only via Set page button.
     * (Do not hook dragend/zoomend; that fights Leaflet and feels unstable.)
     */
    function captureCurrentSheetFromView(opts) {
        const options = opts || {};
        if (!printEnabled || !map) return false;
        if (!sheetPlan.length) return false;
        fitLegendPanelInFrame();
        const bounds = getClearMapLatLngBounds();
        if (!bounds || !bounds.isValid()) {
            if (!options.quiet) showToast('Could not read the print frame.');
            return false;
        }
        const i = currentSheetIndex;
        if (!sheetPlan[i]) return false;
        sheetPlan[i].bounds = bounds;
        sheetOverrides[i] = boundsToPlain(bounds);
        sheetFinalized[i] = true;
        if (i === 0) pageOneBounds = bounds;
        manualAtlasLocked = true;
        refreshFrameChrome();
        updateSheetNavUI();
        syncPreviewToolbar();
        syncReviewModeUi();
        if (!options.quiet) {
            const next = i + 1 < sheetPlan.length ? i + 1 : -1;
            showToast(
                next > 0
                    ? `Page ${i + 1} saved — go to page ${next + 1}, adjust, then Save`
                    : `Page ${i + 1} saved — Print PDF when ready`
            );
            if (next > 0 && options.advance !== false) {
                setTimeout(function () {
                    goToSheet(next, true);
                }, 280);
            }
        }
        return true;
    }

    /**
     * Build atlas from the user's framed page 1: same ground size/zoom, tiled
     * across the network. Page 1 stays exactly as framed.
     */
    function buildSheetPlanFromPageOne(pageOne) {
        if (!pageOne || !pageOne.isValid()) {
            sheetPlan = [];
            return sheetPlan;
        }
        const net = getNetworkBounds();
        const tileSize = boundsSizeMeters(pageOne);
        const tileW = Math.max(40, tileSize.w);
        const tileH = Math.max(40, tileSize.h);
        const stepW = tileW * (1 - SHEET_OVERLAP);
        const stepH = tileH * (1 - SHEET_OVERLAP);
        const { mLat, mLng } = metersPerDeg(tileSize.midLat);

        const tilesByKey = Object.create(null);
        const addTile = (bounds, row, col) => {
            if (!bounds || !bounds.isValid()) return;
            if (sheetStatsForBounds(bounds).poles <= 0 && !(row === 0 && col === 0)) return;
            const key = `${row}:${col}`;
            if (tilesByKey[key]) return;
            tilesByKey[key] = {
                bounds,
                row,
                col,
                rows: 0,
                cols: 0,
                index: 0
            };
        };

        addTile(pageOne, 0, 0);

        if (net && net.isValid()) {
            const westNeed = Math.max(0, (pageOne.getWest() - net.getWest()) * mLng);
            const eastNeed = Math.max(0, (net.getEast() - pageOne.getEast()) * mLng);
            const northNeed = Math.max(0, (net.getNorth() - pageOne.getNorth()) * mLat);
            const southNeed = Math.max(0, (pageOne.getSouth() - net.getSouth()) * mLat);
            const colsWest = Math.ceil(westNeed / stepW);
            const colsEast = Math.ceil(eastNeed / stepW);
            const rowsNorth = Math.ceil(northNeed / stepH);
            const rowsSouth = Math.ceil(southNeed / stepH);

            for (let r = -rowsNorth; r <= rowsSouth; r++) {
                for (let c = -colsWest; c <= colsEast; c++) {
                    if (r === 0 && c === 0) continue;
                    const b = offsetBoundsMeters(pageOne, c * stepW, r * stepH);
                    addTile(b, r, c);
                }
            }
        }

        const tiles = Object.keys(tilesByKey).map((k) => tilesByKey[k]);
        tiles.sort((a, b) => {
            if (a.row === 0 && a.col === 0) return -1;
            if (b.row === 0 && b.col === 0) return 1;
            if (a.row !== b.row) return a.row - b.row;
            return a.col - b.col;
        });

        const rowMin = tiles.reduce((m, t) => Math.min(m, t.row), 0);
        const colMin = tiles.reduce((m, t) => Math.min(m, t.col), 0);
        const rowMax = tiles.reduce((m, t) => Math.max(m, t.row), 0);
        const colMax = tiles.reduce((m, t) => Math.max(m, t.col), 0);
        sheetPlan = tiles.map((t, i) => ({
            ...t,
            row: t.row - rowMin,
            col: t.col - colMin,
            rows: rowMax - rowMin + 1,
            cols: colMax - colMin + 1,
            index: i
        }));
        applySheetOverrides();
        currentSheetIndex = 0;
        return sheetPlan;
    }

    function syncReviewModeUi() {
        const overlay = $('printOverlay');
        if (overlay) {
            overlay.classList.toggle('is-sheet-review', sheetPlan.length > 1 || previewLayoutActive);
            overlay.classList.toggle('is-preview-layout', !!previewLayoutActive);
        }
        const hint = $('printWorkflowHint');
        if (hint) {
            const target = getTargetPageCount();
            const n = currentSheetIndex + 1;
            const total = sheetPlan.length;
            const saved = !!sheetFinalized[currentSheetIndex];
            const done = finalizedCount();
            if (!printEnabled) {
                hint.textContent = 'Choose Fit in pages · Fit pages · preview each page · Save · Print PDF.';
            } else if (previewLayoutActive && total > 0) {
                hint.textContent =
                    `Preview page ${n} of ${total}` +
                    (saved ? ' · saved' : ' · pan/zoom freely') +
                    ` · ${done}/${total} saved — Save this page, then Print PDF.`;
            } else if (manualAtlasLocked && total > 1) {
                const customized = sheetOverrides[currentSheetIndex] ? ' · saved' : '';
                hint.textContent = `Page ${n} of ${total}${customized} — pan/zoom, then Save page ${n}.`;
            } else if (total > 1) {
                hint.textContent = `Page ${n} of ${total} — Fit pages first, then preview and Save each page.`;
            } else if (target !== 'auto') {
                hint.textContent = target === 1
                    ? 'Fitted to 1 page — pan/zoom if needed, Save this page, then Print PDF.'
                    : `Fitted within ${target} pages — preview, Save each page, then Print PDF.`;
            } else {
                hint.textContent = 'Choose how many pages, click Fit pages, preview & Save each page, then Print PDF.';
            }
        }
        syncPreviewToolbar();
        const simpleHint = document.querySelector('.print-simple-hint');
        if (simpleHint && previewLayoutActive && sheetPlan.length) {
            simpleHint.textContent =
                `Page ${currentSheetIndex + 1}/${sheetPlan.length} · Save layout · Print PDF`;
        } else if (simpleHint) {
            simpleHint.textContent = 'Fit in N pages · preview · Save · Print PDF';
        }
    }

    function onSetPageButtonClick() {
        if (!previewLayoutActive && sheetPlan.length) {
            enterPreviewLayout({ keepFinalized: true });
        }
        if (sheetPlan.length >= 1) {
            if (!manualAtlasLocked && sheetPlan[0] && sheetPlan[0].bounds) {
                manualAtlasLocked = true;
                pageOneBounds = sheetPlan[0].bounds;
            }
            captureCurrentSheetFromView({ quiet: false, advance: sheetPlan.length > 1 });
            return;
        }
        setPageOneFromView();
    }

    function setPageOneFromView() {
        if (!printEnabled) setPrintEnabled(true);
        if (!map || !nodes || !nodes.length) {
            showToast('Load a survey with poles first.');
            return;
        }
        fitLegendPanelInFrame();
        const bounds = getClearMapLatLngBounds();
        if (!bounds || !bounds.isValid()) {
            showToast('Could not read the print frame — try Center, then frame again.');
            return;
        }
        if (sheetStatsForBounds(bounds).poles <= 0) {
            showToast('No poles in the frame — zoom/pan so poles sit in the clear map area.');
            return;
        }

        pageOneBounds = bounds;
        manualAtlasLocked = true;
        sheetOverrides = Object.create(null);
        sheetOverrides[0] = boundsToPlain(bounds);
        // Force multi page mode so key plan shows when useful
        const modeEl = $('printPageMode');
        if (modeEl && modeEl.value === 'single') modeEl.value = 'auto';

        buildSheetPlanFromPageOne(pageOneBounds);
        updateSheetNavUI();
        enterPreviewLayout({ keepFinalized: false });
        sheetFinalized[0] = true;
        syncReviewModeUi();
        refreshFrameChrome();
        fitBoundsToMapHole(pageOneBounds, true);

        const total = sheetPlan.length;
        showToast(
            total > 1
                ? `Page 1 saved · ${total} sheets — adjust each page, Save, then Print PDF`
                : 'Page 1 saved · network fits on one sheet'
        );

        if (total > 1) {
            setTimeout(() => {
                goToSheet(1, true);
                syncReviewModeUi();
            }, 500);
        }
    }

    function clearManualAtlas() {
        manualAtlasLocked = false;
        pageOneBounds = null;
        sheetOverrides = Object.create(null);
        exitPreviewLayout();
        syncReviewModeUi();
    }

    function fitBoundsToMapHole(bounds, animate, opts) {
        if (!map || !bounds || !bounds.isValid()) return;
        const options = opts || {};
        suppressMapDirty = true;
        const clearDirty = function () {
            setTimeout(function () {
                suppressMapDirty = false;
            }, 400);
        };
        if (map.once) {
            map.once('moveend', clearDirty);
            map.once('zoomend', clearDirty);
        } else {
            clearDirty();
        }
        const hole = getMapHoleRectInViewport();
        if (!hole || hole.w < 40 || hole.h < 40) {
            map.fitBounds(bounds, { padding: [16, 16], animate: !!animate, maxZoom: 19 });
            return;
        }
        // Frame the network into the CLEAR part of the map hole only — never under
        // the legend (BR) or key plan (TL). Keep-outs are capped so the clear
        // rect stays large enough for multipage tiles to stay distinct.
        const edgePad = options.tight ? 6 : 10;
        const ko = getHoleKeepOutPads(hole, { includeKeyPlan: sheetPlan.length > 1 });
        let clearLeft = hole.left + edgePad + ko.left;
        let clearTop = hole.top + edgePad + ko.top;
        let clearRight = hole.left + hole.w - edgePad - ko.right;
        let clearBottom = hole.top + hole.h - edgePad - ko.bottom;

        const minClearW = Math.max(120, hole.w * 0.48);
        const minClearH = Math.max(100, hole.h * 0.48);
        if (clearRight - clearLeft < minClearW) {
            const mid = (clearLeft + clearRight) / 2;
            clearLeft = mid - minClearW / 2;
            clearRight = mid + minClearW / 2;
        }
        if (clearBottom - clearTop < minClearH) {
            const mid = (clearTop + clearBottom) / 2;
            clearTop = mid - minClearH / 2;
            clearBottom = mid + minClearH / 2;
        }
        // Clamp back inside the hole
        clearLeft = Math.max(hole.left + edgePad, clearLeft);
        clearTop = Math.max(hole.top + edgePad, clearTop);
        clearRight = Math.min(hole.left + hole.w - edgePad, clearRight);
        clearBottom = Math.min(hole.top + hole.h - edgePad, clearBottom);

        const vp = viewportRect();
        map.invalidateSize();
        map.fitBounds(bounds, {
            paddingTopLeft: [Math.max(0, clearLeft), Math.max(0, clearTop)],
            paddingBottomRight: [
                Math.max(0, vp.w - clearRight),
                Math.max(0, vp.h - clearBottom)
            ],
            animate: !!animate,
            maxZoom: 19
        });
    }

    function maybeCrowdingToast() {
        if (getTargetPageCount() !== 'auto') return;
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
        const showNav = multi || (previewLayoutActive && sheetPlan.length > 0);
        if (nav) nav.classList.toggle('is-hidden', !showNav);
        if (!strip) return;
        strip.innerHTML = '';
        sheetPlan.forEach((s, i) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            const saved = !!sheetFinalized[i];
            btn.className =
                'print-sheet-chip' +
                (i === currentSheetIndex ? ' is-active' : '') +
                (saved ? ' is-saved' : '');
            btn.textContent = saved ? String(i + 1) + '✓' : String(i + 1);
            btn.title =
                `Sheet ${i + 1} of ${sheetPlan.length}` +
                (saved ? ' · layout saved' : ' · not saved yet') +
                (s.rows > 1 || s.cols > 1 ? ` (R${s.row + 1}·C${s.col + 1})` : '');
            btn.addEventListener('click', () => goToSheet(i, true));
            strip.appendChild(btn);
        });
        if (prev) prev.disabled = !multi || currentSheetIndex <= 0;
        if (next) next.disabled = !multi || currentSheetIndex >= sheetPlan.length - 1;
        syncReviewModeUi();
    }

    function goToSheet(index, animate) {
        if (!sheetPlan.length) {
            if (manualAtlasLocked && pageOneBounds) buildSheetPlanFromPageOne(pageOneBounds);
            else buildSheetPlan(false);
        }
        if (!sheetPlan.length) return;
        currentSheetIndex = Math.max(0, Math.min(index, sheetPlan.length - 1));
        applySheetOverrides();
        const sheet = currentSheet();
        // Temporarily allow reframe for navigation even in preview.
        const wasPreview = previewLayoutActive;
        if (sheet) fitBoundsToMapHole(sheet.bounds, animate !== false);
        previewLayoutActive = wasPreview;
        refreshFrameChrome();
        updateSheetNavUI();
        syncPreviewToolbar();
        syncReviewModeUi();
    }

    function rebuildSheetsAndShow(opts) {
        const options = opts || {};
        clearManualAtlas();
        buildSheetPlan(!!options.forceMulti);
        maybeCrowdingToast();
        updateSheetNavUI();
        const sheet = currentSheet();
        if (sheet) {
            fitBoundsToMapHole(sheet.bounds, options.animate !== false, {
                tight: !!options.autoFit,
            });
        }
        refreshFrameChrome();
        if (sheetPlan.length) enterPreviewLayout({ keepFinalized: false });
        syncReviewModeUi();
    }

    function fitNetworkInFrame() {
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
        lastCrowdingToastKey = '';
        const target = getTargetPageCount();
        setLegacyModeFromPageCount(target);
        rebuildSheetsAndShow({
            animate: true,
            forceMulti: target === 'auto' ? false : target > 1,
            autoFit: true,
        });
        const total = sheetPlan.length;
        if (target === 'auto') {
            showToast(total > 1
                ? `Auto: ${total} pages — preview, Save each page, then Print PDF`
                : 'Auto: 1 page — pan/zoom if needed, Save, then Print PDF');
        } else {
            showToast(total > 1
                ? `Fitted in ${total} pages — preview each page, Save layout, then Print PDF`
                : 'Fitted on 1 page — Save this page, then Print PDF');
        }
    }

    function onPrintPageCountChanged() {
        lastCrowdingToastKey = '';
        setLegacyModeFromPageCount(getTargetPageCount());
        if (!printEnabled) setPrintEnabled(true);
        else rebuildSheetsAndShow({ animate: true, autoFit: true });
        syncReviewModeUi();
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

    /* ── Drag frame / swipe sheets ── */
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
            // Preview layout: keep print frame fixed — swipe pages only (don't move frame).
            const lockFrame = previewLayoutActive || sheetPlan.length > 1;
            dragState = {
                startX: e.clientX,
                startY: e.clientY,
                origLeft: frameLeft,
                origTop: frameTop,
                reviewSwipe: lockFrame && sheetPlan.length > 1,
                lockFrame,
                moved: false
            };
            if (dragState.reviewSwipe) frame.classList.add('is-swiping');
            document.addEventListener('mousemove', onDragMove);
            document.addEventListener('mouseup', onDragEnd);
        };

        frame.addEventListener('mousedown', startDrag);

        // Touch swipe for sheet review
        let touchState = null;
        frame.addEventListener('touchstart', (e) => {
            if (!printEnabled || sheetPlan.length <= 1) return;
            if (!e.target.closest('.print-frame-chrome')) return;
            const t = e.touches[0];
            if (!t) return;
            touchState = { x: t.clientX, y: t.clientY };
            frame.classList.add('is-swiping');
        }, { passive: true });
        frame.addEventListener('touchend', (e) => {
            frame.classList.remove('is-swiping');
            if (!touchState) return;
            const t = e.changedTouches[0];
            const dx = t ? t.clientX - touchState.x : 0;
            const dy = t ? t.clientY - touchState.y : 0;
            touchState = null;
            if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.15) return;
            if (dx < 0) goToSheet(currentSheetIndex + 1, true);
            else goToSheet(currentSheetIndex - 1, true);
        }, { passive: true });
    }

    function onDragMove(e) {
        if (!dragState) return;
        const dx = e.clientX - dragState.startX;
        const dy = e.clientY - dragState.startY;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragState.moved = true;
        // Preview / multi-sheet: do not move the print frame (area settings stay fixed).
        if (dragState.lockFrame || dragState.reviewSwipe) return;
        frameLeft = dragState.origLeft + dx;
        frameTop = dragState.origTop + dy;
        clampFrame();
        applyFrameStyle();
    }

    function onDragEnd(e) {
        const frame = $('printFrame');
        if (frame) frame.classList.remove('is-swiping');
        const state = dragState;
        dragState = null;
        document.removeEventListener('mousemove', onDragMove);
        document.removeEventListener('mouseup', onDragEnd);
        if (!state) return;
        if (state.reviewSwipe && state.moved) {
            const dx = (e && e.clientX != null ? e.clientX : state.startX) - state.startX;
            const dy = (e && e.clientY != null ? e.clientY : state.startY) - state.startY;
            if (Math.abs(dx) >= 56 && Math.abs(dx) >= Math.abs(dy) * 1.15) {
                if (dx < 0) goToSheet(currentSheetIndex + 1, true);
                else goToSheet(currentSheetIndex - 1, true);
            }
        }
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
            if (manualAtlasLocked && pageOneBounds) {
                buildSheetPlanFromPageOne(pageOneBounds);
                updateSheetNavUI();
                const sheet = currentSheet();
                if (sheet) fitBoundsToMapHole(sheet.bounds, false);
                refreshFrameChrome();
                syncReviewModeUi();
            } else {
                rebuildSheetsAndShow({ animate: false });
            }
        } else {
            refreshFrameChrome();
        }
    }

    function onPrintModeChanged() {
        lastCrowdingToastKey = '';
        if (!printEnabled) setPrintEnabled(true);
        else if (manualAtlasLocked && pageOneBounds) {
            buildSheetPlanFromPageOne(pageOneBounds);
            updateSheetNavUI();
            goToSheet(0, true);
            syncReviewModeUi();
        } else {
            rebuildSheetsAndShow({ animate: true, autoFit: true });
        }
    }

    function onSetPageOneClick(ev) {
        // Shift-click resets the atlas and clears per-page positions.
        if (manualAtlasLocked && ev && ev.shiftKey) {
            clearManualAtlas();
            buildSheetPlan(false);
            updateSheetNavUI();
            const sheet = currentSheet();
            if (sheet) fitBoundsToMapHole(sheet.bounds, true);
            refreshFrameChrome();
            showToast('Pages reset — choose Fit in and click Fit pages.');
            return;
        }
        onSetPageButtonClick();
    }

    function initSheetKeyboardNav() {
        document.addEventListener('keydown', (e) => {
            if (!printEnabled || sheetPlan.length <= 1) return;
            const tag = (e.target && e.target.tagName) || '';
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                goToSheet(currentSheetIndex - 1, true);
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                goToSheet(currentSheetIndex + 1, true);
            }
        });
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

        const { x: bx, y: by, w: boxW, h: boxH } = keyPlanExportRect(mapX, mapY, mapW, mapH, scale);

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
     * When sheetBounds is set (multipage), only draw poles/spans that belong on that sheet.
     */
    function drawNetworkIntoMapArea(ctx, mapX, mapY, mapW, mapH, keepOutBoxes, sheetBounds) {
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

        const poleOnSheet = (node) => {
            if (!sheetBounds || !sheetBounds.isValid()) return true;
            return pointInBounds(node.assetRef.latitude, node.assetRef.longitude, sheetBounds);
        };
        const edgeOnSheet = (from, to) => {
            if (!sheetBounds || !sheetBounds.isValid()) return true;
            return poleOnSheet(from) || poleOnSheet(to);
        };

        const inMap = (x, y, margin) => {
            const m = margin == null ? 0 : margin;
            return x >= mapX - m && x <= mapX + mapW + m && y >= mapY - m && y <= mapY + mapH + m;
        };

        const occupied = []; // axis-aligned boxes already taken
        const overlayKeepOuts = (keepOutBoxes && keepOutBoxes.length)
            ? keepOutBoxes
            : mapOverlayKeepOutBoxes(mapX, mapY, mapW, mapH, scale, null);
        overlayKeepOuts.forEach((b) => occupied.push({
            x: b.x, y: b.y, w: b.w, h: b.h, hard: true
        }));

        const inKeepOut = (x, y) => {
            for (let i = 0; i < overlayKeepOuts.length; i++) {
                const b = overlayKeepOuts[i];
                if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return true;
            }
            return false;
        };

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
            if (!poleOnSheet(node)) return;
            const p = toPage(node.assetRef.latitude, node.assetRef.longitude);
            // Never draw poles under legend / key plan
            if (inKeepOut(p.x, p.y)) return;
            if (!inMap(p.x, p.y, 6 * scale)) return;
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
            if (!edgeOnSheet(from, to)) return;
            const p1 = toPage(from.assetRef.latitude, from.assetRef.longitude);
            const p2 = toPage(to.assetRef.latitude, to.assetRef.longitude);
            // Skip segments wholly under overlays
            if (inKeepOut(p1.x, p1.y) && inKeepOut(p2.x, p2.y)) return;
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

        drawNetworkIntoMapArea(
            ctx,
            mapX,
            mapY,
            mapW,
            mapH,
            mapOverlayKeepOutBoxes(mapX, mapY, mapW, mapH, scale, legendShot),
            sheet && sheet.bounds
        );
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
                map.off('zoomend', onEnd);
                setTimeout(resolve, ms || 180);
            };
            const onEnd = () => finish();
            map.once('moveend', onEnd);
            map.once('zoomend', onEnd);
            // If fitBounds was a no-op (same view), moveend may not fire.
            setTimeout(finish, 900);
        });
    }

    /**
     * Apply sheet framing and wait until the map has actually moved.
     * Registers settle listeners BEFORE fitBounds so we never miss moveend.
     */
    async function frameSheetBounds(bounds, opts) {
        if (!map || !bounds || !bounds.isValid()) return;
        const options = opts || {};
        const settleMs = options.settleMs != null ? options.settleMs : 220;
        const settlePromise = waitForMapSettle(settleMs);
        try { map.invalidateSize(false); } catch (e) { /* ignore */ }
        fitBoundsToMapHole(bounds, false);
        await settlePromise;
        // Second pass after layout/legend settle — multipage export can race the frame.
        try { map.invalidateSize(false); } catch (e) { /* ignore */ }
        fitBoundsToMapHole(bounds, false);
        await waitForMapSettle(Math.min(160, settleMs));
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
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
            refreshLiveKeyPlan();
        }
        fitLegendPanelInFrame();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        await frameSheetBounds(sheet.bounds, {
            settleMs: options.settleMs != null ? options.settleMs : 240
        });
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
        if (manualAtlasLocked && pageOneBounds) {
            buildSheetPlanFromPageOne(pageOneBounds);
        } else if (!sheetPlan.length) {
            buildSheetPlan(false);
        }
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
        // Keep the current atlas + any per-page saves. Only build if empty.
        if (!sheetPlan.length) {
            if (manualAtlasLocked && pageOneBounds) {
                buildSheetPlanFromPageOne(pageOneBounds);
            } else {
                buildSheetPlan(false);
            }
        } else {
            applySheetOverrides();
        }
        maybeCrowdingToast();
        updateSheetNavUI();
        if (!sheetPlan.length) {
            showToast('Nothing to print — load poles first, then Fit pages.');
            return;
        }

        const missing = unfinalizedPageNumbers();
        if (missing.length && previewLayoutActive) {
            // Capture the page currently on screen so last tweaks aren't lost.
            captureCurrentSheetFromView({ quiet: true, advance: false });
            const still = unfinalizedPageNumbers();
            if (still.length) {
                const D = window.SlmDialog;
                let ok = true;
                const msg =
                    still.length === sheetPlan.length
                        ? 'No pages saved yet. Print using the planned framing for every page?'
                        : `Pages ${still.join(', ')} are not saved. Print those with planned framing?`;
                if (D && D.confirm) {
                    ok = await D.confirm({
                        title: 'Print without saving all pages?',
                        message: msg,
                        okLabel: 'Print PDF',
                        cancelLabel: 'Go back',
                    });
                }
                if (!ok) {
                    showToast('Save each page after pan/zoom, then Print PDF.');
                    return;
                }
            }
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
            syncReviewModeUi();
        }
    }

    function syncToolbarVisibility() {
        const bar = $('printToolbar');
        if (!bar) return;
        const isMap = typeof activeView === 'undefined' || activeView === 'map';
        bar.classList.toggle('is-print-active', !!printEnabled);
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
        if (manualAtlasLocked && pageOneBounds) {
            buildSheetPlanFromPageOne(pageOneBounds);
        } else {
            buildSheetPlan(false);
        }
        updateSheetNavUI();
        refreshFrameChrome();
    }

    function wirePreviewMapDirty() {
        if (!map || wirePreviewMapDirty._bound) return;
        wirePreviewMapDirty._bound = true;
        const markDirty = function () {
            if (suppressMapDirty || !previewLayoutActive || exportInProgress) return;
            if (!sheetFinalized[currentSheetIndex]) return;
            delete sheetFinalized[currentSheetIndex];
            syncPreviewToolbar();
            updateSheetNavUI();
        };
        map.on('dragend', markDirty);
        map.on('zoomend', markDirty);
    }

    const MAP_PRINT_ZOOM_STEP = 0.15;

    function initPrintLayout() {
        const toggle = $('btnTogglePrintLayout');
        if (toggle) {
            toggle.addEventListener('click', () => setPrintEnabled(!printEnabled));
        }
        const headerPrint = $('btnHeaderPrint');
        if (headerPrint) {
            headerPrint.addEventListener('click', () => setPrintEnabled(!printEnabled));
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
        const pageCountEl = $('printPageCount');
        if (pageCountEl) pageCountEl.addEventListener('change', onPrintPageCountChanged);
        ['printDrawingTitle', 'printSurveyor', 'printCompany', 'printDrawingNo', 'printScale'].forEach((id) => {
            const el = $(id);
            if (el) {
                el.addEventListener('input', refreshFrameChrome);
                el.addEventListener('change', refreshFrameChrome);
            }
        });
        const fitBtn = $('btnFitPrintFrame');
        if (fitBtn) fitBtn.addEventListener('click', fitNetworkInFrame);
        const setPageBtn = $('btnSetPrintPageOne');
        if (setPageBtn) setPageBtn.addEventListener('click', onSetPageOneClick);
        wirePreviewMapDirty();
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
        initSheetKeyboardNav();
        syncReviewModeUi();
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
