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
let filteredItems = [];
let selectedItemId = null;

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
        await loadEffectsData();
        populateEffectDropdown();
        
        // Then load items
        await loadItemsData();
        allItems = getItems();
        filteredItems = [...allItems];
        
        renderItemList();
        console.log('✅ Items data loaded:', allItems.length, 'items');
        
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
        <div class="item-list-item ${item.id === selectedItemId ? 'selected' : ''}" 
             data-id="${item.id}" onclick="selectItem(${item.id})">
            <div class="item-name">${escapeHtml(item.name)}</div>
            <div class="item-type">${item.type || 'Unknown'}</div>
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
    
    renderItemList();
}

function selectItem(itemId) {
    selectedItemId = itemId;
    const item = allItems.find(i => i.id === itemId);
    
    if (item) {
        populateForm(item);
        document.getElementById('itemEditorTitle').textContent = 'Edit Item';
    }
    
    renderItemList();
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
    
    // Toggle weapon stats visibility
    toggleWeaponStats();
}

function createNewItem() {
    selectedItemId = null;
    clearForm();
    document.getElementById('itemEditorTitle').textContent = 'Create New Item';
    renderItemList();
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
    
    // Hide weapon stats
    toggleWeaponStats();
}

function cancelEdit() {
    selectedItemId = null;
    clearForm();
    document.getElementById('itemEditorTitle').textContent = 'Create New Item';
    renderItemList();
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
}

function populateEffectDropdown() {
    const effectSelect = document.getElementById('itemEffect');
    if (!effectSelect) return;
    
    const effects = getEffects();
    console.log('Populating item effect dropdown with', effects.length, 'effects');
    
    effectSelect.innerHTML = '<option value="">-- No Effect --</option>';
    
    effects.forEach(effect => {
        const option = document.createElement('option');
        option.value = effect.id;
        option.textContent = effect.name;
        effectSelect.appendChild(option);
    });
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

// Export for global access
window.itemDesigner = {
    loadItemsAndEffects: loadItemsAndEffects
};

console.log('📦 Item Designer script loaded');
