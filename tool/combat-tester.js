// ==================== COMBAT TESTER ====================

const ACTION_ICONS = {
    attack:         '⚔️',
    crit:           '💥',
    dodge:          '💨',
    stun:           '😵',
    stunned:        '😵',
    bleed:          '🩸',
    counterattack:  '🔄',
    double_attack:  '⚡',
    heal:           '💚',
};

// ── State ────────────────────────────────────────────

let combatTalents1 = new Map(); // talentId -> { points, talentOrder, perkId }
let combatTalents2 = new Map();
let combatTalentOrder1 = 0;
let combatTalentOrder2 = 0;
let combatAnimator = null;
let combatResult = null;
let combatPerks = [];

// ── Init ─────────────────────────────────────────────

let combatTesterBooted = false;

function ensureCombatTesterInit() {
    if (combatTesterBooted) return;
    if (!document.getElementById('combatFightBtn')) return;
    combatTesterBooted = true;
    initCombatTester();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureCombatTesterInit);
} else {
    ensureCombatTesterInit();
}

function initCombatTester() {
    console.log('⚔️ Initializing Combat Tester...');

    document.getElementById('combatFightBtn').addEventListener('click', runCombat);

    // HP calc on stamina change
    for (const n of [1, 2]) {
        const staInput = document.getElementById(`combatSta${n}`);
        if (staInput) staInput.addEventListener('input', () => updateHpCalc(n));
    }

    // Fight button readiness
    checkFightReady();
    document.getElementById('combatPanel1').addEventListener('input', checkFightReady);
    document.getElementById('combatPanel2').addEventListener('input', checkFightReady);

    // Arena controls
    document.getElementById('arenaPlayBtn').addEventListener('click', () => {
        if (combatAnimator) combatAnimator.togglePlay();
    });
    document.getElementById('arenaSkipBtn').addEventListener('click', () => {
        if (combatAnimator) combatAnimator.skip();
    });

    // Overlay controls
    document.getElementById('combatReplayBtn').addEventListener('click', replayCombat);
    document.getElementById('combatDoneBtn').addEventListener('click', closeCombatOverlay);

    // Subscribe to talent updates
    if (typeof subscribeToGlobalData === 'function') {
        subscribeToGlobalData('talents', () => {
            buildCombatTalentTree(1);
            buildCombatTalentTree(2);
        });
    }

    // Load data and build trees
    loadCombatData();

    console.log('✅ Combat Tester initialized');
}

async function loadCombatData() {
    try {
        if (typeof loadEffectsData === 'function') await loadEffectsData();
        if (typeof loadEnemiesData === 'function' && (!GlobalData.talents || GlobalData.talents.length === 0)) {
            await loadEnemiesData();
        }
        combatPerks = typeof getPerks === 'function' ? getPerks() : [];
        buildCombatTalentTree(1);
        buildCombatTalentTree(2);
    } catch (e) {
        console.error('Combat data load error:', e);
    }
}

// ── HP / Ready ───────────────────────────────────────

function updateHpCalc(panel) {
    const sta = parseInt(document.getElementById(`combatSta${panel}`).value) || 0;
    document.getElementById(`combatHpCalc${panel}`).textContent = sta * 10;
}

function checkFightReady() {
    const sta1 = parseInt(document.getElementById('combatSta1').value) || 0;
    const sta2 = parseInt(document.getElementById('combatSta2').value) || 0;
    document.getElementById('combatFightBtn').disabled = sta1 <= 0 || sta2 <= 0;
}

// ── Talent Tree ──────────────────────────────────────

function combatGetTalentIconUrl(assetId) {
    if (!assetId) return '';
    if (typeof window.buildPublicAssetUrl === 'function')
        return window.buildPublicAssetUrl(`images/perks/${assetId}.webp`);
    return `https://pub-b959ac8ae579488bb4ed33c01a618ae2.r2.dev/images/perks/${assetId}.webp`;
}

function buildCombatTalentTree(panel) {
    const grid = document.getElementById(`combatTalentTree${panel}`);
    if (!grid) return;
    grid.innerHTML = '';

    const talents = typeof getTalents === 'function' ? getTalents() : [];
    if (!talents.length) {
        grid.innerHTML = '<div class="ct-empty">No talents loaded</div>';
        return;
    }

    talents.forEach(talent => {
        const row = talent.row || 1;
        const col = talent.col || 1;
        if (row < 1 || row > 8 || col < 1 || col > 7) return;

        const wrapper = document.createElement('div');
        wrapper.className = 'ct-cell-wrapper';
        wrapper.style.gridRow = String(9 - row);
        wrapper.style.gridColumn = String(col);

        const cell = document.createElement('div');
        cell.className = 'ct-cell';
        cell.dataset.talentId = talent.talentId;
        cell.dataset.panel = panel;

        const iconUrl = combatGetTalentIconUrl(talent.assetId);
        const hasPerkSlot = talent.perkSlot === true || talent.perkSlot > 0;

        cell.innerHTML = `
            <div class="ct-points"><span class="ct-current">0</span>/${talent.maxPoints}</div>
            <img class="ct-icon" src="${iconUrl}" alt="" onerror="this.style.display='none'">
            ${hasPerkSlot ? '<div class="ct-perk-indicator">P</div>' : ''}
            <button type="button" class="ct-detail-btn" title="View details">
                <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </button>
        `;

        // Gear button opens modal
        const gearBtn = cell.querySelector('.ct-detail-btn');
        gearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showCombatTalentModal(panel, talent);
        });

        // Hover tooltip
        cell.addEventListener('mouseenter', (e) => showCombatTalentTooltip(e, panel, talent));
        cell.addEventListener('mouseleave', hideCombatTalentTooltip);

        const label = document.createElement('div');
        label.className = 'ct-label';
        label.textContent = talent.talentName || '';

        cell.addEventListener('click', () => upgradeCombatTalent(panel, talent.talentId));
        cell.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            downgradeCombatTalent(panel, talent.talentId);
        });

        wrapper.appendChild(cell);
        wrapper.appendChild(label);
        grid.appendChild(wrapper);
    });
}

// ── Talent Tooltip ───────────────────────────────────

function showCombatTalentTooltip(e, panel, talent) {
    hideCombatTalentTooltip();

    const map = panel === 1 ? combatTalents1 : combatTalents2;
    const current = map.get(talent.talentId) || { points: 0 };
    const invested = current.points * (talent.factor || 0);

    const effect = (GlobalData.effects || []).find(ef => ef.id === talent.effectId);
    const hasPerkSlot = talent.perkSlot === true || talent.perkSlot > 0;
    let descText = effect?.description || talent.description || '';
    if (descText.includes('*')) {
        descText = descText.replace('*', String(invested || talent.factor || 0));
    } else if (talent.factor && descText) {
        descText = `${descText} (${talent.factor})`;
    }
    if (!descText && hasPerkSlot) {
        descText = 'Perk slot';
    } else if (!descText) {
        descText = talent.talentName;
    }

    // Add perk info to tooltip
    const cellAssigned = map.get(talent.talentId);
    if (cellAssigned?.perkId) {
        const cellPerk = combatPerks.find(p => p.id === cellAssigned.perkId);
        if (cellPerk) {
            const perkEffText = getCTPerkEffectText(cellPerk);
            if (perkEffText) descText += `\nPerk: ${cellPerk.name}\n${perkEffText}`;
        }
    }

    const tip = document.createElement('div');
    tip.className = 'ct-tooltip';
    tip.innerHTML = `
        <div class="ct-tooltip-name">${_ctEsc(talent.talentName)}</div>
        <div class="ct-tooltip-desc">${_ctEsc(descText).replace(/\n/g, '<br>')}</div>
        ${talent.factor ? `<div class="ct-tooltip-factor">Factor: ${talent.factor} per point${current.points > 0 ? ` (invested: ${invested})` : ''}</div>` : ''}
        <div class="ct-tooltip-points">${current.points} / ${talent.maxPoints} points</div>
    `;

    document.body.appendChild(tip);

    const rect = e.target.closest('.ct-cell').getBoundingClientRect();
    tip.style.left = rect.left + rect.width / 2 + 'px';
    tip.style.top = rect.top - 6 + 'px';
}

function hideCombatTalentTooltip() {
    const tip = document.querySelector('.ct-tooltip');
    if (tip) tip.remove();
}

function _ctEsc(text) {
    if (typeof escapeHtml === 'function') return escapeHtml(text);
    const d = document.createElement('div'); d.textContent = text; return d.innerHTML;
}

function getCTPerkEffectText(perk) {
    if (!perk) return '';
    const effects = GlobalData.effects || [];
    const lines = [];
    if (perk.effect1_id) {
        const eff = effects.find(e => e.id === perk.effect1_id);
        if (eff) {
            let desc = eff.description || eff.name;
            if (desc.includes('*') && perk.factor1 != null) desc = desc.replace('*', String(perk.factor1));
            lines.push(`${eff.name}: ${desc}`);
        }
    }
    if (perk.effect2_id) {
        const eff = effects.find(e => e.id === perk.effect2_id);
        if (eff) {
            let desc = eff.description || eff.name;
            if (desc.includes('*') && perk.factor2 != null) desc = desc.replace('*', String(perk.factor2));
            lines.push(`${eff.name}: ${desc}`);
        }
    }
    return lines.join('\n');
}

// ── Talent Upgrade Modal ─────────────────────────────

function showCombatTalentModal(panel, talent) {
    closeCombatTalentModal();

    const modal = document.createElement('div');
    modal.className = 'ct-modal-overlay';
    modal.dataset.talentId = talent.talentId;
    modal.dataset.panel = panel;

    modal.innerHTML = `
        <div class="ct-modal">
            <div class="ct-modal-header">
                <h3>${_ctEsc(talent.talentName)}</h3>
                <button type="button" class="btn-close" onclick="closeCombatTalentModal()">✕</button>
            </div>
            <div class="ct-modal-body">
                <p class="ct-modal-desc"></p>
                <div class="ct-modal-perk" style="display:none;"></div>
            </div>
            <div class="ct-modal-actions">
                <button type="button" class="btn-upgrade" data-panel="${panel}" data-talent="${talent.talentId}"></button>
                <button type="button" class="btn-downgrade" data-panel="${panel}" data-talent="${talent.talentId}">Remove Point</button>
            </div>
        </div>
    `;

    modal.querySelector('.btn-upgrade').addEventListener('click', () => {
        upgradeCombatTalent(panel, talent.talentId);
        refreshCombatTalentModal(panel, talent);
    });
    modal.querySelector('.btn-downgrade').addEventListener('click', () => {
        downgradeCombatTalent(panel, talent.talentId);
        refreshCombatTalentModal(panel, talent);
    });
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeCombatTalentModal();
    });

    document.body.appendChild(modal);
    refreshCombatTalentModal(panel, talent);
}

function refreshCombatTalentModal(panel, talent) {
    const modal = document.querySelector('.ct-modal-overlay:not(.ct-perk-overlay)');
    if (!modal) return;

    const map = panel === 1 ? combatTalents1 : combatTalents2;
    const current = map.get(talent.talentId) || { points: 0, talentOrder: 0, perkId: null };
    const canUpgrade = current.points < talent.maxPoints;
    const isMaxed = current.points >= talent.maxPoints;
    const hasPerkSlot = talent.perkSlot === true || talent.perkSlot > 0;
    const currentPerkName = current.perkId ? (combatPerks.find(p => p.id === current.perkId)?.name || `Perk #${current.perkId}`) : null;

    const effect = (GlobalData.effects || []).find(e => e.id === talent.effectId);
    let descText = effect?.description || talent.description || 'No description';
    const invested = current.points * (talent.factor || 0);
    if (descText.includes('*')) {
        descText = descText.replace('*', String(invested));
    } else if (invested) {
        descText = `${descText} ${invested}`;
    }

    if (!descText && hasPerkSlot) {
        descText = 'Perk slot';
    } else if (!descText) {
        descText = talent.talentName;
    }

    // Include perk info in description
    let fullDesc = descText;
    if (isMaxed && hasPerkSlot && currentPerkName) {
        const currentPerk = combatPerks.find(p => p.id === current.perkId);
        const perkEffText = getCTPerkEffectText(currentPerk);
        fullDesc += `\n\nPerk: ${currentPerkName}`;
        if (perkEffText) fullDesc += `\n${perkEffText}`;
    }
    modal.querySelector('.ct-modal-desc').innerHTML = _ctEsc(fullDesc).replace(/\n/g, '<br>');

    // Show change perk button if maxed with perk slot
    const perkEl = modal.querySelector('.ct-modal-perk');
    if (isMaxed && hasPerkSlot) {
        perkEl.innerHTML = `<button type="button" class="btn-change-perk">${current.perkId ? 'Change Perk' : 'Assign Perk'}</button>`;
        perkEl.querySelector('.btn-change-perk').addEventListener('click', () => {
            closeCombatTalentModal();
            showCombatPerkModal(panel, talent);
        });
        perkEl.style.display = '';
    } else {
        perkEl.style.display = 'none';
    }

    const upgradeBtn = modal.querySelector('.btn-upgrade');
    if (canUpgrade) {
        upgradeBtn.innerHTML = `Add Point <span class="point-count">(${current.points}/${talent.maxPoints})</span>`;
        upgradeBtn.disabled = false;
    } else {
        upgradeBtn.innerHTML = `MAXED <span class="point-count">(${current.points}/${talent.maxPoints})</span>`;
        upgradeBtn.disabled = true;
    }

    const downgradeBtn = modal.querySelector('.btn-downgrade');
    downgradeBtn.disabled = current.points === 0;
}

function closeCombatTalentModal() {
    const modal = document.querySelector('.ct-modal-overlay');
    if (modal) modal.remove();
}
window.closeCombatTalentModal = closeCombatTalentModal;

// ── Perk Selection Modal ─────────────────────────────

function showCombatPerkModal(panel, talent) {
    const map = panel === 1 ? combatTalents1 : combatTalents2;
    const current = map.get(talent.talentId) || { points: 0, talentOrder: 0, perkId: null };

    const modal = document.createElement('div');
    modal.className = 'ct-modal-overlay ct-perk-overlay';
    modal.innerHTML = `
        <div class="ct-modal">
            <div class="ct-modal-header">
                <h3>Select Perk for ${_ctEsc(talent.talentName)}</h3>
                <button type="button" class="btn-close ct-perk-cancel">✕</button>
            </div>
            <div class="ct-modal-body">
                <select class="ct-perk-select">
                    <option value="">-- No Perk --</option>
                    ${combatPerks.map(p => `<option value="${p.id}" ${p.id === current.perkId ? 'selected' : ''}>${_ctEsc(p.name)}</option>`).join('')}
                </select>
                <div class="ct-perk-preview"></div>
            </div>
            <div class="ct-modal-actions">
                <button type="button" class="btn-confirm">Confirm</button>
                <button type="button" class="btn-cancel ct-perk-cancel">Cancel</button>
            </div>
        </div>
    `;

    modal.querySelector('.btn-confirm').addEventListener('click', () => {
        const select = modal.querySelector('.ct-perk-select');
        const perkId = select.value ? parseInt(select.value) : null;
        const data = map.get(talent.talentId);
        if (data) {
            map.set(talent.talentId, { ...data, perkId });
            updateCombatTalentCell(panel, talent.talentId);
        }
        modal.remove();
    });
    modal.querySelectorAll('.ct-perk-cancel').forEach(btn => btn.addEventListener('click', () => modal.remove()));
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

    // Perk effect preview
    const select = modal.querySelector('.ct-perk-select');
    const preview = modal.querySelector('.ct-perk-preview');
    function updatePreview() {
        const id = select.value ? parseInt(select.value) : null;
        const perk = id ? combatPerks.find(p => p.id === id) : null;
        const text = getCTPerkEffectText(perk);
        preview.innerHTML = text ? _ctEsc(text).replace(/\n/g, '<br>') : '';
    }
    select.addEventListener('change', updatePreview);
    updatePreview();

    document.body.appendChild(modal);
}

// ── Talent Upgrade / Downgrade ───────────────────────

function upgradeCombatTalent(panel, talentId) {
    const talents = typeof getTalents === 'function' ? getTalents() : [];
    const talent = talents.find(t => t.talentId === talentId);
    if (!talent) return;

    const map = panel === 1 ? combatTalents1 : combatTalents2;
    const current = map.get(talentId) || { points: 0, talentOrder: 0, perkId: null };
    if (current.points >= talent.maxPoints) return;

    if (panel === 1) combatTalentOrder1++;
    else combatTalentOrder2++;

    const newPoints = current.points + 1;
    map.set(talentId, {
        points: newPoints,
        talentOrder: panel === 1 ? combatTalentOrder1 : combatTalentOrder2,
        perkId: current.perkId || null,
    });

    updateCombatTalentCell(panel, talentId);

    // If max reached + has perk slot, prompt for perk
    const hasPerkSlot = talent.perkSlot === true || talent.perkSlot > 0;
    if (newPoints >= talent.maxPoints && hasPerkSlot) {
        closeCombatTalentModal();
        showCombatPerkModal(panel, talent);
    }
}

function downgradeCombatTalent(panel, talentId) {
    const talents = typeof getTalents === 'function' ? getTalents() : [];
    const talent = talents.find(t => t.talentId === talentId);
    if (!talent) return;

    const map = panel === 1 ? combatTalents1 : combatTalents2;
    const current = map.get(talentId);
    if (!current || current.points <= 0) return;

    const newPoints = current.points - 1;
    if (newPoints <= 0) {
        map.delete(talentId);
    } else {
        map.set(talentId, {
            points: newPoints,
            talentOrder: current.talentOrder,
            perkId: newPoints < talent.maxPoints ? null : current.perkId,
        });
    }

    updateCombatTalentCell(panel, talentId);
}

function updateCombatTalentCell(panel, talentId) {
    const cell = document.querySelector(`.ct-cell[data-talent-id="${talentId}"][data-panel="${panel}"]`);
    if (!cell) return;

    const talents = typeof getTalents === 'function' ? getTalents() : [];
    const talent = talents.find(t => t.talentId === talentId);
    const map = panel === 1 ? combatTalents1 : combatTalents2;
    const current = map.get(talentId) || { points: 0, perkId: null };

    const el = cell.querySelector('.ct-current');
    if (el) el.textContent = current.points;

    cell.classList.toggle('has-points', current.points > 0);
    cell.classList.toggle('maxed', talent && current.points >= talent.maxPoints);

    // Update perk indicator
    const perkInd = cell.querySelector('.ct-perk-indicator');
    if (perkInd) perkInd.classList.toggle('assigned', !!current.perkId);
}

// ── Resolve talents → effects ────────────────────────

function resolveTalentEffects(panel) {
    const map = panel === 1 ? combatTalents1 : combatTalents2;
    const effects = [];
    let id = 1;
    const talents = typeof getTalents === 'function' ? getTalents() : [];
    const allEffects = typeof getEffects === 'function' ? getEffects() : (GlobalData?.effects || []);

    map.forEach((data, talentId) => {
        if (data.points <= 0) return;
        const talent = talents.find(t => t.talentId === talentId);
        if (!talent || !talent.effectId) return;

        const effect = allEffects.find(e => e.id === talent.effectId);
        if (!effect || !effect.coreEffectCode) return;

        effects.push({
            effectId: id++,
            coreEffectCode: effect.coreEffectCode,
            triggerType: effect.triggerType || 'passive',
            factorType: effect.factorType || 'percent',
            targetSelf: effect.targetSelf || false,
            conditionType: effect.conditionType || null,
            conditionValue: effect.conditionValue || null,
            duration: effect.duration || null,
            value: Math.round((talent.factor || 0) * data.points),
        });
    });
    return effects;
}

// ── Overlay ──────────────────────────────────────────

function openCombatOverlay() {
    const overlay = document.getElementById('combatOverlay');
    overlay.style.display = '';
    document.getElementById('combatReplayBtn').style.display = 'none';
    document.getElementById('combatDoneBtn').style.display = 'none';
}

function closeCombatOverlay() {
    const overlay = document.getElementById('combatOverlay');
    overlay.style.display = 'none';
    if (combatAnimator) { combatAnimator._cancel = true; combatAnimator = null; }
    combatResult = null;
    document.getElementById('combatLogSection').style.display = 'none';
    document.getElementById('combatLogEntries').innerHTML = '';
    const liveLog = document.getElementById('arenaLiveLog');
    if (liveLog) { liveLog.innerHTML = ''; liveLog.style.display = 'none'; }
    const statsSection = document.getElementById('combatStatsSection');
    if (statsSection) { statsSection.innerHTML = ''; statsSection.style.display = 'none'; }
}

function showOverlayEndButtons() {
    document.getElementById('combatReplayBtn').style.display = '';
    document.getElementById('combatDoneBtn').style.display = '';
    // Hide play/skip/speed controls since combat is over
    document.getElementById('arenaPlayBtn').style.display = 'none';
    document.getElementById('arenaSkipBtn').style.display = 'none';
    document.getElementById('arenaSpeed').style.display = 'none';
}

function replayCombat() {
    if (!combatResult) return;
    if (combatAnimator) combatAnimator._cancel = true;
    combatAnimator = new CombatAnimator(combatResult);
    combatAnimator.init();
    document.getElementById('combatReplayBtn').style.display = 'none';
    document.getElementById('combatDoneBtn').style.display = 'none';
    document.getElementById('combatLogSection').style.display = 'none';
    const liveLog = document.getElementById('arenaLiveLog');
    if (liveLog) { liveLog.innerHTML = ''; liveLog.style.display = 'none'; }
    const statsSection = document.getElementById('combatStatsSection');
    if (statsSection) { statsSection.innerHTML = ''; statsSection.style.display = 'none'; }
    combatAnimator.play();
}

// ── Run combat ───────────────────────────────────────

async function runCombat() {
    const btn = document.getElementById('combatFightBtn');
    const origHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="btn-spinner"></span> Fighting...';

    const payload = {
        combatant1: buildCombatant(1),
        combatant2: buildCombatant(2),
    };

    try {
        const token = await getCurrentAccessToken();
        if (!token) { alert('Auth required'); return; }

        const resp = await fetch('/api/testCombat', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (!resp.ok) {
            alert('Combat failed: ' + (await resp.text()));
            return;
        }

        combatResult = await resp.json();

        // Open overlay
        openCombatOverlay();

        // Cancel previous animation
        if (combatAnimator) combatAnimator._cancel = true;

        combatAnimator = new CombatAnimator(combatResult);
        combatAnimator.init();
        combatAnimator.play();
    } catch (e) {
        console.error('Combat error:', e);
        alert('Error: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = origHTML;
    }
}

function buildCombatant(panel) {
    return {
        name: document.getElementById(`combatName${panel}`).value || `Combatant ${panel}`,
        strength:  parseInt(document.getElementById(`combatStr${panel}`).value) || 0,
        stamina:   parseInt(document.getElementById(`combatSta${panel}`).value) || 1,
        agility:   parseInt(document.getElementById(`combatAgi${panel}`).value) || 0,
        luck:      parseInt(document.getElementById(`combatLck${panel}`).value) || 0,
        armor:     parseInt(document.getElementById(`combatArm${panel}`).value) || 0,
        minDamage: parseInt(document.getElementById(`combatMinDmg${panel}`).value) || 0,
        maxDamage: parseInt(document.getElementById(`combatMaxDmg${panel}`).value) || 0,
        effects: resolveTalentEffects(panel),
    };
}

// ── Helpers ──────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function triggerAnim(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
}

// ── Combat Animator ──────────────────────────────────

class CombatAnimator {
    constructor(result) {
        this.header = result.header;
        this.log = result.log || [];
        this.c1 = result.header.combatant1;
        this.c2 = result.header.combatant2;
        this.hp1 = this.c1.maxHp;
        this.hp2 = this.c2.maxHp;
        this.index = 0;
        this.playing = false;
        this.speed = 1;
        this._cancel = false;
    }

    init() {
        document.getElementById('fighterName1').textContent = this.c1.name;
        document.getElementById('fighterName2').textContent = this.c2.name;
        document.getElementById('fighterInitial1').textContent = (this.c1.name || 'C')[0].toUpperCase();
        document.getElementById('fighterInitial2').textContent = (this.c2.name || 'C')[0].toUpperCase();

        this.hp1 = this.c1.maxHp;
        this.hp2 = this.c2.maxHp;
        this.updateHpBars();

        document.getElementById('fighterEffects1').innerHTML = '';
        document.getElementById('fighterEffects2').innerHTML = '';
        document.getElementById('arenaTurn').textContent = 'Pre-combat';
        document.getElementById('arenaResult').textContent = '';
        document.getElementById('arenaResult').className = 'arena-result';
        document.getElementById('arenaAction').textContent = '';

        const liveLog = document.getElementById('arenaLiveLog');
        if (liveLog) { liveLog.innerHTML = ''; liveLog.style.display = 'none'; }

        for (const id of ['arenaFighter1', 'arenaFighter2']) {
            const el = document.getElementById(id);
            el.classList.remove('defeated', 'winner', 'lunge-right', 'lunge-left', 'hit', 'dodging', 'stunned', 'bleeding', 'healing');
        }

        this.index = 0;
        this._cancel = false;
        this.speed = parseFloat(document.getElementById('arenaSpeed').value) || 1;
        document.getElementById('arenaPlayBtn').textContent = '▶ Play';
        // Restore play/skip/speed controls
        document.getElementById('arenaPlayBtn').style.display = '';
        document.getElementById('arenaSkipBtn').style.display = '';
        document.getElementById('arenaSpeed').style.display = '';
    }

    async play() {
        if (this.playing) return;
        this.playing = true;
        this._cancel = false;
        document.getElementById('arenaPlayBtn').textContent = '⏸ Pause';

        while (this.index < this.log.length && this.playing && !this._cancel) {
            this.speed = parseFloat(document.getElementById('arenaSpeed').value) || 1;
            await this.processEntry(this.log[this.index]);
            this.index++;
            if (this.index < this.log.length && this.playing && !this._cancel) {
                await sleep(Math.max(80, 700 / this.speed));
            }
        }

        this.playing = false;
        if (this.index >= this.log.length && !this._cancel) {
            this.showResult();
        } else {
            document.getElementById('arenaPlayBtn').textContent = '▶ Play';
        }
    }

    pause() {
        this.playing = false;
        document.getElementById('arenaPlayBtn').textContent = '▶ Play';
    }

    togglePlay() {
        this.playing ? this.pause() : this.play();
    }

    skip() {
        this._cancel = true;
        this.playing = false;
        this.index = this.log.length;
        this.hp1 = Math.max(0, this.c1.hpEnd);
        this.hp2 = Math.max(0, this.c2.hpEnd);
        this.updateHpBars();
        this.showResult();
    }

    // ── Per-entry processing ─────────────────────────

    async processEntry(entry) {
        const isC1 = entry.characterId === this.c1.id;
        document.getElementById('arenaTurn').textContent =
            entry.turn === 0 ? 'Pre-combat' : `Turn ${entry.turn}`;

        // Apply HP delta
        const delta = this.getHpDelta(entry);
        this.hp1 = Math.max(0, Math.min(this.c1.maxHp, this.hp1 + delta.c1));
        this.hp2 = Math.max(0, Math.min(this.c2.maxHp, this.hp2 + delta.c2));

        switch (entry.action) {
            case 'attack':
            case 'crit':
            case 'double_attack':
                await this.animateAttack(isC1, entry.factor, entry.action === 'crit');
                break;
            case 'dodge':
                await this.animateDodge(isC1);
                break;
            case 'stun':
                await this.animateStun(isC1, true);
                break;
            case 'stunned':
                await this.animateStun(isC1, false);
                break;
            case 'bleed':
                await this.animateBleed(isC1, entry.factor);
                break;
            case 'counterattack':
                await this.animateCounterattack(isC1, entry.factor);
                break;
            case 'heal':
                await this.animateHeal(isC1, entry.factor);
                break;
            default:
                this.showAction(`${ACTION_ICONS[entry.action] || '⚔️'} ${entry.action}`);
                await sleep(250);
                break;
        }

        this.updateHpBars();
        this.appendLiveLog(entry);
    }

    getHpDelta(entry) {
        const isC1 = entry.characterId === this.c1.id;
        const f = entry.factor || 0;
        switch (entry.action) {
            case 'attack': case 'crit': case 'double_attack': case 'counterattack':
                return isC1 ? { c1: 0, c2: -f } : { c1: -f, c2: 0 };
            case 'bleed':
                return isC1 ? { c1: -f, c2: 0 } : { c1: 0, c2: -f };
            case 'heal':
                return isC1 ? { c1: f, c2: 0 } : { c1: 0, c2: f };
            default:
                return { c1: 0, c2: 0 };
        }
    }

    // ── Animations ───────────────────────────────────

    async animateAttack(isC1, damage, isCrit) {
        const attackerEl = document.getElementById(isC1 ? 'arenaFighter1' : 'arenaFighter2');
        const defenderEl = document.getElementById(isC1 ? 'arenaFighter2' : 'arenaFighter1');
        const defSide = isC1 ? 2 : 1;

        this.showAction(`${isCrit ? '💥 CRIT' : '⚔️'} ${damage}`);
        triggerAnim(attackerEl, isC1 ? 'lunge-right' : 'lunge-left');
        await sleep(180);
        triggerAnim(defenderEl, 'hit');
        this.showDmgNum(defSide, damage, isCrit ? 'crit' : 'damage');
        await sleep(280);
    }

    async animateDodge(isC1) {
        const attackerEl = document.getElementById(isC1 ? 'arenaFighter1' : 'arenaFighter2');
        const defenderEl = document.getElementById(isC1 ? 'arenaFighter2' : 'arenaFighter1');
        const defSide = isC1 ? 2 : 1;

        this.showAction('💨 DODGE');
        triggerAnim(attackerEl, isC1 ? 'lunge-right' : 'lunge-left');
        await sleep(150);
        triggerAnim(defenderEl, 'dodging');
        this.showDmgNum(defSide, 'DODGE', 'dodge');
        await sleep(300);
    }

    async animateStun(isC1, isApplied) {
        if (isApplied) {
            const defSide = isC1 ? 2 : 1;
            const defEl = document.getElementById(isC1 ? 'arenaFighter2' : 'arenaFighter1');
            this.showAction('😵 STUN');
            triggerAnim(defEl, 'stunned');
            this.showDmgNum(defSide, 'STUN', 'stun');
        } else {
            const el = document.getElementById(isC1 ? 'arenaFighter1' : 'arenaFighter2');
            const side = isC1 ? 1 : 2;
            this.showAction('😵 Stunned!');
            triggerAnim(el, 'stunned');
            this.showDmgNum(side, 'STUNNED', 'stun');
        }
        await sleep(350);
    }

    async animateBleed(isC1, damage) {
        const side = isC1 ? 1 : 2;
        const el = document.getElementById(isC1 ? 'arenaFighter1' : 'arenaFighter2');
        this.showAction(`🩸 ${damage}`);
        triggerAnim(el, 'bleeding');
        this.showDmgNum(side, damage, 'bleed');
        await sleep(350);
    }

    async animateCounterattack(isC1, damage) {
        const counterEl = document.getElementById(isC1 ? 'arenaFighter1' : 'arenaFighter2');
        const targetEl = document.getElementById(isC1 ? 'arenaFighter2' : 'arenaFighter1');
        const targetSide = isC1 ? 2 : 1;

        this.showAction(`🔄 Counter ${damage}`);
        triggerAnim(counterEl, isC1 ? 'lunge-right' : 'lunge-left');
        await sleep(180);
        triggerAnim(targetEl, 'hit');
        this.showDmgNum(targetSide, damage, 'damage');
        await sleep(280);
    }

    async animateHeal(isC1, amount) {
        const side = isC1 ? 1 : 2;
        const el = document.getElementById(isC1 ? 'arenaFighter1' : 'arenaFighter2');
        this.showAction(`💚 +${amount}`);
        triggerAnim(el, 'healing');
        this.showDmgNum(side, amount, 'heal');
        await sleep(350);
    }

    // ── UI helpers ───────────────────────────────────

    showAction(text) {
        const el = document.getElementById('arenaAction');
        el.textContent = text;
        triggerAnim(el, 'pop');
    }

    showDmgNum(side, value, type) {
        const container = document.getElementById(`fighterEffects${side}`);
        const num = document.createElement('div');
        num.className = `floating-number ${type}`;
        num.textContent = type === 'heal' ? `+${value}` : (typeof value === 'number' ? `-${value}` : value);
        container.appendChild(num);
        setTimeout(() => num.remove(), 1100);
    }

    updateHpBars() {
        for (const [side, hp, maxHp] of [[1, this.hp1, this.c1.maxHp], [2, this.hp2, this.c2.maxHp]]) {
            const pct = Math.max(0, hp / maxHp * 100);
            const fill = document.getElementById(`fighterHpFill${side}`);
            const text = document.getElementById(`fighterHpText${side}`);
            fill.style.width = pct + '%';
            fill.classList.toggle('critical', pct < 25);
            fill.classList.toggle('low', pct >= 25 && pct < 50);
            text.textContent = `${Math.max(0, Math.round(hp))} / ${maxHp}`;
        }
    }

    appendLiveLog(entry) {
        const container = document.getElementById('arenaLiveLog');
        if (!container) return;
        container.style.display = '';

        const isC1 = entry.characterId === this.c1.id;
        const actor = isC1 ? this.c1.name : this.c2.name;
        const opponent = isC1 ? this.c2.name : this.c1.name;
        const _esc = (t) => { const d = document.createElement('span'); d.textContent = t; return d.innerHTML; };
        const icon = ACTION_ICONS[entry.action] || '⚔️';
        const desc = formatAction(entry.action, entry.factor, actor, opponent, _esc);

        const row = document.createElement('div');
        row.className = 'live-log-row ' + (isC1 ? 'c1' : 'c2');
        row.innerHTML = `<span class="live-log-icon">${icon}</span><span class="live-log-actor">${_esc(actor)}</span> ${desc}`;
        container.appendChild(row);

        // Keep only last 5
        while (container.children.length > 5) container.removeChild(container.firstChild);
        container.scrollTop = container.scrollHeight;
    }

    showResult() {
        const winnerId = this.header.winnerId;
        const isC1Win = winnerId === this.c1.id;
        const winnerName = isC1Win ? this.c1.name : this.c2.name;

        const res = document.getElementById('arenaResult');
        res.textContent = `🏆 ${winnerName} wins!`;
        res.className = 'arena-result ' + (isC1Win ? 'win1' : 'win2');

        document.getElementById('arenaFighter1').classList.add(isC1Win ? 'winner' : 'defeated');
        document.getElementById('arenaFighter2').classList.add(isC1Win ? 'defeated' : 'winner');

        renderCombatLog();
        renderCombatStats();
        showOverlayEndButtons();
    }
}

// ── Combat Log (text) ────────────────────────────────

function renderCombatLog() {
    if (!combatResult) return;
    const section = document.getElementById('combatLogSection');
    section.style.display = '';

    const c1 = combatResult.header.combatant1;
    const c2 = combatResult.header.combatant2;
    const log = combatResult.log || [];
    const container = document.getElementById('combatLogEntries');
    container.innerHTML = '';

    const _esc = typeof escapeHtml === 'function' ? escapeHtml : (t) => {
        const d = document.createElement('div'); d.textContent = t; return d.innerHTML;
    };

    let lastTurn = -1;
    for (const entry of log) {
        if (entry.turn !== lastTurn) {
            lastTurn = entry.turn;
            const div = document.createElement('div');
            div.className = 'combat-log-entry turn-divider';
            div.textContent = entry.turn === 0 ? '— Pre-combat —' : `— Turn ${entry.turn} —`;
            container.appendChild(div);
        }
        const isC1 = entry.characterId === c1.id;
        const actor = isC1 ? c1.name : c2.name;
        const opponent = isC1 ? c2.name : c1.name;
        const icon = ACTION_ICONS[entry.action] || '⚔️';
        const desc = formatAction(entry.action, entry.factor, actor, opponent, _esc);

        const el = document.createElement('div');
        el.className = 'combat-log-entry ' + (isC1 ? 'c1' : 'c2');
        el.innerHTML = `<span class="combat-log-icon">${icon}</span><span class="combat-log-actor">${_esc(actor)}</span><span class="combat-log-desc">${desc}</span>`;
        container.appendChild(el);
    }
}

function renderCombatStats() {
    if (!combatResult || !combatResult.stats) return;
    const section = document.getElementById('combatStatsSection');
    if (!section) return;
    section.style.display = '';

    const c1 = combatResult.header.combatant1;
    const c2 = combatResult.header.combatant2;
    const s1 = combatResult.stats.combatant1;
    const s2 = combatResult.stats.combatant2;

    const pct = (num, den) => den > 0 ? Math.round(num / den * 100) : 0;
    const _esc = (t) => { const d = document.createElement('span'); d.textContent = t; return d.innerHTML; };

    const rows = [
        { label: 'Damage Dealt',    v1: s1.damageDealt,   v2: s2.damageDealt },
        { label: 'Damage Taken',    v1: s1.damageTaken,   v2: s2.damageTaken },
        { label: 'Attacks Landed',  v1: s1.attacks,       v2: s2.attacks },
        { label: 'Crit Hits',       v1: s1.critHits,      v2: s2.critHits },
        { label: 'Crit Rate',       v1: pct(s1.critHits, s1.attacks) + '%', v2: pct(s2.critHits, s2.attacks) + '%' },
        { label: 'Dodged Attacks',  v1: s1.dodgedAttacks, v2: s2.dodgedAttacks },
        { label: 'Dodge Rate',      v1: pct(s1.dodgedAttacks, s1.dodgedAttacks + s2.attacks) + '%',
                                     v2: pct(s2.dodgedAttacks, s2.dodgedAttacks + s1.attacks) + '%' },
        { label: 'Healing Done',    v1: s1.healingDone,   v2: s2.healingDone },
        { label: '% Max HP Healed', v1: pct(s1.healingDone, c1.maxHp) + '%', v2: pct(s2.healingDone, c2.maxHp) + '%' },
        { label: 'Stuns Applied',   v1: s1.stunApplied,   v2: s2.stunApplied },
        { label: 'Times Stunned',   v1: s1.timesStunned,  v2: s2.timesStunned },
        { label: 'Bleed Applied',   v1: s1.bleedApplied,  v2: s2.bleedApplied },
        { label: 'Counter Hits',    v1: s1.counterHits,   v2: s2.counterHits },
        { label: 'Double Attacks',  v1: s1.doubleAttacks, v2: s2.doubleAttacks },
    ];

    section.innerHTML = `
        <div class="combat-stats-header">
            <h3>Combat Statistics</h3>
        </div>
        <table class="combat-stats-table">
            <thead>
                <tr>
                    <th>${_esc(c1.name)}</th>
                    <th>Stat</th>
                    <th>${_esc(c2.name)}</th>
                </tr>
            </thead>
            <tbody>
                ${rows.map(r => `<tr>
                    <td class="stat-val c1">${r.v1}</td>
                    <td class="stat-label">${_esc(r.label)}</td>
                    <td class="stat-val c2">${r.v2}</td>
                </tr>`).join('')}
            </tbody>
        </table>`;
}

function formatAction(action, factor, actor, opponent, esc) {
    const e = esc || ((t) => t);
    switch (action) {
        case 'attack':        return `deals <b>${factor}</b> damage`;
        case 'crit':          return `crits for <b>${factor}</b> damage`;
        case 'dodge':         return `attack dodged by ${e(opponent)}`;
        case 'stun':          return `stuns ${e(opponent)}`;
        case 'stunned':       return 'is stunned!';
        case 'bleed':         return factor > 0 ? `bleeds for <b>${factor}</b>` : 'applies bleed';
        case 'counterattack': return `counters for <b>${factor}</b>`;
        case 'double_attack': return `double attack for <b>${factor}</b>`;
        case 'heal':          return `heals for <b>${factor}</b>`;
        default:              return `${action} (${factor})`;
    }
}

console.log('⚔️ Combat Tester module loaded');
