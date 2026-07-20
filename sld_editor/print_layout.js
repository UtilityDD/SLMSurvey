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

    let printEnabled = false;
    let frameLeft = 0;
    let frameTop = 0;
    let frameWidth = 520;
    let frameHeight = 368;
    let dragState = null;

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

    async function captureLegendPanel(captureScale) {
        const el = $('printFrameLegend');
        if (!el || typeof html2canvas !== 'function') return null;

        refreshFrameChrome();
        const prevMaxH = el.style.maxHeight;
        const prevOverflow = el.style.overflow;
        el.style.maxHeight = 'none';
        el.style.overflow = 'visible';

        try {
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
            const shot = await html2canvas(el, {
                backgroundColor: '#ffffff',
                scale: Math.max(2, captureScale),
                logging: false,
                useCORS: true,
                allowTaint: false
            });
            return shot;
        } catch (err) {
            console.warn('Legend capture failed, using vector fallback.', err);
            return null;
        } finally {
            el.style.maxHeight = prevMaxH;
            el.style.overflow = prevOverflow;
        }
    }

    function legendExportRect(mapX, mapY, mapW, mapH, legendImg) {
        const layout = getLegendLayoutInMapHole();
        const margin = 10;
        if (layout && layout.relWidth > 0 && layout.relHeight > 0) {
            return {
                x: mapX + layout.relLeft * mapW,
                y: mapY + layout.relTop * mapH,
                w: layout.relWidth * mapW,
                h: layout.relHeight * mapH
            };
        }
        const w = mapW * LEGEND_W_FRAC;
        const aspect = legendImg.height / Math.max(1, legendImg.width);
        const h = Math.min(mapH * 0.55, w * aspect);
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
        set('pfStats', `${(nodes || []).length} poles · ${(edges || []).length} spans`);
        set('pfRoute', formatDistanceLocal(totalRouteM()));

        const legendBody = $('pfLegendBody');
        if (legendBody) legendBody.innerHTML = buildLegendHtml();
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
            refreshFrameChrome();
            if (typeof hideMapSymbolEditModal === 'function') hideMapSymbolEditModal();
        }
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

        const latLngs = nodes.map((n) => [n.assetRef.latitude, n.assetRef.longitude]);
        const bounds = L.latLngBounds(latLngs);
        if (!bounds.isValid()) return;

        // Fit geographic bounds into the map-hole size (not full viewport)
        const pad = 28;
        map.invalidateSize();
        map.fitBounds(bounds, {
            paddingTopLeft: [hole.left - 0 + pad, hole.top - 0 + pad],
            paddingBottomRight: [
                Math.max(0, viewportRect().w - (hole.left + hole.w) + pad),
                Math.max(0, viewportRect().h - (hole.top + hole.h) + pad)
            ],
            animate: true,
            maxZoom: 19
        });
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
        refreshFrameChrome();
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

    function drawHeaderFooter(ctx, pageW, pageH, scale) {
        const meta = printMeta();
        const headerH = pageH * HEADER_FRAC;
        const footerH = pageH * FOOTER_FRAC;

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
        ctx.fillText('Electrical Network · Single Line Diagram (GIS Sheet)', pad, pad + 48 * scale);

        // Meta block right
        const metaX = pageW * 0.62;
        const rows = [
            ['Drg No.', meta.drawingNo],
            ['Scale', meta.scale],
            ['Date', meta.date],
            ['Sheet', '1 of 1']
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

        const cols = [
            { label: 'Surveyor', value: meta.mobile ? `${meta.surveyor} · ${meta.mobile}` : meta.surveyor },
            { label: 'Poles / Spans', value: `${(nodes || []).length} / ${(edges || []).length}` },
            { label: 'Route Length', value: formatDistanceLocal(totalRouteM()) },
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

    /**
     * Project current map view into the print map rectangle and draw crisp network vectors.
     * Works even when tile capture fails (CORS).
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
        const nodesById = {};
        nodes.forEach((n) => { nodesById[n.id] = n; });

        // Edges
        (edges || []).forEach((edge) => {
            const from = nodesById[edge.from];
            const to = nodesById[edge.to];
            if (!from || !to) return;
            const p1 = toPage(from.assetRef.latitude, from.assetRef.longitude);
            const p2 = toPage(to.assetRef.latitude, to.assetRef.longitude);
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

            const span = parseFloat(edge.spanLengthM) || 0;
            if (span > 0) {
                const mx = (p1.x + p2.x) / 2;
                const my = (p1.y + p2.y) / 2;
                ctx.fillStyle = 'rgba(255,255,255,0.85)';
                const label = formatDistanceLocal(span);
                ctx.font = `${9 * scale}px Inter, Arial, sans-serif`;
                const tw = ctx.measureText(label).width;
                ctx.fillRect(mx - tw / 2 - 3 * scale, my - 12 * scale, tw + 6 * scale, 12 * scale);
                ctx.fillStyle = '#334155';
                ctx.textAlign = 'center';
                ctx.fillText(label, mx, my - 3 * scale);
                ctx.textAlign = 'left';
            }
            ctx.restore();
        });

        // Poles
        nodes.forEach((node) => {
            const p = toPage(node.assetRef.latitude, node.assetRef.longitude);
            const r = Math.max(7, 9 * scale);
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
            ctx.fillStyle = '#0f172a';
            ctx.font = `bold ${Math.max(8, 9 * scale)}px Inter, Arial, sans-serif`;
            ctx.textBaseline = 'top';
            const poleNo = node.label || `P-${String(node.sequence).padStart(2, '0')}`;
            ctx.fillText(poleNo, p.x, p.y + r + 2 * scale);
            ctx.restore();
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

    async function composePrintCanvas() {
        const pageMm = getPageMm();
        const dpi = getDpi();
        const px = pagePixels(pageMm, dpi);
        const scale = dpi / 96;

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

        if (legendShot) {
            drawLegendImage(ctx, legendShot, mapX, mapY, mapW, mapH);
        } else {
            const legendW = mapW * LEGEND_W_FRAC;
            const legendH = Math.min(mapH * 0.58, mapH * LEGEND_H_FRAC + 80 * scale);
            const legendX = mapX + mapW - legendW - 12 * scale;
            const legendY = mapY + mapH - legendH - 12 * scale;
            drawLegendTableOnCanvas(ctx, legendX, legendY, legendW, legendH, scale);
        }

        drawHeaderFooter(ctx, px.w, px.h, scale);

        return { canvas, pageMm, dpi, px };
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
        if (!surveyData) {
            showToast('Load a workspace before exporting.');
            return;
        }
        if (!printEnabled) setPrintEnabled(true);
        showToast('Rendering high-resolution PNG…');
        try {
            const { canvas, dpi } = await composePrintCanvas();
            const name = `SLD_${(surveyData && surveyData.surveyId) || 'sheet'}_${dpi}dpi.png`;
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
            showToast(`Exported ${name}`);
        } catch (err) {
            console.error(err);
            showToast('PNG export failed: ' + (err.message || err));
        }
    }

    async function exportPdf() {
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
        showToast('Rendering print-ready PDF…');
        try {
            const { canvas, pageMm, dpi } = await composePrintCanvas();
            const img = canvas.toDataURL('image/png');
            const { jsPDF } = jsPdfNs;
            const pdf = new jsPDF({
                orientation: pageMm.w >= pageMm.h ? 'landscape' : 'portrait',
                unit: 'mm',
                format: [pageMm.w, pageMm.h],
                compress: true
            });
            pdf.addImage(img, 'PNG', 0, 0, pageMm.w, pageMm.h, undefined, 'FAST');
            const name = `SLD_${(surveyData && surveyData.surveyId) || 'sheet'}_${dpi}dpi.pdf`;
            pdf.save(name);
            showToast(`Exported ${name}`);
        } catch (err) {
            console.error(err);
            showToast('PDF export failed: ' + (err.message || err));
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
        syncMetaFromSurvey();
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
        isEnabled: () => printEnabled
    };

    window.addEventListener('DOMContentLoaded', () => {
        initPrintLayout();
    });
})();
