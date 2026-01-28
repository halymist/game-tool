// Item Designer JavaScript

// Item type constants matching database enum
const ITEM_TYPES = [
    'head', 'chest', 'hands', 'feet', 'belt', 'legs', 'back',
    'amulet', 'weapon', 'hammer', 'gem', 'scroll', 'potion'
];

// Weapon types that show damage fields
const WEAPON_TYPES = ['weapon', 'hammer'];

// Current state
let allItems = [];
let allPendingItems = [];
let filteredItems = [];
let filteredPendingItems = [];
let selectedItemId = null;
let activeTab = 'game'; // 'game' or 'pending'
let isViewingPendingItem = false; // Whether form is showing a pending item (read-only)
let itemAssets = []; // Available item assets from S3
let selectedAssetId = null; // Currently selected asset ID
let selectedAssetIcon = null; // Currently selected asset icon URL

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Only initialize if we're on a page with the item form
    if (document.getElementById('itemForm')) {
        initItemDesigner();
    }
});

function initItemDesigner() {
    console.log('🎨 Initializing Item Designer...');
    
    // Load items from server
    loadItemsAndEffects();
    
    // Set up event listeners
    setupEventListeners();
    
    console.log('✅ Item Designer initialized');
}

function setupEventListeners() {
    // Tab buttons
    const gameTab = document.getElementById('gameItemsTab');
    const pendingTab = document.getElementById('pendingItemsTab');
    if (gameTab) {
        gameTab.addEventListener('click', () => switchTab('game'));
    }
    if (pendingTab) {
        pendingTab.addEventListener('click', () => switchTab('pending'));
    }
    
    // Search input
    const searchInput = document.getElementById('itemSearch');
    if (searchInput) {
        searchInput.addEventListener('input', filterItems);
    }
    
    // Type filter
    const typeFilter = document.getElementById('itemTypeFilter');
    if (typeFilter) {
        typeFilter.addEventListener('change', filterItems);
    }
    
    // New item button
    const newItemBtn = document.getElementById('newItemBtn');
    if (newItemBtn) {
        newItemBtn.addEventListener('click', createNewItem);
    }
    
    // Merge items button
    const mergeItemsBtn = document.getElementById('mergeItemsBtn');
    if (mergeItemsBtn) {
        mergeItemsBtn.addEventListener('click', mergeApprovedItems);
    }
    
    // Item asset gallery button
    const assetGalleryBtn = document.getElementById('itemAssetGalleryBtn');
    if (assetGalleryBtn) {
        assetGalleryBtn.addEventListener('click', toggleItemAssetGallery);
    }
    
    // Item asset gallery close button
    const assetGalleryClose = document.getElementById('itemAssetGalleryClose');
    if (assetGalleryClose) {
        assetGalleryClose.addEventListener('click', toggleItemAssetGallery);
    }
    
    // Close gallery when clicking overlay background
    const assetGalleryOverlay = document.getElementById('itemAssetGalleryOverlay');
    if (assetGalleryOverlay) {
        assetGalleryOverlay.addEventListener('click', (e) => {
            if (e.target === assetGalleryOverlay) {
                toggleItemAssetGallery();
            }
        });
    }
    
    // Upload new asset button
    const uploadNewBtn = document.getElementById('itemUploadNewBtn');
    if (uploadNewBtn) {
        uploadNewBtn.addEventListener('click', () => {
            document.getElementById('itemIconFile').click();
        });
    }
    
    // File input change handler
    const fileInput = document.getElementById('itemIconFile');
    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                handleItemIconUpload(file);
            }
        });
    }
    
    // Click on icon preview area to upload
    const iconUploadArea = document.getElementById('itemIconUploadArea');
    if (iconUploadArea) {
        iconUploadArea.addEventListener('click', () => {
            document.getElementById('itemIconFile').click();
        });
        
        // Drag and drop support
        iconUploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            iconUploadArea.classList.add('drag-over');
        });
        
        iconUploadArea.addEventListener('dragleave', () => {
            iconUploadArea.classList.remove('drag-over');
        });
        
        iconUploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            iconUploadArea.classList.remove('drag-over');
            const file = e.dataTransfer.files[0];
            if (file) {
                handleItemIconUpload(file);
            }
        });
    }
    
    // Cancel button
    const cancelBtn = document.getElementById('itemCancelBtn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', cancelEdit);
    }
    
    // Form submission
    const itemForm = document.getElementById('itemForm');
    if (itemForm) {
        itemForm.addEventListener('submit', saveItem);
    }
    
    // Item type change (show/hide weapon stats)
    const itemTypeSelect = document.getElementById('itemType');
    if (itemTypeSelect) {
        itemTypeSelect.addEventListener('change', toggleWeaponStats);
    }
}

async function loadItemsAndEffects() {
    console.log('Loading items and effects data...');
    
    try {
        // Load effects first
        console.log('🔴 About to call loadEffectsData()');
        await loadEffectsData();
        console.log('🔴 loadEffectsData() completed');
        populateEffectDropdown();
        
        // Then load items (this also loads pending items)
        console.log('🔴 About to call loadItemsData()');
        await loadItemsData();
        console.log('🔴 loadItemsData() completed');
        allItems = getItems();
        allPendingItems = getPendingItems();
        filteredItems = [...allItems];
        filteredPendingItems = [...allPendingItems];
        
        // Load item assets from S3
        await loadItemAssets();
        itemAssets = getItemAssets();
        createItemAssetGallery();
        
        renderItemList();
        renderPendingItemList();
        console.log('✅ Items data loaded:', allItems.length, 'items,', allPendingItems.length, 'pending,', itemAssets.length, 'assets');
        
    } catch (error) {
        console.error('Error loading items data:', error);
    }
}

function renderItemList() {
    const itemList = document.getElementById('itemList');
    if (!itemList) return;
    
    if (filteredItems.length === 0) {
        itemList.innerHTML = '<p class="loading-text">No items found</p>';
        return;
    }
    
    itemList.innerHTML = filteredItems.map(item => `
        <div class="item-list-item ${item.id === selectedItemId && activeTab === 'game' ? 'selected' : ''}" 
             data-id="${item.id}" onclick="selectItem(${item.id})">
            <div class="item-name">${escapeHtml(item.name)}</div>
            <div class="item-type">${item.type || 'Unknown'}</div>
        </div>
    `).join('');
}

function renderPendingItemList() {
    const pendingList = document.getElementById('pendingItemList');
    if (!pendingList) return;
    
    if (filteredPendingItems.length === 0) {
        pendingList.innerHTML = '<p class="loading-text">No pending items</p>';
        return;
    }
    
    pendingList.innerHTML = filteredPendingItems.map(item => `
        <div class="item-list-item pending-item ${item.toolingId === selectedItemId && activeTab === 'pending' ? 'selected' : ''}" 
             data-id="${item.toolingId}" onclick="selectPendingItem(${item.toolingId})">
            <div class="pending-item-header">
                <span class="item-name">${escapeHtml(item.name)}</span>
                <span class="item-action ${item.action}">${item.action}</span>
            </div>
            <div class="pending-item-footer">
                <span class="item-type">${item.type || 'Unknown'}</span>
                <div class="pending-item-actions" onclick="event.stopPropagation()">
                    <label class="approve-checkbox">
                        <input type="checkbox" ${item.approved ? 'checked' : ''} 
                               onchange="toggleApproval(${item.toolingId}, this.checked)">
                        <span>Approve</span>
                    </label>
                    <button class="btn-remove-pending" onclick="removePendingItem(${item.toolingId})" title="Remove pending item">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    `).join('');
}

function filterItems() {
    const searchTerm = document.getElementById('itemSearch')?.value.toLowerCase() || '';
    const typeFilter = document.getElementById('itemTypeFilter')?.value || '';
    
    filteredItems = allItems.filter(item => {
        const matchesSearch = item.name.toLowerCase().includes(searchTerm);
        const matchesType = !typeFilter || item.type === typeFilter;
        return matchesSearch && matchesType;
    });
    
    filteredPendingItems = allPendingItems.filter(item => {
        const matchesSearch = item.name.toLowerCase().includes(searchTerm);
        const matchesType = !typeFilter || item.type === typeFilter;
        return matchesSearch && matchesType;
    });
    
    renderItemList();
    renderPendingItemList();
}

async function toggleApproval(toolingId, approved) {
    console.log(`Toggling approval for tooling_id: ${toolingId}`);
    
    try {
        const token = await getCurrentAccessToken();
        if (!token) {
            alert('Authentication required');
            return;
        }
        
        const response = await fetch('http://localhost:8080/api/toggleApproveItem', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ toolingId: toolingId })
        });
        
        const result = await response.json();
        
        if (result.success) {
            console.log('✅ Approval toggled successfully');
            // Update local state
            const item = allPendingItems.find(i => i.toolingId === toolingId);
            if (item) {
                item.approved = !item.approved;
            }
        } else {
            alert('Error toggling approval: ' + (result.message || 'Unknown error'));
            // Revert checkbox
            const checkbox = document.querySelector(`input[onchange*="toggleApproval(${toolingId}"]`);
            if (checkbox) checkbox.checked = !approved;
        }
    } catch (error) {
        console.error('Error toggling approval:', error);
        alert('Error toggling approval: ' + error.message);
    }
}

async function removePendingItem(toolingId) {
    const item = allPendingItems.find(i => i.toolingId === toolingId);
    const itemName = item ? item.name : `ID ${toolingId}`;
    
    if (!confirm(`Remove pending item "${itemName}"? This cannot be undone.`)) {
        return;
    }
    
    console.log(`Removing pending item: ${toolingId}`);
    
    try {
        const token = await getCurrentAccessToken();
        if (!token) {
            alert('Authentication required');
            return;
        }
        
        const response = await fetch('http://localhost:8080/api/removePendingItem', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ toolingId: toolingId })
        });
        
        const result = await response.json();
        
        if (result.success) {
            console.log('✅ Pending item removed successfully');
            // Remove from local state
            allPendingItems = allPendingItems.filter(i => i.toolingId !== toolingId);
            filteredPendingItems = filteredPendingItems.filter(i => i.toolingId !== toolingId);
            
            // Clear form if this item was selected
            if (selectedItemId === toolingId && isViewingPendingItem) {
                clearForm();
            }
            
            renderPendingItemList();
        } else {
            alert('Error removing pending item: ' + (result.message || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error removing pending item:', error);
        alert('Error removing pending item: ' + error.message);
    }
}

async function mergeApprovedItems() {
    // Check if there are any approved items
    const approvedCount = allPendingItems.filter(i => i.approved).length;
    
    if (approvedCount === 0) {
        alert('No approved items to merge. Please approve items first.');
        return;
    }
    
    if (!confirm(`Merge ${approvedCount} approved item(s) into the game database?`)) {
        return;
    }
    
    console.log('Merging approved items...');
    
    try {
        const token = await getCurrentAccessToken();
        if (!token) {
            alert('Authentication required');
            return;
        }
        
        const response = await fetch('http://localhost:8080/api/mergeItems', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert('✅ Items merged successfully!');
            // Reload data to reflect changes
            await loadItemsAndEffects();
        } else {
            alert('Error merging items: ' + (result.message || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error merging items:', error);
        alert('Error merging items: ' + error.message);
    }
}

function switchTab(tab) {
    activeTab = tab;
    
    // Update tab buttons
    const gameTab = document.getElementById('gameItemsTab');
    const pendingTab = document.getElementById('pendingItemsTab');
    if (gameTab) gameTab.classList.toggle('active', tab === 'game');
    if (pendingTab) pendingTab.classList.toggle('active', tab === 'pending');
    
    // Show/hide lists
    const itemList = document.getElementById('itemList');
    const pendingList = document.getElementById('pendingItemList');
    if (itemList) itemList.style.display = tab === 'game' ? 'block' : 'none';
    if (pendingList) pendingList.style.display = tab === 'pending' ? 'block' : 'none';
    
    // Show/hide buttons based on tab
    const newItemBtn = document.getElementById('newItemBtn');
    const mergeItemsBtn = document.getElementById('mergeItemsBtn');
    if (newItemBtn) newItemBtn.style.display = tab === 'game' ? 'block' : 'none';
    if (mergeItemsBtn) mergeItemsBtn.style.display = tab === 'pending' ? 'block' : 'none';
    
    // Clear selection when switching tabs
    selectedItemId = null;
    isViewingPendingItem = false;
    setFormLocked(false);
    clearForm();
    document.getElementById('itemEditorTitle').textContent = 'Create New Item';
}

function selectItem(itemId) {
    activeTab = 'game';
    selectedItemId = itemId;
    isViewingPendingItem = false;
    const item = allItems.find(i => i.id === itemId);
    
    if (item) {
        populateForm(item);
        setFormLocked(false);
        document.getElementById('itemEditorTitle').textContent = 'Edit Item';
    }
    
    renderItemList();
    renderPendingItemList();
}

function selectPendingItem(toolingId) {
    activeTab = 'pending';
    selectedItemId = toolingId;
    isViewingPendingItem = true;
    const item = allPendingItems.find(i => i.toolingId === toolingId);
    
    if (item) {
        populateFormFromPending(item);
        setFormLocked(true);
        document.getElementById('itemEditorTitle').textContent = `Pending: ${item.action.toUpperCase()}`;
    }
    
    renderItemList();
    renderPendingItemList();
}

function populateFormFromPending(item) {
    // Pending items have same structure as regular items
    document.getElementById('itemId').value = item.gameId || '';
    document.getElementById('itemName').value = item.name || '';
    document.getElementById('itemType').value = item.type || '';
    document.getElementById('itemAssetID').value = item.assetID || 1;
    document.getElementById('itemSilver').value = item.silver || 10;
    
    // Stats
    document.getElementById('itemStrength').value = item.strength || '';
    document.getElementById('itemStamina').value = item.stamina || '';
    document.getElementById('itemAgility').value = item.agility || '';
    document.getElementById('itemLuck').value = item.luck || '';
    document.getElementById('itemArmor').value = item.armor || '';
    document.getElementById('itemSocket').checked = item.socket || false;
    
    // Weapon stats
    document.getElementById('itemMinDamage').value = item.minDamage || '';
    document.getElementById('itemMaxDamage').value = item.maxDamage || '';
    
    // Effect
    document.getElementById('itemEffect').value = item.effectID || '';
    document.getElementById('itemEffectFactor').value = item.effectFactor || '';
    
    // Update icon preview by assetID
    updateIconPreview(item.assetID);
    
    // Toggle weapon stats visibility
    toggleWeaponStats();
}

function setFormLocked(locked) {
    const form = document.getElementById('itemForm');
    if (!form) return;
    
    // Get all inputs, selects, textareas in the form
    const inputs = form.querySelectorAll('input, select, textarea');
    inputs.forEach(input => {
        input.disabled = locked;
    });
    
    // Hide/show save button
    const saveBtn = form.querySelector('.btn-save-item');
    if (saveBtn) {
        saveBtn.style.display = locked ? 'none' : 'block';
    }
    
    // Update form visual state
    form.classList.toggle('form-locked', locked);
}

function populateForm(item) {
    document.getElementById('itemId').value = item.id || '';
    document.getElementById('itemName').value = item.name || '';
    document.getElementById('itemType').value = item.type || '';
    document.getElementById('itemAssetID').value = item.assetID || 1;
    document.getElementById('itemSilver').value = item.silver || 10;
    
    // Stats
    document.getElementById('itemStrength').value = item.strength || '';
    document.getElementById('itemStamina').value = item.stamina || '';
    document.getElementById('itemAgility').value = item.agility || '';
    document.getElementById('itemLuck').value = item.luck || '';
    document.getElementById('itemArmor').value = item.armor || '';
    document.getElementById('itemSocket').checked = item.socket || false;
    
    // Weapon stats
    document.getElementById('itemMinDamage').value = item.minDamage || '';
    document.getElementById('itemMaxDamage').value = item.maxDamage || '';
    
    // Effect
    document.getElementById('itemEffect').value = item.effectID || '';
    document.getElementById('itemEffectFactor').value = item.effectFactor || '';
    
    // Update icon preview - use item.icon if available, otherwise look up by assetID
    if (item.icon) {
        const preview = document.getElementById('itemIconPreview');
        const placeholder = document.getElementById('itemIconPlaceholder');
        const assetIdDisplay = document.getElementById('itemAssetIDDisplay');
        if (preview) {
            preview.src = item.icon;
            preview.style.display = 'block';
        }
        if (placeholder) placeholder.style.display = 'none';
        if (assetIdDisplay) assetIdDisplay.textContent = `Asset ID: ${item.assetID}`;
    } else {
        updateIconPreview(item.assetID);
    }
    
    // Toggle weapon stats visibility
    toggleWeaponStats();
}

function createNewItem() {
    selectedItemId = null;
    isViewingPendingItem = false;
    setFormLocked(false);
    clearForm();
    document.getElementById('itemEditorTitle').textContent = 'Create New Item';
    renderItemList();
    renderPendingItemList();
}

function clearForm() {
    document.getElementById('itemId').value = '';
    document.getElementById('itemName').value = '';
    document.getElementById('itemType').value = '';
    document.getElementById('itemAssetID').value = '1';
    document.getElementById('itemSilver').value = '10';
    
    // Stats
    document.getElementById('itemStrength').value = '';
    document.getElementById('itemStamina').value = '';
    document.getElementById('itemAgility').value = '';
    document.getElementById('itemLuck').value = '';
    document.getElementById('itemArmor').value = '';
    document.getElementById('itemSocket').checked = false;
    
    // Weapon stats
    document.getElementById('itemMinDamage').value = '';
    document.getElementById('itemMaxDamage').value = '';
    
    // Effect
    document.getElementById('itemEffect').value = '';
    document.getElementById('itemEffectFactor').value = '';
    
    // Clear icon preview
    clearIconPreview();
    
    // Hide weapon stats
    toggleWeaponStats();
}

function cancelEdit() {
    selectedItemId = null;
    isViewingPendingItem = false;
    setFormLocked(false);
    clearForm();
    document.getElementById('itemEditorTitle').textContent = 'Create New Item';
    renderItemList();
    renderPendingItemList();
}

function toggleWeaponStats() {
    const itemType = document.getElementById('itemType')?.value || '';
    const weaponSection = document.getElementById('weaponStatsSection');
    
    if (weaponSection) {
        if (WEAPON_TYPES.includes(itemType)) {
            weaponSection.style.display = 'block';
        } else {
            weaponSection.style.display = 'none';
        }
    }
    
    // Also update effect dropdown based on type
    populateEffectDropdown();
}

function populateEffectDropdown() {
    const effectSelect = document.getElementById('itemEffect');
    if (!effectSelect) return;
    
    const effects = getEffects();
    const selectedType = document.getElementById('itemType')?.value || '';
    
    // Save current selection
    const currentValue = effectSelect.value;
    
    console.log('Populating item effect dropdown with', effects.length, 'effects for type:', selectedType);
    
    effectSelect.innerHTML = '<option value="">-- No Effect --</option>';
    
    // Filter effects: slot must match item type OR slot is null (applicable to all)
    effects.forEach(effect => {
        // Include effect if:
        // 1. effect.slot is null/undefined (applies to all item types)
        // 2. effect.slot matches the selected item type
        if (!effect.slot || effect.slot === selectedType) {
            const option = document.createElement('option');
            option.value = effect.id;
            option.textContent = effect.name + (effect.slot ? ` (${effect.slot})` : ' (all)');
            effectSelect.appendChild(option);
        }
    });
    
    // Restore selection if still valid
    if (currentValue) {
        effectSelect.value = currentValue;
    }
}

async function saveItem(e) {
    e.preventDefault();
    
    const itemId = document.getElementById('itemId').value;
    const isUpdate = !!itemId;
    
    // Gather form data
    const itemData = {
        id: itemId ? parseInt(itemId) : null,
        name: document.getElementById('itemName').value,
        type: document.getElementById('itemType').value,
        assetID: parseInt(document.getElementById('itemAssetID').value) || 1,
        silver: parseInt(document.getElementById('itemSilver').value) || 10,
        strength: parseIntOrNull(document.getElementById('itemStrength').value),
        stamina: parseIntOrNull(document.getElementById('itemStamina').value),
        agility: parseIntOrNull(document.getElementById('itemAgility').value),
        luck: parseIntOrNull(document.getElementById('itemLuck').value),
        armor: parseIntOrNull(document.getElementById('itemArmor').value),
        socket: document.getElementById('itemSocket').checked,
        effectID: parseIntOrNull(document.getElementById('itemEffect').value),
        effectFactor: parseIntOrNull(document.getElementById('itemEffectFactor').value),
        minDamage: parseIntOrNull(document.getElementById('itemMinDamage').value),
        maxDamage: parseIntOrNull(document.getElementById('itemMaxDamage').value)
    };
    
    console.log('Saving item:', itemData);
    
    try {
        const token = await getCurrentAccessToken();
        if (!token) {
            alert('Authentication required');
            return;
        }
        
        const response = await fetch('http://localhost:8080/api/createItem', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(itemData)
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert(isUpdate ? 'Item updated successfully!' : 'Item created successfully!');
            loadItemsAndEffects();
            clearForm();
            document.getElementById('itemEditorTitle').textContent = 'Create New Item';
            selectedItemId = null;
        } else {
            alert('Error saving item: ' + (result.message || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error saving item:', error);
        alert('Error saving item: ' + error.message);
    }
}

// Helper functions
function parseIntOrNull(value) {
    if (value === '' || value === null || value === undefined) {
        return null;
    }
    const parsed = parseInt(value);
    return isNaN(parsed) ? null : parsed;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// === ITEM ASSET GALLERY FUNCTIONS ===

/**
 * Create the item asset gallery with available assets from S3
 */
function createItemAssetGallery() {
    if (itemAssets.length === 0) {
        console.log('No item assets available for gallery');
        return;
    }
    
    console.log('Creating item asset gallery with', itemAssets.length, 'assets');
    
    const assetGrid = document.getElementById('itemAssetGrid');
    if (!assetGrid) return;
    
    assetGrid.innerHTML = itemAssets.map(asset => `
        <div class="item-asset-item" data-asset-id="${asset.assetID}" onclick="selectItemAsset(${asset.assetID}, '${asset.icon}')">
            <img src="${asset.icon}" alt="Asset ${asset.assetID}" class="item-asset-thumbnail">
            <div class="item-asset-label">ID: ${asset.assetID}</div>
        </div>
    `).join('');
}

/**
 * Toggle the item asset gallery overlay visibility
 */
function toggleItemAssetGallery() {
    const overlay = document.getElementById('itemAssetGalleryOverlay');
    if (overlay) {
        overlay.classList.toggle('hidden');
    }
}

/**
 * Select an asset from the gallery
 */
function selectItemAsset(assetId, iconUrl) {
    console.log('Selected asset:', assetId);
    
    selectedAssetId = assetId;
    selectedAssetIcon = iconUrl;
    
    // Update hidden field
    document.getElementById('itemAssetID').value = assetId;
    
    // Update preview
    const preview = document.getElementById('itemIconPreview');
    const placeholder = document.getElementById('itemIconPlaceholder');
    const assetIdDisplay = document.getElementById('itemAssetIDDisplay');
    
    if (preview) {
        preview.src = iconUrl;
        preview.style.display = 'block';
    }
    if (placeholder) {
        placeholder.style.display = 'none';
    }
    if (assetIdDisplay) {
        assetIdDisplay.textContent = `Asset ID: ${assetId}`;
    }
    
    // Close gallery
    toggleItemAssetGallery();
}

/**
 * Update the icon preview based on current asset ID
 */
function updateIconPreview(assetId) {
    const asset = itemAssets.find(a => a.assetID === assetId);
    const preview = document.getElementById('itemIconPreview');
    const placeholder = document.getElementById('itemIconPlaceholder');
    const assetIdDisplay = document.getElementById('itemAssetIDDisplay');
    
    if (asset) {
        if (preview) {
            preview.src = asset.icon;
            preview.style.display = 'block';
        }
        if (placeholder) {
            placeholder.style.display = 'none';
        }
        if (assetIdDisplay) {
            assetIdDisplay.textContent = `Asset ID: ${assetId}`;
        }
    } else {
        if (preview) {
            preview.src = '';
            preview.style.display = 'none';
        }
        if (placeholder) {
            placeholder.style.display = 'block';
        }
        if (assetIdDisplay) {
            assetIdDisplay.textContent = assetId ? `Asset ID: ${assetId} (not found)` : 'Asset ID: None';
        }
    }
}

/**
 * Clear the icon preview
 */
function clearIconPreview() {
    selectedAssetId = null;
    selectedAssetIcon = null;
    
    const preview = document.getElementById('itemIconPreview');
    const placeholder = document.getElementById('itemIconPlaceholder');
    const assetIdDisplay = document.getElementById('itemAssetIDDisplay');
    
    if (preview) {
        preview.src = '';
        preview.style.display = 'none';
    }
    if (placeholder) {
        placeholder.style.display = 'block';
    }
    if (assetIdDisplay) {
        assetIdDisplay.textContent = 'Asset ID: None';
    }
}

/**
 * Handle item icon upload from file input
 */
async function handleItemIconUpload(file) {
    // Validate file type
    if (!file.type.startsWith('image/')) {
        alert('Please upload an image file');
        return;
    }

    // Validate file size (max 10MB for original file)
    if (file.size > 10 * 1024 * 1024) {
        alert('File size should be less than 10MB');
        return;
    }

    try {
        console.log('Converting item icon to WebP format...');
        console.log('Original file:', file.name, 'Size:', (file.size / 1024).toFixed(2) + 'KB');

        // Convert to WebP 128x128 with 80% quality (item icons are typically smaller)
        const webpBlob = await convertImageToWebP(file, 128, 128, 0.8);
        console.log('WebP converted size:', (webpBlob.size / 1024).toFixed(2) + 'KB');
        
        // Convert WebP blob to base64 for upload
        const base64Data = await blobToBase64(webpBlob);
        
        // Get next available asset ID
        const nextAssetID = getNextAvailableItemAssetID();
        console.log('Next available asset ID:', nextAssetID);
        
        // Show preview immediately
        const preview = document.getElementById('itemIconPreview');
        const placeholder = document.getElementById('itemIconPlaceholder');
        const assetIdDisplay = document.getElementById('itemAssetIDDisplay');
        
        if (preview) {
            preview.src = base64Data;
            preview.style.display = 'block';
        }
        if (placeholder) {
            placeholder.style.display = 'none';
        }
        if (assetIdDisplay) {
            assetIdDisplay.textContent = `Uploading... (Asset ID: ${nextAssetID})`;
        }
        
        // Upload to S3
        const token = await getCurrentAccessToken();
        if (!token) {
            alert('Authentication required');
            return;
        }
        
        const response = await fetch('http://localhost:8080/api/uploadItemAsset', {
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
            console.log('✅ Item asset uploaded successfully:', result);
            
            // Update state
            selectedAssetId = result.assetID;
            selectedAssetIcon = result.icon || base64Data;
            
            // Update hidden field
            document.getElementById('itemAssetID').value = result.assetID;
            
            // Update display
            if (assetIdDisplay) {
                assetIdDisplay.textContent = `Asset ID: ${result.assetID}`;
            }
            
            // Add to local assets list
            itemAssets.push({
                assetID: result.assetID,
                name: result.assetID.toString(),
                icon: result.icon || base64Data
            });
            
            // Refresh gallery
            createItemAssetGallery();
            
            alert('Item icon uploaded successfully!');
        } else {
            alert('Error uploading icon: ' + (result.message || 'Unknown error'));
            clearIconPreview();
        }
        
    } catch (error) {
        console.error('Error uploading item icon:', error);
        alert('Failed to upload icon. Please try again.');
        clearIconPreview();
    }
}

/**
 * Get next available asset ID for items
 */
function getNextAvailableItemAssetID() {
    if (!itemAssets || itemAssets.length === 0) {
        return 1;
    }
    
    let maxID = 0;
    for (const asset of itemAssets) {
        if (asset.assetID > maxID) {
            maxID = asset.assetID;
        }
    }
    
    return maxID + 1;
}

/**
 * Convert an image file to WebP format with specified dimensions
 */
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

/**
 * Convert a Blob to base64 string
 */
function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// Export for global access
window.itemDesigner = {
    loadItemsAndEffects: loadItemsAndEffects
};

// Expose functions used in onclick handlers
window.selectItem = selectItem;
window.selectPendingItem = selectPendingItem;
window.toggleApproval = toggleApproval;
window.selectItemAsset = selectItemAsset;

console.log('📦 Item Designer script loaded');
