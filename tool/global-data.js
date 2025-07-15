// Global Data Management JavaScript
// This file manages globally accessible data loaded from the server

// === GLOBAL DATA STORAGE ===
const GlobalData = {
    effects: [],           // Array of all effects from database
    enemies: [],           // Array of all complete enemy data with signed URLs
    isLoaded: false,       // Flag to track if data has been loaded
    loadPromise: null      // Promise to prevent multiple simultaneous loads
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

// === GLOBAL DATA LOADING FUNCTIONS ===

/**
 * Load all effects data from the server
 * @returns {Promise<Array>} Promise that resolves to array of effects
 */
async function loadEffectsData() {
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
            console.log('=== EFFECTS DATA LOADED ===');
            console.log('Success:', data.success);
            console.log('Effects count:', data.effects ? data.effects.length : 0);
            console.log('Effects data:', data.effects);
            
            // Store the loaded effects
            GlobalData.effects = data.effects || [];
            GlobalData.isLoaded = true;
            
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
    }
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
            console.log('=== ENEMIES DATA LOADED ===');
            console.log('Success:', data.success);
            console.log('Effects count from enemies endpoint:', data.effects ? data.effects.length : 0);
            console.log('Enemies count:', data.enemies ? data.enemies.length : 0);
            console.log('Enemies data:', data.enemies);
            
            // Store the loaded enemies data
            GlobalData.enemies = data.enemies || [];
            // Don't override effects data if already loaded separately
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
 * Initialize global data - loads all necessary data from server
 * @returns {Promise<void>} Promise that resolves when all data is loaded
 */
async function initializeGlobalData() {
    // Prevent multiple simultaneous loads
    if (GlobalData.loadPromise) {
        return GlobalData.loadPromise;
    }

    // Return existing data if already loaded
    if (GlobalData.isLoaded) {
        console.log('Global data already loaded, skipping reload');
        return Promise.resolve();
    }

    // Create load promise
    GlobalData.loadPromise = (async () => {
        try {
            console.log('=== INITIALIZING GLOBAL DATA ===');
            
            // Load effects data first, then enemies data
            await loadEffectsData();
            await loadEnemiesData();
            
            GlobalData.isLoaded = true;
            
            console.log('=== GLOBAL DATA INITIALIZATION COMPLETE ===');
            console.log('Effects loaded:', GlobalData.effects.length);
            console.log('Enemies loaded:', GlobalData.enemies.length);
            
        } catch (error) {
            console.error('Failed to initialize global data:', error);
            // Reset load promise so it can be retried
            GlobalData.loadPromise = null;
            throw error;
        }
    })();

    return GlobalData.loadPromise;
}

/**
 * Force reload all global data from server
 * @returns {Promise<void>} Promise that resolves when data is reloaded
 */
async function reloadGlobalData() {
    console.log('Force reloading global data...');
    GlobalData.isLoaded = false;
    GlobalData.loadPromise = null;
    GlobalData.effects = [];
    GlobalData.enemies = [];
    
    return await initializeGlobalData();
}

// === DATA ACCESS FUNCTIONS ===

/**
 * Get all effects data
 * @returns {Array} Array of effects
 */
function getEffects() {
    if (!GlobalData.isLoaded) {
        console.warn('Effects data not loaded yet. Call initializeGlobalData() first.');
        return [];
    }
    return GlobalData.effects;
}

/**
 * Get effect by ID
 * @param {number|string} effectId - The effect ID to find
 * @returns {Object|null} Effect object or null if not found
 */
function getEffectById(effectId) {
    if (!GlobalData.isLoaded) {
        console.warn('Effects data not loaded yet. Call initializeGlobalData() first.');
        return null;
    }
    
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
    if (!GlobalData.isLoaded) {
        console.warn('Enemies data not loaded yet. Call initializeGlobalData() first.');
        return [];
    }
    return GlobalData.enemies;
}

/**
 * Get enemy by ID
 * @param {number|string} enemyId - The enemy ID to find
 * @returns {Object|null} Enemy object or null if not found
 */
function getEnemyById(enemyId) {
    if (!GlobalData.isLoaded) {
        console.warn('Enemies data not loaded yet. Call initializeGlobalData() first.');
        return null;
    }
    
    const id = parseInt(enemyId);
    return GlobalData.enemies.find(enemy => enemy.id === id) || null;
}

/**
 * Get enemy by assetID
 * @param {number|string} assetID - The asset ID to find
 * @returns {Object|null} Enemy object or null if not found
 */
function getEnemyByAssetID(assetID) {
    if (!GlobalData.isLoaded) {
        console.warn('Enemies data not loaded yet. Call initializeGlobalData() first.');
        return null;
    }
    
    const id = parseInt(assetID);
    return GlobalData.enemies.find(enemy => enemy.assetID === id) || null;
}

/**
 * Get all enemies with assets (for gallery display)
 * @returns {Array} Array of enemies that have icons
 */
function getEnemiesWithAssets() {
    if (!GlobalData.isLoaded) {
        console.warn('Enemies data not loaded yet. Call initializeGlobalData() first.');
        return [];
    }
    return GlobalData.enemies.filter(enemy => enemy.icon && enemy.assetID > 0);
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
    if (!GlobalData.isLoaded) {
        console.warn('Enemies data not loaded yet. Call initializeGlobalData() first.');
        return [];
    }
    return GlobalData.enemies
        .filter(enemy => enemy.assetID > 0)
        .map(enemy => enemy.assetID);
}

/**
 * Check if global data is loaded and ready
 * @returns {boolean} True if data is loaded
 */
function isGlobalDataLoaded() {
    return GlobalData.isLoaded;
}

/**
 * Add a new enemy to the global enemies array
 * @param {Object} enemy - The enemy object to add
 */
function addEnemyToGlobal(enemy) {
    if (!GlobalData.isLoaded) {
        console.warn('Global data not loaded yet. Call initializeGlobalData() first.');
        return;
    }
    
    console.log('Adding enemy to global data:', enemy.name, 'ID:', enemy.id);
    GlobalData.enemies.push(enemy);
    console.log('✅ Enemy added. Total enemies:', GlobalData.enemies.length);
}

/**
 * Update an existing enemy in the global enemies array
 * @param {Object} updatedEnemy - The updated enemy object
 */
function updateEnemyInGlobal(updatedEnemy) {
    if (!GlobalData.isLoaded) {
        console.warn('Global data not loaded yet. Call initializeGlobalData() first.');
        return;
    }
    
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

// === INITIALIZATION ===

/**
 * Auto-initialize global data when this script loads
 * This will be called automatically after successful login
 */
function autoInitializeGlobalData() {
    // Check if we're authenticated before trying to load data
    if (typeof getCurrentAccessToken === 'function') {
        getCurrentAccessToken().then(token => {
            if (token) {
                console.log('Authentication detected, auto-initializing global data...');
                initializeGlobalData().catch(error => {
                    console.error('Auto-initialization failed:', error);
                });
            } else {
                console.log('No authentication found, skipping auto-initialization');
            }
        }).catch(error => {
            console.log('Authentication check failed, skipping auto-initialization:', error);
        });
    } else {
        console.log('getCurrentAccessToken not available, skipping auto-initialization');
    }
}

// Auto-initialize when DOM is ready (if not already initialized)
document.addEventListener('DOMContentLoaded', function() {
    // Delay auto-initialization to ensure other scripts are loaded
    setTimeout(autoInitializeGlobalData, 1000);
});

console.log('🌍 Global Data Manager loaded - ready to load effects and enemies data from server');
