// Item Designer JavaScript

// Item type constants matching database enum
const ITEM_TYPES = [
    'head', 'chest', 'hands', 'feet', 'belt', 'legs', 'back',
    'amulet', 'weapon', 'hammer', 'gem', 'scroll', 'potion', 'ingredient', 'ration'
];

// Item types that hide stat/socket inputs
const STATLESS_ITEM_TYPES = ['ration', 'scroll', 'hammer', 'potion', 'ingredient', 'ingredients'];

// Weapon types that show damage fields
const WEAPON_TYPES = ['weapon'];
const RATION_EFFECT_ID = 200;
const HAMMER_EFFECT_ID = 201;

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
let itemFormSnapshot = null; // Snapshot for dirty tracking on updates
let selectedAssetIcon = null; // Currently selected asset icon URL
let itemAssetGallery = null;

let itemDesignerBootstrapped = false;

function ensureItemDesignerInit() {
    if (itemDesignerBootstrapped) return;
    if (!document.getElementById('itemForm')) return;
    itemDesignerBootstrapped = true;
    initItemDesigner();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureItemDesignerInit);
} else {
    ensureItemDesignerInit();
}

function initItemDesigner() {
    console.log('🎨 Initializing Item Designer...');
    
    // Load items from server
    loadItemsAndEffects();
    
    // Set up event listeners
    setupEventListeners();
    
    // Subscribe to global data changes
    setupItemDataSubscriptions();
    
    console.log('✅ Item Designer initialized');
}

function setupItemDataSubscriptions() {
    if (typeof subscribeToGlobalData !== 'function') return;
    
    subscribeToGlobalData('effects', () => {
        console.log('Effects updated, repopulating dropdown');
        populateItemEffectDropdown();
    });
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
    
    getItemAssetGallery();
    
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

    // Save validation: enable save only when conditions met
    const itemFormEl = document.getElementById('itemForm');
    if (itemFormEl) {
        itemFormEl.addEventListener('input', checkItemSaveConditions);
        itemFormEl.addEventListener('change', checkItemSaveConditions);
    }
    // Initial check
    checkItemSaveConditions();

    bindItemIntegerInputs();
    
    // Item type change (show/hide weapon stats)
    const itemTypeSelect = document.getElementById('itemType');
    if (itemTypeSelect) {
        itemTypeSelect.addEventListener('change', toggleWeaponStats);
    }

    // Effect description updates
    const itemEffectSelect = document.getElementById('itemEffect');
    if (itemEffectSelect) {
        itemEffectSelect.addEventListener('change', updateItemEffectDescription);
    }
    const itemFactorInput = document.getElementById('itemEffectFactor');
    if (itemFactorInput) {
        itemFactorInput.addEventListener('input', updateItemEffectDescription);
    }
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

function bindItemIntegerInputs() {
    const integerInputs = [
        { id: 'itemSilver', allowNegative: false },
        { id: 'itemStrength', allowNegative: true },
        { id: 'itemStamina', allowNegative: true },
        { id: 'itemAgility', allowNegative: true },
        { id: 'itemLuck', allowNegative: true },
        { id: 'itemArmor', allowNegative: true },
        { id: 'itemMinDamage', allowNegative: true },
        { id: 'itemMaxDamage', allowNegative: true },
        { id: 'itemEffectFactor', allowNegative: true }
    ];

    integerInputs.forEach(({ id, allowNegative }) => {
        const input = document.getElementById(id);
        if (!input || input.dataset.integerBound === '1') return;
        input.dataset.integerBound = '1';
        attachStrictIntegerGuards(input, allowNegative);
        input.addEventListener('input', () => normalizeIntegerInputValue(input));
        input.addEventListener('blur', () => normalizeIntegerInputValue(input));
    });
}

async function loadItemsAndEffects(options = {}) {
    const forceReload = options?.forceReload === true;
    if (forceReload) console.log('🔄 Reloading items data...');
    
    try {
        // Load effects first
        await loadEffectsData();
        populateItemEffectDropdown();
        
        // Then load items (this also loads pending items)
        await loadItemsData({ forceReload });
        allItems = getItems();
        allPendingItems = getPendingItems();
        filteredItems = [...allItems];
        filteredPendingItems = [...allPendingItems];
        
        // Load item assets from S3
        await loadItemAssets({ forceReload });
        itemAssets = getItemAssets();
        createItemAssetGallery();
        
        renderItemList();
        renderPendingItemList();
        
    } catch (error) {
        console.error('Error loading items data:', error);
    }
}

function renderItemList() {
    DesignerBase.renderSidebarList({
        listId: 'itemList',
        items: filteredItems,
        emptyHtml: '<p class="loading-text">No items found</p>',
        renderItem: item => `
        <div class="item-list-item ${item.id === selectedItemId && activeTab === 'game' ? 'selected' : ''}" 
             data-id="${item.id}" onclick="selectItem(${item.id})">
            <div class="item-name">${escapeHtml(item.name)}</div>
            <div class="item-type">${item.type || 'Unknown'}</div>
        </div>
    `
    });
}

function renderPendingItemList() {
    DesignerBase.renderSidebarList({
        listId: 'pendingItemList',
        items: filteredPendingItems,
        emptyHtml: '<p class="loading-text">No pending items</p>',
        beforeRender: () => {
            const mergeBtn = document.getElementById('mergeItemsBtn');
            if (mergeBtn) mergeBtn.disabled = !allPendingItems.some(i => i.approved);
        },
        renderItem: item => `
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
    `
    });
}

function filterItems() {
    const searchTerm = document.getElementById('itemSearch')?.value.toLowerCase() || '';
    const typeFilter = document.getElementById('itemTypeFilter')?.value || '';
    const matchesType = item => !typeFilter || item.type === typeFilter;
    filteredItems = DesignerBase.filterSidebarItems(allItems, searchTerm, item => item.name, matchesType);
    filteredPendingItems = DesignerBase.filterSidebarItems(allPendingItems, searchTerm, item => item.name, matchesType);
    
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
        
        const response = await fetch('/api/toggleApproveItem', {
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
            // Re-sync filtered array, GlobalData, and re-render
            filteredPendingItems = [...allPendingItems];
            setGlobalArray('pendingItems', allPendingItems);
            renderPendingItemList();
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
        
        const response = await fetch('/api/removePendingItem', {
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
            setGlobalArray('pendingItems', allPendingItems);
            
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
    const approvedCount = allPendingItems.filter(i => i.approved).length;
    
    if (approvedCount === 0) return;
    
    if (!await showConfirm(`Merge ${approvedCount} approved ${approvedCount === 1 ? 'item' : 'items'} into the game?`)) return;
    
    console.log('Merging approved items...');
    
    try {
        const token = await getCurrentAccessToken();
        if (!token) {
            alert('Authentication required');
            return;
        }
        
        const response = await fetch('/api/mergeItems', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const result = await response.json();
        
        if (result.success) {
            await loadItemsAndEffects({ forceReload: true });
            switchTab('game');
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
    DesignerBase.switchTab(tab, {
        gameTabId: 'gameItemsTab',
        pendingTabId: 'pendingItemsTab',
        gameListId: 'itemList',
        pendingListId: 'pendingItemList',
        newBtnId: 'newItemBtn',
        mergeBtnId: 'mergeItemsBtn'
    });
    
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
        snapshotItemForm();
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
        // Unlock form briefly to ensure clean population
        setFormLocked(false);
        populateFormFromPending(item);
        setFormLocked(true);
        document.getElementById('itemEditorTitle').textContent = `Pending: ${item.action.toUpperCase()}`;
    } else {
        console.warn('Pending item not found:', toolingId);
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
    updateItemEffectDescription();
    
    // Description
    document.getElementById('itemNotes').value = item.description || '';
    
    // Update icon preview using local asset gallery
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
    const saveBtn = form.querySelector('.btn-save');
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
    updateItemEffectDescription();
    
    // Description
    document.getElementById('itemNotes').value = item.description || '';
    
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
    itemFormSnapshot = null;
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
    updateItemEffectDescription();
    
    // Description
    document.getElementById('itemNotes').value = '';
    
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
            weaponSection.style.display = 'flex';
        } else {
            weaponSection.style.display = 'none';
        }
    }
    
    // Also update effect dropdown based on type
    populateItemEffectDropdown();
    applyItemTypeRules();
    updateItemEffectDescription();
}

function populateItemEffectDropdown() {
    const effectSelect = document.getElementById('itemEffect');
    if (!effectSelect) {
        console.warn('populateItemEffectDropdown: #itemEffect not found');
        return;
    }

    if (typeof DesignerBase !== 'undefined' && typeof DesignerBase.bindDropdownSpace === 'function') {
        DesignerBase.bindDropdownSpace(effectSelect);
    }
    
    // Get effects from global data - try getEffects function first, then GlobalData directly
    let effects = [];
    if (typeof getEffects === 'function') {
        effects = getEffects() || [];
    } else if (typeof GlobalData !== 'undefined' && GlobalData.effects) {
        effects = GlobalData.effects;
    }
    
    const typeEl = document.getElementById('itemType');
    const selectedType = typeEl?.value || '';
    const currentValue = effectSelect.value;
    
    console.log('populateItemEffectDropdown:', {
        effectsCount: effects.length,
        selectedType,
        currentValue,
        itemTypeElementExists: !!typeEl
    });
    
    if (selectedType === 'ration') {
        const rationEffect = effects.find(e => e.id === RATION_EFFECT_ID);
        const label = rationEffect ? rationEffect.name : `Effect ${RATION_EFFECT_ID}`;
        effectSelect.innerHTML = `<option value="${RATION_EFFECT_ID}">${label} (ID ${RATION_EFFECT_ID})</option>`;
        effectSelect.value = String(RATION_EFFECT_ID);
        effectSelect.disabled = true;
        updateItemEffectDescription();
        return;
    }

    if (selectedType === 'hammer') {
        const hammerEffect = effects.find(e => e.id === HAMMER_EFFECT_ID);
        const label = hammerEffect ? hammerEffect.name : `Effect ${HAMMER_EFFECT_ID}`;
        effectSelect.innerHTML = `<option value="${HAMMER_EFFECT_ID}">${label} (ID ${HAMMER_EFFECT_ID})</option>`;
        effectSelect.value = String(HAMMER_EFFECT_ID);
        effectSelect.disabled = true;
        updateItemEffectDescription();
        return;
    }

    const filteredEffects = effects.filter(effect =>
        effect.id !== RATION_EFFECT_ID && effect.id !== HAMMER_EFFECT_ID
    );

    effectSelect.disabled = false;
    const optionsHTML = '<option value="">-- No Effect --</option>' +
        filteredEffects.map(effect => `<option value="${effect.id}">${effect.name}</option>`).join('');
    effectSelect.innerHTML = optionsHTML;
    console.log('populateItemEffectDropdown: options rendered', effectSelect.options.length);
    
    // Restore selection if still valid
    if (currentValue) {
        effectSelect.value = currentValue;
        if (effectSelect.value !== currentValue) {
            effectSelect.value = '';
        }
        console.log('populateItemEffectDropdown: restored value', effectSelect.value);
    }

    updateItemEffectDescription();
}

function updateItemEffectDescription() {
    const descSpan = document.getElementById('itemEffectDesc');
    if (!descSpan) return;

    const effectId = parseInt(document.getElementById('itemEffect')?.value);
    if (!effectId) {
        descSpan.textContent = '';
        return;
    }

    const effects = typeof getEffects === 'function' ? getEffects() : (GlobalData?.effects || []);
    const effect = effects.find(e => e.id === effectId);
    let text = effect?.description || '';
    const factorVal = document.getElementById('itemEffectFactor')?.value || '';
    if (text && factorVal && text.includes('*')) {
        text = text.replace('*', factorVal);
    } else if (text && factorVal) {
        text = text + ' ' + factorVal + '%';
    }
    descSpan.textContent = text;
}

function applyItemTypeRules() {
    const itemType = document.getElementById('itemType')?.value || '';
    const isRation = itemType === 'ration';
    const isHammer = itemType === 'hammer';
    const isStatless = STATLESS_ITEM_TYPES.includes(itemType);
    const form = document.getElementById('itemForm');
    const isLocked = form?.classList.contains('form-locked');

    const statGrid = document.querySelector('.item-stats-grid');
    if (statGrid) {
        statGrid.classList.toggle('is-hidden', isStatless);
    }

    const statIds = ['itemStrength', 'itemStamina', 'itemAgility', 'itemLuck', 'itemArmor'];
    const weaponIds = ['itemMinDamage', 'itemMaxDamage'];
    const socketInput = document.getElementById('itemSocket');
    const effectSelect = document.getElementById('itemEffect');
    const effectFactorInput = document.getElementById('itemEffectFactor');

    const disableStats = isStatless;
    const clearStats = isRation;

    statIds.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        if (clearStats) {
            el.value = '';
        }
        if (!isLocked) {
            el.disabled = disableStats ? true : false;
        }
    });

    if (socketInput) {
        if (clearStats) {
            socketInput.checked = false;
        }
        if (!isLocked) {
            socketInput.disabled = disableStats;
        }
    }

    if (isRation) {
        weaponIds.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.value = '';
            if (!isLocked) el.disabled = true;
        });
        if (effectSelect) {
            effectSelect.value = String(RATION_EFFECT_ID);
            if (!isLocked) effectSelect.disabled = true;
        }
        if (effectFactorInput && !isLocked) {
            effectFactorInput.disabled = false;
        }
    } else if (isHammer) {
        weaponIds.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.value = '';
            if (!isLocked) el.disabled = true;
        });
        if (effectSelect) {
            effectSelect.value = String(HAMMER_EFFECT_ID);
            if (!isLocked) effectSelect.disabled = true;
        }
        if (effectFactorInput) {
            effectFactorInput.value = '';
            if (!isLocked) effectFactorInput.disabled = true;
        }
    } else if (!isLocked) {
        weaponIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.disabled = false;
        });
        if (effectSelect) {
            effectSelect.disabled = false;
        }
        if (effectFactorInput) {
            effectFactorInput.disabled = false;
        }
    }

    updateItemEffectDescription();
}

function getItemValidationErrors() {
    const errors = [];
    const name = document.getElementById('itemName')?.value?.trim() || '';
    const assetId = parseInt(document.getElementById('itemAssetID')?.value, 10) || 0;
    const hasIcon = assetId > 1 || (document.getElementById('itemIconPreview')?.src && document.getElementById('itemIconPreview')?.style.display !== 'none');
    const silver = parseInt(document.getElementById('itemSilver')?.value, 10) || 0;
    const type = document.getElementById('itemType')?.value || '';
    const minDamage = parseInt(document.getElementById('itemMinDamage')?.value, 10) || 0;
    const maxDamage = parseInt(document.getElementById('itemMaxDamage')?.value, 10) || 0;

    if (!name) errors.push('Name is required');
    if (!hasIcon) errors.push('Icon must be selected');
    if (!type) errors.push('Type is required');
    if (silver <= 0) errors.push('Silver must be greater than 0');

    if (WEAPON_TYPES.includes(type)) {
        if (minDamage <= 0) errors.push('Min damage must be greater than 0 for weapons');
        if (maxDamage <= 0) errors.push('Max damage must be greater than 0 for weapons');
        if (maxDamage <= minDamage) errors.push('Max damage must be greater than min damage for weapons');
    }

    if (itemFormSnapshot && !isItemFormDirty()) errors.push('No changes to save');

    return errors;
}

function snapshotItemForm() {
    itemFormSnapshot = {
        name: document.getElementById('itemName')?.value || '',
        type: document.getElementById('itemType')?.value || '',
        assetID: document.getElementById('itemAssetID')?.value || '1',
        silver: document.getElementById('itemSilver')?.value || '10',
        strength: document.getElementById('itemStrength')?.value || '',
        stamina: document.getElementById('itemStamina')?.value || '',
        agility: document.getElementById('itemAgility')?.value || '',
        luck: document.getElementById('itemLuck')?.value || '',
        armor: document.getElementById('itemArmor')?.value || '',
        socket: document.getElementById('itemSocket')?.checked || false,
        minDamage: document.getElementById('itemMinDamage')?.value || '',
        maxDamage: document.getElementById('itemMaxDamage')?.value || '',
        effectID: document.getElementById('itemEffect')?.value || '',
        effectFactor: document.getElementById('itemEffectFactor')?.value || '',
        description: document.getElementById('itemNotes')?.value || ''
    };
    checkItemSaveConditions();
}

function isItemFormDirty() {
    if (!itemFormSnapshot) return true;
    return (
        (document.getElementById('itemName')?.value || '') !== itemFormSnapshot.name ||
        (document.getElementById('itemType')?.value || '') !== itemFormSnapshot.type ||
        (document.getElementById('itemAssetID')?.value || '1') !== itemFormSnapshot.assetID ||
        (document.getElementById('itemSilver')?.value || '10') !== itemFormSnapshot.silver ||
        (document.getElementById('itemStrength')?.value || '') !== itemFormSnapshot.strength ||
        (document.getElementById('itemStamina')?.value || '') !== itemFormSnapshot.stamina ||
        (document.getElementById('itemAgility')?.value || '') !== itemFormSnapshot.agility ||
        (document.getElementById('itemLuck')?.value || '') !== itemFormSnapshot.luck ||
        (document.getElementById('itemArmor')?.value || '') !== itemFormSnapshot.armor ||
        (document.getElementById('itemSocket')?.checked || false) !== itemFormSnapshot.socket ||
        (document.getElementById('itemMinDamage')?.value || '') !== itemFormSnapshot.minDamage ||
        (document.getElementById('itemMaxDamage')?.value || '') !== itemFormSnapshot.maxDamage ||
        (document.getElementById('itemEffect')?.value || '') !== itemFormSnapshot.effectID ||
        (document.getElementById('itemEffectFactor')?.value || '') !== itemFormSnapshot.effectFactor ||
        (document.getElementById('itemNotes')?.value || '') !== itemFormSnapshot.description
    );
}

function checkItemSaveConditions() {
    const btn = document.querySelector('#itemForm .btn-save');
    if (!btn) return;

    const errors = getItemValidationErrors();
    const canSave = errors.length === 0;

    btn.disabled = false;
    btn.type = canSave ? 'submit' : 'button';
    btn.classList.toggle('btn-disabled', !canSave);
    btn.setAttribute('aria-disabled', canSave ? 'false' : 'true');
    btn.title = canSave ? 'Save Item' : `Cannot save item yet:\n- ${errors.join('\n- ')}`;
}

async function saveItem(e) {
    e.preventDefault();

    const validationErrors = getItemValidationErrors();
    if (validationErrors.length > 0) {
        alert(`Cannot save item yet:\n- ${validationErrors.join('\n- ')}`);
        checkItemSaveConditions();
        return;
    }
    
    const itemId = document.getElementById('itemId').value;
    const isUpdate = !!itemId;
    const itemType = document.getElementById('itemType').value;
    
    // Gather form data
    const itemData = {
        id: itemId ? parseInt(itemId) : null,
        name: document.getElementById('itemName').value,
        type: itemType,
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
        maxDamage: parseIntOrNull(document.getElementById('itemMaxDamage').value),
        description: document.getElementById('itemNotes').value.trim() || null
    };

    const isStatless = STATLESS_ITEM_TYPES.includes(itemType);
    const isWeapon = WEAPON_TYPES.includes(itemType);

    if (isStatless) {
        itemData.strength = null;
        itemData.stamina = null;
        itemData.agility = null;
        itemData.luck = null;
        itemData.armor = null;
        itemData.socket = false;
    }

    if (!isWeapon) {
        itemData.minDamage = null;
        itemData.maxDamage = null;
    }

    if (itemType === 'ration') {
        itemData.effectID = RATION_EFFECT_ID;
        itemData.minDamage = null;
        itemData.maxDamage = null;
    } else if (itemType === 'hammer') {
        itemData.effectID = HAMMER_EFFECT_ID;
        itemData.effectFactor = null;
    }
    
    console.log('Saving item:', itemData);
    
    try {
        const token = await getCurrentAccessToken();
        if (!token) {
            alert('Authentication required');
            return;
        }
        
        const response = await fetch('/api/createItem', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(itemData)
        });
        
        const result = await response.json();
        
        if (result.success) {
            
            // Build a local pending object instead of full reload
            const pendingItem = {
                toolingId: result.toolingId,
                gameId: itemData.id,
                name: itemData.name,
                type: itemData.type,
                assetID: itemData.assetID,
                silver: itemData.silver,
                strength: itemData.strength,
                stamina: itemData.stamina,
                agility: itemData.agility,
                luck: itemData.luck,
                armor: itemData.armor,
                socket: itemData.socket,
                effectID: itemData.effectID,
                effectFactor: itemData.effectFactor,
                minDamage: itemData.minDamage,
                maxDamage: itemData.maxDamage,
                description: itemData.description,
                action: result.action || (isUpdate ? 'update' : 'insert'),
                approved: false
            };

            // If editing an existing pending item, replace it; otherwise push new
            const existingIdx = allPendingItems.findIndex(i => i.toolingId === result.toolingId);
            if (existingIdx !== -1) {
                allPendingItems[existingIdx] = pendingItem;
            } else {
                allPendingItems.push(pendingItem);
            }
            filteredPendingItems = [...allPendingItems];
            // Keep GlobalData in sync
            setGlobalArray('pendingItems', allPendingItems);
            
            renderPendingItemList();
            // Switch to pending tab without clearing form (switchTab clears selection)
            activeTab = 'pending';
            const gameTab = document.getElementById('gameItemsTab');
            const pendingTab = document.getElementById('pendingItemsTab');
            if (gameTab) gameTab.classList.toggle('active', false);
            if (pendingTab) pendingTab.classList.toggle('active', true);
            const itemList = document.getElementById('itemList');
            const pendingList = document.getElementById('pendingItemList');
            if (itemList) itemList.style.display = 'none';
            if (pendingList) pendingList.style.display = 'block';
            const newItemBtn = document.getElementById('newItemBtn');
            const mergeItemsBtn = document.getElementById('mergeItemsBtn');
            if (newItemBtn) newItemBtn.style.display = 'none';
            if (mergeItemsBtn) mergeItemsBtn.style.display = 'block';
            // Now select the newly created pending item (read-only)
            selectPendingItem(result.toolingId);
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

function getItemAssetGallery() {
    if (itemAssetGallery) return itemAssetGallery;
    itemAssetGallery = new AssetGallery({
        overlayId: 'itemAssetGalleryOverlay',
        gridId: 'itemAssetGrid',
        openTriggerIds: ['itemAssetGalleryBtn', 'itemIconUploadArea'],
        closeTriggerIds: ['itemAssetGalleryClose'],
        uploadTriggerIds: ['itemUploadNewBtn'],
        fileInputId: 'itemIconFile',
        dropZoneId: 'itemIconUploadArea',
        getAssets: () => itemAssets,
        getSelectedAssetId: () => selectedAssetId,
        itemClass: 'item-asset-item',
        thumbnailClass: 'item-asset-thumbnail',
        uploadEndpoint: '/api/uploadItemAsset',
        getNextAssetID: getNextAvailableItemAssetID,
        width: 128,
        height: 128,
        quality: 0.8,
        onSelect: (asset, { assetId, iconUrl, gallery }) => {
            selectedAssetId = assetId;
            selectedAssetIcon = iconUrl;
            document.getElementById('itemAssetID').value = assetId;
            updateIconPreview(assetId);
            gallery.close();
            checkItemSaveConditions();
        },
        onUploadStart: ({ assetID, base64Data }) => {
            const preview = document.getElementById('itemIconPreview');
            const placeholder = document.getElementById('itemIconPlaceholder');
            const assetIdDisplay = document.getElementById('itemAssetIDDisplay');
            if (preview) {
                preview.src = base64Data;
                preview.style.display = 'block';
            }
            if (placeholder) placeholder.style.display = 'none';
            if (assetIdDisplay) assetIdDisplay.textContent = `Uploading... (Asset ID: ${assetID})`;
        },
        onUploaded: ({ result, base64Data }) => {
            selectedAssetId = result.assetID;
            selectedAssetIcon = result.icon || base64Data;
            document.getElementById('itemAssetID').value = result.assetID;
            const assetIdDisplay = document.getElementById('itemAssetIDDisplay');
            if (assetIdDisplay) assetIdDisplay.textContent = `Asset ID: ${result.assetID}`;
            itemAssets.push({
                assetID: result.assetID,
                name: result.assetID.toString(),
                icon: result.icon || base64Data
            });
            alert('Item icon uploaded successfully!');
        },
        onUploadError: ({ error, result }) => {
            alert(result?.message ? 'Error uploading icon: ' + result.message : 'Failed to upload icon. Please try again.');
            console.error('Error uploading item icon:', error);
            clearIconPreview();
        }
    });
    return itemAssetGallery;
}

/**
 * Create the item asset gallery with available assets from S3
 */
function createItemAssetGallery() {
    getItemAssetGallery().render();
}

/**
 * Toggle the item asset gallery overlay visibility
 */
function toggleItemAssetGallery() {
    getItemAssetGallery().toggle();
}

/**
 * Select an asset from the gallery
 */
function selectItemAsset(assetId, iconUrl) {
    console.log('Selected asset:', assetId);
    getItemAssetGallery().selectById(assetId, iconUrl);
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
    return getItemAssetGallery().upload(file);
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
