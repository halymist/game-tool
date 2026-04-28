/* Expedition Designer — map-image + quest-node graph editor.
 *
 * Each settlement has at most one expedition. The expedition has a map
 * image and a graph of nodes; each node references an existing quest
 * (game.quests). Edges are undirected. Save replaces the whole graph.
 */

console.log('📦 expedition-designer.js LOADED');

(function () {
    'use strict';

    const MAP_FOLDER = 'expedition-maps';

    const state = {
        settlementId: null,
        expeditionId: null,
        mapAssetId: null,
        mapImageUrl: null,
        nodes: new Map(),    // client_id -> {client_id, quest_id, is_start, pos_x, pos_y, label}
        edges: new Map(),    // pair-key "minA-maxB" -> {a_client_id, b_client_id}
        quests: [],          // [{quest_id, quest_name, asset_id}]
        mapAssets: [],       // [{assetID, icon, name}]
        nextClientId: -1,    // negative for newly-created (positive ids come from server)
        selectedNodeId: null,
        edgeMode: false,
        edgeSourceId: null,
        dragging: null,      // {clientId, offsetXPct, offsetYPct}
        dirty: false,
    };

    // ---------- DOM helpers ----------
    const $ = (id) => document.getElementById(id);

    function setStatus(msg, isError) {
        const el = $('expeditionStatus');
        if (!el) return;
        el.textContent = msg || '';
        el.style.color = isError ? '#f87171' : '';
    }

    function markDirty() {
        state.dirty = true;
        const btn = $('expeditionSaveBtn');
        if (btn) btn.classList.add('btn-pending');
    }

    function clearDirty() {
        state.dirty = false;
        const btn = $('expeditionSaveBtn');
        if (btn) btn.classList.remove('btn-pending');
    }

    function pairKey(a, b) {
        return a < b ? `${a}-${b}` : `${b}-${a}`;
    }

    function buildMapUrl(assetId) {
        if (!assetId) return null;
        if (typeof window.buildPublicAssetUrl === 'function') {
            return window.buildPublicAssetUrl(`images/${MAP_FOLDER}/${assetId}.webp`);
        }
        return `https://pub-b959ac8ae579488bb4ed33c01a618ae2.r2.dev/images/${MAP_FOLDER}/${assetId}.webp`;
    }

    // ---------- Settlement select ----------
    function populateSettlementSelect() {
        const sel = $('expeditionSettlementSelect');
        if (!sel) return;
        if (typeof window.populateSettlementSelect === 'function') {
            const selected = window.populateSettlementSelect('expeditionSettlementSelect', state.settlementId);
            if (selected) {
                state.settlementId = selected;
            }
            return;
        }

        const settlements = (window.GlobalData && window.GlobalData.settlements) || [];
        const previous = state.settlementId;
        const sorted = [...settlements].sort((a, b) => {
            const an = (a.settlement_name || a.name || '').toLowerCase();
            const bn = (b.settlement_name || b.name || '').toLowerCase();
            return an.localeCompare(bn);
        });
        sel.innerHTML = '<option value="">— Select settlement —</option>' +
            sorted.map(s => `<option value="${s.settlement_id}">${escapeHtml(s.settlement_name || s.name || `Settlement #${s.settlement_id}`)}</option>`).join('');
        if (previous && sorted.some(s => s.settlement_id === previous)) {
            sel.value = String(previous);
        }
    }

    // ---------- API ----------
    async function authFetch(path, options = {}) {
        const token = await window.getCurrentAccessToken();
        if (!token) throw new Error('Authentication required');
        const opts = Object.assign({}, options);
        opts.headers = Object.assign({
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }, opts.headers || {});
        const res = await fetch(path, opts);
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`${res.status}: ${text || res.statusText}`);
        }
        return res.json();
    }

    async function loadExpedition(settlementId) {
        const data = await authFetch(`/api/getExpedition?settlementId=${settlementId}`);
        state.settlementId = data.settlement_id;
        state.expeditionId = data.expedition_id;
        state.mapAssetId = data.map_asset_id || null;
        state.nodes.clear();
        state.edges.clear();
        state.nextClientId = -1;
        for (const n of (data.nodes || [])) {
            state.nodes.set(n.client_id, {
                client_id: n.client_id,
                quest_id: n.quest_id || null,
                is_start: !!n.is_start,
                pos_x: n.pos_x,
                pos_y: n.pos_y,
                label: n.label || null,
            });
        }
        for (const e of (data.edges || [])) {
            state.edges.set(pairKey(e.a_client_id, e.b_client_id), {
                a_client_id: e.a_client_id,
                b_client_id: e.b_client_id,
            });
        }
        state.mapImageUrl = resolveMapImageUrl(state.mapAssetId);
        clearDirty();
    }

    async function loadQuestsLite(settlementId) {
        try {
            state.quests = await authFetch(`/api/getQuestsLite?settlementId=${settlementId}`);
        } catch (e) {
            console.warn('getQuestsLite failed:', e);
            state.quests = [];
        }
    }

    function getMapAssets() {
        if (typeof window.getExpeditionMapAssets === 'function') {
            const fromGlobal = window.getExpeditionMapAssets();
            if (Array.isArray(fromGlobal)) {
                return fromGlobal;
            }
        }
        return state.mapAssets;
    }

    function resolveMapImageUrl(assetId) {
        if (!assetId) return null;
        const assets = getMapAssets();
        const byId = assets.find((a) => {
            const id = a.assetID ?? a.assetId ?? a.id;
            return Number(id) === Number(assetId);
        });
        if (byId) {
            return byId.icon || byId.url || byId.remoteIcon || byId.remoteUrl || buildMapUrl(assetId);
        }
        return buildMapUrl(assetId);
    }

    async function loadMapAssets(options = {}) {
        try {
            if (typeof window.loadExpeditionMapAssetsData === 'function') {
                const assets = await window.loadExpeditionMapAssetsData(options);
                state.mapAssets = Array.isArray(assets) ? assets : [];
            } else {
                const data = await authFetch('/api/getExpeditionMapAssets');
                state.mapAssets = Array.isArray(data) ? data : (data.assets || []);
            }
        } catch (e) {
            console.warn('getExpeditionMapAssets failed:', e);
            state.mapAssets = [];
        }
    }

    function nextMapAssetId() {
        let max = 0;
        for (const a of getMapAssets()) {
            const id = a.assetID || a.assetId || 0;
            if (id > max) max = id;
        }
        return max + 1;
    }

    async function saveExpedition() {
        if (!state.settlementId) return;
        setStatus('Saving…');
        try {
            const payload = {
                settlement_id: state.settlementId,
                map_asset_id: state.mapAssetId,
                nodes: Array.from(state.nodes.values()).map(n => ({
                    client_id: n.client_id,
                    quest_id: n.quest_id,
                    is_start: n.is_start,
                    pos_x: n.pos_x,
                    pos_y: n.pos_y,
                    label: n.label,
                })),
                edges: Array.from(state.edges.values()),
            };
            const result = await authFetch('/api/saveExpedition', {
                method: 'POST',
                body: JSON.stringify(payload),
            });
            // Replace state with server response so client_ids align with DB ids.
            state.expeditionId = result.expedition_id;
            state.mapAssetId = result.map_asset_id || null;
            state.nodes.clear();
            state.edges.clear();
            for (const n of (result.nodes || [])) {
                state.nodes.set(n.client_id, {
                    client_id: n.client_id,
                    quest_id: n.quest_id || null,
                    is_start: !!n.is_start,
                    pos_x: n.pos_x,
                    pos_y: n.pos_y,
                    label: n.label || null,
                });
            }
            for (const e of (result.edges || [])) {
                state.edges.set(pairKey(e.a_client_id, e.b_client_id), {
                    a_client_id: e.a_client_id,
                    b_client_id: e.b_client_id,
                });
            }
            clearDirty();
            setStatus('Saved.');
            renderMap();
            setTimeout(() => setStatus(''), 1500);
        } catch (e) {
            console.error(e);
            setStatus('Save failed: ' + e.message, true);
        }
    }

    // ---------- Map upload ----------
    async function handleMapFileSelected(file) {
        if (!file || !file.type.startsWith('image/')) {
            setStatus('Please pick an image.', true);
            return;
        }
        setStatus('Uploading map…');
        try {
            await loadMapAssets();
            const assetId = nextMapAssetId();
            const webpBlob = await convertImageToWebP(file, 2048, 2048, 0.8);
            const base64 = await blobToBase64Safe(webpBlob);
            const result = await authFetch('/api/uploadExpeditionMapAsset', {
                method: 'POST',
                body: JSON.stringify({
                    assetID: assetId,
                    imageData: base64,
                    contentType: 'image/webp',
                }),
            });
            state.mapAssetId = result.assetID || assetId;
            await loadMapAssets({ forceReload: true });
            state.mapImageUrl = result.icon || resolveMapImageUrl(state.mapAssetId);
            markDirty();
            setStatus('Map uploaded. Click Save to persist.');
            renderMap();
        } catch (e) {
            console.error(e);
            setStatus('Map upload failed: ' + e.message, true);
        }
    }

    function blobToBase64Safe(blob) {
        if (typeof window.blobToBase64 === 'function') {
            return window.blobToBase64(blob);
        }
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    async function convertImageToWebP(file, maxWidth = 2048, maxHeight = 2048, quality = 0.8) {
        if (typeof window.convertImageToWebP === 'function') {
            return window.convertImageToWebP(file, maxWidth, maxHeight, quality);
        }
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                if (width > maxWidth || height > maxHeight) {
                    const ratio = Math.min(maxWidth / width, maxHeight / height);
                    width = Math.max(1, Math.round(width * ratio));
                    height = Math.max(1, Math.round(height * ratio));
                }
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    reject(new Error('Canvas not supported'));
                    return;
                }
                ctx.drawImage(img, 0, 0, width, height);
                canvas.toBlob((blob) => {
                    if (!blob) {
                        reject(new Error('Failed to convert image to WebP'));
                        return;
                    }
                    resolve(blob);
                }, 'image/webp', quality);
                URL.revokeObjectURL(img.src);
            };
            img.onerror = () => reject(new Error('Failed to read image file'));
            img.src = URL.createObjectURL(file);
        });
    }

    // ---------- Render ----------
    function renderMap() {
        const empty = $('expeditionMapEmpty');
        const inner = $('expeditionMapInner');
        const img = $('expeditionMapImage');
        if (!empty || !inner || !img) return;

        if (!state.settlementId) {
            empty.style.display = 'block';
            empty.querySelector('p').textContent = 'Select a settlement to start editing its expedition.';
            inner.style.display = 'none';
            return;
        }
        if (!state.mapImageUrl) {
            empty.style.display = 'block';
            empty.querySelector('p').textContent = 'No map uploaded for this settlement.';
            inner.style.display = 'none';
            return;
        }
        empty.style.display = 'none';
        inner.style.display = 'inline-block';
        if (img.src !== state.mapImageUrl) {
            img.src = state.mapImageUrl;
        }
        renderNodes();
        renderEdges();
    }

    function renderNodes() {
        const layer = $('expeditionNodeLayer');
        if (!layer) return;
        layer.innerHTML = '';
        for (const node of state.nodes.values()) {
            const el = document.createElement('div');
            el.className = 'expedition-node';
            if (node.is_start) el.classList.add('is-start');
            if (node.quest_id) el.classList.add('has-quest');
            if (state.selectedNodeId === node.client_id) el.classList.add('selected');
            if (state.edgeSourceId === node.client_id) el.classList.add('edge-source');
            el.style.left = (node.pos_x * 100) + '%';
            el.style.top = (node.pos_y * 100) + '%';
            el.dataset.clientId = String(node.client_id);
            const quest = state.quests.find(q => q.quest_id === node.quest_id);
            const initial = (node.label || (quest && quest.quest_name) || '').trim();
            el.textContent = initial ? initial.charAt(0).toUpperCase() : '·';
            el.title = (quest ? quest.quest_name : '(no quest)') + (node.is_start ? ' [start]' : '');
            if (node.label) {
                const labelEl = document.createElement('div');
                labelEl.className = 'expedition-node-label';
                labelEl.textContent = node.label;
                el.appendChild(labelEl);
            }
            attachNodeHandlers(el, node);
            layer.appendChild(el);
        }
    }

    function renderEdges() {
        const svg = $('expeditionEdgeLayer');
        const inner = $('expeditionMapInner');
        if (!svg || !inner) return;
        const rect = inner.getBoundingClientRect();
        svg.setAttribute('viewBox', `0 0 ${rect.width || 1} ${rect.height || 1}`);
        svg.setAttribute('width', rect.width);
        svg.setAttribute('height', rect.height);
        svg.innerHTML = '';
        for (const edge of state.edges.values()) {
            const a = state.nodes.get(edge.a_client_id);
            const b = state.nodes.get(edge.b_client_id);
            if (!a || !b) continue;
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', a.pos_x * rect.width);
            line.setAttribute('y1', a.pos_y * rect.height);
            line.setAttribute('x2', b.pos_x * rect.width);
            line.setAttribute('y2', b.pos_y * rect.height);
            svg.appendChild(line);
        }
    }

    // ---------- Node interactions ----------
    function attachNodeHandlers(el, node) {
        el.addEventListener('mousedown', (e) => onNodeMouseDown(e, node));
        el.addEventListener('click', (e) => onNodeClick(e, node));
    }

    function onNodeMouseDown(e, node) {
        if (e.button !== 0) return;
        if (e.shiftKey || state.edgeMode) return; // edge mode handled in click
        e.preventDefault();
        e.stopPropagation();
        const inner = $('expeditionMapInner');
        const rect = inner.getBoundingClientRect();
        const startX = (e.clientX - rect.left) / rect.width;
        const startY = (e.clientY - rect.top) / rect.height;
        state.dragging = {
            clientId: node.client_id,
            offsetXPct: node.pos_x - startX,
            offsetYPct: node.pos_y - startY,
            moved: false,
        };
        document.addEventListener('mousemove', onDragMove);
        document.addEventListener('mouseup', onDragEnd, { once: true });
    }

    function onDragMove(e) {
        if (!state.dragging) return;
        const inner = $('expeditionMapInner');
        const rect = inner.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width + state.dragging.offsetXPct;
        const y = (e.clientY - rect.top) / rect.height + state.dragging.offsetYPct;
        const node = state.nodes.get(state.dragging.clientId);
        if (!node) return;
        node.pos_x = Math.max(0, Math.min(1, x));
        node.pos_y = Math.max(0, Math.min(1, y));
        state.dragging.moved = true;
        renderNodes();
        renderEdges();
    }

    function onDragEnd() {
        document.removeEventListener('mousemove', onDragMove);
        if (state.dragging && state.dragging.moved) markDirty();
        state.dragging = null;
    }

    function onNodeClick(e, node) {
        e.stopPropagation();
        if (state.dragging && state.dragging.moved) return; // suppress click after drag
        if (e.shiftKey || state.edgeMode) {
            handleEdgeClick(node);
            return;
        }
        state.selectedNodeId = node.client_id;
        renderNodes();
        openNodePopover(node, e.clientX, e.clientY);
    }

    function handleEdgeClick(node) {
        if (state.edgeSourceId === null) {
            state.edgeSourceId = node.client_id;
            renderNodes();
            setStatus('Edge: click a second node to toggle the connection.');
            return;
        }
        if (state.edgeSourceId === node.client_id) {
            state.edgeSourceId = null;
            renderNodes();
            setStatus('');
            return;
        }
        const key = pairKey(state.edgeSourceId, node.client_id);
        if (state.edges.has(key)) {
            state.edges.delete(key);
            setStatus('Edge removed.');
        } else {
            state.edges.set(key, {
                a_client_id: state.edgeSourceId,
                b_client_id: node.client_id,
            });
            setStatus('Edge added.');
        }
        state.edgeSourceId = null;
        markDirty();
        renderNodes();
        renderEdges();
        setTimeout(() => setStatus(''), 1200);
    }

    // ---------- Add node by double-clicking the map ----------
    function onMapDblClick(e) {
        if (!state.mapImageUrl) return;
        const inner = $('expeditionMapInner');
        const rect = inner.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;
        if (x < 0 || x > 1 || y < 0 || y > 1) return;
        const id = state.nextClientId--;
        state.nodes.set(id, {
            client_id: id,
            quest_id: null,
            is_start: false,
            pos_x: x,
            pos_y: y,
            label: null,
        });
        markDirty();
        renderMap();
    }

    // ---------- Popover ----------
    function openNodePopover(node, anchorX, anchorY) {
        const pop = $('expeditionNodePopover');
        const labelEl = $('expeditionNodeLabel');
        const questEl = $('expeditionNodeQuest');
        const startEl = $('expeditionNodeIsStart');
        if (!pop || !labelEl || !questEl || !startEl) return;
        labelEl.value = node.label || '';
        startEl.checked = !!node.is_start;
        questEl.innerHTML = '<option value="">— No quest —</option>' +
            state.quests.map(q => `<option value="${q.quest_id}">${escapeHtml(q.quest_name)}</option>`).join('');
        questEl.value = node.quest_id ? String(node.quest_id) : '';

        pop.style.display = 'block';
        pop.dataset.clientId = String(node.client_id);
        // Position roughly near click, clamp to viewport.
        const rect = pop.getBoundingClientRect();
        const px = Math.min(window.innerWidth - rect.width - 12, Math.max(12, anchorX + 12));
        const py = Math.min(window.innerHeight - rect.height - 12, Math.max(12, anchorY + 12));
        pop.style.left = px + 'px';
        pop.style.top = py + 'px';
    }

    function closeNodePopover() {
        const pop = $('expeditionNodePopover');
        if (!pop) return;
        pop.style.display = 'none';
        pop.dataset.clientId = '';
        state.selectedNodeId = null;
        renderNodes();
    }

    function applyPopover() {
        const pop = $('expeditionNodePopover');
        if (!pop) return;
        const cid = parseInt(pop.dataset.clientId, 10);
        const node = state.nodes.get(cid);
        if (!node) return closeNodePopover();
        const questVal = $('expeditionNodeQuest').value;
        node.quest_id = questVal ? parseInt(questVal, 10) : null;
        node.is_start = $('expeditionNodeIsStart').checked;
        const lbl = $('expeditionNodeLabel').value.trim();
        node.label = lbl || null;
        markDirty();
        closeNodePopover();
        renderMap();
    }

    function deleteNodeFromPopover() {
        const pop = $('expeditionNodePopover');
        if (!pop) return;
        const cid = parseInt(pop.dataset.clientId, 10);
        if (!state.nodes.has(cid)) return closeNodePopover();
        state.nodes.delete(cid);
        // Drop edges touching this node.
        for (const [key, edge] of state.edges) {
            if (edge.a_client_id === cid || edge.b_client_id === cid) state.edges.delete(key);
        }
        markDirty();
        closeNodePopover();
        renderMap();
    }

    // ---------- Edge mode toggle ----------
    function toggleEdgeMode() {
        state.edgeMode = !state.edgeMode;
        state.edgeSourceId = null;
        const btn = $('expeditionEdgeModeBtn');
        if (btn) {
            btn.textContent = state.edgeMode ? 'Edges: On' : 'Edges: Off';
            btn.classList.toggle('active', state.edgeMode);
        }
        setStatus(state.edgeMode ? 'Edge mode on. Click two nodes to toggle a connection.' : '');
        renderNodes();
    }

    // ---------- Wiring ----------
    function attachEvents() {
        const sel = $('expeditionSettlementSelect');
        if (sel) sel.addEventListener('change', async () => {
            const id = parseInt(sel.value, 10);
            if (!id) {
                state.settlementId = null;
                state.expeditionId = null;
                state.mapAssetId = null;
                state.mapImageUrl = null;
                state.nodes.clear();
                state.edges.clear();
                state.quests = [];
                renderMap();
                return;
            }
            setStatus('Loading…');
            try {
                state.settlementId = id;
                await Promise.all([loadExpedition(id), loadQuestsLite(id), loadMapAssets()]);
                state.mapImageUrl = resolveMapImageUrl(state.mapAssetId);
                setStatus('');
                renderMap();
            } catch (e) {
                console.error(e);
                setStatus('Load failed: ' + e.message, true);
            }
        });

        const upload = $('expeditionUploadMapBtn');
        const fileInput = $('expeditionMapFileInput');
        if (upload && fileInput) {
            upload.addEventListener('click', () => {
                if (!state.settlementId) {
                    setStatus('Pick a settlement first.', true);
                    return;
                }
                fileInput.click();
            });
            fileInput.addEventListener('change', () => {
                const f = fileInput.files && fileInput.files[0];
                fileInput.value = '';
                if (f) handleMapFileSelected(f);
            });
        }

        const edgeBtn = $('expeditionEdgeModeBtn');
        if (edgeBtn) edgeBtn.addEventListener('click', toggleEdgeMode);

        const saveBtn = $('expeditionSaveBtn');
        if (saveBtn) saveBtn.addEventListener('click', saveExpedition);

        const stage = $('expeditionMapStage');
        if (stage) stage.addEventListener('dblclick', onMapDblClick);

        // Repaint edges on resize so SVG matches the rendered image size.
        window.addEventListener('resize', () => renderEdges());
        const img = $('expeditionMapImage');
        if (img) img.addEventListener('load', () => renderEdges());

        const pop = $('expeditionNodePopover');
        if (pop) {
            pop.addEventListener('click', (e) => {
                const action = e.target && e.target.dataset && e.target.dataset.action;
                if (action === 'close') closeNodePopover();
                else if (action === 'apply') applyPopover();
                else if (action === 'delete') deleteNodeFromPopover();
            });
        }

        // Click outside popover closes it (but keep clicks on nodes/popover alive).
        document.addEventListener('mousedown', (e) => {
            const pop = $('expeditionNodePopover');
            if (!pop || pop.style.display === 'none') return;
            if (pop.contains(e.target)) return;
            if (e.target.closest && e.target.closest('.expedition-node')) return;
            closeNodePopover();
        });
    }

    // ---------- Init ----------
    function escapeHtml(str) {
        return String(str || '').replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    async function init() {
        const root = $('dungeons-content');
        if (!root) return;
        attachEvents();
        // Load settlements lazily; populate when GlobalData is ready.
        if (window.GlobalData && window.GlobalData.settlements && window.GlobalData.settlements.length) {
            populateSettlementSelect();
        } else if (typeof window.subscribeToGlobalData === 'function') {
            window.subscribeToGlobalData('settlements', () => populateSettlementSelect());
            if (typeof window.loadSettlementsData === 'function') {
                window.loadSettlementsData().catch((e) => console.error('Settlement load failed', e));
            }
        }
        if (typeof window.subscribeToGlobalData === 'function') {
            window.subscribeToGlobalData('expeditionMapAssets', () => {
                state.mapImageUrl = resolveMapImageUrl(state.mapAssetId);
                renderMap();
            }, { skipInitial: true });
        }
        if (typeof window.loadExpeditionMapAssetsData === 'function') {
            window.loadExpeditionMapAssetsData().catch((e) => console.error('Expedition map assets load failed', e));
        }
        renderMap();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Expose minimal hooks for debugging.
    window.expeditionDesigner = { state, renderMap };

    console.log('✅ expedition-designer.js READY');
})();
