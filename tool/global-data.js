// Global Data Management JavaScript
// This file manages globally accessible data loaded from the server

// === GLOBAL DATA STORAGE ===
const GlobalData = {
    effects: [],           // Array of all effects from database
    enemies: [],           // Array of all complete enemy data with signed URLs
    perks: [],             // Array of all complete perk data with signed URLs
    items: []              // Array of all complete item data with signed URLs
};

// === EFFECTS DATA STRUCTURE ===
// Matches server-side database structure
const Effect = {
    create: (id, name, description = "") => ({
        id: id,                    // Effect ID from database - JSON: "id"
        name: name,               // Effect name - JSON: "name"
        description: description  // Effect description - JSON: "description"
    })
};

// === PERK DATA STRUCTURE ===
// Matches server-side database structure
const Perk = {
    create: (id, assetID, name, description = "", effect1_id = null, effect1_factor = null, effect2_id = null, effect2_factor = null) => ({
        id: id,                           // Perk ID from database - JSON: "id"
        assetID: assetID,                 // Asset ID from database - JSON: "assetID"
        name: name,                       // Perk name - JSON: "name"
        description: description,         // Perk description - JSON: "description"
        effect1_id: effect1_id,          // First effect ID - JSON: "effect1_id"
        effect1_factor: effect1_factor,   // First effect factor - JSON: "effect1_factor"
        effect2_id: effect2_id,          // Second effect ID - JSON: "effect2_id"
        effect2_factor: effect2_factor,   // Second effect factor - JSON: "effect2_factor"
        icon: ""                         // Signed URL for perk icon - JSON: "icon"
    })
};

// === ITEM DATA STRUCTURE ===
// Matches server-side database structure (game.items)
const Item = {
    create: () => ({
        id: null,              // Item ID from database - JSON: "id"
        name: "",              // Item name - JSON: "name"
        assetID: 0,            // Asset ID from database - JSON: "assetID"
        type: "weapon",        // Item type (weapon, armor, etc.) - JSON: "type"
        strength: null,        // Strength stat - JSON: "strength"
        stamina: null,         // Stamina stat - JSON: "stamina"
        agility: null,         // Agility stat - JSON: "agility"
        luck: null,            // Luck stat - JSON: "luck"
        armor: null,           // Armor stat - JSON: "armor"
        effectID: null,        // Effect ID - JSON: "effectID"
        effectFactor: null,    // Effect factor - JSON: "effectFactor"
        socket: false,         // Has socket - JSON: "socket"
        silver: 10,            // Silver cost - JSON: "silver"
        minDamage: null,       // Min damage (weapons) - JSON: "minDamage"
        maxDamage: null,       // Max damage (weapons) - JSON: "maxDamage"
        version: 1,            // Version - JSON: "version"
        icon: ""               // Signed URL for item icon - JSON: "icon"
    })
};

// === GLOBAL DATA LOADING FUNCTIONS ===

// Track loading state to prevent duplicate requests
let effectsLoadingPromise = null;

/**
 * Load all effects data from the server (loads only once, returns cached data)
 * @returns {Promise<Array>} Promise that resolves to array of effects
 */
async function loadEffectsData() {
    // If effects are already loaded, return them immediately
    if (GlobalData.effects.length > 0) {
        console.log('✅ Effects already loaded, using cached data:', GlobalData.effects.length, 'effects');
        return GlobalData.effects;
    }
    
    // If already loading, wait for that request to finish
    if (effectsLoadingPromise) {
        console.log('Effects already loading, waiting for existing request...');
        return effectsLoadingPromise;
    }
    
    // Start new loading request
    effectsLoadingPromise = (async () => {
        try {
            // Get current access token
            const token = await getCurrentAccessToken();
            if (!token) {
                console.error('Authentication required to load effects data');
                throw new Error('Authentication required');
            }

            console.log('Loading effects data from server...');

        const response = await fetch('http://localhost:8080/api/getEffects', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

            if (response.ok) {
                const data = await response.json();
                GlobalData.effects = data.effects || [];
                console.log('✅ Effects data loaded successfully:', GlobalData.effects.length, 'effects');
                return GlobalData.effects;
                
            } else {
                const error = await response.text();
                console.error('Failed to load effects data:', error);
                throw new Error(`Server error: ${error}`);
            }

        } catch (error) {
            console.error('Error loading effects data:', error);
            throw error;
        } finally {
            effectsLoadingPromise = null;
        }
    })();
    
    return effectsLoadingPromise;
}

/**
 * Load all enemies data from the server
 * @returns {Promise<Array>} Promise that resolves to array of complete enemy data
 */
async function loadEnemiesData() {
    try {
        // Get current access token
        const token = await getCurrentAccessToken();
        if (!token) {
            console.error('Authentication required to load enemies data');
            throw new Error('Authentication required');
        }

        console.log('Loading enemies data from server...');

        const response = await fetch('http://localhost:8080/api/getEnemies', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            const data = await response.json();
            console.log('Enemies count:', data.enemies ? data.enemies.length : 0);
            GlobalData.enemies = data.enemies || [];
            // Store effects if not already loaded
            if (data.effects && GlobalData.effects.length === 0) {
                GlobalData.effects = data.effects;
                console.log('Effects data also loaded from enemies endpoint');
            }
            
            console.log('✅ Enemies data loaded successfully:', GlobalData.enemies.length, 'enemies');
            return GlobalData.enemies;
            
        } else {
            const error = await response.text();
            console.error('Failed to load enemies data:', error);
            throw new Error(`Server error: ${error}`);
        }

    } catch (error) {
        console.error('Error loading enemies data:', error);
        throw error;
    }
}

/**
 * Load all perks data from the server
 * @returns {Promise<Array>} Promise that resolves to array of complete perk data
 */
async function loadPerksData() {
    try {
        // Get current access token
        const token = await getCurrentAccessToken();
        if (!token) {
            console.error('Authentication required to load perks data');
            throw new Error('Authentication required');
        }

        console.log('Loading perks data from server...');

        const response = await fetch('http://localhost:8080/api/getPerks', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            const data = await response.json();
            console.log('=== PERKS DATA LOADED ===');
            console.log('Success:', data.success);
            console.log('Effects count from perks endpoint:', data.effects ? data.effects.length : 0);
            console.log('Perks count:', data.perks ? data.perks.length : 0);
            
            // Store the loaded perks data
            GlobalData.perks = data.perks || [];
            // Store effects if not already loaded
            if (data.effects && GlobalData.effects.length === 0) {
                GlobalData.effects = data.effects;
                console.log('Effects data also loaded from perks endpoint');
            }
            
            console.log('✅ Perks data loaded successfully:', GlobalData.perks.length, 'perks');
            return GlobalData.perks;
            
        } else {
            const error = await response.text();
            console.error('Failed to load perks data:', error);
            throw new Error(`Server error: ${error}`);
        }

    } catch (error) {
        console.error('Error loading perks data:', error);
        throw error;
    }
}

/**
 * Load all items data from the server
 * @returns {Promise<Array>} Promise that resolves to array of complete item data
 */
async function loadItemsData() {
    try {
        // Get current access token
        const token = await getCurrentAccessToken();
        if (!token) {
            console.error('Authentication required to load items data');
            throw new Error('Authentication required');
        }

        console.log('Loading items data from server...');

        const response = await fetch('http://localhost:8080/api/getItems', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            const data = await response.json();
            console.log('=== ITEMS DATA LOADED ===');
            console.log('Success:', data.success);
            console.log('Effects count from items endpoint:', data.effects ? data.effects.length : 0);
            console.log('Items count:', data.items ? data.items.length : 0);
            
            // Store the loaded items data
            GlobalData.items = data.items || [];
            // Store effects if not already loaded
            if (data.effects && GlobalData.effects.length === 0) {
                GlobalData.effects = data.effects;
                console.log('Effects data also loaded from items endpoint');
            }
            
            console.log('✅ Items data loaded successfully:', GlobalData.items.length, 'items');
            return GlobalData.items;
            
        } else {
            const error = await response.text();
            console.error('Failed to load items data:', error);
            throw new Error(`Server error: ${error}`);
        }

    } catch (error) {
        console.error('Error loading items data:', error);
        throw error;
    }
}

// === DATA ACCESS FUNCTIONS ===

/**
 * Get all effects data
 * @returns {Array} Array of effects
 */
function getEffects() {
    return GlobalData.effects;
}

/**
 * Get effect by ID
 * @param {number|string} effectId - The effect ID to find
 * @returns {Object|null} Effect object or null if not found
 */
function getEffectById(effectId) {
    const id = parseInt(effectId);
    return GlobalData.effects.find(effect => effect.id === id) || null;
}

/**
 * Get effect name by ID (useful for displaying effect names)
 * @param {number|string} effectId - The effect ID
 * @returns {string} Effect name or empty string if not found
 */
function getEffectName(effectId) {
    const effect = getEffectById(effectId);
    return effect ? effect.name : '';
}

/**
 * Get all enemies data
 * @returns {Array} Array of complete enemy data
 */
function getEnemies() {
    return GlobalData.enemies;
}

/**
 * Get enemy by ID
 * @param {number|string} enemyId - The enemy ID to find
 * @returns {Object|null} Enemy object or null if not found
 */
function getEnemyById(enemyId) {
    const id = parseInt(enemyId);
    return GlobalData.enemies.find(enemy => enemy.id === id) || null;
}

/**
 * Get enemy by assetID
 * @param {number|string} assetID - The asset ID to find
 * @returns {Object|null} Enemy object or null if not found
 */
function getEnemyByAssetID(assetID) {
    const id = parseInt(assetID);
    return GlobalData.enemies.find(enemy => enemy.assetID === id) || null;
}

/**
 * Get all unique enemies with assets (for gallery display)
 * Returns only one enemy per unique assetID to avoid showing duplicate textures
 * @returns {Array} Array of unique enemies that have icons
 */
function getEnemiesWithAssets() {
    const enemiesWithAssets = GlobalData.enemies.filter(enemy => enemy.icon && enemy.assetID > 0);
    
    // Create a map to store unique assets by assetID
    const uniqueAssets = new Map();
    
    // Keep only the first enemy found for each unique assetID
    enemiesWithAssets.forEach(enemy => {
        if (!uniqueAssets.has(enemy.assetID)) {
            uniqueAssets.set(enemy.assetID, enemy);
        }
    });
    
    // Convert map values back to array
    return Array.from(uniqueAssets.values());
}

/**
 * Get texture URL by assetID (useful for displaying asset images)
 * @param {number|string} assetID - The asset ID
 * @returns {string} Texture URL or empty string if not found
 */
function getEnemyAssetTexture(assetID) {
    const enemy = getEnemyByAssetID(assetID);
    return enemy ? enemy.icon : '';
}

/**
 * Get all available assetIDs
 * @returns {Array<number>} Array of all available asset IDs
 */
function getAvailableAssetIDs() {
    return GlobalData.enemies
        .filter(enemy => enemy.assetID > 0)
        .map(enemy => enemy.assetID);
}

/**
 * Add a new enemy to the global enemies array
 * @param {Object} enemy - The enemy object to add
 */
function addEnemyToGlobal(enemy) {
    console.log('Adding enemy to global data:', enemy.name, 'ID:', enemy.id);
    GlobalData.enemies.push(enemy);
    console.log('✅ Enemy added. Total enemies:', GlobalData.enemies.length);
}

/**
 * Update an existing enemy in the global enemies array
 * @param {Object} updatedEnemy - The updated enemy object
 */
function updateEnemyInGlobal(updatedEnemy) {
    console.log('Updating enemy in global data:', updatedEnemy.name, 'ID:', updatedEnemy.id);
    console.log('Current enemies count:', GlobalData.enemies.length);
    
    // Find and replace the enemy with matching ID (convert both to string for comparison)
    const targetId = String(updatedEnemy.id);
    const index = GlobalData.enemies.findIndex(enemy => String(enemy.id) === targetId);
    
    if (index !== -1) {
        console.log('Found enemy at index:', index, 'Old enemy:', GlobalData.enemies[index].name);
        GlobalData.enemies[index] = updatedEnemy;
        console.log('✅ Enemy updated in global data at index:', index, 'New enemy:', updatedEnemy.name);
        console.log('Updated enemy icon URL:', updatedEnemy.icon ? 'Present' : 'Missing');
    } else {
        console.warn('Enemy not found for update (ID:', targetId, '), available IDs:', GlobalData.enemies.map(e => String(e.id)));
        console.warn('Adding as new enemy instead:', updatedEnemy.name);
        GlobalData.enemies.push(updatedEnemy);
    }
}

/**
 * Get count of enemies using a specific assetID
 * @param {number} assetID - The asset ID to count
 * @returns {number} Number of enemies using this asset
 */
function getAssetUsageCount(assetID) {
    return GlobalData.enemies.filter(enemy => enemy.assetID === assetID).length;
}

/**
 * Get all perks data
 * @returns {Array} Array of complete perk data
 */
function getPerks() {
    return GlobalData.perks;
}

/**
 * Get perk by ID
 * @param {number|string} perkId - The perk ID to find
 * @returns {Object|null} Perk object or null if not found
 */
function getPerkById(perkId) {
    const id = parseInt(perkId);
    return GlobalData.perks.find(perk => perk.id === id) || null;
}

/**
 * Get perk by assetID
 * @param {number|string} assetID - The asset ID to find
 * @returns {Object|null} Perk object or null if not found
 */
function getPerkByAssetID(assetID) {
    const id = parseInt(assetID);
    return GlobalData.perks.find(perk => perk.assetID === id) || null;
}

/**
 * Get all unique perks with assets (for gallery display)
 * Returns only one perk per unique assetID to avoid showing duplicate textures
 * @returns {Array} Array of unique perks that have icons
 */
function getPerksWithAssets() {
    const perksWithAssets = GlobalData.perks.filter(perk => perk.icon && perk.assetID > 0);
    
    // Create a map to store unique assets by assetID
    const uniqueAssets = new Map();
    
    // Keep only the first perk found for each unique assetID
    perksWithAssets.forEach(perk => {
        if (!uniqueAssets.has(perk.assetID)) {
            uniqueAssets.set(perk.assetID, perk);
        }
    });
    
    // Convert map values back to array
    return Array.from(uniqueAssets.values());
}

/**
 * Get texture URL by assetID (useful for displaying perk asset images)
 * @param {number|string} assetID - The asset ID
 * @returns {string} Texture URL or empty string if not found
 */
function getPerkAssetTexture(assetID) {
    const perk = getPerkByAssetID(assetID);
    return perk ? perk.icon : '';
}

/**
 * Add a new perk to the global perks array
 * @param {Object} perk - The perk object to add
 */
function addPerkToGlobal(perk) {
    console.log('Adding perk to global data:', perk.name, 'ID:', perk.id);
    GlobalData.perks.push(perk);
    console.log('✅ Perk added. Total perks:', GlobalData.perks.length);
}

/**
 * Update an existing perk in the global perks array
 * @param {Object} updatedPerk - The updated perk object
 */
function updatePerkInGlobal(updatedPerk) {
    console.log('Updating perk in global data:', updatedPerk.name, 'ID:', updatedPerk.id);
    console.log('Current perks count:', GlobalData.perks.length);
    
    // Find and replace the perk with matching ID (convert both to string for comparison)
    const targetId = String(updatedPerk.id);
    const index = GlobalData.perks.findIndex(perk => String(perk.id) === targetId);
    
    if (index !== -1) {
        console.log('Found perk at index:', index, 'Old perk:', GlobalData.perks[index].name);
        GlobalData.perks[index] = updatedPerk;
        console.log('✅ Perk updated in global data at index:', index, 'New perk:', updatedPerk.name);
        console.log('Updated perk icon URL:', updatedPerk.icon ? 'Present' : 'Missing');
    } else {
        console.warn('Perk not found for update (ID:', targetId, '), available IDs:', GlobalData.perks.map(p => String(p.id)));
        console.warn('Adding as new perk instead:', updatedPerk.name);
        GlobalData.perks.push(updatedPerk);
    }
}

/**
 * Get count of perks using a specific assetID
 * @param {number} assetID - The asset ID to count
 * @returns {number} Number of perks using this asset
 */
function getPerkAssetUsageCount(assetID) {
    return GlobalData.perks.filter(perk => perk.assetID === assetID).length;
}

/**
 * Get all available perk assetIDs
 * @returns {Array<number>} Array of all available perk asset IDs
 */
function getAvailablePerkAssetIDs() {
    return GlobalData.perks
        .filter(perk => perk.assetID > 0)
        .map(perk => perk.assetID);
}

// === ITEM DATA ACCESS FUNCTIONS ===

/**
 * Get all items data
 * @returns {Array} Array of complete item data
 */
function getItems() {
    return GlobalData.items;
}

/**
 * Get item by ID
 * @param {number|string} itemId - The item ID to find
 * @returns {Object|null} Item object or null if not found
 */
function getItemById(itemId) {
    const id = parseInt(itemId);
    return GlobalData.items.find(item => item.id === id) || null;
}

/**
 * Get item by assetID
 * @param {number|string} assetID - The asset ID to find
 * @returns {Object|null} Item object or null if not found
 */
function getItemByAssetID(assetID) {
    const id = parseInt(assetID);
    return GlobalData.items.find(item => item.assetID === id) || null;
}

/**
 * Get all unique items with assets (for gallery display)
 * Returns only one item per unique assetID to avoid showing duplicate textures
 * @returns {Array} Array of unique items that have icons
 */
function getItemsWithAssets() {
    const itemsWithAssets = GlobalData.items.filter(item => item.icon && item.assetID > 0);
    
    // Create a map to store unique assets by assetID
    const uniqueAssets = new Map();
    
    // Keep only the first item found for each unique assetID
    itemsWithAssets.forEach(item => {
        if (!uniqueAssets.has(item.assetID)) {
            uniqueAssets.set(item.assetID, item);
        }
    });
    
    // Convert map values back to array
    return Array.from(uniqueAssets.values());
}

/**
 * Get texture URL by assetID (useful for displaying item asset images)
 * @param {number|string} assetID - The asset ID
 * @returns {string} Texture URL or empty string if not found
 */
function getItemAssetTexture(assetID) {
    const item = getItemByAssetID(assetID);
    return item ? item.icon : '';
}

/**
 * Add a new item to the global items array
 * @param {Object} item - The item object to add
 */
function addItemToGlobal(item) {
    console.log('Adding item to global data:', item.name, 'ID:', item.id);
    GlobalData.items.push(item);
    console.log('✅ Item added. Total items:', GlobalData.items.length);
}

/**
 * Update an existing item in the global items array
 * @param {Object} updatedItem - The updated item object
 */
function updateItemInGlobal(updatedItem) {
    console.log('Updating item in global data:', updatedItem.name, 'ID:', updatedItem.id);
    console.log('Current items count:', GlobalData.items.length);
    
    // Find and replace the item with matching ID (convert both to string for comparison)
    const targetId = String(updatedItem.id);
    const index = GlobalData.items.findIndex(item => String(item.id) === targetId);
    
    if (index !== -1) {
        console.log('Found item at index:', index, 'Old item:', GlobalData.items[index].name);
        GlobalData.items[index] = updatedItem;
        console.log('✅ Item updated in global data at index:', index, 'New item:', updatedItem.name);
        console.log('Updated item icon URL:', updatedItem.icon ? 'Present' : 'Missing');
    } else {
        console.warn('Item not found for update (ID:', targetId, '), available IDs:', GlobalData.items.map(i => String(i.id)));
        console.warn('Adding as new item instead:', updatedItem.name);
        GlobalData.items.push(updatedItem);
    }
}

/**
 * Get count of items using a specific assetID
 * @param {number} assetID - The asset ID to count
 * @returns {number} Number of items using this asset
 */
function getItemAssetUsageCount(assetID) {
    return GlobalData.items.filter(item => item.assetID === assetID).length;
}

/**
 * Get all available item assetIDs
 * @returns {Array<number>} Array of all available item asset IDs
 */
function getAvailableItemAssetIDs() {
    return GlobalData.items
        .filter(item => item.assetID > 0)
        .map(item => item.assetID);
}

// === IMAGE HANDLING HELPERS ===

/**
 * Setup drag and drop functionality for an upload area
 * @param {HTMLElement} uploadArea - The element to setup drag and drop on
 * @param {Function} handleFileUpload - Callback function to handle file upload
 */
function setupDragAndDrop(uploadArea, handleFileUpload) {
    // Drag and drop
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });

    uploadArea.addEventListener('dragleave', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
    });

    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFileUpload(files[0]);
        }
    });
}

/**
 * Convert image to WebP format at specified dimensions with quality compression
 * @param {File} file - The image file to convert
 * @param {number} width - Target width in pixels (default: 256)
 * @param {number} height - Target height in pixels (default: same as width)
 * @param {number} quality - Quality compression 0-1 (default: 0.7)
 * @returns {Promise<Blob>} Promise that resolves to WebP blob
 */
async function convertImageToWebP(file, width = 256, height = null, quality = 0.7) {
    // If height not specified, use width (square)
    if (height === null) {
        height = width;
    }
    
    return new Promise((resolve, reject) => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const img = new Image();
        
        img.onload = () => {
            // Set canvas to desired dimensions
            canvas.width = width;
            canvas.height = height;
            
            // Clear canvas with transparent background
            ctx.clearRect(0, 0, width, height);
            
            // Draw and stretch image to fill entire canvas
            ctx.drawImage(img, 0, 0, width, height);
            
            // Convert to WebP with quality compression
            canvas.toBlob(
                (blob) => {
                    if (blob) {
                        resolve(blob);
                    } else {
                        reject(new Error('Failed to convert image to WebP'));
                    }
                }, 
                'image/webp', 
                quality
            );
        };
        
        img.onerror = () => {
            reject(new Error('Failed to load image'));
        };
        
        img.src = URL.createObjectURL(file);
    });
}

/**
 * Convert a blob to base64 string
 * @param {Blob} blob - The blob to convert
 * @returns {Promise<string>} Promise that resolves to base64 string
 */
function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

console.log('🌍 Global Data Manager loaded - ready to load effects and enemies data from server');
