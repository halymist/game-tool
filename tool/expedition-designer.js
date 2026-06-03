/* Expedition Designer — map-image + quest-node graph editor.
 *
 * Each settlement has at most one expedition. The expedition has a map
 * image and a graph of location nodes. Each node automatically uses all
 * expedition quests available for its location. Edges are undirected.
 */

console.log('📦 expedition-designer.js LOADED');

(function () {
    'use strict';

    const MAP_FOLDER = 'expedition-maps';
    const LOG_PREFIX = '[expedition-designer]';
    const NODE_DRAG_HOLD_MS = 360;

    const state = {
        settlementId: null,
        expeditionId: null,
        mapAssetId: null,
        mapImageUrl: null,
        nodes: new Map(),    // client_id -> {client_id, location_id, is_start, pos_x, pos_y, label}
        edges: new Map(),    // pair-key "minA-maxB" -> {a_client_id, b_client_id}
        quests: [],          // [{quest_id, quest_name, asset_id, expedition_quest, location_id}]
        locations: [],       // [{location_id, name}]
        mapAssets: [],       // [{assetID, icon, name}]
        nextClientId: -1,    // negative for newly-created (positive ids come from server)
        selectedNodeId: null,
        edgeSourceId: null,
        dragging: null,      // {clientId, offsetXPct, offsetYPct}
        suppressClickUntil: 0,
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
    let mapAssetUploader = null;

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
        const allSettlements = getGlobalArray('settlements');
        const allChains = typeof window.getQuestChainsData === 'function'
            ? (window.getQuestChainsData() || [])
            : getGlobalArray('questChains');
        const chainIdsForSettlement = new Set(
            allChains
                .filter((chain) => Number(chain && chain.settlement_id) === sid)
                .map((chain) => Number(chain.questchain_id))
                .filter((id) => id > 0)
        );
        const settlement = sid > 0
            ? allSettlements.find((item) => Number(item && item.settlement_id) === sid)
            : null;
        state.mapAssets = getGlobalArray('expeditionMapAssets').slice();
        state.locations = Array.isArray(settlement?.locations)
            ? settlement.locations
                .map((location) => ({
                    location_id: Number(location.location_id || location.id || 0),
                    name: location.name || `Location ${location.location_id || location.id}`,
                }))
                .filter((location) => location.location_id > 0)
                .sort((a, b) => a.name.localeCompare(b.name))
            : [];
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
                    expedition_quest: !!quest.expedition_quest,
                    location_id: quest.location_id == null ? null : Number(quest.location_id),
                }))
            : [];
        log('Global caches synced', {
            reason,
            settlementId: sid > 0 ? sid : null,
            totalQuests: allQuests.length,
            totalQuestChains: allChains.length,
            settlementQuestChains: sid > 0 ? chainIdsForSettlement.size : 0,
            settlementQuests: state.quests.length,
            settlementLocations: state.locations.length,
            mapAssets: state.mapAssets.length,
        });
    }

    function getNodeLocationOptions() {
        return state.locations;
    }

    function getNodeLocationName(node) {
        if (!node || node.location_id == null) return '';
        const location = state.locations.find((item) => Number(item.location_id) === Number(node.location_id));
        return location ? location.name : `Location ${node.location_id}`;
    }

    function getAssignableQuestsForNode(node) {
        if (!node) return [];
        return state.quests.filter((quest) => {
            if (!quest.expedition_quest) return false;
            if (node.location_id == null) return false;
            return Number(quest.location_id) === Number(node.location_id);
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
                location_id: n.location_id == null ? null : Number(n.location_id),
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
        const factionGroups = [
            { label: 'Order', match: settlement => String(settlement.faction || '') === '1' },
            { label: 'Guild', match: settlement => String(settlement.faction || '') === '2' },
            { label: 'Companions', match: settlement => String(settlement.faction || '') === '3' },
            { label: 'Neutral', match: settlement => !settlement.faction }
        ];
        sel.innerHTML = '';
        factionGroups.forEach(group => {
            const groupedSettlements = settlements
                .filter(group.match)
                .sort((a, b) => String(a.settlement_name || a.name || '').localeCompare(String(b.settlement_name || b.name || '')));
            if (!groupedSettlements.length) return;
            const optgroup = document.createElement('optgroup');
            optgroup.label = group.label;
            groupedSettlements.forEach(s => {
                const option = document.createElement('option');
                option.value = s.settlement_id;
                option.textContent = s.settlement_name || s.name || `Settlement #${s.settlement_id}`;
                optgroup.appendChild(option);
            });
            sel.appendChild(optgroup);
        });
        if (previous && sel.querySelector(`option[value="${previous}"]`)) {
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

    function getPreloadedExpedition(settlementId) {
        const allExpeditions = getGlobalArray('expeditions');
        const sid = Number(settlementId);
        return allExpeditions.find((expedition) => Number(expedition && expedition.settlement_id) === sid) || null;
    }

    function applyExpeditionPayload(data) {
        state.settlementId = data.settlement_id;
        state.expeditionId = data.expedition_id || null;
        state.mapAssetId = data.map_asset_id || null;
        state.nodes.clear();
        state.edges.clear();
        state.nextClientId = -1;
        for (const n of (data.nodes || [])) {
            state.nodes.set(n.client_id, {
                client_id: n.client_id,
                location_id: n.location_id || null,
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
    }

    async function loadExpedition(settlementId) {
        log('Loading expedition from preloaded GlobalData', { settlementId });
        const data = getPreloadedExpedition(settlementId) || {
            expedition_id: null,
            settlement_id: Number(settlementId),
            map_asset_id: null,
            nodes: [],
            edges: [],
        };
        applyExpeditionPayload(data);
        log('Expedition payload applied from GlobalData', {
            settlementId: state.settlementId,
            expeditionId: state.expeditionId,
            mapAssetId: state.mapAssetId,
            nodes: state.nodes.size,
            edges: state.edges.size,
            preloaded: !!getPreloadedExpedition(settlementId),
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

    async function resolveMapImageUrlSmart(assetId) {
        if (!assetId) return null;

        // Expedition map assets are preloaded into GlobalData. Use that cache as
        // the source of truth instead of probing candidate URLs ad hoc.
        return resolveMapImageUrl(assetId);
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

    function getMapAssetUploader() {
        if (mapAssetUploader) return mapAssetUploader;
        mapAssetUploader = new AssetGallery({
            uploadEndpoint: '/api/uploadExpeditionMapAsset',
            getNextAssetID: nextMapAssetId,
            width: 2048,
            height: 2048,
            quality: 0.8,
            resizeMode: 'contain',
            onUploadStart: () => setStatus('Uploading map…'),
            onUploaded: async ({ result, assetID }) => {
                state.mapAssetId = result.assetID || assetID;
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
            },
            onUploadError: ({ error, result }) => {
                const message = result?.message || error.message;
                console.error(error);
                setStatus('Map upload failed: ' + message, true);
            }
        });
        return mapAssetUploader;
    }

    async function saveExpedition() {
        if (!state.settlementId || !state.dirty || state.isSaving) return;
        state.isSaving = true;
        updateSaveButton();
        setStatus('Saving…');
        try {
            const guardError = validateExpeditionForSave();
            if (guardError) {
                setStatus(guardError, true);
                renderNodes();
                updateNodeSidebar();
                return;
            }
            const payload = {
                settlement_id: state.settlementId,
                map_asset_id: state.mapAssetId,
                nodes: Array.from(state.nodes.values()).map(n => ({
                    client_id: n.client_id,
                    quest_id: null,
                    location_id: n.location_id,
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
                    location_id: n.location_id || null,
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
            if (typeof window.syncAfterSave === 'function') {
                await window.syncAfterSave('expeditions');
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
        syncGlobalCaches(state.settlementId, 'before map upload');
        return getMapAssetUploader().upload(file);
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
            updateNodeSidebar();
            return;
        }
        if (!state.mapImageUrl) {
            empty.style.display = 'block';
            empty.querySelector('p').textContent = 'No map uploaded for this settlement.';
            inner.style.display = 'none';
            updateNodeSidebar();
            return;
        }
        empty.style.display = 'none';
        inner.style.display = 'inline-block';
        if (img.src !== state.mapImageUrl) {
            img.src = state.mapImageUrl;
        }
        renderNodes();
        renderEdges();
        updateNodeSidebar();
    }

    function renderNodes() {
        const layer = $('expeditionNodeLayer');
        if (!layer) return;
        layer.innerHTML = '';
        for (const node of state.nodes.values()) {
            const el = document.createElement('div');
            el.className = 'expedition-node';
            if (node.is_start) el.classList.add('is-start');
            if (state.selectedNodeId === node.client_id) el.classList.add('selected');
            if (state.edgeSourceId === node.client_id) el.classList.add('edge-source');
            el.style.left = (node.pos_x * 100) + '%';
            el.style.top = (node.pos_y * 100) + '%';
            el.dataset.clientId = String(node.client_id);
            const availableQuestCount = getAssignableQuestsForNode(node).length;
            const locationName = getNodeLocationName(node);
            el.textContent = '';
            el.title = `${locationName || '(no location)'} - ${availableQuestCount} quests${node.is_start ? ' [start]' : ''}`;
            if (locationName) {
                const labelEl = document.createElement('div');
                labelEl.className = 'expedition-node-label';
                labelEl.textContent = locationName;
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
            onNodeRightClick(node);
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
            armed: false,
            holdTimer: window.setTimeout(() => {
                if (!state.dragging || state.dragging.clientId !== node.client_id) return;
                state.dragging.armed = true;
                document.addEventListener('mousemove', onDragMove);
            }, NODE_DRAG_HOLD_MS),
        };
        document.addEventListener('mouseup', onDragEnd, { once: true });
    }

    function onDragMove(e) {
        if (!state.dragging || !state.dragging.armed) return;
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
        if (state.dragging?.holdTimer) {
            window.clearTimeout(state.dragging.holdTimer);
        }
        if (state.dragging && state.dragging.moved) {
            state.suppressClickUntil = Date.now() + 100;
            markDirty();
        }
        state.dragging = null;
    }

    function onNodeClick(e, node) {
        e.stopPropagation();
        if (Date.now() < state.suppressClickUntil) return;
        state.edgeSourceId = null;
        state.selectedNodeId = node.client_id;
        setStatus('');
        renderNodes();
        updateNodeSidebar();
    }

    function onNodeRightClick(node) {
        if (state.edgeSourceId === null) {
            state.edgeSourceId = node.client_id;
            state.selectedNodeId = node.client_id;
            renderNodes();
            updateNodeSidebar();
            setStatus('Connection source selected.');
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
        } else {
            state.edges.set(key, {
                a_client_id: state.edgeSourceId,
                b_client_id: node.client_id,
            });
        }
        state.edgeSourceId = null;
        state.selectedNodeId = node.client_id;
        markDirty();
        renderNodes();
        renderEdges();
        updateNodeSidebar();
        setStatus('');
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
        const hasStartNode = Array.from(state.nodes.values()).some((n) => !!n.is_start);
        state.nodes.set(id, {
            client_id: id,
            location_id: null,
            is_start: !hasStartNode,
            pos_x: x,
            pos_y: y,
            label: null,
        });
        state.selectedNodeId = id;
        state.edgeSourceId = null;
        markDirty();
        renderMap();
    }

    // ---------- Sidebar ----------
    function updateNodeSidebar() {
        const empty = $('expeditionSidebarEmpty');
        const content = $('expeditionSidebarContent');
        const labelEl = $('expeditionNodeLabel');
        const locationEl = $('expeditionNodeLocation');
        const questEl = $('expeditionNodeQuestSummary');
        const isStartEl = $('expeditionNodeIsStart');
        if (!empty || !content || !labelEl || !locationEl || !questEl || !isStartEl) return;
        const node = state.nodes.get(state.selectedNodeId);
        if (!node) {
            empty.style.display = 'flex';
            content.style.display = 'none';
            labelEl.value = '';
            locationEl.innerHTML = '<option value="">-- No location --</option>';
            locationEl.value = '';
            questEl.textContent = '';
            isStartEl.checked = false;
            return;
        }

        empty.style.display = 'none';
        content.style.display = 'flex';
        labelEl.value = node.label || '';
        locationEl.innerHTML = '<option value="">-- No location --</option>' +
            getNodeLocationOptions().map((location) => `<option value="${location.location_id}">${escapeHtml(location.name)}</option>`).join('');
        locationEl.value = node.location_id ? String(node.location_id) : '';
        refreshNodeSidebarQuestOptions();
        isStartEl.checked = !!node.is_start;
    }

    function clearNodeSelection() {
        state.selectedNodeId = null;
        renderNodes();
        updateNodeSidebar();
    }

    function applySidebarFieldsLive() {
        const node = state.nodes.get(state.selectedNodeId);
        if (!node) return;
        const locationVal = $('expeditionNodeLocation').value;
        const nextLocationID = locationVal ? parseInt(locationVal, 10) : null;
        const lbl = $('expeditionNodeLabel').value.trim();
        const nextLabel = lbl || null;
        const isStartEl = $('expeditionNodeIsStart');
        const nextIsStart = !!(isStartEl && isStartEl.checked);

        const changed = node.location_id !== nextLocationID
            || node.label !== nextLabel
            || !!node.is_start !== nextIsStart;
        if (!changed) return;

        node.location_id = nextLocationID;
        node.label = nextLabel;
        node.is_start = nextIsStart;
        if (nextIsStart) {
            for (const other of state.nodes.values()) {
                if (other.client_id !== node.client_id) other.is_start = false;
            }
        }
        refreshNodeSidebarQuestOptions();
        markDirty();
        renderNodes();
    }

    function deleteSelectedNode() {
        const cid = state.selectedNodeId;
        if (!state.nodes.has(cid)) return clearNodeSelection();
        const removedNode = state.nodes.get(cid);
        state.nodes.delete(cid);
        // Drop edges touching this node.
        for (const [key, edge] of state.edges) {
            if (edge.a_client_id === cid || edge.b_client_id === cid) state.edges.delete(key);
        }

        if (removedNode?.is_start) {
            const firstRemaining = state.nodes.values().next().value;
            if (firstRemaining) {
                firstRemaining.is_start = true;
            }
        }

        state.selectedNodeId = null;
        if (state.edgeSourceId === cid) state.edgeSourceId = null;
        markDirty();
        renderMap();
    }

    function refreshNodeSidebarQuestOptions() {
        const questEl = $('expeditionNodeQuestSummary');
        if (!questEl) return;
        const node = state.nodes.get(state.selectedNodeId);
        if (!node) return;

        const assignableQuests = getAssignableQuestsForNode(node);
        if (node.location_id == null) {
            questEl.innerHTML = '<div class="expedition-quest-summary-empty">No location selected.</div>';
            questEl.classList.add('is-empty');
            return;
        }
        if (assignableQuests.length === 0) {
            questEl.innerHTML = '<div class="expedition-quest-summary-empty">No expedition quests for this location.</div>';
            questEl.classList.add('is-empty');
            return;
        }
        questEl.classList.remove('is-empty');
        questEl.innerHTML = `
            <ul class="expedition-quest-summary-list">
                ${assignableQuests.map(q => `<li>${escapeHtml(q.quest_name)}</li>`).join('')}
            </ul>
            <div class="expedition-quest-summary-count">
                ${assignableQuests.length} ${assignableQuests.length === 1 ? 'available quest' : 'available quests'}
            </div>
        `;
    }

    function validateExpeditionForSave() {
        for (const node of state.nodes.values()) {
            const label = node.label || getNodeLocationName(node) || `Node ${node.client_id}`;
            if (node.location_id == null) {
                return `${label} needs a location.`;
            }
            if (getAssignableQuestsForNode(node).length === 0) {
                return `${label} has no expedition quests for its location.`;
            }
        }
        return '';
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
            state.selectedNodeId = null;
            updateNodeSidebar();
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
                updateNodeSidebar();
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

        const labelEl = $('expeditionNodeLabel');
        const locationEl = $('expeditionNodeLocation');
        const isStartEl = $('expeditionNodeIsStart');
        const deleteBtn = $('expeditionDeleteNodeBtn');
        if (labelEl) labelEl.addEventListener('input', applySidebarFieldsLive);
        if (locationEl) locationEl.addEventListener('change', applySidebarFieldsLive);
        if (isStartEl) isStartEl.addEventListener('change', applySidebarFieldsLive);
        if (deleteBtn) deleteBtn.addEventListener('click', deleteSelectedNode);
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
            syncGlobalCaches(state.settlementId || getSelectedSettlementFromDom(), 'settlements subscription');
            updateNodeSidebar();
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
            refreshNodeSidebarQuestOptions();
            log('Quests subscription fired', buildGlobalSnapshot(settlementId));
        });

        window.subscribeToGlobalData('expeditions', () => {
            const settlementId = state.settlementId || getSelectedSettlementFromDom();
            if (!(settlementId > 0) || state.dirty || state.isSaving) {
                return;
            }
            const expedition = getPreloadedExpedition(settlementId);
            if (!expedition) {
                return;
            }
            applyExpeditionPayload(expedition);
            renderMap();
            updateNodeSidebar();
            clearDirty();
            log('Expeditions subscription refreshed current settlement from GlobalData', {
                settlementId,
                expeditionId: state.expeditionId,
                mapAssetId: state.mapAssetId,
                nodes: state.nodes.size,
                edges: state.edges.size,
            });
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
