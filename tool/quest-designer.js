// Quest Designer - Visual Option Network Editor
console.log('📦 quest-designer.js LOADED');

// ==================== STATE ====================
const questState = {
    quests: new Map(),      // questId -> quest data
    options: new Map(),     // optionId -> option data
    visibility: [],         // { optionId, effectType, targetOptionId }
    selectedQuest: null,
    selectedOption: null,
    nextOptionId: 1,
    canvasOffset: { x: 0, y: 0 },
    zoom: 1,
    isDragging: false,
    lastMouse: { x: 0, y: 0 },
    isConnecting: false,
    connectionStart: null,
    connectionType: 'show',  // 'show' or 'hide'
    dropdownsPopulated: false,
    // Settlement filter
    selectedSettlementId: null,
    settlements: [],
    // Track which options are from server
    serverOptions: new Map(), // localId -> option_id
    serverVisibility: new Set(), // Set of "optionId-effectType-targetOptionId" keys
    // Track original values for change detection
    originalOptions: new Map(),
    // Quest assets
    questAssets: [],
    questAssetId: null,
    questAssetUrl: null,
    // Quest start slide text
    questStartText: ''
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
    
    // Sidebar save button
    document.getElementById('sidebarSaveOption')?.addEventListener('click', saveOptionFromSidebar);
    
    // Asset upload setup
    setupQuestAssetUpload();
    
    updateQuestCounter();
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
    if (e.target.closest('.quest-option-node')) return;
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
            if (targetId !== questState.connectionStart.optionId) {
                createVisibilityConnection(questState.connectionStart.optionId, questState.connectionType, targetId);
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
    questState.canvasOffset = { x: 0, y: 0 };
    questState.zoom = 1;
    const container = document.getElementById('questOptionsContainer');
    if (container) {
        container.style.transform = `translate(0px, 0px) scale(1)`;
    }
    const indicator = document.getElementById('questZoomIndicator');
    if (indicator) indicator.textContent = '100%';
    renderQuestConnections();
}
window.resetQuestView = resetQuestView;

// ==================== ADD OPTION ====================
function addQuestOption() {
    console.log('➕ addQuestOption called');
    
    if (!questState.selectedQuest) {
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
        .filter(opt => opt.questId === questState.selectedQuest);
    
    const option = {
        id: id,
        questId: questState.selectedQuest,
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
        <div class="option-node-header">
            <span class="option-icon">${icon}</span>
            <span class="option-title">${option.optionText || 'New Option'}</span>
        </div>
        <div class="option-node-body">
            ${option.nodeText ? `<p>${option.nodeText.substring(0, 60)}${option.nodeText.length > 60 ? '...' : ''}</p>` : '<p class="placeholder">No description</p>'}
        </div>
        <div class="option-connectors">
            <div class="connector connector-show" data-option="${option.id}" data-type="show" title="Drag to reveal another option">
                <span>👁️</span>
            </div>
            <div class="connector connector-hide" data-option="${option.id}" data-type="hide" title="Drag to hide another option">
                <span>🚫</span>
            </div>
        </div>
    `;
    
    container.appendChild(el);
    
    // Click to select and show in sidebar
    el.addEventListener('click', (e) => {
        if (e.target.closest('.connector')) return;
        selectQuestOption(option.id);
    });
    
    // Drag node
    el.addEventListener('mousedown', (e) => {
        if (e.target.closest('.connector')) return;
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
    
    // Connector drag events
    el.querySelectorAll('.connector').forEach(conn => {
        conn.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            e.preventDefault();
            startVisibilityDrag(parseInt(conn.dataset.option), conn.dataset.type, e);
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
    
    // Requirements
    document.getElementById('sidebarStatType').value = option.statType || '';
    document.getElementById('sidebarStatRequired').value = option.statRequired || '';
    document.getElementById('sidebarEffectId').value = option.effectId || '';
    document.getElementById('sidebarEffectAmount').value = option.effectAmount || '';
    document.getElementById('sidebarEnemyId').value = option.enemyId || '';
    
    // Rewards
    document.getElementById('sidebarRewardStatType').value = option.rewardStatType || '';
    document.getElementById('sidebarRewardStatAmount').value = option.rewardStatAmount || '';
    document.getElementById('sidebarRewardTalent').checked = option.rewardTalent || false;
    document.getElementById('sidebarRewardItem').value = option.rewardItem || '';
    document.getElementById('sidebarRewardPerk').value = option.rewardPerk || '';
    document.getElementById('sidebarRewardBlessing').value = option.rewardBlessing || '';
    document.getElementById('sidebarRewardPotion').value = option.rewardPotion || '';
    
    // Update visibility rules display
    updateVisibilityRulesDisplay(option.id);
}

function updateVisibilityRulesDisplay(optionId) {
    const revealsDiv = document.getElementById('sidebarReveals');
    const hidesDiv = document.getElementById('sidebarHides');
    
    if (!revealsDiv || !hidesDiv) return;
    
    const reveals = questState.visibility.filter(v => v.optionId === optionId && v.effectType === 'show');
    const hides = questState.visibility.filter(v => v.optionId === optionId && v.effectType === 'hide');
    
    revealsDiv.innerHTML = reveals.length > 0 
        ? reveals.map(v => {
            const targetOpt = questState.options.get(v.targetOptionId);
            return `<span class="vis-tag show" onclick="removeVisibility(${optionId}, 'show', ${v.targetOptionId})">${targetOpt?.optionText || `Option #${v.targetOptionId}`} ×</span>`;
        }).join('')
        : '<span class="vis-none">None</span>';
    
    hidesDiv.innerHTML = hides.length > 0
        ? hides.map(v => {
            const targetOpt = questState.options.get(v.targetOptionId);
            return `<span class="vis-tag hide" onclick="removeVisibility(${optionId}, 'hide', ${v.targetOptionId})">${targetOpt?.optionText || `Option #${v.targetOptionId}`} ×</span>`;
        }).join('')
        : '<span class="vis-none">None</span>';
}

function removeVisibility(optionId, effectType, targetOptionId) {
    questState.visibility = questState.visibility.filter(v => 
        !(v.optionId === optionId && v.effectType === effectType && v.targetOptionId === targetOptionId)
    );
    renderQuestConnections();
    updateVisibilityRulesDisplay(optionId);
}
window.removeVisibility = removeVisibility;

function saveOptionFromSidebar() {
    const optionId = questState.selectedOption;
    const option = questState.options.get(optionId);
    if (!option) return;
    
    // Get values from sidebar
    option.nodeText = document.getElementById('sidebarNodeText').value || '';
    option.optionText = document.getElementById('sidebarOptionText').value || '';
    option.isStart = document.getElementById('sidebarIsStart').checked;
    
    option.statType = document.getElementById('sidebarStatType').value || null;
    option.statRequired = parseInt(document.getElementById('sidebarStatRequired').value) || null;
    option.effectId = parseInt(document.getElementById('sidebarEffectId').value) || null;
    option.effectAmount = parseInt(document.getElementById('sidebarEffectAmount').value) || null;
    option.enemyId = parseInt(document.getElementById('sidebarEnemyId').value) || null;
    
    option.rewardStatType = document.getElementById('sidebarRewardStatType').value || null;
    option.rewardStatAmount = parseInt(document.getElementById('sidebarRewardStatAmount').value) || null;
    option.rewardTalent = document.getElementById('sidebarRewardTalent').checked;
    option.rewardItem = parseInt(document.getElementById('sidebarRewardItem').value) || null;
    option.rewardPerk = parseInt(document.getElementById('sidebarRewardPerk').value) || null;
    option.rewardBlessing = parseInt(document.getElementById('sidebarRewardBlessing').value) || null;
    option.rewardPotion = parseInt(document.getElementById('sidebarRewardPotion').value) || null;
    
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
    
    questState.visibility = questState.visibility.filter(v => 
        v.optionId !== id && v.targetOptionId !== id
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

// ==================== VISIBILITY CONNECTIONS ====================
function startVisibilityDrag(optionId, type, e) {
    questState.isConnecting = true;
    questState.connectionStart = { optionId, type };
    questState.connectionType = type;
    
    const preview = document.getElementById('questConnectionPreview');
    if (preview) {
        preview.style.display = 'block';
        preview.classList.remove('show-connection', 'hide-connection');
        preview.classList.add(type === 'show' ? 'show-connection' : 'hide-connection');
    }
    
    updateQuestConnectionPreview(e);
}

function updateQuestConnectionPreview(e) {
    const preview = document.getElementById('questConnectionPreview');
    const canvas = document.getElementById('questCanvas');
    if (!preview || !canvas || !questState.connectionStart) return;
    
    const rect = canvas.getBoundingClientRect();
    const optionEl = document.getElementById(`option-${questState.connectionStart.optionId}`);
    if (!optionEl) return;
    
    const connectorClass = questState.connectionType === 'show' ? '.connector-show' : '.connector-hide';
    const connector = optionEl.querySelector(connectorClass);
    if (!connector) return;
    
    const connRect = connector.getBoundingClientRect();
    const x1 = connRect.left + connRect.width/2 - rect.left;
    const y1 = connRect.top + connRect.height/2 - rect.top;
    const x2 = e.clientX - rect.left;
    const y2 = e.clientY - rect.top;
    
    const curveX = x1 + 50;
    preview.setAttribute('d', `M ${x1} ${y1} Q ${curveX} ${y1}, ${x2} ${y2}`);
}

function createVisibilityConnection(fromOptionId, effectType, targetOptionId) {
    // Check if connection already exists
    const exists = questState.visibility.some(v => 
        v.optionId === fromOptionId && 
        v.effectType === effectType && 
        v.targetOptionId === targetOptionId
    );
    
    if (exists) {
        console.log('Connection already exists');
        return;
    }
    
    questState.visibility.push({
        optionId: fromOptionId,
        effectType: effectType,
        targetOptionId: targetOptionId
    });
    
    renderQuestConnections();
    
    // Update sidebar if the source option is selected
    if (questState.selectedOption === fromOptionId) {
        updateVisibilityRulesDisplay(fromOptionId);
    }
    
    console.log(`Created ${effectType} connection: ${fromOptionId} -> ${targetOptionId}`);
}

function renderQuestConnections() {
    const svg = document.getElementById('questConnectionsSvg');
    const canvas = document.getElementById('questCanvas');
    if (!svg || !canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    
    // Remove old paths except preview
    svg.querySelectorAll('path:not(#questConnectionPreview)').forEach(p => p.remove());
    
    const zoom = questState.zoom;
    const offsetX = questState.canvasOffset.x;
    const offsetY = questState.canvasOffset.y;
    
    // Filter options by current quest
    const optionPassesFilter = (opt) => {
        if (!questState.selectedQuest) return true;
        return opt.questId === questState.selectedQuest;
    };
    
    questState.visibility.forEach((conn, i) => {
        const fromOption = questState.options.get(conn.optionId);
        const toOption = questState.options.get(conn.targetOptionId);
        if (!fromOption || !toOption) return;
        
        // Skip if either option is filtered out
        if (!optionPassesFilter(fromOption) || !optionPassesFilter(toOption)) return;
        
        const fromEl = document.getElementById(`option-${conn.optionId}`);
        const toEl = document.getElementById(`option-${conn.targetOptionId}`);
        if (!fromEl || !toEl) return;
        
        const connectorClass = conn.effectType === 'show' ? '.connector-show' : '.connector-hide';
        const connector = fromEl.querySelector(connectorClass);
        if (!connector) return;
        
        const connRect = connector.getBoundingClientRect();
        const toRect = toEl.getBoundingClientRect();
        
        const x1 = connRect.left + connRect.width/2 - rect.left;
        const y1 = connRect.top + connRect.height/2 - rect.top;
        const x2 = toRect.left + toRect.width/2 - rect.left;
        const y2 = toRect.top + toRect.height/2 - rect.top;
        
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const curveX = x1 + 80;
        path.setAttribute('d', `M ${x1} ${y1} Q ${curveX} ${y1}, ${x2} ${y2}`);
        path.classList.add('quest-connection', conn.effectType === 'show' ? 'show-connection' : 'hide-connection');
        path.dataset.from = conn.optionId;
        path.dataset.to = conn.targetOptionId;
        path.dataset.type = conn.effectType;
        
        // Add arrow marker
        path.setAttribute('marker-end', conn.effectType === 'show' ? 'url(#arrowShow)' : 'url(#arrowHide)');
        
        // Click to delete connection
        path.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm(`Delete this ${conn.effectType} connection?`)) {
                questState.visibility = questState.visibility.filter(v => 
                    !(v.optionId === conn.optionId && v.effectType === conn.effectType && v.targetOptionId === conn.targetOptionId)
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
        // Load quests for this settlement
        loadQuestsForSettlement(firstSettlement.settlement_id);
    }
}

function onQuestSettlementChange() {
    const select = document.getElementById('questSettlementSelect');
    if (!select) return;
    
    const value = select.value;
    questState.selectedSettlementId = value ? parseInt(value) : null;
    
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
        questState.visibility = [];
        questState.serverOptions.clear();
        questState.serverVisibility.clear();
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
                    settlementId: q.settlement_id
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
        
        // Process visibility
        if (data.visibility) {
            // Need to map server option_id to local id
            const serverToLocal = new Map();
            questState.serverOptions.forEach((serverId, localId) => {
                serverToLocal.set(serverId, localId);
            });
            
            data.visibility.forEach(v => {
                const fromLocal = serverToLocal.get(v.option_id);
                const toLocal = serverToLocal.get(v.target_option_id);
                if (fromLocal && toLocal) {
                    questState.visibility.push({
                        optionId: fromLocal,
                        effectType: v.effect_type,
                        targetOptionId: toLocal
                    });
                    questState.serverVisibility.add(`${v.option_id}-${v.effect_type}-${v.target_option_id}`);
                }
            });
        }
        
        populateQuestDropdown();
        
        // Auto-select first quest
        if (questState.quests.size > 0) {
            const firstQuest = questState.quests.values().next().value;
            questState.selectedQuest = firstQuest.questId;
            document.getElementById('questSelect').value = firstQuest.questId;
        } else {
            questState.selectedQuest = null;
        }
        
        filterAndRenderQuestOptions();
        
        console.log(`✅ Loaded ${questState.quests.size} quests, ${questState.options.size} options`);
    } catch (error) {
        console.error('Failed to load quests:', error);
    }
}

function populateQuestDropdown() {
    const select = document.getElementById('questSelect');
    if (!select) return;
    
    select.innerHTML = '<option value="">-- Select Quest --</option>';
    
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
    questState.selectedQuest = value ? parseInt(value) : null;
    
    console.log(`📜 Quest changed to: ${questState.selectedQuest}`);
    filterAndRenderQuestOptions();
}
window.onQuestChange = onQuestChange;

function filterAndRenderQuestOptions() {
    const container = document.getElementById('questOptionsContainer');
    if (!container) return;
    
    container.innerHTML = '';
    
    questState.options.forEach(option => {
        const matchesFilter = !questState.selectedQuest || option.questId === questState.selectedQuest;
        if (matchesFilter) {
            renderQuestOption(option);
        }
    });
    
    renderQuestConnections();
    updateQuestCounter();
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
    // Enemies
    const enemySelect = document.getElementById('sidebarEnemyId');
    if (enemySelect && enemySelect.options.length <= 1) {
        if (typeof GlobalData !== 'undefined' && GlobalData.enemies) {
            GlobalData.enemies.forEach(enemy => {
                const opt = document.createElement('option');
                opt.value = enemy.id;
                opt.textContent = `${enemy.name || 'Enemy #' + enemy.id}`;
                enemySelect.appendChild(opt);
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
    if (!questState.selectedQuest) {
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
            if (option.questId !== questState.selectedQuest) return;
            
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
        
        // Collect new visibility connections
        const newVisibility = [];
        questState.visibility.forEach(v => {
            const fromOption = questState.options.get(v.optionId);
            const toOption = questState.options.get(v.targetOptionId);
            if (!fromOption || !toOption) return;
            if (fromOption.questId !== questState.selectedQuest) return;
            
            const fromServerId = questState.serverOptions.get(v.optionId);
            const toServerId = questState.serverOptions.get(v.targetOptionId);
            
            // Only include if both are server options and connection doesn't exist
            if (fromServerId && toServerId) {
                const key = `${fromServerId}-${v.effectType}-${toServerId}`;
                if (!questState.serverVisibility.has(key)) {
                    newVisibility.push({
                        optionId: fromServerId,
                        effectType: v.effectType,
                        targetOptionId: toServerId
                    });
                }
            }
        });
        
        const response = await fetch('http://localhost:8080/api/saveQuest', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                questId: questState.selectedQuest,
                newOptions: newOptions,
                optionUpdates: optionUpdates,
                newVisibility: newVisibility
            })
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText);
        }
        
        const result = await response.json();
        
        if (result.success) {
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
            
            // Track new visibility
            newVisibility.forEach(v => {
                const key = `${v.optionId}-${v.effectType}-${v.targetOptionId}`;
                questState.serverVisibility.add(key);
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
