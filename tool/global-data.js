// Global Data Management JavaScript
// This file manages globally accessible data loaded from the server

// === GLOBAL DATA STORAGE ===
const GlobalData = {
    effects: [],           // Array of all effects from database
    coreEffects: [],       // Array of core effect behavior definitions
    effectSlots: [],       // Enum options for effect item slots
    effectTriggerTypes: [], // Enum options for effect triggers
    effectFactorTypes: [], // Enum options for effect factor interpretation
    effectConditionTypes: [], // Enum options for optional effect conditions
    effectAssets: [],      // Array of available effect assets from S3
    enemies: [],           // Array of all complete enemy data with signed URLs
    pendingEnemies: [],    // Array of pending enemies from tooling
    enemyAssets: [],       // Array of available enemy assets from S3
    talents: [],           // Array of talent tree template (game.talents_info)
    perks: [],             // Array of all complete perk data with signed URLs
    pendingPerks: [],      // Array of pending perks from tooling.perks_info
    perkAssets: [],        // Array of available perk assets from S3
    items: [],             // Array of all complete item data with signed URLs
    pendingItems: [],      // Array of pending items from tooling.items
    itemAssets: [],        // Array of available item assets from S3
    npcs: [],              // Array of all NPCs from game.npcs
    servers: [],           // Array of all server records from management.servers
    recentEvents: [],      // Array of all global recent events from game.recent_events
    settlements: [],       // Array of all settlements from game.world_info
    quests: [],            // Array of all quests from game.quests (all settlements)
    questChains: [],       // Array of all quest chains from game.questchain (all settlements)
    expeditions: [],       // Array of all expedition graphs from game.expeditions
    settlementAssets: [],  // Array of available settlement assets from S3
    questAssets: [],       // Array of available quest assets from S3 (images/quests)
    expeditionMapAssets: [], // Array of expedition map assets from S3 (images/expedition-maps)
    cosmetics: [],         // Array of all cosmetics from game.cosmetics
    cosmeticAssets: []     // Array of available cosmetic assets from S3
};

let expeditionDataVersion = 0;
let expeditionsLoadingPromise = null;

const DEFAULT_ASSET_PUBLIC_BASE_URL = 'https://pub-b959ac8ae579488bb4ed33c01a618ae2.r2.dev';
const ASSET_PUBLIC_BASE_URL = String(window.ASSET_PUBLIC_BASE_URL || DEFAULT_ASSET_PUBLIC_BASE_URL).replace(/\/+$/, '');
const GLOBAL_DATA_LOG_PREFIX = '[GlobalData]';

function getAssetPublicBaseUrl() {
    return ASSET_PUBLIC_BASE_URL;
}

function buildPublicAssetUrl(path) {
    if (!path) return '';
    return `${ASSET_PUBLIC_BASE_URL}/${String(path).replace(/^\/+/, '')}`;
}

async function fetchAuthenticatedJson(url, options = {}) {
    const { jsonBody, headers = {}, expectSuccess = false, ...fetchOptions } = options;
    const token = await getCurrentAccessToken();
    if (!token) throw new Error('Authentication required');

    const requestHeaders = {
        'Authorization': `Bearer ${token}`,
        ...(jsonBody !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
    };

    const response = await fetch(url, {
        ...fetchOptions,
        headers: requestHeaders,
        body: jsonBody !== undefined ? JSON.stringify(jsonBody) : fetchOptions.body,
    });

    const rawBody = await response.text();
    let payload = null;
    if (rawBody) {
        try {
            payload = JSON.parse(rawBody);
        } catch {
            payload = null;
        }
    }

    if (!response.ok) {
        const message = payload?.message || rawBody || `HTTP ${response.status}`;
        throw new Error(message);
    }

    if (expectSuccess && payload?.success === false) {
        throw new Error(payload.message || 'Request failed');
    }

    return payload;
}

function getAuthenticatedJson(url, options = {}) {
    return fetchAuthenticatedJson(url, { ...options, method: options.method || 'GET' });
}

function postAuthenticatedJson(url, jsonBody, options = {}) {
    return fetchAuthenticatedJson(url, { ...options, method: options.method || 'POST', jsonBody });
}

const globalDataSubscribers = new Map();

// === ASSET IMAGE CACHE ===
const assetObjectUrlCache = new Map();
const ASSET_CACHE_CONCURRENCY = 6;

function getAssetCacheKey(type, assetId) {
    return `${type}:${assetId}`;
}

function clearAssetCacheForType(type) {
    const prefix = `${type}:`;
    for (const [key, entry] of assetObjectUrlCache.entries()) {
        if (!key.startsWith(prefix)) continue;
        if (entry?.url) {
            try {
                URL.revokeObjectURL(entry.url);
            } catch (error) {
                console.warn('Failed to revoke asset URL', key, error);
            }
        }
        assetObjectUrlCache.delete(key);
    }
}

async function ensureAssetCached({ type, asset, idKey, urlKey, remoteKey }) {
    if (!asset) return null;
    const assetId = asset[idKey];
    if (assetId === undefined || assetId === null) return null;

    const currentUrl = asset[urlKey];
    if (typeof currentUrl === 'string' && currentUrl.startsWith('blob:')) {
        return currentUrl;
    }

    const remoteUrl = asset[remoteKey] || currentUrl;
    if (!remoteUrl) return null;

    const cacheKey = getAssetCacheKey(type, assetId);
    const existingEntry = assetObjectUrlCache.get(cacheKey);

    if (existingEntry?.url) {
        asset[urlKey] = existingEntry.url;
        if (!asset[remoteKey]) {
            asset[remoteKey] = existingEntry.remoteUrl || remoteUrl;
        }
        return existingEntry.url;
    }

    if (existingEntry?.promise) {
        return existingEntry.promise.then((cachedUrl) => {
            if (cachedUrl) {
                asset[urlKey] = cachedUrl;
                if (!asset[remoteKey]) {
                    asset[remoteKey] = existingEntry.remoteUrl || remoteUrl;
                }
            }
            return cachedUrl;
        });
    }

    // Public R2 URLs don't need blob caching — use directly
    if (remoteUrl.startsWith(ASSET_PUBLIC_BASE_URL)) {
        asset[urlKey] = remoteUrl;
        asset[remoteKey] = remoteUrl;
        assetObjectUrlCache.set(cacheKey, { url: remoteUrl, remoteUrl });
        return remoteUrl;
    }

    const entry = { remoteUrl };
    const loadPromise = fetch(remoteUrl, { mode: 'cors', credentials: 'omit' })
        .then((response) => {
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            return response.blob();
        })
        .then((blob) => {
            const objectUrl = URL.createObjectURL(blob);
            entry.url = objectUrl;
            asset[urlKey] = objectUrl;
            asset[remoteKey] = remoteUrl;
            assetObjectUrlCache.set(cacheKey, { url: objectUrl, remoteUrl });
            return objectUrl;
        })
        .catch((error) => {
            console.warn(`Asset cache skipped for ${type} #${assetId}`, error);
            asset[urlKey] = remoteUrl;
            asset[remoteKey] = remoteUrl;
            assetObjectUrlCache.delete(cacheKey);
            return null;
        });

    entry.promise = loadPromise;
    assetObjectUrlCache.set(cacheKey, entry);
    return loadPromise;
}

async function cacheAssetList(type, assets, config = {}) {
    if (!Array.isArray(assets) || assets.length === 0) return;

    const idKey = config.idKey || 'id';
    const urlKey = config.urlKey || 'url';
    const remoteKey = config.remoteKey || `remote${urlKey.charAt(0).toUpperCase()}${urlKey.slice(1)}`;
    const concurrency = Math.min(config.concurrency || ASSET_CACHE_CONCURRENCY, assets.length);

    let nextIndex = 0;
    async function worker() {
        while (true) {
            const currentIndex = nextIndex++;
            if (currentIndex >= assets.length) break;
            const asset = assets[currentIndex];
            if (!asset || !asset[urlKey]) continue;
            if (!asset[remoteKey]) {
                asset[remoteKey] = asset[urlKey];
            }
            await ensureAssetCached({ type, asset, idKey, urlKey, remoteKey });
        }
    }

    const workers = [];
    for (let i = 0; i < concurrency; i++) {
        workers.push(worker());
    }
    await Promise.all(workers);
}

function getGlobalDataSnapshot(key) {
    if (!key) return undefined;
    return GlobalData[key];
}

function buildGlobalDataSummary() {
    return {
        effects: GlobalData.effects.length,
        effectAssets: GlobalData.effectAssets.length,
        enemies: GlobalData.enemies.length,
        perks: GlobalData.perks.length,
        items: GlobalData.items.length,
        npcs: GlobalData.npcs.length,
        servers: GlobalData.servers.length,
        recentEvents: GlobalData.recentEvents.length,
        settlements: GlobalData.settlements.length,
        quests: GlobalData.quests.length,
        questChains: GlobalData.questChains.length,
        expeditions: GlobalData.expeditions.length,
        questAssets: GlobalData.questAssets.length,
        settlementAssets: GlobalData.settlementAssets.length,
        expeditionMapAssets: GlobalData.expeditionMapAssets.length,
        perkAssets: GlobalData.perkAssets.length,
        itemAssets: GlobalData.itemAssets.length,
        enemyAssets: GlobalData.enemyAssets.length,
        cosmetics: GlobalData.cosmetics.length,
        cosmeticAssets: GlobalData.cosmeticAssets.length,
    };
}

function notifyGlobalDataChange(key, payload) {
    const listeners = globalDataSubscribers.get(key);
    if (!listeners || listeners.size === 0) return;
    const snapshot = payload !== undefined ? payload : getGlobalDataSnapshot(key);
    listeners.forEach((handler) => {
        try {
            handler(snapshot);
        } catch (error) {
            console.error('Global data subscriber error for key', key, error);
        }
    });
}

function subscribeToGlobalData(key, handler, options = {}) {
    if (!key || typeof handler !== 'function') {
        return () => {};
    }
    if (!globalDataSubscribers.has(key)) {
        globalDataSubscribers.set(key, new Set());
    }
    const listeners = globalDataSubscribers.get(key);
    listeners.add(handler);
    if (!options.skipInitial) {
        try {
            handler(getGlobalDataSnapshot(key));
        } catch (error) {
            console.error('Global data initial delivery failed for key', key, error);
        }
    }
    return () => {
        listeners.delete(handler);
        if (listeners.size === 0) {
            globalDataSubscribers.delete(key);
        }
    };
}

function setGlobalArray(key, values) {
    if (!Array.isArray(GlobalData[key])) {
        GlobalData[key] = [];
    }
    const target = GlobalData[key];
    // If the source array is the same reference as the target, just notify
    // (clearing target first would destroy the source data)
    if (target !== values) {
        target.length = 0;
        if (Array.isArray(values)) {
            target.push(...values);
        }
    }
    notifyGlobalDataChange(key, target);
    return target;
}

if (typeof window !== 'undefined') {
    window.GlobalData = GlobalData;
    window.subscribeToGlobalData = subscribeToGlobalData;
    window.notifyGlobalDataChange = notifyGlobalDataChange;
    window.getGlobalDataSnapshot = getGlobalDataSnapshot;
    window.setGlobalArray = setGlobalArray;
    window.fetchAuthenticatedJson = fetchAuthenticatedJson;
    window.getAuthenticatedJson = getAuthenticatedJson;
    window.postAuthenticatedJson = postAuthenticatedJson;
    window.preloadGlobalData = preloadGlobalData;
    window.syncAfterSave = syncAfterSave;
    window.getGlobalDataSummary = buildGlobalDataSummary;
    window.getAssetPublicBaseUrl = getAssetPublicBaseUrl;
    window.buildPublicAssetUrl = buildPublicAssetUrl;
    window.loadServersData = loadServersData;
    window.getServersData = getServersData;
    window.loadRecentEventsData = loadRecentEventsData;
    window.getRecentEventsData = getRecentEventsData;
    window.loadEffectAssets = loadEffectAssets;
    window.getEffectAssets = getEffectAssets;
    window.loadSettlementsData = loadSettlementsData;
    window.getSettlements = getSettlements;
    window.loadQuestAssetsData = loadQuestAssetsData;
    window.getQuestAssets = getQuestAssets;
    window.loadExpeditionMapAssetsData = loadExpeditionMapAssetsData;
    window.getExpeditionMapAssets = getExpeditionMapAssets;
    window.loadQuestsData = loadQuestsData;
    window.getQuestsData = getQuestsData;
    window.getQuestChainsData = getQuestChainsData;
    window.loadExpeditionsData = loadExpeditionsData;
    window.getExpeditionsData = getExpeditionsData;
}

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
let effectAssetsLoadingPromise = null;
let enemiesLoadingPromise = null;
let perksLoadingPromise = null;
let itemsLoadingPromise = null;
let perkAssetsLoadingPromise = null;
let itemAssetsLoadingPromise = null;
let settlementsLoadingPromise = null;
let questsLoadingPromise = null;
let questAssetsLoadingPromise = null;
let settlementAssetsLoadingPromise = null;
let expeditionMapAssetsLoadingPromise = null;
let enemyAssetsLoadingPromise = null;
let npcsLoadingPromise = null;
let serversLoadingPromise = null;
let recentEventsLoadingPromise = null;
let cosmeticsLoadingPromise = null;
let cosmeticAssetsLoadingPromise = null;

// --- Effects ---
async function loadEffectsData(options = {}) {
    const forceReload = options?.forceReload === true;
    if (!forceReload && GlobalData.effects.length > 0) {
        return GlobalData.effects;
    }
    if (effectsLoadingPromise) return effectsLoadingPromise;

    effectsLoadingPromise = (async () => {
        try {
            const token = await getCurrentAccessToken();
            if (!token) throw new Error('Authentication required');
            const response = await fetch('/api/getEffects', {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
            });
            if (response.ok) {
                const data = await response.json();
                setGlobalArray('effects', data.effects || []);
                setGlobalArray('coreEffects', data.coreEffects || []);
                setGlobalArray('effectSlots', data.slots || []);
                setGlobalArray('effectTriggerTypes', data.triggerTypes || []);
                setGlobalArray('effectFactorTypes', data.factorTypes || []);
                setGlobalArray('effectConditionTypes', data.conditionTypes || []);
                return GlobalData.effects;
            } else {
                throw new Error('Server error: ' + await response.text());
            }
        } catch (error) {
            console.error('Error loading effects:', error);
            throw error;
        } finally {
            effectsLoadingPromise = null;
        }
    })();
    return effectsLoadingPromise;
}

async function loadEffectAssets(options = {}) {
    const forceReload = options?.forceReload === true;
    if (!forceReload && GlobalData.effectAssets.length > 0) {
        return GlobalData.effectAssets;
    }
    if (effectAssetsLoadingPromise) return effectAssetsLoadingPromise;

    effectAssetsLoadingPromise = (async () => {
        try {
            const token = await getCurrentAccessToken();
            if (!token) throw new Error('Authentication required');
            const response = await fetch('/api/getEffectAssets', {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
            });
            if (response.ok) {
                const data = await response.json();
                const rawAssets = Array.isArray(data) ? data : (data.assets || []);
                const normalizedAssets = rawAssets.map((asset) => ({
                    ...asset,
                    id: asset.id ?? asset.assetID,
                    url: asset.url || asset.icon,
                    remoteUrl: asset.remoteUrl || asset.url || asset.icon
                }));
                clearAssetCacheForType('effect');
                await cacheAssetList('effect', normalizedAssets, {
                    idKey: 'id',
                    urlKey: 'url',
                    remoteKey: 'remoteUrl'
                });
                setGlobalArray('effectAssets', normalizedAssets);
                return GlobalData.effectAssets;
            } else {
                throw new Error('Server error: ' + await response.text());
            }
        } catch (error) {
            console.error('Error loading effect assets:', error);
            throw error;
        } finally {
            effectAssetsLoadingPromise = null;
        }
    })();
    return effectAssetsLoadingPromise;
}

function getEffectAssets() {
    return GlobalData.effectAssets;
}

// --- Enemies ---
async function loadEnemiesData(options = {}) {
    const forceReload = options?.forceReload === true;
    if (!forceReload && GlobalData.enemies.length > 0) {
        return GlobalData.enemies;
    }
    if (enemiesLoadingPromise) return enemiesLoadingPromise;

    enemiesLoadingPromise = (async () => {
        try {
            const token = await getCurrentAccessToken();
            if (!token) throw new Error('Authentication required');
            const response = await fetch('/api/getEnemies', {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
            });
            if (response.ok) {
                const data = await response.json();
                setGlobalArray('enemies', data.enemies || []);
                setGlobalArray('pendingEnemies', data.pendingEnemies || []);
                // The getEnemies endpoint also returns talents, perks, effects
                if (data.talents && data.talents.length > 0) {
                    setGlobalArray('talents', data.talents);
                }
                if (data.perks && data.perks.length > 0 && GlobalData.perks.length === 0) {
                    setGlobalArray('perks', data.perks);
                }
                if (data.effects && data.effects.length > 0 && GlobalData.effects.length === 0) {
                    setGlobalArray('effects', data.effects);
                }
                return GlobalData.enemies;
            } else {
                throw new Error('Server error: ' + await response.text());
            }
        } catch (error) {
            console.error('Error loading enemies:', error);
            throw error;
        } finally {
            enemiesLoadingPromise = null;
        }
    })();
    return enemiesLoadingPromise;
}

// --- Perks ---
async function loadPerksData(options = {}) {
    const forceReload = options?.forceReload === true;
    if (!forceReload && GlobalData.perks.length > 0) {
        return GlobalData.perks;
    }
    if (perksLoadingPromise) return perksLoadingPromise;

    perksLoadingPromise = (async () => {
        try {
            const token = await getCurrentAccessToken();
            if (!token) throw new Error('Authentication required');
            const response = await fetch('/api/getPerks', {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
            });
            if (response.ok) {
                const data = await response.json();
                setGlobalArray('perks', data.perks || []);
                setGlobalArray('pendingPerks', data.pendingPerks || []);
                if (data.effects && data.effects.length > 0 && GlobalData.effects.length === 0) {
                    setGlobalArray('effects', data.effects);
                }
                return GlobalData.perks;
            } else {
                throw new Error('Server error: ' + await response.text());
            }
        } catch (error) {
            console.error('Error loading perks:', error);
            throw error;
        } finally {
            perksLoadingPromise = null;
        }
    })();
    return perksLoadingPromise;
}

// --- Items ---
async function loadItemsData(options = {}) {
    const forceReload = options?.forceReload === true;
    if (!forceReload && GlobalData.items.length > 0) {
        return GlobalData.items;
    }
    if (itemsLoadingPromise) return itemsLoadingPromise;

    itemsLoadingPromise = (async () => {
        try {
            const token = await getCurrentAccessToken();
            if (!token) throw new Error('Authentication required');
            const response = await fetch('/api/getItems', {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
            });
            if (response.ok) {
                const data = await response.json();
                setGlobalArray('items', data.items || []);
                setGlobalArray('pendingItems', data.pendingItems || []);
                if (data.effects && data.effects.length > 0 && GlobalData.effects.length === 0) {
                    setGlobalArray('effects', data.effects);
                }
                return GlobalData.items;
            } else {
                throw new Error('Server error: ' + await response.text());
            }
        } catch (error) {
            console.error('Error loading items:', error);
            throw error;
        } finally {
            itemsLoadingPromise = null;
        }
    })();
    return itemsLoadingPromise;
}

function getPendingItems() {
    return GlobalData.pendingItems;
}

function getPendingPerks() {
    return GlobalData.pendingPerks;
}

// --- Perk Assets (S3) – shared by perk-designer & talent-designer ---
async function loadPerkAssets(options = {}) {
    const forceReload = options?.forceReload === true;
    if (!forceReload && GlobalData.perkAssets.length > 0) {
        return GlobalData.perkAssets;
    }
    if (perkAssetsLoadingPromise) return perkAssetsLoadingPromise;

    perkAssetsLoadingPromise = (async () => {
        try {
            const token = await getCurrentAccessToken();
            if (!token) throw new Error('Authentication required');
            const response = await fetch('/api/getPerkAssets', {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
            });
            if (response.ok) {
                const data = await response.json();
                const rawAssets = Array.isArray(data?.assets) ? data.assets : [];
                const normalizedAssets = rawAssets.map((asset) => ({
                    ...asset,
                    remoteIcon: asset.icon
                }));
                clearAssetCacheForType('perk');
                await cacheAssetList('perk', normalizedAssets, {
                    idKey: 'assetID',
                    urlKey: 'icon',
                    remoteKey: 'remoteIcon'
                });
                setGlobalArray('perkAssets', normalizedAssets);
                return GlobalData.perkAssets;
            } else {
                throw new Error('Server error: ' + await response.text());
            }
        } catch (error) {
            console.error('Error loading perk assets:', error);
            throw error;
        } finally {
            perkAssetsLoadingPromise = null;
        }
    })();
    return perkAssetsLoadingPromise;
}

function getPerkAssets() {
    return GlobalData.perkAssets;
}

// --- Item Assets (S3) ---
async function loadItemAssets(options = {}) {
    const forceReload = options?.forceReload === true;
    if (!forceReload && GlobalData.itemAssets.length > 0) {
        return GlobalData.itemAssets;
    }
    if (itemAssetsLoadingPromise) return itemAssetsLoadingPromise;

    itemAssetsLoadingPromise = (async () => {
        try {
            const token = await getCurrentAccessToken();
            if (!token) throw new Error('Authentication required');
            const response = await fetch('/api/getItemAssets', {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
            });
            if (response.ok) {
                const data = await response.json();
                const rawAssets = Array.isArray(data?.assets) ? data.assets : [];
                const normalizedAssets = rawAssets.map((asset) => ({
                    ...asset,
                    remoteIcon: asset.icon
                }));
                clearAssetCacheForType('item');
                await cacheAssetList('item', normalizedAssets, {
                    idKey: 'assetID',
                    urlKey: 'icon',
                    remoteKey: 'remoteIcon'
                });
                setGlobalArray('itemAssets', normalizedAssets);
                return GlobalData.itemAssets;
            } else {
                throw new Error('Server error: ' + await response.text());
            }
        } catch (error) {
            console.error('Error loading item assets:', error);
            throw error;
        } finally {
            itemAssetsLoadingPromise = null;
        }
    })();
    return itemAssetsLoadingPromise;
}

function getItemAssets() {
    return GlobalData.itemAssets;
}

// --- Settlements ---
async function loadSettlementsData(options = {}) {
    const forceReload = options?.forceReload === true;
    if (!forceReload && GlobalData.settlements.length > 0) {
        return GlobalData.settlements;
    }
    if (settlementsLoadingPromise) return settlementsLoadingPromise;

    settlementsLoadingPromise = (async () => {
        try {
            const token = await getCurrentAccessToken();
            if (!token) throw new Error('Authentication required');
            const response = await fetch('/api/getSettlements', {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
            });
            if (response.ok) {
                const data = await response.json();
                if (data.success && data.settlements) {
                    setGlobalArray('settlements', data.settlements);
                }
                console.log(`${GLOBAL_DATA_LOG_PREFIX} settlements loaded`, { count: GlobalData.settlements.length });
                return GlobalData.settlements;
            } else {
                throw new Error('Server error: ' + await response.text());
            }
        } catch (error) {
            console.error('Error loading settlements:', error);
            throw error;
        } finally {
            settlementsLoadingPromise = null;
        }
    })();
    return settlementsLoadingPromise;
}

function getSettlements() {
    return GlobalData.settlements;
}

function normalizeExpeditionGraph(expedition) {
    if (!expedition || typeof expedition !== 'object') return null;
    return {
        expedition_id: Number(expedition.expedition_id || 0),
        settlement_id: Number(expedition.settlement_id || 0),
        map_asset_id: expedition.map_asset_id == null ? null : Number(expedition.map_asset_id),
        version: Number(expedition.version || 0),
        nodes: Array.isArray(expedition.nodes) ? expedition.nodes.map((node) => ({
            node_id: Number(node.node_id || 0),
            client_id: Number(node.client_id || node.node_id || 0),
            location_id: node.location_id == null ? null : Number(node.location_id),
            is_start: !!node.is_start,
            pos_x: Number(node.pos_x || 0),
            pos_y: Number(node.pos_y || 0),
            label: node.label || null,
        })) : [],
        edges: Array.isArray(expedition.edges) ? expedition.edges.map((edge) => ({
            edge_id: Number(edge.edge_id || 0),
            node_a: Number(edge.node_a || 0),
            node_b: Number(edge.node_b || 0),
            a_client_id: Number(edge.a_client_id || edge.node_a || 0),
            b_client_id: Number(edge.b_client_id || edge.node_b || 0),
        })) : [],
    };
}

function applyExpeditionDelta(payload, options = {}) {
    const reset = options?.reset === true;
    const nextVersion = Number(payload?.version || 0);
    const incomingExpeditions = Array.isArray(payload?.expeditions)
        ? payload.expeditions.map(normalizeExpeditionGraph).filter(Boolean)
        : [];
    const deletedIDs = new Set(
        Array.isArray(payload?.deleted_expedition_ids)
            ? payload.deleted_expedition_ids.map((id) => Number(id)).filter((id) => id > 0)
            : []
    );

    const bySettlement = new Map();
    if (!reset) {
        for (const expedition of GlobalData.expeditions) {
            if (!expedition) continue;
            if (deletedIDs.has(Number(expedition.expedition_id || 0))) continue;
            bySettlement.set(Number(expedition.settlement_id || 0), expedition);
        }
    }
    for (const expedition of incomingExpeditions) {
        if (expedition.expedition_id <= 0 || expedition.settlement_id <= 0) continue;
        bySettlement.set(expedition.settlement_id, expedition);
    }

    expeditionDataVersion = nextVersion;
    return setGlobalArray('expeditions', Array.from(bySettlement.values()).sort((a, b) => a.settlement_id - b.settlement_id));
}

async function loadExpeditionsData(options = {}) {
    const forceReload = options?.forceReload === true;
    if (!forceReload && GlobalData.expeditions.length > 0) {
        return GlobalData.expeditions;
    }
    if (expeditionsLoadingPromise) return expeditionsLoadingPromise;

    expeditionsLoadingPromise = (async () => {
        try {
            const token = await getCurrentAccessToken();
            if (!token) throw new Error('Authentication required');
            const requestedVersion = forceReload ? 0 : expeditionDataVersion;
            const response = await fetch(`/api/getExpeditionVersioned?version=${requestedVersion}`, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
            });
            if (!response.ok) {
                throw new Error('Server error: ' + await response.text());
            }
            const payload = await response.json();
            applyExpeditionDelta(payload, { reset: forceReload || requestedVersion === 0 });
            console.log(`${GLOBAL_DATA_LOG_PREFIX} expeditions loaded`, {
                count: GlobalData.expeditions.length,
                version: expeditionDataVersion,
            });
            return GlobalData.expeditions;
        } catch (error) {
            console.error('Error loading expeditions:', error);
            throw error;
        } finally {
            expeditionsLoadingPromise = null;
        }
    })();
    return expeditionsLoadingPromise;
}

function getExpeditionsData() {
    return GlobalData.expeditions;
}

// --- Quests (all settlements) ---
async function loadQuestsData(options = {}) {
    const forceReload = options?.forceReload === true;
    if (!forceReload && GlobalData.quests.length > 0) {
        return GlobalData.quests;
    }
    if (questsLoadingPromise) return questsLoadingPromise;

    questsLoadingPromise = (async () => {
        try {
            const token = await getCurrentAccessToken();
            if (!token) throw new Error('Authentication required');
            const response = await fetch('/api/getQuests', {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
            });
            if (response.ok) {
                const data = await response.json();
                setGlobalArray('questChains', Array.isArray(data?.chains) ? data.chains : []);
                setGlobalArray('quests', Array.isArray(data?.quests) ? data.quests : []);
                console.log(`${GLOBAL_DATA_LOG_PREFIX} quests loaded`, {
                    count: GlobalData.quests.length,
                    chains: GlobalData.questChains.length,
                });
                return GlobalData.quests;
            } else {
                throw new Error('Server error: ' + await response.text());
            }
        } catch (error) {
            console.error('Error loading quests:', error);
            throw error;
        } finally {
            questsLoadingPromise = null;
        }
    })();
    return questsLoadingPromise;
}

function getQuestsData() {
    return GlobalData.quests;
}

function getQuestChainsData() {
    return GlobalData.questChains;
}

function getSettlementById(settlementId) {
    const id = parseInt(settlementId);
    return GlobalData.settlements.find(s => s.settlement_id === id) || null;
}

// --- Settlement Assets (S3) ---
async function loadSettlementAssetsData(options = {}) {
    const forceReload = options?.forceReload === true;
    if (!forceReload && GlobalData.settlementAssets.length > 0) {
        return GlobalData.settlementAssets;
    }
    if (settlementAssetsLoadingPromise) return settlementAssetsLoadingPromise;

    settlementAssetsLoadingPromise = (async () => {
        try {
            const token = await getCurrentAccessToken();
            if (!token) throw new Error('Authentication required');
            const response = await fetch('/api/getSettlementAssets', {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
            });
            if (response.ok) {
                const data = await response.json();
                const rawAssets = Array.isArray(data?.assets) ? data.assets : [];
                const normalizedAssets = rawAssets.map((asset) => ({
                    ...asset,
                    remoteUrl: asset.url
                }));
                clearAssetCacheForType('settlement');
                await cacheAssetList('settlement', normalizedAssets, {
                    idKey: 'id',
                    urlKey: 'url',
                    remoteKey: 'remoteUrl'
                });
                setGlobalArray('settlementAssets', normalizedAssets);
                return GlobalData.settlementAssets;
            } else {
                throw new Error('Server error: ' + await response.text());
            }
        } catch (error) {
            console.error('Error loading settlement assets:', error);
            throw error;
        } finally {
            settlementAssetsLoadingPromise = null;
        }
    })();

    return settlementAssetsLoadingPromise;
}

function getSettlementAssets() {
    return GlobalData.settlementAssets;
}

async function refreshSettlementsData() {
    setGlobalArray('settlements', []);
    return loadSettlementsData({ forceReload: true });
}

// --- Quest Assets (S3) ---
async function loadQuestAssetsData(options = {}) {
    const forceReload = options?.forceReload === true;
    if (!forceReload && GlobalData.questAssets.length > 0) {
        return GlobalData.questAssets;
    }
    if (questAssetsLoadingPromise) return questAssetsLoadingPromise;

    questAssetsLoadingPromise = (async () => {
        try {
            const token = await getCurrentAccessToken();
            if (!token) throw new Error('Authentication required');
            const response = await fetch('/api/getQuestAssets', {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
            });
            if (response.ok) {
                const data = await response.json();
                const rawAssets = Array.isArray(data) ? data : (data.assets || []);
                const normalizedAssets = rawAssets.map((asset) => ({
                    ...asset,
                    remoteUrl: asset.url
                }));
                clearAssetCacheForType('quest');
                await cacheAssetList('quest', normalizedAssets, {
                    idKey: 'id',
                    urlKey: 'url',
                    remoteKey: 'remoteUrl'
                });
                setGlobalArray('questAssets', normalizedAssets);
                return GlobalData.questAssets;
            } else {
                throw new Error('Server error: ' + await response.text());
            }
        } catch (error) {
            console.error('Error loading quest assets:', error);
            throw error;
        } finally {
            questAssetsLoadingPromise = null;
        }
    })();
    return questAssetsLoadingPromise;
}

function getQuestAssets() {
    return GlobalData.questAssets;
}

// --- Expedition Map Assets (S3) ---
async function loadExpeditionMapAssetsData(options = {}) {
    const forceReload = options?.forceReload === true;
    if (!forceReload && GlobalData.expeditionMapAssets.length > 0) {
        return GlobalData.expeditionMapAssets;
    }
    if (expeditionMapAssetsLoadingPromise) return expeditionMapAssetsLoadingPromise;

    expeditionMapAssetsLoadingPromise = (async () => {
        try {
            const token = await getCurrentAccessToken();
            if (!token) throw new Error('Authentication required');
            const response = await fetch('/api/getExpeditionMapAssets', {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
            });
            if (response.ok) {
                const data = await response.json();
                const rawAssets = Array.isArray(data) ? data : (data.assets || []);
                const normalizedAssets = rawAssets.map((asset) => ({
                    ...asset,
                    remoteIcon: asset.icon
                }));
                clearAssetCacheForType('expedition-map');
                await cacheAssetList('expedition-map', normalizedAssets, {
                    idKey: 'assetID',
                    urlKey: 'icon',
                    remoteKey: 'remoteIcon'
                });
                setGlobalArray('expeditionMapAssets', normalizedAssets);
                console.log(`${GLOBAL_DATA_LOG_PREFIX} expedition map assets loaded`, { count: GlobalData.expeditionMapAssets.length });
                return GlobalData.expeditionMapAssets;
            } else {
                throw new Error('Server error: ' + await response.text());
            }
        } catch (error) {
            console.error('Error loading expedition map assets:', error);
            throw error;
        } finally {
            expeditionMapAssetsLoadingPromise = null;
        }
    })();
    return expeditionMapAssetsLoadingPromise;
}

function getExpeditionMapAssets() {
    return GlobalData.expeditionMapAssets;
}

async function refreshQuestAssetsData() {
    setGlobalArray('questAssets', []);
    questAssetsLoadingPromise = null;
    return loadQuestAssetsData({ forceReload: true });
}

async function loadEnemyAssets(options = {}) {
    const forceReload = options?.forceReload === true;
    if (!forceReload && GlobalData.enemyAssets.length > 0) {
        return GlobalData.enemyAssets;
    }
    if (enemyAssetsLoadingPromise) return enemyAssetsLoadingPromise;

    enemyAssetsLoadingPromise = (async () => {
        try {
            const token = await getCurrentAccessToken();
            if (!token) throw new Error('Authentication required');
            const response = await fetch('/api/getEnemyAssets', {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
            });
            if (response.ok) {
                const data = await response.json();
                const rawAssets = Array.isArray(data) ? data : (data.assets || []);
                const normalizedAssets = rawAssets.map((asset) => ({
                    ...asset,
                    remoteUrl: asset.url
                }));
                clearAssetCacheForType('enemy');
                await cacheAssetList('enemy', normalizedAssets, {
                    idKey: 'id',
                    urlKey: 'url',
                    remoteKey: 'remoteUrl'
                });
                setGlobalArray('enemyAssets', normalizedAssets);
                return GlobalData.enemyAssets;
            } else {
                throw new Error('Server error: ' + await response.text());
            }
        } catch (error) {
            console.error('Error loading enemy assets:', error);
            throw error;
        } finally {
            enemyAssetsLoadingPromise = null;
        }
    })();
    return enemyAssetsLoadingPromise;
}

function getEnemyAssets() {
    return GlobalData.enemyAssets;
}

function getTalents() {
    return GlobalData.talents;
}

function getPendingEnemies() {
    return GlobalData.pendingEnemies;
}

// --- NPCs ---
async function loadNpcsData(options = {}) {
    const forceReload = options?.forceReload === true;
    if (!forceReload && GlobalData.npcs.length > 0) {
        return GlobalData.npcs;
    }
    if (npcsLoadingPromise) return npcsLoadingPromise;

    npcsLoadingPromise = (async () => {
        try {
            const token = await getCurrentAccessToken();
            if (!token) throw new Error('Authentication required');
            const response = await fetch('/api/getNpcs', {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
            });
            if (response.ok) {
                const data = await response.json();
                if (data.success && data.npcs) {
                    setGlobalArray('npcs', data.npcs);
                }
                return GlobalData.npcs;
            } else {
                throw new Error('Server error: ' + await response.text());
            }
        } catch (error) {
            console.error('Error loading NPCs:', error);
            throw error;
        } finally {
            npcsLoadingPromise = null;
        }
    })();
    return npcsLoadingPromise;
}

function getNpcs() {
    return GlobalData.npcs;
}

// --- Servers ---
async function loadServersData(options = {}) {
    const forceReload = options?.forceReload === true;
    if (!forceReload && GlobalData.servers.length > 0) {
        return GlobalData.servers;
    }
    if (serversLoadingPromise) return serversLoadingPromise;

    serversLoadingPromise = (async () => {
        try {
            const data = await getAuthenticatedJson('/api/getServers', {
                expectSuccess: true,
                headers: { 'Content-Type': 'application/json' }
            });
            setGlobalArray('servers', Array.isArray(data?.servers) ? data.servers : []);
            return GlobalData.servers;
        } catch (error) {
            console.error('Error loading servers:', error);
            throw error;
        } finally {
            serversLoadingPromise = null;
        }
    })();
    return serversLoadingPromise;
}

function getServersData() {
    return GlobalData.servers;
}

// --- Recent Events ---
async function loadRecentEventsData(options = {}) {
    const forceReload = options?.forceReload === true;
    if (!forceReload && GlobalData.recentEvents.length > 0) {
        return GlobalData.recentEvents;
    }
    if (recentEventsLoadingPromise) return recentEventsLoadingPromise;

    recentEventsLoadingPromise = (async () => {
        try {
            const data = await getAuthenticatedJson('/api/getRecentEvents', {
                expectSuccess: true,
                headers: { 'Content-Type': 'application/json' }
            });
            setGlobalArray('recentEvents', Array.isArray(data?.events) ? data.events : []);
            return GlobalData.recentEvents;
        } catch (error) {
            console.error('Error loading recent events:', error);
            throw error;
        } finally {
            recentEventsLoadingPromise = null;
        }
    })();
    return recentEventsLoadingPromise;
}

function getRecentEventsData() {
    return GlobalData.recentEvents;
}

// --- Cosmetics ---
async function loadCosmeticsData(options = {}) {
    const forceReload = options?.forceReload === true;
    if (!forceReload && GlobalData.cosmetics.length > 0) {
        return GlobalData.cosmetics;
    }
    if (cosmeticsLoadingPromise) return cosmeticsLoadingPromise;

    cosmeticsLoadingPromise = (async () => {
        try {
            const token = await getCurrentAccessToken();
            if (!token) throw new Error('Authentication required');
            const response = await fetch('/api/getCosmetics', {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
            });
            if (response.ok) {
                const data = await response.json();
                if (data.success && data.cosmetics) {
                    setGlobalArray('cosmetics', data.cosmetics);
                }
                return GlobalData.cosmetics;
            } else {
                throw new Error('Server error: ' + await response.text());
            }
        } catch (error) {
            console.error('Error loading cosmetics:', error);
            throw error;
        } finally {
            cosmeticsLoadingPromise = null;
        }
    })();
    return cosmeticsLoadingPromise;
}

function getCosmetics() {
    return GlobalData.cosmetics;
}

async function loadCosmeticAssets(options = {}) {
    const forceReload = options?.forceReload === true;
    if (!forceReload && GlobalData.cosmeticAssets.length > 0) {
        return GlobalData.cosmeticAssets;
    }
    if (cosmeticAssetsLoadingPromise) return cosmeticAssetsLoadingPromise;

    cosmeticAssetsLoadingPromise = (async () => {
        try {
            const token = await getCurrentAccessToken();
            if (!token) throw new Error('Authentication required');
            const response = await fetch('/api/getCosmeticAssets', {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
            });
            if (response.ok) {
                const data = await response.json();
                const rawAssets = data.success ? (data.assets || []) : [];
                setGlobalArray('cosmeticAssets', rawAssets);
                return GlobalData.cosmeticAssets;
            } else {
                throw new Error('Server error: ' + await response.text());
            }
        } catch (error) {
            console.error('Error loading cosmetic assets:', error);
            throw error;
        } finally {
            cosmeticAssetsLoadingPromise = null;
        }
    })();
    return cosmeticAssetsLoadingPromise;
}

function getCosmeticAssets() {
    return GlobalData.cosmeticAssets;
}

// === PRELOAD REGISTRY ===

const GLOBAL_DATA_LOADERS = {
    effects:          (options) => loadEffectsData(options),
    effectAssets:     (options) => loadEffectAssets(options),
    enemies:          (options) => loadEnemiesData(options),
    perks:            (options) => loadPerksData(options),
    items:            (options) => loadItemsData(options),
    npcs:             (options) => loadNpcsData(options),
    servers:          (options) => loadServersData(options),
    recentEvents:     (options) => loadRecentEventsData(options),
    perkAssets:       (options) => loadPerkAssets(options),
    itemAssets:       (options) => loadItemAssets(options),
    enemyAssets:      (options) => loadEnemyAssets(options),
    settlements:      (options) => loadSettlementsData(options),
    quests:           (options) => loadQuestsData(options),
    expeditions:      (options) => loadExpeditionsData(options),
    settlementAssets: (options) => loadSettlementAssetsData(options),
    questAssets:      (options) => loadQuestAssetsData(options),
    expeditionMapAssets: (options) => loadExpeditionMapAssetsData(options),
    cosmetics:        (options) => loadCosmeticsData(options),
    cosmeticAssets:   (options) => loadCosmeticAssets(options)
};

async function preloadGlobalData(keys = []) {
    if (!Array.isArray(keys) || keys.length === 0) return Promise.resolve();
    const uniqueKeys = Array.from(new Set(keys.filter(Boolean)));
    console.log(`${GLOBAL_DATA_LOG_PREFIX} preload start`, { keys: uniqueKeys });
    const tasks = uniqueKeys.map((key) => {
        const loader = GLOBAL_DATA_LOADERS[key];
        if (typeof loader !== 'function') {
            console.warn(`No global data loader for "${key}"`);
            return Promise.resolve();
        }
        return loader().catch((error) => {
            console.error(`Preload failed for "${key}"`, error);
        });
    });
    return Promise.all(tasks).then(() => {
        const summary = buildGlobalDataSummary();
        window.__globalDataPreloaded = true;
        window.__globalDataSummary = summary;
        window.dispatchEvent(new CustomEvent('global-data-preloaded', { detail: summary }));
        const dataEntries = [
            `${GlobalData.effects.length} effects`,
            `${GlobalData.enemies.length} enemies`,
            `${GlobalData.perks.length} perks`,
            `${GlobalData.items.length} items`,
            `${GlobalData.talents.length} talents`,
            `${GlobalData.npcs.length} npcs`,
            `${GlobalData.servers.length} servers`,
            `${GlobalData.recentEvents.length} recent events`,
            `${GlobalData.settlements.length} settlements`,
            `${GlobalData.quests.length} quests`,
            `${GlobalData.expeditions.length} expeditions`,
            `${GlobalData.cosmetics.length} cosmetics`
        ];
        const assetEntries = [
            `${GlobalData.questAssets.length} quest`,
            `${GlobalData.settlementAssets.length} settlement`,
            `${GlobalData.expeditionMapAssets.length} expedition-map`,
            `${GlobalData.effectAssets.length} effect`,
            `${GlobalData.perkAssets.length} perk`,
            `${GlobalData.itemAssets.length} item`,
            `${GlobalData.enemyAssets.length} enemy`,
            `${GlobalData.cosmeticAssets.length} cosmetic`
        ];
        console.log(`🌍 GlobalData ready — ${dataEntries.join(', ')}`);
        console.log(`🖼️ Asset galleries — ${assetEntries.join(', ')}`);
        console.log(`${GLOBAL_DATA_LOG_PREFIX} preload complete`, summary);
    });
}

async function syncAfterSave(keys = [], options = {}) {
    const uniqueKeys = Array.from(new Set((Array.isArray(keys) ? keys : [keys]).filter(Boolean)));
    if (uniqueKeys.length === 0) return [];

    const loaderOptions = { forceReload: true, ...options };
    console.log(`${GLOBAL_DATA_LOG_PREFIX} syncAfterSave`, { keys: uniqueKeys });

    return Promise.all(uniqueKeys.map(async (key) => {
        const loader = GLOBAL_DATA_LOADERS[key];
        if (typeof loader !== 'function') {
            console.warn(`No global data loader for "${key}"`);
            return null;
        }
        return loader(loaderOptions);
    }));
}

function normalizeGlobalDataKeys(keys = []) {
    return Array.from(new Set((Array.isArray(keys) ? keys : [keys]).filter(Boolean)));
}

function getGlobalDataLoader(key) {
    return GLOBAL_DATA_LOADERS[key] || null;
}

function hasGlobalData(key) {
    const value = GlobalData[key];
    return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null;
}

async function loadGlobalDataKey(key, options = {}) {
    const loader = getGlobalDataLoader(key);
    if (typeof loader !== 'function') {
        throw new Error(`No global data loader for "${key}"`);
    }
    return loader(options);
}

async function refreshGlobalDataKey(key, options = {}) {
    return loadGlobalDataKey(key, { ...options, forceReload: true });
}

async function loadGlobalDataKeys(keys = [], options = {}) {
    const uniqueKeys = normalizeGlobalDataKeys(keys);
    return Promise.all(uniqueKeys.map(key => loadGlobalDataKey(key, options)));
}

async function refreshGlobalDataKeys(keys = [], options = {}) {
    const uniqueKeys = normalizeGlobalDataKeys(keys);
    return Promise.all(uniqueKeys.map(key => refreshGlobalDataKey(key, options)));
}

function setGlobalDataKey(key, values) {
    if (Array.isArray(GlobalData[key])) {
        return setGlobalArray(key, Array.isArray(values) ? values : []);
    }
    GlobalData[key] = values;
    notifyGlobalDataChange(key, values);
    return values;
}

function updateGlobalDataKey(key, updater) {
    const currentValue = GlobalData[key];
    const nextValue = typeof updater === 'function' ? updater(currentValue) : updater;
    return setGlobalDataKey(key, nextValue);
}

function invalidateGlobalDataKey(key, options = {}) {
    const notify = options.notify !== false;
    if (Array.isArray(GlobalData[key])) {
        GlobalData[key].length = 0;
        if (notify) notifyGlobalDataChange(key, GlobalData[key]);
        return GlobalData[key];
    }
    GlobalData[key] = null;
    if (notify) notifyGlobalDataChange(key, GlobalData[key]);
    return GlobalData[key];
}

function invalidateGlobalDataKeys(keys = [], options = {}) {
    return normalizeGlobalDataKeys(keys).map(key => invalidateGlobalDataKey(key, options));
}

function upsertGlobalRecord(key, record, idKeys = ['id']) {
    if (!record || !Array.isArray(GlobalData[key])) return null;
    const keys = Array.isArray(idKeys) ? idKeys : [idKeys];
    const index = GlobalData[key].findIndex(entry => keys.some(idKey => {
        const nextValue = record?.[idKey];
        const currentValue = entry?.[idKey];
        return nextValue !== undefined && nextValue !== null && String(currentValue) === String(nextValue);
    }));
    if (index >= 0) {
        GlobalData[key][index] = record;
    } else {
        GlobalData[key].push(record);
    }
    notifyGlobalDataChange(key, GlobalData[key]);
    return record;
}

const GlobalDataStore = {
    data: GlobalData,
    loaders: GLOBAL_DATA_LOADERS,
    summary: buildGlobalDataSummary,
    get: getGlobalDataSnapshot,
    has: hasGlobalData,
    set: setGlobalDataKey,
    update: updateGlobalDataKey,
    upsert: upsertGlobalRecord,
    invalidate: invalidateGlobalDataKey,
    invalidateMany: invalidateGlobalDataKeys,
    load: loadGlobalDataKey,
    loadMany: loadGlobalDataKeys,
    refresh: refreshGlobalDataKey,
    refreshMany: refreshGlobalDataKeys,
    syncAfterSave,
    subscribe: subscribeToGlobalData,
    notify: notifyGlobalDataChange,
};

if (typeof window !== 'undefined') {
    window.GlobalDataStore = GlobalDataStore;
    window.syncAfterSave = syncAfterSave;
    window.loadGlobalDataKey = loadGlobalDataKey;
    window.loadGlobalDataKeys = loadGlobalDataKeys;
    window.refreshGlobalDataKey = refreshGlobalDataKey;
    window.refreshGlobalDataKeys = refreshGlobalDataKeys;
    window.setGlobalDataKey = setGlobalDataKey;
    window.updateGlobalDataKey = updateGlobalDataKey;
    window.upsertGlobalRecord = upsertGlobalRecord;
    window.setGlobalArray = setGlobalArray;
    window.getGlobalDataSnapshot = getGlobalDataSnapshot;
    window.invalidateGlobalDataKey = invalidateGlobalDataKey;
    window.invalidateGlobalDataKeys = invalidateGlobalDataKeys;
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
    return upsertGlobalRecord('enemies', enemy, ['id']);
}

/**
 * Update an existing enemy in the global enemies array
 * @param {Object} updatedEnemy - The updated enemy object
 */
function updateEnemyInGlobal(updatedEnemy) {
    return upsertGlobalRecord('enemies', updatedEnemy, ['id']);
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
    return upsertGlobalRecord('perks', perk, ['id']);
}

/**
 * Update an existing perk in the global perks array
 * @param {Object} updatedPerk - The updated perk object
 */
function updatePerkInGlobal(updatedPerk) {
    return upsertGlobalRecord('perks', updatedPerk, ['id']);
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
    return upsertGlobalRecord('items', item, ['id']);
}

/**
 * Update an existing item in the global items array
 * @param {Object} updatedItem - The updated item object
 */
function updateItemInGlobal(updatedItem) {
    return upsertGlobalRecord('items', updatedItem, ['id']);
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

// ==================== SHARED SETTLEMENT DROPDOWN ====================
/**
 * Populate any <select> element with the current settlements list.
 * Returns the numeric settlement ID that ended up selected (or null).
 *
 * @param {string} selectId – DOM id of the <select>
 * @param {number|null} preferredId – settlement id to keep selected if possible
 * @returns {number|null} the id that is now selected
 */
function populateSettlementSelect(selectId, preferredId) {
    const select = document.getElementById(selectId);
    if (!select) return null;

    const settlements = GlobalData?.settlements || [];

    if (settlements.length === 0) {
        select.innerHTML = '<option value="">Loading settlements…</option>';
        select.value = '';
        // Trigger a load if settlements haven't been fetched yet
        if (typeof loadSettlementsData === 'function') {
            loadSettlementsData().catch(e => console.error('Settlement load failed:', e));
        }
        return null;
    }

    const previousValue = select.value || (preferredId != null ? String(preferredId) : '');

    select.innerHTML = '';

    const factionGroups = [
        { label: 'Order', match: settlement => String(settlement.faction || '') === '1' },
        { label: 'Guild', match: settlement => String(settlement.faction || '') === '2' },
        { label: 'Companions', match: settlement => String(settlement.faction || '') === '3' },
        { label: 'Neutral', match: settlement => !settlement.faction }
    ];

    factionGroups.forEach(group => {
        const groupedSettlements = settlements
            .filter(group.match)
            .sort((a, b) => {
                const nA = (a.settlement_name || '').toLowerCase();
                const nB = (b.settlement_name || '').toLowerCase();
                return nA === nB
                    ? (a.settlement_id || 0) - (b.settlement_id || 0)
                    : nA.localeCompare(nB);
            });

        if (!groupedSettlements.length) return;

        const optgroup = document.createElement('optgroup');
        optgroup.label = group.label;

        groupedSettlements.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.settlement_id;
            opt.textContent = s.settlement_name || `Settlement #${s.settlement_id}`;
            optgroup.appendChild(opt);
        });

        select.appendChild(optgroup);
    });

    // Try to restore previous selection, fall back to first option
    let nextValue = '';
    if (previousValue && select.querySelector(`option[value="${previousValue}"]`)) {
        nextValue = previousValue;
    } else if (select.options.length > 0) {
        nextValue = select.options[0].value;
    }
    select.value = nextValue;

    const num = nextValue ? parseInt(nextValue, 10) : null;
    return Number.isNaN(num) ? null : num;
}
