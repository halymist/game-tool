let effectDesignerBootstrapped = false;
let effectList = [];
let filteredEffectList = [];
let effectAssets = [];
let selectedEffectId = null;
let selectedEffectAssetId = null;
let effectAssetGallery = null;
let effectFormSnapshot = null;

function ensureEffectDesignerInit() {
    if (effectDesignerBootstrapped) return;
    if (!document.getElementById('effectForm')) return;
    effectDesignerBootstrapped = true;
    initEffectDesigner();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureEffectDesignerInit);
} else {
    ensureEffectDesignerInit();
}

function initEffectDesigner() {
    if (window.effectDesignerInitialized) return;
    window.effectDesignerInitialized = true;
    setupEffectEventListeners();
    loadEffectDesignerData();
}

function setupEffectEventListeners() {
    document.getElementById('effectSearch')?.addEventListener('input', filterEffects);
    document.getElementById('effectTriggerFilter')?.addEventListener('change', filterEffects);
    document.getElementById('newEffectBtn')?.addEventListener('click', createNewEffect);
    document.getElementById('effectCancelBtn')?.addEventListener('click', cancelEffectEdit);

    const form = document.getElementById('effectForm');
    if (form) {
        form.addEventListener('submit', saveEffect);
        form.addEventListener('input', checkEffectSaveState);
        form.addEventListener('change', () => {
            updateEffectCoreHelp();
            checkEffectSaveState();
        });
    }

    getEffectAssetGallery();
}

async function loadEffectDesignerData(options = {}) {
    const forceReload = options?.forceReload === true;
    await loadEffectsData({ forceReload });
    await loadEffectAssets({ forceReload });

    effectList = [...(GlobalData.effects || [])];
    filteredEffectList = [...effectList];
    effectAssets = getEffectAssets();

    populateEffectMetaControls();
    renderEffectList();
    getEffectAssetGallery().render();

    if (selectedEffectId && effectList.some(effect => Number(effect.id) === Number(selectedEffectId))) {
        selectEffect(selectedEffectId);
    } else if (effectList.length) {
        selectEffect(effectList[0].id);
    } else {
        createNewEffect();
    }
}

function populateEffectMetaControls() {
    fillSelect('effectTriggerFilter', GlobalData.effectTriggerTypes || [], 'All Triggers');
    fillSelect('effectCoreEffect', GlobalData.coreEffects || [], '-- None --', core => core.id, core => `${core.code} (${core.id})`);
    fillSelect('effectSlot', GlobalData.effectSlots || [], '-- Any --');
    fillSelect('effectTriggerType', GlobalData.effectTriggerTypes || [], null);
    fillSelect('effectFactorType', GlobalData.effectFactorTypes || [], null);
    fillSelect('effectConditionType', GlobalData.effectConditionTypes || [], '-- None --');
}

function fillSelect(id, values, emptyLabel, valueFn, labelFn) {
    const select = document.getElementById(id);
    if (!select) return;
    const previous = select.value;
    const options = [];
    if (emptyLabel !== null) {
        options.push(`<option value="">${DesignerBase.escapeHtml(emptyLabel)}</option>`);
    }
    values.forEach(value => {
        const optionValue = valueFn ? valueFn(value) : value;
        const optionLabel = labelFn ? labelFn(value) : value;
        options.push(`<option value="${DesignerBase.escapeHtml(String(optionValue))}">${DesignerBase.escapeHtml(String(optionLabel))}</option>`);
    });
    select.innerHTML = options.join('');
    if (previous && select.querySelector(`option[value="${CSS.escape(previous)}"]`)) {
        select.value = previous;
    }
}

function renderEffectList() {
    const list = document.getElementById('effectList');
    if (!list) return;
    if (!filteredEffectList.length) {
        list.innerHTML = '<p class="loading-text">No effects found</p>';
        return;
    }
    list.innerHTML = filteredEffectList.map(effect => {
        const icon = getEffectIcon(effect);
        const core = effect.coreEffectCode || 'no core';
        const trigger = effect.triggerType || 'passive';
        return `
            <div class="effect-list-item ${Number(effect.id) === Number(selectedEffectId) ? 'selected' : ''}" data-id="${effect.id}">
                <div class="effect-list-icon">${icon ? `<img src="${DesignerBase.escapeHtml(icon)}" alt="">` : `#${effect.id}`}</div>
                <div class="effect-list-info">
                    <span class="effect-list-name">${DesignerBase.escapeHtml(effect.name || '')}</span>
                    <span class="effect-list-meta">${DesignerBase.escapeHtml(core)} · ${DesignerBase.escapeHtml(trigger)} · factor ${Number(effect.factor || 0)}</span>
                </div>
            </div>
        `;
    }).join('');

    list.querySelectorAll('.effect-list-item').forEach(item => {
        item.addEventListener('click', () => selectEffect(Number(item.dataset.id)));
    });
}

function filterEffects() {
    const term = (document.getElementById('effectSearch')?.value || '').trim().toLowerCase();
    const trigger = document.getElementById('effectTriggerFilter')?.value || '';
    filteredEffectList = effectList.filter(effect => {
        const haystack = [
            effect.id,
            effect.name,
            effect.description,
            effect.coreEffectCode,
            effect.triggerType,
            effect.factorType,
            effect.slot
        ].join(' ').toLowerCase();
        return (!term || haystack.includes(term)) && (!trigger || effect.triggerType === trigger);
    });
    renderEffectList();
}

function selectEffect(effectId) {
    const effect = effectList.find(entry => Number(entry.id) === Number(effectId));
    if (!effect) return;
    selectedEffectId = effect.id;
    selectedEffectAssetId = effect.assetID || null;

    setValue('effectId', effect.id);
    setValue('effectName', effect.name || '');
    setValue('effectDescription', effect.description || '');
    setValue('effectCoreEffect', effect.coreEffectID || '');
    setValue('effectSlot', effect.slot || '');
    setValue('effectFactor', effect.factor ?? 1);
    setValue('effectTriggerType', effect.triggerType || 'passive');
    setValue('effectFactorType', effect.factorType || 'percent');
    setChecked('effectTargetSelf', effect.targetSelf !== false);
    setValue('effectConditionType', effect.conditionType || '');
    setValue('effectConditionValue', effect.conditionValue ?? '');
    setValue('effectDuration', effect.duration ?? '');

    updateEffectAssetPreview();
    updateEffectCoreHelp();
    document.getElementById('effectEditorTitle').textContent = `Edit Effect #${effect.id}`;
    snapshotEffectForm();
    renderEffectList();
}

function createNewEffect() {
    selectedEffectId = null;
    selectedEffectAssetId = 1;
    setValue('effectId', '');
    setValue('effectName', '');
    setValue('effectDescription', '');
    setValue('effectCoreEffect', '');
    setValue('effectSlot', '');
    setValue('effectFactor', 1);
    setValue('effectTriggerType', 'passive');
    setValue('effectFactorType', 'percent');
    setChecked('effectTargetSelf', true);
    setValue('effectConditionType', '');
    setValue('effectConditionValue', '');
    setValue('effectDuration', '');
    document.getElementById('effectEditorTitle').textContent = 'Create New Effect';
    updateEffectAssetPreview();
    updateEffectCoreHelp();
    effectFormSnapshot = null;
    checkEffectSaveState();
    renderEffectList();
}

function cancelEffectEdit() {
    if (selectedEffectId) {
        selectEffect(selectedEffectId);
    } else {
        createNewEffect();
    }
}

async function saveEffect(event) {
    event.preventDefault();
    const errors = getEffectValidationErrors();
    if (errors.length) {
        alert(`Cannot save effect:\n- ${errors.join('\n- ')}`);
        return;
    }

    const saveBtn = document.getElementById('effectSaveBtn');
    saveBtn?.classList.add('is-saving');
    if (saveBtn) saveBtn.disabled = true;

    const payload = {
        id: parseIntOrZero(document.getElementById('effectId')?.value),
        name: document.getElementById('effectName')?.value.trim() || '',
        assetID: selectedEffectAssetId || null,
        description: document.getElementById('effectDescription')?.value.trim() || '',
        coreEffectID: parseIntOrNull(document.getElementById('effectCoreEffect')?.value),
        slot: emptyToNull(document.getElementById('effectSlot')?.value),
        factor: parseIntOrZero(document.getElementById('effectFactor')?.value),
        triggerType: document.getElementById('effectTriggerType')?.value || 'passive',
        factorType: document.getElementById('effectFactorType')?.value || 'percent',
        targetSelf: !!document.getElementById('effectTargetSelf')?.checked,
        conditionType: emptyToNull(document.getElementById('effectConditionType')?.value),
        conditionValue: parseIntOrNull(document.getElementById('effectConditionValue')?.value),
        duration: parseIntOrNull(document.getElementById('effectDuration')?.value)
    };

    try {
        const result = await postAuthenticatedJson('/api/saveEffect', payload);
        if (!result?.success || !result.effect) throw new Error(result?.message || 'Save failed');
        upsertGlobalEffect(result.effect);
        effectList = [...GlobalData.effects];
        filterEffects();
        selectEffect(result.effect.id);
        saveBtn?.classList.add('is-saved');
        setTimeout(() => saveBtn?.classList.remove('is-saved'), 900);
    } catch (error) {
        console.error('Failed to save effect:', error);
        alert('Failed to save effect: ' + error.message);
    } finally {
        saveBtn?.classList.remove('is-saving');
        checkEffectSaveState();
    }
}

function upsertGlobalEffect(effect) {
    const index = GlobalData.effects.findIndex(entry => Number(entry.id) === Number(effect.id));
    if (index >= 0) {
        GlobalData.effects[index] = effect;
    } else {
        GlobalData.effects.push(effect);
        GlobalData.effects.sort((a, b) => Number(a.id) - Number(b.id));
    }
    notifyGlobalDataChange('effects', GlobalData.effects);
}

function getEffectValidationErrors() {
    const errors = [];
    if (!(document.getElementById('effectName')?.value || '').trim()) errors.push('Name is required');
    if (!(document.getElementById('effectDescription')?.value || '').trim()) errors.push('Description is required');
    if (!document.getElementById('effectTriggerType')?.value) errors.push('Trigger type is required');
    if (!document.getElementById('effectFactorType')?.value) errors.push('Factor type is required');
    if (effectFormSnapshot && !isEffectFormDirty()) errors.push('No changes to save');
    return errors;
}

function checkEffectSaveState() {
    const btn = document.getElementById('effectSaveBtn');
    if (!btn) return;
    const errors = getEffectValidationErrors();
    btn.disabled = errors.length > 0;
    btn.title = errors.length ? `Cannot save effect yet:\n- ${errors.join('\n- ')}` : 'Save effect';
}

function snapshotEffectForm() {
    effectFormSnapshot = JSON.stringify(readEffectFormSnapshot());
    checkEffectSaveState();
}

function isEffectFormDirty() {
    return JSON.stringify(readEffectFormSnapshot()) !== effectFormSnapshot;
}

function readEffectFormSnapshot() {
    return {
        id: document.getElementById('effectId')?.value || '',
        name: document.getElementById('effectName')?.value || '',
        assetID: selectedEffectAssetId || null,
        description: document.getElementById('effectDescription')?.value || '',
        coreEffectID: document.getElementById('effectCoreEffect')?.value || '',
        slot: document.getElementById('effectSlot')?.value || '',
        factor: document.getElementById('effectFactor')?.value || '',
        triggerType: document.getElementById('effectTriggerType')?.value || '',
        factorType: document.getElementById('effectFactorType')?.value || '',
        targetSelf: !!document.getElementById('effectTargetSelf')?.checked,
        conditionType: document.getElementById('effectConditionType')?.value || '',
        conditionValue: document.getElementById('effectConditionValue')?.value || '',
        duration: document.getElementById('effectDuration')?.value || ''
    };
}

function updateEffectCoreHelp() {
    const coreId = parseIntOrNull(document.getElementById('effectCoreEffect')?.value);
    const help = document.getElementById('effectCoreHelp');
    const core = (GlobalData.coreEffects || []).find(entry => Number(entry.id) === Number(coreId));
    if (help) help.textContent = core ? core.description : '';
}

function getEffectAssetGallery() {
    if (effectAssetGallery) return effectAssetGallery;
    effectAssetGallery = DesignerBase.createAssetGallery('effect', {
        getAssets: () => effectAssets,
        getSelectedAssetId: () => selectedEffectAssetId,
        getNextAssetID: () => {
            const assetMax = effectAssets.reduce((max, asset) => Math.max(max, Number(asset.id || asset.assetID || 0)), 0);
            const effectMax = effectList.reduce((max, effect) => Math.max(max, Number(effect.assetID || 0)), 0);
            return Math.max(assetMax, effectMax) + 1;
        },
        width: 256,
        height: 256,
        quality: 0.85,
        imageAlt: asset => `Effect asset ${asset.id || asset.assetID}`,
        onSelect: (asset, { assetId, iconUrl, gallery }) => {
            selectedEffectAssetId = assetId;
            updateEffectAssetPreview(iconUrl);
            gallery.render();
            gallery.close();
            checkEffectSaveState();
        },
        onUploaded: ({ result, base64Data, gallery }) => {
            const iconUrl = result.icon || result.url || base64Data;
            const assetId = result.assetID || result.assetId;
            const newAsset = {
                id: assetId,
                assetID: assetId,
                url: iconUrl,
                icon: iconUrl,
                remoteUrl: iconUrl
            };
            if (typeof upsertGlobalRecord === 'function') {
                upsertGlobalRecord('effectAssets', newAsset, ['assetID', 'id']);
                effectAssets = getEffectAssets();
            } else {
                effectAssets.push(newAsset);
            }
            gallery.select(newAsset);
        },
        onUploadError: ({ error, result }) => {
            alert('Upload failed: ' + (result?.message || error.message));
        }
    });
    return effectAssetGallery;
}

function updateEffectAssetPreview(preferredUrl = '') {
    const preview = document.getElementById('effectIconPreview');
    if (!preview) return;
    const icon = preferredUrl || getEffectAssetUrl(selectedEffectAssetId);
    preview.innerHTML = icon
        ? `<img src="${DesignerBase.escapeHtml(icon)}" alt="">`
        : '<span>Click to select icon</span>';
}

function getEffectIcon(effect) {
    return effect?.icon || getEffectAssetUrl(effect?.assetID);
}

function getEffectAssetUrl(assetId) {
    if (!assetId) return '';
    const asset = effectAssets.find(entry => Number(entry.id || entry.assetID) === Number(assetId));
    return asset?.url || asset?.icon || asset?.remoteUrl || buildPublicAssetUrl(`images/perks/${assetId}.webp`);
}

function setValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value ?? '';
}

function setChecked(id, checked) {
    const el = document.getElementById(id);
    if (el) el.checked = !!checked;
}

function parseIntOrNull(value) {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
}

function parseIntOrZero(value) {
    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
}

function emptyToNull(value) {
    const text = String(value ?? '').trim();
    return text ? text : null;
}

window.initEffectDesigner = initEffectDesigner;
window.loadEffectDesignerData = loadEffectDesignerData;
