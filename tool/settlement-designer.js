// Settlement Designer JavaScript

// Settlement state
let settlementState = {
    settlements: [],
    selectedSettlementId: null,
    isNewSettlement: false,
    settlementAssets: [],
    currentAssetTarget: null, // 'settlement', 'vendor', 'utility', 'expedition', 'arena'
    blessings: [], // perks for church blessings
    items: [], // items for vendor
    effects: [], // effects for enchanter
    vendorItems: [], // current vendor's items
    enchanterEffects: [], // current enchanter's effects
    vendorResponses: [], // [{type: 'on_entered', text: '...'}, ...]
    utilityResponses: [] // [{type: 'on_entered', text: '...'}, ...]
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('settlementDesigner')) {
        initSettlementDesigner();
    }
});

function initSettlementDesigner() {
    console.log('🏘️ Initializing Settlement Designer...');
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

    // Delete button
    const deleteSettlementBtn = document.getElementById('deleteSettlementBtn');
    if (deleteSettlementBtn) {
        deleteSettlementBtn.addEventListener('click', deleteSettlement);
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

    const utilityAssetArea = document.getElementById('utilityAssetArea');
    if (utilityAssetArea) {
        utilityAssetArea.addEventListener('click', () => openAssetGallery('utility'));
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
            if (file) {
                uploadSettlementAsset(file);
            }
        });
    }

    // Utility type selector
    const utilityTypeSelect = document.getElementById('utilityTypeSelect');
    if (utilityTypeSelect) {
        utilityTypeSelect.addEventListener('change', updateUtilityContent);
    }

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
}

async function loadSettlementDesignerData() {
    console.log('Loading settlement data...');

    const token = await getCurrentAccessToken();
    if (!token) {
        console.error('Authentication required');
        return;
    }

    // Load settlements
    try {
        const settlementsResponse = await fetch('http://localhost:8080/api/getSettlements', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (settlementsResponse.ok) {
            const data = await settlementsResponse.json();
            settlementState.settlements = data.settlements || [];
            console.log('✅ Loaded', settlementState.settlements.length, 'settlements');
        } else {
            console.error('Failed to load settlements:', await settlementsResponse.text());
        }
    } catch (error) {
        console.error('Error loading settlements:', error);
    }

    // Load settlement assets from S3
    try {
        await loadSettlementAssets();
    } catch (error) {
        console.error('Error loading settlement assets:', error);
    }

    // Load perks for blessings dropdown
    try {
        await loadBlessingsData();
    } catch (error) {
        console.error('Error loading blessings:', error);
    }

    // Load items for vendor
    try {
        await loadSettlementItemsData();
    } catch (error) {
        console.error('Error loading items for vendor:', error);
    }

    // Load effects for enchanter
    try {
        await loadSettlementEffectsData();
    } catch (error) {
        console.error('Error loading effects for enchanter:', error);
    }

    // Populate UI
    populateSettlementSelect();
    populateBlessingDropdowns();

    // Start with a blank "new settlement" state
    createNewSettlement();
}

async function loadSettlementAssets() {
    try {
        const token = await getCurrentAccessToken();
        if (!token) return;

        const response = await fetch('http://localhost:8080/api/getSettlementAssets', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            const data = await response.json();
            settlementState.settlementAssets = data.assets || [];
            console.log('✅ Loaded', settlementState.settlementAssets.length, 'settlement assets');
        }
    } catch (error) {
        console.error('Error loading settlement assets:', error);
    }
}

async function loadBlessingsData() {
    // Load perks as blessings - they're in the perks table
    if (typeof getPerks === 'function') {
        settlementState.blessings = getPerks() || [];
    } else {
        try {
            const token = await getCurrentAccessToken();
            if (!token) return;

            const response = await fetch('http://localhost:8080/api/getPerks', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const data = await response.json();
                settlementState.blessings = data.perks || [];
                console.log('✅ Loaded', settlementState.blessings.length, 'perks/blessings');
            }
        } catch (error) {
            console.error('Error loading perks:', error);
        }
    }
}

async function loadSettlementItemsData() {
    // Wait for global items to be loaded first
    if (typeof loadItemsData === 'function') {
        try {
            const items = await loadItemsData();  // This returns the items when loaded
            settlementState.items = items || [];
            console.log('✅ Settlement got', settlementState.items.length, 'items from global loadItemsData');
            return;
        } catch (e) {
            console.log('Error loading items via loadItemsData:', e);
        }
    }
    
    // Fallback: get from getItems if already loaded
    if (typeof getItems === 'function') {
        settlementState.items = getItems() || [];
        if (settlementState.items.length > 0) {
            console.log('✅ Settlement got', settlementState.items.length, 'items from getItems');
            return;
        }
    }
    
    // Final fallback: fetch directly
    try {
        const token = await getCurrentAccessToken();
        if (!token) return;

        const response = await fetch('http://localhost:8080/api/getItems', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            const data = await response.json();
            settlementState.items = data.items || [];
            console.log('✅ Loaded', settlementState.items.length, 'items directly');
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
            console.log('✅ Settlement got', settlementState.effects.length, 'effects from global loadEffectsData');
            return;
        } catch (e) {
            console.log('Error loading effects via loadEffectsData:', e);
        }
    }
    
    // Fallback: get from getEffects if already loaded
    if (typeof getEffects === 'function') {
        settlementState.effects = getEffects() || [];
        if (settlementState.effects.length > 0) {
            console.log('✅ Settlement got', settlementState.effects.length, 'effects from getEffects');
            return;
        }
    }
    
    // Final fallback: fetch directly
    try {
        const token = await getCurrentAccessToken();
        if (!token) return;

        const response = await fetch('http://localhost:8080/api/getEffects', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            const data = await response.json();
            settlementState.effects = data.effects || [];
            console.log('✅ Loaded', settlementState.effects.length, 'effects directly');
        }
    } catch (error) {
        console.error('Error loading effects:', error);
    }
}

function populateSettlementSelect() {
    const select = document.getElementById('settlementSelect');
    if (!select) return;

    select.innerHTML = '<option value="">-- New Settlement --</option>';
    
    settlementState.settlements.forEach(settlement => {
        const option = document.createElement('option');
        option.value = settlement.settlement_id;
        option.textContent = settlement.settlement_name || `Settlement ${settlement.settlement_id}`;
        select.appendChild(option);
    });
}

function populateBlessingDropdowns() {
    const blessingSelects = ['blessing1Select', 'blessing2Select', 'blessing3Select'];
    
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
    
    // Show delete button for existing settlements
    const deleteBtn = document.getElementById('deleteSettlementBtn');
    if (deleteBtn) {
        deleteBtn.style.display = 'flex';
    }
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

    // Faction
    const factionSelect = document.getElementById('factionSelect');
    if (factionSelect) {
        factionSelect.value = settlement.faction || '';
    }

    // Settlement asset
    updateAssetPreview('settlement', settlement.settlement_asset_id);

    // Vendor asset
    updateAssetPreview('vendor', settlement.vendor_asset_id);

    // Determine which utility is active based on the boolean flags
    const utilityTypeSelect = document.getElementById('utilityTypeSelect');
    let utilityType = '';
    let utilityAssetId = null;

    if (settlement.church) {
        utilityType = 'church';
        utilityAssetId = settlement.church_asset_id;
    } else if (settlement.enchanter) {
        utilityType = 'enchanter';
        utilityAssetId = settlement.enchanter_asset_id;
    } else if (settlement.blacksmith) {
        utilityType = 'blacksmith';
        utilityAssetId = settlement.blacksmith_asset_id;
    } else if (settlement.alchemist) {
        utilityType = 'alchemist';
        utilityAssetId = settlement.alchemist_asset_id;
    } else if (settlement.trainer) {
        utilityType = 'trainer';
        utilityAssetId = settlement.trainer_asset_id;
    }

    if (utilityTypeSelect) {
        utilityTypeSelect.value = utilityType;
    }

    // Update utility card styling
    if (utilityType) {
        selectUtilityType(utilityType);
    }

    // Update utility asset
    updateAssetPreview('utility', utilityAssetId);

    // Update utility content visibility was already called by selectUtilityType
    if (!utilityType) {
        updateUtilityContent();
    }

    // Blessings (for church)
    const blessing1 = document.getElementById('blessing1Select');
    const blessing2 = document.getElementById('blessing2Select');
    const blessing3 = document.getElementById('blessing3Select');
    if (blessing1) blessing1.value = settlement.blessing1 || '';
    if (blessing2) blessing2.value = settlement.blessing2 || '';
    if (blessing3) blessing3.value = settlement.blessing3 || '';

    // Expedition and Arena
    updateAssetPreview('expedition', settlement.expedition_asset_id);
    updateAssetPreview('arena', settlement.arena_asset_id);
    
    const expeditionDesc = document.getElementById('expeditionDescription');
    if (expeditionDesc) expeditionDesc.value = settlement.expedition_description || '';

    // Parse and populate vendor responses (arrays per type -> flat list)
    settlementState.vendorResponses = [];
    if (settlement.vendor_on_entered) {
        const arr = Array.isArray(settlement.vendor_on_entered) ? settlement.vendor_on_entered : [settlement.vendor_on_entered];
        arr.forEach(text => {
            if (typeof text === 'string') settlementState.vendorResponses.push({ type: 'on_entered', text });
            else if (text?.text) settlementState.vendorResponses.push({ type: 'on_entered', text: text.text });
        });
    }
    if (settlement.vendor_on_sold) {
        const arr = Array.isArray(settlement.vendor_on_sold) ? settlement.vendor_on_sold : [settlement.vendor_on_sold];
        arr.forEach(text => {
            if (typeof text === 'string') settlementState.vendorResponses.push({ type: 'on_sold', text });
            else if (text?.text) settlementState.vendorResponses.push({ type: 'on_sold', text: text.text });
        });
    }
    if (settlement.vendor_on_bought) {
        const arr = Array.isArray(settlement.vendor_on_bought) ? settlement.vendor_on_bought : [settlement.vendor_on_bought];
        arr.forEach(text => {
            if (typeof text === 'string') settlementState.vendorResponses.push({ type: 'on_bought', text });
            else if (text?.text) settlementState.vendorResponses.push({ type: 'on_bought', text: text.text });
        });
    }
    renderVendorResponses();

    // Parse and populate utility responses (arrays per type -> flat list)
    settlementState.utilityResponses = [];
    if (settlement.utility_on_entered) {
        const arr = Array.isArray(settlement.utility_on_entered) ? settlement.utility_on_entered : [settlement.utility_on_entered];
        arr.forEach(text => {
            if (typeof text === 'string') settlementState.utilityResponses.push({ type: 'on_entered', text });
            else if (text?.text) settlementState.utilityResponses.push({ type: 'on_entered', text: text.text });
        });
    }
    if (settlement.utility_on_placed) {
        const arr = Array.isArray(settlement.utility_on_placed) ? settlement.utility_on_placed : [settlement.utility_on_placed];
        arr.forEach(text => {
            if (typeof text === 'string') settlementState.utilityResponses.push({ type: 'on_placed', text });
            else if (text?.text) settlementState.utilityResponses.push({ type: 'on_placed', text: text.text });
        });
    }
    if (settlement.utility_on_action) {
        const arr = Array.isArray(settlement.utility_on_action) ? settlement.utility_on_action : [settlement.utility_on_action];
        arr.forEach(text => {
            if (typeof text === 'string') settlementState.utilityResponses.push({ type: 'on_action', text });
            else if (text?.text) settlementState.utilityResponses.push({ type: 'on_action', text: text.text });
        });
    }
    renderUtilityResponses();

    // Vendor items and enchanter effects from settlement data
    settlementState.vendorItems = settlement.vendor_items || [];
    settlementState.enchanterEffects = settlement.enchanter_effects || [];
    renderVendorItems();
    renderEnchanterEffects();
}

function updateUtilityContent() {
    const utilityType = document.getElementById('utilityTypeSelect')?.value || '';
    
    // Hide all content sections
    document.getElementById('utilityChurchContent')?.classList.remove('active');
    document.getElementById('utilityEnchanterContent')?.classList.remove('active');
    document.getElementById('utilityEmptyContent')?.classList.remove('active');

    // Show relevant content
    switch (utilityType) {
        case 'church':
            document.getElementById('utilityChurchContent')?.classList.add('active');
            break;
        case 'enchanter':
            document.getElementById('utilityEnchanterContent')?.classList.add('active');
            break;
        case 'blacksmith':
        case 'alchemist':
        case 'trainer':
            document.getElementById('utilityEmptyContent')?.classList.add('active');
            break;
        default:
            // No utility selected - show nothing
            break;
    }
}

function selectUtilityType(type) {
    // Update the hidden select to keep form submission working
    const utilityTypeSelect = document.getElementById('utilityTypeSelect');
    if (utilityTypeSelect) {
        utilityTypeSelect.value = type;
    }

    // Update active card styling
    const cards = document.querySelectorAll('.utility-type-card');
    cards.forEach(card => {
        card.classList.remove('active');
        if (card.dataset.type === type) {
            card.classList.add('active');
        }
    });

    // Update utility content
    updateUtilityContent();
}

function updateAssetPreview(target, assetId) {
    let areaId;

    switch (target) {
        case 'settlement':
            areaId = 'settlementAssetArea';
            break;
        case 'vendor':
            areaId = 'vendorAssetArea';
            break;
        case 'utility':
            areaId = 'utilityAssetArea';
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

    let assetUrl = null;

    // Find asset URL
    if (assetId) {
        const asset = settlementState.settlementAssets.find(a => a.id === assetId);
        if (asset) {
            assetUrl = asset.url;
        }
    }

    if (assetUrl) {
        area.innerHTML = `<img src="${assetUrl}" alt="${target} asset">`;
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

    // Store asset ID in data attribute
    area.dataset.assetId = assetId || '';
}

function renderVendorItems() {
    const grid = document.getElementById('vendorItemsGrid');
    if (!grid) return;

    if (settlementState.vendorItems.length === 0) {
        grid.innerHTML = '<div class="items-grid-empty">No items added</div>';
        return;
    }

    grid.innerHTML = settlementState.vendorItems.map((itemId, index) => {
        const item = settlementState.items.find(i => (i.item_id || i.id) === itemId);
        const name = item ? (item.item_name || item.name) : `Item ${itemId}`;
        const icon = item?.icon || '';
        
        return `
            <div class="item-grid-cell" title="${escapeSettlementHtml(name)}">
                ${icon ? `<img src="${icon}" alt="${escapeSettlementHtml(name)}">` : 
                    `<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="#4a5568" stroke-width="2">
                        <rect x="3" y="3" width="18" height="18" rx="2"/>
                        <path d="M12 8v8M8 12h8"/>
                    </svg>`}
                <span class="item-name">${escapeSettlementHtml(name)}</span>
                <button class="remove-btn" onclick="removeVendorItem(${index}); event.stopPropagation();">×</button>
            </div>
        `;
    }).join('');
}

function renderEnchanterEffects() {
    const list = document.getElementById('enchanterEffectsList');
    if (!list) return;

    if (settlementState.enchanterEffects.length === 0) {
        list.innerHTML = '<div style="text-align: center; color: #4a5568; font-style: italic; padding: 12px;">No effects added</div>';
        return;
    }

    list.innerHTML = settlementState.enchanterEffects.map((effectId, index) => {
        const effect = settlementState.effects.find(e => (e.effect_id || e.id) === effectId);
        const name = effect ? (effect.effect_name || effect.name) : `Effect ${effectId}`;
        const description = effect ? (effect.effect_description || effect.description || '') : '';
        return `
            <div class="effect-row">
                <div class="effect-item-content">
                    <div class="effect-item-name">${escapeSettlementHtml(name)}</div>
                    ${description ? `<div class="effect-item-description">${escapeSettlementHtml(description)}</div>` : ''}
                </div>
                <button class="effect-remove" onclick="removeEnchanterEffect(${index})">×</button>
            </div>
        `;
    }).join('');
}

function showAddItemDialog() {
    // Create a modal overlay for item selection
    const existingOverlay = document.getElementById('itemSelectOverlay');
    if (existingOverlay) existingOverlay.remove();

    const overlay = document.createElement('div');
    overlay.id = 'itemSelectOverlay';
    overlay.className = 'settlement-asset-gallery-overlay active';
    overlay.style.zIndex = '1001';

    const itemsHtml = settlementState.items.map(item => {
        const id = item.item_id || item.id;
        const name = item.item_name || item.name || `Item ${id}`;
        const icon = item.icon || '';
        const isSelected = settlementState.vendorItems.includes(id);
        
        return `
            <div class="item-grid-cell ${isSelected ? 'selected' : ''}" 
                 data-item-id="${id}" 
                 onclick="toggleVendorItemSelection(${id})"
                 style="cursor: pointer;">
                ${icon ? `<img src="${icon}" alt="${escapeSettlementHtml(name)}">` : 
                    `<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="#4a5568" stroke-width="2">
                        <rect x="3" y="3" width="18" height="18" rx="2"/>
                        <path d="M12 8v8M8 12h8"/>
                    </svg>`}
                <span class="item-name">${escapeSettlementHtml(name)}</span>
            </div>
        `;
    }).join('');

    overlay.innerHTML = `
        <div class="settlement-asset-gallery" style="max-width: 800px;">
            <div class="settlement-asset-gallery-header">
                <h3>Select Items for Vendor</h3>
                <button class="settlement-asset-gallery-close" onclick="closeItemSelectDialog()">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>
            <div class="settlement-asset-gallery-content">
                <div class="items-grid" style="max-height: none;">
                    ${itemsHtml || '<p style="color: #a0aec0; text-align: center; padding: 40px;">No items available</p>'}
                </div>
            </div>
            <div class="settlement-upload-section">
                <button class="btn-save-settlement" onclick="closeItemSelectDialog()">Done</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    // Close on backdrop click
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
    const cell = document.querySelector(`#itemSelectOverlay .item-grid-cell[data-item-id="${itemId}"]`);
    if (cell) {
        cell.classList.toggle('selected');
    }
    
    // Update the main vendor items grid
    renderVendorItems();
}

function closeItemSelectDialog() {
    const overlay = document.getElementById('itemSelectOverlay');
    if (overlay) overlay.remove();
}

function showAddEffectDialog() {
    // Create a modal overlay for effect selection (similar to item selection)
    const existingOverlay = document.getElementById('effectSelectOverlay');
    if (existingOverlay) existingOverlay.remove();

    console.log('🔮 showAddEffectDialog - settlementState.effects:', settlementState.effects.length);

    const overlay = document.createElement('div');
    overlay.id = 'effectSelectOverlay';
    overlay.className = 'settlement-asset-gallery-overlay active';
    overlay.style.zIndex = '1001';

    const effectsHtml = settlementState.effects.map(effect => {
        const id = effect.effect_id || effect.id;
        const name = effect.effect_name || effect.name || `Effect ${id}`;
        const isSelected = settlementState.enchanterEffects.includes(id);
        
        return `
            <div class="item-grid-cell ${isSelected ? 'selected' : ''}" 
                 data-effect-id="${id}" 
                 onclick="toggleEnchanterEffectSelection(${id})"
                 style="cursor: pointer;">
                <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="${isSelected ? '#48bb78' : '#4a5568'}" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 6v6l4 2"/>
                </svg>
                <span class="item-name">${escapeSettlementHtml(name)}</span>
            </div>
        `;
    }).join('');

    overlay.innerHTML = `
        <div class="settlement-asset-gallery" style="max-width: 800px;">
            <div class="settlement-asset-gallery-header">
                <h3>Select Effects for Enchanter</h3>
                <button class="settlement-asset-gallery-close" onclick="closeEffectSelectDialog()">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>
            <div class="settlement-asset-gallery-content">
                <div class="items-grid" style="max-height: none;">
                    ${effectsHtml || '<p style="color: #a0aec0; text-align: center; padding: 40px;">No effects available</p>'}
                </div>
            </div>
            <div class="settlement-upload-section">
                <button class="btn-save-settlement" onclick="closeEffectSelectDialog()">Done</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    // Close on backdrop click
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
    const cell = document.querySelector(`#effectSelectOverlay .item-grid-cell[data-effect-id="${effectId}"]`);
    if (cell) {
        cell.classList.toggle('selected');
        const svg = cell.querySelector('svg');
        if (svg) {
            svg.setAttribute('stroke', cell.classList.contains('selected') ? '#48bb78' : '#4a5568');
        }
    }
    
    // Update the main enchanter effects list
    renderEnchanterEffects();
}

function closeEffectSelectDialog() {
    const overlay = document.getElementById('effectSelectOverlay');
    if (overlay) overlay.remove();
}

function removeVendorItem(index) {
    settlementState.vendorItems.splice(index, 1);
    renderVendorItems();
}

function removeEnchanterEffect(index) {
    settlementState.enchanterEffects.splice(index, 1);
    renderEnchanterEffects();
}

// Response management functions
const VENDOR_RESPONSE_TYPES = ['on_entered', 'on_sold', 'on_bought'];
const UTILITY_RESPONSE_TYPES = ['on_entered', 'on_placed', 'on_action'];

function addVendorResponse() {
    settlementState.vendorResponses.push({ type: 'on_entered', text: '' });
    renderVendorResponses();
}

function addUtilityResponse() {
    settlementState.utilityResponses.push({ type: 'on_entered', text: '' });
    renderUtilityResponses();
}

function removeVendorResponse(index) {
    settlementState.vendorResponses.splice(index, 1);
    renderVendorResponses();
}

function removeUtilityResponse(index) {
    settlementState.utilityResponses.splice(index, 1);
    renderUtilityResponses();
}

function updateVendorResponse(index, field, value) {
    if (settlementState.vendorResponses[index]) {
        settlementState.vendorResponses[index][field] = value;
    }
}

function updateUtilityResponse(index, field, value) {
    if (settlementState.utilityResponses[index]) {
        settlementState.utilityResponses[index][field] = value;
    }
}

function renderVendorResponses() {
    const list = document.getElementById('vendorResponsesList');
    if (!list) return;

    if (settlementState.vendorResponses.length === 0) {
        list.innerHTML = '<div style="color: #4a5568; font-style: italic; font-size: 10px;">No responses</div>';
        return;
    }

    list.innerHTML = settlementState.vendorResponses.map((resp, index) => `
        <div class="response-entry">
            <select onchange="updateVendorResponse(${index}, 'type', this.value)">
                ${VENDOR_RESPONSE_TYPES.map(t => `<option value="${t}" ${resp.type === t ? 'selected' : ''}>${t.replace('_', ' ')}</option>`).join('')}
            </select>
            <input type="text" value="${escapeSettlementHtml(resp.text || '')}" 
                   onchange="updateVendorResponse(${index}, 'text', this.value)" 
                   placeholder="Response text...">
            <button class="remove-response-btn" onclick="removeVendorResponse(${index})">×</button>
        </div>
    `).join('');
}

function renderUtilityResponses() {
    const list = document.getElementById('utilityResponsesList');
    if (!list) return;

    if (settlementState.utilityResponses.length === 0) {
        list.innerHTML = '<div style="color: #4a5568; font-style: italic; font-size: 10px;">No responses</div>';
        return;
    }

    list.innerHTML = settlementState.utilityResponses.map((resp, index) => `
        <div class="response-entry">
            <select onchange="updateUtilityResponse(${index}, 'type', this.value)">
                ${UTILITY_RESPONSE_TYPES.map(t => `<option value="${t}" ${resp.type === t ? 'selected' : ''}>${t.replace('_', ' ')}</option>`).join('')}
            </select>
            <input type="text" value="${escapeSettlementHtml(resp.text || '')}" 
                   onchange="updateUtilityResponse(${index}, 'text', this.value)" 
                   placeholder="Response text...">
            <button class="remove-response-btn" onclick="removeUtilityResponse(${index})">×</button>
        </div>
    `).join('');
}

function createNewSettlement() {
    settlementState.selectedSettlementId = null;
    settlementState.isNewSettlement = true;
    settlementState.vendorItems = [];
    settlementState.enchanterEffects = [];
    settlementState.vendorResponses = [];
    settlementState.utilityResponses = [];

    // Clear form
    document.getElementById('settlementName').value = '';
    document.getElementById('settlementDescription').value = '';
    document.getElementById('factionSelect').value = '';
    document.getElementById('utilityTypeSelect').value = '';
    document.getElementById('blessing1Select').value = '';
    document.getElementById('blessing2Select').value = '';
    document.getElementById('blessing3Select').value = '';
    document.getElementById('expeditionDescription').value = '';

    // Clear asset previews
    updateAssetPreview('settlement', null);
    updateAssetPreview('vendor', null);
    updateAssetPreview('utility', null);
    updateAssetPreview('expedition', null);
    updateAssetPreview('arena', null);

    // Update utility content
    updateUtilityContent();

    // Clear vendor/enchanter lists and responses
    renderVendorItems();
    renderEnchanterEffects();
    renderVendorResponses();
    renderUtilityResponses();

    // Update select
    const select = document.getElementById('settlementSelect');
    if (select) {
        select.value = '';
    }

    // Hide delete button for new settlements
    const deleteBtn = document.getElementById('deleteSettlementBtn');
    if (deleteBtn) {
        deleteBtn.style.display = 'none';
    }
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
            case 'utility':
                const utilityType = document.getElementById('utilityTypeSelect')?.value;
                title.textContent = utilityType ? `Select ${utilityType.charAt(0).toUpperCase() + utilityType.slice(1)} Asset` : 'Select Utility Asset';
                break;
            case 'expedition':
                title.textContent = 'Select Expedition Asset';
                break;
            case 'arena':
                title.textContent = 'Select Arena Asset';
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

    grid.innerHTML = settlementState.settlementAssets.map(asset => `
        <div class="settlement-asset-item ${asset.id === currentAssetId ? 'selected' : ''}" 
             data-asset-id="${asset.id}" onclick="selectAsset(${asset.id})">
            <img src="${asset.url}" alt="Asset ${asset.id}">
            <div class="asset-id">ID: ${asset.id}</div>
        </div>
    `).join('');

    if (settlementState.settlementAssets.length === 0) {
        grid.innerHTML = '<p style="color: #a0aec0; text-align: center; padding: 40px;">No assets found. Upload some!</p>';
    }
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
        case 'utility':
            areaId = 'utilityAssetArea';
            break;
    }

    const area = document.getElementById(areaId);
    return area ? parseInt(area.dataset.assetId) || null : null;
}

function selectAsset(assetId) {
    updateAssetPreview(settlementState.currentAssetTarget, assetId);
    closeAssetGallery();
}

async function uploadSettlementAsset(file) {
    if (!file.type.startsWith('image/')) {
        alert('Please select an image file');
        return;
    }

    try {
        const token = await getCurrentAccessToken();
        if (!token) {
            alert('Authentication required');
            return;
        }

        // Get next asset ID
        const nextAssetID = settlementState.settlementAssets.length > 0
            ? Math.max(...settlementState.settlementAssets.map(a => a.id)) + 1
            : 1;

        // Convert to WebP format
        console.log('Converting settlement asset to WebP format...');
        const webpBlob = await convertImageToWebP(file, 512, 512, 0.85);
        console.log('WebP converted size:', (webpBlob.size / 1024).toFixed(2) + 'KB');
        
        // Convert to base64
        const base64Data = await blobToBase64(webpBlob);

        const response = await fetch('http://localhost:8080/api/uploadSettlementAsset', {
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

        if (response.ok) {
            const result = await response.json();
            console.log('✅ Asset uploaded:', result);

            // Add to local assets
            settlementState.settlementAssets.push({
                id: result.assetID,
                url: result.icon
            });

            // Refresh gallery
            populateAssetGallery();

            // Auto-select the new asset
            selectAsset(result.assetID);
        } else {
            const error = await response.text();
            alert('Failed to upload asset: ' + error);
        }

    } catch (error) {
        console.error('Error uploading asset:', error);
        alert('Error uploading asset: ' + error.message);
    }
}

// Convert image to WebP format
function convertImageToWebP(file, width, height, quality) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        img.onload = () => {
            canvas.width = width;
            canvas.height = height;
            
            // Draw image scaled to fit
            ctx.drawImage(img, 0, 0, width, height);
            
            // Convert to WebP
            canvas.toBlob(
                (blob) => {
                    if (blob) {
                        resolve(blob);
                    } else {
                        reject(new Error('Failed to convert to WebP'));
                    }
                },
                'image/webp',
                quality
            );
        };
        
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = URL.createObjectURL(file);
    });
}

// Convert Blob to base64
function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

async function saveSettlement() {
    const name = document.getElementById('settlementName').value.trim();
    if (!name) {
        alert('Please enter a settlement name');
        return;
    }

    const utilityType = document.getElementById('utilityTypeSelect')?.value || '';
    const utilityAssetId = parseInt(document.getElementById('utilityAssetArea').dataset.assetId) || null;
    const vendorAssetId = parseInt(document.getElementById('vendorAssetArea').dataset.assetId) || null;
    const expeditionAssetId = parseInt(document.getElementById('expeditionAssetArea')?.dataset.assetId) || null;
    const arenaAssetId = parseInt(document.getElementById('arenaAssetArea')?.dataset.assetId) || null;
    const description = document.getElementById('settlementDescription')?.value.trim() || null;
    const expeditionDescription = document.getElementById('expeditionDescription')?.value.trim() || null;

    // Build vendor responses JSONB from dynamic entries
    const vendorResponsesObj = {};
    settlementState.vendorResponses.forEach(resp => {
        if (resp.type && resp.text) {
            if (!vendorResponsesObj[resp.type]) {
                vendorResponsesObj[resp.type] = [];
            }
            vendorResponsesObj[resp.type].push(resp.text);
        }
    });

    // Build utility responses JSONB from dynamic entries
    const utilityResponsesObj = {};
    settlementState.utilityResponses.forEach(resp => {
        if (resp.type && resp.text) {
            if (!utilityResponsesObj[resp.type]) {
                utilityResponsesObj[resp.type] = [];
            }
            utilityResponsesObj[resp.type].push(resp.text);
        }
    });

    const settlement = {
        settlement_name: name,
        description: description,
        faction: parseInt(document.getElementById('factionSelect').value) || null,
        settlement_asset_id: parseInt(document.getElementById('settlementAssetArea').dataset.assetId) || null,
        vendor_asset_id: vendorAssetId,
        // Set utility flags based on selected type
        blacksmith: utilityType === 'blacksmith',
        alchemist: utilityType === 'alchemist',
        enchanter: utilityType === 'enchanter',
        trainer: utilityType === 'trainer',
        church: utilityType === 'church',
        // Blessings (for church)
        blessing1: parseInt(document.getElementById('blessing1Select').value) || null,
        blessing2: parseInt(document.getElementById('blessing2Select').value) || null,
        blessing3: parseInt(document.getElementById('blessing3Select').value) || null,
        // Utility assets - set based on type
        blacksmith_asset_id: utilityType === 'blacksmith' ? utilityAssetId : null,
        alchemist_asset_id: utilityType === 'alchemist' ? utilityAssetId : null,
        enchanter_asset_id: utilityType === 'enchanter' ? utilityAssetId : null,
        trainer_asset_id: utilityType === 'trainer' ? utilityAssetId : null,
        church_asset_id: utilityType === 'church' ? utilityAssetId : null,
        // New expedition and arena fields
        expedition_asset_id: expeditionAssetId,
        expedition_description: expeditionDescription,
        arena_asset_id: arenaAssetId,
        // Vendor responses (JSONB with arrays per type)
        vendor_on_entered: vendorResponsesObj.on_entered?.length ? vendorResponsesObj.on_entered : null,
        vendor_on_sold: vendorResponsesObj.on_sold?.length ? vendorResponsesObj.on_sold : null,
        vendor_on_bought: vendorResponsesObj.on_bought?.length ? vendorResponsesObj.on_bought : null,
        // Utility responses (JSONB with arrays per type)
        utility_on_entered: utilityResponsesObj.on_entered?.length ? utilityResponsesObj.on_entered : null,
        utility_on_placed: utilityResponsesObj.on_placed?.length ? utilityResponsesObj.on_placed : null,
        utility_on_action: utilityResponsesObj.on_action?.length ? utilityResponsesObj.on_action : null,
        // Inventory arrays
        vendor_items: settlementState.vendorItems,
        enchanter_effects: settlementState.enchanterEffects
    };

    if (!settlementState.isNewSettlement && settlementState.selectedSettlementId) {
        settlement.settlement_id = settlementState.selectedSettlementId;
    }

    try {
        const token = await getCurrentAccessToken();
        if (!token) {
            alert('Authentication required');
            return;
        }

        const response = await fetch('http://localhost:8080/api/saveSettlement', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(settlement)
        });

        if (response.ok) {
            const result = await response.json();
            console.log('✅ Settlement saved:', result);

            // Reload settlements
            await loadSettlementDesignerData();

            // Select the saved settlement
            if (result.settlementId) {
                selectSettlement(result.settlementId);
            }

            alert('Settlement saved successfully!');
        } else {
            const error = await response.text();
            alert('Failed to save settlement: ' + error);
        }

    } catch (error) {
        console.error('Error saving settlement:', error);
        alert('Error saving settlement: ' + error.message);
    }
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

        const response = await fetch('http://localhost:8080/api/deleteSettlement', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ settlementId: settlementState.selectedSettlementId })
        });

        if (response.ok) {
            console.log('✅ Settlement deleted');

            // Reload settlements
            await loadSettlementDesignerData();

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

// Expose functions to window for HTML event handlers
window.loadSettlementDesignerData = loadSettlementDesignerData;
window.selectSettlement = selectSettlement;
window.selectAsset = selectAsset;
window.removeVendorItem = removeVendorItem;
window.removeEnchanterEffect = removeEnchanterEffect;
window.toggleVendorItemSelection = toggleVendorItemSelection;
window.closeItemSelectDialog = closeItemSelectDialog;
window.toggleEnchanterEffectSelection = toggleEnchanterEffectSelection;
window.closeEffectSelectDialog = closeEffectSelectDialog;
window.addVendorResponse = addVendorResponse;
window.addUtilityResponse = addUtilityResponse;
window.removeVendorResponse = removeVendorResponse;
window.removeUtilityResponse = removeUtilityResponse;
window.updateVendorResponse = updateVendorResponse;
window.updateUtilityResponse = updateUtilityResponse;
