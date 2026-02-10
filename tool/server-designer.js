// Server Manager

let serverState = {
    servers: [],
    selectedServerId: null
};

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('servers-content')) {
        window.initServerManager = initServerManager;
        window.loadServerData = loadServerData;
    }
});

async function initServerManager() {
    console.log('🖥️ Initializing Server Manager...');
    setupServerListeners();
    await loadServerData();
    console.log('✅ Server Manager initialized');
}

function setupServerListeners() {
    document.getElementById('serverTableBody')?.addEventListener('click', (e) => {
        const target = e.target;
        if (!(target instanceof HTMLElement)) return;
        if (target.id === 'serverCreateBtn') {
            createServer(e);
        }
    });
}

async function loadServerData() {
    try {
        const token = await getCurrentAccessToken();
        if (!token) return;

        const response = await fetch('http://localhost:8080/api/getServers', {
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

    const createRow = `
        <tr class="server-create-row">
            <td><input type="text" id="serverName" placeholder="Server name..."></td>
            <td><input type="datetime-local" id="serverStartsAt"></td>
            <td colspan="3"></td>
            <td><button type="button" id="serverCreateBtn" class="btn-save">Create</button></td>
        </tr>
    `;

    if (!serverState.servers.length) {
        tbody.innerHTML = `${createRow}<tr><td colspan="6" class="server-empty">No servers found</td></tr>`;
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

    tbody.innerHTML = `${createRow}${rows}`;
}

function selectServer(serverId) {
    serverState.selectedServerId = serverId;
    renderServerTable();
    const server = serverState.servers.find(s => s.id === serverId);
    renderServerPlanDetails(server);
}

async function createServer(e) {
    e.preventDefault();

    const name = document.getElementById('serverName').value.trim();
    const startsAt = document.getElementById('serverStartsAt').value;

    try {
        const token = await getCurrentAccessToken();
        if (!token) return;

        const response = await fetch('http://localhost:8080/api/createServer', {
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
        document.getElementById('serverName').value = '';
        document.getElementById('serverStartsAt').value = '';
        setServerStatus('Server created', false);
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
    return d.toLocaleString();
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
