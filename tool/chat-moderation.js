// Chat Moderation

let moderationState = {
    words: [],
    filter: ''
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
    } catch (error) {
        console.error('Error loading banned words:', error);
        setModerationStatus('Failed to load banned words', true);
    }
}

function renderBannedWords() {
    const tbody = document.getElementById('bannedWordTableBody');
    if (!tbody) return;

    const filter = moderationState.filter;
    const filtered = moderationState.words.filter(w => (w.word || '').toLowerCase().includes(filter));

    if (!filtered.length) {
        tbody.innerHTML = '<tr><td colspan="3" class="moderation-empty">No banned words found</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(w => `
        <tr>
            <td>${escapeHtml(w.word || '')}</td>
            <td><span class="severity-pill severity-${w.severity}">${w.severity ?? 1}</span></td>
            <td>
                <button class="btn-danger btn-small" onclick="deleteBannedWord(${w.id})">Delete</button>
            </td>
        </tr>
    `).join('');
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

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
