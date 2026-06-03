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
    setPlayerLoading(true);
    setPlayerStatus('');
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
        setPlayerLoading(false);
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
    bindPlayerHoverTooltips(panel);
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
        <div class="player-equip-slot">
            ${renderPlayerItemIcon(item)}
            <span>${pmEscapeHtml(slot.label)}</span>
        </div>
    `;
}

function renderPlayerBagSlot(item) {
    return `
        <div class="player-bag-slot">
            ${renderPlayerItemIcon(item)}
        </div>
    `;
}

function renderPlayerItemIcon(item) {
    if (!item || !item.item_id) {
        return '<div class="player-item-empty"></div>';
    }
    const baseItem = findPlayerItem(item.item_id, item.assetID);
    const tooltipItem = { ...(baseItem || {}), ...item };
    const name = tooltipItem.item_name || tooltipItem.name || `Item ${item.item_id}`;
    const icon = item.icon || findPlayerItemIcon(item.item_id, item.assetID);
    const tooltip = buildPlayerItemTooltip(tooltipItem, name);

    return `
        <div class="player-item player-hover-host" data-player-tooltip="${pmEscapeHtml(encodePlayerTooltip(tooltip))}" tabindex="0">
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
    const itemDay = Number(item?.server_day || item?.serverDay || 0);
    if (!itemDay) return 1;
    return Math.pow(1.02, Math.max(0, itemDay));
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
    getPlayerActivePerks(character).forEach(perk => {
        const perkEntry = findPlayerPerk(perk.perk_id || perk.id);
        effects.push({
            label: perk.name || `Perk ${perk.perk_id}`,
            icon: perk.icon,
            fallback: 'P',
            tooltip: buildPlayerPerkTooltip(perkEntry || perk, 'Perk')
        });
    });

    if (character.blessing_id) {
        const blessing = findPlayerPerk(character.blessing_id);
        effects.push({
            label: blessing?.name || `Blessing ${character.blessing_id}`,
            icon: blessing?.icon || '',
            fallback: 'B',
            tooltip: buildPlayerPerkTooltip(blessing || { id: character.blessing_id, name: `Blessing ${character.blessing_id}` }, 'Blessing')
        });
    }

    if (character.potion_id && isFutureTimestamp(character.potion_until)) {
        const item = findPlayerItem(character.potion_id);
        effects.push({
            label: item?.name || `Potion ${character.potion_id}`,
            icon: item?.icon || findPlayerItemIcon(character.potion_id),
            fallback: 'I',
            tooltip: {
                ...buildPlayerItemTooltip(item || { item_id: character.potion_id }, item?.name || `Potion ${character.potion_id}`),
                subtitle: 'Potion',
                duration: formatPlayerRemainingDuration(character.potion_until)
            }
        });
    }

    if (isFutureTimestamp(character.elixir_until)) {
        [
            { id: character.elixir_effect1, factor: character.elixir_factor1 },
            { id: character.elixir_effect2, factor: character.elixir_factor2 }
        ].forEach((elixir, index) => {
            if (!elixir.id) return;
            const effect = findPlayerEffect(elixir.id);
            const description = formatPlayerEffectText(effect, elixir.factor, effect?.description || '');
            effects.push({
                label: `${effect?.name || effect?.effect_name || `Elixir effect ${elixir.id}`}${elixir.factor ? ` +${elixir.factor}` : ''}`,
                icon: '',
                fallback: `E${index + 1}`,
                tooltip: {
                    title: effect?.name || effect?.effect_name || `Elixir effect ${elixir.id}`,
                    subtitle: `Elixir effect ${index + 1}`,
                    description,
                    duration: formatPlayerRemainingDuration(character.elixir_until)
                }
            });
        });
    }

    return `
        <div class="player-active-effects">
            ${effects.length ? effects.map(effect => `
                <span class="player-effect-icon player-hover-host" aria-label="${pmEscapeHtml(effect.label)}" data-player-tooltip="${pmEscapeHtml(encodePlayerTooltip(effect.tooltip))}" tabindex="0">
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
    const tooltip = getPlayerTalentTooltip(talent, perks);
    const assignedPerk = talent.perkSlot ? findPlayerAssignedPerk(talent, perks) : null;
    return `
        <div class="talent-cell-wrapper" style="grid-row:${gridRow};grid-column:${col};">
            <div class="talent-cell ${talent.perkSlot ? 'has-perk-slot' : ''} ${assignedPerk ? 'has-assigned-perk' : ''} player-hover-host" data-player-tooltip="${pmEscapeHtml(encodePlayerTooltip(tooltip))}" tabindex="0">
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
        const perkDefinition = findPlayerPerk(assignedPerk.perk_id || assignedPerk.id) || assignedPerk;
        return {
            title: perkDefinition.name || `Perk ${assignedPerk.perk_id || assignedPerk.id}`,
            subtitle: talent.points || talent.maxPoints
                ? `Slot: ${talent.name || `Talent ${talent.talent_id}`} (${talent.points || 0}/${talent.maxPoints || '?'})`
                : talent.name || `Talent ${talent.talent_id}`,
            description: perkDefinition.description || '',
            sections: buildPlayerPerkSections(perkDefinition)
        };
    }

    const effect = findPlayerEffect(talent.effectId);
    const invested = Number(talent.points || 0) * Number(talent.factor || 0);
    const descText = formatPlayerEffectText(effect, invested, talent.description || '');
    return {
        title: talent.name || `Talent ${talent.talent_id}`,
        subtitle: 'Talent',
        rows: talent.points || talent.maxPoints
            ? [
                { label: 'Points', value: `${talent.points || 0}/${talent.maxPoints || '?'}` },
                ...(talent.factor ? [{ label: 'Value', value: `${invested}` }] : [])
            ]
            : [],
        description: descText
    };
}

function getPlayerActivePerks(character) {
    const talents = Array.isArray(character?.talents) ? character.talents : [];
    const perks = Array.isArray(character?.perks) ? character.perks : [];
    const active = talents
        .filter(talent => talent && talent.perkSlot)
        .map(talent => findPlayerAssignedPerk(talent, perks))
        .filter(Boolean);
    const seen = new Set();
    return active.filter(perk => {
        const key = Number(perk.perk_id || perk.id || 0);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function bindPlayerHoverTooltips(container) {
    if (!container || typeof DesignerBase?.bindHoverTooltip !== 'function') return;
    container.querySelectorAll('[data-player-tooltip]').forEach(element => {
        DesignerBase.bindHoverTooltip(element, () => decodePlayerTooltip(element.dataset.playerTooltip));
    });
}

function encodePlayerTooltip(tooltip) {
    try {
        return encodeURIComponent(JSON.stringify(tooltip || null));
    } catch (error) {
        console.warn('Failed to encode player tooltip', error);
        return '';
    }
}

function decodePlayerTooltip(value) {
    if (!value) return null;
    try {
        return JSON.parse(decodeURIComponent(value));
    } catch (error) {
        console.warn('Failed to decode player tooltip', error);
        return null;
    }
}

function buildPlayerPerkTooltip(perk, subtitle) {
    return {
        title: perk?.name || `Perk ${perk?.id || '?'}`,
        subtitle,
        description: perk?.description || '',
        sections: buildPlayerPerkSections(perk)
    };
}

function buildPlayerPerkSections(perk) {
    const lines = getPlayerPerkEffectLines(perk);
    return lines.length ? [{ label: 'Effects', lines }] : [];
}

function getPlayerPerkEffectLines(perk) {
    if (!perk) return [];
    const lines = [];
    [
        { effectId: perk.effect1_id, factor: perk.factor1 },
        { effectId: perk.effect2_id, factor: perk.factor2 }
    ].forEach(entry => {
        if (!entry.effectId) return;
        const effect = findPlayerEffect(entry.effectId);
        if (!effect) return;
        const text = formatPlayerEffectText(effect, entry.factor, effect.description || effect.name || '');
        lines.push(`${effect.name || effect.effect_name || `Effect ${entry.effectId}`}: ${text}`);
    });
    return lines;
}

function buildPlayerItemTooltip(item, fallbackName) {
    const name = item?.item_name || item?.name || fallbackName || `Item ${item?.item_id || item?.id || '?'}`;
    const scaled = getScaledItemStats(item || {});
    const rows = buildPlayerItemStatRows(item || {}, scaled);
    const effect = findPlayerEffect(item?.effectID || item?.effectId);
    const effectAmount = Number(item?.effectFactor || item?.effect_factor || 0);
    const description = formatPlayerEffectText(effect, effectAmount, item?.description || '');
    return {
        title: name,
        subtitle: item?.type ? String(item.type).charAt(0).toUpperCase() + String(item.type).slice(1) : 'Item',
        description,
        rows
    };
}

function buildPlayerItemStatRows(item, scaled) {
    const rows = [
        buildPlayerStatRow('Strength', scaled.strength),
        buildPlayerStatRow('Stamina', scaled.stamina),
        buildPlayerStatRow('Agility', scaled.agility),
        buildPlayerStatRow('Luck', scaled.luck),
        buildPlayerStatRow('Armor', scaled.armor)
    ].filter(Boolean);
    if (item?.minDamage || item?.maxDamage) {
        rows.push({ label: 'Damage', value: `${scaled.minDamage}-${scaled.maxDamage}` });
    }
    return rows;
}

function buildPlayerStatRow(label, value) {
    if (!value) return null;
    const sign = Number(value) > 0 ? '+' : '';
    return { label, value: `${sign}${value}` };
}

function formatPlayerEffectText(effect, amount, defaultText) {
    const baseDescription = effect?.description || defaultText || '';
    if (typeof DesignerBase !== 'undefined' && typeof DesignerBase.formatEffectDescription === 'function') {
        return DesignerBase.formatEffectDescription(effect || { description: baseDescription }, amount, {
            defaultText: defaultText || baseDescription,
            appendPercentWhenNoPlaceholder: false
        });
    }
    if (baseDescription && baseDescription.includes('*')) {
        return baseDescription.replace('*', String(amount));
    }
    if (amount && baseDescription) {
        return `${baseDescription} ${amount}`;
    }
    return baseDescription;
}

function formatPlayerRemainingDuration(value) {
    if (!isFutureTimestamp(value)) return '';
    const remainingMs = Math.max(0, new Date(value).getTime() - Date.now());
    const hours = remainingMs / 3600000;
    const rounded = hours >= 10 ? hours.toFixed(0) : hours.toFixed(1);
    return `Expires in ${rounded}h`;
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

function setPlayerLoading(isLoading) {
    const refreshBtn = document.getElementById('playerRefreshBtn');
    if (!refreshBtn) return;
    refreshBtn.classList.toggle('is-loading', !!isLoading);
    refreshBtn.disabled = !!isLoading;
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
