// Settlement Designer JavaScript

// Settlement state
let settlementState = {
    settlements: [],
    selectedSettlementId: null,
    isNewSettlement: false,
    settlementAssets: [],
    questAssets: [], // Quest assets from images/quests - used for location textures
    currentAssetTarget: null, // 'settlement', 'vendor', 'healer', 'utility', 'utility2', 'expedition', 'arena', 'location'
    blessings: [], // perks for church blessings
    items: [], // items for vendor
    effects: [], // effects for enchanter
    vendorItems: [], // current vendor's items
    enchanterEffects: [], // current enchanter's effects
    vendorResponses: [], // [{type: 'on_entered', text: '...'}, ...]
    healerResponses: [], // [{type: 'on_entered', text: '...'}, ...]
    utilityResponses: [], // [{type: 'on_entered', text: '...'}, ...]
    utility2Responses: [], // [{type: 'on_entered', text: '...'}, ...]
    locations: [], // [{id: 1, name: '...', description: '...', texture_id: ...}, ...]
    editingLocationIndex: null, // index of location being edited, null for new
    vendorMsgRect: null, // {x1, y1, x2, y2} percentages
    healerMsgRect: null,
    utilityMsgRect: null,
    utility2MsgRect: null
};
let settlementAssetUploader = null;
let locationTextureUploader = null;
let settlementSaveButton = null;

const SETTLEMENT_FALLBACK_ITEM_ICON = buildSettlementEmojiDataUri('🎒');

const settlementAssetPreloadPromise = (async () => {
    if (typeof loadItemAssets === 'function') {
        try {
            await loadItemAssets();
        } catch (error) {
            console.warn('Settlement item asset preload failed', error);
        }
    }
})();

if (typeof subscribeToGlobalData === 'function') {
    subscribeToGlobalData('itemAssets', () => {
        renderVendorItems();
    });
}

function buildSettlementEmojiDataUri(symbol) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="80">${symbol}</text></svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function getSettlementItemAssetIcon(assetId) {
    if (!assetId || !window.GlobalData?.itemAssets) return null;
    const numericId = Number(assetId);
    const asset = GlobalData.itemAssets.find(entry => Number(entry.assetID ?? entry.id) === numericId);
    return asset?.icon || null;
}

function resolveSettlementItemIcon(item) {
    if (!item) return SETTLEMENT_FALLBACK_ITEM_ICON;
    const assetId = item.assetID ?? item.assetId ?? item.asset_id ?? item.item_asset_id;
    const cached = getSettlementItemAssetIcon(assetId);
    if (cached) return cached;
    if (item.icon && item.icon.startsWith('blob:')) return item.icon;
    return SETTLEMENT_FALLBACK_ITEM_ICON;
}

let settlementEventHandlersBound = false;

function ensureSettlementDesignerInit() {
    if (settlementEventHandlersBound) return;
    if (!document.getElementById('settlementDesigner')) return;
    settlementEventHandlersBound = true;
    initSettlementDesigner();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureSettlementDesignerInit);
} else {
    ensureSettlementDesignerInit();
}

function initSettlementDesigner() {
    console.log('🏘️ Initializing Settlement Designer...');
    settlementSaveButton = settlementSaveButton || new SaveButton('saveSettlementBtn');
    setupSettlementEventListeners();
    console.log('✅ Settlement Designer initialized');
}

function setupSettlementEventListeners() {
    // Settlement select
    const settlementSelect = document.getElementById('settlementSelect');
    if (settlementSelect) {
        settlementSelect.addEventListener('change', (e) => {
            if (e.target.value === '') {
                // Empty value means "New Settlement"
                createNewSettlement();
            } else if (e.target.value) {
                selectSettlement(parseInt(e.target.value));
            }
        });
    }

    // Save button
    const saveSettlementBtn = document.getElementById('saveSettlementBtn');
    if (saveSettlementBtn) {
        saveSettlementBtn.addEventListener('click', saveSettlement);
    }

    const dismissSettlementBtn = document.getElementById('dismissSettlementBtn');
    if (dismissSettlementBtn) {
        dismissSettlementBtn.addEventListener('click', dismissSettlementChanges);
    }

    // Asset click handlers for cards
    const settlementAssetArea = document.getElementById('settlementAssetArea');
    if (settlementAssetArea) {
        settlementAssetArea.addEventListener('click', () => openAssetGallery('settlement'));
    }

    const vendorAssetArea = document.getElementById('vendorAssetArea');
    if (vendorAssetArea) {
        vendorAssetArea.addEventListener('click', () => openAssetGallery('vendor'));
    }

    const healerAssetArea = document.getElementById('healerAssetArea');
    if (healerAssetArea) {
        healerAssetArea.addEventListener('click', () => openAssetGallery('healer'));
    }

    const utilityAssetArea = document.getElementById('utilityAssetArea');
    if (utilityAssetArea) {
        utilityAssetArea.addEventListener('click', () => openAssetGallery('utility'));
    }

    const utility2AssetArea = document.getElementById('utility2AssetArea');
    if (utility2AssetArea) {
        utility2AssetArea.addEventListener('click', () => openAssetGallery('utility2'));
    }

    const expeditionAssetArea = document.getElementById('expeditionAssetArea');
    if (expeditionAssetArea) {
        expeditionAssetArea.addEventListener('click', () => openAssetGallery('expedition'));
    }

    const arenaAssetArea = document.getElementById('arenaAssetArea');
    if (arenaAssetArea) {
        arenaAssetArea.addEventListener('click', () => openAssetGallery('arena'));
    }

    // Gallery close button
    const galleryClose = document.getElementById('settlementGalleryClose');
    if (galleryClose) {
        galleryClose.addEventListener('click', closeAssetGallery);
    }

    // Gallery overlay click to close
    const galleryOverlay = document.getElementById('settlementAssetGalleryOverlay');
    if (galleryOverlay) {
        galleryOverlay.addEventListener('click', (e) => {
            if (e.target === galleryOverlay) {
                closeAssetGallery();
            }
        });
    }
    
    // ESC to close gallery
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const overlay = document.getElementById('settlementAssetGalleryOverlay');
            if (overlay && overlay.classList.contains('active')) {
                closeAssetGallery();
            }
        }
    });

    // Upload button
    const uploadBtn = document.getElementById('settlementUploadBtn');
    if (uploadBtn) {
        uploadBtn.addEventListener('click', () => {
            document.getElementById('settlementAssetFile').click();
        });
    }

    // File input change
    const fileInput = document.getElementById('settlementAssetFile');
    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            e.target.value = '';
            if (file) {
                // Use quest asset upload for location textures, settlement asset for others
                if (settlementState.currentAssetTarget === 'location') {
                    uploadLocationTexture(file);
                } else {
                    uploadSettlementAsset(file);
                }
            }
        });
    }

    // Utility type selector
    const utilityTypeSelect = document.getElementById('utilityTypeSelect');
    if (utilityTypeSelect) {
        utilityTypeSelect.addEventListener('change', (e) => {
            selectUtilityType(e.target.value);
        });
    }

    const utility2TypeSelect = document.getElementById('utility2TypeSelect');
    if (utility2TypeSelect) {
        utility2TypeSelect.addEventListener('change', (e) => {
            selectUtilityType(e.target.value, 2);
        });
    }

    bindMirroredBlessingSelect('utility2Blessing1Select', 'blessing1Select');
    bindMirroredBlessingSelect('utility2Blessing2Select', 'blessing2Select');
    bindMirroredBlessingSelect('utility2Blessing3Select', 'blessing3Select');
    ['blessing1Select', 'blessing2Select', 'blessing3Select'].forEach((id) => {
        const select = document.getElementById(id);
        if (!select || select.dataset.mirrorSourceBound === 'true') return;
        select.dataset.mirrorSourceBound = 'true';
        select.addEventListener('change', () => {
            swapBlessingOnDuplicate(id);
            syncMirroredBlessingSelects();
            refreshBlessingDropdownLabels();
            checkSettlementSaveConditions();
        });
    });

    // Add vendor item button
    const addVendorItemBtn = document.getElementById('addVendorItemBtn');
    if (addVendorItemBtn) {
        addVendorItemBtn.addEventListener('click', showAddItemDialog);
    }

    // Add enchanter effect button
    const addEnchanterEffectBtn = document.getElementById('addEnchanterEffectBtn');
    if (addEnchanterEffectBtn) {
        addEnchanterEffectBtn.addEventListener('click', showAddEffectDialog);
    }

    // Add location button
    const addLocationBtn = document.getElementById('addLocationBtn');
    if (addLocationBtn) {
        addLocationBtn.addEventListener('click', openAddLocationModal);
    }

    // Location texture click handler
    const locationTextureArea = document.getElementById('locationTextureArea');
    if (locationTextureArea) {
        locationTextureArea.addEventListener('click', () => openAssetGallery('location'));
    }

    // Location modal overlay click to close
    const locationModalOverlay = document.getElementById('locationModalOverlay');
    if (locationModalOverlay) {
        locationModalOverlay.addEventListener('click', (e) => {
            if (e.target === locationModalOverlay) {
                closeLocationModal();
            }
        });
    }

    // Wire up save-condition checks on all settlement form inputs
    const formInputIds = [
        'settlementName', 'settlementDescription',
        'settlementContext', 'expeditionContext',
        'factionSelect', 'utilityTypeSelect', 'utility2TypeSelect',
        'blessing1Select', 'blessing2Select', 'blessing3Select'
    ];
    formInputIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', checkSettlementSaveConditions);
            el.addEventListener('change', checkSettlementSaveConditions);
        }
    });

    // Init list builder key handlers + wire up change events for dirty checking
    if (typeof initListBuilderKeyHandler === 'function') {
        initListBuilderKeyHandler('settlementKeyIssues');
        ['settlementKeyIssuesBuilder'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('change', checkSettlementSaveConditions);
            }
        });
    }
}

let settlementDesignerLoaded = false;

async function loadSettlementDesignerData(options = {}) {
    const forceReload = options?.forceReload === true;

    // If already loaded once, just re-populate UI from cached GlobalData
    if (!forceReload && settlementDesignerLoaded) {
        const prevSelectedSettlementId = settlementState.selectedSettlementId;
        settlementState.settlements = GlobalData.settlements;
        settlementState.settlementAssets = GlobalData.settlementAssets;
        settlementState.questAssets = GlobalData.questAssets;
        // Always refresh blessings in case the global perk list loaded after first init
        await loadBlessingsData();
        populateSettlementEditorSelect();
        populateBlessingDropdowns();
        if (prevSelectedSettlementId) {
            selectSettlement(prevSelectedSettlementId);
        }
        return;
    }

    const token = await getCurrentAccessToken();
    if (!token) {
        console.error('Authentication required');
        return;
    }

    // All global loaders cache internally — these are no-ops if already loaded
    try { await loadSettlementsData(); } catch (e) { console.error('Error loading settlements:', e); }
    try { await loadSettlementAssetsData(); } catch (e) { console.error('Error loading settlement assets:', e); }
    try { await loadQuestAssetsData(); } catch (e) { console.error('Error loading quest assets:', e); }
    try { await loadBlessingsData(); } catch (e) { console.error('Error loading blessings:', e); }
    try { await loadSettlementItemsData(); } catch (e) { console.error('Error loading items for vendor:', e); }
    try { await loadSettlementEffectsData(); } catch (e) { console.error('Error loading effects for enchanter:', e); }

    settlementState.settlements = GlobalData.settlements;
    settlementState.settlementAssets = GlobalData.settlementAssets;
    settlementState.questAssets = GlobalData.questAssets;

    // Populate UI
    populateSettlementEditorSelect();
    populateBlessingDropdowns();

    // Start with a blank "new settlement" state
    createNewSettlement();
    settlementDesignerLoaded = true;
}

// loadSettlementAssets removed — use loadSettlementAssetsData() from global-data.js

async function loadBlessingsData() {
    const onlyBlessings = (perks) => (perks || []).filter(perk => Boolean(perk?.is_blessing));

    // Load perks as blessings - they're in the perks table
    if (typeof getPerks === 'function') {
        settlementState.blessings = onlyBlessings(getPerks());
    } else {
        try {
            const token = await getCurrentAccessToken();
            if (!token) return;

            const response = await fetch('/api/getPerks', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const data = await response.json();
                settlementState.blessings = onlyBlessings(data.perks);
            }
        } catch (error) {
            console.error('Error loading perks:', error);
            settlementState.blessings = [];
        }
    }
}

async function loadSettlementItemsData() {
    // Wait for global items to be loaded first
    if (typeof loadItemsData === 'function') {
        try {
            const items = await loadItemsData();  // This returns the items when loaded
            settlementState.items = items || [];
            return;
        } catch (e) {
            console.log('Error loading items via loadItemsData:', e);
        }
    }
    
    // Fallback: get from getItems if already loaded
    if (typeof getItems === 'function') {
        settlementState.items = getItems() || [];
        if (settlementState.items.length > 0) {
            return;
        }
    }
    
    // Final fallback: fetch directly
    try {
        const token = await getCurrentAccessToken();
        if (!token) return;

        const response = await fetch('/api/getItems', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            const data = await response.json();
            settlementState.items = data.items || [];
        }
    } catch (error) {
        console.error('Error loading items:', error);
    }
}

async function loadSettlementEffectsData() {
    // Wait for global effects to be loaded first
    if (typeof loadEffectsData === 'function') {
        try {
            const effects = await loadEffectsData();  // This returns the effects when loaded
            settlementState.effects = effects || [];
            return;
        } catch (e) {
            console.log('Error loading effects via loadEffectsData:', e);
        }
    }
    
    // Fallback: get from getEffects if already loaded
    if (typeof getEffects === 'function') {
        settlementState.effects = getEffects() || [];
        if (settlementState.effects.length > 0) {
            return;
        }
    }
    
    // Final fallback: fetch directly
    try {
        const token = await getCurrentAccessToken();
        if (!token) return;

        const response = await fetch('/api/getEffects', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            const data = await response.json();
            settlementState.effects = data.effects || [];
        }
    } catch (error) {
        console.error('Error loading effects:', error);
    }
}

function populateSettlementEditorSelect() {
    const select = document.getElementById('settlementSelect');
    if (!select) return;

    const prevId = settlementState.selectedSettlementId;
    const factionGroups = [
        { key: '1', label: 'Order', match: settlement => String(settlement.faction || '') === '1' },
        { key: '2', label: 'Guild', match: settlement => String(settlement.faction || '') === '2' },
        { key: '3', label: 'Companions', match: settlement => String(settlement.faction || '') === '3' },
        { key: 'neutral', label: 'Neutral', match: settlement => !settlement.faction }
    ];

    select.innerHTML = '<option value="">-- New Settlement --</option>';

    factionGroups.forEach(group => {
        const settlements = settlementState.settlements
            .filter(group.match)
            .sort((a, b) => String(a.settlement_name || '').localeCompare(String(b.settlement_name || '')));

        if (!settlements.length) return;

        const optgroup = document.createElement('optgroup');
        optgroup.label = group.label;

        settlements.forEach(settlement => {
            const option = document.createElement('option');
            option.value = settlement.settlement_id;
            option.textContent = settlement.settlement_name || `Settlement ${settlement.settlement_id}`;
            optgroup.appendChild(option);
        });

        select.appendChild(optgroup);
    });

    // Restore previous selection if it still exists
    if (prevId && select.querySelector(`option[value="${prevId}"]`)) {
        select.value = prevId;
    }
}

function populateBlessingDropdowns() {
    const blessingSelects = [
        'blessing1Select', 'blessing2Select', 'blessing3Select',
        'utility2Blessing1Select', 'utility2Blessing2Select', 'utility2Blessing3Select'
    ];

    const previousValues = {};
    blessingSelects.forEach(selectId => {
        previousValues[selectId] = document.getElementById(selectId)?.value || '';
    });
    
    blessingSelects.forEach(selectId => {
        const select = document.getElementById(selectId);
        if (!select) return;

        select.innerHTML = '<option value="">-- None --</option>';
        
        settlementState.blessings.forEach(perk => {
            const option = document.createElement('option');
            option.value = perk.perk_id || perk.id;
            option.textContent = perk.perk_name || perk.name || `Perk ${perk.perk_id || perk.id}`;
            select.appendChild(option);
        });

        if (previousValues[selectId] && select.querySelector(`option[value="${previousValues[selectId]}"]`)) {
            select.value = previousValues[selectId];
        }
    });
    syncMirroredBlessingSelects();
    refreshBlessingDropdownLabels();
}

// Highlight options that are already selected in blessing slots.
function refreshBlessingDropdownLabels() {
    const SLOTS = ['blessing1Select', 'blessing2Select', 'blessing3Select'];

    const usedValues = new Set(
        SLOTS.map(id => document.getElementById(id)?.value).filter(Boolean)
    );

    SLOTS.forEach(selectId => {
        const select = document.getElementById(selectId);
        if (!select) return;
        Array.from(select.options).forEach(opt => {
            if (!opt.value) {
                opt.textContent = '-- None --';
                opt.style.backgroundColor = '';
                opt.style.color = '';
                opt.style.fontWeight = '';
                return;
            }
            const perk = settlementState.blessings.find(p => String(p.perk_id || p.id) === opt.value);
            const baseName = perk ? (perk.perk_name || perk.name || `Perk ${opt.value}`) : opt.value;
            opt.textContent = baseName;
            if (usedValues.has(opt.value)) {
                opt.style.backgroundColor = 'rgba(74, 179, 159, 0.18)';
                opt.style.color = '#fff8ea';
                opt.style.fontWeight = '600';
            } else {
                opt.style.backgroundColor = '';
                opt.style.color = '';
                opt.style.fontWeight = '';
            }
        });
    });
}

// When a slot is changed to a value already held by another slot, swap them.
function swapBlessingOnDuplicate(changedId) {
    const SLOTS = ['blessing1Select', 'blessing2Select', 'blessing3Select'];
    const changedEl = document.getElementById(changedId);
    if (!changedEl) return;
    const newVal = changedEl.value;
    const prevVal = changedEl.dataset.prevBlessingValue || '';
    if (newVal) {
        for (const otherId of SLOTS.filter(id => id !== changedId)) {
            const otherEl = document.getElementById(otherId);
            if (!otherEl) continue;
            if (otherEl.value === newVal) {
                otherEl.value = prevVal;
                otherEl.dataset.prevBlessingValue = prevVal;
                break;
            }
        }
    }
    changedEl.dataset.prevBlessingValue = newVal;
}

function bindMirroredBlessingSelect(mirrorId, sourceId) {
    const mirror = document.getElementById(mirrorId);
    if (!mirror || mirror.dataset.mirrorBound === 'true') return;
    mirror.dataset.mirrorBound = 'true';
    mirror.addEventListener('change', () => {
        const source = document.getElementById(sourceId);
        if (!source) return;
        source.value = mirror.value;
        syncMirroredBlessingSelects();
        checkSettlementSaveConditions();
    });
}

function syncMirroredBlessingSelects() {
    const pairs = [
        ['blessing1Select', 'utility2Blessing1Select'],
        ['blessing2Select', 'utility2Blessing2Select'],
        ['blessing3Select', 'utility2Blessing3Select']
    ];
    pairs.forEach(([sourceId, mirrorId]) => {
        const source = document.getElementById(sourceId);
        const mirror = document.getElementById(mirrorId);
        if (source && mirror) {
            mirror.value = source.value || '';
        }
    });
}

function selectSettlement(settlementId) {
    settlementState.selectedSettlementId = settlementId;
    settlementState.isNewSettlement = false;

    const settlement = settlementState.settlements.find(s => s.settlement_id === settlementId);
    if (!settlement) {
        console.error('Settlement not found:', settlementId);
        return;
    }

    // Update select
    const select = document.getElementById('settlementSelect');
    if (select) {
        select.value = settlementId;
    }

    // Populate form fields
    populateSettlementForm(settlement);
    
    // Take a snapshot of the initial state for dirty tracking
    settlementState._snapshot = getSettlementFormSnapshot();

    // Update save button label to "Update" for existing settlements
    const saveBtn = document.getElementById('saveSettlementBtn');
    if (saveBtn) {
        saveBtn.textContent = 'Update';
    }

    // Hide dismiss button initially (no changes yet)
    const dismissBtn = document.getElementById('dismissSettlementBtn');
    if (dismissBtn) dismissBtn.style.display = 'none';

    checkSettlementSaveConditions();
}

function dismissSettlementChanges() {
    if (settlementState.isNewSettlement || !settlementState.selectedSettlementId) return;
    selectSettlement(settlementState.selectedSettlementId);
}

function populateSettlementForm(settlement) {
    // Settlement name
    const nameInput = document.getElementById('settlementName');
    if (nameInput) {
        nameInput.value = settlement.settlement_name || '';
    }

    // Description
    const descriptionInput = document.getElementById('settlementDescription');
    if (descriptionInput) {
        descriptionInput.value = settlement.description || '';
    }

    if (typeof setListBuilderItems === 'function') {
        setListBuilderItems('settlementKeyIssues', settlement.key_issues);
    }

    const contextInput = document.getElementById('settlementContext');
    if (contextInput) {
        contextInput.value = settlement.context || '';
    }

    // Faction
    const factionSelect = document.getElementById('factionSelect');
    if (factionSelect) {
        factionSelect.value = settlement.faction || '';
    }

    // Settlement asset
    updateAssetPreview('settlement', settlement.settlement_asset_id);

    // Vendor asset
    updateAssetPreview('vendor', settlement.vendor_asset_id);

    // Healer asset
    updateAssetPreview('healer', settlement.healer_asset_id);

    // Determine slot 1 from legacy utility flags, excluding slot 2 when possible.
    const utilityTypeSelect = document.getElementById('utilityTypeSelect');
    let utilityType = '';
    let utilityAssetId = null;
    const utilityCandidates = [
        ['church', settlement.church, settlement.church_asset_id],
        ['enchanter', settlement.enchanter, settlement.enchanter_asset_id],
        ['blacksmith', settlement.blacksmith, settlement.blacksmith_asset_id],
        ['alchemist', settlement.alchemist, settlement.alchemist_asset_id],
        ['trainer', settlement.trainer, settlement.trainer_asset_id]
    ];
    const utility2Type = settlement.utility2_type || '';
    const slot1Candidate = utilityCandidates.find(([type, enabled]) => enabled && type !== utility2Type)
        || utilityCandidates.find(([, enabled]) => enabled);
    if (slot1Candidate) {
        utilityType = slot1Candidate[0];
        utilityAssetId = slot1Candidate[2];
    }

    if (utilityTypeSelect) {
        utilityTypeSelect.value = utilityType;
    }

    // Update utility card styling
    if (utilityType) {
        selectUtilityType(utilityType, 1);
    }

    // Update utility asset
    updateAssetPreview('utility', utilityAssetId);

    const utility2TypeSelect = document.getElementById('utility2TypeSelect');
    if (utility2TypeSelect) {
        utility2TypeSelect.value = settlement.utility2_type || '';
    }
    updateAssetPreview('utility2', settlement.utility2_asset_id);

    syncMirroredBlessingSelects();
    updateUtilityContent();

    // Blessings (for church)
    const blessing1 = document.getElementById('blessing1Select');
    const blessing2 = document.getElementById('blessing2Select');
    const blessing3 = document.getElementById('blessing3Select');
    if (blessing1) { blessing1.value = settlement.blessing1 || ''; blessing1.dataset.prevBlessingValue = blessing1.value; }
    if (blessing2) { blessing2.value = settlement.blessing2 || ''; blessing2.dataset.prevBlessingValue = blessing2.value; }
    if (blessing3) { blessing3.value = settlement.blessing3 || ''; blessing3.dataset.prevBlessingValue = blessing3.value; }
    syncMirroredBlessingSelects();
    refreshBlessingDropdownLabels();

    // Expedition and Arena
    updateAssetPreview('expedition', settlement.expedition_asset_id);
    updateAssetPreview('arena', settlement.arena_asset_id);

    const expeditionContext = document.getElementById('expeditionContext');
    if (expeditionContext) expeditionContext.value = settlement.expedition_context || '';

    settlementState.vendorResponses = flattenSettlementResponses(settlement, {
        on_entered: 'vendor_on_entered',
        on_sold: 'vendor_on_sold',
        on_bought: 'vendor_on_bought'
    });
    settlementState.healerResponses = flattenSettlementResponses(settlement, {
        on_entered: 'healer_on_entered',
        on_healed: 'healer_on_healed',
        on_cured: 'healer_on_cured'
    });
    settlementState.utilityResponses = flattenSettlementResponses(settlement, {
        on_entered: 'utility_on_entered',
        on_placed: 'utility_on_placed',
        on_action: 'utility_on_action'
    });
    settlementState.utility2Responses = flattenSettlementResponses(settlement, {
        on_entered: 'utility2_on_entered',
        on_placed: 'utility2_on_placed',
        on_action: 'utility2_on_action'
    });

    // Vendor items and enchanter effects from settlement data
    settlementState.vendorItems = settlement.vendor_items || [];
    settlementState.enchanterEffects = settlement.enchanter_effects || [];
    renderVendorItems();
    renderEnchanterEffects();

    // Locations from settlement data
    settlementState.locations = settlement.locations || [];
    renderLocations();

    // Message rectangles
    settlementState.vendorMsgRect = settlement.vendor_msg_rect || null;
    settlementState.healerMsgRect = settlement.healer_msg_rect || null;
    settlementState.utilityMsgRect = settlement.utility_msg_rect || null;
    settlementState.utility2MsgRect = settlement.utility2_msg_rect || null;
    applyMsgRect('vendor');
    applyMsgRect('healer');
    applyMsgRect('utility');
    applyMsgRect('utility2');
}

function flattenSettlementResponses(settlement, fieldByType) {
    const responses = [];
    Object.entries(fieldByType).forEach(([type, field]) => {
        const value = settlement[field];
        if (!value) return;
        const arr = Array.isArray(value) ? value : [value];
        arr.forEach(text => {
            if (typeof text === 'string') responses.push({ type, text });
            else if (text?.text) responses.push({ type, text: text.text });
        });
    });
    return responses;
}

function updateUtilityContent() {
    updateUtilityContentForSlot(1);
    updateUtilityContentForSlot(2);
}

function updateUtilityContentForSlot(slot) {
    const utilityType = document.getElementById(slot === 2 ? 'utility2TypeSelect' : 'utilityTypeSelect')?.value || '';
    const prefix = slot === 2 ? 'utility2' : 'utility';

    document.getElementById(`${prefix}ChurchContent`)?.classList.remove('active');
    document.getElementById(`${prefix}EnchanterContent`)?.classList.remove('active');
    document.getElementById(`${prefix}EmptyContent`)?.classList.remove('active');

    switch (utilityType) {
        case 'church':
            document.getElementById(`${prefix}ChurchContent`)?.classList.add('active');
            break;
        case 'enchanter':
            document.getElementById(`${prefix}EnchanterContent`)?.classList.add('active');
            break;
        case 'blacksmith':
        case 'alchemist':
        case 'trainer':
            document.getElementById(`${prefix}EmptyContent`)?.classList.add('active');
            break;
        default:
            break;
    }
}

function selectUtilityType(type, slot = 1) {
    const utilityTypeSelect = document.getElementById(slot === 2 ? 'utility2TypeSelect' : 'utilityTypeSelect');
    if (utilityTypeSelect) {
        utilityTypeSelect.value = type;
    }

    updateUtilityContent();
}

function updateAssetPreview(target, assetId) {
    // Special handling for location - use separate function
    if (target === 'location') {
        updateLocationTexturePreview(assetId);
        return;
    }

    let areaId;

    switch (target) {
        case 'settlement':
            areaId = 'settlementAssetArea';
            break;
        case 'vendor':
            areaId = 'vendorAssetArea';
            break;
        case 'healer':
            areaId = 'healerAssetArea';
            break;
        case 'utility':
            areaId = 'utilityAssetArea';
            break;
        case 'utility2':
            areaId = 'utility2AssetArea';
            break;
        case 'expedition':
            areaId = 'expeditionAssetArea';
            break;
        case 'arena':
            areaId = 'arenaAssetArea';
            break;
    }

    const area = document.getElementById(areaId);
    if (!area) return;

    // Preserve msg-rect overlay if present
    const rectOverlay = area.querySelector('.msg-rect-overlay');

    if (assetId) {
        const asset = settlementState.settlementAssets.find(a => a.id === assetId);
        const src = asset ? asset.url : '';
        area.innerHTML = `<img src="${src}" alt="${target} asset">`;
        area.closest('.settlement-card')?.classList.add('has-asset');
    } else {
        area.innerHTML = `
            <div class="no-asset">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                    <circle cx="8.5" cy="8.5" r="1.5"/>
                    <polyline points="21 15 16 10 5 21"/>
                </svg>
                <span>Click to select asset</span>
            </div>
        `;
        area.closest('.settlement-card')?.classList.remove('has-asset');
    }

    // Re-append preserved rect overlay
    if (rectOverlay) area.appendChild(rectOverlay);

    // Store asset ID in data attribute
    area.dataset.assetId = assetId || '';
}

function renderVendorItems() {
    const grid = document.getElementById('vendorItemsGrid');
    if (!grid) return;

    const addBtn = `<div class="item-grid-cell add-cell" onclick="showAddItemDialog()" title="Add item">
        <span class="add-cell-icon">+</span>
    </div>`;

    const itemsHtml = settlementState.vendorItems.map((itemId, index) => {
        const item = settlementState.items.find(i => (i.item_id || i.id) === itemId);
        const name = item ? (item.item_name || item.name) : `Item ${itemId}`;
        const icon = resolveSettlementItemIcon(item);
        
        return `
            <div class="item-grid-cell" title="${escapeSettlementHtml(name)}">
                <img src="${icon}" alt="${escapeSettlementHtml(name)}" onerror="this.src='${SETTLEMENT_FALLBACK_ITEM_ICON}'">
                <button class="remove-btn" onclick="removeVendorItem(${index}); event.stopPropagation();">×</button>
            </div>
        `;
    }).join('');

    grid.innerHTML = addBtn + itemsHtml;
}

function renderEnchanterEffects() {
    const addBtn = `<div class="effect-row add-cell" onclick="showAddEffectDialog()" style="cursor:pointer; justify-content:center;">
        <span class="add-cell-icon">+</span>
    </div>`;

    const effectsHtml = settlementState.enchanterEffects.map((effectId, index) => {
        const effect = settlementState.effects.find(e => (e.effect_id || e.id) === effectId);
        const name = effect ? (effect.effect_name || effect.name) : `Effect ${effectId}`;
        return `
            <div class="effect-row">
                <div class="effect-item-name">${escapeSettlementHtml(name)}</div>
                <button class="effect-remove" onclick="removeEnchanterEffect(${index})">×</button>
            </div>
        `;
    }).join('');

    ['enchanterEffectsList', 'utility2EnchanterEffectsList'].forEach((id) => {
        const list = document.getElementById(id);
        if (list) {
            list.innerHTML = addBtn + effectsHtml;
        }
    });
}

function showAddItemDialog() {
    const existingOverlay = document.getElementById('itemSelectOverlay');
    if (existingOverlay) existingOverlay.remove();

    const overlay = document.createElement('div');
    overlay.id = 'itemSelectOverlay';
    overlay.className = 'settlement-asset-gallery-overlay active';
    overlay.style.zIndex = '1001';

    const itemsHtml = settlementState.items.map(item => {
        const id = item.item_id || item.id;
        const name = item.item_name || item.name || `Item ${id}`;
        const icon = resolveSettlementItemIcon(item);
        const isSelected = settlementState.vendorItems.includes(id);
        
        return `
            <div class="select-list-row ${isSelected ? 'selected' : ''}" 
                 data-item-id="${id}" 
                 data-search-name="${escapeSettlementHtml(name.toLowerCase())}"
                 onclick="toggleVendorItemSelection(${id})">
                <img class="select-list-icon" src="${icon}" alt="" onerror="this.style.display='none'">
                <span class="select-list-name">${escapeSettlementHtml(name)}</span>
                <span class="select-list-check">${isSelected ? '\u2713' : ''}</span>
            </div>
        `;
    }).join('');

    overlay.innerHTML = `
        <div class="settlement-asset-gallery" style="max-width: 480px;">
            <div class="settlement-asset-gallery-header">
                <input type="text" class="select-list-search" placeholder="Search items..." oninput="filterSelectList(this, '#itemSelectOverlay')">
                <button class="settlement-asset-gallery-close" onclick="closeItemSelectDialog()">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>
            <div class="settlement-asset-gallery-content" style="max-height: 60vh; overflow-y: auto;">
                <div class="select-list">
                    ${itemsHtml || '<p style="color: var(--text-muted); text-align: center; padding: 40px;">No items available</p>'}
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    overlay.querySelector('.select-list-search')?.focus();
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeItemSelectDialog();
    });
}

function toggleVendorItemSelection(itemId) {
    const index = settlementState.vendorItems.indexOf(itemId);
    if (index >= 0) {
        settlementState.vendorItems.splice(index, 1);
    } else {
        settlementState.vendorItems.push(itemId);
    }
    
    // Update the selection visual in the dialog
    const cell = document.querySelector(`#itemSelectOverlay .select-list-row[data-item-id="${itemId}"]`);
    if (cell) {
        cell.classList.toggle('selected');
        const check = cell.querySelector('.select-list-check');
        if (check) check.textContent = cell.classList.contains('selected') ? '\u2713' : '';
    }
    
    // Update the main vendor items grid
    renderVendorItems();
    checkSettlementSaveConditions();
}

function closeItemSelectDialog() {
    const overlay = document.getElementById('itemSelectOverlay');
    if (overlay) overlay.remove();
}

function showAddEffectDialog() {
    const existingOverlay = document.getElementById('effectSelectOverlay');
    if (existingOverlay) existingOverlay.remove();

    const overlay = document.createElement('div');
    overlay.id = 'effectSelectOverlay';
    overlay.className = 'settlement-asset-gallery-overlay active';
    overlay.style.zIndex = '1001';

    const groupedEffects = groupEffectsForSelection(settlementState.effects);
    const effectsHtml = groupedEffects.map(({ slotKey, slotLabel, effects }) => {
        const rowsHtml = effects.map(effect => {
            const id = effect.effect_id || effect.id;
            const name = effect.effect_name || effect.name || `Effect ${id}`;
            let desc = effect.description || effect.effect_description || '';
            if (desc && effect.factor != null) {
                desc = desc.replace('*', Math.abs(effect.factor));
            }
            const isSelected = settlementState.enchanterEffects.includes(id);

            return `
                <div class="select-list-row ${isSelected ? 'selected' : ''}" 
                     data-effect-id="${id}" 
                     data-search-name="${escapeSettlementHtml(`${name} ${slotLabel}`.toLowerCase())}"
                     onclick="toggleEnchanterEffectSelection(${id})">
                    <div class="select-list-info">
                        <span class="select-list-name">${escapeSettlementHtml(name)} <span class="select-list-slot">(${escapeSettlementHtml(slotLabel)})</span></span>
                        ${desc ? `<span class="select-list-desc">${escapeSettlementHtml(desc)}</span>` : ''}
                    </div>
                    <span class="select-list-check">${isSelected ? '\u2713' : ''}</span>
                </div>
            `;
        }).join('');

        return `
            <div class="select-list-group" data-slot-group="${escapeSettlementHtml(slotKey)}">
                <div class="select-list-group-label">${escapeSettlementHtml(slotLabel)}</div>
                ${rowsHtml}
            </div>
        `;
    }).join('');

    overlay.innerHTML = `
        <div class="settlement-asset-gallery" style="max-width: 520px;">
            <div class="settlement-asset-gallery-header">
                <input type="text" class="select-list-search" placeholder="Search effects..." oninput="filterEffectSelectList(this)">
                <button class="settlement-asset-gallery-close" onclick="closeEffectSelectDialog()">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>
            <div class="settlement-asset-gallery-content" style="max-height: 60vh; overflow-y: auto;">
                <div class="select-list">
                    ${effectsHtml || '<p style="color: var(--text-muted); text-align: center; padding: 40px;">No effects available</p>'}
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    overlay.querySelector('.select-list-search')?.focus();
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeEffectSelectDialog();
    });
}

function toggleEnchanterEffectSelection(effectId) {
    const index = settlementState.enchanterEffects.indexOf(effectId);
    if (index >= 0) {
        settlementState.enchanterEffects.splice(index, 1);
    } else {
        settlementState.enchanterEffects.push(effectId);
    }
    
    // Update the selection visual in the dialog
    const cell = document.querySelector(`#effectSelectOverlay .select-list-row[data-effect-id="${effectId}"]`);
    if (cell) {
        cell.classList.toggle('selected');
        const check = cell.querySelector('.select-list-check');
        if (check) check.textContent = cell.classList.contains('selected') ? '\u2713' : '';
    }
    
    // Update the main enchanter effects list
    renderEnchanterEffects();
    checkSettlementSaveConditions();
}

function closeEffectSelectDialog() {
    const overlay = document.getElementById('effectSelectOverlay');
    if (overlay) overlay.remove();
}

function groupEffectsForSelection(effects) {
    const groups = new Map();

    effects.forEach(effect => {
        const slotKey = String(effect.slot || effect.item_slot || effect.itemSlot || '').trim().toLowerCase();
        const slotLabel = formatEffectSlotLabel(slotKey);
        if (!groups.has(slotKey)) {
            groups.set(slotKey, {
                slotKey,
                slotLabel,
                effects: []
            });
        }
        groups.get(slotKey).effects.push(effect);
    });

    return Array.from(groups.values())
        .sort((a, b) => a.slotLabel.localeCompare(b.slotLabel))
        .map(group => ({
            ...group,
            effects: group.effects.sort((a, b) => {
                const aName = String(a.effect_name || a.name || `Effect ${a.effect_id || a.id}`);
                const bName = String(b.effect_name || b.name || `Effect ${b.effect_id || b.id}`);
                return aName.localeCompare(bName);
            })
        }));
}

function formatEffectSlotLabel(slot) {
    if (!slot) return 'Unslotted';
    return slot.charAt(0).toUpperCase() + slot.slice(1);
}

function filterEffectSelectList(input) {
    const query = input.value.toLowerCase().trim();
    const overlay = document.getElementById('effectSelectOverlay');
    if (!overlay) return;

    const groups = overlay.querySelectorAll('.select-list-group');
    groups.forEach(group => {
        let hasVisibleRows = false;
        const rows = group.querySelectorAll('.select-list-row');
        rows.forEach(row => {
            const name = row.dataset.searchName || '';
            const visible = name.includes(query);
            row.style.display = visible ? '' : 'none';
            if (visible) hasVisibleRows = true;
        });
        group.style.display = hasVisibleRows ? '' : 'none';
    });
}

function filterSelectList(input, overlaySelector) {
    const query = input.value.toLowerCase().trim();
    const rows = document.querySelectorAll(`${overlaySelector} .select-list-row`);
    rows.forEach(row => {
        const name = row.dataset.searchName || '';
        row.style.display = name.includes(query) ? '' : 'none';
    });
}

function removeVendorItem(index) {
    settlementState.vendorItems.splice(index, 1);
    renderVendorItems();
    checkSettlementSaveConditions();
}

function removeEnchanterEffect(index) {
    settlementState.enchanterEffects.splice(index, 1);
    renderEnchanterEffects();
    checkSettlementSaveConditions();
}

// Response modal management
const VENDOR_RESPONSE_TYPES = ['on_entered', 'on_sold', 'on_bought'];
const HEALER_RESPONSE_TYPES = ['on_entered', 'on_healed', 'on_cured'];
const UTILITY_RESPONSE_TYPES = ['on_entered', 'on_placed', 'on_action'];
let currentResponsesTarget = null; // 'vendor', 'healer', 'utility', 'utility2'

function getResponsesForTarget(target) {
    switch (target) {
        case 'vendor': return settlementState.vendorResponses;
        case 'healer': return settlementState.healerResponses;
        case 'utility': return settlementState.utilityResponses;
        case 'utility2': return settlementState.utility2Responses;
        default: return [];
    }
}

function getResponseTypesForTarget(target) {
    if (target === 'vendor') return VENDOR_RESPONSE_TYPES;
    if (target === 'healer') return HEALER_RESPONSE_TYPES;
    return UTILITY_RESPONSE_TYPES;
}

function openResponsesModal(target) {
    currentResponsesTarget = target;
    const overlay = document.getElementById('responsesModalOverlay');
    const title = document.getElementById('responsesModalTitle');
    
    if (title) {
        const labels = {
            vendor: 'Vendor Responses',
            healer: 'Healer Responses',
            utility: 'Utility Slot 1 Responses',
            utility2: 'Utility Slot 2 Responses'
        };
        title.textContent = labels[target] || 'Responses';
    }
    
    renderModalResponses();
    
    if (overlay) {
        overlay.classList.add('active');
    }
}

function closeResponsesModal() {
    const overlay = document.getElementById('responsesModalOverlay');
    if (overlay) {
        overlay.classList.remove('active');
    }
    currentResponsesTarget = null;
}

function addResponseEntry() {
    const responses = getResponsesForTarget(currentResponsesTarget);
    responses.push({ type: 'on_entered', text: '' });
    renderModalResponses();
}

function removeResponseEntry(index) {
    getResponsesForTarget(currentResponsesTarget).splice(index, 1);
    renderModalResponses();
}

function updateResponseEntry(index, field, value) {
    const responses = getResponsesForTarget(currentResponsesTarget);
    if (responses[index]) {
        responses[index][field] = value;
    }
}

function saveResponses() {
    // Responses are already saved in state, just close modal
    closeResponsesModal();
    checkSettlementSaveConditions();
}

function renderModalResponses() {
    const content = document.getElementById('responsesModalContent');
    if (!content) return;
    
    const responses = getResponsesForTarget(currentResponsesTarget);
    const types = getResponseTypesForTarget(currentResponsesTarget);
    
    if (responses.length === 0) {
        content.innerHTML = '<div style="color: #4a5568; font-style: italic; text-align: center; padding: 20px;">No responses yet. Click "Add Response" to create one.</div>';
        return;
    }
    
    content.innerHTML = responses.map((resp, index) => `
        <div class="response-entry-modal">
            <select onchange="updateResponseEntry(${index}, 'type', this.value)">
                ${types.map(t => `<option value="${t}" ${resp.type === t ? 'selected' : ''}>${t.replace(/_/g, ' ')}</option>`).join('')}
            </select>
            <input type="text" value="${escapeSettlementHtml(resp.text || '')}" 
                   onchange="updateResponseEntry(${index}, 'text', this.value)" 
                   placeholder="Response text...">
            <button class="remove-response-btn" onclick="removeResponseEntry(${index})">×</button>
        </div>
    `).join('');
}

function createNewSettlement() {
    settlementState.selectedSettlementId = null;
    settlementState.isNewSettlement = true;
    settlementState.vendorItems = [];
    settlementState.enchanterEffects = [];
    settlementState.vendorResponses = [];
    settlementState.healerResponses = [];
    settlementState.utilityResponses = [];
    settlementState.utility2Responses = [];
    settlementState.locations = [];
    settlementState.vendorMsgRect = {x1: 4.97, y1: 5.86, x2: 65.15, y2: 24.27};
    settlementState.healerMsgRect = {x1: 4.97, y1: 5.86, x2: 65.15, y2: 24.27};
    settlementState.utilityMsgRect = {x1: 3.79, y1: 4.21, x2: 77.28, y2: 23.44};
    settlementState.utility2MsgRect = {x1: 3.79, y1: 4.21, x2: 77.28, y2: 23.44};

    // Clear form
    document.getElementById('settlementName').value = '';
    document.getElementById('settlementDescription').value = '';
    if (typeof setListBuilderItems === 'function') {
        setListBuilderItems('settlementKeyIssues', []);
    }
    document.getElementById('settlementContext').value = '';
    document.getElementById('factionSelect').value = '';
    document.getElementById('utilityTypeSelect').value = '';
    document.getElementById('utility2TypeSelect').value = '';
    document.getElementById('blessing1Select').value = '';
    document.getElementById('blessing2Select').value = '';
    document.getElementById('blessing3Select').value = '';
    ['blessing1Select', 'blessing2Select', 'blessing3Select'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.dataset.prevBlessingValue = '';
    });
    syncMirroredBlessingSelects();
    refreshBlessingDropdownLabels();
    document.getElementById('expeditionContext').value = '';

    // Clear asset previews
    updateAssetPreview('settlement', null);
    updateAssetPreview('vendor', null);
    updateAssetPreview('healer', null);
    updateAssetPreview('utility', null);
    updateAssetPreview('utility2', null);
    updateAssetPreview('expedition', null);
    updateAssetPreview('arena', null);

    // Update utility content
    updateUtilityContent();

    // Clear vendor/enchanter lists
    renderVendorItems();
    renderEnchanterEffects();

    // Clear and render locations
    renderLocations();

    // Clear message rects
    applyMsgRect('vendor');
    applyMsgRect('healer');
    applyMsgRect('utility');
    applyMsgRect('utility2');

    // Update select
    const select = document.getElementById('settlementSelect');
    if (select) {
        select.value = '';
    }

    // Reset snapshot and update button label
    settlementState._snapshot = null;
    const saveBtn = document.getElementById('saveSettlementBtn');
    if (saveBtn) {
        saveBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1-2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
            <polyline points="17 21 17 13 7 13 7 21"></polyline>
            <polyline points="7 3 7 8 15 8"></polyline>
        </svg> Save`;
    }

    checkSettlementSaveConditions();
}

function showEmptyState() {
    // Show empty state message encouraging user to create a settlement
    createNewSettlement();
}

function openAssetGallery(target) {
    settlementState.currentAssetTarget = target;

    const overlay = document.getElementById('settlementAssetGalleryOverlay');
    const title = document.getElementById('settlementGalleryTitle');
    
    if (title) {
        switch (target) {
            case 'settlement':
                title.textContent = 'Select Settlement Asset';
                break;
            case 'vendor':
                title.textContent = 'Select Vendor Asset';
                break;
            case 'healer':
                title.textContent = 'Select Healer Asset';
                break;
            case 'utility':
                const utilityType = document.getElementById('utilityTypeSelect')?.value;
                title.textContent = utilityType ? `Select ${utilityType.charAt(0).toUpperCase() + utilityType.slice(1)} Asset` : 'Select Utility Slot 1 Asset';
                break;
            case 'utility2':
                const utility2Type = document.getElementById('utility2TypeSelect')?.value;
                title.textContent = utility2Type ? `Select ${utility2Type.charAt(0).toUpperCase() + utility2Type.slice(1)} Asset` : 'Select Utility Slot 2 Asset';
                break;
            case 'expedition':
                title.textContent = 'Select Expedition Asset';
                break;
            case 'arena':
                title.textContent = 'Select Arena Asset';
                break;
            case 'location':
                title.textContent = 'Select Location Texture';
                break;
        }
    }

    // Populate gallery
    populateAssetGallery();

    if (overlay) {
        overlay.classList.add('active');
    }
}

function closeAssetGallery() {
    const overlay = document.getElementById('settlementAssetGalleryOverlay');
    if (overlay) {
        overlay.classList.remove('active');
    }
    settlementState.currentAssetTarget = null;
}

function populateAssetGallery() {
    const grid = document.getElementById('settlementAssetGrid');
    if (!grid) return;

    const currentAssetId = getCurrentAssetId();
    const isQuestAsset = settlementState.currentAssetTarget === 'location';
    
    // Use quest assets for location textures, settlement assets for everything else
    const assets = isQuestAsset
        ? settlementState.questAssets 
        : settlementState.settlementAssets;

    if (assets.length === 0) {
        grid.innerHTML = '<p style="color: #a0aec0; text-align: center; padding: 40px;">No assets found. Upload some!</p>';
        return;
    }

    grid.innerHTML = assets.map(asset => `
        <div class="settlement-asset-item ${asset.id === currentAssetId ? 'selected' : ''}" 
             data-asset-id="${asset.id}" onclick="selectAsset(${asset.id})">
            <img src="${asset.url}" alt="Asset ${asset.id}" loading="lazy">
        </div>
    `).join('');
}

function getCurrentAssetId() {
    let areaId;
    switch (settlementState.currentAssetTarget) {
        case 'settlement':
            areaId = 'settlementAssetArea';
            break;
        case 'vendor':
            areaId = 'vendorAssetArea';
            break;
        case 'healer':
            areaId = 'healerAssetArea';
            break;
        case 'utility':
            areaId = 'utilityAssetArea';
            break;
        case 'utility2':
            areaId = 'utility2AssetArea';
            break;
        case 'expedition':
            areaId = 'expeditionAssetArea';
            break;
        case 'arena':
            areaId = 'arenaAssetArea';
            break;
        case 'location':
            areaId = 'locationTextureArea';
            break;
    }

    const area = document.getElementById(areaId);
    return area ? parseInt(area.dataset.assetId) || null : null;
}

function selectAsset(assetId) {
    const isQuestAsset = settlementState.currentAssetTarget === 'location';
    const assets = isQuestAsset
        ? settlementState.questAssets 
        : settlementState.settlementAssets;
    const asset = assets.find(a => a.id === assetId);
    if (asset) {
        selectSettlementAsset(assetId, asset.url);
    }
}

// Select asset with both ID and URL (like quest designer pattern)
function selectSettlementAsset(assetId, assetUrl) {
    if (!settlementState.currentAssetTarget) return;
    
    const target = settlementState.currentAssetTarget;
    
    if (target === 'location') {
        // Update location texture
        const textureArea = document.getElementById('locationTextureArea');
        if (textureArea) {
            textureArea.innerHTML = `<img src="${assetUrl}" alt="Location texture">`;
            textureArea.dataset.assetId = assetId;
        }
    } else {
        updateAssetPreview(target, assetId);
    }
    
    closeAssetGallery();
    checkSettlementSaveConditions();
}

async function uploadSettlementAsset(file) {
    if (!file.type.startsWith('image/')) {
        alert('Please select an image file');
        return;
    }
    return getSettlementAssetUploader().upload(file);
}

// Upload location texture (uses quest assets endpoint)
async function uploadLocationTexture(file) {
    if (!file.type.startsWith('image/')) {
        alert('Please select an image file');
        return;
    }
    return getLocationTextureUploader().upload(file);
}

function getSettlementAssetUploader() {
    if (settlementAssetUploader) return settlementAssetUploader;
    settlementAssetUploader = new AssetGallery({
        uploadEndpoint: '/api/uploadSettlementAsset',
        width: 512,
        height: 910,
        quality: 0.9,
        resizeMode: 'contain',
        onUploaded: ({ result }) => {
            console.log('✅ Settlement asset uploaded:', result);
            settlementState.settlementAssets.push({ id: result.assetId, url: result.url });
            populateAssetGallery();
            selectSettlementAsset(result.assetId, result.url);
        },
        onUploadError: ({ error }) => {
            console.error('Error uploading settlement asset:', error);
            alert('Error uploading settlement asset: ' + error.message);
        }
    });
    return settlementAssetUploader;
}

function getLocationTextureUploader() {
    if (locationTextureUploader) return locationTextureUploader;
    locationTextureUploader = new AssetGallery({
        uploadEndpoint: '/api/uploadQuestAsset',
        width: 512,
        height: 910,
        quality: 0.9,
        resizeMode: 'contain',
        buildUploadBody: ({ base64Data, file }) => ({
            imageData: base64Data,
            filename: file.name.replace(/\.[^/.]+$/, '.webp')
        }),
        onUploaded: ({ result }) => {
            settlementState.questAssets.push({ id: result.assetId, url: result.url });
            populateAssetGallery();
            selectSettlementAsset(result.assetId, result.url);
        },
        onUploadError: ({ error }) => {
            console.error('Error uploading quest asset:', error);
            alert('Error uploading quest asset: ' + error.message);
        }
    });
    return locationTextureUploader;
}

async function saveSettlement() {
    const name = document.getElementById('settlementName').value.trim();
    if (!name) {
        alert('Please enter a settlement name');
        return;
    }

    const utilityType = document.getElementById('utilityTypeSelect')?.value || '';
    const utility2Type = document.getElementById('utility2TypeSelect')?.value || '';
    const enchanterValidation = validateEnchanterInventoryForSave(utilityType, utility2Type);
    if (!enchanterValidation.valid) {
        alert(enchanterValidation.message);
        return;
    }

    const utilityAssetId = parseInt(document.getElementById('utilityAssetArea').dataset.assetId) || null;
    const utility2AssetId = parseInt(document.getElementById('utility2AssetArea').dataset.assetId) || null;
    const vendorAssetId = parseInt(document.getElementById('vendorAssetArea').dataset.assetId) || null;
    const healerAssetId = parseInt(document.getElementById('healerAssetArea').dataset.assetId) || null;
    const expeditionAssetId = parseInt(document.getElementById('expeditionAssetArea')?.dataset.assetId) || null;
    const arenaAssetId = parseInt(document.getElementById('arenaAssetArea')?.dataset.assetId) || null;
    const description = document.getElementById('settlementDescription')?.value.trim() || null;
    const keyIssues = typeof getListBuilderItems === 'function'
        ? getListBuilderItems('settlementKeyIssues')
        : parseListInput(document.getElementById('settlementKeyIssues')?.value || '');
    const context = document.getElementById('settlementContext')?.value.trim() || null;
    const expeditionContext = document.getElementById('expeditionContext')?.value.trim() || null;

    const vendorResponsesObj = buildResponsesObject(settlementState.vendorResponses);
    const healerResponsesObj = buildResponsesObject(settlementState.healerResponses);
    const utilityResponsesObj = buildResponsesObject(settlementState.utilityResponses);
    const utility2ResponsesObj = buildResponsesObject(settlementState.utility2Responses);

    const utilityAssetsByType = {};
    if (utilityType && utilityAssetId) utilityAssetsByType[utilityType] = utilityAssetId;
    if (utility2Type && utility2AssetId && !utilityAssetsByType[utility2Type]) {
        utilityAssetsByType[utility2Type] = utility2AssetId;
    }

    const settlement = {
        settlement_name: name,
        description: description,
        key_issues: keyIssues,
        context: context,
        faction: parseInt(document.getElementById('factionSelect').value) || null,
        settlement_asset_id: parseInt(document.getElementById('settlementAssetArea').dataset.assetId) || null,
        vendor_asset_id: vendorAssetId,
        healer_asset_id: healerAssetId,
        utility2_type: utility2Type || null,
        utility2_asset_id: utility2AssetId,
        // Set utility flags when either slot contains that utility type.
        blacksmith: utilityType === 'blacksmith' || utility2Type === 'blacksmith',
        alchemist: utilityType === 'alchemist' || utility2Type === 'alchemist',
        enchanter: utilityType === 'enchanter' || utility2Type === 'enchanter',
        trainer: utilityType === 'trainer' || utility2Type === 'trainer',
        church: utilityType === 'church' || utility2Type === 'church',
        // Blessings (for church)
        blessing1: parseInt(document.getElementById('blessing1Select').value) || null,
        blessing2: parseInt(document.getElementById('blessing2Select').value) || null,
        blessing3: parseInt(document.getElementById('blessing3Select').value) || null,
        // Legacy utility assets by type. If both slots use the same type, slot 1 wins here.
        blacksmith_asset_id: utilityAssetsByType.blacksmith || null,
        alchemist_asset_id: utilityAssetsByType.alchemist || null,
        enchanter_asset_id: utilityAssetsByType.enchanter || null,
        trainer_asset_id: utilityAssetsByType.trainer || null,
        church_asset_id: utilityAssetsByType.church || null,
        // New expedition and arena fields
        expedition_asset_id: expeditionAssetId,
        expedition_context: expeditionContext,
        arena_asset_id: arenaAssetId,
        // Vendor responses (JSONB with arrays per type)
        vendor_on_entered: vendorResponsesObj.on_entered?.length ? vendorResponsesObj.on_entered : null,
        vendor_on_sold: vendorResponsesObj.on_sold?.length ? vendorResponsesObj.on_sold : null,
        vendor_on_bought: vendorResponsesObj.on_bought?.length ? vendorResponsesObj.on_bought : null,
        // Healer responses
        healer_on_entered: healerResponsesObj.on_entered?.length ? healerResponsesObj.on_entered : null,
        healer_on_healed: healerResponsesObj.on_healed?.length ? healerResponsesObj.on_healed : null,
        healer_on_cured: healerResponsesObj.on_cured?.length ? healerResponsesObj.on_cured : null,
        // Utility responses (JSONB with arrays per type)
        utility_on_entered: utilityResponsesObj.on_entered?.length ? utilityResponsesObj.on_entered : null,
        utility_on_placed: utilityResponsesObj.on_placed?.length ? utilityResponsesObj.on_placed : null,
        utility_on_action: utilityResponsesObj.on_action?.length ? utilityResponsesObj.on_action : null,
        utility2_on_entered: utility2ResponsesObj.on_entered?.length ? utility2ResponsesObj.on_entered : null,
        utility2_on_placed: utility2ResponsesObj.on_placed?.length ? utility2ResponsesObj.on_placed : null,
        utility2_on_action: utility2ResponsesObj.on_action?.length ? utility2ResponsesObj.on_action : null,
        // Inventory arrays
        vendor_items: settlementState.vendorItems,
        enchanter_effects: settlementState.enchanterEffects,
        // Locations
        locations: settlementState.locations,
        // Message rectangles
        vendor_msg_rect: settlementState.vendorMsgRect || null,
        healer_msg_rect: settlementState.healerMsgRect || null,
        utility_msg_rect: settlementState.utilityMsgRect || null,
        utility2_msg_rect: settlementState.utility2MsgRect || null
    };

    if (!settlementState.isNewSettlement && settlementState.selectedSettlementId) {
        settlement.settlement_id = settlementState.selectedSettlementId;
    }

    settlementSaveButton?.setSaving(true);
    try {
        const result = await postAuthenticatedJson('/api/saveSettlement', settlement, { expectSuccess: true });
        console.log('✅ Settlement saved:', result);

        await syncAfterSave('settlements');
        settlementState.settlements = GlobalData.settlements;

        // Repopulate UI
        populateSettlementEditorSelect();

        // Select the saved settlement
        if (result.settlementId) {
            selectSettlement(result.settlementId);
        }

        checkSettlementSaveConditions();
        settlementSaveButton?.setSaving(false);
        settlementSaveButton?.flashSaved(1500);
    } catch (error) {
        settlementSaveButton?.setSaving(false);
        console.error('Error saving settlement:', error);
        alert('Error saving settlement: ' + error.message);
    }
}

function buildResponsesObject(responses) {
    const obj = {};
    responses.forEach(resp => {
        if (resp.type && resp.text) {
            if (!obj[resp.type]) {
                obj[resp.type] = [];
            }
            obj[resp.type].push(resp.text);
        }
    });
    return obj;
}

function parseListInput(text) {
    return text
        .split(/[\n,]/)
        .map(entry => entry.trim())
        .filter(Boolean);
}

function formatListOutput(value) {
    if (!value) return '';
    if (Array.isArray(value)) return value.join('\n');
    return String(value);
}

async function deleteSettlement() {
    if (!settlementState.selectedSettlementId) {
        return;
    }

    const settlement = settlementState.settlements.find(s => s.settlement_id === settlementState.selectedSettlementId);
    const name = settlement ? settlement.settlement_name : `ID ${settlementState.selectedSettlementId}`;

    if (!confirm(`Delete settlement "${name}"? This cannot be undone.`)) {
        return;
    }

    try {
        const token = await getCurrentAccessToken();
        if (!token) {
            alert('Authentication required');
            return;
        }

        const response = await fetch('/api/deleteSettlement', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ settlementId: settlementState.selectedSettlementId })
        });

        if (response.ok) {
            console.log('✅ Settlement deleted');

            await syncAfterSave('settlements');
            settlementState.settlements = GlobalData.settlements;
            populateSettlementEditorSelect();
            createNewSettlement();

            alert('Settlement deleted successfully!');
        } else {
            const error = await response.text();
            alert('Failed to delete settlement: ' + error);
        }

    } catch (error) {
        console.error('Error deleting settlement:', error);
        alert('Error deleting settlement: ' + error.message);
    }
}

// Utility function to escape HTML
function escapeSettlementHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ==================== SAVE VALIDATION ====================

function getSettlementFormSnapshot() {
    return JSON.stringify({
        name: document.getElementById('settlementName')?.value || '',
        description: document.getElementById('settlementDescription')?.value || '',
        keyIssues: typeof getListBuilderItems === 'function'
            ? getListBuilderItems('settlementKeyIssues').join(',')
            : (document.getElementById('settlementKeyIssues')?.value || ''),
        context: document.getElementById('settlementContext')?.value || '',
        expeditionContext: document.getElementById('expeditionContext')?.value || '',
        faction: document.getElementById('factionSelect')?.value || '',
        utilityType: document.getElementById('utilityTypeSelect')?.value || '',
        utility2Type: document.getElementById('utility2TypeSelect')?.value || '',
        settlementAssetId: document.getElementById('settlementAssetArea')?.dataset.assetId || '',
        vendorAssetId: document.getElementById('vendorAssetArea')?.dataset.assetId || '',
        healerAssetId: document.getElementById('healerAssetArea')?.dataset.assetId || '',
        utilityAssetId: document.getElementById('utilityAssetArea')?.dataset.assetId || '',
        utility2AssetId: document.getElementById('utility2AssetArea')?.dataset.assetId || '',
        expeditionAssetId: document.getElementById('expeditionAssetArea')?.dataset.assetId || '',
        arenaAssetId: document.getElementById('arenaAssetArea')?.dataset.assetId || '',
        blessing1: document.getElementById('blessing1Select')?.value || '',
        blessing2: document.getElementById('blessing2Select')?.value || '',
        blessing3: document.getElementById('blessing3Select')?.value || '',
        vendorItems: JSON.stringify(settlementState.vendorItems),
        enchanterEffects: JSON.stringify(settlementState.enchanterEffects),
        vendorResponses: JSON.stringify(settlementState.vendorResponses),
        healerResponses: JSON.stringify(settlementState.healerResponses),
        utilityResponses: JSON.stringify(settlementState.utilityResponses),
        utility2Responses: JSON.stringify(settlementState.utility2Responses),
        locations: JSON.stringify(settlementState.locations),
        vendorMsgRect: JSON.stringify(settlementState.vendorMsgRect),
        healerMsgRect: JSON.stringify(settlementState.healerMsgRect),
        utilityMsgRect: JSON.stringify(settlementState.utilityMsgRect),
        utility2MsgRect: JSON.stringify(settlementState.utility2MsgRect)
    });
}

function checkSettlementSaveConditions() {
    const btn = document.getElementById('saveSettlementBtn');
    if (!btn) return;

    const name = (document.getElementById('settlementName')?.value || '').trim();
    const utilityType = document.getElementById('utilityTypeSelect')?.value || '';
    const utility2Type = document.getElementById('utility2TypeSelect')?.value || '';

    const settlementAssetId = document.getElementById('settlementAssetArea')?.dataset.assetId || '';
    const arenaAssetId = document.getElementById('arenaAssetArea')?.dataset.assetId || '';
    const expeditionAssetId = document.getElementById('expeditionAssetArea')?.dataset.assetId || '';
    const vendorAssetId = document.getElementById('vendorAssetArea')?.dataset.assetId || '';
    const healerAssetId = document.getElementById('healerAssetArea')?.dataset.assetId || '';
    const utilityAssetId = document.getElementById('utilityAssetArea')?.dataset.assetId || '';
    const utility2AssetId = document.getElementById('utility2AssetArea')?.dataset.assetId || '';

    const allAssetsSet = settlementAssetId && arenaAssetId && expeditionAssetId && vendorAssetId && healerAssetId && utilityAssetId && utility2AssetId;
    const enchanterValidation = validateEnchanterInventoryForSave(utilityType, utility2Type);

    let canSave = false;

    if (settlementState.isNewSettlement) {
        canSave = !!name && !!allAssetsSet && !!utilityType && !!utility2Type && enchanterValidation.valid;
    } else {
        const currentSnapshot = getSettlementFormSnapshot();
        const isDirty = settlementState._snapshot && currentSnapshot !== settlementState._snapshot;
        canSave = !!isDirty && enchanterValidation.valid;
    }

    if (settlementSaveButton) {
        settlementSaveButton.setDirty(canSave);
    } else {
        btn.disabled = !canSave;
    }
    btn.classList.toggle('btn-disabled', !canSave);
    btn.title = enchanterValidation.valid ? '' : enchanterValidation.message;

    const dismissBtn = document.getElementById('dismissSettlementBtn');
    if (dismissBtn) {
        if (!settlementState.isNewSettlement && settlementState._snapshot) {
            const currentSnapshot = getSettlementFormSnapshot();
            const isDirty = currentSnapshot !== settlementState._snapshot;
            dismissBtn.style.display = isDirty ? '' : 'none';
        } else {
            dismissBtn.style.display = 'none';
        }
    }
}

function validateEnchanterInventoryForSave(utilityType, utility2Type = '') {
    if (utilityType !== 'enchanter' && utility2Type !== 'enchanter') {
        return { valid: true, message: '' };
    }

    const slotEffects = getSelectedEnchanterEffectsBySlot();
    const validSlots = Object.entries(slotEffects)
        .filter(([, effectIds]) => effectIds.size >= 6)
        .map(([slot]) => slot);

    if (validSlots.length >= 5) {
        return { valid: true, message: '' };
    }

    const slotSummary = Object.entries(slotEffects)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([slot, effectIds]) => `${slot}: ${effectIds.size}`)
        .join(', ');
    const detail = slotSummary ? ` Current slot counts: ${slotSummary}.` : '';

    return {
        valid: false,
        message: `Enchanter inventory must include effects for at least 5 unique item slots, with at least 6 unique effects in each slot.${detail}`
    };
}

function getSelectedEnchanterEffectsBySlot() {
    const effectsById = new Map();
    settlementState.effects.forEach(effect => {
        const id = Number(effect.effect_id ?? effect.id);
        if (!Number.isFinite(id)) return;
        effectsById.set(id, effect);
    });

    return settlementState.enchanterEffects.reduce((slotEffects, effectId) => {
        const effect = effectsById.get(Number(effectId));
        const slot = String(effect?.slot || effect?.item_slot || effect?.itemSlot || '').trim();
        if (!slot) return slotEffects;
        if (!slotEffects[slot]) {
            slotEffects[slot] = new Set();
        }
        slotEffects[slot].add(Number(effectId));
        return slotEffects;
    }, {});
}

// ==================== LOCATIONS MANAGEMENT ====================

function openAddLocationModal() {
    settlementState.editingLocationIndex = null;
    document.getElementById('locationModalTitle').textContent = 'Add Location';
    document.getElementById('locationName').value = '';
    document.getElementById('locationDescription').value = '';
    
    // Reset texture preview
    const textureArea = document.getElementById('locationTextureArea');
    textureArea.dataset.assetId = '';
    textureArea.classList.remove('has-texture');
    textureArea.innerHTML = `
        <div class="no-asset">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
            </svg>
            <span>Click to select texture</span>
        </div>
    `;
    
    document.getElementById('locationModalOverlay').classList.add('active');
}

function openEditLocationModal(index) {
    const location = settlementState.locations[index];
    if (!location) return;
    
    settlementState.editingLocationIndex = index;
    document.getElementById('locationModalTitle').textContent = 'Edit Location';
    document.getElementById('locationName').value = location.name || '';
    document.getElementById('locationDescription').value = location.description || '';
    
    // Set texture preview
    const textureArea = document.getElementById('locationTextureArea');
    textureArea.dataset.assetId = location.texture_id || '';
    
    if (location.texture_id) {
        const asset = settlementState.questAssets.find(a => a.id === location.texture_id);
        if (asset && asset.url) {
            textureArea.classList.add('has-texture');
            textureArea.innerHTML = `<img src="${asset.url}" alt="Location texture">`;
        } else {
            textureArea.classList.remove('has-texture');
            textureArea.innerHTML = `
                <div class="no-asset">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                        <circle cx="8.5" cy="8.5" r="1.5"/>
                        <polyline points="21 15 16 10 5 21"/>
                    </svg>
                    <span>Click to select texture</span>
                </div>
            `;
        }
    } else {
        textureArea.classList.remove('has-texture');
        textureArea.innerHTML = `
            <div class="no-asset">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                    <circle cx="8.5" cy="8.5" r="1.5"/>
                    <polyline points="21 15 16 10 5 21"/>
                </svg>
                <span>Click to select texture</span>
            </div>
        `;
    }
    
    document.getElementById('locationModalOverlay').classList.add('active');
}

function closeLocationModal() {
    document.getElementById('locationModalOverlay').classList.remove('active');
    settlementState.editingLocationIndex = null;
}

function saveLocation() {
    const name = document.getElementById('locationName').value.trim();
    const description = document.getElementById('locationDescription').value.trim();
    const textureId = document.getElementById('locationTextureArea').dataset.assetId;
    
    if (!name) {
        alert('Please enter a location name');
        return;
    }
    
    const locationData = {
        name: name,
        description: description,
        texture_id: textureId ? parseInt(textureId) : null
    };
    
    if (settlementState.editingLocationIndex !== null) {
        // Edit existing location - preserve location_id if it exists
        const existingLocation = settlementState.locations[settlementState.editingLocationIndex];
        settlementState.locations[settlementState.editingLocationIndex] = {
            location_id: existingLocation.location_id, // Preserve DB ID
            ...locationData
        };
    } else {
        // Add new location - no location_id means it's new
        settlementState.locations.push(locationData);
    }
    
    renderLocations();
    closeLocationModal();
    checkSettlementSaveConditions();
}

function deleteLocation(index) {
    const location = settlementState.locations[index];
    if (!location) return;
    
    if (confirm(`Delete location "${location.name}"?`)) {
        settlementState.locations.splice(index, 1);
        renderLocations();
        checkSettlementSaveConditions();
    }
}

function renderLocations() {
    const grid = document.getElementById('locationsGrid');
    const emptyState = document.getElementById('locationsEmptyState');
    
    if (!grid) return;
    
    // Clear existing location cards (keep empty state)
    const existingCards = grid.querySelectorAll('.location-card');
    existingCards.forEach(card => card.remove());
    
    if (settlementState.locations.length === 0) {
        if (emptyState) emptyState.style.display = 'flex';
        return;
    }
    
    if (emptyState) emptyState.style.display = 'none';
    
    settlementState.locations.forEach((location, index) => {
        const card = document.createElement('div');
        card.className = 'location-card' + (location.texture_id ? ' has-texture' : '');
        card.onclick = () => openEditLocationModal(index);
        
        // Find texture URL from quest assets
        let textureHtml = '';
        if (location.texture_id) {
            const asset = settlementState.questAssets.find(a => a.id === location.texture_id);
            const src = asset ? asset.url : '';
            if (src) {
                textureHtml = `<img src="${src}" alt="${escapeSettlementHtml(location.name)}">`;
            }
        }
        
        if (!textureHtml) {
            textureHtml = `
                <div class="no-texture">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                        <circle cx="8.5" cy="8.5" r="1.5"/>
                        <polyline points="21 15 16 10 5 21"/>
                    </svg>
                    <span>No texture</span>
                </div>
            `;
        }
        
        card.innerHTML = `
            <div class="location-card-texture">
                ${textureHtml}
            </div>
            <div class="location-card-info">
                <h4 class="location-card-name">${escapeSettlementHtml(location.name)}</h4>
                <p class="location-card-description">${escapeSettlementHtml(location.description || '')}</p>
            </div>
            <div class="location-card-actions">
                <button class="btn-edit-location" onclick="event.stopPropagation(); openEditLocationModal(${index})" title="Edit">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                </button>
                <button class="btn-delete-location" onclick="event.stopPropagation(); deleteLocation(${index})" title="Delete">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                </button>
            </div>
        `;
        
        grid.appendChild(card);
    });
}

function updateLocationTexturePreview(assetId) {
    const textureArea = document.getElementById('locationTextureArea');
    if (!textureArea) return;
    
    textureArea.dataset.assetId = assetId || '';
    
    if (assetId) {
        const asset = settlementState.questAssets.find(a => a.id === assetId);
        const src = asset ? asset.url : '';
        textureArea.classList.add('has-texture');
        textureArea.innerHTML = `<img src="${src}" alt="Location texture">`;
        return;
    }
    
    textureArea.classList.remove('has-texture');
    textureArea.innerHTML = `
        <div class="no-asset">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
            </svg>
            <span>Click to select texture</span>
        </div>
    `;
}

// Expose functions to window for HTML event handlers
window.loadSettlementDesignerData = loadSettlementDesignerData;
window.selectSettlement = selectSettlement;
window.selectAsset = selectAsset;
window.removeVendorItem = removeVendorItem;
window.removeEnchanterEffect = removeEnchanterEffect;
window.showAddItemDialog = showAddItemDialog;
window.showAddEffectDialog = showAddEffectDialog;
window.toggleVendorItemSelection = toggleVendorItemSelection;
window.closeItemSelectDialog = closeItemSelectDialog;
window.toggleEnchanterEffectSelection = toggleEnchanterEffectSelection;
window.closeEffectSelectDialog = closeEffectSelectDialog;
window.filterSelectList = filterSelectList;
window.openResponsesModal = openResponsesModal;
window.closeResponsesModal = closeResponsesModal;
window.addResponseEntry = addResponseEntry;
window.removeResponseEntry = removeResponseEntry;
window.updateResponseEntry = updateResponseEntry;
window.saveResponses = saveResponses;
window.openAddLocationModal = openAddLocationModal;
window.openEditLocationModal = openEditLocationModal;
window.closeLocationModal = closeLocationModal;
window.saveLocation = saveLocation;
window.deleteLocation = deleteLocation;

// ==================== MESSAGE RECTANGLE DRAG / RESIZE ====================

const MSG_RECT_TARGETS = ['vendor', 'healer', 'utility', 'utility2'];
const MSG_RECT_STATE_KEYS = {
    vendor: 'vendorMsgRect',
    healer: 'healerMsgRect',
    utility: 'utilityMsgRect',
    utility2: 'utility2MsgRect'
};
const MSG_RECT_ELEM_IDS = {
    vendor: 'vendorMsgRect',
    healer: 'healerMsgRect',
    utility: 'utilityMsgRect',
    utility2: 'utility2MsgRect'
};
const MSG_RECT_AREA_IDS = {
    vendor: 'vendorAssetArea',
    healer: 'healerAssetArea',
    utility: 'utilityAssetArea',
    utility2: 'utility2AssetArea'
};

function applyMsgRect(target) {
    const el = document.getElementById(MSG_RECT_ELEM_IDS[target]);
    if (!el) return;
    const rect = settlementState[MSG_RECT_STATE_KEYS[target]];
    if (!rect || rect.x1 == null) {
        el.style.display = 'none';
        return;
    }
    const left = Math.min(rect.x1, rect.x2);
    const top = Math.min(rect.y1, rect.y2);
    const width = Math.abs(rect.x2 - rect.x1);
    const height = Math.abs(rect.y2 - rect.y1);
    el.style.display = '';
    el.style.left = left + '%';
    el.style.top = top + '%';
    el.style.width = width + '%';
    el.style.height = height + '%';
}

function getMsgRectFromElement(target) {
    const el = document.getElementById(MSG_RECT_ELEM_IDS[target]);
    const area = document.getElementById(MSG_RECT_AREA_IDS[target]);
    if (!el || !area || el.style.display === 'none') return null;
    const aw = area.offsetWidth;
    const ah = area.offsetHeight;
    if (!aw || !ah) return null;
    const x1 = (parseFloat(el.style.left) || 0);
    const y1 = (parseFloat(el.style.top) || 0);
    const w = (parseFloat(el.style.width) || 0);
    const h = (parseFloat(el.style.height) || 0);
    return { x1: +x1.toFixed(2), y1: +y1.toFixed(2), x2: +(x1 + w).toFixed(2), y2: +(y1 + h).toFixed(2) };
}

function toggleMsgRect(target) {
    const el = document.getElementById(MSG_RECT_ELEM_IDS[target]);
    if (!el) return;

    if (el.style.display !== 'none') {
        el.style.display = 'none';
    } else {
        const stateKey = MSG_RECT_STATE_KEYS[target];
        if (settlementState[stateKey]) {
            applyMsgRect(target);
        } else {
            // No saved rect yet — show with default position without marking dirty
            const defaultRect = target === 'vendor' || target === 'healer'
                ? {x1: 4.97, y1: 5.86, x2: 65.15, y2: 24.27}
                : {x1: 3.79, y1: 4.21, x2: 77.28, y2: 23.44};
            settlementState[stateKey] = defaultRect;
            applyMsgRect(target);
        }
    }
}

function initMsgRects() {
    MSG_RECT_TARGETS.forEach(target => {
        const area = document.getElementById(MSG_RECT_AREA_IDS[target]);
        const el = document.getElementById(MSG_RECT_ELEM_IDS[target]);
        if (!area || !el) return;

        // Prevent single click on rect from opening asset gallery
        el.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // Drag the rect body
        el.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            startMsgRectDrag(target, e);
        });
    });
}

function startMsgRectDrag(target, startEvt) {
    const el = document.getElementById(MSG_RECT_ELEM_IDS[target]);
    const area = document.getElementById(MSG_RECT_AREA_IDS[target]);
    if (!el || !area) return;

    const aw = area.offsetWidth;
    const ah = area.offsetHeight;
    const startX = startEvt.clientX;
    const startY = startEvt.clientY;
    const origLeft = parseFloat(el.style.left) || 0;
    const origTop = parseFloat(el.style.top) || 0;
    const w = parseFloat(el.style.width) || 0;
    const h = parseFloat(el.style.height) || 0;

    function onMove(e) {
        const dx = ((e.clientX - startX) / aw) * 100;
        const dy = ((e.clientY - startY) / ah) * 100;
        let newLeft = origLeft + dx;
        let newTop = origTop + dy;
        // Clamp
        newLeft = Math.max(0, Math.min(100 - w, newLeft));
        newTop = Math.max(0, Math.min(100 - h, newTop));
        el.style.left = newLeft + '%';
        el.style.top = newTop + '%';
    }

    function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        settlementState[MSG_RECT_STATE_KEYS[target]] = getMsgRectFromElement(target);
        checkSettlementSaveConditions();
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
}

// Initialize rect drag when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMsgRects);
} else {
    initMsgRects();
}

// ── Context Modal ─────────────────────────────────────────────
let _contextModalSourceId = null;

function openContextModal(textareaId, title) {
    const src = document.getElementById(textareaId);
    const overlay = document.getElementById('contextModalOverlay');
    const modalTA = document.getElementById('contextModalTextarea');
    const modalTitle = document.getElementById('contextModalTitle');
    if (!src || !overlay || !modalTA) return;

    _contextModalSourceId = textareaId;
    modalTitle.textContent = title || 'Context';
    modalTA.value = src.value;
    overlay.style.display = 'flex';
    modalTA.focus();
}

function closeContextModal() {
    const overlay = document.getElementById('contextModalOverlay');
    const modalTA = document.getElementById('contextModalTextarea');
    if (!overlay) return;

    if (_contextModalSourceId) {
        const src = document.getElementById(_contextModalSourceId);
        if (src && src.value !== modalTA.value) {
            src.value = modalTA.value;
            checkSettlementSaveConditions();
        }
    }
    _contextModalSourceId = null;
    overlay.style.display = 'none';
}

// Close on Escape or click outside
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const overlay = document.getElementById('contextModalOverlay');
        if (overlay && overlay.style.display === 'flex') {
            closeContextModal();
        }
    }
});
document.addEventListener('click', (e) => {
    const overlay = document.getElementById('contextModalOverlay');
    if (overlay && e.target === overlay) {
        closeContextModal();
    }
});
