// Quest Designer - Visual Quest & Option Network Editor
console.log('📦 quest-designer.js LOADED');

// ==================== STATE ====================
const questState = {
    // Quests (slides with asset, name, text, sortOrder for tree depth)
    quests: new Map(),       // questId -> { questId, name, text, assetId, assetUrl, x, y, sortOrder }
    nextQuestId: 1,
    selectedQuest: null,
    
    // Options (nodes with option text, node text, type, type-specific data)
    // Type can be: dialogue, stat_check, effect_check, combat, faction, end
    options: new Map(),      // optionId -> { optionId, optionText, nodeText, x, y, isStart, type, statType, statRequired, effectId, effectAmount, optionEffectId, optionEffectFactor, factionRequired, enemyId, reward }
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
    chainContext: '',
    selectedSettlementId: null,
    
    // Quest assets
    questAssets: [],
    editingQuestAsset: null,
    
    // Server tracking - for detecting deletions
    serverQuests: new Map(),
    serverOptions: new Map(),
    
    // Track deleted items (server IDs of items that were loaded then deleted)
    deletedQuestIds: [],
    deletedOptionIds: [],
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
    canvas.addEventListener('mousedown', onQuestCanvasMouseDown);
    canvas.addEventListener('mousemove', onQuestCanvasMouseMove);
    canvas.addEventListener('mouseup', onQuestCanvasMouseUp);
    canvas.addEventListener('mouseleave', onQuestCanvasMouseUp);
    
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
        
        // Only handle wheel events if quest page is visible
        const questPage = document.getElementById('quests-content');
        if (!questPage || questPage.style.display === 'none') return;
        
        // Don't capture wheel if asset gallery overlay is open (allow scrolling in gallery)
        const galleryOverlay = document.getElementById('questAssetGalleryOverlay');
        if (galleryOverlay && galleryOverlay.classList.contains('active')) return;
        
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
    
    // Upload button event listeners
    const questUploadBtn = document.getElementById('questUploadBtn');
    if (questUploadBtn) {
        questUploadBtn.addEventListener('click', () => {
            document.getElementById('questAssetFileInput').click();
        });
    }
    
    const questAssetFileInput = document.getElementById('questAssetFileInput');
    if (questAssetFileInput) {
        questAssetFileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                uploadQuestAsset(file);
            }
        });
    }
    
    // Asset gallery - click overlay to close
    const questGalleryOverlay = document.getElementById('questAssetGalleryOverlay');
    if (questGalleryOverlay) {
        questGalleryOverlay.addEventListener('click', (e) => {
            if (e.target === questGalleryOverlay) {
                closeQuestAssetModal();
            }
        });
    }
    
    // Asset gallery - ESC to close
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const galleryOverlay = document.getElementById('questAssetGalleryOverlay');
            if (galleryOverlay && galleryOverlay.classList.contains('active')) {
                closeQuestAssetModal();
            }
        }
    });
    
    // Asset gallery - filter input
    const questAssetFilter = document.getElementById('questAssetFilter');
    if (questAssetFilter) {
        questAssetFilter.addEventListener('input', (e) => {
            populateQuestAssetGallery(e.target.value);
        });
    }
    
    // Sidebar event listeners
    setupSidebarEventListeners();

    // Quest generator panel
    setupQuestGeneratePanel();
    
    // Populate dropdowns from GlobalData or enemy-designer data - retry if not loaded yet
    let dropdownRetryCount = 0;
    const tryPopulateDropdowns = () => {
        populateEffectsDropdown();
        populateEnemyGrid();
        populateItemsDropdown();
        populatePotionsDropdown();
        populatePerksDropdown();
        populateBlessingsDropdown();
        
        // Check if enemies loaded, retry if not
        const enemyGrid = document.getElementById('questEnemyPickerGrid');
        const hasEnemies = enemyGrid && enemyGrid.children.length > 0 && !enemyGrid.querySelector('p');
        if (!hasEnemies && dropdownRetryCount < 5) {
            dropdownRetryCount++;
            console.log(`Enemies not loaded yet, retrying in 2s (attempt ${dropdownRetryCount})...`);
            setTimeout(tryPopulateDropdowns, 2000);
        }
    };
    setTimeout(tryPopulateDropdowns, 1500);
    
    updateCounter();
    console.log('✅ Quest Designer ready');
    
    // Load data
    loadQuestSettlements();
    loadQuestAssets();
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
    
    // Determine which quest this option belongs to
    // If a quest is selected, attach to it. Otherwise, the first quest or null
    let targetQuestId = questState.selectedQuest;
    if (!targetQuestId && questState.quests.size > 0) {
        targetQuestId = questState.quests.keys().next().value;
    }
    
    const rect = canvas.getBoundingClientRect();
    const id = questState.nextOptionId++;
    
    // Determine if this should be a start option
    // It's a start if: no options yet, or it's the first option for this quest
    const existingQuestOptions = Array.from(questState.options.values()).filter(o => o.questId === targetQuestId);
    const isStart = existingQuestOptions.length === 0;
    
    const option = {
        optionId: id,
        questId: targetQuestId, // Link to quest
        optionText: '',
        nodeText: '',
        x: (rect.width / 2 - questState.canvasOffset.x) / questState.zoom - 100 + (Math.random() - 0.5) * 100,
        y: (rect.height / 2 - questState.canvasOffset.y) / questState.zoom - 50 + (Math.random() - 0.5) * 100,
        isStart: isStart,
        // Option type: dialogue, stat_check, effect_check, combat, faction, end
        type: 'dialogue',
        // Stat check fields
        statType: null,
        statRequired: null,
        // Effect check fields
        effectId: null,
        effectAmount: null,
        // Option effect fields
        optionEffectId: null,
        optionEffectFactor: null,
        // Faction requirement
        factionRequired: null,
        // Combat field
        enemyId: null,
        // Reward - same structure as expedition
        reward: null, // { type: 'stat'|'talent'|'item'|'potion'|'perk'|'blessing', statType, amount, itemId, perkId, potionId, blessingId }
    };
    
    questState.options.set(id, option);
    renderOption(option);
    
    // If this is a start option, auto-create connection from quest to it
    if (isStart && targetQuestId) {
        questState.connections.push({
            fromType: 'quest',
            fromId: targetQuestId,
            toType: 'option',
            toId: id
        });
        questRenderConnections();
    }
    
    updateCounter();
    
    console.log(`✅ Option #${id} created, linked to quest ${targetQuestId}`);
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
            questStartConnection('quest', quest.questId, side, e);
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
            <input type="text" class="option-text-input" value="${option.optionText && option.optionText !== 'New Option' ? escapeHtml(option.optionText) : ''}" 
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
            questStartConnection('option', option.optionId, side, e);
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
        questRenderConnections();
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
function questStartConnection(type, id, side, e) {
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
        questUpdateConnectionPreview(ev);
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
        
        questCancelConnection();
        questRenderConnections();
    };
    
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    
    questUpdateConnectionPreview(e);
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

function questCancelConnection() {
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

function questUpdateConnectionPreview(e) {
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

function questRenderConnections() {
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
                questRenderConnections();
            }
        });
        
        svg.insertBefore(path, svg.firstChild);
    });
}

// ==================== DELETE FUNCTIONS ====================
function deleteQuest(id) {
    if (!confirm('Delete this quest?')) return;
    
    // Track for server deletion if it has a serverId
    const quest = questState.quests.get(id);
    if (quest?.serverId) {
        questState.deletedQuestIds.push(quest.serverId);
        console.log(`Marked quest ${quest.serverId} for deletion`);
    }
    
    // Remove connections involving this quest
    questState.connections = questState.connections.filter(c => 
        !(c.fromType === 'quest' && c.fromId === id) && 
        !(c.toType === 'quest' && c.toId === id)
    );
    
    document.getElementById(`quest-${id}`)?.remove();
    questState.quests.delete(id);
    questState.selectedQuest = null;
    
    questRenderConnections();
    updateCounter();
}

function deleteOption(id) {
    if (!confirm('Delete this option?')) return;
    
    // Track for server deletion if it has a serverId
    const option = questState.options.get(id);
    if (option?.serverId) {
        questState.deletedOptionIds.push(option.serverId);
        console.log(`Marked option ${option.serverId} for deletion`);
    }
    
    // Remove connections involving this option
    questState.connections = questState.connections.filter(c => 
        !(c.fromType === 'option' && c.fromId === id) && 
        !(c.toType === 'option' && c.toId === id)
    );
    
    document.getElementById(`option-${id}`)?.remove();
    questState.options.delete(id);
    questState.selectedOption = null;
    
    questRenderConnections();
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
    if (statTypeSelect) statTypeSelect.value = option.statType || 'strength';
    
    const statRequired = document.getElementById('sidebarStatRequired');
    if (statRequired) statRequired.value = option.statRequired || '';
    
    // Populate effect check fields
    const effectIdSelect = document.getElementById('sidebarEffectId');
    if (effectIdSelect) effectIdSelect.value = option.effectId || '';
    
    const effectAmount = document.getElementById('sidebarEffectAmount');
    if (effectAmount) effectAmount.value = option.effectAmount || '';

    const optionEffectId = document.getElementById('sidebarOptionEffectId');
    if (optionEffectId) optionEffectId.value = option.optionEffectId || '';

    const optionEffectFactor = document.getElementById('sidebarOptionEffectFactor');
    if (optionEffectFactor) optionEffectFactor.value = option.optionEffectFactor || '';

    const factionRequired = document.getElementById('sidebarFactionRequired');
    if (factionRequired) factionRequired.value = option.factionRequired || '';
    
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
    if (rewardStatType) rewardStatType.value = reward.statType || 'strength';
    
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
    document.getElementById('optionTypeFaction')?.style && (document.getElementById('optionTypeFaction').style.display = 'none');
    
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
        case 'faction':
            const factionSection = document.getElementById('optionTypeFaction');
            if (factionSection) factionSection.style.display = 'block';
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
function onQuestCanvasMouseDown(e) {
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

function onQuestCanvasMouseMove(e) {
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
        questRenderConnections();
    }
    
    if (questState.isConnecting) {
        questUpdateConnectionPreview(e);
    }
}

function onQuestCanvasMouseUp(e) {
    if (questState.isDragging) {
        questState.isDragging = false;
        document.getElementById('questCanvas').style.cursor = 'grab';
    }
    
    if (questState.isConnecting && !e.target.closest('.quest-slide, .option-node')) {
        questCancelConnection();
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
    
    questRenderConnections();
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
    
    questRenderConnections();
}
window.changeQuestZoom = changeQuestZoom;

function panQuestCanvas(dx, dy) {
    questState.canvasOffset.x += dx;
    questState.canvasOffset.y += dy;
    
    const container = document.getElementById('questOptionsContainer');
    if (container) {
        container.style.transform = `translate(${questState.canvasOffset.x}px, ${questState.canvasOffset.y}px) scale(${questState.zoom})`;
    }
    
    questRenderConnections();
}
window.panQuestCanvas = panQuestCanvas;

function resetQuestView() {
    questState.canvasOffset = { x: 0, y: 0 };
    questState.zoom = 1;
    
    const container = document.getElementById('questOptionsContainer');
    if (container) container.style.transform = 'translate(0, 0) scale(1)';
    
    const indicator = document.getElementById('questZoomIndicator');
    if (indicator) indicator.textContent = '100%';
    
    questRenderConnections();
}
window.resetQuestView = resetQuestView;

// ==================== QUEST ASSET PICKER ====================
function openQuestAssetPicker(questId) {
    console.log('Opening asset picker for quest', questId);
    questState.editingQuestAsset = questId;
    
    const overlay = document.getElementById('questAssetGalleryOverlay');
    if (overlay) {
        // Clear filter
        const filterInput = document.getElementById('questAssetFilter');
        if (filterInput) filterInput.value = '';
        
        populateQuestAssetGallery();
        overlay.classList.add('active');
    }
}

function closeQuestAssetModal() {
    const overlay = document.getElementById('questAssetGalleryOverlay');
    if (overlay) overlay.classList.remove('active');
    questState.editingQuestAsset = null;
}
window.closeQuestAssetModal = closeQuestAssetModal;

// Get location-asset mapping from GlobalData
function getLocationAssetIds() {
    // Build a map of asset IDs to location names
    const assetLocationMap = new Map();
    const settlements = GlobalData.settlements || [];
    
    settlements.forEach(settlement => {
        const locations = settlement.locations || [];
        locations.forEach(loc => {
            if (loc.texture_id) {
                // Store location name for this asset ID
                const existing = assetLocationMap.get(loc.texture_id) || [];
                existing.push(loc.name);
                assetLocationMap.set(loc.texture_id, existing);
            }
        });
    });
    
    return assetLocationMap;
}

function populateQuestAssetGallery(filterText = '') {
    const gallery = document.getElementById('questAssetGallery');
    if (!gallery) return;
    
    // Get current asset ID for selected state
    const currentAssetId = questState.editingQuestAsset 
        ? questState.quests.get(questState.editingQuestAsset)?.assetId 
        : null;
    
    if (questState.questAssets.length === 0) {
        gallery.innerHTML = '<p style="color:#a0aec0;text-align:center;padding:40px;">No assets yet. Upload some!</p>';
        return;
    }
    
    // Get location-asset mapping for filtering
    const assetLocationMap = getLocationAssetIds();
    
    // Filter assets by location name if filter text provided
    let filteredAssets = questState.questAssets;
    if (filterText.trim()) {
        const searchTerm = filterText.toLowerCase().trim();
        filteredAssets = questState.questAssets.filter(asset => {
            const locationNames = assetLocationMap.get(asset.id) || [];
            return locationNames.some(name => name.toLowerCase().includes(searchTerm));
        });
    }
    
    if (filteredAssets.length === 0) {
        gallery.innerHTML = `<p style="color:#a0aec0;text-align:center;padding:40px;">No assets match "${filterText}"</p>`;
        return;
    }
    
    gallery.innerHTML = filteredAssets.map(asset => {
        const locationNames = assetLocationMap.get(asset.id) || [];
        const locationLabel = locationNames.length > 0 ? locationNames.join(', ') : '';
        return `
            <div class="quest-asset-item ${asset.id === currentAssetId ? 'selected' : ''}" 
                 data-asset-id="${asset.id}">
                <img src="${asset.url}" alt="Asset ${asset.id}">
                <div class="asset-id">${locationLabel || `ID: ${asset.id}`}</div>
            </div>
        `;
    }).join('');
    
    // Add click listeners
    gallery.querySelectorAll('.quest-asset-item').forEach(item => {
        item.addEventListener('click', () => {
            const assetId = parseInt(item.dataset.assetId);
            const asset = questState.questAssets.find(a => a.id === assetId);
            if (asset) {
                selectQuestAsset(asset.id, asset.url);
            }
        });
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

// Handle settlement selection change - loads quest chains for that settlement
async function onQuestSettlementChange() {
    const select = document.getElementById('questSettlementSelect');
    questState.selectedSettlementId = select?.value ? parseInt(select.value) : null;
    console.log('Settlement changed to:', questState.selectedSettlementId);
    
    // Clear current state
    clearQuestCanvas();
    
    // Load quest chains for this settlement
    await loadQuestChains();
}
window.onQuestSettlementChange = onQuestSettlementChange;

// Clear the canvas and reset state
function clearQuestCanvas() {
    questState.quests.clear();
    questState.options.clear();
    questState.connections = [];
    questState.selectedQuest = null;
    questState.selectedOption = null;
    questState.selectedChain = null;
    questState.nextQuestId = 1;
    questState.nextOptionId = 1;
    questState.serverQuests.clear();
    questState.serverOptions.clear();
    questState.deletedQuestIds = [];
    questState.deletedOptionIds = [];
    
    const container = document.getElementById('questOptionsContainer');
    if (container) container.innerHTML = '';
    
    questRenderConnections();
    updateCounter();
    
    // Reset chain name input
    const nameInput = document.getElementById('questChainNameInput');
    if (nameInput) nameInput.value = '';

    const contextInput = document.getElementById('questChainContextInput');
    if (contextInput) contextInput.value = '';
}

// Load quest chains for current settlement
async function loadQuestChains() {
    const chainSelect = document.getElementById('questSelect');
    if (!chainSelect) return;
    
    // Default to Create New Chain (selected by default)
    chainSelect.innerHTML = '<option value="new" selected>+ Create New Chain</option>';
    questState.chains.clear();
    
    if (!questState.selectedSettlementId) return;
    
    try {
        const token = await getCurrentAccessToken();
        if (!token) return;
        
        const response = await fetch(`http://localhost:8080/api/getQuests?settlementId=${questState.selectedSettlementId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!response.ok) throw new Error('Failed to fetch quest chains');
        
        const data = await response.json();
        const chains = data.chains || [];
        
        chains.forEach(chain => {
            questState.chains.set(chain.questchain_id, chain);
            const opt = document.createElement('option');
            opt.value = chain.questchain_id;
            opt.textContent = chain.name || `Chain #${chain.questchain_id}`;
            chainSelect.appendChild(opt);
        });
        
        console.log(`✅ Loaded ${chains.length} quest chains for settlement ${questState.selectedSettlementId}`);
    } catch (error) {
        console.error('Failed to load quest chains:', error);
    }
}

// Handle quest chain selection change
async function onQuestChange() {
    const select = document.getElementById('questSelect');
    const selectedValue = select?.value;
    
    console.log('Quest chain changed to:', selectedValue);
    
    // Clear canvas first
    clearQuestCanvas();
    
    if (selectedValue === 'new') {
        // Create new chain mode
        questState.selectedChain = null;
        const nameInput = document.getElementById('questChainNameInput');
        if (nameInput) {
            nameInput.value = '';
            nameInput.focus();
        }
        const contextInput = document.getElementById('questChainContextInput');
        if (contextInput) contextInput.value = '';
        return;
    }
    
    if (!selectedValue) return;
    
    const chainId = parseInt(selectedValue);
    questState.selectedChain = chainId;
    
    // Update chain name input
    const chain = questState.chains.get(chainId);
    const nameInput = document.getElementById('questChainNameInput');
    if (nameInput && chain) {
        nameInput.value = chain.name || '';
    }

    const contextInput = document.getElementById('questChainContextInput');
    if (contextInput && chain) {
        contextInput.value = chain.context || '';
    }
    questState.chainContext = chain?.context || '';
    
    // Load quests, options, and requirements for this chain
    await loadQuestChainData(chainId);
}
window.onQuestChange = onQuestChange;

// Update chain name in state
function updateChainName(name) {
    questState.chainName = name;
}
window.updateChainName = updateChainName;

function updateChainContext(value) {
    questState.chainContext = value;
}
window.updateChainContext = updateChainContext;

// Load full data for a quest chain
async function loadQuestChainData(chainId) {
    try {
        const token = await getCurrentAccessToken();
        if (!token) return;
        
        const response = await fetch(`http://localhost:8080/api/getQuests?settlementId=${questState.selectedSettlementId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!response.ok) throw new Error('Failed to fetch quest data');
        
        const data = await response.json();
        
        // Filter to only this chain's quests
        const chainQuests = (data.quests || []).filter(q => q.questchain_id === chainId);
        const questIds = new Set(chainQuests.map(q => q.quest_id));
        
        // Filter options to only those belonging to chain's quests
        const chainOptions = (data.options || []).filter(o => questIds.has(o.quest_id));
        const optionIds = new Set(chainOptions.map(o => o.option_id));
        
        // Filter requirements
        const chainRequirements = (data.requirements || []).filter(r => 
            optionIds.has(r.optionId) || optionIds.has(r.requiredOptionId)
        );
        
        console.log(`Loading chain ${chainId}: ${chainQuests.length} quests, ${chainOptions.length} options, ${chainRequirements.length} requirements`);
        
        // Track max IDs for new items
        let maxQuestId = 0;
        let maxOptionId = 0;
        
        // Load quests
        chainQuests.forEach(q => {
            const quest = {
                questId: q.quest_id,
                serverId: q.quest_id,
                name: q.quest_name || `Quest ${q.quest_id}`,
                text: q.start_text || '',
                assetId: q.asset_id,
                assetUrl: q.asset_id ? `https://gamedata-assets.s3.eu-north-1.amazonaws.com/images/quests/${q.asset_id}.webp` : null,
                sortOrder: q.sort_order || 0,
                x: q.pos_x || 50,
                y: q.pos_y || 100,
                requisiteOptionId: q.requisite_option_id,
            };
            questState.quests.set(q.quest_id, quest);
            questState.serverQuests.set(q.quest_id, { ...quest });
            maxQuestId = Math.max(maxQuestId, q.quest_id);
        });
        
        // Load options
        chainOptions.forEach(o => {
            const option = {
                optionId: o.option_id,
                serverId: o.option_id,
                questId: o.quest_id, // The quest this option belongs to
                optionText: o.option_text || 'Option',
                nodeText: o.node_text || '',
                x: o.x || o.pos_x || 0,
                y: o.y || o.pos_y || 0,
                isStart: o.start || false,
                type: determineOptionType(o),
                statType: o.stat_type,
                statRequired: o.stat_required,
                effectId: o.effect_id,
                effectAmount: o.effect_amount,
                optionEffectId: o.option_effect_id,
                optionEffectFactor: o.option_effect_factor,
                factionRequired: o.faction_required,
                enemyId: o.enemy_id,
                reward: extractReward(o),
            };
            questState.options.set(o.option_id, option);
            questState.serverOptions.set(o.option_id, { ...option });
            maxOptionId = Math.max(maxOptionId, o.option_id);
        });
        
        // Set next IDs
        questState.nextQuestId = maxQuestId + 1;
        questState.nextOptionId = maxOptionId + 1;
        
        // Build connections based on questId:
        // - For each quest, find its START options and create quest -> option connections
        // - Requirements table represents option -> option connections (option requires requiredOption to be done first)
        buildConnectionsFromData(chainQuests, chainOptions, chainRequirements);
        
        // Render everything
        questState.quests.forEach(quest => renderQuest(quest));
        questState.options.forEach(option => renderOption(option));
        questRenderConnections();
        updateCounter();
        
        console.log(`✅ Loaded quest chain ${chainId}`);
    } catch (error) {
        console.error('Failed to load quest chain data:', error);
    }
}

// Determine option type from DB fields
function determineOptionType(o) {
    if (o.faction_required) return 'faction';
    if (o.enemy_id) return 'combat';
    if (o.effect_id && o.effect_amount) return 'effect_check';
    if (o.stat_type && o.stat_required) return 'stat_check';
    return 'dialogue';
}

// Extract reward object from option data
function extractReward(o) {
    if (o.reward_stat_type && o.reward_stat_amount) {
        return { type: 'stat', statType: o.reward_stat_type, amount: o.reward_stat_amount };
    }
    if (o.reward_talent) {
        return { type: 'talent' };
    }
    if (o.reward_item) {
        return { type: 'item', itemId: o.reward_item };
    }
    if (o.reward_potion) {
        return { type: 'potion', potionId: o.reward_potion };
    }
    if (o.reward_perk) {
        return { type: 'perk', perkId: o.reward_perk };
    }
    if (o.reward_blessing) {
        return { type: 'blessing', blessingId: o.reward_blessing };
    }
    return null;
}

// Build connections: 
// - Quest -> Start options (visual connection from quest to its starting options)
// - Option -> Option (from requirements table - option requires another option)
function buildConnectionsFromData(quests, options, requirements) {
    questState.connections = [];
    
    // For each quest, connect to its START options only
    quests.forEach(quest => {
        const startOptions = options.filter(o => o.quest_id === quest.quest_id && o.start);
        startOptions.forEach(opt => {
            questState.connections.push({
                fromType: 'quest',
                fromId: quest.quest_id,
                toType: 'option',
                toId: opt.option_id
            });
        });
    });
    
    // Option -> Option connections from requirements
    // In requirements: option_id requires required_option_id
    // This means required_option_id leads TO option_id
    // So connection is: required_option_id -> option_id
    requirements.forEach(req => {
        questState.connections.push({
            fromType: 'option',
            fromId: req.requiredOptionId,
            toType: 'option',
            toId: req.optionId
        });
    });
    
    // Option -> Quest connections from requisite_option_id
    // If a quest has requisite_option_id, it means that option leads to this quest
    quests.forEach(quest => {
        if (quest.requisite_option_id) {
            questState.connections.push({
                fromType: 'option',
                fromId: quest.requisite_option_id,
                toType: 'quest',
                toId: quest.quest_id
            });
        }
    });
    
    console.log(`Built ${questState.connections.length} connections`);
}

async function loadQuestAssets() {
    console.log('Loading quest assets...');
    try {
        // Use shared GlobalData loader
        await loadQuestAssetsData();
        questState.questAssets = GlobalData.questAssets || [];
        console.log(`✅ Loaded ${questState.questAssets.length} quest assets from GlobalData`);
    } catch (error) {
        console.error('Failed to load quest assets:', error);
        questState.questAssets = [];
    }
}

// Upload quest asset to S3
async function uploadQuestAsset(file) {
    if (!file.type.startsWith('image/')) {
        alert('Please select an image file');
        return;
    }

    const uploadStatus = document.getElementById('questAssetUploadStatus');
    if (uploadStatus) {
        uploadStatus.textContent = 'Converting to WebP...';
        uploadStatus.className = 'quest-upload-status';
    }

    try {
        const token = await getCurrentAccessToken();
        if (!token) throw new Error('Not authenticated');

        // Convert to WebP format
        const webpBlob = await convertQuestImageToWebP(file);
        
        if (uploadStatus) uploadStatus.textContent = 'Uploading...';

        // Convert to base64
        const reader = new FileReader();
        const base64Promise = new Promise((resolve, reject) => {
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
        });
        reader.readAsDataURL(webpBlob);
        const base64Data = await base64Promise;

        const response = await fetch('http://localhost:8080/api/uploadQuestAsset', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                imageData: base64Data,
                filename: file.name.replace(/\.[^/.]+$/, '.webp')
            })
        });

        if (!response.ok) throw new Error('Upload failed');

        const result = await response.json();
        console.log('✅ Quest asset uploaded:', result);

        // Add to assets (questState.questAssets IS GlobalData.questAssets - same reference)
        questState.questAssets.push({ id: result.assetId, url: result.url });

        // Refresh gallery and auto-select
        populateQuestAssetGallery();
        selectQuestAsset(result.assetId, result.url);

        if (uploadStatus) {
            uploadStatus.textContent = 'Upload complete!';
            setTimeout(() => { uploadStatus.textContent = ''; }, 2000);
        }

    } catch (error) {
        console.error('Upload failed:', error);
        if (uploadStatus) {
            uploadStatus.textContent = 'Upload failed: ' + error.message;
            uploadStatus.className = 'quest-upload-status error';
        }
    }
}

// Convert image to WebP format for quest assets
function convertQuestImageToWebP(file) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            // Preserve original dimensions for quest backgrounds
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            canvas.toBlob(blob => {
                if (blob) resolve(blob);
                else reject(new Error('WebP conversion failed'));
            }, 'image/webp', 0.9);
        };
        img.onerror = reject;
        img.src = URL.createObjectURL(file);
    });
}

// ==================== POPULATE DROPDOWNS FROM GLOBALDATA ====================
function populateEffectsDropdown() {
    const effects = typeof getEffects === 'function' ? getEffects() : (GlobalData?.effects || []);
    const select = document.getElementById('sidebarEffectId');
    const optionEffectSelect = document.getElementById('sidebarOptionEffectId');
    if (!select && !optionEffectSelect) return;
    
    if (select) {
        select.innerHTML = '<option value="" disabled selected>-- Select Effect --</option>';
    }
    if (optionEffectSelect) {
        optionEffectSelect.innerHTML = '<option value="" disabled selected>-- Select Effect --</option>';
    }
    effects.forEach(effect => {
        const value = effect.effect_id || effect.id;
        const label = effect.effect_name || effect.name || `Effect ${value}`;
        if (select) {
            const opt = document.createElement('option');
            opt.value = value;
            opt.textContent = label;
            select.appendChild(opt);
        }
        if (optionEffectSelect) {
            const opt = document.createElement('option');
            opt.value = value;
            opt.textContent = label;
            optionEffectSelect.appendChild(opt);
        }
    });
}

function populateItemsDropdown() {
    const items = typeof getItems === 'function' ? getItems() : (GlobalData?.items || []);
    const select = document.getElementById('sidebarRewardItem');
    if (!select) return;
    
    select.innerHTML = '<option value="" disabled selected>-- Select Item --</option>';
    const nonPotionItems = items.filter(item => item.type !== 'potion');
    nonPotionItems.forEach(item => {
        const opt = document.createElement('option');
        opt.value = item.item_id || item.id;
        opt.textContent = item.item_name || item.name || `Item ${item.item_id || item.id}`;
        select.appendChild(opt);
    });
}

function populatePotionsDropdown() {
    const items = typeof getItems === 'function' ? getItems() : (GlobalData?.items || []);
    const select = document.getElementById('sidebarRewardPotion');
    if (!select) return;
    
    select.innerHTML = '<option value="" disabled selected>-- Select Potion --</option>';
    const potions = items.filter(item => item.type === 'potion');
    potions.forEach(item => {
        const opt = document.createElement('option');
        opt.value = item.item_id || item.id;
        opt.textContent = item.item_name || item.name || `Potion ${item.item_id || item.id}`;
        select.appendChild(opt);
    });
}

function populatePerksDropdown() {
    const perks = typeof getPerks === 'function' ? getPerks() : (GlobalData?.perks || []);
    const select = document.getElementById('sidebarRewardPerk');
    if (!select) return;
    
    select.innerHTML = '<option value="" disabled selected>-- Select Perk --</option>';
    perks.forEach(perk => {
        const opt = document.createElement('option');
        opt.value = perk.perk_id || perk.id;
        opt.textContent = perk.perk_name || perk.name || `Perk ${perk.perk_id || perk.id}`;
        select.appendChild(opt);
    });
}

function populateBlessingsDropdown() {
    const perks = typeof getPerks === 'function' ? getPerks() : (GlobalData?.perks || []);
    const select = document.getElementById('sidebarRewardBlessing');
    if (!select) return;
    
    // Blessings are just perks used in church
    select.innerHTML = '<option value="" disabled selected>-- Select Blessing --</option>';
    perks.forEach(perk => {
        const opt = document.createElement('option');
        opt.value = perk.perk_id || perk.id;
        opt.textContent = perk.perk_name || perk.name || `Blessing ${perk.perk_id || perk.id}`;
        select.appendChild(opt);
    });
}

function populateEnemyGrid() {
    // Try different sources for enemies (same as expedition-designer)
    let enemies = [];
    if (typeof allEnemies !== 'undefined' && allEnemies.length > 0) {
        enemies = allEnemies; // From enemy-designer-new.js
    } else if (typeof getEnemies === 'function') {
        enemies = getEnemies(); // From global-data.js
    } else if (typeof GlobalData !== 'undefined' && GlobalData.enemies) {
        enemies = GlobalData.enemies;
    }
    
    const grid = document.getElementById('questEnemyPickerGrid');
    if (!grid) return;
    
    grid.innerHTML = '';
    
    if (enemies.length === 0) {
        grid.innerHTML = '<p style="color:#888;text-align:center;padding:20px;">No enemies loaded yet. Visit Enemy Designer first.</p>';
        return;
    }
    
    enemies.forEach(enemy => {
        // Handle both naming conventions (enemy-designer uses enemyId/enemyName, global-data uses id/name)
        const id = enemy.enemyId || enemy.enemy_id || enemy.id;
        const name = enemy.enemyName || enemy.enemy_name || enemy.name || `Enemy ${id}`;
        const iconUrl = enemy.icon || `https://gamedata-assets.s3.eu-north-1.amazonaws.com/images/enemies/${enemy.assetId}.webp`;
        
        const div = document.createElement('div');
        div.className = 'quest-enemy-item';
        div.dataset.enemyId = id;
        div.innerHTML = `
            <img src="${iconUrl}" alt="${escapeHtml(name)}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2280%22>👹</text></svg>'">
            <span>${escapeHtml(name)}</span>
        `;
        
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

    const optionEffectId = document.getElementById('sidebarOptionEffectId');
    if (optionEffectId) {
        optionEffectId.addEventListener('change', (e) => {
            if (!questState.selectedOption) return;
            const option = questState.options.get(questState.selectedOption);
            if (option) option.optionEffectId = parseInt(e.target.value) || null;
        });
    }

    const optionEffectFactor = document.getElementById('sidebarOptionEffectFactor');
    if (optionEffectFactor) {
        optionEffectFactor.addEventListener('input', (e) => {
            if (!questState.selectedOption) return;
            const option = questState.options.get(questState.selectedOption);
            if (option) option.optionEffectFactor = parseInt(e.target.value) || null;
        });
    }

    const factionRequired = document.getElementById('sidebarFactionRequired');
    if (factionRequired) {
        factionRequired.addEventListener('change', (e) => {
            if (!questState.selectedOption) return;
            const option = questState.options.get(questState.selectedOption);
            if (option) option.factionRequired = e.target.value || null;
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
    
    if (!questState.selectedSettlementId) {
        alert('Please select a settlement first');
        return;
    }
    
    const chainNameInput = document.getElementById('questChainNameInput');
    const chainName = chainNameInput?.value || questState.chainName || '';
    const chainContextInput = document.getElementById('questChainContextInput');
    const chainContext = chainContextInput?.value || questState.chainContext || '';
    
    if (!chainName.trim()) {
        alert('Please enter a chain name');
        chainNameInput?.focus();
        return;
    }
    
    const isNewChain = !questState.selectedChain;
    
    try {
        const token = await getCurrentAccessToken();
        if (!token) {
            alert('Not authenticated');
            return;
        }
        
        // Prepare request data
        const saveData = {
            questchainId: questState.selectedChain || 0,
            chainName: chainName,
            chainContext: chainContext,
            isNewChain: isNewChain,
            settlementId: questState.selectedSettlementId,
            newQuests: [],
            questUpdates: [],
            deletedQuestIds: questState.deletedQuestIds,
            deletedOptionIds: questState.deletedOptionIds,
            newOptions: [],
            optionUpdates: [],
            newRequirements: [],
            pendingRequirements: [],
            questRequisites: [],
        };
        
        // Track local ID to server ID mapping for new items
        const questIdMap = new Map(); // localId -> will be filled after save
        const optionIdMap = new Map();
        
        // Collect quests - separate new from existing
        questState.quests.forEach((quest, id) => {
            if (!quest.serverId) {
                // New quest
                saveData.newQuests.push({
                    localQuestId: id,
                    questName: quest.name,
                    startText: quest.text || '',
                    assetId: quest.assetId || null,
                    posX: quest.x,
                    posY: quest.y,
                    sortOrder: quest.sortOrder || 0,
                });
            } else {
                // Existing quest - update it
                saveData.questUpdates.push({
                    questId: quest.serverId,
                    questName: quest.name,
                    startText: quest.text || '',
                    assetId: quest.assetId || null,
                    posX: quest.x,
                    posY: quest.y,
                    sortOrder: quest.sortOrder || 0,
                });
            }
        });
        
        // Build a map of option -> quest from quest->option connections
        const optionToQuestMap = new Map();
        questState.connections.forEach(conn => {
            if (conn.fromType === 'quest' && conn.toType === 'option') {
                optionToQuestMap.set(conn.toId, conn.fromId);
            }
        });
        
        // Collect options - separate new from existing
        questState.options.forEach((option, id) => {
            // Determine questId: prefer connection-based, fall back to option.questId
            let resolvedQuestId = optionToQuestMap.get(id) || option.questId || 0;
            
            const optionData = {
                localId: id,
                questId: resolvedQuestId,
                nodeText: option.nodeText || '',
                optionText: option.optionText || '',
                isStart: option.isStart || false,
                x: option.x,
                y: option.y,
                statType: option.type === 'stat_check' ? option.statType : null,
                statRequired: option.type === 'stat_check' ? option.statRequired : null,
                effectId: option.type === 'effect_check' ? option.effectId : null,
                effectAmount: option.type === 'effect_check' ? option.effectAmount : null,
                optionEffectId: option.optionEffectId || null,
                optionEffectFactor: option.optionEffectFactor || null,
                factionRequired: option.type === 'faction' ? option.factionRequired : null,
                enemyId: option.type === 'combat' ? option.enemyId : null,
                rewardStatType: option.reward?.type === 'stat' ? option.reward.statType : null,
                rewardStatAmount: option.reward?.type === 'stat' ? option.reward.amount : null,
                rewardTalent: option.reward?.type === 'talent' ? true : null,
                rewardItem: option.reward?.type === 'item' ? option.reward.itemId : null,
                rewardPotion: option.reward?.type === 'potion' ? option.reward.potionId : null,
                rewardPerk: option.reward?.type === 'perk' ? option.reward.perkId : null,
                rewardBlessing: option.reward?.type === 'blessing' ? option.reward.blessingId : null,
            };
            
            if (!option.serverId) {
                // New option
                saveData.newOptions.push(optionData);
            } else {
                // Existing option - update it
                saveData.optionUpdates.push({
                    ...optionData,
                    optionId: option.serverId,
                });
            }
        });
        
        // Collect connections (requirements)
        // Connection from option A -> option B means B requires A
        questState.connections.forEach(conn => {
            if (conn.fromType === 'option' && conn.toType === 'option') {
                const fromOption = questState.options.get(conn.fromId);
                const toOption = questState.options.get(conn.toId);
                
                if (fromOption?.serverId && toOption?.serverId) {
                    // Both have server IDs - can create requirement directly
                    saveData.newRequirements.push({
                        optionId: toOption.serverId,
                        requiredOptionId: fromOption.serverId,
                    });
                } else {
                    // One or both are new - use pending requirements
                    saveData.pendingRequirements.push({
                        localOptionId: conn.toId,
                        localRequiredOptionId: conn.fromId,
                        optionServerId: toOption?.serverId || 0,
                        requiredServerId: fromOption?.serverId || 0,
                    });
                }
            } else if (conn.fromType === 'option' && conn.toType === 'quest') {
                // Option -> Quest connection means the quest's requisite_option_id = option ID
                const fromOption = questState.options.get(conn.fromId);
                const toQuest = questState.quests.get(conn.toId);
                
                saveData.questRequisites.push({
                    optionId: fromOption?.serverId || 0,
                    localOptionId: conn.fromId,
                    questId: toQuest?.serverId || 0,
                    localQuestId: conn.toId,
                });
            }
            // Quest -> option connections are inferred from option's questId and isStart flag
        });
        
        console.log('Save data:', saveData);
        
        const response = await fetch('http://localhost:8080/api/saveQuest', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(saveData),
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Save failed: ${errorText}`);
        }
        
        const result = await response.json();
        console.log('Save result:', result);
        
        // Update local state with server IDs
        if (result.questchainId && isNewChain) {
            questState.selectedChain = result.questchainId;
            // Reload chains to update dropdown
            await loadQuestChains();
            // Select the newly created chain
            const chainSelect = document.getElementById('questSelect');
            if (chainSelect) chainSelect.value = result.questchainId;
        }
        
        // Update option IDs from mapping
        if (result.optionMapping) {
            Object.entries(result.optionMapping).forEach(([localId, serverId]) => {
                const option = questState.options.get(parseInt(localId));
                if (option) {
                    option.serverId = serverId;
                    questState.serverOptions.set(serverId, { ...option });
                }
            });
        }
        
        // Update quest IDs from mapping
        if (result.questMapping) {
            Object.entries(result.questMapping).forEach(([localId, serverId]) => {
                const quest = questState.quests.get(parseInt(localId));
                if (quest) {
                    quest.serverId = serverId;
                    questState.serverQuests.set(serverId, { ...quest });
                }
            });
        }
        
        alert('✅ Quest chain saved successfully!');
        
        // Clear deletion arrays after successful save
        questState.deletedQuestIds = [];
        questState.deletedOptionIds = [];
        
        // Reload to get fresh data
        if (questState.selectedChain) {
            await loadQuestChainData(questState.selectedChain);
        }
        
    } catch (error) {
        console.error('Save error:', error);
        alert(`❌ Failed to save: ${error.message}`);
    }
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

// ==================== QUEST GENERATOR ====================
const questGenerateState = {
    npcs: [],
    allQuests: [],
    rewardItems: [],
    rewardPerks: [],
};

function setupQuestGeneratePanel() {
    document.getElementById('questGenerateBtn')?.addEventListener('click', toggleQuestGeneratePanel);
    document.getElementById('questGenerateClose')?.addEventListener('click', toggleQuestGeneratePanel);
    document.getElementById('questGenerateRun')?.addEventListener('click', generateQuestPreview);
    document.getElementById('questGenerateSettlement')?.addEventListener('change', (e) => {
        populateQuestGenerateLocations(e.target.value);
    });
    document.getElementById('questGenerateNpcFilter')?.addEventListener('input', (e) => {
        populateQuestGenerateNpcs(e.target.value);
    });
    document.getElementById('questGenerateItemRewardFilter')?.addEventListener('input', (e) => {
        populateQuestGenerateRewardItems(e.target.value);
    });
    document.getElementById('questGeneratePerkRewardFilter')?.addEventListener('input', (e) => {
        populateQuestGenerateRewardPerks(e.target.value);
    });
    document.getElementById('questGenerateQuestFilter')?.addEventListener('input', (e) => {
        populateQuestGenerateQuests(e.target.value);
    });
}

function toggleQuestGeneratePanel() {
    const panel = document.getElementById('questGeneratePanel');
    if (!panel) return;
    const isOpen = panel.style.display === 'block';
    panel.style.display = isOpen ? 'none' : 'block';
    const optionSidebar = document.getElementById('questOptionSidebar');
    if (optionSidebar) {
        optionSidebar.style.display = isOpen ? 'block' : 'none';
    }
    if (!isOpen) {
        populateQuestGeneratePanel();
    }
}

async function populateQuestGeneratePanel() {
    if ((!GlobalData?.settlements || GlobalData.settlements.length === 0) && typeof loadSettlementsData === 'function') {
        await loadSettlementsData();
    }
    populateQuestGenerateSettlements();
    populateQuestGenerateLocations(document.getElementById('questGenerateSettlement')?.value || '');
    await loadQuestGenerateNpcs();
    await loadQuestGenerateAllQuests();
    populateQuestGenerateNpcs();
    populateQuestGenerateEnemies();
    populateQuestGenerateRewards();
    populateQuestGenerateQuests();
}

function populateQuestGenerateSettlements() {
    const select = document.getElementById('questGenerateSettlement');
    if (!select) return;
    const settlements = GlobalData?.settlements || [];
    select.innerHTML = '<option value="">-- Any Settlement --</option>';
    settlements.forEach(settlement => {
        const opt = document.createElement('option');
        opt.value = settlement.settlement_id || settlement.world_id || settlement.id || '';
        opt.textContent = settlement.settlement_name || settlement.name || `Settlement ${opt.value}`;
        if (questState.selectedSettlementId && String(opt.value) === String(questState.selectedSettlementId)) {
            opt.selected = true;
        }
        select.appendChild(opt);
    });
}

function populateQuestGenerateLocations(settlementId) {
    const select = document.getElementById('questGenerateLocation');
    if (!select) return;
    const settlements = GlobalData?.settlements || [];
    select.innerHTML = '<option value="">-- Any Location --</option>';

    let locations = [];
    if (settlementId) {
        const settlement = settlements.find(s => String(s.settlement_id || s.world_id || s.id) === String(settlementId));
        locations = settlement?.locations || [];
        locations.forEach(loc => {
            const opt = document.createElement('option');
            opt.value = loc.location_id || loc.id || '';
            opt.textContent = loc.name || `Location ${opt.value}`;
            select.appendChild(opt);
        });
        return;
    }

    settlements.forEach(settlement => {
        (settlement.locations || []).forEach(loc => {
            const opt = document.createElement('option');
            opt.value = loc.location_id || loc.id || '';
            opt.textContent = loc.name || `Location ${opt.value}`;
            select.appendChild(opt);
        });
    });
}

async function loadQuestGenerateNpcs() {
    if (questGenerateState.npcs.length) return;
    try {
        const token = await getCurrentAccessToken();
        if (!token) return;
        const response = await fetch('http://localhost:8080/api/getNpcs', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (data && data.npcs) {
            questGenerateState.npcs = data.npcs;
        }
    } catch (error) {
        console.error('Failed to load NPCs for generator:', error);
    }
}

async function loadQuestGenerateAllQuests() {
    if (questGenerateState.allQuests.length) return;
    try {
        const token = await getCurrentAccessToken();
        if (!token) return;
        const response = await fetch('http://localhost:8080/api/getQuests', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (data && Array.isArray(data.quests)) {
            questGenerateState.allQuests = data.quests;
        }
    } catch (error) {
        console.error('Failed to load quests for generator:', error);
    }
}

function populateQuestGenerateNpcs(filterText = '') {
    const select = document.getElementById('questGenerateNpcs');
    if (!select) return;
    select.innerHTML = '';
    const search = filterText.trim().toLowerCase();
    questGenerateState.npcs
        .filter(npc => {
            if (!search) return true;
            const name = (npc.name || '').toLowerCase();
            return name.includes(search);
        })
        .forEach(npc => {
        const opt = document.createElement('option');
        opt.value = npc.npc_id || npc.id;
        opt.textContent = npc.name || `NPC ${opt.value}`;
        select.appendChild(opt);
    });
}

function populateQuestGenerateEnemies() {
    const select = document.getElementById('questGenerateEnemies');
    if (!select) return;
    let enemies = [];
    if (typeof allEnemies !== 'undefined' && allEnemies.length > 0) {
        enemies = allEnemies;
    } else if (typeof getEnemies === 'function') {
        enemies = getEnemies();
    } else if (typeof GlobalData !== 'undefined' && GlobalData.enemies) {
        enemies = GlobalData.enemies;
    }
    select.innerHTML = '';
    enemies.forEach(enemy => {
        const id = enemy.enemyId || enemy.enemy_id || enemy.id;
        const name = enemy.enemyName || enemy.enemy_name || enemy.name || `Enemy ${id}`;
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = name;
        select.appendChild(opt);
    });
}

function populateQuestGenerateRewards() {
    const items = typeof getItems === 'function' ? getItems() : (GlobalData?.items || []);
    const perks = typeof getPerks === 'function' ? getPerks() : (GlobalData?.perks || []);
    questGenerateState.rewardItems = items;
    questGenerateState.rewardPerks = perks;

    populateQuestGenerateRewardItems('');
    populateQuestGenerateRewardPerks('');
}

function populateQuestGenerateRewardItems(filterText = '') {
    const select = document.getElementById('questGenerateRewardItems');
    if (!select) return;
    select.innerHTML = '';
    const search = filterText.trim().toLowerCase();
    questGenerateState.rewardItems
        .filter(item => {
            if (!search) return true;
            const name = (item.item_name || item.name || '').toLowerCase();
            return name.includes(search);
        })
        .forEach(item => {
            const id = item.item_id || item.id;
            const name = item.item_name || item.name || `Item ${id}`;
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = name;
            select.appendChild(opt);
        });
}

function populateQuestGenerateRewardPerks(filterText = '') {
    const select = document.getElementById('questGenerateRewardPerks');
    if (!select) return;
    select.innerHTML = '';
    const search = filterText.trim().toLowerCase();
    questGenerateState.rewardPerks
        .filter(perk => {
            if (!search) return true;
            const name = (perk.perk_name || perk.name || '').toLowerCase();
            return name.includes(search);
        })
        .forEach(perk => {
            const id = perk.perk_id || perk.id;
            const name = perk.perk_name || perk.name || `Perk ${id}`;
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = name;
            select.appendChild(opt);
        });
}

function populateQuestGenerateQuests(filterText = '') {
    const select = document.getElementById('questGenerateQuests');
    if (!select) return;
    select.innerHTML = '';
    const quests = questGenerateState.allQuests.length ? questGenerateState.allQuests : Array.from(questState.quests.values());
    const search = filterText.trim().toLowerCase();
    quests
        .filter(quest => {
            if (!search) return true;
            const name = (quest.quest_name || quest.name || '').toLowerCase();
            return name.includes(search);
        })
        .forEach(quest => {
        const opt = document.createElement('option');
        opt.value = quest.quest_id || quest.serverId || quest.questId || '';
        opt.textContent = quest.quest_name || quest.name || `Quest ${opt.value}`;
        select.appendChild(opt);
    });
}

function collectMultiSelectValues(selectId) {
    const select = document.getElementById(selectId);
    if (!select) return [];
    return Array.from(select.selectedOptions).map(opt => opt.value);
}

async function generateQuestPreview() {
    const settlementId = document.getElementById('questGenerateSettlement')?.value || '';
    const locationId = document.getElementById('questGenerateLocation')?.value || '';
    const prompt = document.getElementById('questGeneratePrompt')?.value || '';
    const selectedNpcIds = collectMultiSelectValues('questGenerateNpcs').map(id => parseInt(id, 10));
    const selectedEnemyIds = collectMultiSelectValues('questGenerateEnemies').map(id => parseInt(id, 10));
    const selectedQuestIds = collectMultiSelectValues('questGenerateQuests').map(id => parseInt(id, 10));
    const selectedItemIds = collectMultiSelectValues('questGenerateRewardItems').map(id => parseInt(id, 10));
    const selectedPerkIds = collectMultiSelectValues('questGenerateRewardPerks').map(id => parseInt(id, 10));
    let conceptPayload = {};
    let conceptSystemPrompt = '';
    let conceptWildsPrompt = '';
    try {
        const token = await getCurrentAccessToken();
        if (token) {
            const response = await fetch('http://localhost:8080/api/getConcept', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await response.json();
            if (data?.success) {
                conceptPayload = data.payload || {};
                conceptSystemPrompt = toPromptText(data.systemPrompt);
                conceptWildsPrompt = toPromptText(data.wildsPrompt);
            }
        }
    } catch (error) {
        console.error('Failed to load concept for generator:', error);
    }

    const schema = conceptPayload?.json_schema ?? conceptPayload ?? {};

    const settlements = GlobalData?.settlements || [];
    const settlement = settlements.find(s => String(s.settlement_id || s.world_id || s.id) === String(settlementId));
    let location = null;
    if (settlement && locationId) {
        location = (settlement.locations || []).find(loc => String(loc.location_id || loc.id) === String(locationId)) || null;
    } else if (locationId) {
        settlements.some(s => {
            const found = (s.locations || []).find(loc => String(loc.location_id || loc.id) === String(locationId));
            if (found) {
                location = found;
                return true;
            }
            return false;
        });
    }

    const npcLookup = new Map(questGenerateState.npcs.map(npc => [npc.npc_id || npc.id, npc]));
    const npcs = selectedNpcIds
        .map(id => npcLookup.get(id))
        .filter(Boolean)
        .map(npc => ({
            id: npc.npc_id || npc.id,
            name: npc.name || '',
            context: npc.context || '',
            role: npc.role || '',
            personality: npc.personality || '',
            goals: npc.goals || ''
        }));

    const enemies = selectedEnemyIds
        .map(id => {
            if (typeof allEnemies !== 'undefined' && allEnemies.length > 0) {
                return allEnemies.find(enemy => (enemy.enemyId || enemy.enemy_id || enemy.id) === id);
            }
            if (typeof getEnemies === 'function') {
                return getEnemies().find(enemy => (enemy.enemyId || enemy.enemy_id || enemy.id) === id);
            }
            return (GlobalData?.enemies || []).find(enemy => (enemy.enemyId || enemy.enemy_id || enemy.id) === id);
        })
        .filter(Boolean)
        .map(enemy => ({
            id: enemy.enemyId || enemy.enemy_id || enemy.id,
            name: enemy.enemyName || enemy.enemy_name || enemy.name || ''
        }));

    const quests = (questGenerateState.allQuests.length ? questGenerateState.allQuests : Array.from(questState.quests.values()))
        .filter(q => selectedQuestIds.includes(q.quest_id || q.questId || q.serverId))
        .map(q => ({
            id: q.quest_id || q.questId || q.serverId,
            name: q.quest_name || q.name || ''
        }));

    const items = questGenerateState.rewardItems
        .filter(item => selectedItemIds.includes(item.item_id || item.id))
        .map(item => ({
            id: item.item_id || item.id,
            name: item.item_name || item.name || ''
        }));

    const perks = questGenerateState.rewardPerks
        .filter(perk => selectedPerkIds.includes(perk.perk_id || perk.id))
        .map(perk => ({
            id: perk.perk_id || perk.id,
            name: perk.perk_name || perk.name || ''
        }));

    const payload = {
        system_prompt: conceptSystemPrompt,
        output_struct: schema,
        world_wilds_prompt: conceptWildsPrompt,
        local_context: {
            settlement: settlement
                ? {
                    id: settlement.settlement_id || settlement.id,
                    name: settlement.settlement_name || settlement.name || '',
                    context: settlement.context || '',
                    key_issues: settlement.key_issues || '',
                    recent_events: settlement.recent_events || ''
                }
                : null,
            location: location
                ? {
                    id: location.location_id || location.id || null,
                    name: location.name || '',
                    description: location.description || ''
                }
                : null
        },
        npcs,
        enemies,
        rewards: {
            items,
            perks,
            possible_reward_types: ['silver', 'stat_boost']
        },
        relevant_quests: quests,
        prompt
    };

    console.log('Quest generate payload:', JSON.stringify(payload, null, 2));
}

function toPromptText(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object') {
        if (typeof value.text === 'string') return value.text;
        return JSON.stringify(value, null, 2);
    }
    return String(value);
}

// Export for window
window.questState = questState;
