// Player Management

const PLAYER_EQUIPMENT_SLOTS = [
    { id: 1, label: 'Head' },
    { id: 2, label: 'Chest' },
    { id: 3, label: 'Hands' },
    { id: 4, label: 'Feet' },
    { id: 5, label: 'Belt' },
    { id: 6, label: 'Back' },
    { id: 7, label: 'Weapon' },
    { id: 8, label: 'Ring' }
];
const PLAYER_COSMETIC_LAYER_ORDER = ['face', 'ears', 'nose', 'mouth', 'eyes', 'brows', 'beard', 'special', 'hair'];

let playerState = {
    servers: [],
    serverId: null,
    rankings: [],
    characters: [],
    selectedCharacterId: null,
    searchTerm: '',
    loading: false
};

let playerServerSubscription = null;

function registerPlayerManagement() {
    if (!document.getElementById('players-content')) return;
    window.initPlayerManagement = initPlayerManagement;
    window.loadPlayerManagementData = loadPlayerManagementData;
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', registerPlayerManagement);
} else {
    registerPlayerManagement();
}

async function initPlayerManagement() {
    setupPlayerListeners();
    setupPlayerSubscriptions();
    await ensurePlayerServers();
    populatePlayerServerSelect();
    await loadPlayerManagementData();
}

function setupPlayerListeners() {
    document.getElementById('playerServerSelect')?.addEventListener('change', (event) => {
        playerState.serverId = Number(event.target.value) || null;
        loadPlayerManagementData({ force: true });
    });

    document.getElementById('playerRefreshBtn')?.addEventListener('click', () => {
        loadPlayerManagementData({ force: true });
    });

    document.getElementById('playerSearchInput')?.addEventListener('input', (event) => {
        playerState.searchTerm = event.target.value || '';
        renderPlayerRankings();
    });
}

function setupPlayerSubscriptions() {
    if (typeof subscribeToGlobalData !== 'function') return;
    if (typeof playerServerSubscription === 'function') {
        playerServerSubscription();
    }
    playerServerSubscription = subscribeToGlobalData('servers', (servers) => {
        playerState.servers = Array.isArray(servers) ? servers : [];
        if (!playerState.serverId || !playerState.servers.some(server => Number(server.id) === Number(playerState.serverId))) {
            playerState.serverId = pickDefaultPlayerServerId(playerState.servers);
        }
        populatePlayerServerSelect();
        renderPlayerServerSummary();
    });
}

async function ensurePlayerServers() {
    if (Array.isArray(window.GlobalData?.servers) && GlobalData.servers.length) {
        playerState.servers = GlobalData.servers;
    } else if (typeof loadServersData === 'function') {
        playerState.servers = await loadServersData();
    }
    if (!playerState.serverId) {
        playerState.serverId = pickDefaultPlayerServerId(playerState.servers);
    }
}

function pickDefaultPlayerServerId(servers) {
    const now = Date.now();
    const active = (servers || []).find(server => {
        const starts = new Date(server.created_at).getTime();
        const ends = new Date(server.ends_at).getTime();
        return Number.isFinite(starts) && Number.isFinite(ends) && starts <= now && now <= ends;
    });
    return Number(active?.id || servers?.[0]?.id || 0) || null;
}

function populatePlayerServerSelect() {
    const select = document.getElementById('playerServerSelect');
    if (!select) return;
    const servers = playerState.servers || [];
    if (!servers.length) {
        select.innerHTML = '<option value="">No servers</option>';
        return;
    }
    select.innerHTML = servers.map(server => {
        const label = `${server.name || `Server ${server.id}`} · day ${server.current_day || '-'}`;
        const selected = Number(server.id) === Number(playerState.serverId) ? 'selected' : '';
        return `<option value="${server.id}" ${selected}>${pmEscapeHtml(label)}</option>`;
    }).join('');
}

async function loadPlayerManagementData(options = {}) {
    if (playerState.loading) return;
    if (!document.getElementById('players-content')) return;

    await ensurePlayerServers();
    if (!playerState.serverId) {
        renderPlayerEmptyState('No server selected.');
        return;
    }

    playerState.loading = true;
    setPlayerStatus('Loading players...');
    try {
        const data = await getAuthenticatedJson(`/api/getPlayerManagement?serverId=${encodeURIComponent(playerState.serverId)}`, {
            expectSuccess: true,
            headers: { 'Content-Type': 'application/json' }
        });
        playerState.rankings = Array.isArray(data?.rankings) ? data.rankings : [];
        playerState.characters = Array.isArray(data?.characters) ? data.characters : [];
        if (!playerState.selectedCharacterId || !playerState.characters.some(c => c.character_id === playerState.selectedCharacterId)) {
            playerState.selectedCharacterId = playerState.rankings[0]?.character_id || playerState.characters[0]?.character_id || null;
        }
        renderPlayerManagement();
        setPlayerStatus('');
    } catch (error) {
        console.error('Error loading player management data:', error);
        setPlayerStatus(error.message || 'Failed to load players', true);
        renderPlayerEmptyState('Failed to load player data.');
    } finally {
        playerState.loading = false;
    }
}

function renderPlayerManagement() {
    renderPlayerServerSummary();
    renderPlayerRankings();
    renderSelectedPlayerCharacter();
}

function renderPlayerServerSummary() {
    const summary = document.getElementById('playerServerSummary');
    const server = playerState.servers.find(s => Number(s.id) === Number(playerState.serverId));
    if (!summary) return;
    if (!server) {
        summary.textContent = '';
        return;
    }
    summary.textContent = `${server.character_count || 0} characters · ${server.player_count || 0} players`;
}

function renderPlayerRankings() {
    const visibleRankings = getFilteredPlayerRankings();
    const count = document.getElementById('playerRankingCount');
    if (count) count.textContent = `${visibleRankings.length} / ${playerState.rankings.length} characters`;

    const list = document.getElementById('playerRankingsList');
    if (!list) return;
    if (!playerState.rankings.length) {
        list.innerHTML = '<div class="player-empty-list">No characters on this server.</div>';
        return;
    }
    if (!visibleRankings.length) {
        list.innerHTML = '<div class="player-empty-list">No matching characters.</div>';
        return;
    }

    list.innerHTML = visibleRankings.map(entry => {
        const selected = Number(entry.character_id) === Number(playerState.selectedCharacterId) ? 'selected' : '';
        return `
            <button type="button" class="player-ranking-row ${selected}" onclick="selectPlayerCharacter(${entry.character_id})">
                <span class="player-rank-number">#${entry.rank}</span>
                <span class="player-rank-main">
                    <span class="player-rank-name">${pmEscapeHtml(entry.character_name || 'Unnamed')}</span>
                    <span class="player-rank-meta">${pmEscapeHtml(formatPlayerFaction(entry.faction))}${entry.vip ? ' · VIP' : ''} · ${entry.honor || 0} honor</span>
                </span>
            </button>
        `;
    }).join('');
}

function getFilteredPlayerRankings() {
    const term = playerState.searchTerm.trim().toLowerCase();
    if (!term) return playerState.rankings;
    return playerState.rankings
        .map(entry => ({ entry, score: getFuzzyScore(entry.character_name || '', term) }))
        .filter(result => result.score >= 0)
        .sort((a, b) => a.score - b.score || a.entry.rank - b.entry.rank)
        .map(result => result.entry);
}

function getFuzzyScore(value, term) {
    const text = String(value || '').toLowerCase();
    if (!term) return 0;
    const direct = text.indexOf(term);
    if (direct >= 0) return direct;

    let score = 0;
    let cursor = 0;
    for (const char of term) {
        const found = text.indexOf(char, cursor);
        if (found === -1) return -1;
        score += found - cursor + 1;
        cursor = found + 1;
    }
    return score + text.length - term.length;
}

function selectPlayerCharacter(characterId) {
    playerState.selectedCharacterId = Number(characterId) || null;
    renderPlayerRankings();
    renderSelectedPlayerCharacter();
}

function renderSelectedPlayerCharacter() {
    const panel = document.getElementById('playerCharacterPanel');
    if (!panel) return;
    const character = playerState.characters.find(c => Number(c.character_id) === Number(playerState.selectedCharacterId));
    if (!character) {
        panel.className = 'player-character-empty';
        panel.textContent = 'Select a ranked character to inspect their stats, equipment, and bag.';
        return;
    }

    const equipment = getPlayerEquipment(character);
    const bag = getPlayerBag(character);
    const totalStats = getPlayerTotalStats(character, equipment);
    const healthMax = Math.max(1, Number(character.stats?.stamina || 0) * 10);
    const healthCurrent = Math.max(0, healthMax - Number(character.stats?.depleted_health || 0));

    panel.className = 'player-character-sheet';
    panel.innerHTML = `
        <div class="player-sheet-header">
            <div>
                <h2>${pmEscapeHtml(character.character_name || 'Unnamed')}</h2>
                <div class="player-sheet-subtitle">${pmEscapeHtml(formatPlayerFaction(character.faction))} · ${character.vip ? 'VIP · ' : ''}${character.silver || 0} silver</div>
            </div>
            <div class="player-sheet-honor">${character.honor || 0}<span>honor</span></div>
        </div>

        <div class="player-character-main">
            <div class="player-character-left">
                <div class="player-stat-grid">
                    ${renderPlayerStat('Strength', totalStats.strength)}
                    ${renderPlayerStat('Stamina', totalStats.stamina)}
                    ${renderPlayerStat('Agility', totalStats.agility)}
                    ${renderPlayerStat('Luck', totalStats.luck)}
                    ${renderPlayerStat('Armor', totalStats.armor)}
                    ${renderPlayerStat('Damage', `${totalStats.min_damage} - ${totalStats.max_damage}`)}
                </div>
                ${renderPlayerActiveEffects(character)}

                <div class="player-loadout">
                    <div class="player-equipment-grid">
                        ${PLAYER_EQUIPMENT_SLOTS.map(slot => renderPlayerSlot(slot, equipment.get(slot.id))).join('')}
                    </div>
                    <div class="player-avatar-column">
                        ${renderPlayerAvatar(character.avatar)}
                        <div class="player-health-bar"><span style="width:${Math.max(0, Math.min(100, (healthCurrent / healthMax) * 100))}%"></span><strong>${healthCurrent} / ${healthMax}</strong></div>
                    </div>
                </div>

                <div class="player-bag-section">
                    <div class="player-panel-header compact">
                        <h3>Bag</h3>
                    </div>
                    <div class="player-bag-grid">
                        ${bag.length ? bag.map(item => renderPlayerBagSlot(item)).join('') : '<div class="player-empty-list">No bag slots found.</div>'}
                    </div>
                </div>
            </div>
            <div class="player-character-talents">
                ${renderPlayerTalentTree(character.talents || [], character.perks || [])}
            </div>
        </div>
    `;
}

function getPlayerEquipment(character) {
    const slots = new Map();
    (character.inventory || []).forEach(item => {
        if (PLAYER_EQUIPMENT_SLOTS.some(slot => slot.id === Number(item.slot_id))) {
            slots.set(Number(item.slot_id), item);
        }
    });
    return slots;
}

function getPlayerBag(character) {
    return (character.inventory || []).filter(item => !PLAYER_EQUIPMENT_SLOTS.some(slot => slot.id === Number(item.slot_id)));
}

function renderPlayerStat(label, value) {
    return `<div class="player-stat"><span>${pmEscapeHtml(label)}</span><strong>${pmEscapeHtml(value ?? 0)}</strong></div>`;
}

function renderPlayerSlot(slot, item) {
    return `
        <div class="player-equip-slot" title="${pmEscapeHtml(slot.label)}">
            ${renderPlayerItemIcon(item)}
            <span>${pmEscapeHtml(slot.label)}</span>
        </div>
    `;
}

function renderPlayerBagSlot(item) {
    return `
        <div class="player-bag-slot" title="${pmEscapeHtml(item.item_name || `Slot ${item.slot_id}`)}">
            ${renderPlayerItemIcon(item)}
        </div>
    `;
}

function renderPlayerItemIcon(item) {
    if (!item || !item.item_id) {
        return '<div class="player-item-empty"></div>';
    }
    const name = item.item_name || `Item ${item.item_id}`;
    const icon = item.icon || findPlayerItemIcon(item.item_id, item.assetID);
    const scaled = getScaledItemStats(item);
    const stats = formatScaledItemStats(item, scaled);

    return `
        <div class="player-item" title="${pmEscapeHtml(`${name}${stats ? `\n${stats}` : ''}`)}">
            ${icon ? `<img src="${pmEscapeHtml(icon)}" alt="${pmEscapeHtml(name)}">` : '<span class="player-item-fallback">?</span>'}
        </div>
    `;
}

function getPlayerTotalStats(character, equipment) {
    const totals = {
        strength: Number(character.stats?.strength || 0),
        stamina: Number(character.stats?.stamina || 0),
        agility: Number(character.stats?.agility || 0),
        luck: Number(character.stats?.luck || 0),
        armor: Number(character.stats?.armor || 0),
        min_damage: Number(character.stats?.min_damage || 0),
        max_damage: Number(character.stats?.max_damage || 0)
    };

    for (const item of equipment.values()) {
        const scaled = getScaledItemStats(item);
        totals.strength += scaled.strength;
        totals.stamina += scaled.stamina;
        totals.agility += scaled.agility;
        totals.luck += scaled.luck;
        totals.armor += scaled.armor;
        totals.min_damage += scaled.minDamage;
        totals.max_damage += scaled.maxDamage;
    }

    return totals;
}

function getScaledItemStats(item) {
    const scale = getItemScaleMultiplier(item);
    return {
        strength: scaleItemStat(item?.strength, scale),
        stamina: scaleItemStat(item?.stamina, scale),
        agility: scaleItemStat(item?.agility, scale),
        luck: scaleItemStat(item?.luck, scale),
        armor: scaleItemStat(item?.armor, scale),
        minDamage: scaleItemStat(item?.minDamage, scale),
        maxDamage: scaleItemStat(item?.maxDamage, scale)
    };
}

function getItemScaleMultiplier(item) {
    const currentDay = getSelectedPlayerServerDay();
    const itemDay = Number(item?.server_day || item?.serverDay || currentDay || 1);
    if (!currentDay || !itemDay) return 1;
    const elapsedDays = Math.max(0, currentDay - itemDay);
    return Math.pow(1.02, elapsedDays);
}

function scaleItemStat(value, multiplier) {
    const numeric = Number(value || 0);
    if (!numeric) return 0;
    return Math.round(numeric * multiplier);
}

function formatScaledItemStats(item, scaled) {
    const parts = [
        formatScaledItemStat('STR', scaled.strength),
        formatScaledItemStat('STA', scaled.stamina),
        formatScaledItemStat('AGI', scaled.agility),
        formatScaledItemStat('LUCK', scaled.luck),
        formatScaledItemStat('ARM', scaled.armor)
    ];
    if (item?.minDamage || item?.maxDamage) {
        parts.push(`DMG ${scaled.minDamage}-${scaled.maxDamage}`);
    }
    return parts.filter(Boolean).join(' · ');
}

function formatScaledItemStat(label, scaledValue) {
    if (!scaledValue) return '';
    return `${label} ${scaledValue}`;
}

function getSelectedPlayerServerDay() {
    const server = playerState.servers.find(s => Number(s.id) === Number(playerState.serverId));
    return Number(server?.current_day || 1);
}

function renderPlayerAvatar(avatar) {
    const avatarIds = {
        face: avatar?.face,
        ears: avatar?.ears,
        eyes: avatar?.eyes,
        brows: avatar?.brows,
        nose: avatar?.nose,
        mouth: avatar?.mouth,
        hair: avatar?.hair,
        special: avatar?.special
    };
    const layers = PLAYER_COSMETIC_LAYER_ORDER.map((type, index) => {
        const layer = { type, id: avatarIds[type] };
        const cosmetic = findPlayerCosmeticLayer(layer.type, layer.id);
        if (!cosmetic?.icon) return '';
        const offsetX = Number(cosmetic.offsetX || 0);
        const offsetY = Number(cosmetic.offsetY || 0);
        const scale = Math.max(10, Number(cosmetic.scale || 100)) / 100;
        const style = `z-index: ${index}; transform: translate(${offsetX}%, ${offsetY}%) scale(${scale});`;
        return `<img src="${pmEscapeHtml(cosmetic.icon)}" alt="" class="cosmetic-layer player-avatar-layer" style="${pmEscapeHtml(style)}">`;
    }).join('');

    return `<div class="player-avatar-frame cosmetic-preview-canvas">${layers || '<span class="player-avatar-empty">No avatar</span>'}</div>`;
}

function renderPlayerActiveEffects(character) {
    const effects = [];
    (character.perks || []).forEach(perk => {
        effects.push({
            label: perk.name || `Perk ${perk.perk_id}`,
            icon: perk.icon,
            fallback: 'P'
        });
    });

    if (character.blessing_id) {
        const blessing = findPlayerPerk(character.blessing_id);
        effects.push({
            label: blessing?.name || `Blessing ${character.blessing_id}`,
            icon: blessing?.icon || '',
            fallback: 'B'
        });
    }

    if (character.potion_id && isFutureTimestamp(character.potion_until)) {
        const item = findPlayerItem(character.potion_id);
        effects.push({
            label: item?.name || `Potion ${character.potion_id}`,
            icon: item?.icon || findPlayerItemIcon(character.potion_id),
            fallback: 'I'
        });
    }

    if (isFutureTimestamp(character.elixir_until)) {
        [
            { id: character.elixir_effect1, factor: character.elixir_factor1 },
            { id: character.elixir_effect2, factor: character.elixir_factor2 }
        ].forEach((elixir, index) => {
            if (!elixir.id) return;
            const effect = findPlayerEffect(elixir.id);
            effects.push({
                label: `${effect?.name || effect?.effect_name || `Elixir effect ${elixir.id}`}${elixir.factor ? ` +${elixir.factor}` : ''}`,
                icon: '',
                fallback: `E${index + 1}`
            });
        });
    }

    return `
        <div class="player-active-effects" title="Active effects">
            ${effects.length ? effects.map(effect => `
                <span class="player-effect-icon" title="${pmEscapeHtml(effect.label)}">
                    ${effect.icon ? `<img src="${pmEscapeHtml(effect.icon)}" alt="${pmEscapeHtml(effect.label)}">` : pmEscapeHtml(effect.fallback)}
                </span>
            `).join('') : '<span class="player-effect-empty">No active effects</span>'}
        </div>
    `;
}

function renderPlayerTalentTree(talents, perks = []) {
    if (!talents.length) {
        return `
            <div class="player-talents-section">
                <div class="player-panel-header compact"><h3>Talents</h3></div>
                <div class="player-empty-list">No talents learned.</div>
            </div>
        `;
    }

    return `
        <div class="player-talents-section">
            <div class="player-panel-header compact"><h3>Talents</h3></div>
            <div class="player-talent-grid talent-grid">
                ${talents.map(talent => renderPlayerTalentCell(talent, perks)).join('')}
            </div>
        </div>
    `;
}

function renderPlayerTalentCell(talent, perks = []) {
    const row = Number(talent.row || 1);
    const col = Number(talent.col || 1);
    const gridRow = 9 - row;
    const iconUrl = talent.icon || findPlayerTalentIcon(talent.assetID);
    const perkIndicator = talent.perkSlot ? '<div class="talent-perk-indicator">*</div>' : '';
    const tooltip = getPlayerTalentTooltip(talent, perks);
    return `
        <div class="talent-cell-wrapper" style="grid-row:${gridRow};grid-column:${col};">
            <div class="talent-cell" title="${pmEscapeHtml(tooltip)}">
                ${perkIndicator}
                <div class="talent-max">${talent.points || 0}/${talent.maxPoints || '?'}</div>
                ${iconUrl ? `<img class="talent-icon" src="${pmEscapeHtml(iconUrl)}" alt="${pmEscapeHtml(talent.name || 'Talent')}" onerror="this.style.display='none'">` : ''}
                <div class="talent-cell-label">${pmEscapeHtml(talent.name || `Talent ${talent.talent_id}`)}</div>
            </div>
        </div>
    `;
}

function getPlayerTalentTooltip(talent, perks = []) {
    const assignedPerk = talent.perkSlot ? findPlayerAssignedPerk(talent, perks) : null;
    if (assignedPerk) {
        const parts = [assignedPerk.name || `Perk ${assignedPerk.perk_id || assignedPerk.id}`];
        if (talent.points || talent.maxPoints) {
            parts.push(`Slot: ${talent.name || `Talent ${talent.talent_id}`} (${talent.points || 0}/${talent.maxPoints || '?'})`);
        }
        const description = assignedPerk.description || findPlayerPerk(assignedPerk.perk_id || assignedPerk.id)?.description || '';
        if (description) parts.push(description);
        return parts.join('\n');
    }

    const effect = findPlayerEffect(talent.effectId);
    const baseDescription = effect?.description || talent.description || '';
    const invested = Number(talent.points || 0) * Number(talent.factor || 0);
    let descText = baseDescription;
    if (typeof DesignerBase !== 'undefined' && typeof DesignerBase.formatEffectDescription === 'function') {
        descText = DesignerBase.formatEffectDescription(effect || { description: baseDescription }, invested, {
            defaultText: talent.description || '',
            appendPercentWhenNoPlaceholder: false
        });
    } else if (descText && descText.includes('*')) {
        descText = descText.replace('*', String(invested));
    } else if (invested && descText) {
        descText = `${descText} ${invested}`;
    }

    const parts = [talent.name || `Talent ${talent.talent_id}`];
    if (talent.points || talent.maxPoints) {
        parts.push(`Points: ${talent.points || 0}/${talent.maxPoints || '?'}`);
    }
    if (descText) parts.push(descText);
    return parts.join('\n');
}

function findPlayerAssignedPerk(talent, perks = []) {
    const talentId = Number(talent.talent_id || talent.talentId);
    return (perks || []).find(perk => Number(perk.talent_id || perk.talentId) === talentId) || null;
}

function renderPlayerEmptyState(message) {
    const rankings = document.getElementById('playerRankingsList');
    const panel = document.getElementById('playerCharacterPanel');
    if (rankings) rankings.innerHTML = `<div class="player-empty-list">${pmEscapeHtml(message)}</div>`;
    if (panel) {
        panel.className = 'player-character-empty';
        panel.textContent = message;
    }
}

function findPlayerItemIcon(itemId, assetId) {
    const item = findPlayerItem(itemId, assetId);
    if (item?.icon) return item.icon;
    if (assetId) return buildPlayerAssetUrl('items', assetId);
    return '';
}

function findPlayerItem(itemId, assetId) {
    const items = window.GlobalData?.items || [];
    return items.find(entry => Number(entry.id) === Number(itemId) || Number(entry.assetID) === Number(assetId)) || null;
}

function findPlayerPerk(perkId) {
    return (window.GlobalData?.perks || []).find(entry => Number(entry.id) === Number(perkId)) || null;
}

function findPlayerEffect(effectId) {
    return (window.GlobalData?.effects || []).find(entry => Number(entry.id || entry.effect_id) === Number(effectId)) || null;
}

function isFutureTimestamp(value) {
    if (!value) return false;
    const time = new Date(value).getTime();
    return Number.isFinite(time) && time > Date.now();
}

function findPlayerTalentIcon(assetId) {
    if (!assetId) return '';
    const assets = window.GlobalData?.perkAssets || [];
    const asset = assets.find(entry => Number(entry.assetID) === Number(assetId));
    return asset?.icon || buildPlayerAssetUrl('perks', assetId);
}

function findPlayerCosmeticIcon(type, id) {
    return findPlayerCosmeticLayer(type, id)?.icon || '';
}

function findPlayerCosmeticLayer(type, id) {
    if (!id) return '';
    const assets = window.GlobalData?.cosmeticAssets || [];
    const asset = assets.find(entry => Number(entry.assetID) === Number(id));
    const cosmetic = (window.GlobalData?.cosmetics || []).find(entry => Number(entry.id) === Number(id) && (!type || entry.type === type));
    return {
        icon: asset?.icon || buildPlayerAssetUrl('cosmetics', cosmetic?.id || id),
        offsetX: cosmetic?.offsetX || 0,
        offsetY: cosmetic?.offsetY || 0,
        scale: cosmetic?.scale || 100
    };
}

function buildPlayerAssetUrl(folder, assetId) {
    const base = typeof getAssetPublicBaseUrl === 'function'
        ? getAssetPublicBaseUrl()
        : 'https://pub-b959ac8ae579488bb4ed33c01a618ae2.r2.dev';
    return `${String(base).replace(/\/+$/, '')}/images/${folder}/${assetId}.webp`;
}

function formatPlayerFaction(faction) {
    const map = { 1: 'Companions', 2: 'Seekers', 3: 'Wardens' };
    return map[Number(faction)] || `Faction ${faction || '-'}`;
}

function setPlayerStatus(message, isError = false) {
    const status = document.getElementById('playerStatus');
    if (!status) return;
    status.textContent = message || '';
    status.className = `player-status ${isError ? 'error' : ''}`;
}

function pmEscapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));
}
