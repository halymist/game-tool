// Settlement Designer JavaScript

// Settlement state
let settlementState = {
    settlements: [],
    selectedSettlementId: null,
    isNewSettlement: false,
    settlementAssets: [],
    currentAssetTarget: null, // 'settlement', 'vendor', or 'utility'
    blessings: [], // perks for church blessings
    items: [], // items for vendor
    effects: [], // effects for enchanter
    vendorItems: [], // current vendor's items
    enchanterEffects: [] // current enchanter's effects
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
            if (e.target.value === 'new') {
                createNewSettlement();
            } else if (e.target.value) {
                selectSettlement(parseInt(e.target.value));
            }
        });
    }

    // New settlement button
    const newSettlementBtn = document.getElementById('newSettlementBtn');
    if (newSettlementBtn) {
        newSettlementBtn.addEventListener('click', createNewSettlement);
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

    try {
        const token = await getCurrentAccessToken();
        if (!token) {
            console.error('Authentication required');
            return;
        }

        // Load settlements
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

        // Load settlement assets from S3
        await loadSettlementAssets();

        // Load perks for blessings dropdown
        await loadBlessingsData();

        // Load items for vendor
        await loadSettlementItemsData();

        // Load effects for enchanter
        await loadSettlementEffectsData();

        // Populate UI
        populateSettlementSelect();
        populateBlessingDropdowns();

        // If there are settlements, select the first one
        if (settlementState.settlements.length > 0) {
            selectSettlement(settlementState.settlements[0].settlement_id);
        } else {
            showEmptyState();
        }

    } catch (error) {
        console.error('Error loading settlement data:', error);
    }
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
    if (typeof getItems === 'function') {
        settlementState.items = getItems() || [];
    } else {
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
                console.log('✅ Loaded', settlementState.items.length, 'items');
            }
        } catch (error) {
            console.error('Error loading items:', error);
        }
    }
}

async function loadSettlementEffectsData() {
    if (typeof getEffects === 'function') {
        settlementState.effects = getEffects() || [];
    } else {
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
                console.log('✅ Loaded', settlementState.effects.length, 'effects');
            }
        } catch (error) {
            console.error('Error loading effects:', error);
        }
    }
}

function populateSettlementSelect() {
    const select = document.getElementById('settlementSelect');
    if (!select) return;

    select.innerHTML = '<option value="">-- Select Settlement --</option>';
    
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

    // Faction
    const factionSelect = document.getElementById('factionSelect');
    if (factionSelect) {
        factionSelect.value = settlement.faction || '';
    }

    // Settlement asset
    updateAssetPreview('settlement', settlement.settlement_asset_id);

    // Vendor asset - for now we'll need to track this separately
    // Using a generic vendor asset approach
    updateAssetPreview('vendor', null); // Will need vendor_asset_id in DB

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

    // Update utility asset
    updateAssetPreview('utility', utilityAssetId);

    // Update utility content visibility
    updateUtilityContent();

    // Blessings (for church)
    const blessing1 = document.getElementById('blessing1Select');
    const blessing2 = document.getElementById('blessing2Select');
    const blessing3 = document.getElementById('blessing3Select');
    if (blessing1) blessing1.value = settlement.blessing1 || '';
    if (blessing2) blessing2.value = settlement.blessing2 || '';
    if (blessing3) blessing3.value = settlement.blessing3 || '';

    // Clear vendor items and enchanter effects for now
    // These will need additional DB columns/tables
    settlementState.vendorItems = [];
    settlementState.enchanterEffects = [];
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
        list.innerHTML = '<div class="effect-row" style="justify-content: center; color: #4a5568; font-style: italic;">No effects added</div>';
        return;
    }

    list.innerHTML = settlementState.enchanterEffects.map((effectId, index) => {
        const effect = settlementState.effects.find(e => (e.effect_id || e.id) === effectId);
        const name = effect ? (effect.effect_name || effect.name) : `Effect ${effectId}`;
        return `
            <div class="effect-row">
                <span>${escapeSettlementHtml(name)}</span>
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
    const effectId = prompt('Select an effect to add (enter effect ID):\n\nAvailable effects:\n' + 
        settlementState.effects.slice(0, 20).map(e => `${e.effect_id || e.id}: ${e.effect_name || e.name}`).join('\n'));

    if (effectId) {
        const id = parseInt(effectId);
        if (!isNaN(id) && !settlementState.enchanterEffects.includes(id)) {
            settlementState.enchanterEffects.push(id);
            renderEnchanterEffects();
        }
    }
}

function removeVendorItem(index) {
    settlementState.vendorItems.splice(index, 1);
    renderVendorItems();
}

function removeEnchanterEffect(index) {
    settlementState.enchanterEffects.splice(index, 1);
    renderEnchanterEffects();
}

function createNewSettlement() {
    settlementState.selectedSettlementId = null;
    settlementState.isNewSettlement = true;
    settlementState.vendorItems = [];
    settlementState.enchanterEffects = [];

    // Clear form
    document.getElementById('settlementName').value = '';
    document.getElementById('factionSelect').value = '';
    document.getElementById('utilityTypeSelect').value = '';
    document.getElementById('blessing1Select').value = '';
    document.getElementById('blessing2Select').value = '';
    document.getElementById('blessing3Select').value = '';

    // Clear asset previews
    updateAssetPreview('settlement', null);
    updateAssetPreview('vendor', null);
    updateAssetPreview('utility', null);

    // Update utility content
    updateUtilityContent();

    // Clear vendor/enchanter lists
    renderVendorItems();
    renderEnchanterEffects();

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

        // Convert to base64
        const reader = new FileReader();
        reader.onload = async (e) => {
            const base64Data = e.target.result.split(',')[1];

            const response = await fetch('http://localhost:8080/api/uploadSettlementAsset', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    filename: file.name,
                    data: base64Data,
                    contentType: file.type
                })
            });

            if (response.ok) {
                const result = await response.json();
                console.log('✅ Asset uploaded:', result);

                // Add to local assets
                settlementState.settlementAssets.push({
                    id: result.assetId,
                    url: result.url
                });

                // Refresh gallery
                populateAssetGallery();

                // Auto-select the new asset
                selectAsset(result.assetId);
            } else {
                const error = await response.text();
                alert('Failed to upload asset: ' + error);
            }
        };
        reader.readAsDataURL(file);

    } catch (error) {
        console.error('Error uploading asset:', error);
        alert('Error uploading asset: ' + error.message);
    }
}

async function saveSettlement() {
    const name = document.getElementById('settlementName').value.trim();
    if (!name) {
        alert('Please enter a settlement name');
        return;
    }

    const utilityType = document.getElementById('utilityTypeSelect')?.value || '';
    const utilityAssetId = parseInt(document.getElementById('utilityAssetArea').dataset.assetId) || null;

    const settlement = {
        settlement_name: name,
        faction: parseInt(document.getElementById('factionSelect').value) || null,
        settlement_asset_id: parseInt(document.getElementById('settlementAssetArea').dataset.assetId) || null,
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
        church_asset_id: utilityType === 'church' ? utilityAssetId : null
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
