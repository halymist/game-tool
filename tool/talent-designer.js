// Talent Editor

let talentEditorState = {
    talents: [],
    selectedTalentId: null,
    filteredTalents: []
};

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('talents-content')) {
        // Initialized via showPage for better UX
        window.loadTalentEditorData = loadTalentEditorData;
        window.initTalentDesigner = initTalentDesigner;
    }
});

async function initTalentDesigner() {
    console.log('🌟 Initializing Talent Editor...');
    setupTalentEditorListeners();
    await loadTalentEditorData();
    console.log('✅ Talent Editor initialized');
}

function setupTalentEditorListeners() {
    const searchInput = document.getElementById('talentSearch');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            renderTalentGrid(searchInput.value);
        });
    }

    const saveBtn = document.getElementById('talentSaveBtn');
    if (saveBtn) saveBtn.addEventListener('click', saveTalentChanges);

    const resetBtn = document.getElementById('talentResetBtn');
    if (resetBtn) resetBtn.addEventListener('click', resetTalentForm);
}

async function loadTalentEditorData() {
    try {
        const token = await getCurrentAccessToken();
        if (!token) return;

        // Load effects if not already loaded
        if (typeof loadEffectsData === 'function') {
            await loadEffectsData();
        }

        const response = await fetch('http://localhost:8080/api/getTalentsInfo', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();
        if (!data.success) {
            console.error('Failed to load talents:', data.message);
            return;
        }

        talentEditorState.talents = data.talents || [];
        talentEditorState.filteredTalents = [...talentEditorState.talents];

        populateTalentEffectOptions();
        renderTalentGrid();
    } catch (error) {
        console.error('Error loading talents:', error);
    }
}

function populateTalentEffectOptions() {
    const select = document.getElementById('talentEffectId');
    if (!select) return;

    const effects = GlobalData.effects || [];
    select.innerHTML = '<option value="">-- No Effect --</option>';
    effects.forEach(effect => {
        const opt = document.createElement('option');
        opt.value = effect.id;
        opt.textContent = `${effect.id} - ${effect.name}`;
        select.appendChild(opt);
    });
}

function renderTalentGrid(filterText = '') {
    const grid = document.getElementById('talentGrid');
    if (!grid) return;

    const search = filterText.trim().toLowerCase();
    let talents = talentEditorState.talents;

    if (search) {
        talents = talents.filter(t => {
            const name = (t.talentName || '').toLowerCase();
            const idStr = String(t.talentId || '');
            return name.includes(search) || idStr.includes(search);
        });
    }

    grid.innerHTML = '';

    talents.forEach(talent => {
        const cell = document.createElement('div');
        cell.className = 'talent-cell' + (talent.talentId === talentEditorState.selectedTalentId ? ' selected' : '');
        // Place in 7x8 grid, with row 1 at bottom
        const row = talent.row || 1;
        const col = talent.col || 1;
        const gridRow = 9 - row; // invert so row 1 is bottom
        cell.style.gridRow = String(gridRow);
        cell.style.gridColumn = String(col);

        const effectLabel = talent.effectId ? `Effect ${talent.effectId}` : 'No effect';
        cell.innerHTML = `
            <div class="talent-id">ID: ${talent.talentId}</div>
            <div class="talent-name">${escapeHtml(talent.talentName || '')}</div>
            <div class="talent-meta">${effectLabel}</div>
        `;

        cell.addEventListener('click', () => selectTalent(talent.talentId));
        grid.appendChild(cell);
    });
}

function selectTalent(talentId) {
    const talent = talentEditorState.talents.find(t => t.talentId === talentId);
    if (!talent) return;

    talentEditorState.selectedTalentId = talentId;

    const form = document.getElementById('talentEditorForm');
    const empty = document.getElementById('talentEditorEmpty');
    if (form && empty) {
        form.style.display = 'flex';
        empty.style.display = 'none';
    }

    document.getElementById('talentId').value = talent.talentId ?? '';
    document.getElementById('talentName').value = talent.talentName ?? '';
    document.getElementById('talentMaxPoints').value = talent.maxPoints ?? 1;
    document.getElementById('talentPerkSlot').checked = talent.perkSlot === true || talent.perkSlot === 1;
    document.getElementById('talentEffectId').value = talent.effectId ?? '';
    document.getElementById('talentFactor').value = talent.factor ?? '';
    document.getElementById('talentDescription').value = talent.description ?? '';
    document.getElementById('talentRow').value = `Row ${talent.row}`;
    document.getElementById('talentCol').value = `Col ${talent.col}`;

    renderTalentGrid(document.getElementById('talentSearch')?.value || '');
}

function resetTalentForm() {
    if (!talentEditorState.selectedTalentId) return;
    selectTalent(talentEditorState.selectedTalentId);
}

async function saveTalentChanges() {
    const status = document.getElementById('talentEditorStatus');
    const talentId = parseInt(document.getElementById('talentId').value, 10);

    if (!talentId) return;

    const payload = {
        talentId: talentId,
        talentName: document.getElementById('talentName').value.trim(),
        maxPoints: parseInt(document.getElementById('talentMaxPoints').value, 10),
        perkSlot: document.getElementById('talentPerkSlot').checked,
        effectId: document.getElementById('talentEffectId').value ? parseInt(document.getElementById('talentEffectId').value, 10) : null,
        factor: document.getElementById('talentFactor').value ? parseInt(document.getElementById('talentFactor').value, 10) : null,
        description: document.getElementById('talentDescription').value.trim() || null
    };

    if (!payload.talentName || !payload.maxPoints) {
        setTalentStatus('Please fill required fields.', true);
        return;
    }

    try {
        const token = await getCurrentAccessToken();
        if (!token) return;

        const response = await fetch('http://localhost:8080/api/updateTalentInfo', {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (!data.success) {
            setTalentStatus(data.message || 'Update failed', true);
            return;
        }

        const updated = data.talent;
        const idx = talentEditorState.talents.findIndex(t => t.talentId === updated.talentId);
        if (idx >= 0) {
            talentEditorState.talents[idx] = updated;
        }

        setTalentStatus('Saved!', false);
        selectTalent(updated.talentId);
    } catch (error) {
        console.error('Error saving talent:', error);
        setTalentStatus('Save failed', true);
    }
}

function setTalentStatus(message, isError) {
    const status = document.getElementById('talentEditorStatus');
    if (!status) return;
    status.textContent = message;
    status.className = `talent-editor-status ${isError ? 'error' : 'success'}`;
    if (!isError) {
        setTimeout(() => {
            status.textContent = '';
            status.className = 'talent-editor-status';
        }, 2000);
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
