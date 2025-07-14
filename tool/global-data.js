// Global Data Management JavaScript
// This file manages globally accessible data loaded from the server

// === GLOBAL DATA STORAGE ===
const GlobalData = {
    effects: [],           // Array of all effects from database
    enemyAssets: [],       // Array of all enemy assets with signed URLs
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

// === ENEMY ASSET DATA STRUCTURE ===
// Matches server-side asset structure
const EnemyAsset = {
    create: (assetID, texture) => ({
        assetID: assetID,     // Asset ID from database - JSON: "assetID"
        texture: texture      // Signed URL for the asset - JSON: "texture"
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
 * Load all enemy assets data from the server
 * @returns {Promise<Array>} Promise that resolves to array of enemy assets
 */
async function loadEnemyAssetsData() {
    try {
        // Get current access token
        const token = await getCurrentAccessToken();
        if (!token) {
            console.error('Authentication required to load enemy assets data');
            throw new Error('Authentication required');
        }

        console.log('Loading enemy assets data from server...');

        const response = await fetch('http://localhost:8080/api/getEnemyAssets', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            const data = await response.json();
            console.log('=== ENEMY ASSETS DATA LOADED ===');
            console.log('Success:', data.success);
            console.log('Assets count:', data.assets ? data.assets.length : 0);
            console.log('Assets data:', data.assets);
            
            // Store the loaded enemy assets
            GlobalData.enemyAssets = data.assets || [];
            
            console.log('✅ Enemy assets data loaded successfully:', GlobalData.enemyAssets.length, 'assets');
            return GlobalData.enemyAssets;
            
        } else {
            const error = await response.text();
            console.error('Failed to load enemy assets data:', error);
            throw new Error(`Server error: ${error}`);
        }

    } catch (error) {
        console.error('Error loading enemy assets data:', error);
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
            
            // Load effects data and enemy assets in parallel for better performance
            const [effectsResult, assetsResult] = await Promise.all([
                loadEffectsData(),
                loadEnemyAssetsData()
            ]);
            
            GlobalData.isLoaded = true;
            
            console.log('=== GLOBAL DATA INITIALIZATION COMPLETE ===');
            console.log('Effects loaded:', GlobalData.effects.length);
            console.log('Enemy assets loaded:', GlobalData.enemyAssets.length);
            
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
    GlobalData.enemyAssets = [];
    
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
 * Get all enemy assets data
 * @returns {Array} Array of enemy assets
 */
function getEnemyAssets() {
    if (!GlobalData.isLoaded) {
        console.warn('Enemy assets data not loaded yet. Call initializeGlobalData() first.');
        return [];
    }
    return GlobalData.enemyAssets;
}

/**
 * Get enemy asset by assetID
 * @param {number|string} assetID - The asset ID to find
 * @returns {Object|null} Enemy asset object or null if not found
 */
function getEnemyAssetById(assetID) {
    if (!GlobalData.isLoaded) {
        console.warn('Enemy assets data not loaded yet. Call initializeGlobalData() first.');
        return null;
    }
    
    const id = parseInt(assetID);
    return GlobalData.enemyAssets.find(asset => asset.assetID === id) || null;
}

/**
 * Get texture URL by assetID (useful for displaying asset images)
 * @param {number|string} assetID - The asset ID
 * @returns {string} Texture URL or empty string if not found
 */
function getEnemyAssetTexture(assetID) {
    const asset = getEnemyAssetById(assetID);
    return asset ? asset.texture : '';
}

/**
 * Get all available assetIDs
 * @returns {Array<number>} Array of all available asset IDs
 */
function getAvailableAssetIDs() {
    if (!GlobalData.isLoaded) {
        console.warn('Enemy assets data not loaded yet. Call initializeGlobalData() first.');
        return [];
    }
    return GlobalData.enemyAssets.map(asset => asset.assetID);
}

/**
 * Check if global data is loaded and ready
 * @returns {boolean} True if data is loaded
 */
function isGlobalDataLoaded() {
    return GlobalData.isLoaded;
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

console.log('🌍 Global Data Manager loaded - ready to load effects and enemy assets from server');
