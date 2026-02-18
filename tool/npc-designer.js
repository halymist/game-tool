// NPC Manager

let npcState = {
    npcs: [],
    filtered: [],
    selectedId: null,
};

const npcDataSubscriptions = [];

function registerNpcDesigner() {
    if (!document.getElementById('npcs-content')) return;
    window.initNpcManager = initNpcManager;
    window.loadNpcData = loadNpcData;
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', registerNpcDesigner);
} else {
    registerNpcDesigner();
}

async function initNpcManager() {
    console.log('👥 Initializing NPC Manager...');
    setupNpcListeners();
    setupNpcDataSubscriptions();
    await loadNpcData();
    console.log('✅ NPC Manager initialized');
}

function setupNpcListeners() {
    document.getElementById('npcSearch')?.addEventListener('input', filterNpcs);
    document.getElementById('npcSettlementFilter')?.addEventListener('change', filterNpcs);

    const form = document.getElementById('npcForm');
    if (form) {
        form.addEventListener('submit', saveNpc);
        form.addEventListener('input', checkNpcDirty);
        form.addEventListener('change', checkNpcDirty);
    }

    document.getElementById('npcDeleteBtn')?.addEventListener('click', deleteNpc);
}

function getNpcFormSnapshot() {
    return JSON.stringify({
        name: document.getElementById('npcName')?.value ?? '',
        context: document.getElementById('npcContext')?.value ?? '',
        role: document.getElementById('npcRole')?.value ?? '',
        personality: document.getElementById('npcPersonality')?.value ?? '',
        goals: document.getElementById('npcGoals')?.value ?? '',
        settlement: document.getElementById('npcSettlementSelect')?.value ?? '',
    });
}

function checkNpcDirty() {
    if (!npcState.snapshot) return;
    const current = getNpcFormSnapshot();
    setNpcSaveDirty(current !== npcState.snapshot);
}

function setNpcSaveDirty(dirty) {
    const btn = document.getElementById('npcSaveBtn');
    if (btn) {
        btn.disabled = !dirty;
        btn.classList.toggle('btn-disabled', !dirty);
    }
}

function setupNpcDataSubscriptions() {
    if (typeof subscribeToGlobalData !== 'function') return;
    if (npcDataSubscriptions.length > 0) return;
    npcDataSubscriptions.push(subscribeToGlobalData('settlements', () => {
        populateNpcSettlementFilters();
    }));
}

async function loadNpcData(options = {}) {
    const forceReload = options?.forceReload === true;

    // If already loaded from GlobalData and not forcing, just re-render
    if (!forceReload && npcState.npcs.length > 0) {
        npcState.filtered = [...npcState.npcs];
        renderNpcTable();
        return;
    }

    try {
        // Use global loader (caches, deduplicates)
        if (typeof loadNpcsData === 'function') {
            await loadNpcsData(forceReload ? { forceReload: true } : {});
        }

        npcState.npcs = GlobalData.npcs || [];
        npcState.filtered = [...npcState.npcs];
        renderNpcTable();
        populateNpcSettlementFilters();
        if (!npcState.selectedId) {
            createNewNpc();
        }
    } catch (error) {
        console.error('Error loading NPCs:', error);
        setNpcStatus('Failed to load NPCs', true);
    }
}

function populateNpcSettlementFilters() {
    const filter = document.getElementById('npcSettlementFilter');
    const select = document.getElementById('npcSettlementSelect');
    const settlements = GlobalData?.settlements || [];
    if (filter) {
        filter.innerHTML = '<option value="">All Settlements</option>';
        settlements.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.settlement_id;
            opt.textContent = s.settlement_name;
            filter.appendChild(opt);
        });
    }
    if (select) {
        select.innerHTML = '<option value="">-- None --</option>';
        settlements.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.settlement_id;
            opt.textContent = s.settlement_name;
            select.appendChild(opt);
        });
    }
}

function filterNpcs() {
    const search = document.getElementById('npcSearch')?.value.toLowerCase().trim() || '';
    const settlementId = document.getElementById('npcSettlementFilter')?.value || '';

    npcState.filtered = npcState.npcs.filter(npc => {
        const nameMatch = (npc.name || '').toLowerCase().includes(search);
        const settlementMatch = !settlementId || String(npc.settlement_id || '') === settlementId;
        return nameMatch && settlementMatch;
    });

    renderNpcTable();
}

function renderNpcTable() {
    const tbody = document.getElementById('npcTableBody');
    if (!tbody) return;

    if (!npcState.filtered.length) {
        tbody.innerHTML = '<tr><td colspan="2" class="npc-empty">No NPCs found</td></tr>';
        return;
    }

    tbody.innerHTML = npcState.filtered.map(npc => `
        <tr class="${npcState.selectedId === npc.npc_id ? 'selected' : ''}" data-id="${npc.npc_id}">
            <td>${escapeHtml(npc.name)}</td>
            <td>${escapeHtml(npc.settlement_name || '—')}</td>
        </tr>
    `).join('');

    tbody.querySelectorAll('tr[data-id]').forEach(row => {
        row.addEventListener('click', () => selectNpc(parseInt(row.dataset.id, 10)));
    });
}

function selectNpc(npcId) {
    const npc = npcState.npcs.find(n => n.npc_id === npcId);
    if (!npc) return;

    npcState.selectedId = npcId;
    document.getElementById('npcId').value = npc.npc_id;
    document.getElementById('npcName').value = npc.name || '';
    document.getElementById('npcContext').value = npc.context || '';
    document.getElementById('npcRole').value = npc.role || '';
    document.getElementById('npcPersonality').value = formatNpcList(npc.personality);
    document.getElementById('npcGoals').value = formatNpcList(npc.goals);
    document.getElementById('npcSettlementSelect').value = npc.settlement_id || '';

    document.getElementById('npcDeleteBtn').disabled = false;
    npcState.snapshot = getNpcFormSnapshot();
    setNpcSaveDirty(false);
    renderNpcTable();
}

function createNewNpc() {
    npcState.selectedId = null;
    document.getElementById('npcId').value = '';
    document.getElementById('npcName').value = '';
    document.getElementById('npcContext').value = '';
    document.getElementById('npcRole').value = '';
    document.getElementById('npcPersonality').value = '';
    document.getElementById('npcGoals').value = '';
    document.getElementById('npcSettlementSelect').value = '';
    document.getElementById('npcDeleteBtn').disabled = true;
    npcState.snapshot = getNpcFormSnapshot();
    setNpcSaveDirty(false);
    renderNpcTable();
}

async function saveNpc(e) {
    e.preventDefault();

    const payload = {
        npcId: document.getElementById('npcId').value ? parseInt(document.getElementById('npcId').value, 10) : null,
        name: document.getElementById('npcName').value.trim(),
        context: document.getElementById('npcContext').value.trim() || null,
        role: document.getElementById('npcRole').value.trim() || null,
        personality: parseNpcList(document.getElementById('npcPersonality').value || ''),
        goals: parseNpcList(document.getElementById('npcGoals').value || ''),
        settlementId: document.getElementById('npcSettlementSelect').value ? parseInt(document.getElementById('npcSettlementSelect').value, 10) : null
    };

    if (!payload.name) {
        setNpcStatus('Name is required', true);
        return;
    }

    try {
        const token = await getCurrentAccessToken();
        if (!token) return;

        const endpoint = payload.npcId ? 'updateNpc' : 'createNpc';
        const response = await fetch(`http://localhost:8080/api/${endpoint}`, {
            method: payload.npcId ? 'PUT' : 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (!data.success) {
            setNpcStatus(data.message || 'Save failed', true);
            return;
        }

        const saved = data.npc;
        const idx = npcState.npcs.findIndex(n => n.npc_id === saved.npc_id);
        if (idx >= 0) {
            npcState.npcs[idx] = saved;
        } else {
            npcState.npcs.unshift(saved);
        }

        // Sync back to GlobalData
        if (typeof setGlobalArray === 'function') {
            setGlobalArray('npcs', [...npcState.npcs]);
        }

        npcState.filtered = [...npcState.npcs];
        selectNpc(saved.npc_id);
        setNpcStatus('Saved', false);
    } catch (error) {
        console.error('Error saving NPC:', error);
        setNpcStatus('Save failed', true);
    }
}

async function deleteNpc() {
    if (!npcState.selectedId) return;
    if (!confirm('Delete this NPC?')) return;

    try {
        const token = await getCurrentAccessToken();
        if (!token) return;

        const response = await fetch(`http://localhost:8080/api/deleteNpc?npcId=${npcState.selectedId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await response.json();
        if (!data.success) {
            setNpcStatus(data.message || 'Delete failed', true);
            return;
        }

        npcState.npcs = npcState.npcs.filter(n => n.npc_id !== npcState.selectedId);
        npcState.filtered = [...npcState.npcs];

        // Sync back to GlobalData
        if (typeof setGlobalArray === 'function') {
            setGlobalArray('npcs', [...npcState.npcs]);
        }

        createNewNpc();
        setNpcStatus('Deleted', false);
        renderNpcTable();
    } catch (error) {
        console.error('Error deleting NPC:', error);
        setNpcStatus('Delete failed', true);
    }
}

function setNpcStatus(message, isError) {
    const status = document.getElementById('npcStatus');
    if (!status) return;
    status.textContent = message;
    status.className = `npc-status ${isError ? 'error' : 'success'}`;
    if (!isError) {
        setTimeout(() => {
            status.textContent = '';
            status.className = 'npc-status';
        }, 2000);
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function parseNpcList(text) {
    return text
        .split(/[\n,]/)
        .map(entry => entry.trim())
        .filter(Boolean);
}

function formatNpcList(value) {
    if (!value) return '';
    if (Array.isArray(value)) return value.join('\n');
    return String(value);
}
