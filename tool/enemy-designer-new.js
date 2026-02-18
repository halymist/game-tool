// Enemy Designer JavaScript - New Version with Talent Tree

// ==================== STATE ====================
let allEnemies = [];
let allPendingEnemies = [];
let filteredEnemies = [];
let filteredPendingEnemies = [];
let selectedEnemyId = null;
let enemyActiveTab = 'game';
let isViewingPendingEnemy = false;

// Reference data
let allTalents = []; // Talent tree template (game.talents_info)
let enemyPerks = [];   // Available perks for perk slots (renamed to avoid conflict with perk-designer.js)
let enemyAssets = [];
let enemySelectedAssetId = null;
let enemySelectedAssetIcon = null;

// Talent tree state for current enemy being edited
let currentTalentOrder = 0; // Next talent order to assign
let assignedTalents = new Map(); // talentId -> { points: number, talentOrder: number, perkId: number|null }

// ==================== INITIALIZATION ====================

let enemyDesignerBootstrapped = false;

function ensureEnemyDesignerInit() {
    if (enemyDesignerBootstrapped) return;
    if (!document.getElementById('enemyForm')) return;
    enemyDesignerBootstrapped = true;
    initEnemyDesigner();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureEnemyDesignerInit);
} else {
    ensureEnemyDesignerInit();
}

function initEnemyDesigner() {
    console.log('🎮 Initializing Enemy Designer...');
    loadEnemyDesignerData();
    setupEnemyEventListeners();
    console.log('✅ Enemy Designer initialized');
}

function setupEnemyEventListeners() {
    // Tab buttons
    const gameTab = document.getElementById('gameEnemiesTab');
    const pendingTab = document.getElementById('pendingEnemiesTab');
    if (gameTab) gameTab.addEventListener('click', () => switchEnemyTab('game'));
    if (pendingTab) pendingTab.addEventListener('click', () => switchEnemyTab('pending'));
    
    // Search
    const searchInput = document.getElementById('enemySearch');
    if (searchInput) searchInput.addEventListener('input', filterEnemies);
    
    // New enemy button
    const newBtn = document.getElementById('newEnemyBtn');
    if (newBtn) newBtn.addEventListener('click', createNewEnemy);
    
    // Merge button
    const mergeBtn = document.getElementById('mergeEnemiesBtn');
    if (mergeBtn) mergeBtn.addEventListener('click', mergeApprovedEnemies);
    
    // Asset gallery
    const assetGalleryBtn = document.getElementById('enemyAssetGalleryBtn');
    if (assetGalleryBtn) assetGalleryBtn.addEventListener('click', toggleEnemyAssetGallery);
    
    const assetGalleryClose = document.getElementById('enemyAssetGalleryClose');
    if (assetGalleryClose) assetGalleryClose.addEventListener('click', toggleEnemyAssetGallery);
    
    const assetGalleryOverlay = document.getElementById('enemyAssetGalleryOverlay');
    if (assetGalleryOverlay) {
        assetGalleryOverlay.addEventListener('click', (e) => {
            if (e.target === assetGalleryOverlay) toggleEnemyAssetGallery();
        });
    }
    
    // Upload button
    const uploadBtn = document.getElementById('enemyUploadNewBtn');
    if (uploadBtn) {
        uploadBtn.addEventListener('click', () => {
            document.getElementById('enemyIconFile').click();
        });
    }
    
    // File input
    const fileInput = document.getElementById('enemyIconFile');
    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) handleEnemyIconUpload(file);
        });
    }
    
    // Icon upload area - click to open gallery
    const iconUploadArea = document.getElementById('enemyIconUploadArea');
    if (iconUploadArea) {
        iconUploadArea.addEventListener('click', () => {
            toggleEnemyAssetGallery();
        });
        iconUploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            iconUploadArea.classList.add('drag-over');
        });
        iconUploadArea.addEventListener('dragleave', () => {
            iconUploadArea.classList.remove('drag-over');
        });
        iconUploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            iconUploadArea.classList.remove('drag-over');
            const file = e.dataTransfer.files[0];
            if (file) handleEnemyIconUpload(file);
        });
    }
    
    // Cancel button
    const cancelBtn = document.getElementById('enemyCancelBtn');
    if (cancelBtn) cancelBtn.addEventListener('click', cancelEnemyEdit);
    
    // Form submission
    const form = document.getElementById('enemyForm');
    if (form) form.addEventListener('submit', saveEnemy);
}

// ==================== DATA LOADING ====================

async function loadEnemyDesignerData(options = {}) {
    const forceReload = options?.forceReload === true;
    if (forceReload) console.log('🔄 Reloading enemies data...');
    
    try {
        // Load enemies (also populates talents, perks, effects in GlobalData)
        await loadEnemiesData({ forceReload });
        allEnemies = getEnemies();
        allPendingEnemies = getPendingEnemies();
        filteredEnemies = [...allEnemies];
        filteredPendingEnemies = [...allPendingEnemies];
        
        // Get talents and perks from GlobalData (populated by loadEnemiesData)
        allTalents = getTalents();
        enemyPerks = getPerks();
        
        // Load enemy assets from S3
        await loadEnemyAssets({ forceReload });
        enemyAssets = getEnemyAssets();
        
        // Render UI
        renderEnemyList();
        renderPendingEnemyList();
        createEnemyAssetGallery();
        buildTalentTreeGrid();
        
    } catch (error) {
        console.error('Error loading enemy designer data:', error);
    }
}

// ==================== LIST RENDERING ====================

function renderEnemyList() {
    const list = document.getElementById('enemyList');
    if (!list) return;
    
    if (filteredEnemies.length === 0) {
        list.innerHTML = '<p class="loading-text">No enemies found</p>';
        return;
    }
    
    list.innerHTML = filteredEnemies.map(enemy => `
        <div class="enemy-list-item ${enemy.enemyId === selectedEnemyId && enemyActiveTab === 'game' ? 'selected' : ''}"
             data-id="${enemy.enemyId}" onclick="selectEnemy(${enemy.enemyId})">
            <div class="enemy-list-icon">
                ${enemy.icon ? `<img src="${enemy.icon}" alt="${escapeHtml(enemy.enemyName)}" />` : '<span class="no-icon">?</span>'}
            </div>
            <div class="enemy-list-info">
                <span class="enemy-name">${escapeHtml(enemy.enemyName)}</span>
                <span class="enemy-stats">STR:${enemy.strength} STA:${enemy.stamina} AGI:${enemy.agility}</span>
            </div>
        </div>
    `).join('');
}

function renderPendingEnemyList() {
    const list = document.getElementById('pendingEnemyList');
    if (!list) return;
    
    if (filteredPendingEnemies.length === 0) {
        list.innerHTML = '<p class="loading-text">No pending enemies</p>';
        return;
    }
    
    list.innerHTML = filteredPendingEnemies.map(enemy => `
        <div class="enemy-list-item pending-enemy ${enemy.toolingId === selectedEnemyId && enemyActiveTab === 'pending' ? 'selected' : ''}"
             data-id="${enemy.toolingId}" onclick="selectPendingEnemy(${enemy.toolingId})">
            <div class="pending-enemy-header">
                <span class="enemy-name">${escapeHtml(enemy.enemyName)}</span>
                <span class="enemy-action ${enemy.action}">${enemy.action}</span>
            </div>
            <div class="pending-enemy-footer">
                <div class="pending-enemy-actions" onclick="event.stopPropagation()">
                    <label class="approve-checkbox">
                        <input type="checkbox" ${enemy.approved ? 'checked' : ''} 
                               onchange="toggleEnemyApproval(${enemy.toolingId}, this.checked)">
                        <span>Approve</span>
                    </label>
                    <button class="btn-remove-pending" onclick="removePendingEnemy(${enemy.toolingId})" title="Remove">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    `).join('');
}

function filterEnemies() {
    const searchTerm = document.getElementById('enemySearch')?.value.toLowerCase() || '';
    
    filteredEnemies = allEnemies.filter(e => e.enemyName.toLowerCase().includes(searchTerm));
    filteredPendingEnemies = allPendingEnemies.filter(e => e.enemyName.toLowerCase().includes(searchTerm));
    
    renderEnemyList();
    renderPendingEnemyList();
}

// ==================== TAB SWITCHING ====================

function switchEnemyTab(tab) {
    enemyActiveTab = tab;
    
    const gameTab = document.getElementById('gameEnemiesTab');
    const pendingTab = document.getElementById('pendingEnemiesTab');
    const gameList = document.getElementById('enemyList');
    const pendingList = document.getElementById('pendingEnemyList');
    const newBtn = document.getElementById('newEnemyBtn');
    const mergeBtn = document.getElementById('mergeEnemiesBtn');
    
    if (tab === 'game') {
        gameTab?.classList.add('active');
        pendingTab?.classList.remove('active');
        if (gameList) gameList.style.display = 'block';
        if (pendingList) pendingList.style.display = 'none';
        if (newBtn) newBtn.style.display = 'inline-flex';
        if (mergeBtn) mergeBtn.style.display = 'none';
    } else {
        gameTab?.classList.remove('active');
        pendingTab?.classList.add('active');
        if (gameList) gameList.style.display = 'none';
        if (pendingList) pendingList.style.display = 'block';
        if (newBtn) newBtn.style.display = 'none';
        if (mergeBtn) mergeBtn.style.display = 'inline-flex';
    }
}

// ==================== SELECTION ====================

function selectEnemy(enemyId) {
    selectedEnemyId = enemyId;
    isViewingPendingEnemy = false;
    
    const enemy = allEnemies.find(e => e.enemyId === enemyId);
    if (!enemy) return;
    
    populateEnemyForm(enemy);
    loadTalentsIntoTree(enemy.talents || []);
    setEnemyFormLocked(false);
    renderEnemyList();
}

function selectPendingEnemy(toolingId) {
    selectedEnemyId = toolingId;
    isViewingPendingEnemy = true;
    
    const enemy = allPendingEnemies.find(e => e.toolingId === toolingId);
    if (!enemy) return;
    
    populateEnemyForm(enemy, true);
    loadTalentsIntoTree(enemy.talents || []);
    setEnemyFormLocked(true);
    renderPendingEnemyList();
}

function populateEnemyForm(enemy, isPending = false) {
    document.getElementById('enemyId').value = isPending ? `Pending #${enemy.toolingId}` : (enemy.enemyId || 'New');
    document.getElementById('enemyName').value = enemy.enemyName || '';
    document.getElementById('enemyDescription').value = enemy.description || '';
    
    document.getElementById('enemyStrength').value = enemy.strength || 0;
    document.getElementById('enemyStamina').value = enemy.stamina || 0;
    document.getElementById('enemyAgility').value = enemy.agility || 0;
    document.getElementById('enemyLuck').value = enemy.luck || 0;
    document.getElementById('enemyArmor').value = enemy.armor || 0;
    document.getElementById('enemyMinDamage').value = enemy.minDamage || 0;
    document.getElementById('enemyMaxDamage').value = enemy.maxDamage || 0;
    
    // Set asset
    enemySelectedAssetId = enemy.assetId || null;
    const iconPreview = document.getElementById('enemyIconPreview');
    if (enemy.icon || (enemy.assetId && enemy.assetId > 0)) {
        const iconUrl = enemy.icon || `https://gamedata-assets.s3.eu-north-1.amazonaws.com/images/enemies/${enemy.assetId}.webp`;
        iconPreview.innerHTML = `<img src="${iconUrl}" alt="Enemy icon" />`;
        enemySelectedAssetIcon = iconUrl;
    } else {
        iconPreview.innerHTML = `
            <svg class="upload-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <span>Drop image here</span>
        `;
        enemySelectedAssetIcon = null;
    }
}

function setEnemyFormLocked(locked) {
    const form = document.getElementById('enemyForm');
    if (!form) return;
    
    const inputs = form.querySelectorAll('input, select, textarea');
    inputs.forEach(input => {
        if (input.id !== 'enemySearch') {
            input.disabled = locked;
        }
    });
    
    const saveBtn = document.getElementById('enemySaveBtn');
    if (saveBtn) saveBtn.style.display = locked ? 'none' : 'inline-flex';
    
    form.classList.toggle('form-locked', locked);
    
    // Lock talent tree interactions
    const talentCells = document.querySelectorAll('.talent-cell');
    talentCells.forEach(cell => {
        cell.classList.toggle('disabled', locked);
    });
}

// ==================== CREATE/NEW ====================

function createNewEnemy() {
    selectedEnemyId = null;
    isViewingPendingEnemy = false;
    
    clearEnemyForm();
    clearTalentTree();
    setEnemyFormLocked(false);
    
    renderEnemyList();
}

function clearEnemyForm() {
    document.getElementById('enemyId').value = 'New';
    document.getElementById('enemyName').value = '';
    document.getElementById('enemyDescription').value = '';
    
    document.getElementById('enemyStrength').value = 0;
    document.getElementById('enemyStamina').value = 0;
    document.getElementById('enemyAgility').value = 0;
    document.getElementById('enemyLuck').value = 0;
    document.getElementById('enemyArmor').value = 0;
    document.getElementById('enemyMinDamage').value = 0;
    document.getElementById('enemyMaxDamage').value = 0;
    
    enemySelectedAssetId = null;
    enemySelectedAssetIcon = null;
    
    const iconPreview = document.getElementById('enemyIconPreview');
    if (iconPreview) {
        iconPreview.innerHTML = `
            <svg class="upload-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <span>Drop image here</span>
        `;
    }
}

function cancelEnemyEdit() {
    if (selectedEnemyId && !isViewingPendingEnemy) {
        selectEnemy(selectedEnemyId);
    } else {
        createNewEnemy();
    }
}

// ==================== TALENT TREE ====================

function buildTalentTreeGrid() {
    const grid = document.getElementById('talentTreeGrid');
    if (!grid) return;
    
    // Render based on talents_info positions (row 1 bottom, col 1 left)
    grid.innerHTML = '';

    allTalents.forEach(talent => {
        const row = talent.row || 1;
        const col = talent.col || 1;
        if (row < 1 || row > 8 || col < 1 || col > 7) return;

        const wrapper = document.createElement('div');
        wrapper.className = 'talent-cell-wrapper';
        const gridRow = 9 - row; // invert so row 1 is bottom
        wrapper.style.gridRow = String(gridRow);
        wrapper.style.gridColumn = String(col);

        const cell = document.createElement('div');
        cell.className = 'talent-cell';
        cell.dataset.talentId = talent.talentId;

        const iconUrl = getTalentIconUrl(talent.assetId);
        cell.innerHTML = `
            <div class="talent-max">${talent.maxPoints}</div>
            <div class="talent-current"><span class="current-points">0</span></div>
            <img class="talent-icon" src="${iconUrl}" alt="${escapeHtml(talent.talentName)}" onerror="this.style.display='none'">
            ${(talent.perkSlot === true || talent.perkSlot > 0) ? '<div class="perk-indicator">⭐</div>' : ''}
        `;

        const label = document.createElement('div');
        label.className = 'talent-cell-label';
        label.textContent = talent.talentName || '';

        cell.addEventListener('click', () => showTalentUpgradeModal(talent));
        label.addEventListener('click', () => showTalentUpgradeModal(talent));
        cell.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            handleTalentRightClick(talent);
        });

        wrapper.appendChild(cell);
        wrapper.appendChild(label);
        grid.appendChild(wrapper);
    });
}

function getTalentIconUrl(assetId) {
    if (!assetId) return '';
    return `https://gamedata-assets.s3.eu-north-1.amazonaws.com/images/perks/${assetId}.webp`;
}

function showTalentUpgradeModal(talent) {
    if (isViewingPendingEnemy) return;
    
    const current = assignedTalents.get(talent.talentId) || { points: 0, talentOrder: 0, perkId: null };
    const canUpgrade = current.points < talent.maxPoints;
    
    // Build description text with factor
    let descText = talent.description || 'No description';
    if (talent.factor) {
        descText = `${descText} ${talent.factor}%`;
    }
    
    const modal = document.createElement('div');
    modal.className = 'talent-upgrade-modal';
    modal.innerHTML = `
        <div class="talent-upgrade-content">
            <div class="talent-upgrade-header">
                <h3>${escapeHtml(talent.talentName)}</h3>
                <button type="button" class="btn-close" onclick="closeTalentUpgradeModal()">✕</button>
            </div>
            <div class="talent-upgrade-body">
                <div class="talent-upgrade-points">
                    <span class="current">${current.points}</span> / <span class="max">${talent.maxPoints}</span> points
                </div>
                <p class="talent-upgrade-desc">${escapeHtml(descText)}</p>
                ${(talent.perkSlot === true || talent.perkSlot > 0) ? '<p class="talent-perk-note">⭐ This talent has a perk slot when maxed</p>' : ''}
            </div>
            <div class="talent-upgrade-actions">
                ${canUpgrade ? `<button type="button" class="btn-upgrade" onclick="upgradeTalent(${talent.talentId})">⬆️ Add Point</button>` : '<span class="maxed-text">MAXED</span>'}
                ${current.points > 0 ? `<button type="button" class="btn-downgrade" onclick="downgradeTalent(${talent.talentId})">⬇️ Remove Point</button>` : ''}
            </div>
        </div>
    `;
    
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeTalentUpgradeModal();
    });
    
    document.body.appendChild(modal);
}

function closeTalentUpgradeModal() {
    const modal = document.querySelector('.talent-upgrade-modal');
    if (modal) modal.remove();
}

function upgradeTalent(talentId) {
    const talent = allTalents.find(t => t.talentId === talentId);
    if (!talent) return;
    
    const current = assignedTalents.get(talentId) || { points: 0, talentOrder: 0, perkId: null };
    
    if (current.points < talent.maxPoints) {
        currentTalentOrder++;
        assignedTalents.set(talentId, {
            points: current.points + 1,
            talentOrder: currentTalentOrder,
            perkId: current.perkId
        });
        
        updateTalentCellDisplay(talentId);
        closeTalentUpgradeModal();
        
        // If max points reached and has perk slot, prompt for perk
        if (current.points + 1 === talent.maxPoints && (talent.perkSlot === true || talent.perkSlot > 0)) {
            showPerkSelectionModal(talent);
        }
    }
}

function downgradeTalent(talentId) {
    const talent = allTalents.find(t => t.talentId === talentId);
    if (!talent) return;
    
    const current = assignedTalents.get(talentId);
    if (!current || current.points === 0) return;
    
    const newPoints = current.points - 1;
    if (newPoints === 0) {
        assignedTalents.delete(talentId);
    } else {
        assignedTalents.set(talentId, {
            points: newPoints,
            talentOrder: current.talentOrder,
            perkId: newPoints < talent.maxPoints ? null : current.perkId
        });
    }
    
    updateTalentCellDisplay(talentId);
    closeTalentUpgradeModal();
}

function handleTalentClick(talent) {
    // Legacy - now handled by showTalentUpgradeModal
    showTalentUpgradeModal(talent);
}

function handleTalentRightClick(talent) {
    if (isViewingPendingEnemy) return;
    
    const current = assignedTalents.get(talent.talentId);
    if (!current || current.points === 0) return;
    
    // Remove a point (remove from the end based on talent order)
    if (current.points > 0) {
        const newPoints = current.points - 1;
        if (newPoints === 0) {
            assignedTalents.delete(talent.talentId);
        } else {
            assignedTalents.set(talent.talentId, {
                points: newPoints,
                talentOrder: current.talentOrder, // Keep the order of the first point
                perkId: newPoints < talent.maxPoints ? null : current.perkId // Remove perk if below max
            });
        }
        
        updateTalentCellDisplay(talent.talentId);
    }
}

function updateTalentCellDisplay(talentId) {
    const cell = document.querySelector(`.talent-cell[data-talent-id="${talentId}"]`);
    if (!cell) return;
    
    const talent = allTalents.find(t => t.talentId === talentId);
    const current = assignedTalents.get(talentId) || { points: 0 };
    
    const pointsEl = cell.querySelector('.current-points');
    if (pointsEl) pointsEl.textContent = current.points;
    
    // Update visual state
    cell.classList.toggle('has-points', current.points > 0);
    cell.classList.toggle('maxed', current.points === talent?.maxPoints);
    
    // Update perk indicator
    if (current.perkId) {
        const perkIndicator = cell.querySelector('.perk-indicator');
        if (perkIndicator) perkIndicator.classList.add('assigned');
    }
}

function loadTalentsIntoTree(talents) {
    clearTalentTree();
    
    if (!talents || talents.length === 0) return;
    
    // Find max talent order to continue from
    let maxOrder = 0;
    
    talents.forEach(t => {
        assignedTalents.set(t.talentId, {
            points: t.maxPoints, // The stored max_points is the invested points
            talentOrder: t.talentOrder,
            perkId: t.perkId || null
        });
        
        if (t.talentOrder > maxOrder) maxOrder = t.talentOrder;
        
        updateTalentCellDisplay(t.talentId);
    });
    
    currentTalentOrder = maxOrder;
}

function clearTalentTree() {
    assignedTalents.clear();
    currentTalentOrder = 0;
    
    // Reset all cells
    allTalents.forEach(t => updateTalentCellDisplay(t.talentId));
}

function showPerkSelectionModal(talent) {
    // Create modal for perk selection
    const modal = document.createElement('div');
    modal.className = 'perk-selection-modal';
    modal.innerHTML = `
        <div class="perk-selection-content">
            <h3>Select Perk for ${escapeHtml(talent.talentName)}</h3>
            <select id="perkSelect">
                <option value="">-- No Perk --</option>
                ${enemyPerks.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}
            </select>
            <div class="perk-selection-buttons">
                <button type="button" class="btn-confirm" onclick="confirmPerkSelection(${talent.talentId})">Confirm</button>
                <button type="button" class="btn-cancel" onclick="closePerkModal()">Cancel</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

function confirmPerkSelection(talentId) {
    const select = document.getElementById('perkSelect');
    const perkId = select?.value ? parseInt(select.value) : null;
    
    const current = assignedTalents.get(talentId);
    if (current) {
        assignedTalents.set(talentId, { ...current, perkId });
        updateTalentCellDisplay(talentId);
    }
    
    closePerkModal();
}

function closePerkModal() {
    const modal = document.querySelector('.perk-selection-modal');
    if (modal) modal.remove();
}

// ==================== SAVE ====================

async function saveEnemy(e) {
    e.preventDefault();
    
    const name = document.getElementById('enemyName').value.trim();
    if (!name) {
        alert('Enemy name is required');
        return;
    }
    
    if (!enemySelectedAssetId) {
        alert('Please select an icon for the enemy');
        return;
    }
    
    // Build talents array
    const talents = [];
    assignedTalents.forEach((data, talentId) => {
        if (data.points > 0) {
            talents.push({
                talentId: talentId,
                talentOrder: data.talentOrder,
                perkId: data.perkId
            });
        }
    });
    
    const enemyData = {
        gameId: (!isViewingPendingEnemy && selectedEnemyId) ? selectedEnemyId : null,
        enemyName: name,
        strength: parseInt(document.getElementById('enemyStrength').value) || 0,
        stamina: parseInt(document.getElementById('enemyStamina').value) || 0,
        agility: parseInt(document.getElementById('enemyAgility').value) || 0,
        luck: parseInt(document.getElementById('enemyLuck').value) || 0,
        armor: parseInt(document.getElementById('enemyArmor').value) || 0,
        minDamage: parseInt(document.getElementById('enemyMinDamage').value) || 0,
        maxDamage: parseInt(document.getElementById('enemyMaxDamage').value) || 0,
        assetId: enemySelectedAssetId,
        description: document.getElementById('enemyDescription').value || null,
        talents: talents
    };
    
    console.log('Saving enemy:', enemyData);
    
    try {
        const token = await getCurrentAccessToken();
        const response = await fetch('http://localhost:8080/api/createEnemy', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(enemyData)
        });
        
        const result = await response.json();
        
        if (result.success) {
            console.log('✅ Enemy saved, tooling_id:', result.toolingId);
            alert('Enemy saved to pending! It needs approval before merging.');
            
            // Determine the asset icon URL for the pending enemy
            let assetIcon = enemySelectedAssetIcon || null;
            if (!assetIcon && enemySelectedAssetId) {
                const asset = enemyAssets.find(a => a.assetID === enemySelectedAssetId || a.id === enemySelectedAssetId);
                assetIcon = asset ? (asset.icon || asset.url) : null;
            }

            // Build a local pending object instead of full reload
            const pendingEnemy = {
                toolingId: result.toolingId,
                gameId: enemyData.gameId,
                enemyName: enemyData.enemyName,
                strength: enemyData.strength,
                stamina: enemyData.stamina,
                agility: enemyData.agility,
                luck: enemyData.luck,
                armor: enemyData.armor,
                minDamage: enemyData.minDamage,
                maxDamage: enemyData.maxDamage,
                assetId: enemyData.assetId,
                icon: assetIcon,
                description: enemyData.description,
                talents: enemyData.talents,
                action: enemyData.gameId ? 'update' : 'insert',
                approved: false
            };

            // If editing an existing pending enemy, replace it; otherwise push new
            const existingIdx = allPendingEnemies.findIndex(e => e.toolingId === result.toolingId);
            if (existingIdx !== -1) {
                allPendingEnemies[existingIdx] = pendingEnemy;
            } else {
                allPendingEnemies.push(pendingEnemy);
            }
            filteredPendingEnemies = [...allPendingEnemies];
            // Keep GlobalData in sync
            setGlobalArray('pendingEnemies', allPendingEnemies);
            
            renderPendingEnemyList();
            switchEnemyTab('pending');
        } else {
            alert('Error saving enemy: ' + (result.message || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error saving enemy:', error);
        alert('Error saving enemy: ' + error.message);
    }
}

// ==================== APPROVAL/MERGE ====================

async function toggleEnemyApproval(toolingId, approved) {
    try {
        const token = await getCurrentAccessToken();
        const response = await fetch('http://localhost:8080/api/toggleApproveEnemy', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ toolingId })
        });
        
        const result = await response.json();
        
        if (result.success) {
            const enemy = allPendingEnemies.find(e => e.toolingId === toolingId);
            if (enemy) enemy.approved = !enemy.approved;
        } else {
            alert('Error: ' + result.message);
        }
    } catch (error) {
        console.error('Error toggling approval:', error);
    }
}

async function mergeApprovedEnemies() {
    const approvedCount = allPendingEnemies.filter(e => e.approved).length;
    
    if (approvedCount === 0) {
        alert('No approved enemies to merge');
        return;
    }
    
    if (!confirm(`Merge ${approvedCount} approved enemy(ies)?`)) return;
    
    try {
        const token = await getCurrentAccessToken();
        const response = await fetch('http://localhost:8080/api/mergeEnemies', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert('Enemies merged successfully!');
            await loadEnemyDesignerData({ forceReload: true });
        } else {
            alert('Error: ' + result.message);
        }
    } catch (error) {
        console.error('Error merging:', error);
    }
}

async function removePendingEnemy(toolingId) {
    const enemy = allPendingEnemies.find(e => e.toolingId === toolingId);
    if (!confirm(`Remove pending enemy "${enemy?.enemyName || toolingId}"?`)) return;
    
    try {
        const token = await getCurrentAccessToken();
        const response = await fetch('http://localhost:8080/api/removePendingEnemy', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ toolingId })
        });
        
        const result = await response.json();
        
        if (result.success) {
            allPendingEnemies = allPendingEnemies.filter(e => e.toolingId !== toolingId);
            filteredPendingEnemies = filteredPendingEnemies.filter(e => e.toolingId !== toolingId);
            setGlobalArray('pendingEnemies', allPendingEnemies);
            
            if (selectedEnemyId === toolingId && isViewingPendingEnemy) {
                createNewEnemy();
            }
            
            renderPendingEnemyList();
        } else {
            alert('Error: ' + result.message);
        }
    } catch (error) {
        console.error('Error removing:', error);
    }
}

// ==================== ASSET GALLERY ====================

function toggleEnemyAssetGallery() {
    const overlay = document.getElementById('enemyAssetGalleryOverlay');
    if (overlay) {
        overlay.style.display = overlay.style.display === 'flex' ? 'none' : 'flex';
    }
}

function createEnemyAssetGallery() {
    const grid = document.getElementById('enemyAssetGrid');
    if (!grid) return;
    
    grid.innerHTML = enemyAssets.map(asset => `
        <div class="asset-item ${asset.assetID === enemySelectedAssetId ? 'selected' : ''}"
             onclick="selectEnemyAsset(${asset.assetID}, '${asset.icon}')">
            <img src="${asset.icon}" alt="${asset.name}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2264%22 height=%2264%22><rect fill=%22%23333%22 width=%2264%22 height=%2264%22/></svg>'"/>
            <span>${asset.name || asset.assetID}</span>
        </div>
    `).join('');
}

function selectEnemyAsset(assetId, iconUrl) {
    enemySelectedAssetId = assetId;
    enemySelectedAssetIcon = iconUrl;
    
    const preview = document.getElementById('enemyIconPreview');
    if (preview) {
        preview.innerHTML = `<img src="${iconUrl}" alt="Selected icon" />`;
    }
    
    createEnemyAssetGallery();
    toggleEnemyAssetGallery();
}

async function handleEnemyIconUpload(file) {
    if (!file.type.startsWith('image/')) {
        alert('Please select an image file');
        return;
    }
    
    try {
        // Use global functions from global-data.js
        const webpBlob = await convertImageToWebP(file, 256, 256, 0.85);
        const base64 = await blobToBase64(webpBlob);
        
        // Calculate next asset ID
        const currentAssets = getEnemyAssets();
        const maxId = currentAssets.reduce((max, a) => Math.max(max, a.assetID || 0), 0);
        const newAssetId = maxId + 1;
        
        const token = await getCurrentAccessToken();
        const response = await fetch('http://localhost:8080/api/uploadEnemyAsset', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                assetID: newAssetId,
                imageData: base64,
                contentType: 'image/webp'
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            console.log('✅ Asset uploaded:', result.assetID);
            
            // Push locally instead of full reload
            const newAsset = {
                assetID: result.assetID,
                id: result.assetID,
                name: String(result.assetID),
                icon: result.icon || base64,
                url: result.icon || base64,
                remoteUrl: result.icon || base64
            };
            enemyAssets.push(newAsset);
            GlobalData.enemyAssets.push(newAsset);
            
            selectEnemyAsset(result.assetID, result.icon || base64);
            createEnemyAssetGallery();
        } else {
            alert('Upload failed: ' + result.message);
        }
    } catch (error) {
        console.error('Error uploading:', error);
        alert('Error uploading: ' + error.message);
    }
}

// ==================== UTILITIES ====================

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
