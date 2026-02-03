// Quest Designer - Visual Option Network Editor
console.log('📦 quest-designer.js LOADED');

// ==================== STATE ====================
const questState = {
    quests: new Map(),      // questId -> quest data
    options: new Map(),     // optionId -> option data
    requirements: [],       // { optionId, requiredOptionId } - option requires requiredOption to be selected first
    selectedQuest: null,
    selectedOption: null,
    nextOptionId: 1,
    canvasOffset: { x: 0, y: 0 },
    zoom: 1,
    isDragging: false,
    lastMouse: { x: 0, y: 0 },
    isConnecting: false,
    connectionStart: null,
    dropdownsPopulated: false,
    // Settlement filter
    selectedSettlementId: null,
    selectedSettlement: null,
    settlements: [],
    // Track which options are from server
    serverOptions: new Map(), // localId -> option_id
    serverRequirements: new Set(), // Set of "optionId-requiredOptionId" keys
    // Track original values for change detection
    originalOptions: new Map(),
    // Quest assets
    questAssets: [],
    questAssetId: null,
    questAssetUrl: null,
    // Quest start slide text
    questStartText: '',
    // Quest name (for new quest mode)
    questName: '',
    isNewQuest: true
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
        
        const canvasRect = canvas.getBoundingClientRect();
        const isOverCanvas = e.clientX >= canvasRect.left && e.clientX <= canvasRect.right &&
                            e.clientY >= canvasRect.top && e.clientY <= canvasRect.bottom;
        
        if (isOverCanvas) {
            e.preventDefault();
            e.stopPropagation();
            onQuestCanvasWheel(e);
        }
    }, { passive: false, capture: true });
    
    // Zoom indicator wheel
    const zoomIndicator = document.getElementById('questZoomIndicator');
    if (zoomIndicator) {
        zoomIndicator.addEventListener('wheel', function(e) {
            e.preventDefault();
            e.stopPropagation();
            const delta = e.deltaY > 0 ? -0.05 : 0.05;
            changeQuestZoom(delta);
        }, { passive: false });
    }
    
    // Populate dropdowns after data loads
    let retryCount = 0;
    const tryPopulateDropdowns = () => {
        populateQuestDropdownsOnce();
        if (!questState.dropdownsPopulated && retryCount < 5) {
            retryCount++;
            setTimeout(tryPopulateDropdowns, 2000);
        }
    };
    setTimeout(tryPopulateDropdowns, 1500);
    
    // Button events
    document.getElementById('addOptionBtn')?.addEventListener('click', addQuestOption);
    document.getElementById('newQuestBtn')?.addEventListener('click', openNewQuestModal);
    
    // Sidebar auto-save setup
    setupSidebarAutoSave();
    
    // Asset upload setup
    setupQuestAssetUpload();
    
    updateQuestCounter();
    
    // Reset view to show start slide on init
    resetQuestView();
    
    console.log('✅ Quest Designer ready');
    
    // Load settlements for dropdown
    loadQuestSettlements();
    loadQuestAssets();
}
window.initQuestDesigner = initQuestDesigner;

// ==================== QUEST ASSETS ====================
async function loadQuestAssets() {
    console.log('🖼️ Loading quest assets from S3...');
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
        populateQuestAssetGallery();
    } catch (error) {
        console.error('Failed to load quest assets:', error);
        questState.questAssets = [];
    }
}

function populateQuestAssetGallery() {
    const gallery = document.getElementById('questAssetGallery');
    if (!gallery) return;
    
    gallery.innerHTML = '';
    
    if (questState.questAssets.length === 0) {
        gallery.innerHTML = '<p style="color:#888;text-align:center;padding:20px;">No assets yet. Upload one above!</p>';
        return;
    }
    
    questState.questAssets.forEach(asset => {
        const div = document.createElement('div');
        div.className = 'quest-asset-item';
        div.dataset.assetId = asset.id;
        div.innerHTML = `<img src="${asset.url}" alt="Quest Asset">`;
        div.addEventListener('click', () => selectQuestAsset(asset.id, asset.url));
        gallery.appendChild(div);
    });
}

function selectQuestAsset(assetId, assetUrl) {
    questState.questAssetId = assetId;
    questState.questAssetUrl = assetUrl;
    
    // Update new start slide body
    const slideBody = document.getElementById('questSlideBody');
    if (slideBody) {
        slideBody.style.backgroundImage = `url(${assetUrl})`;
        slideBody.classList.add('has-image');
    }
    
    document.querySelectorAll('.quest-asset-item').forEach(item => {
        item.classList.toggle('selected', item.dataset.assetId == assetId);
    });
    
    closeQuestAssetModal();
}

function openQuestAssetModal() {
    document.getElementById('questAssetModal').classList.add('open');
}
window.openQuestAssetModal = openQuestAssetModal;

function closeQuestAssetModal() {
    document.getElementById('questAssetModal').classList.remove('open');
}
window.closeQuestAssetModal = closeQuestAssetModal;

function updateQuestStartText(text) {
    questState.questStartText = text;
}
window.updateQuestStartText = updateQuestStartText;

function updateQuestName(name) {
    questState.questName = name;
}
window.updateQuestName = updateQuestName;

function setupQuestAssetUpload() {
    const uploadArea = document.getElementById('questAssetUploadArea');
    const fileInput = document.getElementById('questAssetFileInput');
    
    if (!uploadArea || !fileInput) return;
    
    uploadArea.addEventListener('click', () => fileInput.click());
    
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });
    
    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('dragover');
    });
    
    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file) uploadQuestAsset(file);
    });
    
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) uploadQuestAsset(file);
    });
}

async function uploadQuestAsset(file) {
    if (!file.type.startsWith('image/')) {
        alert('Please select an image file');
        return;
    }
    
    const uploadStatus = document.getElementById('questAssetUploadStatus');
    if (uploadStatus) {
        uploadStatus.textContent = 'Converting to WebP...';
        uploadStatus.style.display = 'block';
        uploadStatus.style.color = '#4ecdc4';
    }
    
    try {
        const webpBlob = await convertQuestImageToWebP(file);
        
        if (uploadStatus) uploadStatus.textContent = 'Uploading...';
        
        const token = await getCurrentAccessToken();
        if (!token) throw new Error('Not authenticated');
        
        const reader = new FileReader();
        const base64Promise = new Promise((resolve, reject) => {
            reader.onload = () => resolve(reader.result);  // Keep full data URL
            reader.onerror = reject;
        });
        reader.readAsDataURL(webpBlob);
        const base64Data = await base64Promise;
        
        const response = await fetch('http://localhost:8080/api/uploadQuestAsset', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                imageData: base64Data,
                filename: file.name.replace(/\.[^/.]+$/, '.webp')
            })
        });
        
        if (!response.ok) throw new Error('Upload failed');
        
        const result = await response.json();
        
        questState.questAssets.push({ id: result.assetId, url: result.url });
        populateQuestAssetGallery();
        selectQuestAsset(result.assetId, result.url);
        
        if (uploadStatus) uploadStatus.textContent = 'Upload complete!';
        setTimeout(() => { if (uploadStatus) uploadStatus.style.display = 'none'; }, 2000);
        
    } catch (error) {
        console.error('Upload failed:', error);
        if (uploadStatus) {
            uploadStatus.textContent = 'Upload failed: ' + error.message;
            uploadStatus.style.color = '#e94560';
        }
    }
}

async function convertQuestImageToWebP(file) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
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

// ==================== ZOOM & PAN ====================
function onQuestCanvasWheel(e) {
    const zoomSpeed = 0.05;
    const delta = e.deltaY > 0 ? -zoomSpeed : zoomSpeed;
    changeQuestZoom(delta);
}

function changeQuestZoom(delta) {
    const newZoom = Math.max(0.1, Math.min(2, questState.zoom + delta));
    questState.zoom = newZoom;
    
    const container = document.getElementById('questOptionsContainer');
    if (container) {
        container.style.transform = `translate(${questState.canvasOffset.x}px, ${questState.canvasOffset.y}px) scale(${questState.zoom})`;
    }
    
    const indicator = document.getElementById('questZoomIndicator');
    if (indicator) {
        indicator.textContent = `${Math.round(questState.zoom * 100)}%`;
    }
    
    renderQuestConnections();
}
window.changeQuestZoom = changeQuestZoom;

function onQuestCanvasMouseDown(e) {
    // Don't start canvas drag if clicking on option nodes or start slide
    if (e.target.closest('.quest-option-node')) return;
    if (e.target.closest('.quest-start-slide')) return;
    if (e.button === 1 || (e.button === 0 && e.target === e.currentTarget)) {
        questState.isDragging = true;
        questState.lastMouse = { x: e.clientX, y: e.clientY };
        e.currentTarget.style.cursor = 'grabbing';
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
        renderQuestConnections();
    }
    
    if (questState.isConnecting) {
        updateQuestConnectionPreview(e);
    }
}

function onQuestCanvasMouseUp(e) {
    if (questState.isDragging) {
        questState.isDragging = false;
        const canvas = document.getElementById('questCanvas');
        if (canvas) canvas.style.cursor = 'grab';
    }
    
    if (questState.isConnecting) {
        const targetNode = e.target.closest('.quest-option-node');
        if (targetNode && targetNode.dataset.optionId) {
            const targetId = parseInt(targetNode.dataset.optionId);
            // Create requirement: target requires the source option
            // Dragging FROM option A TO option B means "B requires A"
            if (targetId !== questState.connectionStart.optionId) {
                createRequirement(targetId, questState.connectionStart.optionId);
            }
        }
        questState.isConnecting = false;
        questState.connectionStart = null;
        const preview = document.getElementById('questConnectionPreview');
        if (preview) preview.style.display = 'none';
    }
}

function panQuestCanvas(dx, dy) {
    questState.canvasOffset.x += dx;
    questState.canvasOffset.y += dy;
    const container = document.getElementById('questOptionsContainer');
    if (container) {
        container.style.transform = `translate(${questState.canvasOffset.x}px, ${questState.canvasOffset.y}px) scale(${questState.zoom})`;
    }
    renderQuestConnections();
}
window.panQuestCanvas = panQuestCanvas;

function resetQuestView() {
    // Reset to show the start slide area (which is at top:100, left:50 in the container)
    // Add some offset to center it nicely in the viewport
    questState.canvasOffset = { x: 50, y: 20 };
    questState.zoom = 1;
    const container = document.getElementById('questOptionsContainer');
    if (container) {
        container.style.transform = `translate(${questState.canvasOffset.x}px, ${questState.canvasOffset.y}px) scale(1)`;
    }
    const indicator = document.getElementById('questZoomIndicator');
    if (indicator) indicator.textContent = '100%';
    renderQuestConnections();
}
window.resetQuestView = resetQuestView;

// ==================== ADD OPTION ====================
function addQuestOption() {
    console.log('➕ addQuestOption called');
    
    // Allow adding options in new quest mode or when a quest is selected
    if (!questState.selectedQuest && !questState.isNewQuest) {
        alert('Please select or create a quest first');
        return;
    }
    
    const canvas = document.getElementById('questCanvas');
    const container = document.getElementById('questOptionsContainer');
    
    if (!canvas || !container) {
        console.error('❌ Canvas or container not found');
        return;
    }
    
    const rect = canvas.getBoundingClientRect();
    const id = questState.nextOptionId++;
    
    // Count existing options for this quest to determine if this is the start
    const questOptions = Array.from(questState.options.values())
        .filter(opt => questState.isNewQuest ? (!opt.questId || opt.questId === 0) : opt.questId === questState.selectedQuest);
    
    const option = {
        id: id,
        questId: questState.isNewQuest ? 0 : questState.selectedQuest, // 0 for new unsaved quest
        nodeText: '',
        optionText: '',
        isStart: questOptions.length === 0,
        x: (rect.width / 2 - questState.canvasOffset.x) / questState.zoom - 140 + (Math.random() - 0.5) * 100,
        y: (rect.height / 2 - questState.canvasOffset.y) / questState.zoom - 100 + (Math.random() - 0.5) * 100,
        // Check requirements
        statType: null,
        statRequired: null,
        effectId: null,
        effectAmount: null,
        enemyId: null,
        // Rewards
        rewardStatType: null,
        rewardStatAmount: null,
        rewardTalent: false,
        rewardItem: null,
        rewardPerk: null,
        rewardBlessing: null,
        rewardPotion: null
    };
    
    questState.options.set(id, option);
    renderQuestOption(option);
    updateQuestCounter();
    selectQuestOption(id);  // Auto-select and show in sidebar
    
    console.log(`✅ Option #${id} created for quest #${questState.selectedQuest}`);
}
window.addQuestOption = addQuestOption;

// ==================== RENDER OPTION ====================
function renderQuestOption(option) {
    const container = document.getElementById('questOptionsContainer');
    if (!container) return;
    
    // Remove if exists
    document.getElementById(`option-${option.id}`)?.remove();
    
    const el = document.createElement('div');
    el.id = `option-${option.id}`;
    el.dataset.optionId = option.id;
    const isNewOption = !questState.serverOptions.has(option.id);
    const isModified = !isNewOption && isOptionModified(option.id);
    const hasCombat = option.enemyId != null;
    
    let nodeClass = 'quest-option-node';
    if (option.isStart) nodeClass += ' start-option';
    if (questState.selectedOption === option.id) nodeClass += ' selected';
    if (isNewOption) nodeClass += ' new-option';
    if (isModified) nodeClass += ' modified-option';
    if (hasCombat) nodeClass += ' combat-option';
    
    el.className = nodeClass;
    el.style.left = `${option.x}px`;
    el.style.top = `${option.y}px`;
    
    // Get icon based on type
    let icon = '💬';
    if (option.isStart) icon = '🟢';
    else if (hasCombat) icon = '⚔️';
    else if (option.statType) icon = '📊';
    else if (option.rewardItem || option.rewardPerk) icon = '🎁';
    
    el.innerHTML = `
        <div class="option-connector option-connector-left" data-option="${option.id}" title="Connection point">●</div>
        <div class="option-node-content">
            <div class="option-node-header">
                <span class="option-icon">${icon}</span>
                <span class="option-title">${option.optionText || 'New Option'}</span>
            </div>
            <div class="option-node-body">
                ${option.nodeText ? `<p>${option.nodeText.substring(0, 200)}${option.nodeText.length > 200 ? '...' : ''}</p>` : '<p class="placeholder">No description</p>'}
            </div>
        </div>
        <div class="option-connector option-connector-right" data-option="${option.id}" title="Drag to connect to another option">●</div>
    `;
    
    container.appendChild(el);
    
    // Click to select and show in sidebar
    el.addEventListener('click', (e) => {
        if (e.target.closest('.option-connector')) return;
        selectQuestOption(option.id);
    });
    
    // Drag node
    el.addEventListener('mousedown', (e) => {
        if (e.target.closest('.option-connector')) return;
        if (e.button !== 0) return;
        e.stopPropagation();
        
        selectQuestOption(option.id);
        
        const startMouseX = e.clientX;
        const startMouseY = e.clientY;
        const startOptionX = option.x;
        const startOptionY = option.y;
        
        const onMove = (ev) => {
            if (questState.isConnecting) return;
            el.classList.add('dragging');
            const deltaX = (ev.clientX - startMouseX) / questState.zoom;
            const deltaY = (ev.clientY - startMouseY) / questState.zoom;
            option.x = startOptionX + deltaX;
            option.y = startOptionY + deltaY;
            el.style.left = `${option.x}px`;
            el.style.top = `${option.y}px`;
            renderQuestConnections();
        };
        
        const onUp = () => {
            el.classList.remove('dragging');
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
        
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
    
    // Connector drag events (both left and right)
    el.querySelectorAll('.option-connector').forEach(conn => {
        conn.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            e.preventDefault();
            startRequirementDrag(parseInt(conn.dataset.option), e);
        });
    });
}

function selectQuestOption(id) {
    questState.selectedOption = id;
    document.querySelectorAll('.quest-option-node').forEach(el => {
        el.classList.toggle('selected', el.id === `option-${id}`);
    });
    updateSidebar();
}

// Debounce helper
let sidebarSaveTimeout = null;
function debouncedSaveOption() {
    clearTimeout(sidebarSaveTimeout);
    showSaveStatus('saving');
    sidebarSaveTimeout = setTimeout(() => {
        saveOptionFromSidebar();
        showSaveStatus('saved');
    }, 500);
}

function showSaveStatus(status) {
    const statusEl = document.getElementById('sidebarSaveStatus');
    if (!statusEl) return;
    
    statusEl.className = 'sidebar-save-status ' + status;
    if (status === 'saving') {
        statusEl.textContent = 'Saving...';
    } else if (status === 'saved') {
        statusEl.textContent = '✓ Saved';
        setTimeout(() => {
            statusEl.textContent = '';
            statusEl.className = 'sidebar-save-status';
        }, 2000);
    } else if (status === 'error') {
        statusEl.textContent = '✗ Error';
    }
}

function setupSidebarAutoSave() {
    // Inputs that trigger auto-save
    const inputIds = [
        'sidebarNodeText', 'sidebarOptionText', 'sidebarIsStart',
        'sidebarStatType', 'sidebarStatRequired', 'sidebarEffectId', 'sidebarEffectAmount', 'sidebarEnemyId',
        'sidebarRewardType', 'sidebarRewardStatType', 'sidebarRewardStatAmount',
        'sidebarRewardItem', 'sidebarRewardPerk', 'sidebarRewardBlessing', 'sidebarRewardPotion',
        'sidebarOptionType'
    ];
    
    inputIds.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        
        const eventType = el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input';
        el.addEventListener(eventType, () => {
            // Handle option type change
            if (id === 'sidebarOptionType') {
                updateOptionTypeFields();
            }
            // Handle reward type change
            if (id === 'sidebarRewardType') {
                updateRewardTypeFields();
            }
            debouncedSaveOption();
        });
    });
}

function updateOptionTypeFields() {
    const optionType = document.getElementById('sidebarOptionType')?.value || 'dialogue';
    
    // Hide all option type field groups
    document.getElementById('optionTypeStatCheck')?.style && (document.getElementById('optionTypeStatCheck').style.display = 'none');
    document.getElementById('optionTypeEffectCheck')?.style && (document.getElementById('optionTypeEffectCheck').style.display = 'none');
    document.getElementById('optionTypeCombat')?.style && (document.getElementById('optionTypeCombat').style.display = 'none');
    
    // Show relevant fields
    switch (optionType) {
        case 'stat_check':
            document.getElementById('optionTypeStatCheck') && (document.getElementById('optionTypeStatCheck').style.display = 'block');
            break;
        case 'effect_check':
            document.getElementById('optionTypeEffectCheck') && (document.getElementById('optionTypeEffectCheck').style.display = 'block');
            break;
        case 'combat':
            document.getElementById('optionTypeCombat') && (document.getElementById('optionTypeCombat').style.display = 'block');
            break;
    }
}

function updateRewardTypeFields() {
    const rewardType = document.getElementById('sidebarRewardType')?.value || '';
    
    // Hide all reward type field groups
    document.getElementById('rewardTypeStat')?.style && (document.getElementById('rewardTypeStat').style.display = 'none');
    document.getElementById('rewardTypeItem')?.style && (document.getElementById('rewardTypeItem').style.display = 'none');
    document.getElementById('rewardTypePotion')?.style && (document.getElementById('rewardTypePotion').style.display = 'none');
    document.getElementById('rewardTypePerk')?.style && (document.getElementById('rewardTypePerk').style.display = 'none');
    document.getElementById('rewardTypeBlessing')?.style && (document.getElementById('rewardTypeBlessing').style.display = 'none');
    
    // Show relevant fields
    switch (rewardType) {
        case 'stat':
            document.getElementById('rewardTypeStat') && (document.getElementById('rewardTypeStat').style.display = 'block');
            break;
        case 'item':
            document.getElementById('rewardTypeItem') && (document.getElementById('rewardTypeItem').style.display = 'block');
            break;
        case 'potion':
            document.getElementById('rewardTypePotion') && (document.getElementById('rewardTypePotion').style.display = 'block');
            break;
        case 'perk':
            document.getElementById('rewardTypePerk') && (document.getElementById('rewardTypePerk').style.display = 'block');
            break;
        case 'blessing':
            document.getElementById('rewardTypeBlessing') && (document.getElementById('rewardTypeBlessing').style.display = 'block');
            break;
        // 'talent' has no additional fields
    }
}

function determineOptionType(option) {
    if (option.enemyId) return 'combat';
    if (option.effectId) return 'effect_check';
    if (option.statType) return 'stat_check';
    // If no requirements and the option is terminal (no shows/hides), it might be an end
    return 'dialogue';
}

function determineRewardType(option) {
    if (option.rewardTalent) return 'talent';
    if (option.rewardItem) return 'item';
    if (option.rewardPotion) return 'potion';
    if (option.rewardPerk) return 'perk';
    if (option.rewardBlessing) return 'blessing';
    if (option.rewardStatType) return 'stat';
    return '';
}

// Select enemy for combat option
function selectQuestEnemy(enemyId) {
    // Update hidden input
    const input = document.getElementById('sidebarEnemyId');
    if (input) input.value = enemyId;
    
    // Update selection visual
    document.querySelectorAll('.quest-enemy-picker-item').forEach(item => {
        item.classList.toggle('selected', item.dataset.enemyId == enemyId);
    });
    
    // Trigger auto-save
    debouncedSaveOption();
}
window.selectQuestEnemy = selectQuestEnemy;

function updateSidebar() {
    const noSelection = document.getElementById('sidebarNoSelection');
    const content = document.getElementById('sidebarContent');
    
    if (!questState.selectedOption) {
        if (noSelection) noSelection.style.display = 'flex';
        if (content) content.style.display = 'none';
        return;
    }
    
    if (noSelection) noSelection.style.display = 'none';
    if (content) content.style.display = 'block';
    
    const option = questState.options.get(questState.selectedOption);
    if (!option) return;
    
    // Populate sidebar fields
    document.getElementById('sidebarOptionId').textContent = `Option ID: ${option.id}`;
    document.getElementById('sidebarNodeText').value = option.nodeText || '';
    document.getElementById('sidebarOptionText').value = option.optionText || '';
    document.getElementById('sidebarIsStart').checked = option.isStart || false;
    
    // Determine and set option type
    const optionType = option.optionType || determineOptionType(option);
    document.getElementById('sidebarOptionType').value = optionType;
    updateOptionTypeFields();
    
    // Option type specific fields
    document.getElementById('sidebarStatType').value = option.statType || '';
    document.getElementById('sidebarStatRequired').value = option.statRequired || '';
    document.getElementById('sidebarEffectId').value = option.effectId || '';
    document.getElementById('sidebarEffectAmount').value = option.effectAmount || '';
    document.getElementById('sidebarEnemyId').value = option.enemyId || '';
    
    // Update enemy picker selection visual
    document.querySelectorAll('.quest-enemy-picker-item').forEach(item => {
        item.classList.toggle('selected', option.enemyId && item.dataset.enemyId == option.enemyId);
    });
    
    // Determine and set reward type
    const rewardType = option.rewardType || determineRewardType(option);
    document.getElementById('sidebarRewardType').value = rewardType;
    updateRewardTypeFields();
    
    // Reward type specific fields
    document.getElementById('sidebarRewardStatType').value = option.rewardStatType || '';
    document.getElementById('sidebarRewardStatAmount').value = option.rewardStatAmount || '';
    document.getElementById('sidebarRewardItem').value = option.rewardItem || '';
    document.getElementById('sidebarRewardPerk').value = option.rewardPerk || '';
    document.getElementById('sidebarRewardBlessing').value = option.rewardBlessing || '';
    document.getElementById('sidebarRewardPotion').value = option.rewardPotion || '';
    
    // Update requirements display
    updateRequirementsDisplay(option.id);
}

function updateRequirementsDisplay(optionId) {
    const requiresDiv = document.getElementById('sidebarRequires');
    const requiredByDiv = document.getElementById('sidebarRequiredBy');
    
    if (!requiresDiv || !requiredByDiv) return;
    
    // Options this option requires (must be selected before this one is visible)
    const requires = questState.requirements.filter(r => r.optionId === optionId);
    // Options that require this option
    const requiredBy = questState.requirements.filter(r => r.requiredOptionId === optionId);
    
    requiresDiv.innerHTML = requires.length > 0 
        ? requires.map(r => {
            const reqOpt = questState.options.get(r.requiredOptionId);
            return `<span class="vis-tag requires" onclick="removeRequirement(${optionId}, ${r.requiredOptionId})">${reqOpt?.optionText || `Option #${r.requiredOptionId}`} ×</span>`;
        }).join('')
        : '<span class="vis-none">None (always visible)</span>';
    
    requiredByDiv.innerHTML = requiredBy.length > 0
        ? requiredBy.map(r => {
            const depOpt = questState.options.get(r.optionId);
            return `<span class="vis-tag required-by">${depOpt?.optionText || `Option #${r.optionId}`}</span>`;
        }).join('')
        : '<span class="vis-none">None</span>';
}

function removeRequirement(optionId, requiredOptionId) {
    questState.requirements = questState.requirements.filter(r => 
        !(r.optionId === optionId && r.requiredOptionId === requiredOptionId)
    );
    renderQuestConnections();
    updateRequirementsDisplay(optionId);
}
window.removeRequirement = removeRequirement;

function saveOptionFromSidebar() {
    const optionId = questState.selectedOption;
    const option = questState.options.get(optionId);
    if (!option) return;
    
    // Get values from sidebar
    option.nodeText = document.getElementById('sidebarNodeText').value || '';
    option.optionText = document.getElementById('sidebarOptionText').value || '';
    option.isStart = document.getElementById('sidebarIsStart').checked;
    
    // Option type
    option.optionType = document.getElementById('sidebarOptionType').value || 'dialogue';
    
    // Clear all type-specific fields first, then set based on type
    option.statType = null;
    option.statRequired = null;
    option.effectId = null;
    option.effectAmount = null;
    option.enemyId = null;
    
    switch (option.optionType) {
        case 'stat_check':
            option.statType = document.getElementById('sidebarStatType').value || null;
            option.statRequired = parseInt(document.getElementById('sidebarStatRequired').value) || null;
            break;
        case 'effect_check':
            option.effectId = parseInt(document.getElementById('sidebarEffectId').value) || null;
            option.effectAmount = parseInt(document.getElementById('sidebarEffectAmount').value) || null;
            break;
        case 'combat':
            option.enemyId = parseInt(document.getElementById('sidebarEnemyId').value) || null;
            break;
    }
    
    // Reward type
    option.rewardType = document.getElementById('sidebarRewardType').value || '';
    
    // Clear all reward fields first
    option.rewardStatType = null;
    option.rewardStatAmount = null;
    option.rewardTalent = false;
    option.rewardItem = null;
    option.rewardPerk = null;
    option.rewardBlessing = null;
    option.rewardPotion = null;
    
    switch (option.rewardType) {
        case 'stat':
            option.rewardStatType = document.getElementById('sidebarRewardStatType').value || null;
            option.rewardStatAmount = parseInt(document.getElementById('sidebarRewardStatAmount').value) || null;
            break;
        case 'talent':
            option.rewardTalent = true;
            break;
        case 'item':
            option.rewardItem = parseInt(document.getElementById('sidebarRewardItem').value) || null;
            break;
        case 'potion':
            option.rewardPotion = parseInt(document.getElementById('sidebarRewardPotion').value) || null;
            break;
        case 'perk':
            option.rewardPerk = parseInt(document.getElementById('sidebarRewardPerk').value) || null;
            break;
        case 'blessing':
            option.rewardBlessing = parseInt(document.getElementById('sidebarRewardBlessing').value) || null;
            break;
    }
    
    renderQuestOption(option);
    console.log('✅ Option updated from sidebar');
}
window.saveOptionFromSidebar = saveOptionFromSidebar;

async function deleteSelectedOption() {
    if (!questState.selectedOption) return;
    
    if (!confirm('Delete this option and all its connections?')) return;
    
    const id = questState.selectedOption;
    const isServerOption = questState.serverOptions.has(id);
    const serverId = isServerOption ? questState.serverOptions.get(id) : null;
    
    if (isServerOption && serverId) {
        try {
            const token = await getCurrentAccessToken();
            if (!token) throw new Error('Not authenticated');
            
            const response = await fetch('http://localhost:8080/api/deleteQuestOption', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ optionId: serverId })
            });
            
            if (!response.ok) throw new Error(await response.text());
            
            questState.serverOptions.delete(id);
            questState.originalOptions.delete(id);
        } catch (error) {
            console.error('Failed to delete option:', error);
            alert(`Failed to delete: ${error.message}`);
            return;
        }
    }
    
    questState.requirements = questState.requirements.filter(r => 
        r.optionId !== id && r.requiredOptionId !== id
    );
    
    questState.options.delete(id);
    document.getElementById(`option-${id}`)?.remove();
    questState.selectedOption = null;
    
    renderQuestConnections();
    updateQuestCounter();
    updateSidebar();
}
window.deleteSelectedOption = deleteSelectedOption;

function isOptionModified(localId) {
    const option = questState.options.get(localId);
    const original = questState.originalOptions.get(localId);
    if (!option || !original) return false;
    
    return option.nodeText !== original.nodeText ||
           option.optionText !== original.optionText ||
           option.isStart !== original.isStart ||
           option.statType !== original.statType ||
           option.statRequired !== original.statRequired ||
           option.effectId !== original.effectId ||
           option.effectAmount !== original.effectAmount ||
           option.enemyId !== original.enemyId ||
           option.rewardStatType !== original.rewardStatType ||
           option.rewardStatAmount !== original.rewardStatAmount ||
           option.rewardTalent !== original.rewardTalent ||
           option.rewardItem !== original.rewardItem ||
           option.rewardPerk !== original.rewardPerk ||
           option.rewardBlessing !== original.rewardBlessing ||
           option.rewardPotion !== original.rewardPotion;
}

// ==================== REQUIREMENT CONNECTIONS ====================
function startRequirementDrag(optionId, e) {
    questState.isConnecting = true;
    questState.connectionStart = { optionId };
    
    document.body.style.cursor = 'crosshair';
    const canvas = document.getElementById('questCanvas');
    if (canvas) canvas.classList.add('connecting');
    
    // Highlight all options as potential targets
    document.querySelectorAll('.quest-option-node').forEach(node => {
        if (node.id !== `option-${optionId}`) {
            node.classList.add('connection-target');
        }
    });
    
    const preview = document.getElementById('questConnectionPreview');
    if (preview) {
        preview.style.display = 'block';
    }
    
    // Track mouse movement on document level
    const onMouseMove = (ev) => {
        updateQuestConnectionPreview(ev);
    };
    
    const onMouseUp = (ev) => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        
        // Check if we dropped on an option node (anywhere on the node, not just connector)
        // First try elementFromPoint
        const target = document.elementFromPoint(ev.clientX, ev.clientY);
        let optionEl = target?.closest('.quest-option-node');
        
        // If not directly on a node, check if we're near any connection-target node (within 25px buffer)
        if (!optionEl) {
            let closestNode = null;
            let closestDist = Infinity;
            const connectionTargets = document.querySelectorAll('.quest-option-node.connection-target');
            connectionTargets.forEach(node => {
                const rect = node.getBoundingClientRect();
                const buffer = 25; // 25px buffer around the node
                // Check if within buffer zone
                if (ev.clientX >= rect.left - buffer && 
                    ev.clientX <= rect.right + buffer &&
                    ev.clientY >= rect.top - buffer && 
                    ev.clientY <= rect.bottom + buffer) {
                    // Calculate distance to center
                    const centerX = rect.left + rect.width / 2;
                    const centerY = rect.top + rect.height / 2;
                    const dist = Math.hypot(ev.clientX - centerX, ev.clientY - centerY);
                    if (dist < closestDist) {
                        closestDist = dist;
                        closestNode = node;
                    }
                }
            });
            optionEl = closestNode;
        }
        
        if (optionEl && questState.connectionStart) {
            const toId = parseInt(optionEl.id.replace('option-', ''));
            if (toId !== questState.connectionStart.optionId) {
                // Create requirement: the target option requires the source option
                createRequirement(toId, questState.connectionStart.optionId);
            }
        }
        
        // Clean up
        cancelConnectionDrag();
    };
    
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    
    // Initial preview
    updateQuestConnectionPreview(e);
}

function cancelConnectionDrag() {
    questState.isConnecting = false;
    questState.connectionStart = null;
    document.body.style.cursor = 'default';
    
    const canvas = document.getElementById('questCanvas');
    if (canvas) canvas.classList.remove('connecting');
    
    const preview = document.getElementById('questConnectionPreview');
    if (preview) preview.style.display = 'none';
    
    // Remove target highlighting
    document.querySelectorAll('.quest-option-node.connection-target').forEach(node => {
        node.classList.remove('connection-target');
    });
}

function updateQuestConnectionPreview(e) {
    const preview = document.getElementById('questConnectionPreview');
    const canvas = document.getElementById('questCanvas');
    if (!preview || !canvas || !questState.connectionStart) return;
    
    const rect = canvas.getBoundingClientRect();
    const optionEl = document.getElementById(`option-${questState.connectionStart.optionId}`);
    if (!optionEl) return;
    
    // Use right connector by default for preview
    const connector = optionEl.querySelector('.option-connector-right') || optionEl.querySelector('.option-connector-left');
    if (!connector) return;
    
    const connRect = connector.getBoundingClientRect();
    const x1 = connRect.left + connRect.width/2 - rect.left;
    const y1 = connRect.top + connRect.height/2 - rect.top;
    const x2 = e.clientX - rect.left;
    const y2 = e.clientY - rect.top;
    
    // Smooth bezier curve
    const curveStrength = 50;
    const cx1 = x1 + curveStrength;
    const cx2 = x2 - curveStrength;
    preview.setAttribute('d', `M ${x1} ${y1} C ${cx1} ${y1}, ${cx2} ${y2}, ${x2} ${y2}`);
}

function createRequirement(optionId, requiredOptionId) {
    // Check if requirement already exists
    const exists = questState.requirements.some(r => 
        r.optionId === optionId && 
        r.requiredOptionId === requiredOptionId
    );
    
    if (exists) {
        console.log('Requirement already exists');
        return;
    }
    
    questState.requirements.push({
        optionId: optionId,
        requiredOptionId: requiredOptionId
    });
    
    renderQuestConnections();
    
    // Update sidebar if either option is selected
    if (questState.selectedOption === optionId) {
        updateRequirementsDisplay(optionId);
    }
    
    console.log(`Created requirement: Option #${optionId} requires Option #${requiredOptionId}`);
}

function renderQuestConnections() {
    const svg = document.getElementById('questConnectionsSvg');
    const canvas = document.getElementById('questCanvas');
    if (!svg || !canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    
    // Remove old paths except preview
    svg.querySelectorAll('path:not(#questConnectionPreview)').forEach(p => p.remove());
    
    // Filter options by current quest or new quest mode
    const optionPassesFilter = (opt) => {
        if (questState.isNewQuest) {
            // In new quest mode, show options without questId
            return !opt.questId || opt.questId === 0;
        }
        if (!questState.selectedQuest) return false;
        return opt.questId === questState.selectedQuest;
    };
    
    // Render requirements as connections
    // Connection goes FROM required option TO dependent option (shows dependency direction)
    questState.requirements.forEach((req, i) => {
        const requiredOption = questState.options.get(req.requiredOptionId);
        const dependentOption = questState.options.get(req.optionId);
        if (!requiredOption || !dependentOption) return;
        
        // Skip if either option is filtered out
        if (!optionPassesFilter(requiredOption) || !optionPassesFilter(dependentOption)) return;
        
        const fromEl = document.getElementById(`option-${req.requiredOptionId}`);
        const toEl = document.getElementById(`option-${req.optionId}`);
        if (!fromEl || !toEl) return;
        
        const toRect = toEl.getBoundingClientRect();
        const fromRect = fromEl.getBoundingClientRect();
        
        // Get centers to determine best side for connectors
        const toCenterX = toRect.left + toRect.width/2 - rect.left;
        const toCenterY = toRect.top + toRect.height/2 - rect.top;
        const fromCenterX = fromRect.left + fromRect.width/2 - rect.left;
        const fromCenterY = fromRect.top + fromRect.height/2 - rect.top;
        
        // Determine which connector to use based on relative position (like expedition)
        const useRightConnector = toCenterX >= fromCenterX;
        
        // Get the appropriate connector from source element
        const fromConnector = fromEl.querySelector(useRightConnector ? '.option-connector-right' : '.option-connector-left');
        // Get the opposite connector on target element
        const toConnector = toEl.querySelector(useRightConnector ? '.option-connector-left' : '.option-connector-right');
        
        if (!fromConnector || !toConnector) return;
        
        const fromConnRect = fromConnector.getBoundingClientRect();
        const toConnRect = toConnector.getBoundingClientRect();
        
        // Start and end points from connector centers
        const x1 = fromConnRect.left + fromConnRect.width/2 - rect.left;
        const y1 = fromConnRect.top + fromConnRect.height/2 - rect.top;
        const x2 = toConnRect.left + toConnRect.width/2 - rect.left;
        const y2 = toConnRect.top + toConnRect.height/2 - rect.top;
        
        // Create smooth bezier curve
        const distance = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
        const curveStrength = Math.min(distance * 0.3, 80);
        
        // Control points extend horizontally from connectors
        const cx1 = useRightConnector ? x1 + curveStrength : x1 - curveStrength;
        const cy1 = y1;
        const cx2 = useRightConnector ? x2 - curveStrength : x2 + curveStrength;
        const cy2 = y2;
        
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`);
        path.classList.add('quest-connection');
        path.dataset.from = req.requiredOptionId;
        path.dataset.to = req.optionId;
        
        // Click to delete requirement
        path.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm(`Delete this requirement? (Option #${req.optionId} requires Option #${req.requiredOptionId})`)) {
                questState.requirements = questState.requirements.filter(r => 
                    !(r.optionId === req.optionId && r.requiredOptionId === req.requiredOptionId)
                );
                renderQuestConnections();
            }
        });
        
        svg.appendChild(path);
    });
}

// ==================== QUEST MANAGEMENT ====================
function openNewQuestModal() {
    document.getElementById('newQuestName').value = '';
    document.getElementById('newQuestModal').classList.add('open');
}
window.openNewQuestModal = openNewQuestModal;

function closeNewQuestModal() {
    document.getElementById('newQuestModal').classList.remove('open');
}
window.closeNewQuestModal = closeNewQuestModal;

async function createNewQuest() {
    const name = document.getElementById('newQuestName').value.trim();
    if (!name) {
        alert('Please enter a quest name');
        return;
    }
    
    try {
        const token = await getCurrentAccessToken();
        if (!token) throw new Error('Not authenticated');
        
        const response = await fetch('http://localhost:8080/api/createQuest', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                questName: name,
                settlementId: questState.selectedSettlementId
            })
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText);
        }
        
        const result = await response.json();
        
        // Add to local state
        questState.quests.set(result.questId, {
            questId: result.questId,
            questchainId: result.questchainId,
            questName: name,
            settlementId: questState.selectedSettlementId
        });
        
        // Select the new quest
        questState.selectedQuest = result.questId;
        populateQuestDropdown();
        document.getElementById('questSelect').value = result.questId;
        
        closeNewQuestModal();
        filterAndRenderQuestOptions();
        
        console.log(`✅ Quest created: ${name} (ID: ${result.questId})`);
    } catch (error) {
        console.error('Failed to create quest:', error);
        alert(`Failed to create quest: ${error.message}`);
    }
}
window.createNewQuest = createNewQuest;

// ==================== OPTION MODAL ====================
let questOptionModalContext = { optionId: null };

function openQuestOptionModal(optionId) {
    questOptionModalContext = { optionId };
    const option = questState.options.get(optionId);
    if (!option) return;
    
    // Populate dropdowns
    populateQuestOptionModalDropdowns();
    
    // Fill form
    document.getElementById('optionStatType').value = option.statType || '';
    document.getElementById('optionStatRequired').value = option.statRequired || '';
    document.getElementById('optionEffectId').value = option.effectId || '';
    document.getElementById('optionEffectAmount').value = option.effectAmount || '';
    document.getElementById('optionEnemyId').value = option.enemyId || '';
    
    document.getElementById('rewardStatType').value = option.rewardStatType || '';
    document.getElementById('rewardStatAmount').value = option.rewardStatAmount || '';
    document.getElementById('rewardTalent').checked = option.rewardTalent || false;
    document.getElementById('rewardItemId').value = option.rewardItem || '';
    document.getElementById('rewardPerkId').value = option.rewardPerk || '';
    document.getElementById('rewardBlessingId').value = option.rewardBlessing || '';
    document.getElementById('rewardPotionId').value = option.rewardPotion || '';
    
    document.getElementById('questOptionModal').classList.add('open');
}
window.openQuestOptionModal = openQuestOptionModal;

function closeQuestOptionModal() {
    document.getElementById('questOptionModal').classList.remove('open');
    questOptionModalContext = { optionId: null };
}
window.closeQuestOptionModal = closeQuestOptionModal;

function saveQuestOptionFromModal() {
    const optionId = questOptionModalContext.optionId;
    const option = questState.options.get(optionId);
    if (!option) return;
    
    // Get values
    const statType = document.getElementById('optionStatType').value || null;
    const statRequired = parseInt(document.getElementById('optionStatRequired').value) || null;
    const effectId = parseInt(document.getElementById('optionEffectId').value) || null;
    const effectAmount = parseInt(document.getElementById('optionEffectAmount').value) || null;
    const enemyId = parseInt(document.getElementById('optionEnemyId').value) || null;
    
    const rewardStatType = document.getElementById('rewardStatType').value || null;
    const rewardStatAmount = parseInt(document.getElementById('rewardStatAmount').value) || null;
    const rewardTalent = document.getElementById('rewardTalent').checked;
    const rewardItem = parseInt(document.getElementById('rewardItemId').value) || null;
    const rewardPerk = parseInt(document.getElementById('rewardPerkId').value) || null;
    const rewardBlessing = parseInt(document.getElementById('rewardBlessingId').value) || null;
    const rewardPotion = parseInt(document.getElementById('rewardPotionId').value) || null;
    
    // Update option
    option.statType = statType;
    option.statRequired = statRequired;
    option.effectId = effectId;
    option.effectAmount = effectAmount;
    option.enemyId = enemyId;
    option.rewardStatType = rewardStatType;
    option.rewardStatAmount = rewardStatAmount;
    option.rewardTalent = rewardTalent;
    option.rewardItem = rewardItem;
    option.rewardPerk = rewardPerk;
    option.rewardBlessing = rewardBlessing;
    option.rewardPotion = rewardPotion;
    
    renderQuestOption(option);
    closeQuestOptionModal();
}
window.saveQuestOptionFromModal = saveQuestOptionFromModal;

function populateQuestOptionModalDropdowns() {
    // Populate enemy dropdown
    const enemySelect = document.getElementById('optionEnemyId');
    if (enemySelect && enemySelect.options.length <= 1) {
        // Get enemies from GlobalData or similar
        if (typeof GlobalData !== 'undefined' && GlobalData.enemies) {
            GlobalData.enemies.forEach(enemy => {
                const opt = document.createElement('option');
                opt.value = enemy.id;
                opt.textContent = `#${enemy.id} - ${enemy.name || 'Unnamed'}`;
                enemySelect.appendChild(opt);
            });
        }
    }
    
    // Populate items
    const items = typeof getItems === 'function' ? getItems() : (GlobalData?.items || []);
    const itemSelect = document.getElementById('rewardItemId');
    if (itemSelect && itemSelect.options.length <= 1) {
        items.forEach(item => {
            const opt = document.createElement('option');
            opt.value = item.id;
            opt.textContent = `#${item.id} - ${item.name || 'Unnamed'}`;
            itemSelect.appendChild(opt);
        });
    }
    
    // Populate potions (items where type = 'potion')
    const potionSelect = document.getElementById('rewardPotionId');
    if (potionSelect && potionSelect.options.length <= 1) {
        items.filter(i => i.type === 'potion').forEach(item => {
            const opt = document.createElement('option');
            opt.value = item.id;
            opt.textContent = `#${item.id} - ${item.name || 'Unnamed'}`;
            potionSelect.appendChild(opt);
        });
    }
    
    // Populate perks
    const perks = typeof getPerks === 'function' ? getPerks() : (GlobalData?.perks || []);
    const perkSelect = document.getElementById('rewardPerkId');
    if (perkSelect && perkSelect.options.length <= 1) {
        perks.filter(p => !p.is_blessing).forEach(perk => {
            const opt = document.createElement('option');
            opt.value = perk.id;
            opt.textContent = `#${perk.id} - ${perk.name || 'Unnamed'}`;
            perkSelect.appendChild(opt);
        });
    }
    
    // Populate blessings
    const blessingSelect = document.getElementById('rewardBlessingId');
    if (blessingSelect && blessingSelect.options.length <= 1) {
        perks.filter(p => p.is_blessing).forEach(perk => {
            const opt = document.createElement('option');
            opt.value = perk.id;
            opt.textContent = `#${perk.id} - ${perk.name || 'Unnamed'}`;
            blessingSelect.appendChild(opt);
        });
    }
    
    // Populate effects
    const effects = typeof getEffects === 'function' ? getEffects() : (GlobalData?.effects || []);
    const effectSelect = document.getElementById('optionEffectId');
    if (effectSelect && effectSelect.options.length <= 1) {
        effects.forEach(effect => {
            const opt = document.createElement('option');
            opt.value = effect.id || effect.effect_id;
            opt.textContent = `#${effect.id || effect.effect_id} - ${effect.name || effect.effect_name || 'Effect'}`;
            effectSelect.appendChild(opt);
        });
    }
}

// ==================== SETTLEMENTS & QUESTS ====================
async function loadQuestSettlements() {
    console.log('🏘️ Loading settlements for quest designer...');
    
    if (typeof loadSettlementsData !== 'function') {
        console.error('❌ loadSettlementsData function not found!');
        return;
    }
    
    try {
        await loadSettlementsData();
        questState.settlements = GlobalData.settlements || [];
        populateQuestSettlementDropdown();
        console.log(`✅ Using ${questState.settlements.length} settlements from GlobalData`);
    } catch (error) {
        console.error('Failed to load settlements:', error);
    }
}

function populateQuestSettlementDropdown() {
    const select = document.getElementById('questSettlementSelect');
    if (!select) return;
    
    select.innerHTML = '';
    
    questState.settlements.forEach(settlement => {
        const option = document.createElement('option');
        option.value = settlement.settlement_id;
        option.textContent = settlement.settlement_name || `Settlement #${settlement.settlement_id}`;
        select.appendChild(option);
    });
    
    // Auto-select first settlement
    if (questState.settlements.length > 0) {
        const firstSettlement = questState.settlements[0];
        select.value = firstSettlement.settlement_id;
        questState.selectedSettlementId = firstSettlement.settlement_id;
        questState.selectedSettlement = firstSettlement.settlement_id;
        // Load quests for this settlement
        loadQuestsForSettlement(firstSettlement.settlement_id);
    }
}

function onQuestSettlementChange() {
    const select = document.getElementById('questSettlementSelect');
    if (!select) return;
    
    const value = select.value;
    questState.selectedSettlementId = value ? parseInt(value) : null;
    questState.selectedSettlement = questState.selectedSettlementId;
    
    console.log(`🏘️ Quest settlement filter changed to: ${questState.selectedSettlementId}`);
    
    // Load quests for this settlement
    loadQuestsForSettlement(questState.selectedSettlementId);
}
window.onQuestSettlementChange = onQuestSettlementChange;

async function loadQuestsForSettlement(settlementId) {
    console.log(`📥 Loading quests for settlement: ${settlementId}`);
    
    try {
        const token = await getCurrentAccessToken();
        if (!token) throw new Error('Not authenticated');
        
        let url = 'http://localhost:8080/api/getQuests';
        if (settlementId) {
            url += `?settlementId=${settlementId}`;
        }
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (!response.ok) throw new Error('Failed to fetch quests');
        
        const data = await response.json();
        
        // Clear state
        questState.quests.clear();
        questState.options.clear();
        questState.requirements = [];
        questState.serverOptions.clear();
        questState.serverRequirements.clear();
        questState.originalOptions.clear();
        
        // Process quests
        if (data.quests) {
            data.quests.forEach(q => {
                questState.quests.set(q.quest_id, {
                    questId: q.quest_id,
                    questchainId: q.questchain_id,
                    questName: q.quest_name,
                    requisiteQuest: q.requisite_quest,
                    ending: q.ending,
                    defaultEntry: q.default_entry,
                    settlementId: q.settlement_id,
                    assetId: q.asset_id
                });
            });
        }
        
        // Process options
        let maxOptionId = 0;
        if (data.options) {
            data.options.forEach((opt, idx) => {
                const localId = idx + 1;
                maxOptionId = Math.max(maxOptionId, localId);
                
                questState.options.set(localId, {
                    id: localId,
                    questId: opt.quest_id,
                    nodeText: opt.node_text || '',
                    optionText: opt.option_text || '',
                    isStart: opt.start || false,
                    x: opt.x || 100 + (idx % 4) * 320,
                    y: opt.y || 100 + Math.floor(idx / 4) * 250,
                    statType: opt.stat_type,
                    statRequired: opt.stat_required,
                    effectId: opt.effect_id,
                    effectAmount: opt.effect_amount,
                    enemyId: opt.enemy_id,
                    rewardStatType: opt.reward_stat_type,
                    rewardStatAmount: opt.reward_stat_amount,
                    rewardTalent: opt.reward_talent,
                    rewardItem: opt.reward_item,
                    rewardPerk: opt.reward_perk,
                    rewardBlessing: opt.reward_blessing,
                    rewardPotion: opt.reward_potion
                });
                
                questState.serverOptions.set(localId, opt.option_id);
                questState.originalOptions.set(localId, {
                    nodeText: opt.node_text || '',
                    optionText: opt.option_text || '',
                    isStart: opt.start || false,
                    statType: opt.stat_type,
                    statRequired: opt.stat_required,
                    effectId: opt.effect_id,
                    effectAmount: opt.effect_amount,
                    enemyId: opt.enemy_id,
                    rewardStatType: opt.reward_stat_type,
                    rewardStatAmount: opt.reward_stat_amount,
                    rewardTalent: opt.reward_talent,
                    rewardItem: opt.reward_item,
                    rewardPerk: opt.reward_perk,
                    rewardBlessing: opt.reward_blessing,
                    rewardPotion: opt.reward_potion
                });
            });
        }
        questState.nextOptionId = maxOptionId + 1;
        
        // Process requirements
        if (data.requirements) {
            // Need to map server option_id to local id
            const serverToLocal = new Map();
            questState.serverOptions.forEach((serverId, localId) => {
                serverToLocal.set(serverId, localId);
            });
            
            data.requirements.forEach(r => {
                // Support both camelCase and snake_case from server
                const optionServer = r.optionId || r.option_id;
                const requiredServer = r.requiredOptionId || r.required_option_id;
                
                const optionLocal = serverToLocal.get(optionServer);
                const requiredLocal = serverToLocal.get(requiredServer);
                if (optionLocal && requiredLocal) {
                    questState.requirements.push({
                        optionId: optionLocal,
                        requiredOptionId: requiredLocal
                    });
                    questState.serverRequirements.add(`${optionServer}-${requiredServer}`);
                }
            });
        }
        
        populateQuestDropdown();
        
        // Don't auto-select any quest - start with empty view
        questState.selectedQuest = null;
        filterAndRenderQuestOptions();
        
        console.log(`✅ Loaded ${questState.quests.size} quests, ${questState.options.size} options`);
    } catch (error) {
        console.error('Failed to load quests:', error);
    }
}

function populateQuestDropdown() {
    const select = document.getElementById('questSelect');
    if (!select) return;
    
    // New Quest as default selected option (like settlements)
    select.innerHTML = '<option value="">-- New Quest --</option>';
    
    questState.quests.forEach(quest => {
        const option = document.createElement('option');
        option.value = quest.questId;
        option.textContent = quest.questName || `Quest #${quest.questId}`;
        select.appendChild(option);
    });
}

function onQuestChange() {
    const select = document.getElementById('questSelect');
    if (!select) return;
    
    const value = select.value;
    const nameInput = document.getElementById('questNameInput');
    const questStartText = document.getElementById('questStartText');
    
    // If no value (New Quest mode), set up for new quest creation
    if (!value) {
        questState.selectedQuest = null;
        questState.isNewQuest = true;
        questState.questName = '';
        questState.questStartText = '';
        
        // Clear the start slide
        questState.questAssetId = null;
        questState.questAssetUrl = null;
        const slideBody = document.getElementById('questSlideBody');
        if (slideBody) {
            slideBody.style.backgroundImage = '';
            slideBody.classList.remove('has-image');
        }
        
        // Clear inputs
        if (nameInput) nameInput.value = '';
        if (questStartText) questStartText.value = '';
        
        filterAndRenderQuestOptions();
        return;
    }
    
    questState.selectedQuest = parseInt(value);
    questState.isNewQuest = false;
    
    console.log(`📜 Quest changed to: ${questState.selectedQuest}`);
    
    // Load quest data including name and asset
    const quest = questState.quests.get(questState.selectedQuest);
    if (quest) {
        // Load quest name
        questState.questName = quest.questName || '';
        if (nameInput) nameInput.value = questState.questName;
        
        // Load quest asset
        if (quest.assetId) {
            // Find the asset URL from loaded assets
            const asset = questState.questAssets.find(a => a.id === quest.assetId);
            if (asset) {
                selectQuestAsset(asset.id, asset.url);
            } else {
                clearQuestAsset();
            }
        } else {
            clearQuestAsset();
        }
    } else {
        clearQuestAsset();
        if (nameInput) nameInput.value = '';
    }
    
    filterAndRenderQuestOptions();
}
window.onQuestChange = onQuestChange;

function clearQuestAsset() {
    questState.questAssetId = null;
    questState.questAssetUrl = null;
    const slideBody = document.getElementById('questSlideBody');
    if (slideBody) {
        slideBody.style.backgroundImage = '';
        slideBody.classList.remove('has-image');
    }
}

function filterAndRenderQuestOptions() {
    const container = document.getElementById('questOptionsContainer');
    if (!container) return;
    
    // Remove only option nodes, preserve the start slide
    container.querySelectorAll('.quest-option-node').forEach(node => node.remove());
    
    questState.options.forEach(option => {
        let matchesFilter = false;
        if (questState.isNewQuest) {
            // In new quest mode, only show options that belong to this new quest (no questId yet)
            matchesFilter = !option.questId || option.questId === 0;
        } else if (questState.selectedQuest) {
            matchesFilter = option.questId === questState.selectedQuest;
        }
        if (matchesFilter) {
            renderQuestOption(option);
        }
    });
    
    renderQuestConnections();
    updateQuestCounter();
    
    // Reset view to show start slide
    resetQuestView();
}

function updateQuestCounter() {
    const counter = document.getElementById('questOptionCounter');
    if (!counter) return;
    
    const total = questState.options.size;
    let filtered = total;
    
    if (questState.selectedQuest) {
        filtered = Array.from(questState.options.values())
            .filter(opt => opt.questId === questState.selectedQuest).length;
        counter.textContent = `${filtered}/${total} options`;
    } else {
        counter.textContent = `${total} options`;
    }
}

function populateQuestDropdownsOnce() {
    // Populate sidebar dropdowns
    populateSidebarDropdowns();
    questState.dropdownsPopulated = true;
}

function populateSidebarDropdowns() {
    // Enemies - populate grid picker like expedition designer
    const enemyGrid = document.getElementById('questEnemyPickerGrid');
    if (enemyGrid && enemyGrid.children.length === 0) {
        let enemies = [];
        if (typeof allEnemies !== 'undefined' && allEnemies.length > 0) {
            enemies = allEnemies; // From enemy-designer-new.js
        } else if (typeof getEnemies === 'function') {
            enemies = getEnemies();
        } else if (typeof GlobalData !== 'undefined' && GlobalData.enemies) {
            enemies = GlobalData.enemies;
        }
        
        console.log('Populating quest enemy grid with', enemies.length, 'enemies');
        
        if (enemies.length === 0) {
            enemyGrid.innerHTML = '<p style="color:#888;text-align:center;grid-column:1/-1;font-size:0.75rem;">No enemies loaded</p>';
        } else {
            enemies.forEach(enemy => {
                const iconUrl = enemy.icon || `https://gamedata-assets.s3.eu-north-1.amazonaws.com/images/enemies/${enemy.assetId}.webp`;
                const item = document.createElement('div');
                item.className = 'quest-enemy-picker-item';
                item.dataset.enemyId = enemy.enemyId || enemy.id;
                item.innerHTML = `
                    <img src="${iconUrl}" alt="${enemy.enemyName || enemy.name}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2280%22>👹</text></svg>'">
                    <span>${enemy.enemyName || enemy.name || 'Enemy #' + (enemy.enemyId || enemy.id)}</span>
                `;
                item.addEventListener('click', () => selectQuestEnemy(enemy.enemyId || enemy.id));
                enemyGrid.appendChild(item);
            });
        }
    }
    
    // Items (excluding potions)
    const items = typeof getItems === 'function' ? getItems() : (GlobalData?.items || []);
    const itemSelect = document.getElementById('sidebarRewardItem');
    if (itemSelect && itemSelect.options.length <= 1) {
        items.filter(i => i.type !== 'potion').forEach(item => {
            const opt = document.createElement('option');
            opt.value = item.id;
            opt.textContent = `${item.name || 'Item #' + item.id}`;
            itemSelect.appendChild(opt);
        });
    }
    
    // Potions
    const potionSelect = document.getElementById('sidebarRewardPotion');
    if (potionSelect && potionSelect.options.length <= 1) {
        items.filter(i => i.type === 'potion').forEach(item => {
            const opt = document.createElement('option');
            opt.value = item.id;
            opt.textContent = `${item.name || 'Potion #' + item.id}`;
            potionSelect.appendChild(opt);
        });
    }
    
    // Perks (not blessings)
    const perks = typeof getPerks === 'function' ? getPerks() : (GlobalData?.perks || []);
    const perkSelect = document.getElementById('sidebarRewardPerk');
    if (perkSelect && perkSelect.options.length <= 1) {
        perks.filter(p => !p.is_blessing).forEach(perk => {
            const opt = document.createElement('option');
            opt.value = perk.id;
            opt.textContent = `${perk.name || 'Perk #' + perk.id}`;
            perkSelect.appendChild(opt);
        });
    }
    
    // Blessings
    const blessingSelect = document.getElementById('sidebarRewardBlessing');
    if (blessingSelect && blessingSelect.options.length <= 1) {
        perks.filter(p => p.is_blessing).forEach(perk => {
            const opt = document.createElement('option');
            opt.value = perk.id;
            opt.textContent = `${perk.name || 'Blessing #' + perk.id}`;
            blessingSelect.appendChild(opt);
        });
    }
    
    // Effects
    const effects = typeof getEffects === 'function' ? getEffects() : (GlobalData?.effects || []);
    const effectSelect = document.getElementById('sidebarEffectId');
    if (effectSelect && effectSelect.options.length <= 1) {
        effects.forEach(effect => {
            const opt = document.createElement('option');
            opt.value = effect.id || effect.effect_id;
            opt.textContent = `${effect.name || effect.effect_name || 'Effect #' + (effect.id || effect.effect_id)}`;
            effectSelect.appendChild(opt);
        });
    }
}

// ==================== SAVE ====================
async function saveQuest() {
    // For new quest, we need a name
    if (questState.isNewQuest) {
        if (!questState.questName || !questState.questName.trim()) {
            alert('Please enter a quest name');
            return;
        }
    } else if (!questState.selectedQuest) {
        alert('Please select a quest first');
        return;
    }
    
    const saveBtn = document.getElementById('saveQuestBtn');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = '⏳ Saving...';
    }
    
    try {
        const token = await getCurrentAccessToken();
        if (!token) throw new Error('Not authenticated');
        
        // Collect options for the selected quest
        const newOptions = [];
        const optionUpdates = [];
        
        questState.options.forEach((option, localId) => {
            // For new quest mode, include options with questId 0 or null
            // For existing quest, include only options for that quest
            const belongsToQuest = questState.isNewQuest 
                ? (!option.questId || option.questId === 0)
                : (option.questId === questState.selectedQuest);
            
            if (!belongsToQuest) return;
            
            const isServerOption = questState.serverOptions.has(localId);
            
            if (!isServerOption) {
                newOptions.push({
                    localId: localId,
                    questId: option.questId,
                    nodeText: option.nodeText || '',
                    optionText: option.optionText || '',
                    isStart: option.isStart || false,
                    x: option.x,
                    y: option.y,
                    statType: option.statType,
                    statRequired: option.statRequired,
                    effectId: option.effectId,
                    effectAmount: option.effectAmount,
                    enemyId: option.enemyId,
                    rewardStatType: option.rewardStatType,
                    rewardStatAmount: option.rewardStatAmount,
                    rewardTalent: option.rewardTalent,
                    rewardItem: option.rewardItem,
                    rewardPerk: option.rewardPerk,
                    rewardBlessing: option.rewardBlessing,
                    rewardPotion: option.rewardPotion
                });
            } else if (isOptionModified(localId)) {
                optionUpdates.push({
                    optionId: questState.serverOptions.get(localId),
                    localId: localId,
                    nodeText: option.nodeText || '',
                    optionText: option.optionText || '',
                    isStart: option.isStart || false,
                    x: option.x,
                    y: option.y,
                    statType: option.statType,
                    statRequired: option.statRequired,
                    effectId: option.effectId,
                    effectAmount: option.effectAmount,
                    enemyId: option.enemyId,
                    rewardStatType: option.rewardStatType,
                    rewardStatAmount: option.rewardStatAmount,
                    rewardTalent: option.rewardTalent,
                    rewardItem: option.rewardItem,
                    rewardPerk: option.rewardPerk,
                    rewardBlessing: option.rewardBlessing,
                    rewardPotion: option.rewardPotion
                });
            }
        });
        
        // Collect new requirements - include both server-side and pending local requirements
        const newRequirements = [];
        const pendingRequirements = []; // Requirements involving at least one unsaved local option
        
        console.log('Collecting requirements. Total requirements:', questState.requirements.length);
        console.log('isNewQuest:', questState.isNewQuest, 'selectedQuest:', questState.selectedQuest);
        
        questState.requirements.forEach(r => {
            const option = questState.options.get(r.optionId);
            const requiredOption = questState.options.get(r.requiredOptionId);
            
            console.log('Processing requirement:', r, 'option:', option, 'requiredOption:', requiredOption);
            
            if (!option || !requiredOption) {
                console.log('Skipping - missing option data');
                return;
            }
            
            // For new quest mode, include options that belong to this new quest (no questId or questId=0)
            // For existing quest, include options that belong to selected quest
            const optionBelongs = questState.isNewQuest 
                ? (!option.questId || option.questId === 0)
                : (option.questId === questState.selectedQuest);
            
            console.log('Option belongs:', optionBelongs, 'option.questId:', option.questId);
            
            if (!optionBelongs) {
                console.log('Skipping - option does not belong to current quest');
                return;
            }
            
            const optionServerId = questState.serverOptions.get(r.optionId);
            const requiredServerId = questState.serverOptions.get(r.requiredOptionId);
            
            console.log('Server IDs - option:', optionServerId, 'required:', requiredServerId);
            
            // If both have server IDs, add to newRequirements
            if (optionServerId && requiredServerId) {
                const key = `${optionServerId}-${requiredServerId}`;
                if (!questState.serverRequirements.has(key)) {
                    console.log('Adding to newRequirements');
                    newRequirements.push({
                        optionId: optionServerId,
                        requiredOptionId: requiredServerId
                    });
                }
            } else {
                // At least one is a new unsaved option - store for server-side resolution
                console.log('Adding to pendingRequirements');
                pendingRequirements.push({
                    localOptionId: r.optionId,
                    localRequiredOptionId: r.requiredOptionId,
                    // Also pass known server IDs so backend can use them
                    optionServerId: optionServerId || 0,
                    requiredServerId: requiredServerId || 0
                });
            }
        });
        
        console.log('Final - newOptions:', newOptions.length, 'pendingRequirements:', pendingRequirements.length, 'newRequirements:', newRequirements.length);
        console.log('pendingRequirements data:', JSON.stringify(pendingRequirements));
        console.log('newOptions data:', JSON.stringify(newOptions.map(o => ({ localId: o.localId, questId: o.questId }))));
        
        const savePayload = {
            questId: questState.selectedQuest,
            questName: questState.questName,
            assetId: questState.questAssetId,
            isNewQuest: questState.isNewQuest,
            settlementId: questState.selectedSettlement,
            newOptions: newOptions,
            optionUpdates: optionUpdates,
            newRequirements: newRequirements,
            pendingRequirements: pendingRequirements
        };
        console.log('Save payload:', JSON.stringify(savePayload, null, 2));
        
        const response = await fetch('http://localhost:8080/api/saveQuest', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(savePayload)
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText);
        }
        
        const result = await response.json();
        
        if (result.success) {
            // If new quest was created, update state
            if (questState.isNewQuest && result.questId) {
                questState.selectedQuest = result.questId;
                questState.isNewQuest = false;
                
                // Add quest to state
                questState.quests.set(result.questId, {
                    questId: result.questId,
                    questName: questState.questName,
                    assetId: questState.questAssetId,
                    settlementId: questState.selectedSettlement
                });
                
                // Update dropdown
                populateQuestDropdown();
                const select = document.getElementById('questSelect');
                if (select) select.value = result.questId;
                
                // Update all options to have the new quest ID
                questState.options.forEach((option, localId) => {
                    if (!option.questId || option.questId === 0) {
                        option.questId = result.questId;
                    }
                });
            }
            
            // Update server tracking for new options
            if (result.optionMapping) {
                for (const [localIdStr, serverId] of Object.entries(result.optionMapping)) {
                    const localId = parseInt(localIdStr);
                    questState.serverOptions.set(localId, serverId);
                    
                    const option = questState.options.get(localId);
                    if (option) {
                        questState.originalOptions.set(localId, {
                            nodeText: option.nodeText || '',
                            optionText: option.optionText || '',
                            isStart: option.isStart || false,
                            statType: option.statType,
                            statRequired: option.statRequired,
                            effectId: option.effectId,
                            effectAmount: option.effectAmount,
                            enemyId: option.enemyId,
                            rewardStatType: option.rewardStatType,
                            rewardStatAmount: option.rewardStatAmount,
                            rewardTalent: option.rewardTalent,
                            rewardItem: option.rewardItem,
                            rewardPerk: option.rewardPerk,
                            rewardBlessing: option.rewardBlessing,
                            rewardPotion: option.rewardPotion
                        });
                    }
                }
            }
            
            // Update original values for modified options
            optionUpdates.forEach(upd => {
                const option = questState.options.get(upd.localId);
                if (option) {
                    questState.originalOptions.set(upd.localId, {
                        nodeText: option.nodeText || '',
                        optionText: option.optionText || '',
                        isStart: option.isStart || false,
                        statType: option.statType,
                        statRequired: option.statRequired,
                        effectId: option.effectId,
                        effectAmount: option.effectAmount,
                        enemyId: option.enemyId,
                        rewardStatType: option.rewardStatType,
                        rewardStatAmount: option.rewardStatAmount,
                        rewardTalent: option.rewardTalent,
                        rewardItem: option.rewardItem,
                        rewardPerk: option.rewardPerk,
                        rewardBlessing: option.rewardBlessing,
                        rewardPotion: option.rewardPotion
                    });
                }
            });
            
            // Track new requirements
            newRequirements.forEach(r => {
                const key = `${r.optionId}-${r.requiredOptionId}`;
                questState.serverRequirements.add(key);
            });
            
            // Re-render to update visual state
            filterAndRenderQuestOptions();
            
            alert(`✅ Quest saved successfully!`);
        } else {
            throw new Error(result.message || 'Unknown error');
        }
    } catch (error) {
        console.error('Failed to save quest:', error);
        alert(`❌ Failed to save quest: ${error.message}`);
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = '💾 Save';
        }
    }
}
window.saveQuest = saveQuest;

// Export
window.initQuestDesigner = initQuestDesigner;
