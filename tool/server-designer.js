// Server Manager

let serverState = {
    servers: [],
    selectedServerId: null
};

function registerServerDesigner() {
    if (!document.getElementById('servers-content')) return;
    window.initServerManager = initServerManager;
    window.loadServerData = loadServerData;
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', registerServerDesigner);
} else {
    registerServerDesigner();
}

async function initServerManager() {
    console.log('🖥️ Initializing Server Manager...');
    setupServerListeners();
    await loadServerData();
    console.log('✅ Server Manager initialized');
}

function setupServerListeners() {
    document.getElementById('serverCreateOpenBtn')?.addEventListener('click', () => {
        showCreateServerModal();
    });
}

async function loadServerData() {
    try {
        const token = await getCurrentAccessToken();
        if (!token) return;

        const response = await fetch('/api/getServers', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (!data.success) {
            setServerStatus(data.message || 'Failed to load servers', true);
            return;
        }

        serverState.servers = data.servers || [];
        window.servers = serverState.servers;
        if (!serverState.selectedServerId && serverState.servers.length) {
            serverState.selectedServerId = serverState.servers[0].id;
        }
        renderServerTable();
        const selected = serverState.servers.find(s => s.id === serverState.selectedServerId);
        renderServerPlanDetails(selected || null);
    } catch (error) {
        console.error('Error loading servers:', error);
        setServerStatus('Failed to load servers', true);
    }
}

function renderServerTable() {
    const tbody = document.getElementById('serverTableBody');
    if (!tbody) return;

    if (!serverState.servers.length) {
        tbody.innerHTML = `<tr><td colspan="6" class="server-empty">No servers found</td></tr>`;
        renderServerPlanDetails(null);
        return;
    }

    const rows = serverState.servers.map(s => `
        <tr class="${serverState.selectedServerId === s.id ? 'selected' : ''}" onclick="selectServer(${s.id})">
            <td>${escapeHtml(s.name || '')}</td>
            <td>${formatDateTime(s.created_at)}</td>
            <td>${formatDateTime(s.ends_at)}</td>
            <td>${s.character_count ?? 0}</td>
            <td>${s.player_count ?? 0}</td>
            <td>${s.current_day ?? '—'}</td>
        </tr>
    `).join('');

    tbody.innerHTML = rows;
}

function selectServer(serverId) {
    serverState.selectedServerId = serverId;
    renderServerTable();
    const server = serverState.servers.find(s => s.id === serverId);
    renderServerPlanDetails(server);
}

function showCreateServerModal() {
    let overlay = document.getElementById('serverCreateOverlay');
    if (overlay) overlay.remove();

    const hourOptions = Array.from({length: 24}, (_, i) => {
        const hh = String(i).padStart(2, '0');
        return `<option value="${hh}">${hh}:00</option>`;
    }).join('');

    overlay = document.createElement('div');
    overlay.id = 'serverCreateOverlay';
    overlay.className = 'server-create-overlay';
    overlay.innerHTML = `
        <div class="server-create-modal">
            <h3>Create Server</h3>
            <div id="serverModalForm">
                <div class="server-modal-field">
                    <label>Name</label>
                    <input type="text" id="serverName" placeholder="Server name...">
                </div>
                <div class="server-modal-field">
                    <label>Starts at</label>
                    <div class="server-datetime-inputs">
                        <input type="date" id="serverStartDate">
                        <select id="serverStartHour">
                            <option value="">--</option>
                            ${hourOptions}
                        </select>
                    </div>
                </div>
                <div id="serverModalError" class="server-modal-error" style="display:none;"></div>
                <div class="server-modal-actions">
                    <button type="button" id="serverModalCancelBtn" class="btn-modal-cancel">Cancel</button>
                    <button type="button" id="serverModalNextBtn" class="btn-modal-create">Next</button>
                </div>
            </div>
            <div id="serverModalConfirm" style="display:none;">
                <div class="server-confirm-summary" id="serverConfirmSummary"></div>
                <div class="server-modal-actions">
                    <button type="button" id="serverModalBackBtn" class="btn-modal-cancel">Back</button>
                    <button type="button" id="serverModalCreateBtn" class="btn-modal-create">Create Server</button>
                </div>
            </div>
        </div>
    `;

    document.querySelector('.server-list-panel').appendChild(overlay);

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeCreateServerModal();
    });
    document.getElementById('serverModalCancelBtn').addEventListener('click', closeCreateServerModal);
    document.getElementById('serverModalNextBtn').addEventListener('click', showServerConfirmation);
    document.getElementById('serverModalBackBtn').addEventListener('click', () => {
        document.getElementById('serverModalForm').style.display = '';
        document.getElementById('serverModalConfirm').style.display = 'none';
    });
    document.getElementById('serverModalCreateBtn').addEventListener('click', () => createServer());

    document.getElementById('serverName').focus();
}

function showServerConfirmation() {
    const name = document.getElementById('serverName').value.trim();
    const dateVal = document.getElementById('serverStartDate').value;
    const hourVal = document.getElementById('serverStartHour').value;

    // Validation
    const errors = [];
    if (!name) {
        errors.push('Name is required');
    } else if (name.length < 6) {
        errors.push('Name must be at least 6 characters');
    } else if (!/^[a-zA-Z\s]+$/.test(name)) {
        errors.push('Name can only contain letters and spaces');
    }
    if (!dateVal) {
        errors.push('Start date is required');
    }

    const errEl = document.getElementById('serverModalError');
    if (errors.length > 0) {
        if (errEl) {
            errEl.textContent = errors[0];
            errEl.style.display = 'block';
        }
        return;
    }
    if (errEl) errEl.style.display = 'none';

    let startStr, endStr;
    if (dateVal) {
        const start = new Date(`${dateVal}T${hourVal || '00'}:00:00`);
        const end = new Date(start.getTime() + 70 * 24 * 60 * 60 * 1000);
        startStr = formatDateTime(start.toISOString());
        endStr = formatDateTime(end.toISOString());
    } else {
        const now = new Date();
        const end = new Date(now.getTime() + 70 * 24 * 60 * 60 * 1000);
        startStr = 'Now';
        endStr = formatDateTime(end.toISOString());
    }

    const summary = document.getElementById('serverConfirmSummary');
    summary.innerHTML = `
        <div class="server-confirm-row"><span>Name</span><strong>${escapeHtml(name)}</strong></div>
        <div class="server-confirm-row"><span>Starts</span><strong>${startStr}</strong></div>
        <div class="server-confirm-row"><span>Ends (+70 days)</span><strong>${endStr}</strong></div>
    `;

    document.getElementById('serverModalForm').style.display = 'none';
    document.getElementById('serverModalConfirm').style.display = '';
}

function closeCreateServerModal() {
    const overlay = document.getElementById('serverCreateOverlay');
    if (overlay) overlay.remove();
}

async function createServer() {

    const name = document.getElementById('serverName').value.trim();
    const dateVal = document.getElementById('serverStartDate').value;
    const hourVal = document.getElementById('serverStartHour').value;
    const startsAt = dateVal ? `${dateVal}T${hourVal || '00'}:00` : null;

    try {
        const token = await getCurrentAccessToken();
        if (!token) return;

        const response = await fetch('/api/createServer', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: name || null,
                startsAt: startsAt || null
            })
        });

        const data = await response.json();
        if (!data.success) {
            setServerStatus(data.message || 'Create failed', true);
            return;
        }

        serverState.servers.unshift(data.server);
        serverState.selectedServerId = data.server?.id ?? serverState.selectedServerId;
        renderServerTable();
        renderServerPlanDetails(data.server);
        closeCreateServerModal();
        const statusMsg = data.message ? `Server created (${data.message})` : 'Server created';
        setServerStatus(statusMsg, !!data.message);
    } catch (error) {
        console.error('Error creating server:', error);
        setServerStatus('Create failed', true);
    }
}

function setServerStatus(message, isError) {
    const status = document.getElementById('serverStatus');
    if (!status) return;
    status.textContent = message;
    status.className = `server-status ${isError ? 'error' : 'success'}`;
    if (!isError) {
        setTimeout(() => {
            status.textContent = '';
            status.className = 'server-status';
        }, 2000);
    }
}

function formatDateTime(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    const day = d.getDate();
    const month = d.getMonth() + 1;
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, '0');
    return `${day}.${month}.${year} ${hours}:00`;
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderServerPlanDetails(server) {
    const container = document.getElementById('serverPlanDetails');
    if (!container) return;
    if (!server) {
        container.innerHTML = '<div class="server-plan-empty">Select a server to view its world plan.</div>';
        return;
    }

    const plan = server.plan || [];
    if (!plan.length) {
        container.innerHTML = '<div class="server-plan-empty">No plan rows found for this server.</div>';
        return;
    }

    const currentLabel = server.current_day ? `<div class="server-plan-current">Current day: ${server.current_day}</div>` : '';
    const rows = plan.map(p => {
        const flags = [
            p.blacksmith ? 'B' : '',
            p.alchemist ? 'A' : '',
            p.enchanter ? 'E' : '',
            p.trainer ? 'T' : '',
            p.church ? 'C' : ''
        ].filter(Boolean).join('');
        const blessings = [p.blessing1, p.blessing2, p.blessing3].filter(v => v != null).join(',');
        const settlement = p.settlement_name || `#${p.settlement_id}`;
        const isCurrent = server.current_day && p.server_day === server.current_day;
        return `
            <div class="server-plan-row ${isCurrent ? 'current' : ''}">
                <span class="server-plan-day">Day ${p.server_day}</span>
                <span class="server-plan-faction">F${p.faction}</span>
                <span class="server-plan-settlement">${settlement}</span>
                ${flags ? `<span class="server-plan-flags">${flags}</span>` : ''}
                ${blessings ? `<span class="server-plan-blessings">Blessings ${blessings}</span>` : ''}
            </div>
        `;
    }).join('');

    container.innerHTML = `${currentLabel}<div class="server-plan-list">${rows}</div>`;
}
