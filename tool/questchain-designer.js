// Quest Chain Designer - Visual Quest Slide Network Editor
console.log('📦 questchain-designer.js LOADED');

// ==================== STATE ====================
const questchainState = {
    // Current questchain data
    questchainId: null,
    questchainName: '',
    questchainDescription: '',
    settlementId: null,
    
    // Quest slides (quests within the chain)
    questSlides: new Map(),      // localId -> quest slide data
    // Options within each quest slide
    options: new Map(),          // localId -> option data (with questSlideId reference)
    // Requirements between options (option requires another option to be completed)
    requirements: [],            // { optionId, requiredOptionId }
    
    // UI State
    selectedQuestSlide: null,
    selectedOption: null,
    nextQuestSlideId: 1,
    nextOptionId: 1,
    canvasOffset: { x: 0, y: 0 },
    zoom: 1,
    isDragging: false,
    lastMouse: { x: 0, y: 0 },
    isConnecting: false,
    connectionStart: null,
    connectionType: null, // 'quest-to-option' or 'option-to-option'
    dropdownsPopulated: false,
    
    // Server tracking
    serverQuestSlides: new Map(),   // localId -> quest_id (server)
    serverOptions: new Map(),        // localId -> option_id (server)
    serverRequirements: new Set(),   // Set of "optionId-requiredOptionId" keys
    
    // Change tracking
    originalQuestSlides: new Map(),
    originalOptions: new Map(),
    
    // Assets
    questAssets: [],
    
    // All questchains for selection
    questchains: new Map()
};

// ==================== INITIALIZATION ====================
function initQuestchainDesigner() {
    console.log('🗡️ initQuestchainDesigner called');
    
    const canvas = document.getElementById('questCanvas');
    if (!canvas) {
        console.error('❌ questchainCanvas not found');
        return;
    }
    
    // Canvas pan events
    canvas.addEventListener('mousedown', onQuestchainCanvasMouseDown);
    canvas.addEventListener('mousemove', onQuestchainCanvasMouseMove);
    canvas.addEventListener('mouseup', onQuestchainCanvasMouseUp);
    canvas.addEventListener('mouseleave', onQuestchainCanvasMouseUp);
    
    // Prevent context menu on middle click
    canvas.addEventListener('auxclick', (e) => {
        if (e.button === 1) e.preventDefault();
    });
    canvas.addEventListener('contextmenu', (e) => {
        if (questchainState.isDragging) e.preventDefault();
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
            onQuestchainCanvasWheel(e);
        }
    }, { passive: false, capture: true });
    
    // Zoom indicator wheel
    const zoomIndicator = document.getElementById('questZoomIndicator');
    if (zoomIndicator) {
        zoomIndicator.addEventListener('wheel', function(e) {
            e.preventDefault();
            e.stopPropagation();
            const delta = e.deltaY > 0 ? -0.05 : 0.05;
            changeQuestchainZoom(delta);
        }, { passive: false });
    }
    
    // Populate dropdowns after data loads
    let retryCount = 0;
    const tryPopulateDropdowns = () => {
        populateQuestchainDropdowns();
        if (!questchainState.dropdownsPopulated && retryCount < 5) {
            retryCount++;
            setTimeout(tryPopulateDropdowns, 2000);
        }
    };
    setTimeout(tryPopulateDropdowns, 1500);
    
    // Button events
    document.getElementById('addQuestSlideBtn')?.addEventListener('click', addQuestSlide);
    document.getElementById('newQuestchainBtn')?.addEventListener('click', openNewQuestchainModal);
    
    // Setup sidebar auto-save
    setupQuestchainSidebarAutoSave();
    
    // Asset upload setup
    setupQuestchainAssetUpload();
    
    updateQuestchainCounter();
    resetQuestchainView();
    
    console.log('✅ Questchain Designer ready');
    
    // Load settlements
    loadQuestchainAssets();
}
window.initQuestchainDesigner = initQuestchainDesigner;

// ==================== ASSETS ====================
async function loadQuestchainAssets() {
    console.log('🖼️ Loading quest assets from GlobalData...');
    try {
        // Use shared GlobalData loader
        await loadQuestAssetsData();
        questchainState.questAssets = GlobalData.questAssets || [];
        console.log(`✅ Loaded ${questchainState.questAssets.length} quest assets from GlobalData`);
        populateQuestchainAssetGallery();
    } catch (error) {
        console.error('Failed to load quest assets:', error);
        questchainState.questAssets = [];
    }
}

function populateQuestchainAssetGallery() {
    const gallery = document.getElementById('questchainAssetGallery');
    if (!gallery) return;
    
    gallery.innerHTML = '';
    
    if (questchainState.questAssets.length === 0) {
        gallery.innerHTML = '<p style="color:#888;text-align:center;padding:20px;">No assets yet. Upload one above!</p>';
        return;
    }
    
    questchainState.questAssets.forEach(asset => {
        const div = document.createElement('div');
        div.className = 'questchain-asset-item';
        div.dataset.assetId = asset.id;
        div.innerHTML = `<img src="${asset.url}" alt="Quest Asset">`;
        div.addEventListener('click', () => selectQuestchainAsset(asset.id, asset.url));
        gallery.appendChild(div);
    });
}

function selectQuestchainAsset(assetId, assetUrl) {
    // Get which quest slide we're setting asset for
    const targetSlideId = questchainState.assetModalTargetSlide;
    if (!targetSlideId) return;
    
    const questSlide = questchainState.questSlides.get(targetSlideId);
    if (questSlide) {
        questSlide.assetId = assetId;
        questSlide.assetUrl = assetUrl;
        renderQuestSlide(questSlide);
    }
    
    closeQuestchainAssetModal();
}

function openQuestchainAssetModal(questSlideId) {
    questchainState.assetModalTargetSlide = questSlideId;
    document.getElementById('questchainAssetModal')?.classList.add('open');
}
window.openQuestchainAssetModal = openQuestchainAssetModal;

function closeQuestchainAssetModal() {
    questchainState.assetModalTargetSlide = null;
    document.getElementById('questchainAssetModal')?.classList.remove('open');
}
window.closeQuestchainAssetModal = closeQuestchainAssetModal;

function setupQuestchainAssetUpload() {
    const uploadArea = document.getElementById('questchainAssetUploadArea');
    const fileInput = document.getElementById('questchainAssetFileInput');
    
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
        if (file) uploadQuestchainAsset(file);
    });
    
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) uploadQuestchainAsset(file);
    });
}

async function uploadQuestchainAsset(file) {
    if (!file.type.startsWith('image/')) {
        alert('Please select an image file');
        return;
    }
    
    const uploadStatus = document.getElementById('questchainAssetUploadStatus');
    if (uploadStatus) {
        uploadStatus.textContent = 'Converting to WebP...';
        uploadStatus.style.display = 'block';
        uploadStatus.style.color = '#4ecdc4';
    }
    
    try {
        const webpBlob = await convertQuestchainImageToWebP(file);
        
        if (uploadStatus) uploadStatus.textContent = 'Uploading...';
        
        const token = await getCurrentAccessToken();
        if (!token) throw new Error('Not authenticated');
        
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
        
        questchainState.questAssets.push({ id: result.assetId, url: result.url });
        populateQuestchainAssetGallery();
        selectQuestchainAsset(result.assetId, result.url);
        
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

async function convertQuestchainImageToWebP(file) {
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
function onQuestchainCanvasWheel(e) {
    const zoomSpeed = 0.05;
    const delta = e.deltaY > 0 ? -zoomSpeed : zoomSpeed;
    changeQuestchainZoom(delta);
}

function changeQuestchainZoom(delta) {
    const newZoom = Math.max(0.1, Math.min(2, questchainState.zoom + delta));
    questchainState.zoom = newZoom;
    
    const container = document.getElementById('questOptionsContainer');
    if (container) {
        container.style.transform = `translate(${questchainState.canvasOffset.x}px, ${questchainState.canvasOffset.y}px) scale(${questchainState.zoom})`;
    }
    
    const indicator = document.getElementById('questZoomIndicator');
    if (indicator) {
        indicator.textContent = `${Math.round(questchainState.zoom * 100)}%`;
    }
    
    renderQuestchainConnections();
}
window.changeQuestchainZoom = changeQuestchainZoom;

function onQuestchainCanvasMouseDown(e) {
    if (e.target.closest('.quest-slide-node')) return;
    if (e.target.closest('.quest-option-node')) return;
    if (e.button === 1 || (e.button === 0 && e.target === e.currentTarget)) {
        questchainState.isDragging = true;
        questchainState.lastMouse = { x: e.clientX, y: e.clientY };
        e.currentTarget.style.cursor = 'grabbing';
    }
}

function onQuestchainCanvasMouseMove(e) {
    if (questchainState.isDragging) {
        const dx = e.clientX - questchainState.lastMouse.x;
        const dy = e.clientY - questchainState.lastMouse.y;
        questchainState.canvasOffset.x += dx;
        questchainState.canvasOffset.y += dy;
        questchainState.lastMouse = { x: e.clientX, y: e.clientY };
        
        const container = document.getElementById('questOptionsContainer');
        if (container) {
            container.style.transform = `translate(${questchainState.canvasOffset.x}px, ${questchainState.canvasOffset.y}px) scale(${questchainState.zoom})`;
        }
        renderQuestchainConnections();
    }
    
    if (questchainState.isConnecting) {
        updateQuestchainConnectionPreview(e);
    }
}

function onQuestchainCanvasMouseUp(e) {
    if (questchainState.isDragging) {
        questchainState.isDragging = false;
        const canvas = document.getElementById('questCanvas');
        if (canvas) canvas.style.cursor = 'grab';
    }
    
    if (questchainState.isConnecting) {
        handleConnectionDrop(e);
    }
}

function panQuestchainCanvas(dx, dy) {
    questchainState.canvasOffset.x += dx;
    questchainState.canvasOffset.y += dy;
    const container = document.getElementById('questOptionsContainer');
    if (container) {
        container.style.transform = `translate(${questchainState.canvasOffset.x}px, ${questchainState.canvasOffset.y}px) scale(${questchainState.zoom})`;
    }
    renderQuestchainConnections();
}
window.panQuestchainCanvas = panQuestchainCanvas;

function resetQuestchainView() {
    questchainState.canvasOffset = { x: 50, y: 20 };
    questchainState.zoom = 1;
    const container = document.getElementById('questOptionsContainer');
    if (container) {
        container.style.transform = `translate(${questchainState.canvasOffset.x}px, ${questchainState.canvasOffset.y}px) scale(1)`;
    }
    const indicator = document.getElementById('questchainZoomIndicator');
    if (indicator) indicator.textContent = '100%';
    renderQuestchainConnections();
}
window.resetQuestchainView = resetQuestchainView;

// ==================== ADD QUEST SLIDE ====================
function addQuestSlide() {
    console.log('➕ addQuestSlide called');
    
    const canvas = document.getElementById('questCanvas');
    const container = document.getElementById('questOptionsContainer');
    
    if (!canvas || !container) {
        console.error('❌ Canvas or container not found');
        return;
    }
    
    const rect = canvas.getBoundingClientRect();
    const id = questchainState.nextQuestSlideId++;
    
    // Check if this is the first quest slide (should be starting quest)
    const isFirst = questchainState.questSlides.size === 0;
    
    const questSlide = {
        id: id,
        questName: '',
        isStart: isFirst,
        defaultEntry: isFirst,
        x: (rect.width / 2 - questchainState.canvasOffset.x) / questchainState.zoom - 180 + (Math.random() - 0.5) * 100,
        y: (rect.height / 2 - questchainState.canvasOffset.y) / questchainState.zoom - 150 + (Math.random() - 0.5) * 100,
        assetId: null,
        assetUrl: null,
        ending: null,
        requisiteOptionId: null, // The option that must be selected to unlock this quest
        sortOrder: questchainState.questSlides.size
    };
    
    questchainState.questSlides.set(id, questSlide);
    renderQuestSlide(questSlide);
    updateQuestchainCounter();
    selectQuestSlide(id);
    
    console.log(`✅ Quest Slide #${id} created`);
}
window.addQuestSlide = addQuestSlide;

// ==================== RENDER QUEST SLIDE ====================
function renderQuestSlide(questSlide) {
    const container = document.getElementById('questOptionsContainer');
    if (!container) return;
    
    // Remove if exists
    document.getElementById(`quest-slide-${questSlide.id}`)?.remove();
    
    const el = document.createElement('div');
    el.id = `quest-slide-${questSlide.id}`;
    el.dataset.questSlideId = questSlide.id;
    
    const isNewSlide = !questchainState.serverQuestSlides.has(questSlide.id);
    const isModified = !isNewSlide && isQuestSlideModified(questSlide.id);
    
    let nodeClass = 'quest-slide-node';
    if (questSlide.isStart) nodeClass += ' start-quest';
    if (questchainState.selectedQuestSlide === questSlide.id) nodeClass += ' selected';
    if (isNewSlide) nodeClass += ' new-quest-slide';
    if (isModified) nodeClass += ' modified-quest-slide';
    if (questSlide.ending) nodeClass += ' ending-quest';
    
    el.className = nodeClass;
    el.style.left = `${questSlide.x}px`;
    el.style.top = `${questSlide.y}px`;
    
    // Build background style
    const bodyBgStyle = questSlide.assetUrl 
        ? `style="background-image: url(${questSlide.assetUrl});"` 
        : '';
    const bodyClass = questSlide.assetUrl ? 'quest-slide-body has-bg' : 'quest-slide-body';
    
    // Get options for this quest slide
    const slideOptions = Array.from(questchainState.options.values())
        .filter(opt => opt.questSlideId === questSlide.id);
    
    // Build options HTML
    const optionsHtml = slideOptions.map(opt => renderQuestOptionHtml(opt)).join('');
    
    // Build ending badge if applicable
    let endingBadge = '';
    if (questSlide.ending !== null && questSlide.ending !== undefined) {
        const endingTypes = { 1: '✅ Good', 2: '⚠️ Neutral', 3: '❌ Bad' };
        endingBadge = `<span class="ending-badge ending-${questSlide.ending}">${endingTypes[questSlide.ending] || 'End'}</span>`;
    }
    
    el.innerHTML = `
        <div class="quest-slide-header">
            <span class="quest-slide-id">#${questSlide.id}</span>
            ${endingBadge}
            <label class="start-checkbox" title="Starting Quest">
                <input type="checkbox" ${questSlide.isStart ? 'checked' : ''} data-quest-slide="${questSlide.id}">
                <span>START</span>
            </label>
            <button class="quest-slide-bg-btn" data-quest-slide="${questSlide.id}" title="Set background">🖼️</button>
            <button class="quest-slide-delete-btn" data-quest-slide="${questSlide.id}" title="Delete quest">🗑️</button>
        </div>
        <div class="quest-slide-connector quest-slide-connector-left" data-quest-slide="${questSlide.id}" title="Drag to connect to option">●</div>
        <div class="quest-slide-connector quest-slide-connector-right" data-quest-slide="${questSlide.id}" title="Drag to connect to option">●</div>
        <div class="${bodyClass}" ${bodyBgStyle}>
            <input type="text" class="quest-slide-name-input" data-quest-slide="${questSlide.id}" 
                   value="${escapeHtml(questSlide.questName || '')}" placeholder="Quest Name...">
            <div class="quest-slide-options">
                ${optionsHtml}
                <button class="add-quest-option-btn" data-quest-slide="${questSlide.id}">+ Add Option</button>
            </div>
        </div>
    `;
    
    // Bind events
    bindQuestSlideEvents(el, questSlide);
    
    container.appendChild(el);
}

function renderQuestOptionHtml(option) {
    const isNewOption = !questchainState.serverOptions.has(option.id);
    const isModified = !isNewOption && isOptionModified(option.id);
    
    let optClass = 'quest-option-node';
    if (option.isStart) optClass += ' start-option';
    if (questchainState.selectedOption === option.id) optClass += ' selected';
    if (isNewOption) optClass += ' new-option';
    if (isModified) optClass += ' modified-option';
    if (option.enemyId) optClass += ' combat-option';
    
    // Get icon based on type
    let icon = '💬';
    if (option.isStart) icon = '🟢';
    else if (option.enemyId) icon = '⚔️';
    else if (option.statType) icon = '📊';
    else if (option.rewardItem || option.rewardPerk) icon = '🎁';
    
    // Build requirement badge
    let requirementBadge = '';
    if (option.statType) {
        requirementBadge = `<span class="option-req-badge stat">${option.statType.slice(0,3).toUpperCase()}:${option.statRequired || '?'}</span>`;
    } else if (option.enemyId) {
        requirementBadge = `<span class="option-req-badge combat">⚔️#${option.enemyId}</span>`;
    } else if (option.effectId) {
        requirementBadge = `<span class="option-req-badge effect">E#${option.effectId}</span>`;
    }
    
    return `
        <div class="${optClass}" data-option-id="${option.id}" id="option-${option.id}">
            <div class="option-connector option-connector-left" data-option="${option.id}" title="Drag to create requirement">●</div>
            <span class="option-icon">${icon}</span>
            <input type="text" class="option-text-input" value="${escapeHtml(option.optionText || '')}" 
                   data-option="${option.id}" placeholder="Option text...">
            ${requirementBadge}
            <button class="option-edit-btn" data-option="${option.id}" title="Edit option">⚙️</button>
            <button class="option-delete-btn" data-option="${option.id}" title="Delete option">×</button>
            <div class="option-connector option-connector-right" data-option="${option.id}" title="Drag to connect to quest">●</div>
        </div>
    `;
}

function bindQuestSlideEvents(el, questSlide) {
    // Quest name editing
    const nameInput = el.querySelector('.quest-slide-name-input');
    nameInput?.addEventListener('input', (e) => {
        questSlide.questName = e.target.value;
        checkAndUpdateQuestSlideModifiedState(el, questSlide);
    });
    nameInput?.addEventListener('mousedown', (e) => e.stopPropagation());
    nameInput?.addEventListener('click', (e) => e.stopPropagation());
    
    // Start checkbox
    const startCb = el.querySelector('.start-checkbox input');
    startCb?.addEventListener('change', (e) => {
        e.stopPropagation();
        questSlide.isStart = e.target.checked;
        questSlide.defaultEntry = e.target.checked;
        el.classList.toggle('start-quest', questSlide.isStart);
        checkAndUpdateQuestSlideModifiedState(el, questSlide);
    });
    
    // Background button
    el.querySelector('.quest-slide-bg-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        openQuestchainAssetModal(questSlide.id);
    });
    
    // Delete button
    el.querySelector('.quest-slide-delete-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteQuestSlide(questSlide.id);
    });
    
    // Add option button
    el.querySelector('.add-quest-option-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        addQuestOption(questSlide.id);
    });
    
    // Click to select quest slide
    el.addEventListener('click', (e) => {
        if (e.target.closest('.quest-option-node')) return;
        if (e.target.closest('input, button')) return;
        selectQuestSlide(questSlide.id);
    });
    
    // Drag quest slide
    el.addEventListener('mousedown', (e) => {
        if (e.target.closest('.quest-option-node')) return;
        if (e.target.closest('.option-connector')) return;
        if (e.target.closest('.quest-slide-connector')) return;
        if (e.target.closest('input, button, textarea')) return;
        if (e.button !== 0) return;
        e.stopPropagation();
        
        selectQuestSlide(questSlide.id);
        
        const startMouseX = e.clientX;
        const startMouseY = e.clientY;
        const startX = questSlide.x;
        const startY = questSlide.y;
        
        const onMove = (ev) => {
            if (questchainState.isConnecting) return;
            el.classList.add('dragging');
            const deltaX = (ev.clientX - startMouseX) / questchainState.zoom;
            const deltaY = (ev.clientY - startMouseY) / questchainState.zoom;
            questSlide.x = startX + deltaX;
            questSlide.y = startY + deltaY;
            el.style.left = `${questSlide.x}px`;
            el.style.top = `${questSlide.y}px`;
            renderQuestchainConnections();
        };
        
        const onUp = () => {
            el.classList.remove('dragging');
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
        
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
    
    // Quest slide connectors (can start connections to options)
    el.querySelectorAll('.quest-slide-connector').forEach(conn => {
        conn.addEventListener('mousedown', (e) => {
            console.log('🔵 Quest slide connector clicked!', conn);
            e.stopPropagation();
            e.preventDefault();
            const side = conn.classList.contains('quest-slide-connector-right') ? 'right' : 'left';
            startQuestSlideConnection(questSlide.id, side, e);
        });
    });
    
    // Bind option events
    el.querySelectorAll('.quest-option-node').forEach(optEl => {
        const optionId = parseInt(optEl.dataset.optionId);
        const option = questchainState.options.get(optionId);
        if (option) {
            bindQuestOptionEvents(optEl, option);
        }
    });
}

function bindQuestOptionEvents(el, option) {
    // Option text editing
    const textInput = el.querySelector('.option-text-input');
    textInput?.addEventListener('input', (e) => {
        option.optionText = e.target.value;
        checkAndUpdateOptionModifiedState(el, option);
        updateQuestchainSidebar();
    });
    textInput?.addEventListener('mousedown', (e) => e.stopPropagation());
    textInput?.addEventListener('click', (e) => e.stopPropagation());
    
    // Edit button
    el.querySelector('.option-edit-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        selectQuestOption(option.id);
    });
    
    // Delete button
    el.querySelector('.option-delete-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteQuestOption(option.id);
    });
    
    // Click to select option
    el.addEventListener('click', (e) => {
        if (e.target.closest('input, button')) return;
        if (e.target.closest('.option-connector')) return;
        selectQuestOption(option.id);
    });
    
    // Connector events for creating connections
    el.querySelectorAll('.option-connector').forEach(conn => {
        conn.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            e.preventDefault();
            startOptionConnection(option.id, conn.classList.contains('option-connector-right') ? 'right' : 'left', e);
        });
    });
}

// ==================== ADD OPTION ====================
function addQuestOption(questSlideId) {
    console.log('➕ addQuestOption for quest slide', questSlideId);
    
    const questSlide = questchainState.questSlides.get(questSlideId);
    if (!questSlide) return;
    
    const id = questchainState.nextOptionId++;
    
    // Check if this is the first option for this quest slide
    const existingOptions = Array.from(questchainState.options.values())
        .filter(opt => opt.questSlideId === questSlideId);
    
    const option = {
        id: id,
        questSlideId: questSlideId,
        nodeText: '',
        optionText: '',
        isStart: existingOptions.length === 0,
        statType: null,
        statRequired: null,
        effectId: null,
        effectAmount: null,
        enemyId: null,
        rewardStatType: null,
        rewardStatAmount: null,
        rewardTalent: false,
        rewardItem: null,
        rewardPerk: null,
        rewardBlessing: null,
        rewardPotion: null
    };
    
    questchainState.options.set(id, option);
    renderQuestSlide(questSlide);
    updateQuestchainCounter();
    selectQuestOption(id);
    
    console.log(`✅ Option #${id} created for Quest Slide #${questSlideId}`);
}
window.addQuestOption = addQuestOption;

// ==================== SELECTION ====================
function selectQuestSlide(id) {
    questchainState.selectedQuestSlide = id;
    questchainState.selectedOption = null;
    
    document.querySelectorAll('.quest-slide-node').forEach(el => {
        el.classList.toggle('selected', el.id === `quest-slide-${id}`);
    });
    document.querySelectorAll('.quest-option-node').forEach(el => {
        el.classList.remove('selected');
    });
    
    updateQuestchainSidebar();
}

function selectQuestOption(id) {
    questchainState.selectedOption = id;
    
    // Also select the parent quest slide
    const option = questchainState.options.get(id);
    if (option) {
        questchainState.selectedQuestSlide = option.questSlideId;
    }
    
    document.querySelectorAll('.quest-slide-node').forEach(el => {
        el.classList.toggle('selected', option && el.id === `quest-slide-${option.questSlideId}`);
    });
    document.querySelectorAll('.quest-option-node').forEach(el => {
        el.classList.toggle('selected', el.id === `option-${id}`);
    });
    
    updateQuestchainSidebar();
}

// ==================== DELETE ====================
async function deleteQuestSlide(id) {
    if (!confirm('Delete this quest and all its options?')) return;
    
    const isServerSlide = questchainState.serverQuestSlides.has(id);
    
    if (isServerSlide) {
        try {
            const token = await getCurrentAccessToken();
            if (!token) throw new Error('Not authenticated');
            
            const serverId = questchainState.serverQuestSlides.get(id);
            const response = await fetch('http://localhost:8080/api/deleteQuest', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ questId: serverId })
            });
            
            if (!response.ok) throw new Error(await response.text());
        } catch (error) {
            console.error('Failed to delete quest:', error);
            alert(`Failed to delete: ${error.message}`);
            return;
        }
    }
    
    // Delete all options for this quest slide
    const optionsToDelete = Array.from(questchainState.options.values())
        .filter(opt => opt.questSlideId === id)
        .map(opt => opt.id);
    
    optionsToDelete.forEach(optId => {
        questchainState.options.delete(optId);
        questchainState.serverOptions.delete(optId);
        questchainState.originalOptions.delete(optId);
    });
    
    // Remove requirements involving these options
    questchainState.requirements = questchainState.requirements.filter(r => 
        !optionsToDelete.includes(r.optionId) && !optionsToDelete.includes(r.requiredOptionId)
    );
    
    // Remove any quest slides that have this quest's options as requisites
    questchainState.questSlides.forEach(qs => {
        if (optionsToDelete.includes(qs.requisiteOptionId)) {
            qs.requisiteOptionId = null;
        }
    });
    
    questchainState.questSlides.delete(id);
    questchainState.serverQuestSlides.delete(id);
    questchainState.originalQuestSlides.delete(id);
    
    document.getElementById(`quest-slide-${id}`)?.remove();
    
    if (questchainState.selectedQuestSlide === id) {
        questchainState.selectedQuestSlide = null;
        questchainState.selectedOption = null;
    }
    
    renderQuestchainConnections();
    updateQuestchainCounter();
    updateQuestchainSidebar();
}

async function deleteQuestOption(id) {
    if (!confirm('Delete this option?')) return;
    
    const option = questchainState.options.get(id);
    if (!option) return;
    
    const isServerOption = questchainState.serverOptions.has(id);
    
    if (isServerOption) {
        try {
            const token = await getCurrentAccessToken();
            if (!token) throw new Error('Not authenticated');
            
            const serverId = questchainState.serverOptions.get(id);
            const response = await fetch('http://localhost:8080/api/deleteQuestOption', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ optionId: serverId })
            });
            
            if (!response.ok) throw new Error(await response.text());
        } catch (error) {
            console.error('Failed to delete option:', error);
            alert(`Failed to delete: ${error.message}`);
            return;
        }
    }
    
    // Remove requirements
    questchainState.requirements = questchainState.requirements.filter(r => 
        r.optionId !== id && r.requiredOptionId !== id
    );
    
    // Remove any quest slides that have this option as requisite
    questchainState.questSlides.forEach(qs => {
        if (qs.requisiteOptionId === id) {
            qs.requisiteOptionId = null;
        }
    });
    
    const questSlideId = option.questSlideId;
    questchainState.options.delete(id);
    questchainState.serverOptions.delete(id);
    questchainState.originalOptions.delete(id);
    
    // Re-render the parent quest slide
    const questSlide = questchainState.questSlides.get(questSlideId);
    if (questSlide) {
        renderQuestSlide(questSlide);
    }
    
    if (questchainState.selectedOption === id) {
        questchainState.selectedOption = null;
    }
    
    renderQuestchainConnections();
    updateQuestchainCounter();
    updateQuestchainSidebar();
}

// ==================== CONNECTIONS ====================
function startOptionConnection(optionId, side, e) {
    questchainState.isConnecting = true;
    questchainState.connectionStart = { optionId, side, type: 'option' };
    questchainState.connectionType = 'option'; // Could connect to quest or another option
    
    document.body.style.cursor = 'crosshair';
    const canvas = document.getElementById('questCanvas');
    if (canvas) canvas.classList.add('connecting');
    
    // Highlight potential targets
    document.querySelectorAll('.quest-slide-node').forEach(node => {
        node.classList.add('connection-target');
    });
    document.querySelectorAll('.quest-option-node').forEach(node => {
        if (node.id !== `option-${optionId}`) {
            node.classList.add('connection-target');
        }
    });
    
    const preview = document.getElementById('questConnectionPreview');
    if (preview) preview.style.display = 'block';
    
    const onMouseMove = (ev) => updateQuestchainConnectionPreview(ev);
    
    const onMouseUp = (ev) => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        handleConnectionDrop(ev);
    };
    
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    
    updateQuestchainConnectionPreview(e);
}

function startQuestSlideConnection(questSlideId, side, e) {
    console.log('🔴 startQuestSlideConnection called', questSlideId, side);
    questchainState.isConnecting = true;
    questchainState.connectionStart = { questSlideId, side, type: 'questSlide' };
    questchainState.connectionType = 'questSlide'; // Quest slide to option
    
    document.body.style.cursor = 'crosshair';
    const canvas = document.getElementById('questCanvas');
    if (canvas) canvas.classList.add('connecting');
    
    // Highlight potential targets - only options (quest-to-option connection)
    document.querySelectorAll('.quest-option-node').forEach(node => {
        node.classList.add('connection-target');
    });
    // Also highlight other quest slides for quest-to-quest connections
    document.querySelectorAll('.quest-slide-node').forEach(node => {
        if (node.id !== `quest-slide-${questSlideId}`) {
            node.classList.add('connection-target');
        }
    });
    
    const preview = document.getElementById('questConnectionPreview');
    if (preview) {
        preview.style.display = 'block';
        preview.classList.add('quest-to-option-preview');
    }
    
    const onMouseMove = (ev) => updateQuestchainConnectionPreview(ev);
    
    const onMouseUp = (ev) => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        handleConnectionDrop(ev);
    };
    
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    
    updateQuestchainConnectionPreview(e);
}

function handleConnectionDrop(e) {
    if (!questchainState.isConnecting || !questchainState.connectionStart) {
        cancelQuestchainConnection();
        return;
    }
    
    const target = document.elementFromPoint(e.clientX, e.clientY);
    const startType = questchainState.connectionStart.type;
    
    // ========== FROM OPTION ==========
    if (startType === 'option') {
        const sourceOptionId = questchainState.connectionStart.optionId;
        
        // Option -> Quest slide (option unlocks quest) - check connector OR the slide itself
        const questSlideEl = target?.closest('.quest-slide-node');
        if (questSlideEl && !target?.closest('.quest-option-node')) {
            const questSlideId = parseInt(questSlideEl.dataset.questSlideId);
            const questSlide = questchainState.questSlides.get(questSlideId);
            if (questSlide) {
                questSlide.requisiteOptionId = sourceOptionId;
                renderQuestSlide(questSlide);
                renderQuestchainConnections();
                console.log(`Quest Slide #${questSlideId} now requires Option #${sourceOptionId}`);
            }
            cancelQuestchainConnection();
            return;
        }
        
        // Option -> Option (option requires another option)
        const optionEl = target?.closest('.quest-option-node');
        if (optionEl) {
            const targetOptionId = parseInt(optionEl.dataset.optionId);
            if (targetOptionId !== sourceOptionId) {
                createOptionRequirement(targetOptionId, sourceOptionId);
            }
            cancelQuestchainConnection();
            return;
        }
    }
    
    // ========== FROM QUEST SLIDE ==========
    if (startType === 'questSlide') {
        const sourceQuestSlideId = questchainState.connectionStart.questSlideId;
        
        // Quest slide -> Option (quest slide unlocks when this option is completed)
        const optionEl = target?.closest('.quest-option-node');
        if (optionEl) {
            const targetOptionId = parseInt(optionEl.dataset.optionId);
            const sourceQuestSlide = questchainState.questSlides.get(sourceQuestSlideId);
            if (sourceQuestSlide) {
                sourceQuestSlide.requisiteOptionId = targetOptionId;
                renderQuestSlide(sourceQuestSlide);
                renderQuestchainConnections();
                console.log(`Quest Slide #${sourceQuestSlideId} now requires Option #${targetOptionId}`);
            }
            cancelQuestchainConnection();
            return;
        }
        
        // Quest slide -> another Quest slide (link quest to quest, quest slide gets the requisite from any option in target)
        const targetQuestSlideEl = target?.closest('.quest-slide-node');
        if (targetQuestSlideEl) {
            const targetQuestSlideId = parseInt(targetQuestSlideEl.dataset.questSlideId);
            if (targetQuestSlideId !== sourceQuestSlideId) {
                console.log(`Quest-to-Quest: Slide #${sourceQuestSlideId} -> Slide #${targetQuestSlideId} (not yet implemented)`);
            }
            cancelQuestchainConnection();
            return;
        }
    }
    
    cancelQuestchainConnection();
}

function cancelQuestchainConnection() {
    questchainState.isConnecting = false;
    questchainState.connectionStart = null;
    questchainState.connectionType = null;
    document.body.style.cursor = 'default';
    
    const canvas = document.getElementById('questCanvas');
    if (canvas) canvas.classList.remove('connecting');
    
    const preview = document.getElementById('questConnectionPreview');
    if (preview) {
        preview.style.display = 'none';
        preview.classList.remove('quest-to-option-preview');
    }
    
    document.querySelectorAll('.connection-target').forEach(node => {
        node.classList.remove('connection-target');
    });
}

function updateQuestchainConnectionPreview(e) {
    const preview = document.getElementById('questConnectionPreview');
    const canvas = document.getElementById('questCanvas');
    if (!preview || !canvas || !questchainState.connectionStart) return;
    
    const rect = canvas.getBoundingClientRect();
    const connectorSide = questchainState.connectionStart.side || 'right';
    
    let sourceEl, connector;
    
    // Determine source element based on connection type
    if (questchainState.connectionStart.type === 'questSlide') {
        sourceEl = document.getElementById(`quest-slide-${questchainState.connectionStart.questSlideId}`);
        if (!sourceEl) return;
        connector = sourceEl.querySelector(`.quest-slide-connector-${connectorSide}`);
    } else {
        sourceEl = document.getElementById(`option-${questchainState.connectionStart.optionId}`);
        if (!sourceEl) return;
        connector = sourceEl.querySelector(`.option-connector-${connectorSide}`);
    }
    
    if (!connector) return;
    
    const connRect = connector.getBoundingClientRect();
    const x1 = connRect.left + connRect.width/2 - rect.left;
    const y1 = connRect.top + connRect.height/2 - rect.top;
    const x2 = e.clientX - rect.left;
    const y2 = e.clientY - rect.top;
    
    const curveStrength = 50;
    const cx1 = connectorSide === 'right' ? x1 + curveStrength : x1 - curveStrength;
    const cx2 = connectorSide === 'right' ? x2 - curveStrength : x2 + curveStrength;
    preview.setAttribute('d', `M ${x1} ${y1} C ${cx1} ${y1}, ${cx2} ${y2}, ${x2} ${y2}`);
}

function createOptionRequirement(optionId, requiredOptionId) {
    const exists = questchainState.requirements.some(r => 
        r.optionId === optionId && r.requiredOptionId === requiredOptionId
    );
    
    if (exists) {
        console.log('Requirement already exists');
        return;
    }
    
    questchainState.requirements.push({
        optionId: optionId,
        requiredOptionId: requiredOptionId
    });
    
    renderQuestchainConnections();
    
    if (questchainState.selectedOption === optionId) {
        updateQuestchainSidebar();
    }
    
    console.log(`Created requirement: Option #${optionId} requires Option #${requiredOptionId}`);
}

function removeOptionRequirement(optionId, requiredOptionId) {
    questchainState.requirements = questchainState.requirements.filter(r => 
        !(r.optionId === optionId && r.requiredOptionId === requiredOptionId)
    );
    renderQuestchainConnections();
    updateQuestchainSidebar();
}
window.removeOptionRequirement = removeOptionRequirement;

function removeQuestRequisite(questSlideId) {
    const questSlide = questchainState.questSlides.get(questSlideId);
    if (questSlide) {
        questSlide.requisiteOptionId = null;
        renderQuestSlide(questSlide);
        renderQuestchainConnections();
    }
}
window.removeQuestRequisite = removeQuestRequisite;

function renderQuestchainConnections() {
    const svg = document.getElementById('questConnectionsSvg');
    const canvas = document.getElementById('questCanvas');
    if (!svg || !canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    
    // Remove old paths except preview
    svg.querySelectorAll('path:not(#questConnectionPreview)').forEach(p => p.remove());
    
    // Render option-to-option requirements
    questchainState.requirements.forEach(req => {
        const requiredOption = questchainState.options.get(req.requiredOptionId);
        const dependentOption = questchainState.options.get(req.optionId);
        if (!requiredOption || !dependentOption) return;
        
        const fromEl = document.getElementById(`option-${req.requiredOptionId}`);
        const toEl = document.getElementById(`option-${req.optionId}`);
        if (!fromEl || !toEl) return;
        
        const fromRect = fromEl.getBoundingClientRect();
        const toRect = toEl.getBoundingClientRect();
        
        const fromCenterX = fromRect.left + fromRect.width/2 - rect.left;
        const toCenterX = toRect.left + toRect.width/2 - rect.left;
        
        const useRightConnector = toCenterX >= fromCenterX;
        
        const fromConnector = fromEl.querySelector(useRightConnector ? '.option-connector-right' : '.option-connector-left');
        const toConnector = toEl.querySelector(useRightConnector ? '.option-connector-left' : '.option-connector-right');
        
        if (!fromConnector || !toConnector) return;
        
        const fromConnRect = fromConnector.getBoundingClientRect();
        const toConnRect = toConnector.getBoundingClientRect();
        
        const x1 = fromConnRect.left + fromConnRect.width/2 - rect.left;
        const y1 = fromConnRect.top + fromConnRect.height/2 - rect.top;
        const x2 = toConnRect.left + toConnRect.width/2 - rect.left;
        const y2 = toConnRect.top + toConnRect.height/2 - rect.top;
        
        const distance = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
        const curveStrength = Math.min(distance * 0.3, 80);
        
        const cx1 = useRightConnector ? x1 + curveStrength : x1 - curveStrength;
        const cx2 = useRightConnector ? x2 - curveStrength : x2 + curveStrength;
        
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', `M ${x1} ${y1} C ${cx1} ${y1}, ${cx2} ${y2}, ${x2} ${y2}`);
        path.classList.add('questchain-connection', 'option-requirement');
        path.dataset.from = req.requiredOptionId;
        path.dataset.to = req.optionId;
        
        path.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm(`Remove this requirement?`)) {
                removeOptionRequirement(req.optionId, req.requiredOptionId);
            }
        });
        
        svg.appendChild(path);
    });
    
    // Render option-to-quest connections (quest requisites)
    questchainState.questSlides.forEach(questSlide => {
        if (!questSlide.requisiteOptionId) return;
        
        const option = questchainState.options.get(questSlide.requisiteOptionId);
        if (!option) return;
        
        const fromEl = document.getElementById(`option-${questSlide.requisiteOptionId}`);
        const toEl = document.getElementById(`quest-slide-${questSlide.id}`);
        if (!fromEl || !toEl) return;
        
        // Smart routing - determine which connectors to use based on positions
        const fromRect = fromEl.getBoundingClientRect();
        const toRect = toEl.getBoundingClientRect();
        
        const fromCenterX = fromRect.left + fromRect.width/2 - rect.left;
        const toCenterX = toRect.left + toRect.width/2 - rect.left;
        
        const useRightConnector = toCenterX >= fromCenterX;
        
        const fromConnector = fromEl.querySelector(useRightConnector ? '.option-connector-right' : '.option-connector-left');
        const toConnector = toEl.querySelector(useRightConnector ? '.quest-slide-connector-left' : '.quest-slide-connector-right');
        
        if (!fromConnector || !toConnector) return;
        
        const fromConnRect = fromConnector.getBoundingClientRect();
        const toConnRect = toConnector.getBoundingClientRect();
        
        const x1 = fromConnRect.left + fromConnRect.width/2 - rect.left;
        const y1 = fromConnRect.top + fromConnRect.height/2 - rect.top;
        const x2 = toConnRect.left + toConnRect.width/2 - rect.left;
        const y2 = toConnRect.top + toConnRect.height/2 - rect.top;
        
        const distance = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
        const curveStrength = Math.min(distance * 0.3, 80);
        
        const cx1 = useRightConnector ? x1 + curveStrength : x1 - curveStrength;
        const cx2 = useRightConnector ? x2 - curveStrength : x2 + curveStrength;
        
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', `M ${x1} ${y1} C ${cx1} ${y1}, ${cx2} ${y2}, ${x2} ${y2}`);
        path.classList.add('questchain-connection', 'quest-unlock');
        path.dataset.fromOption = questSlide.requisiteOptionId;
        path.dataset.toQuest = questSlide.id;
        
        path.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm(`Remove this quest unlock connection?`)) {
                removeQuestRequisite(questSlide.id);
            }
        });
        
        svg.appendChild(path);
    });
}

// ==================== SIDEBAR ====================
function setupQuestchainSidebarAutoSave() {
    const inputIds = [
        'qcSidebarIsStart',
        'qcSidebarStatType', 'qcSidebarStatRequired', 'qcSidebarEffectId', 'qcSidebarEffectAmount', 'qcSidebarEnemyId',
        'qcSidebarRewardType', 'qcSidebarRewardStatType', 'qcSidebarRewardStatAmount',
        'qcSidebarRewardItem', 'qcSidebarRewardPerk', 'qcSidebarRewardBlessing', 'qcSidebarRewardPotion',
        'qcSidebarOptionType', 'qcSidebarEnding'
    ];
    
    inputIds.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        
        const eventType = el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input';
        el.addEventListener(eventType, () => {
            if (id === 'qcSidebarOptionType') {
                updateQcOptionTypeFields();
            }
            if (id === 'qcSidebarRewardType') {
                updateQcRewardTypeFields();
            }
            debouncedSaveQcOption();
        });
    });
}

let qcSidebarSaveTimeout = null;
function debouncedSaveQcOption() {
    clearTimeout(qcSidebarSaveTimeout);
    showQcSaveStatus('saving');
    qcSidebarSaveTimeout = setTimeout(() => {
        saveQcOptionFromSidebar();
        showQcSaveStatus('saved');
    }, 500);
}

function showQcSaveStatus(status) {
    const statusEl = document.getElementById('qcSidebarSaveStatus');
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
    }
}

function updateQuestchainSidebar() {
    const noSelection = document.getElementById('qcSidebarNoSelection');
    const questSlideContent = document.getElementById('qcSidebarQuestSlideContent');
    const optionContent = document.getElementById('qcSidebarOptionContent');
    
    // Hide all by default
    if (noSelection) noSelection.style.display = 'flex';
    if (questSlideContent) questSlideContent.style.display = 'none';
    if (optionContent) optionContent.style.display = 'none';
    
    // Show option sidebar if option is selected
    if (questchainState.selectedOption) {
        const option = questchainState.options.get(questchainState.selectedOption);
        if (option) {
            if (noSelection) noSelection.style.display = 'none';
            if (optionContent) optionContent.style.display = 'block';
            populateOptionSidebar(option);
            return;
        }
    }
    
    // Show quest slide sidebar if quest slide is selected
    if (questchainState.selectedQuestSlide) {
        const questSlide = questchainState.questSlides.get(questchainState.selectedQuestSlide);
        if (questSlide) {
            if (noSelection) noSelection.style.display = 'none';
            if (questSlideContent) questSlideContent.style.display = 'block';
            populateQuestSlideSidebar(questSlide);
            return;
        }
    }
}

function populateQuestSlideSidebar(questSlide) {
    document.getElementById('qcSidebarQuestSlideId').textContent = `Quest Slide #${questSlide.id}`;
    document.getElementById('qcSidebarQuestName').value = questSlide.questName || '';
    document.getElementById('qcSidebarIsStartQuest').checked = questSlide.isStart || false;
    document.getElementById('qcSidebarEnding').value = questSlide.ending || '';
    
    // Show requisite info
    const requisiteDiv = document.getElementById('qcSidebarRequisite');
    if (requisiteDiv) {
        if (questSlide.requisiteOptionId) {
            const option = questchainState.options.get(questSlide.requisiteOptionId);
            requisiteDiv.innerHTML = `<span class="requisite-tag" onclick="removeQuestRequisite(${questSlide.id})">${option?.optionText || `Option #${questSlide.requisiteOptionId}`} ×</span>`;
        } else {
            requisiteDiv.innerHTML = '<span class="vis-none">None (always available)</span>';
        }
    }
}

function populateOptionSidebar(option) {
    document.getElementById('qcSidebarOptionId').textContent = `Option #${option.id}`;
    document.getElementById('qcSidebarIsStart').checked = option.isStart || false;
    
    // Determine option type
    let optionType = 'dialogue';
    if (option.enemyId) optionType = 'combat';
    else if (option.effectId) optionType = 'effect_check';
    else if (option.statType) optionType = 'stat_check';
    
    document.getElementById('qcSidebarOptionType').value = optionType;
    updateQcOptionTypeFields();
    
    document.getElementById('qcSidebarStatType').value = option.statType || '';
    document.getElementById('qcSidebarStatRequired').value = option.statRequired || '';
    document.getElementById('qcSidebarEffectId').value = option.effectId || '';
    document.getElementById('qcSidebarEffectAmount').value = option.effectAmount || '';
    document.getElementById('qcSidebarEnemyId').value = option.enemyId || '';
    
    // Update enemy picker visual
    document.querySelectorAll('.qc-enemy-picker-item').forEach(item => {
        item.classList.toggle('selected', option.enemyId && item.dataset.enemyId == option.enemyId);
    });
    
    // Determine reward type
    let rewardType = '';
    if (option.rewardTalent) rewardType = 'talent';
    else if (option.rewardItem) rewardType = 'item';
    else if (option.rewardPotion) rewardType = 'potion';
    else if (option.rewardPerk) rewardType = 'perk';
    else if (option.rewardBlessing) rewardType = 'blessing';
    else if (option.rewardStatType) rewardType = 'stat';
    
    document.getElementById('qcSidebarRewardType').value = rewardType;
    updateQcRewardTypeFields();
    
    document.getElementById('qcSidebarRewardStatType').value = option.rewardStatType || '';
    document.getElementById('qcSidebarRewardStatAmount').value = option.rewardStatAmount || '';
    document.getElementById('qcSidebarRewardItem').value = option.rewardItem || '';
    document.getElementById('qcSidebarRewardPerk').value = option.rewardPerk || '';
    document.getElementById('qcSidebarRewardBlessing').value = option.rewardBlessing || '';
    document.getElementById('qcSidebarRewardPotion').value = option.rewardPotion || '';
    
    // Update requirements display
    updateQcRequirementsDisplay(option.id);
}

function updateQcOptionTypeFields() {
    const optionType = document.getElementById('qcSidebarOptionType')?.value || 'dialogue';
    
    document.getElementById('qcOptionTypeStatCheck')?.style && (document.getElementById('qcOptionTypeStatCheck').style.display = 'none');
    document.getElementById('qcOptionTypeEffectCheck')?.style && (document.getElementById('qcOptionTypeEffectCheck').style.display = 'none');
    document.getElementById('qcOptionTypeCombat')?.style && (document.getElementById('qcOptionTypeCombat').style.display = 'none');
    
    switch (optionType) {
        case 'stat_check':
            document.getElementById('qcOptionTypeStatCheck') && (document.getElementById('qcOptionTypeStatCheck').style.display = 'block');
            break;
        case 'effect_check':
            document.getElementById('qcOptionTypeEffectCheck') && (document.getElementById('qcOptionTypeEffectCheck').style.display = 'block');
            break;
        case 'combat':
            document.getElementById('qcOptionTypeCombat') && (document.getElementById('qcOptionTypeCombat').style.display = 'block');
            break;
    }
}

function updateQcRewardTypeFields() {
    const rewardType = document.getElementById('qcSidebarRewardType')?.value || '';
    
    document.getElementById('qcRewardTypeStat')?.style && (document.getElementById('qcRewardTypeStat').style.display = 'none');
    document.getElementById('qcRewardTypeItem')?.style && (document.getElementById('qcRewardTypeItem').style.display = 'none');
    document.getElementById('qcRewardTypePotion')?.style && (document.getElementById('qcRewardTypePotion').style.display = 'none');
    document.getElementById('qcRewardTypePerk')?.style && (document.getElementById('qcRewardTypePerk').style.display = 'none');
    document.getElementById('qcRewardTypeBlessing')?.style && (document.getElementById('qcRewardTypeBlessing').style.display = 'none');
    
    switch (rewardType) {
        case 'stat':
            document.getElementById('qcRewardTypeStat') && (document.getElementById('qcRewardTypeStat').style.display = 'block');
            break;
        case 'item':
            document.getElementById('qcRewardTypeItem') && (document.getElementById('qcRewardTypeItem').style.display = 'block');
            break;
        case 'potion':
            document.getElementById('qcRewardTypePotion') && (document.getElementById('qcRewardTypePotion').style.display = 'block');
            break;
        case 'perk':
            document.getElementById('qcRewardTypePerk') && (document.getElementById('qcRewardTypePerk').style.display = 'block');
            break;
        case 'blessing':
            document.getElementById('qcRewardTypeBlessing') && (document.getElementById('qcRewardTypeBlessing').style.display = 'block');
            break;
    }
}

function updateQcRequirementsDisplay(optionId) {
    const requiresDiv = document.getElementById('qcSidebarRequires');
    const requiredByDiv = document.getElementById('qcSidebarRequiredBy');
    
    if (!requiresDiv || !requiredByDiv) return;
    
    const requires = questchainState.requirements.filter(r => r.optionId === optionId);
    const requiredBy = questchainState.requirements.filter(r => r.requiredOptionId === optionId);
    
    requiresDiv.innerHTML = requires.length > 0 
        ? requires.map(r => {
            const reqOpt = questchainState.options.get(r.requiredOptionId);
            return `<span class="vis-tag requires" onclick="removeOptionRequirement(${optionId}, ${r.requiredOptionId})">${reqOpt?.optionText || `Option #${r.requiredOptionId}`} ×</span>`;
        }).join('')
        : '<span class="vis-none">None</span>';
    
    requiredByDiv.innerHTML = requiredBy.length > 0
        ? requiredBy.map(r => {
            const depOpt = questchainState.options.get(r.optionId);
            return `<span class="vis-tag required-by">${depOpt?.optionText || `Option #${r.optionId}`}</span>`;
        }).join('')
        : '<span class="vis-none">None</span>';
}

function saveQcOptionFromSidebar() {
    const optionId = questchainState.selectedOption;
    const option = questchainState.options.get(optionId);
    if (!option) return;
    
    option.isStart = document.getElementById('qcSidebarIsStart').checked;
    
    const optionType = document.getElementById('qcSidebarOptionType').value || 'dialogue';
    
    // Clear all type-specific fields
    option.statType = null;
    option.statRequired = null;
    option.effectId = null;
    option.effectAmount = null;
    option.enemyId = null;
    
    switch (optionType) {
        case 'stat_check':
            option.statType = document.getElementById('qcSidebarStatType').value || null;
            option.statRequired = parseInt(document.getElementById('qcSidebarStatRequired').value) || null;
            break;
        case 'effect_check':
            option.effectId = parseInt(document.getElementById('qcSidebarEffectId').value) || null;
            option.effectAmount = parseInt(document.getElementById('qcSidebarEffectAmount').value) || null;
            break;
        case 'combat':
            option.enemyId = parseInt(document.getElementById('qcSidebarEnemyId').value) || null;
            break;
    }
    
    const rewardType = document.getElementById('qcSidebarRewardType').value || '';
    
    // Clear all reward fields
    option.rewardStatType = null;
    option.rewardStatAmount = null;
    option.rewardTalent = false;
    option.rewardItem = null;
    option.rewardPerk = null;
    option.rewardBlessing = null;
    option.rewardPotion = null;
    
    switch (rewardType) {
        case 'stat':
            option.rewardStatType = document.getElementById('qcSidebarRewardStatType').value || null;
            option.rewardStatAmount = parseInt(document.getElementById('qcSidebarRewardStatAmount').value) || null;
            break;
        case 'talent':
            option.rewardTalent = true;
            break;
        case 'item':
            option.rewardItem = parseInt(document.getElementById('qcSidebarRewardItem').value) || null;
            break;
        case 'potion':
            option.rewardPotion = parseInt(document.getElementById('qcSidebarRewardPotion').value) || null;
            break;
        case 'perk':
            option.rewardPerk = parseInt(document.getElementById('qcSidebarRewardPerk').value) || null;
            break;
        case 'blessing':
            option.rewardBlessing = parseInt(document.getElementById('qcSidebarRewardBlessing').value) || null;
            break;
    }
    
    // Re-render the parent quest slide to show updated option
    const questSlide = questchainState.questSlides.get(option.questSlideId);
    if (questSlide) {
        renderQuestSlide(questSlide);
    }
    
    console.log('✅ Option updated from sidebar');
}

function selectQcEnemy(enemyId) {
    const input = document.getElementById('qcSidebarEnemyId');
    if (input) input.value = enemyId;
    
    document.querySelectorAll('.qc-enemy-picker-item').forEach(item => {
        item.classList.toggle('selected', item.dataset.enemyId == enemyId);
    });
    
    debouncedSaveQcOption();
}
window.selectQcEnemy = selectQcEnemy;

// ==================== SETTLEMENTS & QUESTCHAINS ====================
function populateQuestchainSettlementDropdown() {
    const select = document.getElementById('questchainSettlementSelect');
    if (!select) return;
    
    select.innerHTML = '';
    
    const settlements = GlobalData?.settlements || [];
    settlements.forEach(settlement => {
        const option = document.createElement('option');
        option.value = settlement.settlement_id;
        option.textContent = settlement.settlement_name || `Settlement #${settlement.settlement_id}`;
        select.appendChild(option);
    });
    
    if (settlements.length > 0) {
        const firstSettlement = settlements[0];
        select.value = firstSettlement.settlement_id;
        questchainState.settlementId = firstSettlement.settlement_id;
        loadQuestchainsForSettlement(firstSettlement.settlement_id);
    }
}

function onQuestchainSettlementChange() {
    const select = document.getElementById('questchainSettlementSelect');
    if (!select) return;
    
    questchainState.settlementId = select.value ? parseInt(select.value) : null;
    
    console.log(`🏘️ Questchain settlement changed to: ${questchainState.settlementId}`);
    
    // Reset state
    resetQuestchainState();
    loadQuestchainsForSettlement(questchainState.settlementId);
}
window.onQuestchainSettlementChange = onQuestchainSettlementChange;

function resetQuestchainState() {
    questchainState.questchainId = null;
    questchainState.questchainName = '';
    questchainState.questchainDescription = '';
    questchainState.questSlides.clear();
    questchainState.options.clear();
    questchainState.requirements = [];
    questchainState.serverQuestSlides.clear();
    questchainState.serverOptions.clear();
    questchainState.serverRequirements.clear();
    questchainState.originalQuestSlides.clear();
    questchainState.originalOptions.clear();
    questchainState.selectedQuestSlide = null;
    questchainState.selectedOption = null;
    questchainState.nextQuestSlideId = 1;
    questchainState.nextOptionId = 1;
    
    const nameInput = document.getElementById('questchainNameInput');
    if (nameInput) nameInput.value = '';
    
    clearQuestchainCanvas();
    updateQuestchainSidebar();
}

function clearQuestchainCanvas() {
    const container = document.getElementById('questOptionsContainer');
    if (container) {
        container.querySelectorAll('.quest-slide-node').forEach(el => el.remove());
    }
    renderQuestchainConnections();
    updateQuestchainCounter();
}

async function loadQuestchainsForSettlement(settlementId) {
    console.log(`📥 Loading questchains for settlement: ${settlementId}`);
    
    try {
        const token = await getCurrentAccessToken();
        if (!token) throw new Error('Not authenticated');
        
        let url = 'http://localhost:8080/api/getQuestchains';
        if (settlementId) {
            url += `?settlementId=${settlementId}`;
        }
        
        const response = await fetch(url, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!response.ok) throw new Error('Failed to fetch questchains');
        
        const data = await response.json();
        
        questchainState.questchains.clear();
        
        if (data.questchains) {
            data.questchains.forEach(qc => {
                questchainState.questchains.set(qc.questchain_id, {
                    questchainId: qc.questchain_id,
                    name: qc.name,
                    description: qc.description,
                    settlementId: qc.settlement_id
                });
            });
        }
        
        populateQuestchainDropdown();
        
        console.log(`✅ Loaded ${questchainState.questchains.size} questchains`);
    } catch (error) {
        console.error('Failed to load questchains:', error);
    }
}

function populateQuestchainDropdown() {
    const select = document.getElementById('questchainSelect');
    if (!select) return;
    
    select.innerHTML = '<option value="">-- New Questchain --</option>';
    
    questchainState.questchains.forEach(qc => {
        const option = document.createElement('option');
        option.value = qc.questchainId;
        option.textContent = qc.name || `Questchain #${qc.questchainId}`;
        select.appendChild(option);
    });
}

function onQuestchainChange() {
    const select = document.getElementById('questchainSelect');
    if (!select) return;
    
    const value = select.value;
    
    if (!value) {
        // New questchain mode
        resetQuestchainState();
        questchainState.settlementId = document.getElementById('questchainSettlementSelect')?.value || null;
        return;
    }
    
    const questchainId = parseInt(value);
    loadQuestchainData(questchainId);
}
window.onQuestchainChange = onQuestchainChange;

async function loadQuestchainData(questchainId) {
    console.log(`📥 Loading questchain data: ${questchainId}`);
    
    try {
        const token = await getCurrentAccessToken();
        if (!token) throw new Error('Not authenticated');
        
        const response = await fetch(`http://localhost:8080/api/getQuestchainData?questchainId=${questchainId}`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!response.ok) throw new Error('Failed to fetch questchain data');
        
        const data = await response.json();
        
        // Reset state
        resetQuestchainState();
        
        // Set questchain info
        questchainState.questchainId = questchainId;
        questchainState.questchainName = data.questchain?.name || '';
        questchainState.questchainDescription = data.questchain?.description || '';
        questchainState.settlementId = data.questchain?.settlement_id;
        
        const nameInput = document.getElementById('questchainNameInput');
        if (nameInput) nameInput.value = questchainState.questchainName;
        
        // Process quests (quest slides)
        let maxQuestSlideId = 0;
        const serverToLocalQuestSlide = new Map();
        
        if (data.quests) {
            data.quests.forEach((q, idx) => {
                const localId = idx + 1;
                maxQuestSlideId = Math.max(maxQuestSlideId, localId);
                
                serverToLocalQuestSlide.set(q.quest_id, localId);
                
                const questSlide = {
                    id: localId,
                    questName: q.quest_name || '',
                    isStart: q.default_entry || false,
                    defaultEntry: q.default_entry || false,
                    x: q.pos_x || 100 + (idx % 3) * 400,
                    y: q.pos_y || 100 + Math.floor(idx / 3) * 350,
                    assetId: q.asset_id,
                    assetUrl: q.asset_id ? questchainState.questAssets.find(a => a.id === q.asset_id)?.url : null,
                    ending: q.ending,
                    requisiteOptionId: null, // Will be set after options are loaded
                    sortOrder: q.sort_order || idx
                };
                
                questchainState.questSlides.set(localId, questSlide);
                questchainState.serverQuestSlides.set(localId, q.quest_id);
                questchainState.originalQuestSlides.set(localId, { ...questSlide });
            });
        }
        questchainState.nextQuestSlideId = maxQuestSlideId + 1;
        
        // Process options
        let maxOptionId = 0;
        const serverToLocalOption = new Map();
        
        if (data.options) {
            data.options.forEach((opt, idx) => {
                const localId = idx + 1;
                maxOptionId = Math.max(maxOptionId, localId);
                
                serverToLocalOption.set(opt.option_id, localId);
                
                const questSlideLocalId = serverToLocalQuestSlide.get(opt.quest_id);
                
                const option = {
                    id: localId,
                    questSlideId: questSlideLocalId,
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
                };
                
                questchainState.options.set(localId, option);
                questchainState.serverOptions.set(localId, opt.option_id);
                questchainState.originalOptions.set(localId, { ...option });
            });
        }
        questchainState.nextOptionId = maxOptionId + 1;
        
        // Set requisite option IDs for quests
        if (data.quests) {
            data.quests.forEach(q => {
                if (q.requisite_option_id) {
                    const localQuestSlideId = serverToLocalQuestSlide.get(q.quest_id);
                    const localOptionId = serverToLocalOption.get(q.requisite_option_id);
                    const questSlide = questchainState.questSlides.get(localQuestSlideId);
                    if (questSlide && localOptionId) {
                        questSlide.requisiteOptionId = localOptionId;
                    }
                }
            });
        }
        
        // Process requirements
        if (data.requirements) {
            data.requirements.forEach(r => {
                const optionLocal = serverToLocalOption.get(r.option_id);
                const requiredLocal = serverToLocalOption.get(r.required_option_id);
                if (optionLocal && requiredLocal) {
                    questchainState.requirements.push({
                        optionId: optionLocal,
                        requiredOptionId: requiredLocal
                    });
                    questchainState.serverRequirements.add(`${r.option_id}-${r.required_option_id}`);
                }
            });
        }
        
        // Render everything
        questchainState.questSlides.forEach(qs => renderQuestSlide(qs));
        renderQuestchainConnections();
        updateQuestchainCounter();
        resetQuestchainView();
        
        console.log(`✅ Loaded questchain with ${questchainState.questSlides.size} quests, ${questchainState.options.size} options`);
    } catch (error) {
        console.error('Failed to load questchain data:', error);
    }
}

// ==================== DROPDOWN POPULATION ====================
function populateQuestchainDropdowns() {
    populateQuestchainSettlementDropdown();
    populateQcSidebarDropdowns();
    questchainState.dropdownsPopulated = true;
}

function populateQcSidebarDropdowns() {
    // Enemies - populate grid picker
    const enemyGrid = document.getElementById('qcEnemyPickerGrid');
    if (enemyGrid && enemyGrid.children.length === 0) {
        let enemies = [];
        if (typeof allEnemies !== 'undefined' && allEnemies.length > 0) {
            enemies = allEnemies;
        } else if (typeof getEnemies === 'function') {
            enemies = getEnemies();
        } else if (typeof GlobalData !== 'undefined' && GlobalData.enemies) {
            enemies = GlobalData.enemies;
        }
        
        console.log('Populating questchain enemy grid with', enemies.length, 'enemies');
        
        if (enemies.length === 0) {
            enemyGrid.innerHTML = '<p style="color:#888;text-align:center;grid-column:1/-1;font-size:0.75rem;">No enemies loaded</p>';
        } else {
            enemies.forEach(enemy => {
                const iconUrl = enemy.icon || `https://gamedata-assets.s3.eu-north-1.amazonaws.com/images/enemies/${enemy.assetId}.webp`;
                const item = document.createElement('div');
                item.className = 'qc-enemy-picker-item';
                item.dataset.enemyId = enemy.enemyId || enemy.id;
                item.innerHTML = `
                    <img src="${iconUrl}" alt="${enemy.enemyName || enemy.name}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2280%22>👹</text></svg>'">
                    <span>${enemy.enemyName || enemy.name || 'Enemy #' + (enemy.enemyId || enemy.id)}</span>
                `;
                item.addEventListener('click', () => selectQcEnemy(enemy.enemyId || enemy.id));
                enemyGrid.appendChild(item);
            });
        }
    }
    
    // Items
    const items = typeof getItems === 'function' ? getItems() : (GlobalData?.items || []);
    const itemSelect = document.getElementById('qcSidebarRewardItem');
    if (itemSelect && itemSelect.options.length <= 1) {
        items.filter(i => i.type !== 'potion').forEach(item => {
            const opt = document.createElement('option');
            opt.value = item.id;
            opt.textContent = `${item.name || 'Item #' + item.id}`;
            itemSelect.appendChild(opt);
        });
    }
    
    // Potions
    const potionSelect = document.getElementById('qcSidebarRewardPotion');
    if (potionSelect && potionSelect.options.length <= 1) {
        items.filter(i => i.type === 'potion').forEach(item => {
            const opt = document.createElement('option');
            opt.value = item.id;
            opt.textContent = `${item.name || 'Potion #' + item.id}`;
            potionSelect.appendChild(opt);
        });
    }
    
    // Perks
    const perks = typeof getPerks === 'function' ? getPerks() : (GlobalData?.perks || []);
    const perkSelect = document.getElementById('qcSidebarRewardPerk');
    if (perkSelect && perkSelect.options.length <= 1) {
        perks.filter(p => !p.is_blessing).forEach(perk => {
            const opt = document.createElement('option');
            opt.value = perk.id;
            opt.textContent = `${perk.name || 'Perk #' + perk.id}`;
            perkSelect.appendChild(opt);
        });
    }
    
    // Blessings
    const blessingSelect = document.getElementById('qcSidebarRewardBlessing');
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
    const effectSelect = document.getElementById('qcSidebarEffectId');
    if (effectSelect && effectSelect.options.length <= 1) {
        effects.forEach(effect => {
            const opt = document.createElement('option');
            opt.value = effect.id || effect.effect_id;
            opt.textContent = `${effect.name || effect.effect_name || 'Effect #' + (effect.id || effect.effect_id)}`;
            effectSelect.appendChild(opt);
        });
    }
}

// ==================== COUNTER ====================
function updateQuestchainCounter() {
    const counter = document.getElementById('questchainCounter');
    if (!counter) return;
    
    const questCount = questchainState.questSlides.size;
    const optionCount = questchainState.options.size;
    counter.textContent = `${questCount} quests, ${optionCount} options`;
}

// ==================== MODALS ====================
function openNewQuestchainModal() {
    document.getElementById('newQuestchainName')?.value && (document.getElementById('newQuestchainName').value = '');
    document.getElementById('newQuestchainModal')?.classList.add('open');
}
window.openNewQuestchainModal = openNewQuestchainModal;

function closeNewQuestchainModal() {
    document.getElementById('newQuestchainModal')?.classList.remove('open');
}
window.closeNewQuestchainModal = closeNewQuestchainModal;

async function createNewQuestchain() {
    const name = document.getElementById('newQuestchainName')?.value?.trim();
    if (!name) {
        alert('Please enter a questchain name');
        return;
    }
    
    try {
        const token = await getCurrentAccessToken();
        if (!token) throw new Error('Not authenticated');
        
        const response = await fetch('http://localhost:8080/api/createQuestchain', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                name: name,
                settlementId: questchainState.settlementId
            })
        });
        
        if (!response.ok) throw new Error(await response.text());
        
        const result = await response.json();
        
        // Add to state
        questchainState.questchains.set(result.questchainId, {
            questchainId: result.questchainId,
            name: name,
            settlementId: questchainState.settlementId
        });
        
        // Select new questchain
        questchainState.questchainId = result.questchainId;
        questchainState.questchainName = name;
        
        populateQuestchainDropdown();
        document.getElementById('questchainSelect').value = result.questchainId;
        
        const nameInput = document.getElementById('questchainNameInput');
        if (nameInput) nameInput.value = name;
        
        closeNewQuestchainModal();
        
        console.log(`✅ Questchain created: ${name} (ID: ${result.questchainId})`);
    } catch (error) {
        console.error('Failed to create questchain:', error);
        alert(`Failed to create questchain: ${error.message}`);
    }
}
window.createNewQuestchain = createNewQuestchain;

// ==================== CHANGE DETECTION ====================
function isQuestSlideModified(localId) {
    const questSlide = questchainState.questSlides.get(localId);
    const original = questchainState.originalQuestSlides.get(localId);
    if (!questSlide || !original) return false;
    
    return questSlide.questName !== original.questName ||
           questSlide.isStart !== original.isStart ||
           questSlide.ending !== original.ending ||
           questSlide.assetId !== original.assetId ||
           questSlide.requisiteOptionId !== original.requisiteOptionId;
}

function isOptionModified(localId) {
    const option = questchainState.options.get(localId);
    const original = questchainState.originalOptions.get(localId);
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

function checkAndUpdateQuestSlideModifiedState(el, questSlide) {
    const isNew = !questchainState.serverQuestSlides.has(questSlide.id);
    const isModified = !isNew && isQuestSlideModified(questSlide.id);
    el.classList.toggle('new-quest-slide', isNew);
    el.classList.toggle('modified-quest-slide', isModified);
}

function checkAndUpdateOptionModifiedState(el, option) {
    const isNew = !questchainState.serverOptions.has(option.id);
    const isModified = !isNew && isOptionModified(option.id);
    el.classList.toggle('new-option', isNew);
    el.classList.toggle('modified-option', isModified);
}

// ==================== SAVE ====================
async function saveQuestchain() {
    if (!questchainState.questchainId && !questchainState.questchainName) {
        const nameInput = document.getElementById('questchainNameInput');
        questchainState.questchainName = nameInput?.value?.trim() || '';
        
        if (!questchainState.questchainName) {
            alert('Please enter a questchain name');
            return;
        }
    }
    
    const saveBtn = document.getElementById('saveQuestchainBtn');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = '⏳ Saving...';
    }
    
    try {
        const token = await getCurrentAccessToken();
        if (!token) throw new Error('Not authenticated');
        
        // Collect data
        const questSlides = [];
        const newOptions = [];
        const optionUpdates = [];
        
        questchainState.questSlides.forEach((qs, localId) => {
            const isNew = !questchainState.serverQuestSlides.has(localId);
            
            questSlides.push({
                localId: localId,
                questId: questchainState.serverQuestSlides.get(localId) || null,
                questName: qs.questName,
                isStart: qs.isStart,
                defaultEntry: qs.defaultEntry,
                ending: qs.ending,
                assetId: qs.assetId,
                posX: qs.x,
                posY: qs.y,
                requisiteOptionLocalId: qs.requisiteOptionId,
                sortOrder: qs.sortOrder,
                isNew: isNew,
                isModified: !isNew && isQuestSlideModified(localId)
            });
        });
        
        questchainState.options.forEach((opt, localId) => {
            const isNew = !questchainState.serverOptions.has(localId);
            
            const optionData = {
                localId: localId,
                optionId: questchainState.serverOptions.get(localId) || null,
                questSlideLocalId: opt.questSlideId,
                nodeText: opt.nodeText,
                optionText: opt.optionText,
                isStart: opt.isStart,
                statType: opt.statType,
                statRequired: opt.statRequired,
                effectId: opt.effectId,
                effectAmount: opt.effectAmount,
                enemyId: opt.enemyId,
                rewardStatType: opt.rewardStatType,
                rewardStatAmount: opt.rewardStatAmount,
                rewardTalent: opt.rewardTalent,
                rewardItem: opt.rewardItem,
                rewardPerk: opt.rewardPerk,
                rewardBlessing: opt.rewardBlessing,
                rewardPotion: opt.rewardPotion
            };
            
            if (isNew) {
                newOptions.push(optionData);
            } else if (isOptionModified(localId)) {
                optionUpdates.push(optionData);
            }
        });
        
        // Collect requirements
        const requirements = questchainState.requirements.map(r => ({
            optionLocalId: r.optionId,
            requiredOptionLocalId: r.requiredOptionId
        }));
        
        const payload = {
            questchainId: questchainState.questchainId,
            questchainName: questchainState.questchainName,
            settlementId: questchainState.settlementId,
            isNewQuestchain: !questchainState.questchainId,
            questSlides: questSlides,
            newOptions: newOptions,
            optionUpdates: optionUpdates,
            requirements: requirements
        };
        
        console.log('Save payload:', JSON.stringify(payload, null, 2));
        
        const response = await fetch('http://localhost:8080/api/saveQuestchain', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) throw new Error(await response.text());
        
        const result = await response.json();
        
        if (result.success) {
            // Update IDs if new questchain was created
            if (!questchainState.questchainId && result.questchainId) {
                questchainState.questchainId = result.questchainId;
                questchainState.questchains.set(result.questchainId, {
                    questchainId: result.questchainId,
                    name: questchainState.questchainName,
                    settlementId: questchainState.settlementId
                });
                populateQuestchainDropdown();
                document.getElementById('questchainSelect').value = result.questchainId;
            }
            
            // Update server mappings
            if (result.questSlideMapping) {
                for (const [localIdStr, serverId] of Object.entries(result.questSlideMapping)) {
                    const localId = parseInt(localIdStr);
                    questchainState.serverQuestSlides.set(localId, serverId);
                    const qs = questchainState.questSlides.get(localId);
                    if (qs) {
                        questchainState.originalQuestSlides.set(localId, { ...qs });
                    }
                }
            }
            
            if (result.optionMapping) {
                for (const [localIdStr, serverId] of Object.entries(result.optionMapping)) {
                    const localId = parseInt(localIdStr);
                    questchainState.serverOptions.set(localId, serverId);
                    const opt = questchainState.options.get(localId);
                    if (opt) {
                        questchainState.originalOptions.set(localId, { ...opt });
                    }
                }
            }
            
            // Re-render to update visual states
            questchainState.questSlides.forEach(qs => renderQuestSlide(qs));
            renderQuestchainConnections();
            
            alert('✅ Questchain saved successfully!');
        } else {
            throw new Error(result.message || 'Unknown error');
        }
    } catch (error) {
        console.error('Failed to save questchain:', error);
        alert(`❌ Failed to save questchain: ${error.message}`);
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = '💾 Save';
        }
    }
}
window.saveQuestchain = saveQuestchain;

// ==================== HELPERS ====================
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

// Export
window.initQuestchainDesigner = initQuestchainDesigner;
