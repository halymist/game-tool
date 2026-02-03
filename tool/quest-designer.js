// Quest Designer - Visual Quest & Option Network Editor
console.log('📦 quest-designer.js LOADED');

// ==================== STATE ====================
const questState = {
    // Quests (slides with asset, name, text, sortOrder for tree depth)
    quests: new Map(),       // questId -> { questId, name, text, assetId, assetUrl, x, y, sortOrder }
    nextQuestId: 1,
    selectedQuest: null,
    
    // Options (nodes with option text, node text, type, type-specific data)
    // Type can be: dialogue, stat_check, effect_check, combat, end
    options: new Map(),      // optionId -> { optionId, optionText, nodeText, x, y, isStart, type, statType, statRequired, effectId, effectAmount, enemyId, reward }
    nextOptionId: 1,
    selectedOption: null,
    
    // Connections: option -> quest (option leads to quest) or option -> option
    // NO quest -> quest connections allowed
    connections: [],         // { fromType: 'option'|'quest', fromId, toType: 'option'|'quest', toId }
    
    // Canvas state
    canvasOffset: { x: 0, y: 0 },
    zoom: 1,
    isDragging: false,
    lastMouse: { x: 0, y: 0 },
    
    // Connection dragging
    isConnecting: false,
    connectionStart: null,   // { type: 'option'|'quest', id, side: 'left'|'right' }
    
    // Settlement/Chain management
    chains: new Map(),
    selectedChain: null,
    chainName: '',
    selectedSettlementId: null,
    
    // Quest assets
    questAssets: [],
    editingQuestAsset: null,
    
    // Server tracking
    serverQuests: new Map(),
    serverOptions: new Map(),
    
    // Global data cache (loaded once)
    effects: [],
    enemies: [],
    items: [],
    perks: [],
    potions: [],
};

// ==================== INITIALIZATION ====================
function initQuestDesigner() {
    console.log('🗡️ initQuestDesigner called');
    
    const canvas = document.getElementById('questCanvas');
    if (!canvas) {
        console.error('❌ questCanvas not found');
        return;
    }
    
    // Canvas pan events
    canvas.addEventListener('mousedown', onCanvasMouseDown);
    canvas.addEventListener('mousemove', onCanvasMouseMove);
    canvas.addEventListener('mouseup', onCanvasMouseUp);
    canvas.addEventListener('mouseleave', onCanvasMouseUp);
    
    // Prevent context menu on middle click
    canvas.addEventListener('auxclick', (e) => {
        if (e.button === 1) e.preventDefault();
    });
    canvas.addEventListener('contextmenu', (e) => {
        if (questState.isDragging) e.preventDefault();
    });
    
    // Zoom with mouse wheel
    document.addEventListener('wheel', function(e) {
        const canvas = document.getElementById('questCanvas');
        if (!canvas) return;
        
        const canvasRect = canvas.getBoundingClientRect();
        const isOverCanvas = e.clientX >= canvasRect.left && e.clientX <= canvasRect.right &&
                            e.clientY >= canvasRect.top && e.clientY <= canvasRect.bottom;
        
        if (isOverCanvas) {
            e.preventDefault();
            e.stopPropagation();
            onCanvasWheel(e);
        }
    }, { passive: false, capture: true });
    
    // Button events - ONLY addOption uses event listener
    // addQuestBtn uses onclick in HTML to avoid double-firing
    document.getElementById('addOptionBtn')?.addEventListener('click', addOption);
    
    // Sidebar event listeners
    setupSidebarEventListeners();
    
    updateCounter();
    console.log('✅ Quest Designer ready');
    
    // Load data
    loadQuestSettlements();
    loadQuestAssets();
    loadQuestGlobalData();
}
window.initQuestDesigner = initQuestDesigner;

// ==================== ADD QUEST SLIDE ====================
function addQuest() {
    console.log('➕ Adding quest slide');
    
    const canvas = document.getElementById('questCanvas');
    const container = document.getElementById('questOptionsContainer');
    if (!canvas || !container) return;
    
    const rect = canvas.getBoundingClientRect();
    const id = questState.nextQuestId++;
    
    const quest = {
        questId: id,
        name: `Quest ${id}`,
        text: '',
        assetId: null,
        assetUrl: null,
        sortOrder: questState.quests.size, // Tree depth indicator
        x: (rect.width / 2 - questState.canvasOffset.x) / questState.zoom - 150 + (Math.random() - 0.5) * 100,
        y: (rect.height / 2 - questState.canvasOffset.y) / questState.zoom - 200 + (Math.random() - 0.5) * 100,
    };
    
    questState.quests.set(id, quest);
    renderQuest(quest);
    updateCounter();
    
    console.log(`✅ Quest #${id} created`);
}
window.addQuestSlide = addQuest;

// ==================== ADD OPTION NODE ====================
function addOption() {
    console.log('➕ Adding option node');
    
    const canvas = document.getElementById('questCanvas');
    const container = document.getElementById('questOptionsContainer');
    if (!canvas || !container) return;
    
    const rect = canvas.getBoundingClientRect();
    const id = questState.nextOptionId++;
    
    const option = {
        optionId: id,
        optionText: 'New Option',
        nodeText: '',
        x: (rect.width / 2 - questState.canvasOffset.x) / questState.zoom - 100 + (Math.random() - 0.5) * 100,
        y: (rect.height / 2 - questState.canvasOffset.y) / questState.zoom - 50 + (Math.random() - 0.5) * 100,
        isStart: questState.options.size === 0,
        // Option type: dialogue, stat_check, effect_check, combat, end
        type: 'dialogue',
        // Stat check fields
        statType: null,
        statRequired: null,
        // Effect check fields
        effectId: null,
        effectAmount: null,
        // Combat field
        enemyId: null,
        // Reward - same structure as expedition
        reward: null, // { type: 'stat'|'talent'|'item'|'potion'|'perk'|'blessing', statType, amount, itemId, perkId, potionId, blessingId }
    };
    
    questState.options.set(id, option);
    renderOption(option);
    updateCounter();
    
    console.log(`✅ Option #${id} created`);
}

// ==================== RENDER QUEST SLIDE ====================
function renderQuest(quest) {
    const container = document.getElementById('questOptionsContainer');
    if (!container) return;
    
    // Remove if exists
    document.getElementById(`quest-${quest.questId}`)?.remove();
    
    const el = document.createElement('div');
    el.id = `quest-${quest.questId}`;
    el.className = `quest-slide${questState.selectedQuest === quest.questId ? ' selected' : ''}`;
    el.style.left = `${quest.x}px`;
    el.style.top = `${quest.y}px`;
    
    // Background style
    const bodyStyle = quest.assetUrl ? `style="background-image: url(${quest.assetUrl});"` : '';
    const bodyClass = quest.assetUrl ? 'quest-slide-body has-bg' : 'quest-slide-body';
    
    el.innerHTML = `
        <div class="quest-slide-header">
            <input type="number" class="quest-sort-input" value="${quest.sortOrder || 0}" 
                   data-quest="${quest.questId}" min="0" title="Sort order (tree depth)">
            <input type="text" class="quest-name-input" value="${escapeHtml(quest.name)}" 
                   data-quest="${quest.questId}" placeholder="Quest name...">
            <button class="quest-bg-btn" data-quest="${quest.questId}" title="Set background">🖼️</button>
            <button class="quest-delete-btn" data-quest="${quest.questId}" title="Delete quest">🗑️</button>
        </div>
        <div class="quest-connector quest-connector-left" data-quest="${quest.questId}" data-side="left" title="Drag to connect">●</div>
        <div class="quest-connector quest-connector-right" data-quest="${quest.questId}" data-side="right" title="Drag to connect">●</div>
        <div class="${bodyClass}" ${bodyStyle}>
            <textarea class="quest-text-input" data-quest="${quest.questId}" placeholder="Enter quest text...">${escapeHtml(quest.text)}</textarea>
        </div>
    `;
    
    bindQuestEvents(el, quest);
    container.appendChild(el);
}

function bindQuestEvents(el, quest) {
    // Name editing
    const nameInput = el.querySelector('.quest-name-input');
    nameInput?.addEventListener('input', (e) => {
        quest.name = e.target.value;
    });
    nameInput?.addEventListener('mousedown', (e) => e.stopPropagation());
    
    // Sort order editing
    const sortInput = el.querySelector('.quest-sort-input');
    sortInput?.addEventListener('input', (e) => {
        quest.sortOrder = parseInt(e.target.value) || 0;
    });
    sortInput?.addEventListener('mousedown', (e) => e.stopPropagation());
    
    // Text editing
    const textArea = el.querySelector('.quest-text-input');
    textArea?.addEventListener('input', (e) => {
        quest.text = e.target.value;
    });
    textArea?.addEventListener('mousedown', (e) => e.stopPropagation());
    
    // Delete quest
    el.querySelector('.quest-delete-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteQuest(quest.questId);
    });
    
    // Background button
    el.querySelector('.quest-bg-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        openQuestAssetPicker(quest.questId);
    });
    
    // Connectors - start drag connection
    el.querySelectorAll('.quest-connector').forEach(conn => {
        conn.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const side = conn.dataset.side;
            startConnection('quest', quest.questId, side, e);
        });
    });
    
    // Drag quest
    el.addEventListener('mousedown', (e) => {
        if (e.target.closest('input, textarea, button, .quest-connector')) return;
        if (e.button !== 0) return;
        e.stopPropagation();
        
        selectQuest(quest.questId);
        startDragElement(el, quest, e);
    });
}

// ==================== RENDER OPTION NODE ====================
function renderOption(option) {
    const container = document.getElementById('questOptionsContainer');
    if (!container) return;
    
    // Remove if exists
    document.getElementById(`option-${option.optionId}`)?.remove();
    
    const el = document.createElement('div');
    el.id = `option-${option.optionId}`;
    el.className = `option-node${option.isStart ? ' start-option' : ''}${questState.selectedOption === option.optionId ? ' selected' : ''}`;
    el.style.left = `${option.x}px`;
    el.style.top = `${option.y}px`;
    
    el.innerHTML = `
        <div class="option-node-header">
            <span class="option-id">#${option.optionId}</span>
            <label class="start-checkbox" title="Start option">
                <input type="checkbox" ${option.isStart ? 'checked' : ''} data-option="${option.optionId}">
                <span>START</span>
            </label>
            <button class="option-delete-btn" data-option="${option.optionId}" title="Delete option">×</button>
        </div>
        <div class="option-connector option-connector-left" data-option="${option.optionId}" data-side="left" title="Drag to connect">●</div>
        <div class="option-connector option-connector-right" data-option="${option.optionId}" data-side="right" title="Drag to connect">●</div>
        <div class="option-node-body">
            <input type="text" class="option-text-input" value="${escapeHtml(option.optionText)}" 
                   data-option="${option.optionId}" placeholder="Option text...">
            <textarea class="option-node-text-input" data-option="${option.optionId}" 
                      placeholder="Node description...">${escapeHtml(option.nodeText || '')}</textarea>
        </div>
    `;
    
    bindOptionEvents(el, option);
    container.appendChild(el);
}

function bindOptionEvents(el, option) {
    // Option text editing
    const textInput = el.querySelector('.option-text-input');
    textInput?.addEventListener('input', (e) => {
        option.optionText = e.target.value;
    });
    textInput?.addEventListener('mousedown', (e) => e.stopPropagation());
    
    // Node text editing
    const nodeTextArea = el.querySelector('.option-node-text-input');
    nodeTextArea?.addEventListener('input', (e) => {
        option.nodeText = e.target.value;
    });
    nodeTextArea?.addEventListener('mousedown', (e) => e.stopPropagation());
    
    // Start checkbox
    const startCb = el.querySelector('.start-checkbox input');
    startCb?.addEventListener('change', (e) => {
        e.stopPropagation();
        option.isStart = e.target.checked;
        el.classList.toggle('start-option', option.isStart);
    });
    
    // Delete option
    el.querySelector('.option-delete-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteOption(option.optionId);
    });
    
    // Connectors - start drag connection
    el.querySelectorAll('.option-connector').forEach(conn => {
        conn.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const side = conn.dataset.side;
            startConnection('option', option.optionId, side, e);
        });
    });
    
    // Drag option
    el.addEventListener('mousedown', (e) => {
        if (e.target.closest('input, textarea, button, .option-connector, .start-checkbox')) return;
        if (e.button !== 0) return;
        e.stopPropagation();
        
        selectOption(option.optionId);
        startDragElement(el, option, e);
    });
}

// ==================== ELEMENT DRAGGING ====================
function startDragElement(el, data, e) {
    const startMouseX = e.clientX;
    const startMouseY = e.clientY;
    const startX = data.x;
    const startY = data.y;
    
    const onMove = (ev) => {
        if (questState.isConnecting) return;
        el.classList.add('dragging');
        const deltaX = (ev.clientX - startMouseX) / questState.zoom;
        const deltaY = (ev.clientY - startMouseY) / questState.zoom;
        data.x = startX + deltaX;
        data.y = startY + deltaY;
        el.style.left = `${data.x}px`;
        el.style.top = `${data.y}px`;
        renderConnections();
    };
    
    const onUp = () => {
        el.classList.remove('dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
    };
    
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
}

// ==================== CONNECTION SYSTEM ====================
function startConnection(type, id, side, e) {
    console.log('Starting connection from', type, id, 'side', side);
    questState.isConnecting = true;
    questState.connectionStart = { type, id, side };
    
    document.body.style.cursor = 'crosshair';
    const canvas = document.getElementById('questCanvas');
    if (canvas) canvas.classList.add('connecting');
    
    // Highlight all potential targets - but NOT quest slides if source is a quest (no quest-to-quest)
    document.querySelectorAll('.quest-slide, .option-node').forEach(el => {
        const elId = el.id;
        const isSource = (type === 'quest' && elId === `quest-${id}`) || 
                        (type === 'option' && elId === `option-${id}`);
        // Don't allow quest -> quest connections
        const isQuestElement = elId.startsWith('quest-');
        const shouldHighlight = !isSource && !(type === 'quest' && isQuestElement);
        
        if (shouldHighlight) {
            el.classList.add('connection-target');
        }
    });
    
    const onMouseMove = (ev) => {
        updateConnectionPreview(ev);
    };
    
    const onMouseUp = (ev) => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        
        // Check if we dropped on a target
        const target = document.elementFromPoint(ev.clientX, ev.clientY);
        const questEl = target?.closest('.quest-slide');
        const optionEl = target?.closest('.option-node');
        
        if (questEl && questState.connectionStart) {
            const toId = parseInt(questEl.id.replace('quest-', ''));
            // Disallow quest -> quest connections
            if (questState.connectionStart.type === 'quest') {
                console.log('Quest-to-quest connections not allowed');
            } else if (!(questState.connectionStart.type === 'option' && questState.connectionStart.id === toId)) {
                addConnection(questState.connectionStart.type, questState.connectionStart.id, 'quest', toId);
            }
        } else if (optionEl && questState.connectionStart) {
            const toId = parseInt(optionEl.id.replace('option-', ''));
            if (!(questState.connectionStart.type === 'option' && questState.connectionStart.id === toId)) {
                addConnection(questState.connectionStart.type, questState.connectionStart.id, 'option', toId);
            }
        }
        
        cancelConnection();
        renderConnections();
    };
    
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    
    updateConnectionPreview(e);
}

function addConnection(fromType, fromId, toType, toId) {
    // Check if connection already exists
    const exists = questState.connections.some(c => 
        c.fromType === fromType && c.fromId === fromId && 
        c.toType === toType && c.toId === toId
    );
    
    if (!exists) {
        questState.connections.push({ fromType, fromId, toType, toId });
        console.log('Connection added:', fromType, fromId, '->', toType, toId);
    }
}

function cancelConnection() {
    questState.isConnecting = false;
    questState.connectionStart = null;
    document.body.style.cursor = 'default';
    
    const canvas = document.getElementById('questCanvas');
    if (canvas) canvas.classList.remove('connecting');
    
    document.getElementById('questConnectionPreview')?.setAttribute('style', 'display:none');
    
    document.querySelectorAll('.connection-target').forEach(el => {
        el.classList.remove('connection-target');
    });
}

function updateConnectionPreview(e) {
    const preview = document.getElementById('questConnectionPreview');
    const canvas = document.getElementById('questCanvas');
    if (!preview || !canvas || !questState.connectionStart) return;
    
    const rect = canvas.getBoundingClientRect();
    const { type, id, side } = questState.connectionStart;
    
    // Find the connector element
    const selector = type === 'quest' 
        ? `#quest-${id} .quest-connector-${side}`
        : `#option-${id} .option-connector-${side}`;
    const fromEl = document.querySelector(selector);
    if (!fromEl) return;
    
    const fromRect = fromEl.getBoundingClientRect();
    const x1 = fromRect.left + fromRect.width/2 - rect.left;
    const y1 = fromRect.top + fromRect.height/2 - rect.top;
    const x2 = e.clientX - rect.left;
    const y2 = e.clientY - rect.top;
    
    // Bezier curve
    const curveX = side === 'right' ? x1 + 60 : x1 - 60;
    preview.setAttribute('d', `M ${x1} ${y1} Q ${curveX} ${y1}, ${x2} ${y2}`);
    preview.style.display = 'block';
}

function renderConnections() {
    const svg = document.getElementById('questConnectionsSvg');
    const canvas = document.getElementById('questCanvas');
    if (!svg || !canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    
    // Remove old paths except preview
    svg.querySelectorAll('path:not(#questConnectionPreview)').forEach(p => p.remove());
    
    questState.connections.forEach((conn, idx) => {
        const { fromType, fromId, toType, toId } = conn;
        
        // Get connector positions
        // From: use right connector by default, To: use left connector
        const fromSelector = fromType === 'quest' 
            ? `#quest-${fromId} .quest-connector-right`
            : `#option-${fromId} .option-connector-right`;
        const toSelector = toType === 'quest'
            ? `#quest-${toId} .quest-connector-left`
            : `#option-${toId} .option-connector-left`;
        
        const fromEl = document.querySelector(fromSelector);
        const toEl = document.querySelector(toSelector);
        
        if (!fromEl || !toEl) return;
        
        const fromRect = fromEl.getBoundingClientRect();
        const toRect = toEl.getBoundingClientRect();
        
        const x1 = fromRect.left + fromRect.width/2 - rect.left;
        const y1 = fromRect.top + fromRect.height/2 - rect.top;
        const x2 = toRect.left + toRect.width/2 - rect.left;
        const y2 = toRect.top + toRect.height/2 - rect.top;
        
        // Determine control points for smooth curve
        const dx = Math.abs(x2 - x1);
        const ctrlOffset = Math.max(50, dx * 0.4);
        
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', `M ${x1} ${y1} C ${x1 + ctrlOffset} ${y1}, ${x2 - ctrlOffset} ${y2}, ${x2} ${y2}`);
        
        // Different colors for different connection types
        let strokeColor = '#e94560'; // option -> option (red)
        if (fromType === 'option' && toType === 'quest') {
            strokeColor = '#4ecdc4'; // option -> quest (cyan)
        } else if (fromType === 'quest' && toType === 'option') {
            strokeColor = '#f59e0b'; // quest -> option (orange)
        }
        // quest -> quest is no longer allowed
        
        path.setAttribute('class', 'quest-connection-line');
        path.setAttribute('stroke', strokeColor);
        path.dataset.connectionIndex = idx;
        
        // Click to delete connection
        path.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm('Delete this connection?')) {
                questState.connections.splice(idx, 1);
                renderConnections();
            }
        });
        
        svg.insertBefore(path, svg.firstChild);
    });
}

// ==================== DELETE FUNCTIONS ====================
function deleteQuest(id) {
    if (!confirm('Delete this quest?')) return;
    
    // Remove connections involving this quest
    questState.connections = questState.connections.filter(c => 
        !(c.fromType === 'quest' && c.fromId === id) && 
        !(c.toType === 'quest' && c.toId === id)
    );
    
    document.getElementById(`quest-${id}`)?.remove();
    questState.quests.delete(id);
    questState.selectedQuest = null;
    
    renderConnections();
    updateCounter();
}

function deleteOption(id) {
    if (!confirm('Delete this option?')) return;
    
    // Remove connections involving this option
    questState.connections = questState.connections.filter(c => 
        !(c.fromType === 'option' && c.fromId === id) && 
        !(c.toType === 'option' && c.toId === id)
    );
    
    document.getElementById(`option-${id}`)?.remove();
    questState.options.delete(id);
    questState.selectedOption = null;
    
    renderConnections();
    updateCounter();
}

// ==================== SELECTION ====================
function selectQuest(id) {
    questState.selectedQuest = id;
    questState.selectedOption = null;
    document.querySelectorAll('.quest-slide').forEach(el => {
        el.classList.toggle('selected', el.id === `quest-${id}`);
    });
    document.querySelectorAll('.option-node').forEach(el => {
        el.classList.remove('selected');
    });
}

function selectOption(id) {
    questState.selectedOption = id;
    questState.selectedQuest = null;
    document.querySelectorAll('.option-node').forEach(el => {
        el.classList.toggle('selected', el.id === `option-${id}`);
    });
    document.querySelectorAll('.quest-slide').forEach(el => {
        el.classList.remove('selected');
    });
    
    // Update sidebar
    updateSidebar(id);
}

function updateSidebar(optionId) {
    const option = questState.options.get(optionId);
    const noSelection = document.getElementById('sidebarNoSelection');
    const content = document.getElementById('sidebarContent');
    
    if (!option) {
        if (noSelection) noSelection.style.display = 'flex';
        if (content) content.style.display = 'none';
        return;
    }
    
    if (noSelection) noSelection.style.display = 'none';
    if (content) content.style.display = 'block';
    
    // Basic info
    const idSpan = document.getElementById('sidebarOptionId');
    if (idSpan) idSpan.textContent = `Option ID: ${optionId}`;
    
    const isStartCheckbox = document.getElementById('sidebarIsStart');
    if (isStartCheckbox) isStartCheckbox.checked = option.isStart;
    
    // Option type
    const typeSelect = document.getElementById('sidebarOptionType');
    if (typeSelect) typeSelect.value = option.type || 'dialogue';
    
    // Show/hide type-specific fields
    updateSidebarTypeFields(option.type || 'dialogue');
    
    // Populate stat check fields
    const statTypeSelect = document.getElementById('sidebarStatType');
    if (statTypeSelect) statTypeSelect.value = option.statType || '';
    
    const statRequired = document.getElementById('sidebarStatRequired');
    if (statRequired) statRequired.value = option.statRequired || '';
    
    // Populate effect check fields
    const effectIdSelect = document.getElementById('sidebarEffectId');
    if (effectIdSelect) effectIdSelect.value = option.effectId || '';
    
    const effectAmount = document.getElementById('sidebarEffectAmount');
    if (effectAmount) effectAmount.value = option.effectAmount || '';
    
    // Populate combat enemy
    const enemyIdInput = document.getElementById('sidebarEnemyId');
    if (enemyIdInput) enemyIdInput.value = option.enemyId || '';
    selectEnemyInGrid(option.enemyId);
    
    // Populate rewards
    const reward = option.reward || {};
    const rewardTypeSelect = document.getElementById('sidebarRewardType');
    if (rewardTypeSelect) rewardTypeSelect.value = reward.type || '';
    
    updateSidebarRewardFields(reward.type || '');
    
    // Populate reward-specific fields
    const rewardStatType = document.getElementById('sidebarRewardStatType');
    if (rewardStatType) rewardStatType.value = reward.statType || '';
    
    const rewardStatAmount = document.getElementById('sidebarRewardStatAmount');
    if (rewardStatAmount) rewardStatAmount.value = reward.amount || '';
    
    const rewardItem = document.getElementById('sidebarRewardItem');
    if (rewardItem) rewardItem.value = reward.itemId || '';
    
    const rewardPotion = document.getElementById('sidebarRewardPotion');
    if (rewardPotion) rewardPotion.value = reward.potionId || '';
    
    const rewardPerk = document.getElementById('sidebarRewardPerk');
    if (rewardPerk) rewardPerk.value = reward.perkId || '';
    
    const rewardBlessing = document.getElementById('sidebarRewardBlessing');
    if (rewardBlessing) rewardBlessing.value = reward.blessingId || '';
}

function updateSidebarTypeFields(type) {
    // Hide all type-specific sections
    document.getElementById('optionTypeStatCheck')?.style && (document.getElementById('optionTypeStatCheck').style.display = 'none');
    document.getElementById('optionTypeEffectCheck')?.style && (document.getElementById('optionTypeEffectCheck').style.display = 'none');
    document.getElementById('optionTypeCombat')?.style && (document.getElementById('optionTypeCombat').style.display = 'none');
    
    // Show relevant section
    switch (type) {
        case 'stat_check':
            const statSection = document.getElementById('optionTypeStatCheck');
            if (statSection) statSection.style.display = 'block';
            break;
        case 'effect_check':
            const effectSection = document.getElementById('optionTypeEffectCheck');
            if (effectSection) effectSection.style.display = 'block';
            break;
        case 'combat':
            const combatSection = document.getElementById('optionTypeCombat');
            if (combatSection) combatSection.style.display = 'block';
            populateEnemyGrid();
            break;
    }
}

function updateSidebarRewardFields(type) {
    // Hide all reward-specific sections
    document.getElementById('rewardTypeStat')?.style && (document.getElementById('rewardTypeStat').style.display = 'none');
    document.getElementById('rewardTypeItem')?.style && (document.getElementById('rewardTypeItem').style.display = 'none');
    document.getElementById('rewardTypePotion')?.style && (document.getElementById('rewardTypePotion').style.display = 'none');
    document.getElementById('rewardTypePerk')?.style && (document.getElementById('rewardTypePerk').style.display = 'none');
    document.getElementById('rewardTypeBlessing')?.style && (document.getElementById('rewardTypeBlessing').style.display = 'none');
    
    // Show relevant section
    switch (type) {
        case 'stat':
            const statSection = document.getElementById('rewardTypeStat');
            if (statSection) statSection.style.display = 'block';
            break;
        case 'item':
            const itemSection = document.getElementById('rewardTypeItem');
            if (itemSection) itemSection.style.display = 'block';
            break;
        case 'potion':
            const potionSection = document.getElementById('rewardTypePotion');
            if (potionSection) potionSection.style.display = 'block';
            break;
        case 'perk':
            const perkSection = document.getElementById('rewardTypePerk');
            if (perkSection) perkSection.style.display = 'block';
            break;
        case 'blessing':
            const blessingSection = document.getElementById('rewardTypeBlessing');
            if (blessingSection) blessingSection.style.display = 'block';
            break;
        // talent has no additional fields
    }
}

// ==================== CANVAS NAVIGATION ====================
function onCanvasMouseDown(e) {
    if (e.button === 1) {
        e.preventDefault();
        questState.isDragging = true;
        questState.lastMouse = { x: e.clientX, y: e.clientY };
        document.getElementById('questCanvas').style.cursor = 'grabbing';
        return;
    }
    
    if (e.button === 0) {
        const clickedElement = e.target.closest('.quest-slide, .option-node');
        const clickedInteractive = e.target.closest('button, input, textarea, select, .quest-connector, .option-connector');
        
        if (!clickedElement && !clickedInteractive) {
            questState.isDragging = true;
            questState.lastMouse = { x: e.clientX, y: e.clientY };
            document.getElementById('questCanvas').style.cursor = 'grabbing';
        }
    }
}

function onCanvasMouseMove(e) {
    if (questState.isDragging) {
        const dx = e.clientX - questState.lastMouse.x;
        const dy = e.clientY - questState.lastMouse.y;
        questState.canvasOffset.x += dx;
        questState.canvasOffset.y += dy;
        questState.lastMouse = { x: e.clientX, y: e.clientY };
        
        const container = document.getElementById('questOptionsContainer');
        if (container) {
            container.style.transform = `translate(${questState.canvasOffset.x}px, ${questState.canvasOffset.y}px) scale(${questState.zoom})`;
        }
        renderConnections();
    }
    
    if (questState.isConnecting) {
        updateConnectionPreview(e);
    }
}

function onCanvasMouseUp(e) {
    if (questState.isDragging) {
        questState.isDragging = false;
        document.getElementById('questCanvas').style.cursor = 'grab';
    }
    
    if (questState.isConnecting && !e.target.closest('.quest-slide, .option-node')) {
        cancelConnection();
    }
}

function onCanvasWheel(e) {
    const container = document.getElementById('questOptionsContainer');
    if (!container) return;
    
    const zoomSpeed = 0.05;
    const delta = e.deltaY > 0 ? -zoomSpeed : zoomSpeed;
    const newZoom = Math.max(0.1, Math.min(2, questState.zoom + delta));
    
    questState.zoom = newZoom;
    container.style.transform = `translate(${questState.canvasOffset.x}px, ${questState.canvasOffset.y}px) scale(${questState.zoom})`;
    
    const indicator = document.getElementById('questZoomIndicator');
    if (indicator) indicator.textContent = `${Math.round(questState.zoom * 100)}%`;
    
    renderConnections();
}

function changeQuestZoom(delta) {
    const newZoom = Math.max(0.1, Math.min(2, questState.zoom + delta));
    questState.zoom = newZoom;
    
    const container = document.getElementById('questOptionsContainer');
    if (container) {
        container.style.transform = `translate(${questState.canvasOffset.x}px, ${questState.canvasOffset.y}px) scale(${questState.zoom})`;
    }
    
    const indicator = document.getElementById('questZoomIndicator');
    if (indicator) indicator.textContent = `${Math.round(questState.zoom * 100)}%`;
    
    renderConnections();
}
window.changeQuestZoom = changeQuestZoom;

function panQuestCanvas(dx, dy) {
    questState.canvasOffset.x += dx;
    questState.canvasOffset.y += dy;
    
    const container = document.getElementById('questOptionsContainer');
    if (container) {
        container.style.transform = `translate(${questState.canvasOffset.x}px, ${questState.canvasOffset.y}px) scale(${questState.zoom})`;
    }
    
    renderConnections();
}
window.panQuestCanvas = panQuestCanvas;

function resetQuestView() {
    questState.canvasOffset = { x: 0, y: 0 };
    questState.zoom = 1;
    
    const container = document.getElementById('questOptionsContainer');
    if (container) container.style.transform = 'translate(0, 0) scale(1)';
    
    const indicator = document.getElementById('questZoomIndicator');
    if (indicator) indicator.textContent = '100%';
    
    renderConnections();
}
window.resetQuestView = resetQuestView;

// ==================== QUEST ASSET PICKER ====================
function openQuestAssetPicker(questId) {
    console.log('Opening asset picker for quest', questId);
    questState.editingQuestAsset = questId;
    
    const modal = document.getElementById('questAssetModal');
    if (modal) {
        populateQuestAssetGallery();
        modal.classList.add('open');
    }
}

function closeQuestAssetModal() {
    const modal = document.getElementById('questAssetModal');
    if (modal) modal.classList.remove('open');
    questState.editingQuestAsset = null;
}
window.closeQuestAssetModal = closeQuestAssetModal;

function populateQuestAssetGallery() {
    const gallery = document.getElementById('questAssetGallery');
    if (!gallery) return;
    
    gallery.innerHTML = '';
    
    if (questState.questAssets.length === 0) {
        gallery.innerHTML = '<p style="color:#888;text-align:center;padding:20px;">No assets yet</p>';
        return;
    }
    
    questState.questAssets.forEach(asset => {
        const div = document.createElement('div');
        div.className = 'quest-asset-item';
        div.innerHTML = `<img src="${asset.url}" alt="Asset">`;
        div.addEventListener('click', () => {
            selectQuestAsset(asset.id, asset.url);
        });
        gallery.appendChild(div);
    });
}

function selectQuestAsset(assetId, assetUrl) {
    if (!questState.editingQuestAsset) return;
    
    const quest = questState.quests.get(questState.editingQuestAsset);
    if (quest) {
        quest.assetId = assetId;
        quest.assetUrl = assetUrl;
        renderQuest(quest);
    }
    
    closeQuestAssetModal();
}

// ==================== DATA LOADING ====================
async function loadQuestSettlements() {
    console.log('Loading settlements from GlobalData...');
    
    // Use global settlements data (same as expedition)
    const populateDropdown = () => {
        const settlements = typeof getSettlements === 'function' ? getSettlements() : 
                           (typeof GlobalData !== 'undefined' ? GlobalData.settlements : []);
        
        const select = document.getElementById('questSettlementSelect');
        if (select && settlements.length > 0) {
            select.innerHTML = '<option value="">-- Select Settlement --</option>';
            settlements.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.settlement_id;
                opt.textContent = s.settlement_name;
                select.appendChild(opt);
            });
            console.log(`✅ Populated ${settlements.length} settlements`);
            return true;
        }
        return false;
    };
    
    // Try immediately, then retry if needed
    if (!populateDropdown()) {
        // Wait for global data to load
        if (typeof loadSettlementsData === 'function') {
            await loadSettlementsData();
            populateDropdown();
        } else {
            // Retry a few times
            let retries = 0;
            const retry = () => {
                if (populateDropdown() || retries >= 5) return;
                retries++;
                setTimeout(retry, 1000);
            };
            setTimeout(retry, 1000);
        }
    }
}

// Handle settlement selection change
function onQuestSettlementChange() {
    const select = document.getElementById('questSettlementSelect');
    questState.selectedSettlementId = select?.value ? parseInt(select.value) : null;
    console.log('Settlement changed to:', questState.selectedSettlementId);
}
window.onQuestSettlementChange = onQuestSettlementChange;

async function loadQuestAssets() {
    console.log('Loading quest assets...');
    try {
        const token = await getCurrentAccessToken();
        if (!token) return;
        
        const response = await fetch('http://localhost:8080/api/getQuestAssets', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!response.ok) throw new Error('Failed to fetch quest assets');
        
        const assets = await response.json();
        questState.questAssets = assets || [];
        console.log(`✅ Loaded ${questState.questAssets.length} quest assets`);
    } catch (error) {
        console.error('Failed to load quest assets:', error);
        questState.questAssets = [];
    }
}

// ==================== LOAD GLOBAL DATA ====================
async function loadQuestGlobalData() {
    console.log('Loading global data for quest designer...');
    
    try {
        // Load effects
        if (typeof loadEffectsData === 'function') {
            questState.effects = await loadEffectsData() || [];
        } else if (typeof GlobalData !== 'undefined') {
            questState.effects = GlobalData.effects || [];
        }
        populateEffectsDropdown();
        
        // Load enemies
        if (typeof loadEnemiesData === 'function') {
            questState.enemies = await loadEnemiesData() || [];
        } else if (typeof GlobalData !== 'undefined') {
            questState.enemies = GlobalData.enemies || [];
        }
        
        // Load items
        if (typeof loadItemsData === 'function') {
            questState.items = await loadItemsData() || [];
        } else if (typeof GlobalData !== 'undefined') {
            questState.items = GlobalData.items || [];
        }
        populateItemsDropdown();
        populatePotionsDropdown();
        
        // Load perks
        if (typeof loadPerksData === 'function') {
            questState.perks = await loadPerksData() || [];
        } else if (typeof GlobalData !== 'undefined') {
            questState.perks = GlobalData.perks || [];
        }
        populatePerksDropdown();
        populateBlessingsDropdown();
        
        console.log(`✅ Global data loaded: ${questState.effects.length} effects, ${questState.enemies.length} enemies, ${questState.items.length} items, ${questState.perks.length} perks`);
    } catch (error) {
        console.error('Error loading global data:', error);
    }
}

function populateEffectsDropdown() {
    const select = document.getElementById('sidebarEffectId');
    if (!select) return;
    
    select.innerHTML = '<option value="">-- Select --</option>';
    questState.effects.forEach(effect => {
        const opt = document.createElement('option');
        opt.value = effect.effect_id || effect.id;
        opt.textContent = effect.effect_name || effect.name || `Effect ${effect.effect_id || effect.id}`;
        select.appendChild(opt);
    });
}

function populateItemsDropdown() {
    const select = document.getElementById('sidebarRewardItem');
    if (!select) return;
    
    select.innerHTML = '<option value="">-- Select Item --</option>';
    const nonPotionItems = questState.items.filter(item => item.type !== 'potion');
    nonPotionItems.forEach(item => {
        const opt = document.createElement('option');
        opt.value = item.item_id || item.id;
        opt.textContent = item.item_name || item.name || `Item ${item.item_id || item.id}`;
        select.appendChild(opt);
    });
}

function populatePotionsDropdown() {
    const select = document.getElementById('sidebarRewardPotion');
    if (!select) return;
    
    select.innerHTML = '<option value="">-- Select Potion --</option>';
    const potions = questState.items.filter(item => item.type === 'potion');
    potions.forEach(item => {
        const opt = document.createElement('option');
        opt.value = item.item_id || item.id;
        opt.textContent = item.item_name || item.name || `Potion ${item.item_id || item.id}`;
        select.appendChild(opt);
    });
}

function populatePerksDropdown() {
    const select = document.getElementById('sidebarRewardPerk');
    if (!select) return;
    
    select.innerHTML = '<option value="">-- Select Perk --</option>';
    questState.perks.forEach(perk => {
        const opt = document.createElement('option');
        opt.value = perk.perk_id || perk.id;
        opt.textContent = perk.perk_name || perk.name || `Perk ${perk.perk_id || perk.id}`;
        select.appendChild(opt);
    });
}

function populateBlessingsDropdown() {
    const select = document.getElementById('sidebarRewardBlessing');
    if (!select) return;
    
    // Blessings are just perks used in church
    select.innerHTML = '<option value="">-- Select Blessing --</option>';
    questState.perks.forEach(perk => {
        const opt = document.createElement('option');
        opt.value = perk.perk_id || perk.id;
        opt.textContent = perk.perk_name || perk.name || `Blessing ${perk.perk_id || perk.id}`;
        select.appendChild(opt);
    });
}

function populateEnemyGrid() {
    const grid = document.getElementById('questEnemyPickerGrid');
    if (!grid) return;
    
    grid.innerHTML = '';
    
    if (questState.enemies.length === 0) {
        grid.innerHTML = '<p style="color:#888;text-align:center;padding:20px;">No enemies loaded</p>';
        return;
    }
    
    questState.enemies.forEach(enemy => {
        const id = enemy.enemy_id || enemy.id;
        const name = enemy.enemy_name || enemy.name || `Enemy ${id}`;
        const icon = enemy.icon || enemy.signedPortraitUrl || '';
        
        const div = document.createElement('div');
        div.className = 'quest-enemy-item';
        div.dataset.enemyId = id;
        div.innerHTML = icon 
            ? `<img src="${icon}" alt="${escapeHtml(name)}"><span>${escapeHtml(name)}</span>`
            : `<div class="no-icon">⚔️</div><span>${escapeHtml(name)}</span>`;
        
        div.addEventListener('click', () => {
            selectEnemyFromGrid(id);
        });
        
        grid.appendChild(div);
    });
}

function selectEnemyFromGrid(enemyId) {
    // Update hidden input
    const input = document.getElementById('sidebarEnemyId');
    if (input) input.value = enemyId;
    
    // Update visual selection
    selectEnemyInGrid(enemyId);
    
    // Update option state
    if (questState.selectedOption) {
        const option = questState.options.get(questState.selectedOption);
        if (option) {
            option.enemyId = enemyId;
        }
    }
}

function selectEnemyInGrid(enemyId) {
    const grid = document.getElementById('questEnemyPickerGrid');
    if (!grid) return;
    
    grid.querySelectorAll('.quest-enemy-item').forEach(el => {
        el.classList.toggle('selected', parseInt(el.dataset.enemyId) === enemyId);
    });
}

// ==================== SIDEBAR EVENT LISTENERS ====================
function setupSidebarEventListeners() {
    // Is Start checkbox
    const isStartCheckbox = document.getElementById('sidebarIsStart');
    if (isStartCheckbox) {
        isStartCheckbox.addEventListener('change', (e) => {
            if (!questState.selectedOption) return;
            const option = questState.options.get(questState.selectedOption);
            if (option) {
                option.isStart = e.target.checked;
                renderOption(option);
            }
        });
    }
    
    // Option type select
    const typeSelect = document.getElementById('sidebarOptionType');
    if (typeSelect) {
        typeSelect.addEventListener('change', (e) => {
            if (!questState.selectedOption) return;
            const option = questState.options.get(questState.selectedOption);
            if (option) {
                option.type = e.target.value;
                updateSidebarTypeFields(option.type);
            }
        });
    }
    
    // Stat check fields
    const statTypeSelect = document.getElementById('sidebarStatType');
    if (statTypeSelect) {
        statTypeSelect.addEventListener('change', (e) => {
            if (!questState.selectedOption) return;
            const option = questState.options.get(questState.selectedOption);
            if (option) option.statType = e.target.value || null;
        });
    }
    
    const statRequired = document.getElementById('sidebarStatRequired');
    if (statRequired) {
        statRequired.addEventListener('input', (e) => {
            if (!questState.selectedOption) return;
            const option = questState.options.get(questState.selectedOption);
            if (option) option.statRequired = parseInt(e.target.value) || null;
        });
    }
    
    // Effect check fields
    const effectIdSelect = document.getElementById('sidebarEffectId');
    if (effectIdSelect) {
        effectIdSelect.addEventListener('change', (e) => {
            if (!questState.selectedOption) return;
            const option = questState.options.get(questState.selectedOption);
            if (option) option.effectId = parseInt(e.target.value) || null;
        });
    }
    
    const effectAmount = document.getElementById('sidebarEffectAmount');
    if (effectAmount) {
        effectAmount.addEventListener('input', (e) => {
            if (!questState.selectedOption) return;
            const option = questState.options.get(questState.selectedOption);
            if (option) option.effectAmount = parseInt(e.target.value) || null;
        });
    }
    
    // Reward type select
    const rewardTypeSelect = document.getElementById('sidebarRewardType');
    if (rewardTypeSelect) {
        rewardTypeSelect.addEventListener('change', (e) => {
            if (!questState.selectedOption) return;
            const option = questState.options.get(questState.selectedOption);
            if (option) {
                if (!option.reward) option.reward = {};
                option.reward.type = e.target.value || null;
                updateSidebarRewardFields(option.reward.type);
            }
        });
    }
    
    // Reward stat type
    const rewardStatType = document.getElementById('sidebarRewardStatType');
    if (rewardStatType) {
        rewardStatType.addEventListener('change', (e) => {
            if (!questState.selectedOption) return;
            const option = questState.options.get(questState.selectedOption);
            if (option) {
                if (!option.reward) option.reward = {};
                option.reward.statType = e.target.value || null;
            }
        });
    }
    
    // Reward stat amount
    const rewardStatAmount = document.getElementById('sidebarRewardStatAmount');
    if (rewardStatAmount) {
        rewardStatAmount.addEventListener('input', (e) => {
            if (!questState.selectedOption) return;
            const option = questState.options.get(questState.selectedOption);
            if (option) {
                if (!option.reward) option.reward = {};
                option.reward.amount = parseInt(e.target.value) || null;
            }
        });
    }
    
    // Reward item select
    const rewardItem = document.getElementById('sidebarRewardItem');
    if (rewardItem) {
        rewardItem.addEventListener('change', (e) => {
            if (!questState.selectedOption) return;
            const option = questState.options.get(questState.selectedOption);
            if (option) {
                if (!option.reward) option.reward = {};
                option.reward.itemId = parseInt(e.target.value) || null;
            }
        });
    }
    
    // Reward potion select
    const rewardPotion = document.getElementById('sidebarRewardPotion');
    if (rewardPotion) {
        rewardPotion.addEventListener('change', (e) => {
            if (!questState.selectedOption) return;
            const option = questState.options.get(questState.selectedOption);
            if (option) {
                if (!option.reward) option.reward = {};
                option.reward.potionId = parseInt(e.target.value) || null;
            }
        });
    }
    
    // Reward perk select
    const rewardPerk = document.getElementById('sidebarRewardPerk');
    if (rewardPerk) {
        rewardPerk.addEventListener('change', (e) => {
            if (!questState.selectedOption) return;
            const option = questState.options.get(questState.selectedOption);
            if (option) {
                if (!option.reward) option.reward = {};
                option.reward.perkId = parseInt(e.target.value) || null;
            }
        });
    }
    
    // Reward blessing select
    const rewardBlessing = document.getElementById('sidebarRewardBlessing');
    if (rewardBlessing) {
        rewardBlessing.addEventListener('change', (e) => {
            if (!questState.selectedOption) return;
            const option = questState.options.get(questState.selectedOption);
            if (option) {
                if (!option.reward) option.reward = {};
                option.reward.blessingId = parseInt(e.target.value) || null;
            }
        });
    }
}

// Delete selected option from sidebar
function deleteSelectedOption() {
    if (questState.selectedOption) {
        deleteOption(questState.selectedOption);
        
        // Clear sidebar
        const noSelection = document.getElementById('sidebarNoSelection');
        const content = document.getElementById('sidebarContent');
        if (noSelection) noSelection.style.display = 'flex';
        if (content) content.style.display = 'none';
    }
}
window.deleteSelectedOption = deleteSelectedOption;

// ==================== SAVE ====================
async function saveQuest() {
    console.log('💾 Saving quest data...');
    
    // TODO: Implement save logic
    alert('Save functionality coming soon!');
}
window.saveQuest = saveQuest;

// ==================== UTILITIES ====================
function updateCounter() {
    const counter = document.getElementById('questOptionCounter');
    if (counter) {
        counter.textContent = `${questState.quests.size} quests, ${questState.options.size} options`;
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Export for window
window.questState = questState;
