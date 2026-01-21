// Item Designer JavaScript

// === ITEM TYPES ===
const ITEM_TYPES = [
    { value: 'weapon', label: '⚔️ Weapon', hasStats: ['strength', 'agility'], hasDamage: true },
    { value: 'armor', label: '🛡️ Armor', hasStats: ['stamina', 'armor'], hasDamage: false },
    { value: 'accessory', label: '💍 Accessory', hasStats: ['luck', 'agility'], hasDamage: false },
    { value: 'consumable', label: '🧪 Consumable', hasStats: [], hasDamage: false },
    { value: 'material', label: '📦 Material', hasStats: [], hasDamage: false }
];

// === GLOBAL VARIABLES ===
let currentItemIcon = null;
let currentItemAssetID = 0;
let currentItemID = null;
let loadedItems = [];
let currentItemData = null;

// === ITEM DATA STRUCTURE ===
const ItemData = {
    create: () => ({
        id: null,
        name: "",
        assetID: 0,
        type: 1,  // smallint type in DB
        strength: null,
        stamina: null,
        agility: null,
        luck: null,
        armor: null,
        effectID: null,
        effectFactor: null,
        socket: false,
        silver: 10,
        minDamage: null,
        maxDamage: null,
        icon: null
    }),

    loadFromForm: () => {
        const item = ItemData.create();
        
        item.id = currentItemID;
        item.name = document.getElementById('itemName')?.value || '';
        item.type = parseInt(document.getElementById('itemType')?.value) || 1;
        
        // Stats
        item.strength = getNumberOrNull('itemStrength');
        item.stamina = getNumberOrNull('itemStamina');
        item.agility = getNumberOrNull('itemAgility');
        item.luck = getNumberOrNull('itemLuck');
        item.armor = getNumberOrNull('itemArmor');
        
        // Effect
        const effectSelect = document.getElementById('itemEffect');
        item.effectID = effectSelect?.value ? parseInt(effectSelect.value) : null;
        item.effectFactor = getNumberOrNull('itemEffectFactor');
        
        // Other
        item.socket = document.getElementById('itemSocket')?.checked || false;
        item.silver = parseInt(document.getElementById('itemSilver')?.value) || 10;
        item.minDamage = getNumberOrNull('itemMinDamage');
        item.maxDamage = getNumberOrNull('itemMaxDamage');
        
        // Icon
        item.icon = currentItemIcon;
        item.assetID = currentItemAssetID;
        
        console.log('=== LOADED ITEM DATA FROM FORM ===');
        console.log('Item:', item);
        
        return item;
    }
};

// Helper function to get number or null
function getNumberOrNull(elementId) {
    const element = document.getElementById(elementId);
    if (!element || element.value === '' || element.value === null) {
        return null;
    }
    const num = parseInt(element.value);
    return isNaN(num) ? null : num;
}

// === INITIALIZATION ===
function initItemDesigner() {
    console.log('🎨 Initializing Item Designer...');
    
    setupItemFormHandlers();
    setupItemIconUpload();
    setupItemNameHandler();
    setupItemTypeHandler();
    
    console.log('✅ Item Designer initialized');
}

// === FORM HANDLERS ===
function setupItemFormHandlers() {
    const saveBtn = document.getElementById('saveItemBtn');
    const resetBtn = document.getElementById('resetItemBtn');
    
    if (saveBtn) {
        saveBtn.addEventListener('click', (e) => {
            e.preventDefault();
            saveItem();
        });
    }
    
    if (resetBtn) {
        resetBtn.addEventListener('click', (e) => {
            e.preventDefault();
            resetItemForm();
        });
    }
}

function setupItemTypeHandler() {
    const typeSelect = document.getElementById('itemType');
    if (typeSelect) {
        typeSelect.addEventListener('change', (e) => {
            updateFormForItemType(e.target.value);
        });
    }
}

function updateFormForItemType(typeValue) {
    const damageSection = document.getElementById('itemDamageSection');
    
    // Show damage section only for weapons (type 1)
    if (damageSection) {
        if (parseInt(typeValue) === 1) {
            damageSection.style.display = 'block';
        } else {
            damageSection.style.display = 'none';
        }
    }
}

// === ICON UPLOAD ===
function setupItemIconUpload() {
    const uploadArea = document.getElementById('itemIconUploadArea');
    const fileInput = document.getElementById('itemIconFile');
    
    if (!uploadArea || !fileInput) {
        console.warn('Item icon upload elements not found');
        return;
    }
    
    uploadArea.addEventListener('click', () => {
        fileInput.click();
    });
    
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            handleItemFileUpload(file);
        }
    });
    
    // Drag and drop
    setupDragAndDrop(uploadArea, handleItemFileUpload);
}

async function handleItemFileUpload(file) {
    if (!file.type.startsWith('image/')) {
        alert('Please upload an image file');
        return;
    }
    
    if (file.size > 10 * 1024 * 1024) {
        alert('File size should be less than 10MB');
        return;
    }
    
    try {
        console.log('Converting item image to WebP format...');
        const webpBlob = await convertImageToWebP(file, 128, 128, 0.8);
        const base64Data = await blobToBase64(webpBlob);
        
        currentItemIcon = base64Data;
        currentItemAssetID = 0;
        
        const iconPreview = document.getElementById('itemIconPreview');
        if (iconPreview) {
            iconPreview.innerHTML = `<img src="${base64Data}" alt="Item Icon" style="width: 100%; height: 100%; object-fit: contain;">`;
        }
        
        console.log('✅ Item image ready for upload');
    } catch (error) {
        console.error('Error converting image:', error);
        alert('Failed to convert image. Please try a different image.');
    }
}

// === NAME HANDLER (with autocomplete) ===
function setupItemNameHandler() {
    const nameInput = document.getElementById('itemName');
    if (!nameInput) return;
    
    createItemCustomDropdown(nameInput);
    
    nameInput.addEventListener('input', (e) => {
        const inputValue = e.target.value;
        updateItemCustomDropdown(nameInput, inputValue);
        
        const items = getItems();
        const existingItem = items.find(item => item.name === inputValue);
        
        if (existingItem) {
            selectExistingItem(existingItem);
        }
    });
    
    nameInput.addEventListener('focus', () => {
        showItemCustomDropdown(nameInput);
    });
}

function createItemCustomDropdown(input) {
    // Remove any existing dropdown
    const existing = document.querySelector('.item-custom-dropdown');
    if (existing) existing.remove();
    
    const dropdown = document.createElement('div');
    dropdown.className = 'item-custom-dropdown custom-dropdown';
    dropdown.style.display = 'none';
    
    input.parentElement.style.position = 'relative';
    input.parentElement.appendChild(dropdown);
    
    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.style.display = 'none';
        }
    });
}

function updateItemCustomDropdown(input, filterValue) {
    const dropdown = input.parentElement.querySelector('.item-custom-dropdown');
    if (!dropdown) return;
    
    const items = getItems();
    const filtered = filterValue 
        ? items.filter(item => item.name.toLowerCase().includes(filterValue.toLowerCase()))
        : items;
    
    dropdown.innerHTML = '';
    
    if (filtered.length === 0) {
        dropdown.style.display = 'none';
        return;
    }
    
    filtered.slice(0, 10).forEach(item => {
        const option = document.createElement('div');
        option.className = 'dropdown-option';
        option.textContent = item.name;
        option.addEventListener('click', () => {
            input.value = item.name;
            dropdown.style.display = 'none';
            selectExistingItem(item);
        });
        dropdown.appendChild(option);
    });
    
    dropdown.style.display = 'block';
}

function showItemCustomDropdown(input) {
    updateItemCustomDropdown(input, input.value);
}

// === SELECT EXISTING ITEM ===
async function selectExistingItem(item) {
    console.log('Loading existing item:', item.name);
    
    currentItemID = item.id;
    currentItemAssetID = item.assetID || 0;
    currentItemData = item;
    
    // Update ID display
    updateItemIDDisplay();
    
    // Populate form fields
    document.getElementById('itemName').value = item.name || '';
    document.getElementById('itemType').value = item.type || 1;
    
    // Stats
    setFormValue('itemStrength', item.strength);
    setFormValue('itemStamina', item.stamina);
    setFormValue('itemAgility', item.agility);
    setFormValue('itemLuck', item.luck);
    setFormValue('itemArmor', item.armor);
    
    // Effect
    const effectSelect = document.getElementById('itemEffect');
    if (effectSelect) {
        effectSelect.value = item.effectID || '';
        updateItemEffectDescription();
    }
    setFormValue('itemEffectFactor', item.effectFactor);
    
    // Other
    document.getElementById('itemSocket').checked = item.socket || false;
    setFormValue('itemSilver', item.silver || 10);
    setFormValue('itemMinDamage', item.minDamage);
    setFormValue('itemMaxDamage', item.maxDamage);
    
    // Update form visibility based on type
    updateFormForItemType(item.type);
    
    // Load icon
    if (item.icon) {
        currentItemIcon = item.icon;
        const iconPreview = document.getElementById('itemIconPreview');
        if (iconPreview) {
            iconPreview.innerHTML = `<img src="${item.icon}" alt="Item Icon" style="width: 100%; height: 100%; object-fit: contain;">`;
        }
    }
    
    console.log('✅ Item loaded into form');
}

function setFormValue(elementId, value) {
    const element = document.getElementById(elementId);
    if (element) {
        element.value = value !== null && value !== undefined ? value : '';
    }
}

function updateItemIDDisplay() {
    const idInput = document.getElementById('itemID');
    const saveBtn = document.getElementById('saveItemBtn');
    
    if (idInput) {
        if (currentItemID === null || currentItemID === 0) {
            idInput.value = 'New item';
        } else {
            idInput.value = currentItemID.toString();
        }
    }
    
    if (saveBtn) {
        if (currentItemID === null || currentItemID === 0) {
            saveBtn.textContent = 'Save Item';
        } else {
            saveBtn.textContent = 'Update Item';
        }
    }
}

// === RESET FORM ===
function resetItemForm() {
    currentItemIcon = null;
    currentItemAssetID = 0;
    currentItemID = null;
    currentItemData = null;
    
    updateItemIDDisplay();
    
    // Reset form fields
    document.getElementById('itemName').value = '';
    document.getElementById('itemType').value = '1';
    
    // Reset stats
    ['itemStrength', 'itemStamina', 'itemAgility', 'itemLuck', 'itemArmor'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    
    // Reset effect
    const effectSelect = document.getElementById('itemEffect');
    if (effectSelect) effectSelect.value = '';
    document.getElementById('itemEffectFactor').value = '';
    
    // Reset other
    document.getElementById('itemSocket').checked = false;
    document.getElementById('itemSilver').value = '10';
    document.getElementById('itemMinDamage').value = '';
    document.getElementById('itemMaxDamage').value = '';
    
    // Reset icon
    const iconPreview = document.getElementById('itemIconPreview');
    if (iconPreview) {
        iconPreview.innerHTML = '<div class="icon-placeholder">📷</div>';
    }
    
    // Reset type visibility
    updateFormForItemType('1');
    
    console.log('✅ Item form reset');
}

// === SAVE ITEM ===
async function saveItem() {
    const item = ItemData.loadFromForm();
    
    if (!item.name) {
        alert('Please enter an item name');
        return;
    }
    
    console.log('Saving item:', item);
    
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
            body: JSON.stringify(item)
        });
        
        if (response.ok) {
            const result = await response.json();
            console.log('✅ Item saved successfully:', result);
            
            if (result.id) {
                currentItemID = result.id;
                updateItemIDDisplay();
            }
            
            // Update global data
            if (currentItemID && currentItemData) {
                updateItemInGlobal({ ...item, id: currentItemID });
            } else {
                addItemToGlobal({ ...item, id: result.id });
            }
            
            alert('Item saved successfully!');
        } else {
            const error = await response.text();
            console.error('Failed to save item:', error);
            alert('Failed to save item: ' + error);
        }
    } catch (error) {
        console.error('Error saving item:', error);
        alert('Error saving item: ' + error.message);
    }
}

// === POPULATE EFFECT DROPDOWN ===
function populateItemEffectDropdown() {
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
    
    // Add change handler for description
    effectSelect.addEventListener('change', updateItemEffectDescription);
}

function updateItemEffectDescription() {
    const effectSelect = document.getElementById('itemEffect');
    const descSpan = document.getElementById('itemEffectDescription');
    
    if (!effectSelect || !descSpan) return;
    
    const selectedId = parseInt(effectSelect.value);
    if (!selectedId) {
        descSpan.textContent = 'Select an effect to see description';
        return;
    }
    
    const effect = getEffectById(selectedId);
    if (effect) {
        descSpan.textContent = effect.description || 'No description available';
    }
}

// === LOAD ITEMS AND EFFECTS ===
async function loadItemsAndEffects() {
    console.log('Loading items and effects data...');
    
    try {
        // Load effects first
        await loadEffectsData();
        populateItemEffectDropdown();
        
        // Then load items
        await loadItemsData();
        loadedItems = getItems();
        
        console.log('✅ Items data loaded:', loadedItems.length, 'items');
        
    } catch (error) {
        console.error('Error loading items data:', error);
    }
}

// === EXPORT FOR GLOBAL ACCESS ===
window.itemDesigner = {
    init: initItemDesigner,
    loadItemsAndEffects: loadItemsAndEffects,
    resetForm: resetItemForm
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Only initialize if we're on a page with the item form
    if (document.getElementById('itemForm')) {
        initItemDesigner();
    }
});

console.log('📦 Item Designer script loaded');
