// Server Manager

let serverState = {
    servers: []
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
    const form = document.getElementById('serverForm');
    if (form) form.addEventListener('submit', createServer);
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
        renderServerTable();
    } catch (error) {
        console.error('Error loading servers:', error);
        setServerStatus('Failed to load servers', true);
    }
}

function renderServerTable() {
    const tbody = document.getElementById('serverTableBody');
    if (!tbody) return;

    if (!serverState.servers.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="server-empty">No servers found</td></tr>';
        return;
    }

    tbody.innerHTML = serverState.servers.map(s => `
        <tr>
            <td>${escapeHtml(s.name || '')}</td>
            <td>${formatDateTime(s.created_at)}</td>
            <td>${formatDateTime(s.ends_at)}</td>
            <td>${s.character_count ?? 0}</td>
            <td>${s.player_count ?? 0}</td>
            <td>${renderServerPlan(s.plan || [], s.current_day)}</td>
        </tr>
    `).join('');
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

function renderServerPlan(plan, currentDay) {
    if (!plan || plan.length === 0) return '<span class="server-plan">—</span>';
    const currentLabel = currentDay ? `<span class="server-plan-current">Current day: ${currentDay}</span>` : '';
    const items = plan.map(p => {
        const flags = [
            p.blacksmith ? 'B' : '',
            p.alchemist ? 'A' : '',
            p.enchanter ? 'E' : '',
            p.trainer ? 'T' : '',
            p.church ? 'C' : ''
        ].filter(Boolean).join('');
        const blessings = [p.blessing1, p.blessing2, p.blessing3].filter(v => v != null).join(',');
        const settlement = p.settlement_name || `#${p.settlement_id}`;
        const isCurrent = currentDay && p.server_day === currentDay;
        return `<span class="server-plan-item ${isCurrent ? 'current' : ''}">Day ${p.server_day} • F${p.faction} • ${settlement}${flags ? ' • ' + flags : ''}${blessings ? ' • Blessings ' + blessings : ''}</span>`;
    }).join('');
    return `<div class="server-plan">${currentLabel}${items}</div>`;
}
