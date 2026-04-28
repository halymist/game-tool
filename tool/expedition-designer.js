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
    const LOG_PREFIX = '[expedition-designer]';

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
        edgeSourceId: null,
        dragging: null,      // {clientId, offsetXPct, offsetYPct}
        dirty: false,
        isSaving: false,
        baselineSignature: null,
        lastLoadedSettlementId: null,
    };

    let hasAttachedEvents = false;
    let hasInitialized = false;
    let hasActivatedOnce = false;
    let isActivating = false;
    let activeLoadToken = 0;

    // ---------- DOM helpers ----------
    const $ = (id) => document.getElementById(id);

    function log(message, payload) {
        if (payload === undefined) {
            console.log(`${LOG_PREFIX} ${message}`);
            return;
        }
        console.log(`${LOG_PREFIX} ${message}`, payload);
    }

    function getGlobalArray(key) {
        return Array.isArray(window.GlobalData && window.GlobalData[key]) ? window.GlobalData[key] : [];
    }

    function buildGlobalSnapshot(settlementId = state.settlementId) {
        const sid = Number(settlementId);
        const allQuests = getGlobalArray('quests');
        const settlementQuestCount = sid > 0
            ? allQuests.filter((quest) => Number(quest.settlement_id) === sid).length
            : 0;
        return {
            settlements: getGlobalArray('settlements').length,
            quests: allQuests.length,
            expeditionMapAssets: getGlobalArray('expeditionMapAssets').length,
            activeSettlementId: sid > 0 ? sid : null,
            activeSettlementQuestCount: settlementQuestCount,
        };
    }

    function getSelectedSettlementFromDom() {
        const select = $('expeditionSettlementSelect');
        if (!select) return null;
        const id = parseInt(select.value, 10);
        return id > 0 ? id : null;
    }

    function syncGlobalCaches(settlementId, reason = 'sync') {
        const sid = Number(settlementId);
        const allQuests = getGlobalArray('quests');
        const allChains = typeof window.getQuestChainsData === 'function'
            ? (window.getQuestChainsData() || [])
            : getGlobalArray('questChains');
        const chainIdsForSettlement = new Set(
            allChains
                .filter((chain) => Number(chain && chain.settlement_id) === sid)
                .map((chain) => Number(chain.questchain_id))
                .filter((id) => id > 0)
        );
        state.mapAssets = getGlobalArray('expeditionMapAssets').slice();
        state.quests = sid > 0
            ? allQuests
                .filter((quest) => {
                    const questSettlementId = Number(quest && quest.settlement_id);
                    const questChainId = Number(quest && quest.questchain_id);
                    if (questSettlementId === sid) return true;
                    if (chainIdsForSettlement.size > 0 && chainIdsForSettlement.has(questChainId)) return true;
                    return false;
                })
                .map((quest) => ({
                    quest_id: Number(quest.quest_id),
                    quest_name: quest.quest_name || `Quest ${quest.quest_id}`,
                    asset_id: quest.asset_id ?? null,
                }))
            : [];
        log('Global caches synced', {
            reason,
            settlementId: sid > 0 ? sid : null,
            totalQuests: allQuests.length,
            totalQuestChains: allChains.length,
            settlementQuestChains: sid > 0 ? chainIdsForSettlement.size : 0,
            settlementQuests: state.quests.length,
            mapAssets: state.mapAssets.length,
        });
    }

    function setStatus(msg, isError) {
        const el = $('expeditionStatus');
        if (!el) return;
        el.textContent = msg || '';
        el.style.color = isError ? '#f87171' : '';
    }

    function markDirty() {
        refreshDirtyState();
    }

    function clearDirty() {
        state.baselineSignature = buildStateSignature();
        state.dirty = false;
        updateSaveButton();
    }

    function buildStateSignature() {
        const nodes = Array.from(state.nodes.values())
            .map((n) => ({
                client_id: Number(n.client_id),
                quest_id: n.quest_id == null ? null : Number(n.quest_id),
                is_start: !!n.is_start,
                pos_x: Number(Number(n.pos_x || 0).toFixed(6)),
                pos_y: Number(Number(n.pos_y || 0).toFixed(6)),
                label: (n.label || '').trim() || null,
            }))
            .sort((a, b) => a.client_id - b.client_id);

        const edges = Array.from(state.edges.values())
            .map((e) => {
                const a = Number(e.a_client_id);
                const b = Number(e.b_client_id);
                return a < b ? [a, b] : [b, a];
            })
            .sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));

        return JSON.stringify({
            settlement_id: state.settlementId || null,
            map_asset_id: state.mapAssetId || null,
            nodes,
            edges,
        });
    }

    function refreshDirtyState() {
        if (!state.baselineSignature) {
            state.baselineSignature = buildStateSignature();
        }
        state.dirty = buildStateSignature() !== state.baselineSignature;
        updateSaveButton();
    }

    function updateSaveButton() {
        const btn = $('expeditionSaveBtn');
        if (!btn) return;
        const canSave = !!state.settlementId && state.dirty && !state.isSaving;
        btn.disabled = !canSave;
        btn.classList.toggle('btn-pending', state.dirty);
        btn.classList.toggle('is-saving', state.isSaving);
        btn.textContent = state.isSaving ? 'Saving...' : 'Save';

        const discardBtn = $('expeditionDiscardBtn');
        if (discardBtn) {
            discardBtn.disabled = !state.settlementId || !state.dirty || state.isSaving;
        }
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
        log('Requesting expedition payload', { settlementId });
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
        log('Expedition payload received', {
            settlementId: state.settlementId,
            expeditionId: state.expeditionId,
            mapAssetId: state.mapAssetId,
            nodes: state.nodes.size,
            edges: state.edges.size,
        });
        clearDirty();
    }

    async function loadQuestsLite(settlementId) {
        syncGlobalCaches(settlementId, 'loadQuestsLite');
        return state.quests;
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

    function probeImageUrl(url) {
        return new Promise((resolve) => {
            if (!url) {
                resolve(false);
                return;
            }
            const img = new Image();
            img.onload = () => resolve(true);
            img.onerror = () => resolve(false);
            img.src = url;
        });
    }

    async function resolveMapImageUrlSmart(assetId) {
        if (!assetId) return null;

        const preferred = resolveMapImageUrl(assetId);
        if (preferred && await probeImageUrl(preferred)) {
            return preferred;
        }

        const exts = ['webp', 'png', 'jpg', 'jpeg', 'gif'];
        for (const ext of exts) {
            const candidate = typeof window.buildPublicAssetUrl === 'function'
                ? window.buildPublicAssetUrl(`images/${MAP_FOLDER}/${assetId}.${ext}`)
                : `https://pub-b959ac8ae579488bb4ed33c01a618ae2.r2.dev/images/${MAP_FOLDER}/${assetId}.${ext}`;
            if (await probeImageUrl(candidate)) {
                return candidate;
            }
        }

        return null;
    }

    async function loadMapAssets(options = {}) {
        if (options && options.forceReload === true && typeof window.loadExpeditionMapAssetsData === 'function') {
            try {
                const assets = await window.loadExpeditionMapAssetsData(options);
                state.mapAssets = Array.isArray(assets) ? assets.slice() : [];
                log('Map asset gallery force reloaded', { count: state.mapAssets.length });
                return state.mapAssets;
            } catch (e) {
                console.warn('Global expedition map assets reload failed:', e);
            }
        }
        syncGlobalCaches(state.settlementId, 'loadMapAssets');
        return state.mapAssets;
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
        if (!state.settlementId || !state.dirty || state.isSaving) return;
        state.isSaving = true;
        updateSaveButton();
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
        } finally {
            state.isSaving = false;
            updateSaveButton();
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
            syncGlobalCaches(state.settlementId, 'before map upload');
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
            state.mapImageUrl = result.icon || await resolveMapImageUrlSmart(state.mapAssetId);
            markDirty();
            log('Map upload completed', {
                mapAssetId: state.mapAssetId,
                mapImageUrl: state.mapImageUrl,
                mapAssets: state.mapAssets.length,
            });
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
        if (rect.width <= 0 || rect.height <= 0) {
            return;
        }
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
        el.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            openNodePopover(node, e.clientX, e.clientY);
        });
    }

    function onNodeMouseDown(e, node) {
        if (e.button !== 0) return;
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
        // Left click is edge workflow by default:
        // first click picks source, second click toggles edge.
        if (state.edgeSourceId === null) {
            state.edgeSourceId = node.client_id;
            state.selectedNodeId = node.client_id;
            renderNodes();
            setStatus('Connection source selected. Click another node to connect/disconnect. Right-click a node to edit.');
            return;
        }
        if (state.edgeSourceId === node.client_id) {
            // Clicking the same node again opens editor.
            openNodePopover(node, e.clientX, e.clientY);
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
        state.selectedNodeId = node.client_id;
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

    function applyPopoverFieldsLive() {
        const pop = $('expeditionNodePopover');
        if (!pop) return;
        const cid = parseInt(pop.dataset.clientId, 10);
        const node = state.nodes.get(cid);
        if (!node) return;
        const questVal = $('expeditionNodeQuest').value;
        const nextQuestID = questVal ? parseInt(questVal, 10) : null;
        const nextIsStart = $('expeditionNodeIsStart').checked;
        const lbl = $('expeditionNodeLabel').value.trim();
        const nextLabel = lbl || null;

        const changed = node.quest_id !== nextQuestID || node.is_start !== nextIsStart || node.label !== nextLabel;
        if (!changed) return;

        node.quest_id = nextQuestID;
        node.is_start = nextIsStart;
        node.label = nextLabel;
        markDirty();
        renderNodes();
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

    // ---------- Wiring ----------
    async function loadSettlementIntoEditor(settlementID) {
        const sid = Number(settlementID);
        if (!(sid > 0)) return;
        const loadToken = ++activeLoadToken;
        setStatus('Loading…');
        log('Loading settlement into editor', {
            settlementId: sid,
            global: buildGlobalSnapshot(sid),
        });
        try {
            closeNodePopover();
            state.settlementId = sid;
            syncGlobalCaches(sid, 'loadSettlementIntoEditor');
            await loadExpedition(sid);
            if (loadToken !== activeLoadToken) return;
            state.mapImageUrl = await resolveMapImageUrlSmart(state.mapAssetId);
            if (loadToken !== activeLoadToken) return;
            state.edgeSourceId = null;
            state.lastLoadedSettlementId = sid;
            setStatus('');
            clearDirty();
            renderMap();
            log('Settlement loaded into editor', {
                settlementId: sid,
                expeditionId: state.expeditionId,
                mapAssetId: state.mapAssetId,
                mapImageUrl: state.mapImageUrl,
                nodes: state.nodes.size,
                edges: state.edges.size,
                questOptions: state.quests.length,
            });
        } catch (e) {
            console.error(e);
            setStatus('Load failed: ' + e.message, true);
            log('Settlement load failed', {
                settlementId: sid,
                error: e.message,
                global: buildGlobalSnapshot(sid),
            });
        }
    }

    async function dismissChanges() {
        if (!state.settlementId || state.isSaving || !state.dirty) return;
        await loadSettlementIntoEditor(state.settlementId);
        setStatus('Changes discarded.');
        setTimeout(() => setStatus(''), 1200);
    }

    function attachEvents() {
        if (hasAttachedEvents) return;
        hasAttachedEvents = true;
        const sel = $('expeditionSettlementSelect');
        if (sel) sel.addEventListener('change', async () => {
            const id = parseInt(sel.value, 10);
            log('Settlement selection changed', { selectedSettlementId: id || null });
            if (!id) {
                state.settlementId = null;
                state.expeditionId = null;
                state.mapAssetId = null;
                state.mapImageUrl = null;
                state.nodes.clear();
                state.edges.clear();
                state.quests = [];
                state.edgeSourceId = null;
                state.baselineSignature = null;
                state.dirty = false;
                state.isSaving = false;
                state.lastLoadedSettlementId = null;
                updateSaveButton();
                renderMap();
                return;
            }
            await loadSettlementIntoEditor(id);
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

        const saveBtn = $('expeditionSaveBtn');
        if (saveBtn) saveBtn.addEventListener('click', saveExpedition);

        const discardBtn = $('expeditionDiscardBtn');
        if (discardBtn) discardBtn.addEventListener('click', dismissChanges);

        const stage = $('expeditionMapStage');
        if (stage) {
            stage.addEventListener('dblclick', onMapDblClick);
            stage.addEventListener('click', () => {
                state.edgeSourceId = null;
                renderNodes();
                setStatus('');
            });
        }

        // Repaint edges on resize so SVG matches the rendered image size.
        window.addEventListener('resize', () => renderEdges());
        const img = $('expeditionMapImage');
        if (img) img.addEventListener('load', () => renderEdges());

        const pop = $('expeditionNodePopover');
        if (pop) {
            pop.addEventListener('click', (e) => {
                const action = e.target && e.target.dataset && e.target.dataset.action;
                if (action === 'close') closeNodePopover();
                else if (action === 'delete') deleteNodeFromPopover();
            });
        }

        const labelEl = $('expeditionNodeLabel');
        const questEl = $('expeditionNodeQuest');
        const startEl = $('expeditionNodeIsStart');
        if (labelEl) labelEl.addEventListener('input', applyPopoverFieldsLive);
        if (questEl) questEl.addEventListener('change', applyPopoverFieldsLive);
        if (startEl) startEl.addEventListener('change', applyPopoverFieldsLive);

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

    function ensureSelectedSettlement() {
        populateSettlementSelect();
        const select = $('expeditionSettlementSelect');
        if (!select) return null;
        let selected = parseInt(select.value, 10);
        if (!(selected > 0)) {
            const firstOption = Array.from(select.options || []).find((option) => parseInt(option.value, 10) > 0);
            if (firstOption) {
                select.value = firstOption.value;
                selected = parseInt(firstOption.value, 10);
            }
        }
        return selected > 0 ? selected : null;
    }

    async function waitForGlobalDataReady() {
        if (window.__globalDataPreloaded) {
            log('Verified shared GlobalData preload', window.__globalDataSummary || buildGlobalSnapshot());
            return true;
        }

        log('GlobalData not flagged as ready yet; waiting for preload event', buildGlobalSnapshot());
        return new Promise((resolve) => {
            let finished = false;
            const complete = (ready, detail) => {
                if (finished) return;
                finished = true;
                window.clearTimeout(timeoutId);
                window.removeEventListener('global-data-preloaded', onReady);
                log(ready ? 'Received global-data-preloaded event' : 'Timed out waiting for preload; using current GlobalData snapshot', detail || buildGlobalSnapshot());
                resolve(ready);
            };
            const onReady = (event) => complete(true, event && event.detail ? event.detail : buildGlobalSnapshot());
            const timeoutId = window.setTimeout(() => complete(false), 4000);
            window.addEventListener('global-data-preloaded', onReady);
        });
    }

    function registerGlobalSubscriptions() {
        if (typeof window.subscribeToGlobalData !== 'function') return;

        window.subscribeToGlobalData('settlements', () => {
            const previous = getSelectedSettlementFromDom();
            populateSettlementSelect();
            const current = getSelectedSettlementFromDom();
            log('Settlements subscription fired', {
                previousSettlementId: previous,
                selectedSettlementId: current,
                count: getGlobalArray('settlements').length,
            });
        });

        window.subscribeToGlobalData('quests', () => {
            const settlementId = state.settlementId || getSelectedSettlementFromDom();
            syncGlobalCaches(settlementId, 'quests subscription');
            renderNodes();
            log('Quests subscription fired', buildGlobalSnapshot(settlementId));
        });

        window.subscribeToGlobalData('expeditionMapAssets', () => {
            syncGlobalCaches(state.settlementId, 'expeditionMapAssets subscription');
            if (!state.mapAssetId) {
                renderMap();
                return;
            }
            resolveMapImageUrlSmart(state.mapAssetId).then((url) => {
                state.mapImageUrl = url;
                renderMap();
                log('Expedition map gallery subscription refreshed current map URL', {
                    mapAssetId: state.mapAssetId,
                    mapImageUrl: state.mapImageUrl,
                    mapAssets: state.mapAssets.length,
                });
            });
        });
    }

    async function initExpeditionDesigner() {
        const root = $('dungeons-content');
        if (!root) return;
        if (hasInitialized) {
            log('initExpeditionDesigner called again; reusing existing setup');
            return;
        }
        attachEvents();
        registerGlobalSubscriptions();
        hasInitialized = true;
        log('Expedition designer initialized', buildGlobalSnapshot());
        updateSaveButton();
        renderMap();
    }

    async function activateExpeditionDesigner(options = {}) {
        await initExpeditionDesigner();
        if (isActivating) {
            log('Activation requested while another activation is in progress');
        }
        isActivating = true;
        try {
            await waitForGlobalDataReady();
            const selectedSettlementId = ensureSelectedSettlement();
            log('Activating expedition designer from page navigation', {
                selectedSettlementId,
                global: buildGlobalSnapshot(selectedSettlementId),
            });

            if (!selectedSettlementId) {
                setStatus('No settlements loaded.', true);
                renderMap();
                return;
            }

            syncGlobalCaches(selectedSettlementId, 'activateExpeditionDesigner');

            if (options.forceReload === true || !hasActivatedOnce || state.lastLoadedSettlementId !== selectedSettlementId) {
                await loadSettlementIntoEditor(selectedSettlementId);
                hasActivatedOnce = true;
                return;
            }

            state.mapImageUrl = await resolveMapImageUrlSmart(state.mapAssetId);
            renderMap();
            log('Activation reused currently loaded expedition state', {
                selectedSettlementId,
                expeditionId: state.expeditionId,
                mapAssetId: state.mapAssetId,
                mapImageUrl: state.mapImageUrl,
                questOptions: state.quests.length,
            });
        } finally {
            isActivating = false;
        }
    }

    // Expose minimal hooks for debugging.
    window.initExpeditionDesigner = initExpeditionDesigner;
    window.activateExpeditionDesigner = activateExpeditionDesigner;
    window.refreshExpeditionDesigner = () => activateExpeditionDesigner({ forceReload: true });
    window.expeditionDesigner = {
        state,
        renderMap,
        init: initExpeditionDesigner,
        activate: activateExpeditionDesigner,
    };

    log('READY - awaiting page activation');
})();
