// Talent Editor

let talentEditorState = {
    talents: [],
    selectedTalentId: null,
    filteredTalents: []
};

let talentAssets = [];
let talentAssetGallery = null;

function registerTalentDesigner() {
    if (!document.getElementById('talents-content')) return;
    window.loadTalentEditorData = loadTalentEditorData;
    window.initTalentDesigner = initTalentDesigner;
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', registerTalentDesigner);
} else {
    registerTalentDesigner();
}

async function initTalentDesigner() {
    console.log('🌟 Initializing Talent Editor...');
    setupTalentEditorListeners();
    await loadTalentEditorData();
    console.log('✅ Talent Editor initialized');
}

function normalizeIntegerInputValue(input) {
    if (!input) return;
    const raw = String(input.value ?? '');
    if (raw === '') return;

    const allowNegative = input.min === '' || Number(input.min) < 0;
    const negative = allowNegative && raw.startsWith('-');
    let digits = raw.replace(/\D/g, '');
    digits = digits.replace(/^0+(?=\d)/, '');

    if (!digits) {
        input.value = raw === '-' && allowNegative ? '-' : '';
        return;
    }

    input.value = `${negative ? '-' : ''}${digits}`;
}

function attachStrictIntegerGuards(input, allowNegative = true) {
    if (!input || input.dataset.strictIntegerBound === '1') return;
    input.dataset.strictIntegerBound = '1';

    input.addEventListener('keydown', (e) => {
        const ctrlOrMeta = e.ctrlKey || e.metaKey;
        const navKeys = ['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Tab', 'Home', 'End'];
        if (ctrlOrMeta || navKeys.includes(e.key)) return;

        if (e.key >= '0' && e.key <= '9') return;

        if (allowNegative && e.key === '-') {
            if (input.value === '') return;
        }

        e.preventDefault();
    });

    input.addEventListener('paste', (e) => {
        const pasted = (e.clipboardData || window.clipboardData)?.getData('text') || '';
        const value = input.value || '';
        const start = input.selectionStart ?? value.length;
        const end = input.selectionEnd ?? value.length;
        const next = value.slice(0, start) + pasted + value.slice(end);
        const regex = allowNegative ? /^-?\d*$/ : /^\d*$/;
        if (!regex.test(next)) e.preventDefault();
    });

    input.addEventListener('drop', (e) => e.preventDefault());
}

function setupTalentEditorListeners() {
    const effectSelect = document.getElementById('talentEffectId');
    if (effectSelect) {
        effectSelect.addEventListener('change', () => {
            updateEffectDescription(effectSelect.value);
        });
    }

    const factorInput = document.getElementById('talentFactor');
    if (factorInput) {
        attachStrictIntegerGuards(factorInput, true);
        factorInput.addEventListener('input', () => {
            normalizeIntegerInputValue(factorInput);
            const effectId = document.getElementById('talentEffectId')?.value;
            if (effectId) updateEffectDescription(effectId);
        });
        factorInput.addEventListener('blur', () => normalizeIntegerInputValue(factorInput));
    }

    const maxPointsInput = document.getElementById('talentMaxPoints');
    if (maxPointsInput) {
        attachStrictIntegerGuards(maxPointsInput, false);
        maxPointsInput.addEventListener('input', () => normalizeIntegerInputValue(maxPointsInput));
        maxPointsInput.addEventListener('blur', () => normalizeIntegerInputValue(maxPointsInput));
    }

    getTalentAssetGallery();

    const saveBtn = document.getElementById('talentSaveBtn');
    if (saveBtn) saveBtn.addEventListener('click', saveTalentChanges);

    const resetBtn = document.getElementById('talentResetBtn');
    if (resetBtn) resetBtn.addEventListener('click', resetTalentForm);

    // Dirty tracking: listen for any form change
    const talentForm = document.getElementById('talentEditorForm');
    if (talentForm) {
        talentForm.addEventListener('input', checkTalentDirty);
        talentForm.addEventListener('change', checkTalentDirty);
    }
}

function getTalentFormSnapshot() {
    return JSON.stringify({
        name: document.getElementById('talentName')?.value ?? '',
        maxPoints: document.getElementById('talentMaxPoints')?.value ?? '',
        perkSlot: document.getElementById('talentPerkSlot')?.checked ?? false,
        effectId: document.getElementById('talentEffectId')?.value ?? '',
        factor: document.getElementById('talentFactor')?.value ?? '',
        description: document.getElementById('talentDescription')?.value ?? '',
        assetId: document.getElementById('talentAssetId')?.value ?? '',
    });
}

function checkTalentDirty() {
    if (!talentEditorState.snapshot) return;
    const current = getTalentFormSnapshot();
    setTalentSaveDirty(current !== talentEditorState.snapshot);
}

function setTalentSaveDirty(dirty) {
    const btn = document.getElementById('talentSaveBtn');
    if (btn) {
        btn.disabled = !dirty;
        btn.classList.toggle('btn-disabled', !dirty);
    }
}

async function loadTalentEditorData(options = {}) {
    const forceReload = options?.forceReload === true;

    // If talents are already loaded and we aren't forcing a reload, just re-render
    if (!forceReload && talentEditorState.talents.length > 0) {
        renderTalentGrid();
        return;
    }

    try {
        // Use global loaders (cached, deduplicated)
        if (typeof loadEffectsData === 'function') {
            await loadEffectsData();
        }

        // GlobalData.talents is populated by loadEnemiesData (getEnemies returns talents)
        // Ensure enemies have been loaded so talents are available
        if (typeof loadEnemiesData === 'function' && GlobalData.talents.length === 0) {
            await loadEnemiesData();
        }

        talentEditorState.talents = GlobalData.talents || [];
        talentEditorState.filteredTalents = [...talentEditorState.talents];

        await ensureTalentAssets();
        createTalentAssetGallery();

        populateTalentEffectOptions();
        renderTalentGrid();

        // Auto-select first talent if none selected
        if (!talentEditorState.selectedTalentId && talentEditorState.talents.length > 0) {
            selectTalent(talentEditorState.talents[0].talentId);
        }
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

async function ensureTalentAssets(options = {}) {
    const forceReload = options?.forceReload === true;

    if (typeof loadPerkAssets === 'function' && typeof getPerkAssets === 'function') {
        await loadPerkAssets({ forceReload });
        talentAssets = getPerkAssets() || [];
        return;
    }

    await loadTalentAssetsFallback();
}

async function loadTalentAssetsFallback() {
    try {
        const token = await getCurrentAccessToken();
        if (!token) return;

        const response = await fetch('/api/getTalentAssets', {
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

function getTalentAssetGallery() {
    if (talentAssetGallery) return talentAssetGallery;
    talentAssetGallery = new AssetGallery({
        overlayId: 'talentAssetGalleryOverlay',
        gridId: 'talentAssetGrid',
        openTriggerIds: ['talentAssetPreview'],
        closeTriggerIds: ['talentAssetGalleryClose'],
        uploadTriggerIds: ['talentUploadNewBtn', 'talentUploadNewBtnOverlay'],
        fileInputId: 'talentAssetFile',
        getAssets: () => talentAssets,
        getSelectedAssetId: () => document.getElementById('talentAssetId')?.value || null,
        uploadEndpoint: '/api/uploadTalentAsset',
        getNextAssetID: getNextAvailableTalentAssetID,
        width: 128,
        height: 128,
        quality: 0.8,
        onSelect: (asset, { assetId, iconUrl, gallery }) => {
            document.getElementById('talentAssetId').value = assetId;
            updateTalentAssetPreview(assetId, iconUrl);
            gallery.close();
        },
        onUploaded: async ({ result, base64Data, gallery }) => {
            await ensureTalentAssets({ forceReload: true });
            const refreshedIcon = getTalentAssetIcon(result.assetID) || result.icon || base64Data;
            gallery.render();
            gallery.selectById(result.assetID, refreshedIcon);
            alert('Talent asset uploaded successfully!');
        },
        onUploadError: ({ error, result }) => {
            alert(result?.message ? 'Error uploading asset: ' + result.message : 'Failed to upload asset. Please try again.');
            console.error('Error uploading talent asset:', error);
        }
    });
    return talentAssetGallery;
}

function createTalentAssetGallery() {
    getTalentAssetGallery().render();
}

function toggleTalentAssetGallery() {
    getTalentAssetGallery().toggle();
}

function selectTalentAsset(assetId, iconUrl) {
    getTalentAssetGallery().selectById(assetId, iconUrl);
}

function updateTalentAssetPreview(assetId, iconUrl) {
    const preview = document.getElementById('talentAssetPreview');
    const image = document.getElementById('talentAssetImage');
    const placeholder = document.getElementById('talentAssetPlaceholder');

    if (image) {
        image.src = iconUrl || '';
    }
    if (preview) {
        preview.classList.toggle('has-image', !!iconUrl);
    }
    if (placeholder) {
        placeholder.style.display = iconUrl ? 'none' : 'block';
    }

}

async function uploadTalentAsset(file) {
    return getTalentAssetGallery().upload(file);
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
    const factorVal = document.getElementById('talentFactor')?.value || '';
    let text = effect?.description || '';
    if (typeof DesignerBase !== 'undefined' && typeof DesignerBase.formatEffectDescription === 'function') {
        text = DesignerBase.formatEffectDescription(effect, factorVal, {
            defaultText: '',
            appendPercentWhenNoPlaceholder: false
        });
    } else if (text && factorVal) {
        text = text.includes('*') ? text.replace('*', factorVal) : text + ' ' + factorVal;
    }
    descEl.textContent = text;
}

function renderTalentGrid(filterText = '') {
    const grid = document.getElementById('talentGrid');
    if (!grid) return;

    let talents = talentEditorState.talents;

    grid.innerHTML = '';

    talents.forEach(talent => {
        const wrapper = document.createElement('div');
        wrapper.className = 'talent-cell-wrapper';
        // Place in 7x8 grid, with row 1 at bottom
        const row = talent.row || 1;
        const col = talent.col || 1;
        const gridRow = 9 - row; // invert so row 1 is bottom
        wrapper.style.gridRow = String(gridRow);
        wrapper.style.gridColumn = String(col);

        const cell = document.createElement('div');
        cell.className = 'talent-cell' + (talent.talentId === talentEditorState.selectedTalentId ? ' selected' : '');

        const iconUrl = getTalentAssetIcon(talent.assetId);
        const perkIndicator = (talent.perkSlot === true || talent.perkSlot === 1) ? '<div class="talent-perk-indicator">★</div>' : '';
        cell.innerHTML = `
            ${perkIndicator}
            <div class="talent-max">${talent.maxPoints ?? ''}</div>
            <img class="talent-icon" src="${iconUrl}" alt="Talent ${talent.talentId}" onerror="this.style.display='none'">
            <div class="talent-cell-label">${escapeHtml(talent.talentName) || ''}</div>
        `;

        cell.addEventListener('click', () => selectTalent(talent.talentId));

        wrapper.appendChild(cell);
        grid.appendChild(wrapper);
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

    // Store snapshot for dirty tracking
    talentEditorState.snapshot = getTalentFormSnapshot();
    setTalentSaveDirty(false);

    renderTalentGrid();
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

        const response = await fetch('/api/updateTalentInfo', {
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

        // Sync back to GlobalData
        if (typeof setGlobalArray === 'function') {
            setGlobalArray('talents', [...talentEditorState.talents]);
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
