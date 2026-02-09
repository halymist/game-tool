// Talent Editor

let talentEditorState = {
    talents: [],
    selectedTalentId: null,
    filteredTalents: []
};

let talentAssets = [];

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

    const effectSelect = document.getElementById('talentEffectId');
    if (effectSelect) {
        effectSelect.addEventListener('change', () => {
            updateEffectDescription(effectSelect.value);
        });
    }

    const assetGalleryBtn = document.getElementById('talentAssetGalleryBtn');
    if (assetGalleryBtn) assetGalleryBtn.addEventListener('click', toggleTalentAssetGallery);

    const assetGalleryClose = document.getElementById('talentAssetGalleryClose');
    if (assetGalleryClose) assetGalleryClose.addEventListener('click', toggleTalentAssetGallery);

    const assetGalleryOverlay = document.getElementById('talentAssetGalleryOverlay');
    if (assetGalleryOverlay) {
        assetGalleryOverlay.addEventListener('click', (e) => {
            if (e.target === assetGalleryOverlay) toggleTalentAssetGallery();
        });
    }

    const uploadBtn = document.getElementById('talentUploadNewBtn');
    if (uploadBtn) uploadBtn.addEventListener('click', () => document.getElementById('talentAssetFile').click());

    const uploadBtnOverlay = document.getElementById('talentUploadNewBtnOverlay');
    if (uploadBtnOverlay) uploadBtnOverlay.addEventListener('click', () => document.getElementById('talentAssetFile').click());

    const fileInput = document.getElementById('talentAssetFile');
    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) uploadTalentAsset(file);
            e.target.value = '';
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

        await loadTalentAssets();
        createTalentAssetGallery();

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

async function loadTalentAssets() {
    try {
        const token = await getCurrentAccessToken();
        if (!token) return;

        const response = await fetch('http://localhost:8080/api/getTalentAssets', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();
        if (data.success && data.assets) {
            talentAssets = data.assets;
            console.log('✅ Loaded', talentAssets.length, 'talent assets');
        }
    } catch (error) {
        console.error('Error loading talent assets:', error);
    }
}

function createTalentAssetGallery() {
    const grid = document.getElementById('talentAssetGrid');
    if (!grid) return;

    if (talentAssets.length === 0) {
        grid.innerHTML = '<p class="loading-text">No assets found. Upload a new one!</p>';
        return;
    }

    grid.innerHTML = talentAssets.map(asset => `
        <div class="asset-item" onclick="selectTalentAsset(${asset.assetID}, '${asset.icon}')">
            <img src="${asset.icon}" alt="Asset ${asset.assetID}">
            <span class="asset-id">${asset.assetID}</span>
        </div>
    `).join('');
}

function toggleTalentAssetGallery() {
    const overlay = document.getElementById('talentAssetGalleryOverlay');
    if (!overlay) return;
    overlay.classList.toggle('hidden');
}

function selectTalentAsset(assetId, iconUrl) {
    document.getElementById('talentAssetId').value = assetId;
    updateTalentAssetPreview(assetId, iconUrl);
    toggleTalentAssetGallery();
}

function updateTalentAssetPreview(assetId, iconUrl) {
    const preview = document.getElementById('talentAssetPreview');
    const image = document.getElementById('talentAssetImage');
    const placeholder = document.getElementById('talentAssetPlaceholder');
    const assetIdDisplay = document.getElementById('talentAssetIdDisplay');

    if (image) {
        image.src = iconUrl || '';
    }
    if (preview) {
        preview.classList.toggle('has-image', !!iconUrl);
    }
    if (placeholder) {
        placeholder.style.display = iconUrl ? 'none' : 'block';
    }
    if (assetIdDisplay) {
        assetIdDisplay.textContent = `Asset ID: ${assetId || 'None'}`;
    }
}

async function uploadTalentAsset(file) {
    if (!file.type.startsWith('image/')) {
        alert('Please select an image file');
        return;
    }

    try {
        const webpBlob = await convertImageToWebP(file, 128, 128, 0.8);
        const base64Data = await blobToBase64(webpBlob);
        const nextAssetID = getNextAvailableTalentAssetID();

        const token = await getCurrentAccessToken();
        if (!token) {
            alert('Authentication required');
            return;
        }

        const response = await fetch('http://localhost:8080/api/uploadTalentAsset', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                assetID: nextAssetID,
                imageData: base64Data,
                contentType: 'image/webp'
            })
        });

        const result = await response.json();
        if (result.success) {
            talentAssets.push({
                assetID: result.assetID,
                name: result.assetID.toString(),
                icon: result.icon || base64Data
            });
            createTalentAssetGallery();
            selectTalentAsset(result.assetID, result.icon || base64Data);
            alert('Talent asset uploaded successfully!');
        } else {
            alert('Error uploading asset: ' + (result.message || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error uploading talent asset:', error);
        alert('Failed to upload asset. Please try again.');
    }
}

function getNextAvailableTalentAssetID() {
    if (!talentAssets || talentAssets.length === 0) {
        return 1;
    }

    let maxID = 0;
    for (const asset of talentAssets) {
        if (asset.assetID > maxID) {
            maxID = asset.assetID;
        }
    }

    return maxID + 1;
}

function getTalentAssetIcon(assetId) {
    const asset = talentAssets.find(a => a.assetID === assetId);
    return asset ? asset.icon : '';
}

function updateEffectDescription(effectId) {
    const descEl = document.getElementById('talentEffectDescription');
    if (!descEl) return;
    if (!effectId) {
        descEl.textContent = '';
        return;
    }
    const effect = (GlobalData.effects || []).find(e => String(e.id) === String(effectId));
    descEl.textContent = effect?.description || '';
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

        const iconUrl = getTalentAssetIcon(talent.assetId);
        cell.innerHTML = `
            <div class="talent-max">${talent.maxPoints ?? ''}</div>
            <img class="talent-icon" src="${iconUrl}" alt="Talent ${talent.talentId}" onerror="this.style.display='none'">
            <div class="talent-name">${escapeHtml(talent.talentName || '')}</div>
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
    document.getElementById('talentAssetId').value = talent.assetId ?? 1;
    updateTalentAssetPreview(talent.assetId, getTalentAssetIcon(talent.assetId));
    updateEffectDescription(talent.effectId);

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
        assetId: parseInt(document.getElementById('talentAssetId').value, 10),
        maxPoints: parseInt(document.getElementById('talentMaxPoints').value, 10),
        perkSlot: document.getElementById('talentPerkSlot').checked,
        effectId: document.getElementById('talentEffectId').value ? parseInt(document.getElementById('talentEffectId').value, 10) : null,
        factor: document.getElementById('talentFactor').value ? parseInt(document.getElementById('talentFactor').value, 10) : null,
        description: document.getElementById('talentDescription').value.trim() || null
    };

    if (!payload.talentName || !payload.maxPoints || !payload.assetId) {
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
