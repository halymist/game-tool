// Chat Moderation

let moderationState = {
    words: [],
    filter: '',
    servers: []
};

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('moderation-content')) {
        window.initModerationManager = initModerationManager;
        window.loadModerationData = loadModerationData;
    }
});

async function initModerationManager() {
    console.log('🛡️ Initializing Chat Moderation...');
    setupModerationListeners();
    await loadModerationData();
    console.log('✅ Chat Moderation initialized');
}

function setupModerationListeners() {
    const form = document.getElementById('bannedWordForm');
    if (form) form.addEventListener('submit', addBannedWord);

    const filter = document.getElementById('bannedWordFilter');
    if (filter) {
        filter.addEventListener('input', (e) => {
            moderationState.filter = e.target.value.toLowerCase();
            renderBannedWords();
        });
    }
}

async function loadModerationData() {
    try {
        const token = await getCurrentAccessToken();
        if (!token) return;

        const response = await fetch('http://localhost:8080/api/getBannedWords', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (!data.success) {
            setModerationStatus(data.message || 'Failed to load banned words', true);
            return;
        }

        moderationState.words = data.words || [];
        renderBannedWords();
        await loadActiveServers();
    } catch (error) {
        console.error('Error loading banned words:', error);
        setModerationStatus('Failed to load banned words', true);
    }
}

function renderBannedWords() {
    const list = document.getElementById('bannedWordList');
    if (!list) return;

    const filter = moderationState.filter;
    const filtered = moderationState.words.filter(w => (w.word || '').toLowerCase().includes(filter));

    if (!filtered.length) {
        list.innerHTML = '<div class="moderation-empty">No banned words found</div>';
        return;
    }

    list.innerHTML = filtered.map(w => `
        <div class="banned-word-item">
            <div class="banned-word-text">${escapeHtml(w.word || '')}</div>
            <span class="severity-badge severity-${w.severity ?? 1}">Severity ${w.severity ?? 1}</span>
            <button class="banned-word-delete" onclick="deleteBannedWord(${w.id})" title="Delete">✕</button>
        </div>
    `).join('');
}

async function loadActiveServers() {
    const serverList = document.getElementById('chatServerList');
    if (!serverList) return;

    try {
        const token = await getCurrentAccessToken();
        if (!token) return;

        const response = await fetch('http://localhost:8080/api/getServers', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (!data.success) {
            serverList.innerHTML = '<div class="moderation-empty">No active servers</div>';
            return;
        }

        moderationState.servers = data.servers || [];
        window.servers = moderationState.servers;
        renderActiveServers();
    } catch (error) {
        console.error('Error loading servers:', error);
        serverList.innerHTML = '<div class="moderation-empty">No active servers</div>';
    }
}

function renderActiveServers() {
    const serverList = document.getElementById('chatServerList');
    if (!serverList) return;

    const now = new Date();
    const active = moderationState.servers.filter(s => {
        const start = s.created_at ? new Date(s.created_at) : null;
        const end = s.ends_at ? new Date(s.ends_at) : null;
        if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
        return start <= now && end >= now;
    });

    if (!active.length) {
        serverList.innerHTML = '<div class="moderation-empty">No active servers</div>';
        return;
    }

    serverList.innerHTML = active.map(s => {
        const day = getServerDayFromDates(s.created_at, now);
        const name = escapeHtml(s.name || `Server ${s.id}`);
        return `<div class="chat-server-item">${name} • Day ${day}</div>`;
    }).join('');
}

async function addBannedWord(e) {
    e.preventDefault();

    const wordInput = document.getElementById('bannedWordInput');
    const severityInput = document.getElementById('bannedWordSeverity');
    const word = wordInput.value.trim();
    const severity = parseInt(severityInput.value, 10);

    if (!word) {
        setModerationStatus('Word is required', true);
        return;
    }

    try {
        const token = await getCurrentAccessToken();
        if (!token) return;

        const response = await fetch('http://localhost:8080/api/addBannedWord', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ word, severity })
        });

        const data = await response.json();
        if (!data.success) {
            setModerationStatus(data.message || 'Failed to add word', true);
            return;
        }

        moderationState.words.unshift(data.word);
        renderBannedWords();
        wordInput.value = '';
        severityInput.value = '1';
        setModerationStatus('Word added', false);
    } catch (error) {
        console.error('Error adding banned word:', error);
        setModerationStatus('Failed to add word', true);
    }
}

async function deleteBannedWord(id) {
    if (!id) return;

    try {
        const token = await getCurrentAccessToken();
        if (!token) return;

        const response = await fetch('http://localhost:8080/api/deleteBannedWord', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ id })
        });

        const data = await response.json();
        if (!data.success) {
            setModerationStatus(data.message || 'Failed to delete word', true);
            return;
        }

        moderationState.words = moderationState.words.filter(w => w.id !== id);
        renderBannedWords();
        setModerationStatus('Word deleted', false);
    } catch (error) {
        console.error('Error deleting banned word:', error);
        setModerationStatus('Failed to delete word', true);
    }
}

function setModerationStatus(message, isError) {
    const status = document.getElementById('bannedWordStatus');
    if (!status) return;
    status.textContent = message;
    status.className = `moderation-status ${isError ? 'error' : 'success'}`;
    if (!isError) {
        setTimeout(() => {
            status.textContent = '';
            status.className = 'moderation-status';
        }, 2000);
    }
}

function getServerDayFromDates(startValue, nowValue) {
    const start = new Date(startValue);
    if (Number.isNaN(start.getTime())) return 1;
    const now = nowValue instanceof Date ? nowValue : new Date(nowValue);
    const startDate = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const nowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffDays = Math.max(0, Math.floor((nowDate - startDate) / 86400000));
    return diffDays + 1;
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
