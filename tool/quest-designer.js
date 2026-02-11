// Quest Designer - Visual Quest & Option Network Editor
console.log('📦 quest-designer.js LOADED');

// ==================== STATE ====================
const questState = {
    // Quests (slides with asset, name, text, travelText, failureText, sortOrder for tree depth)
    quests: new Map(),       // questId -> { questId, name, text, travelText, failureText, assetId, assetUrl, x, y, sortOrder }
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
        
        const panel = document.getElementById('questGenerateOverlay');
        if (panel && panel.style.display === 'flex') {
            return;
        }

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
        travelText: '',
        failureText: '',
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

    const noSelection = document.getElementById('sidebarNoSelection');
    const optionContent = document.getElementById('sidebarContent');
    const questContent = document.getElementById('sidebarQuestContent');
    if (noSelection) noSelection.style.display = 'flex';
    if (optionContent) optionContent.style.display = 'none';
    if (questContent) questContent.style.display = 'none';
    
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

    updateQuestSidebar(id);
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
    const questContent = document.getElementById('sidebarQuestContent');
    
    if (!option) {
        if (noSelection) noSelection.style.display = 'flex';
        if (content) content.style.display = 'none';
        if (questContent) questContent.style.display = 'none';
        return;
    }
    
    if (noSelection) noSelection.style.display = 'none';
    if (content) content.style.display = 'block';
    if (questContent) questContent.style.display = 'none';
    
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
    if (statRequired) statRequired.value = option.statRequired ?? '';
    
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

    const rewardSilver = document.getElementById('sidebarRewardSilver');
    if (rewardSilver) rewardSilver.value = reward.amount || '';
    
    const rewardItem = document.getElementById('sidebarRewardItem');
    if (rewardItem) rewardItem.value = reward.itemId || '';
    
    const rewardPotion = document.getElementById('sidebarRewardPotion');
    if (rewardPotion) rewardPotion.value = reward.potionId || '';
    
    const rewardPerk = document.getElementById('sidebarRewardPerk');
    if (rewardPerk) rewardPerk.value = reward.perkId || '';
    
    const rewardBlessing = document.getElementById('sidebarRewardBlessing');
    if (rewardBlessing) rewardBlessing.value = reward.blessingId || '';
}

function updateQuestSidebar(questId) {
    const quest = questState.quests.get(questId);
    const noSelection = document.getElementById('sidebarNoSelection');
    const optionContent = document.getElementById('sidebarContent');
    const questContent = document.getElementById('sidebarQuestContent');

    if (!quest) {
        if (noSelection) noSelection.style.display = 'flex';
        if (optionContent) optionContent.style.display = 'none';
        if (questContent) questContent.style.display = 'none';
        return;
    }

    if (noSelection) noSelection.style.display = 'none';
    if (optionContent) optionContent.style.display = 'none';
    if (questContent) questContent.style.display = 'block';

    const questIdSpan = document.getElementById('sidebarQuestId');
    if (questIdSpan) questIdSpan.textContent = `Quest ID: ${quest.serverId || quest.questId}`;

    const travelInput = document.getElementById('sidebarTravelText');
    if (travelInput) travelInput.value = quest.travelText || '';

    const failureInput = document.getElementById('sidebarFailureText');
    if (failureInput) failureInput.value = quest.failureText || '';
}

function updateSidebarTypeFields(type) {
    // Hide all type-specific sections
    document.getElementById('optionTypeStatCheck')?.style && (document.getElementById('optionTypeStatCheck').style.display = 'none');
    document.getElementById('optionTypeEffectCheck')?.style && (document.getElementById('optionTypeEffectCheck').style.display = 'none');
    document.getElementById('optionTypeCombat')?.style && (document.getElementById('optionTypeCombat').style.display = 'none');
    document.getElementById('optionTypeFaction')?.style && (document.getElementById('optionTypeFaction').style.display = 'none');

    const optionEffectSection = document.getElementById('optionEffectSection');
    if (optionEffectSection) {
        optionEffectSection.style.display = type === 'combat' ? 'none' : 'block';
    }
    
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
    document.getElementById('rewardTypeSilver')?.style && (document.getElementById('rewardTypeSilver').style.display = 'none');
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
        case 'silver':
            const silverSection = document.getElementById('rewardTypeSilver');
            if (silverSection) silverSection.style.display = 'block';
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

        console.log('Loaded quest data (raw):', data);
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
        questState.quests.clear();
        questState.options.clear();
        questState.serverQuests.clear();
        questState.serverOptions.clear();
        questState.connections = [];
        questState.selectedQuest = null;
        questState.selectedOption = null;
        const container = document.getElementById('questOptionsContainer');
        if (container) container.innerHTML = '';
        questRenderConnections();
        updateCounter();

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
                travelText: q.travel_text || '',
                failureText: q.failure_text || '',
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
                questEnd: !!o.quest_end,
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

        // Log a valid template based on existing data
        if (chainQuests.length > 0 && chainOptions.length > 0) {
            const q = chainQuests[0];
            const o = chainOptions[0];
            const r = chainRequirements[0] || { optionId: o.option_id, requiredOptionId: o.option_id };
            const template = {
                chains: [
                    {
                        name: q.questchain_name || '',
                        context: q.questchain_context || '',
                        questchain_id: q.questchain_id,
                        settlement_id: q.settlement_id || null
                    }
                ],
                quests: [
                    {
                        pos_x: q.pos_x || 0,
                        pos_y: q.pos_y || 0,
                        ending: q.ending ?? null,
                        asset_id: q.asset_id ?? null,
                        quest_id: q.quest_id,
                        quest_name: q.quest_name || '',
                        sort_order: q.sort_order || 0,
                        start_text: q.start_text || '',
                        travel_text: q.travel_text || '',
                        failure_text: q.failure_text || '',
                        default_entry: q.default_entry ?? null,
                        questchain_id: q.questchain_id,
                        settlement_id: q.settlement_id || null,
                        requisite_option_id: q.requisite_option_id ?? null
                    }
                ],
                options: [
                    {
                        pos_x: o.pos_x || o.x || 0,
                        pos_y: o.pos_y || o.y || 0,
                        start: o.start ?? null,
                        enemy_id: o.enemy_id ?? null,
                        quest_id: o.quest_id,
                        effect_id: o.effect_id ?? null,
                        node_text: o.node_text || '',
                        option_id: o.option_id,
                        quest_end: o.quest_end ?? false,
                        stat_type: o.stat_type ?? null,
                        stat_required: o.stat_required ?? null,
                        option_text: o.option_text || '',
                        reward_item: o.reward_item ?? null,
                        reward_perk: o.reward_perk ?? null,
                        reward_potion: o.reward_potion ?? null,
                        reward_blessing: o.reward_blessing ?? null,
                        reward_talent: o.reward_talent ?? null,
                        reward_stat_type: o.reward_stat_type ?? null,
                        reward_stat_amount: o.reward_stat_amount ?? null,
                        reward_silver: o.reward_silver ?? null,
                        effect_amount: o.effect_amount ?? null,
                        faction_required: o.faction_required ?? null,
                        option_effect_id: o.option_effect_id ?? null,
                        option_effect_factor: o.option_effect_factor ?? null
                    }
                ],
                requirements: [
                    {
                        optionId: r.optionId,
                        requiredOptionId: r.requiredOptionId
                    }
                ]
            };
            console.log('Valid quest template (from existing data):', template);
        }
        
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
    if (o.quest_end) return 'end';
    if (o.faction_required) return 'faction';
    if (o.enemy_id) return 'combat';
    if (o.effect_id && o.effect_amount) return 'effect_check';
    if (o.stat_type || (o.stat_required !== null && o.stat_required !== undefined)) return 'stat_check';
    return 'dialogue';
}

// Extract reward object from option data
function extractReward(o) {
    if (o.reward_stat_type && o.reward_stat_amount) {
        return { type: 'stat', statType: o.reward_stat_type, amount: o.reward_stat_amount };
    }
    if (o.reward_silver) {
        return { type: 'silver', amount: o.reward_silver };
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
                if (option.type === 'stat_check' && !option.statType) {
                    const statTypeSelect = document.getElementById('sidebarStatType');
                    option.statType = statTypeSelect?.value || 'strength';
                }
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
            if (option) {
                const value = e.target.value;
                option.statRequired = value === '' ? null : parseInt(value, 10);
            }
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

    // Reward silver amount
    const rewardSilver = document.getElementById('sidebarRewardSilver');
    if (rewardSilver) {
        rewardSilver.addEventListener('input', (e) => {
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

    // Quest travel text
    const travelText = document.getElementById('sidebarTravelText');
    if (travelText) {
        travelText.addEventListener('input', (e) => {
            if (!questState.selectedQuest) return;
            const quest = questState.quests.get(questState.selectedQuest);
            if (quest) quest.travelText = e.target.value;
        });
    }

    // Quest failure text
    const failureText = document.getElementById('sidebarFailureText');
    if (failureText) {
        failureText.addEventListener('input', (e) => {
            if (!questState.selectedQuest) return;
            const quest = questState.quests.get(questState.selectedQuest);
            if (quest) quest.failureText = e.target.value;
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
                    travelText: quest.travelText || '',
                    failureText: quest.failureText || '',
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
                    travelText: quest.travelText || '',
                    failureText: quest.failureText || '',
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
                questEnd: option.type === 'end' ? true : null,
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
                rewardSilver: option.reward?.type === 'silver' ? option.reward.amount : null,
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
    rewardPotions: [],
    rewardBlessings: [],
};

function setupQuestGeneratePanel() {
    document.getElementById('questGenerateBtn')?.addEventListener('click', toggleQuestGeneratePanel);
    document.getElementById('questGenerateClose')?.addEventListener('click', toggleQuestGeneratePanel);
    document.getElementById('questGenerateRun')?.addEventListener('click', generateQuestPreview);
    document.getElementById('questGenerateLocationFilter')?.addEventListener('input', (e) => {
        populateQuestGenerateLocations(e.target.value);
    });
    document.getElementById('questGenerateNpcFilter')?.addEventListener('input', (e) => {
        populateQuestGenerateNpcs(e.target.value);
    });
    document.getElementById('questGenerateEnemyFilter')?.addEventListener('input', (e) => {
        populateQuestGenerateEnemies(e.target.value);
    });
    document.getElementById('questGenerateItemRewardFilter')?.addEventListener('input', (e) => {
        populateQuestGenerateRewardItems(e.target.value);
    });
    document.getElementById('questGeneratePerkRewardFilter')?.addEventListener('input', (e) => {
        populateQuestGenerateRewardPerks(e.target.value);
    });
    document.getElementById('questGeneratePotionRewardFilter')?.addEventListener('input', (e) => {
        populateQuestGenerateRewardPotions(e.target.value);
    });
    document.getElementById('questGenerateBlessingRewardFilter')?.addEventListener('input', (e) => {
        populateQuestGenerateRewardBlessings(e.target.value);
    });
    document.getElementById('questGenerateQuestFilter')?.addEventListener('input', (e) => {
        populateQuestGenerateQuests(e.target.value);
    });
}

function toggleQuestGeneratePanel() {
    const overlay = document.getElementById('questGenerateOverlay');
    if (!overlay) return;
    const isOpen = overlay.style.display === 'flex';
    overlay.style.display = isOpen ? 'none' : 'flex';
    if (!isOpen) {
        populateQuestGeneratePanel();
    }
}

function setQuestGenerateLoading(isLoading, message = 'Generating...') {
    const status = document.getElementById('questGenerateStatus');
    const statusText = status?.querySelector('.generate-status-text');
    const runBtn = document.getElementById('questGenerateRun');
    const closeBtn = document.getElementById('questGenerateClose');
    if (status) {
        status.style.display = isLoading ? 'flex' : 'none';
    }
    if (statusText) statusText.textContent = message;
    if (runBtn) runBtn.disabled = isLoading;
    if (closeBtn) closeBtn.disabled = isLoading;
}

async function populateQuestGeneratePanel() {
    if ((!GlobalData?.settlements || GlobalData.settlements.length === 0) && typeof loadSettlementsData === 'function') {
        await loadSettlementsData();
    }
    populateQuestGenerateLocations(document.getElementById('questGenerateLocationFilter')?.value || '');
    await loadQuestGenerateNpcs();
    await loadQuestGenerateAllQuests();
    populateQuestGenerateNpcs();
    populateQuestGenerateEnemies(document.getElementById('questGenerateEnemyFilter')?.value || '');
    populateQuestGenerateRewards();
    populateQuestGenerateQuests();
}

function populateQuestGenerateLocations(filterText = '') {
    const select = document.getElementById('questGenerateLocation');
    if (!select) return;
    const settlements = GlobalData?.settlements || [];
    select.innerHTML = '<option value="">-- Any Location --</option>';
    const search = filterText.trim().toLowerCase();
    settlements.forEach(settlement => {
        (settlement.locations || []).forEach(loc => {
            const name = loc.name || '';
            if (search && !name.toLowerCase().includes(search)) return;
            const opt = document.createElement('option');
            opt.value = loc.location_id || loc.id || '';
            opt.textContent = name || `Location ${opt.value}`;
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

function populateQuestGenerateEnemies(filterText = '') {
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
    const search = filterText.trim().toLowerCase();
    enemies
        .filter(enemy => {
            if (!search) return true;
            const name = (enemy.enemyName || enemy.enemy_name || enemy.name || '').toLowerCase();
            return name.includes(search);
        })
        .forEach(enemy => {
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
    const potions = items.filter(item => item.type === 'potion');
    const blessings = perks.filter(perk => perk.is_blessing);
    questGenerateState.rewardItems = items;
    questGenerateState.rewardPerks = perks;
    questGenerateState.rewardPotions = potions;
    questGenerateState.rewardBlessings = blessings;

    populateQuestGenerateRewardItems('');
    populateQuestGenerateRewardPerks('');
    populateQuestGenerateRewardPotions('');
    populateQuestGenerateRewardBlessings('');
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

function populateQuestGenerateRewardPotions(filterText = '') {
    const select = document.getElementById('questGenerateRewardPotions');
    if (!select) return;
    select.innerHTML = '';
    const search = filterText.trim().toLowerCase();
    questGenerateState.rewardPotions
        .filter(item => {
            if (!search) return true;
            const name = (item.item_name || item.name || '').toLowerCase();
            return name.includes(search);
        })
        .forEach(item => {
            const id = item.item_id || item.id;
            const name = item.item_name || item.name || `Potion ${id}`;
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = name;
            select.appendChild(opt);
        });
}

function populateQuestGenerateRewardBlessings(filterText = '') {
    const select = document.getElementById('questGenerateRewardBlessings');
    if (!select) return;
    select.innerHTML = '';
    const search = filterText.trim().toLowerCase();
    questGenerateState.rewardBlessings
        .filter(perk => {
            if (!search) return true;
            const name = (perk.perk_name || perk.name || '').toLowerCase();
            return name.includes(search);
        })
        .forEach(perk => {
            const id = perk.perk_id || perk.id;
            const name = perk.perk_name || perk.name || `Blessing ${id}`;
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
    const locationId = document.getElementById('questGenerateLocation')?.value || '';
    const prompt = document.getElementById('questGeneratePrompt')?.value || '';
    const selectedNpcIds = collectMultiSelectValues('questGenerateNpcs').map(id => parseInt(id, 10));
    const selectedEnemyIds = collectMultiSelectValues('questGenerateEnemies').map(id => parseInt(id, 10));
    const selectedQuestIds = collectMultiSelectValues('questGenerateQuests').map(id => parseInt(id, 10));
    const selectedItemIds = collectMultiSelectValues('questGenerateRewardItems').map(id => parseInt(id, 10));
    const selectedPerkIds = collectMultiSelectValues('questGenerateRewardPerks').map(id => parseInt(id, 10));
    const selectedPotionIds = collectMultiSelectValues('questGenerateRewardPotions').map(id => parseInt(id, 10));
    const selectedBlessingIds = collectMultiSelectValues('questGenerateRewardBlessings').map(id => parseInt(id, 10));
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
    let settlement = null;
    let location = null;
    if (locationId) {
        settlements.some(s => {
            const found = (s.locations || []).find(loc => String(loc.location_id || loc.id) === String(locationId));
            if (found) {
                location = found;
                settlement = s;
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
            personality: Array.isArray(npc.personality) ? npc.personality : (npc.personality ? [npc.personality] : []),
            goals: Array.isArray(npc.goals) ? npc.goals : (npc.goals ? [npc.goals] : [])
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

    const potions = questGenerateState.rewardPotions
        .filter(item => selectedPotionIds.includes(item.item_id || item.id))
        .map(item => ({
            id: item.item_id || item.id,
            name: item.item_name || item.name || ''
        }));

    const blessings = questGenerateState.rewardBlessings
        .filter(perk => selectedBlessingIds.includes(perk.perk_id || perk.id))
        .map(perk => ({
            id: perk.perk_id || perk.id,
            name: perk.perk_name || perk.name || ''
        }));

    const settlementPayload = settlement
        ? {
            id: settlement.settlement_id || settlement.id,
            name: settlement.settlement_name || settlement.name || '',
            context: settlement.context || '',
            key_issues: Array.isArray(settlement.key_issues) ? settlement.key_issues : (settlement.key_issues ? [settlement.key_issues] : []),
            recent_events: Array.isArray(settlement.recent_events) ? settlement.recent_events : (settlement.recent_events ? [settlement.recent_events] : [])
        }
        : null;

    const userContent = {
        output_struct: schema,
        world_wilds_prompt: conceptWildsPrompt,
        local_context: {
            settlement: settlementPayload,
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
            possible_item_rewards: items,
            possible_perk_rewards: perks,
            possible_potion_rewards: potions,
            possible_blessing_rewards: blessings,
            possible_stat_rewards: ['strength', 'stamina', 'agility', 'luck', 'armor'],
            reward_silver: true,
            reward_talent: true
        },
        relevant_quests: quests,
        prompt
    };

    const payload = {
        model: 'o3',
        response_format: { type: 'json_object' },
        messages: [
            {
                role: 'system',
                content: conceptSystemPrompt
            },
            {
                role: 'user',
                content: JSON.stringify(userContent)
            }
        ]
    };

    console.log('Quest generate payload:', JSON.stringify(payload, null, 2));
    console.log('Valid quest JSON template:', JSON.stringify(getValidQuestJsonTemplate(), null, 2));

    try {
        setQuestGenerateLoading(true, 'Generating quest...');
        const token = await getCurrentAccessToken();
        if (!token) {
            alert('Not authenticated');
            setQuestGenerateLoading(false);
            return;
        }

        const response = await fetch('http://localhost:8080/api/generateQuestAi', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        console.log('Quest generate response:', data);

        let content = data?.choices?.[0]?.message?.content;
        if (!content && Array.isArray(data?.output)) {
            const message = data.output.find(item => item.type === 'message');
            const outputText = message?.content?.find(part => part.type === 'output_text');
            content = outputText?.text || '';
        }
        if (content) {
            try {
                const parsed = JSON.parse(content);
                console.log('Quest generate JSON:', parsed);
                applyGeneratedQuest(parsed);
                toggleQuestGeneratePanel();
            } catch (err) {
                console.warn('Failed to parse quest JSON:', err, content);
                setQuestGenerateLoading(false, 'Failed to parse response.');
                return;
            }
        }
    } catch (error) {
        console.error('Quest generate failed:', error);
        alert(`❌ Quest generation failed: ${error.message || error}`);
        setQuestGenerateLoading(false, 'Generation failed.');
        return;
    }

    setQuestGenerateLoading(false);
}

function getValidQuestJsonTemplate() {
    return {
        chains: [
            {
                name: '',
                context: '',
                questchain_id: 1,
                settlement_id: 1
            }
        ],
        quests: [
            {
                pos_x: 0,
                pos_y: 0,
                ending: null,
                asset_id: null,
                quest_id: 1,
                quest_name: '',
                sort_order: 0,
                start_text: '',
                travel_text: '',
                failure_text: '',
                default_entry: null,
                questchain_id: 1,
                settlement_id: 1,
                requisite_option_id: null
            }
        ],
        options: [
            {
                pos_x: 0,
                pos_y: 0,
                start: null,
                enemy_id: null,
                quest_id: 1,
                effect_id: null,
                node_text: '',
                option_id: 1,
                quest_end: false,
                stat_type: null,
                stat_required: null,
                option_text: '',
                reward_item: null,
                reward_perk: null,
                reward_potion: null,
                reward_blessing: null,
                reward_talent: null,
                reward_stat_type: null,
                reward_stat_amount: null,
                reward_silver: null,
                effect_amount: null,
                faction_required: null,
                option_effect_id: null,
                option_effect_factor: null
            }
        ],
        requirements: [
            {
                optionId: 1,
                requiredOptionId: 2
            }
        ]
    };
}

function normalizeGeneratedOptions(options = []) {
    return options.map(opt => ({
        option_id: opt.option_id ?? opt.optionId ?? null,
        quest_id: opt.quest_id ?? opt.questId ?? null,
        option_text: opt.option_text ?? opt.optionText ?? '',
        node_text: opt.node_text ?? opt.nodeText ?? '',
        quest_end: opt.quest_end ?? opt.questEnd ?? false,
        start: opt.start ?? null,
        stat_type: opt.stat_type ?? opt.statType ?? null,
        stat_required: opt.stat_required ?? opt.statRequired ?? null,
        effect_id: opt.effect_id ?? opt.effectId ?? null,
        effect_amount: opt.effect_amount ?? opt.effectAmount ?? null,
        option_effect_id: opt.option_effect_id ?? opt.optionEffectId ?? null,
        option_effect_factor: opt.option_effect_factor ?? opt.optionEffectFactor ?? null,
        faction_required: opt.faction_required ?? opt.factionRequired ?? null,
        enemy_id: opt.enemy_id ?? opt.enemyId ?? null,
        reward_item: opt.reward_item ?? opt.rewardItem ?? null,
        reward_perk: opt.reward_perk ?? opt.rewardPerk ?? null,
        reward_potion: opt.reward_potion ?? opt.rewardPotion ?? null,
        reward_blessing: opt.reward_blessing ?? opt.rewardBlessing ?? null,
        reward_talent: opt.reward_talent ?? opt.rewardTalent ?? null,
        reward_stat_type: opt.reward_stat_type ?? opt.rewardStatType ?? null,
        reward_stat_amount: opt.reward_stat_amount ?? opt.rewardStatAmount ?? null,
        reward_silver: opt.reward_silver ?? opt.rewardSilver ?? null,
        x: opt.x ?? opt.pos_x ?? 0,
        y: opt.y ?? opt.pos_y ?? 0
    }));
}

function applyGeneratedQuest(data) {
    if (!data || !Array.isArray(data.quests) || data.quests.length === 0) {
        console.warn('Generated quest missing quests array');
        return;
    }

    const questRaw = data.quests[0];
    const localQuestId = questState.nextQuestId++;

    const quest = {
        questId: localQuestId,
        serverId: null,
        name: questRaw.quest_name || questRaw.questName || `Quest ${localQuestId}`,
        text: questRaw.start_text || questRaw.startText || '',
        travelText: questRaw.travel_text || questRaw.travelText || '',
        failureText: questRaw.failure_text || questRaw.failureText || '',
        assetId: questRaw.asset_id || questRaw.assetId || null,
        assetUrl: questRaw.asset_id ? `https://gamedata-assets.s3.eu-north-1.amazonaws.com/images/quests/${questRaw.asset_id}.webp` : null,
        sortOrder: questRaw.sort_order || questRaw.sortOrder || 0,
        x: questRaw.pos_x ?? questRaw.x ?? 50,
        y: questRaw.pos_y ?? questRaw.y ?? 100,
        requisiteOptionId: null
    };

    questState.quests.set(localQuestId, quest);

    const optionMapping = new Map();
    const normalizedOptions = normalizeGeneratedOptions(data.options || []);

    normalizedOptions.forEach((opt, index) => {
        const localOptionId = questState.nextOptionId++;
        optionMapping.set(opt.option_id ?? index, localOptionId);

        const option = {
            optionId: localOptionId,
            serverId: null,
            questId: localQuestId,
            optionText: opt.option_text || 'Option',
            nodeText: opt.node_text || '',
            x: opt.x || 0,
            y: opt.y || 0,
            isStart: opt.start === true || false,
            type: determineOptionType(opt),
            questEnd: !!opt.quest_end,
            statType: opt.stat_type,
            statRequired: opt.stat_required,
            effectId: opt.effect_id,
            effectAmount: opt.effect_amount,
            optionEffectId: opt.option_effect_id,
            optionEffectFactor: opt.option_effect_factor,
            factionRequired: opt.faction_required,
            enemyId: opt.enemy_id,
            reward: extractReward(opt)
        };

        questState.options.set(localOptionId, option);
    });

    // If no start option provided, mark first option as start
    const hasStart = Array.from(questState.options.values()).some(opt => opt.questId === localQuestId && opt.isStart);
    if (!hasStart) {
        const first = Array.from(questState.options.values()).find(opt => opt.questId === localQuestId);
        if (first) first.isStart = true;
    }

    // Add connections
    normalizedOptions.forEach((opt, index) => {
        const localOptionId = optionMapping.get(opt.option_id ?? index);
        if (localOptionId && (opt.start === true || (!hasStart && index === 0))) {
            questState.connections.push({
                fromType: 'quest',
                fromId: localQuestId,
                toType: 'option',
                toId: localOptionId
            });
        }
    });

    (data.requirements || []).forEach(req => {
        const toId = optionMapping.get(req.optionId ?? req.option_id ?? req.optionID);
        const fromId = optionMapping.get(req.requiredOptionId ?? req.required_option_id ?? req.requiredOptionID);
        if (fromId && toId) {
            questState.connections.push({
                fromType: 'option',
                fromId,
                toType: 'option',
                toId
            });
        }
    });

    // Render new items
    renderQuest(quest);
    questState.options.forEach(option => {
        if (option.questId === localQuestId) renderOption(option);
    });
    questRenderConnections();
    updateCounter();
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
