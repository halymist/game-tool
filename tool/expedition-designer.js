// Expedition Designer - Visual Slide Network Editor (Inline Editing)
console.log('📦 expedition-designer.js LOADED');

// ==================== STATE ====================
const expeditionState = {
    slides: new Map(),
    connections: [],
    selectedSlide: null,
    nextSlideId: 1,
    canvasOffset: { x: 0, y: 0 },
    zoom: 1,
    isDragging: false,
    lastMouse: { x: 0, y: 0 },
    isConnecting: false,
    connectionStart: null,
    dropdownsPopulated: false,
    // Track which slides are from server (by their toolingId)
    serverSlides: new Map(), // localId -> toolingId
    serverOptions: new Map(), // "localSlideId-optionIndex" -> toolingId
    serverOutcomes: new Set(), // Set of "optionToolingId-targetToolingId" keys
    // Track original values for change detection
    originalSlides: new Map(), // localId -> { text, assetId, effectId, effectFactor, isStart, reward, ... }
    originalOptions: new Map() // "localSlideId-optionIndex" -> { text, type, statType, statRequired, ... }
};

// ==================== INITIALIZATION ====================
function initExpeditionDesigner() {
    console.log('🗺️ initExpeditionDesigner called');
    
    const canvas = document.getElementById('expeditionCanvas');
    if (!canvas) {
        console.error('❌ expeditionCanvas not found');
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
        // Allow right-click menu but prevent it during panning
        if (expeditionState.isDragging) e.preventDefault();
    });
    
    // Zoom with mouse wheel - use document-level capture to prevent browser interference
    document.addEventListener('wheel', function(e) {
        const canvas = document.getElementById('expeditionCanvas');
        if (!canvas) return;
        
        // Check if mouse is over the canvas
        const rect = canvas.getBoundingClientRect();
        if (e.clientX >= rect.left && e.clientX <= rect.right &&
            e.clientY >= rect.top && e.clientY <= rect.bottom) {
            e.preventDefault();
            e.stopPropagation();
            onCanvasWheel(e);
        }
    }, { passive: false, capture: true });
    console.log('✅ Wheel event listener attached to document (capture phase)');
    
    // Populate dropdowns after data loads - retry a few times
    let retryCount = 0;
    const tryPopulateDropdowns = () => {
        populateDropdownsOnce();
        if (!expeditionState.dropdownsPopulated && retryCount < 5) {
            retryCount++;
            setTimeout(tryPopulateDropdowns, 2000);
        }
    };
    setTimeout(tryPopulateDropdowns, 1500);
    
    // Button events
    document.getElementById('addSlideBtn')?.addEventListener('click', addSlide);
    document.getElementById('resetViewBtn')?.addEventListener('click', resetView);
    
    // Modal events - use onclick for more reliable binding
    const cancelBtn = document.getElementById('optionModalCancel');
    const saveBtn = document.getElementById('optionModalSave');
    
    if (cancelBtn) {
        cancelBtn.onclick = function(e) {
            e.preventDefault();
            e.stopPropagation();
            closeOptionModal();
        };
    }
    
    if (saveBtn) {
        saveBtn.onclick = function(e) {
            e.preventDefault();
            e.stopPropagation();
            saveOptionFromModal();
        };
    }
    
    // Close modal on backdrop click
    const modal = document.getElementById('optionModal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeOptionModal();
        });
    }
    
    updateCounter();
    console.log('✅ Expedition Designer ready');
    
    // Load expedition assets from S3
    loadBgAssets();
    
    // Auto-load expedition data from server
    setTimeout(() => {
        console.log('🔄 Auto-loading expedition...');
        loadExpedition().catch(err => {
            console.log('ℹ️ No expedition data to load or load failed:', err.message);
        });
    }, 500);
}

// ==================== ADD SLIDE ====================
function addSlide() {
    console.log('➕ addSlide called');
    
    const canvas = document.getElementById('expeditionCanvas');
    const container = document.getElementById('slidesContainer');
    
    if (!canvas || !container) {
        console.error('❌ Canvas or container not found');
        return;
    }
    
    const rect = canvas.getBoundingClientRect();
    const id = expeditionState.nextSlideId++;
    
    // Position new slides in the visible center of the viewport
    // Account for current pan offset so slide appears in center of view
    const slide = {
        id: id,
        text: '',
        isStart: expeditionState.slides.size === 0,
        x: (rect.width / 2 - expeditionState.canvasOffset.x) / expeditionState.zoom - 180 + (Math.random() - 0.5) * 100,
        y: (rect.height / 2 - expeditionState.canvasOffset.y) / expeditionState.zoom - 240 + (Math.random() - 0.5) * 100,
        options: [],
        assetUrl: null,
        reward: null,
        effect: null  // { effectId, effectFactor }
    };
    
    expeditionState.slides.set(id, slide);
    renderSlide(slide);
    updateCounter();
    
    console.log(`✅ Slide #${id} created`);
}

// ==================== RENDER SLIDE ====================
function renderSlide(slide) {
    const container = document.getElementById('slidesContainer');
    if (!container) return;
    
    // Remove if exists
    document.getElementById(`slide-${slide.id}`)?.remove();
    
    const el = document.createElement('div');
    el.id = `slide-${slide.id}`;
    const isNewSlide = !expeditionState.serverSlides.has(slide.id);
    const isModified = !isNewSlide && isSlideModified(slide.id);
    el.className = `expedition-slide${slide.isStart ? ' start-slide' : ''}${expeditionState.selectedSlide === slide.id ? ' selected' : ''}${isNewSlide ? ' new-slide' : ''}${isModified ? ' modified-slide' : ''}`;
    el.style.left = `${slide.x}px`;
    el.style.top = `${slide.y}px`;
    
    // Build effect display (applied when entering this slide)
    let effectHtml = '';
    if (slide.effect && slide.effect.effectId) {
        effectHtml = `
            <div class="slide-effect" data-slide="${slide.id}">
                <span class="effect-icon">⚡</span>
                <span class="effect-label">Effect #${slide.effect.effectId}: ${slide.effect.effectFactor > 0 ? '+' : ''}${slide.effect.effectFactor}</span>
                <button class="effect-edit-btn" data-slide="${slide.id}" title="Edit effect">⚙️</button>
                <button class="effect-delete-btn" data-slide="${slide.id}" title="Remove effect">×</button>
            </div>
        `;
    } else {
        effectHtml = `<button class="add-effect-btn" data-slide="${slide.id}">+ Add Effect</button>`;
    }
    
    // Build reward display
    let rewardHtml = '';
    if (slide.reward && slide.reward.type) {
        const rewardIcon = getRewardIcon(slide.reward.type);
        const rewardLabel = getRewardLabel(slide.reward);
        rewardHtml = `
            <div class="slide-reward" data-slide="${slide.id}">
                <span class="reward-icon">${rewardIcon}</span>
                <span class="reward-label">${rewardLabel}</span>
                <button class="reward-edit-btn" data-slide="${slide.id}" title="Edit reward">⚙️</button>
                <button class="reward-delete-btn" data-slide="${slide.id}" title="Remove reward">×</button>
            </div>
        `;
    } else {
        rewardHtml = `<button class="add-reward-btn" data-slide="${slide.id}">+ Add Reward</button>`;
    }
    
    const optionsHtml = slide.options.map((opt, i) => {
        // Build details badge based on option type
        let detailsBadge = '';
        if (opt.type === 'skill' && opt.statType) {
            detailsBadge = `<span class="option-detail-badge skill">${opt.statType.slice(0,3).toUpperCase()}:${opt.statRequired || '?'}</span>`;
        } else if (opt.type === 'effect' && opt.effectId) {
            detailsBadge = `<span class="option-detail-badge effect">E#${opt.effectId}:${opt.effectAmount || '?'}</span>`;
        } else if (opt.type === 'combat' && opt.enemyId) {
            detailsBadge = `<span class="option-detail-badge combat">⚔️#${opt.enemyId}</span>`;
        }
        
        return `
        <div class="slide-option" data-slide="${slide.id}" data-option="${i}">
            <div class="option-connector option-connector-left" data-slide="${slide.id}" data-option="${i}" data-side="left" title="Drag to connect">●</div>
            <span class="option-type-badge ${opt.type}">${getTypeIcon(opt.type)}</span>
            <input type="text" class="option-text-input" value="${escapeHtml(opt.text || '')}" 
                   data-slide="${slide.id}" data-option="${i}" placeholder="Option text...">
            ${detailsBadge}
            <button class="option-edit-btn" data-slide="${slide.id}" data-option="${i}" title="Edit option">⚙️</button>
            <button class="option-delete-btn" data-slide="${slide.id}" data-option="${i}" title="Delete option">×</button>
            <div class="option-connector option-connector-right" data-slide="${slide.id}" data-option="${i}" data-side="right" title="Drag to connect">●</div>
        </div>
    `}).join('');
    
    // Build background style for slide body
    const bodyBgStyle = slide.assetUrl 
        ? `style="background-image: url(${slide.assetUrl});"` 
        : '';
    const bodyClass = slide.assetUrl ? 'slide-body has-bg' : 'slide-body';
    
    el.innerHTML = `
        <div class="slide-header">
            <span class="slide-id">#${slide.id}</span>
            <label class="start-checkbox" title="Start slide">
                <input type="checkbox" ${slide.isStart ? 'checked' : ''} data-slide="${slide.id}">
                <span>START</span>
            </label>
            <button class="slide-bg-btn" data-slide="${slide.id}" title="Set background">🖼️</button>
            <button class="slide-delete-btn" data-slide="${slide.id}" title="Delete slide">🗑️</button>
        </div>
        <div class="slide-input-connector" title="Input">●</div>
        <div class="${bodyClass}" ${bodyBgStyle}>
            <textarea class="slide-text-input" data-slide="${slide.id}" placeholder="Enter slide text...">${escapeHtml(slide.text)}</textarea>
            <div class="slide-effect-section">
                ${effectHtml}
            </div>
            <div class="slide-reward-section">
                ${rewardHtml}
            </div>
            <div class="slide-options">
                ${optionsHtml}
                <button class="add-option-btn" data-slide="${slide.id}">+ Add Option</button>
            </div>
        </div>
    `;
    
    // Bind events
    bindSlideEvents(el, slide);
    
    container.appendChild(el);
}

function bindSlideEvents(el, slide) {
    // Text editing
    const textArea = el.querySelector('.slide-text-input');
    textArea?.addEventListener('input', (e) => {
        slide.text = e.target.value;
        checkAndUpdateModifiedState(el, slide);
    });
    textArea?.addEventListener('mousedown', (e) => e.stopPropagation());
    
    // Start checkbox - allow multiple start slides
    const startCb = el.querySelector('.start-checkbox input');
    startCb?.addEventListener('change', (e) => {
        e.stopPropagation();
        slide.isStart = e.target.checked;
        el.classList.toggle('start-slide', slide.isStart);
        checkAndUpdateModifiedState(el, slide);
    });
    
    // Delete slide
    el.querySelector('.slide-delete-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteSlide(slide.id);
    });
    
    // Background image button
    el.querySelector('.slide-bg-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        openBgPicker(slide.id);
    });
    
    // Add option button
    el.querySelector('.add-option-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        openOptionModal(slide.id, -1);
    });
    
    // Add reward button
    el.querySelector('.add-reward-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        openRewardModal(slide.id);
    });
    
    // Edit reward button
    el.querySelector('.reward-edit-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        openRewardModal(slide.id);
    });
    
    // Delete reward button
    el.querySelector('.reward-delete-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        slide.reward = null;
        renderSlide(slide);
    });
    
    // Add effect button
    el.querySelector('.add-effect-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        openEffectModal(slide.id);
    });
    
    // Edit effect button
    el.querySelector('.effect-edit-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        openEffectModal(slide.id);
    });
    
    // Delete effect button
    el.querySelector('.effect-delete-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        slide.effect = null;
        renderSlide(slide);
    });
    
    // Option text inputs
    el.querySelectorAll('.option-text-input').forEach(input => {
        input.addEventListener('input', (e) => {
            const idx = parseInt(e.target.dataset.option);
            slide.options[idx].text = e.target.value;
            checkAndUpdateModifiedState(el, slide);
        });
        input.addEventListener('mousedown', (e) => e.stopPropagation());
    });
    
    // Option edit buttons
    el.querySelectorAll('.option-edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.dataset.option);
            openOptionModal(slide.id, idx);
        });
    });
    
    // Option delete buttons
    el.querySelectorAll('.option-delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.dataset.option);
            deleteOption(slide.id, idx);
        });
    });
    
    // Option connectors - start drag connection
    el.querySelectorAll('.option-connector').forEach(conn => {
        conn.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const side = conn.dataset.side || 'right';
            startConnectionDrag(parseInt(conn.dataset.slide), parseInt(conn.dataset.option), e, side);
        });
    });
    
    // Drag slide
    el.addEventListener('mousedown', (e) => {
        if (e.target.closest('input, textarea, button, .option-connector, .start-checkbox')) return;
        if (e.button !== 0) return;
        e.stopPropagation();
        
        selectSlide(slide.id);
        
        const startX = e.clientX - slide.x;
        const startY = e.clientY - slide.y;
        
        let hasMoved = false;
        
        const onMove = (ev) => {
            // Don't move if connecting started
            if (expeditionState.isConnecting) return;
            hasMoved = true;
            el.classList.add('dragging');
            slide.x = ev.clientX - startX;
            slide.y = ev.clientY - startY;
            el.style.left = `${slide.x}px`;
            el.style.top = `${slide.y}px`;
            renderConnections();
        };
        
        const onUp = () => {
            el.classList.remove('dragging');
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
        
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

function selectSlide(id) {
    expeditionState.selectedSlide = id;
    document.querySelectorAll('.expedition-slide').forEach(el => {
        el.classList.toggle('selected', el.id === `slide-${id}`);
    });
}

function deleteSlide(id) {
    if (!confirm('Delete this slide?')) return;
    
    // Remove connections
    expeditionState.connections = expeditionState.connections.filter(c => c.from !== id && c.to !== id);
    
    // Remove element
    document.getElementById(`slide-${id}`)?.remove();
    
    // Remove from state
    expeditionState.slides.delete(id);
    expeditionState.selectedSlide = null;
    
    renderConnections();
    updateCounter();
}

function deleteOption(slideId, optionIndex) {
    const slide = expeditionState.slides.get(slideId);
    if (!slide) return;
    
    // Remove connections for this option
    expeditionState.connections = expeditionState.connections.filter(c => 
        !(c.from === slideId && c.option === optionIndex)
    );
    // Adjust indices
    expeditionState.connections.forEach(c => {
        if (c.from === slideId && c.option > optionIndex) c.option--;
    });
    
    slide.options.splice(optionIndex, 1);
    renderSlide(slide);
    renderConnections();
}

function getTypeIcon(type) {
    return { combat: '⚔️', skill: '🎯', effect: '✨', item: '🎒' }[type] || '💬';
}

function getRewardIcon(type) {
    const icons = {
        stat: '📊',
        talent: '⭐',
        item: '🎒',
        perk: '🔮',
        blessing: '✨',
        potion: '🧪'
    };
    return icons[type] || '🎁';
}

function getRewardLabel(reward) {
    if (!reward || !reward.type) return 'No reward';
    switch (reward.type) {
        case 'stat':
            return `+${reward.amount || '?'} ${reward.statType || 'stat'}`;
        case 'talent':
            return 'Talent Point';
        case 'item':
            return `Item #${reward.itemId || '?'}`;
        case 'perk':
            return `Perk #${reward.perkId || '?'}`;
        case 'blessing':
            return `Blessing #${reward.blessingId || '?'}`;
        case 'potion':
            return `Potion #${reward.potionId || '?'}`;
        default:
            return 'Unknown reward';
    }
}

// ==================== EFFECT MODAL (Slide Effects) ====================
let effectModalContext = { slideId: null };

function openEffectModal(slideId) {
    effectModalContext = { slideId };
    const slide = expeditionState.slides.get(slideId);
    if (!slide) return;
    
    const effect = slide.effect || { effectId: null, effectFactor: 0 };
    
    // Populate effects dropdown
    populateEffectDropdown();
    
    document.getElementById('slideEffectId').value = effect.effectId || '';
    document.getElementById('slideEffectFactor').value = effect.effectFactor || 0;
    
    document.getElementById('effectModal').classList.add('open');
}
window.openEffectModal = openEffectModal;

function populateEffectDropdown() {
    const effectSelect = document.getElementById('slideEffectId');
    if (!effectSelect) return;
    
    // Get effects data
    let effects = [];
    if (typeof getEffects === 'function') {
        effects = getEffects() || [];
    } else if (typeof GlobalData !== 'undefined' && GlobalData.effects) {
        effects = GlobalData.effects;
    }
    
    effectSelect.innerHTML = '<option value="">-- Select an effect --</option>';
    
    if (effects.length > 0) {
        effects.forEach(effect => {
            const opt = document.createElement('option');
            opt.value = effect.id || effect.effect_id;
            opt.textContent = `#${effect.id || effect.effect_id} - ${effect.name || effect.effect_name || 'Effect'}`;
            effectSelect.appendChild(opt);
        });
    } else {
        // Common expedition effects fallback
        const commonEffects = [
            { id: 200, name: 'Health Loss' },
            { id: 201, name: 'Dodge Reduction' },
            { id: 202, name: 'Damage Reduction' },
            { id: 203, name: 'Speed Reduction' },
            { id: 204, name: 'Crit Reduction' }
        ];
        commonEffects.forEach(effect => {
            const opt = document.createElement('option');
            opt.value = effect.id;
            opt.textContent = `#${effect.id} - ${effect.name}`;
            effectSelect.appendChild(opt);
        });
    }
}

function closeEffectModal() {
    document.getElementById('effectModal').classList.remove('open');
    effectModalContext = { slideId: null };
}
window.closeEffectModal = closeEffectModal;

function saveEffectFromModal() {
    const slide = expeditionState.slides.get(effectModalContext.slideId);
    if (!slide) return;
    
    const effectId = parseInt(document.getElementById('slideEffectId').value) || null;
    const effectFactor = parseInt(document.getElementById('slideEffectFactor').value) || 0;
    
    if (effectId) {
        slide.effect = { effectId, effectFactor };
    } else {
        slide.effect = null;
    }
    
    renderSlide(slide);
    closeEffectModal();
}
window.saveEffectFromModal = saveEffectFromModal;

// ==================== REWARD MODAL ====================
let rewardModalContext = { slideId: null };

function openRewardModal(slideId) {
    rewardModalContext = { slideId };
    const slide = expeditionState.slides.get(slideId);
    if (!slide) return;
    
    const reward = slide.reward || { type: 'stat', statType: 'strength', amount: 1 };
    
    // Populate pickers
    populateRewardPickers();
    
    document.getElementById('rewardModalType').value = reward.type || 'stat';
    document.getElementById('rewardStatType').value = reward.statType || 'strength';
    document.getElementById('rewardStatAmount').value = reward.amount || 1;
    document.getElementById('rewardItemId').value = reward.itemId || '';
    document.getElementById('rewardPerkId').value = reward.perkId || '';
    document.getElementById('rewardBlessingId').value = reward.blessingId || '';
    document.getElementById('rewardPotionId').value = reward.potionId || '';
    
    // Highlight selected items in grids
    selectRewardItem(reward.itemId || null);
    selectRewardPotion(reward.potionId || null);
    
    updateRewardModalFields(reward.type || 'stat');
    document.getElementById('rewardModal').classList.add('open');
}
window.openRewardModal = openRewardModal;

function populateRewardPickers() {
    // Get items data
    let items = [];
    if (typeof getItems === 'function') {
        items = getItems() || [];
    } else if (typeof GlobalData !== 'undefined' && GlobalData.items) {
        items = GlobalData.items;
    }
    
    // Get perks data
    let perks = [];
    if (typeof getPerks === 'function') {
        perks = getPerks() || [];
    } else if (typeof GlobalData !== 'undefined' && GlobalData.perks) {
        perks = GlobalData.perks;
    }
    
    console.log('Populating reward pickers with', items.length, 'items and', perks.length, 'perks');
    
    // Populate item grid (all items except potions)
    const itemGrid = document.getElementById('rewardItemPickerGrid');
    if (itemGrid) {
        itemGrid.innerHTML = '';
        const nonPotionItems = items.filter(item => item.type !== 'potion');
        if (nonPotionItems.length === 0) {
            itemGrid.innerHTML = '<p style="color:#888;text-align:center;grid-column:1/-1;">No items loaded</p>';
        } else {
            nonPotionItems.forEach(item => {
                const iconUrl = item.icon || `https://gamedata-assets.s3.eu-north-1.amazonaws.com/images/items/${item.assetID}.webp`;
                const div = document.createElement('div');
                div.className = 'item-picker-item';
                div.dataset.itemId = item.id;
                div.innerHTML = `
                    <img src="${iconUrl}" alt="${item.name}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2280%22>🎒</text></svg>'">
                    <span>${item.name || 'Item #' + item.id}</span>
                `;
                div.addEventListener('click', () => selectRewardItem(item.id));
                itemGrid.appendChild(div);
            });
        }
    }
    
    // Populate potion grid (items where type = 'potion')
    const potionGrid = document.getElementById('rewardPotionPickerGrid');
    if (potionGrid) {
        potionGrid.innerHTML = '';
        const potions = items.filter(item => item.type === 'potion');
        if (potions.length === 0) {
            potionGrid.innerHTML = '<p style="color:#888;text-align:center;grid-column:1/-1;">No potions loaded</p>';
        } else {
            potions.forEach(item => {
                const iconUrl = item.icon || `https://gamedata-assets.s3.eu-north-1.amazonaws.com/images/items/${item.assetID}.webp`;
                const div = document.createElement('div');
                div.className = 'item-picker-item';
                div.dataset.potionId = item.id;
                div.innerHTML = `
                    <img src="${iconUrl}" alt="${item.name}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2280%22>🧪</text></svg>'">
                    <span>${item.name || 'Potion #' + item.id}</span>
                `;
                div.addEventListener('click', () => selectRewardPotion(item.id));
                potionGrid.appendChild(div);
            });
        }
    }
    
    // Populate perk dropdown (non-blessings)
    const perkSelect = document.getElementById('rewardPerkId');
    if (perkSelect) {
        const currentVal = perkSelect.value;
        perkSelect.innerHTML = '<option value="">-- Select a perk --</option>';
        const regularPerks = perks.filter(p => !p.is_blessing);
        regularPerks.forEach(perk => {
            const opt = document.createElement('option');
            opt.value = perk.id;
            opt.textContent = `🔮 #${perk.id} - ${perk.name || 'Unnamed'}`;
            perkSelect.appendChild(opt);
        });
        if (currentVal) perkSelect.value = currentVal;
    }
    
    // Populate blessing dropdown (perks where is_blessing = true)
    const blessingSelect = document.getElementById('rewardBlessingId');
    if (blessingSelect) {
        const currentVal = blessingSelect.value;
        blessingSelect.innerHTML = '<option value="">-- Select a blessing --</option>';
        const blessings = perks.filter(p => p.is_blessing);
        blessings.forEach(perk => {
            const opt = document.createElement('option');
            opt.value = perk.id;
            opt.textContent = `✨ #${perk.id} - ${perk.name || 'Unnamed'}`;
            blessingSelect.appendChild(opt);
        });
        if (currentVal) blessingSelect.value = currentVal;
    }
}

function selectRewardItem(itemId) {
    document.getElementById('rewardItemId').value = itemId || '';
    document.querySelectorAll('#rewardItemPickerGrid .item-picker-item').forEach(item => {
        item.classList.toggle('selected', item.dataset.itemId == itemId);
    });
}

function selectRewardPotion(potionId) {
    document.getElementById('rewardPotionId').value = potionId || '';
    document.querySelectorAll('#rewardPotionPickerGrid .item-picker-item').forEach(item => {
        item.classList.toggle('selected', item.dataset.potionId == potionId);
    });
}

function updateRewardModalFields(type) {
    const fields = {
        stat: document.getElementById('rewardStatFields'),
        item: document.getElementById('rewardItemFields'),
        perk: document.getElementById('rewardPerkFields'),
        blessing: document.getElementById('rewardBlessingFields'),
        potion: document.getElementById('rewardPotionFields')
    };
    
    // Hide all
    Object.values(fields).forEach(f => { if (f) f.style.display = 'none'; });
    
    // Show relevant one
    if (type === 'stat' && fields.stat) fields.stat.style.display = 'block';
    if (type === 'item' && fields.item) fields.item.style.display = 'block';
    if (type === 'perk' && fields.perk) fields.perk.style.display = 'block';
    if (type === 'blessing' && fields.blessing) fields.blessing.style.display = 'block';
    if (type === 'potion' && fields.potion) fields.potion.style.display = 'block';
}
window.updateRewardModalFields = updateRewardModalFields;

function closeRewardModal() {
    document.getElementById('rewardModal').classList.remove('open');
    rewardModalContext = { slideId: null };
}
window.closeRewardModal = closeRewardModal;

function saveRewardFromModal() {
    const slide = expeditionState.slides.get(rewardModalContext.slideId);
    if (!slide) return;
    
    const type = document.getElementById('rewardModalType').value;
    
    const reward = { type };
    
    switch (type) {
        case 'stat':
            reward.statType = document.getElementById('rewardStatType').value;
            reward.amount = parseInt(document.getElementById('rewardStatAmount').value) || 1;
            break;
        case 'talent':
            // No extra fields needed
            break;
        case 'item':
            reward.itemId = parseInt(document.getElementById('rewardItemId').value) || null;
            break;
        case 'perk':
            reward.perkId = parseInt(document.getElementById('rewardPerkId').value) || null;
            break;
        case 'blessing':
            reward.blessingId = parseInt(document.getElementById('rewardBlessingId').value) || null;
            break;
        case 'potion':
            reward.potionId = parseInt(document.getElementById('rewardPotionId').value) || null;
            break;
    }
    
    slide.reward = reward;
    renderSlide(slide);
    closeRewardModal();
}
window.saveRewardFromModal = saveRewardFromModal;

// ==================== OPTION MODAL ====================
let modalContext = { slideId: null, optionIndex: -1 };

function populateDropdownsOnce() {
    if (expeditionState.dropdownsPopulated) return;
    
    // Populate enemy grid picker
    const enemyGrid = document.getElementById('enemyPickerGrid');
    if (enemyGrid) {
        enemyGrid.innerHTML = '';
        
        // Try different sources for enemies
        let enemies = [];
        if (typeof allEnemies !== 'undefined' && allEnemies.length > 0) {
            enemies = allEnemies; // From enemy-designer-new.js
        } else if (typeof getEnemies === 'function') {
            enemies = getEnemies(); // From global-data.js
        } else if (typeof GlobalData !== 'undefined' && GlobalData.enemies) {
            enemies = GlobalData.enemies;
        }
        
        console.log('Populating enemy grid with', enemies.length, 'enemies');
        console.log('Enemy data sample:', enemies[0]); // Debug: see what properties are available
        
        if (enemies.length === 0) {
            enemyGrid.innerHTML = '<p style="color:#888;text-align:center;grid-column:1/-1;">No enemies loaded yet</p>';
        } else {
            enemies.forEach((enemy, idx) => {
                const iconUrl = enemy.icon || `https://gamedata-assets.s3.eu-north-1.amazonaws.com/images/enemies/${enemy.assetId}.webp`;
                console.log(`Enemy ${idx}:`, { id: enemy.enemyId, name: enemy.enemyName, assetId: enemy.assetId, icon: iconUrl });
                const item = document.createElement('div');
                item.className = 'enemy-picker-item';
                item.dataset.enemyId = enemy.enemyId;
                item.innerHTML = `
                    <img src="${iconUrl}" alt="${enemy.enemyName}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2280%22>👹</text></svg>'">
                    <span>${enemy.enemyName || 'Enemy #' + enemy.enemyId}</span>
                `;
                item.addEventListener('click', () => selectEnemyForOption(enemy.enemyId));
                enemyGrid.appendChild(item);
            });
        }
    }
    
    // Populate effects dropdown - try multiple sources
    const effectSelect = document.getElementById('optionEffectId');
    if (effectSelect) {
        effectSelect.innerHTML = '<option value="">Select effect...</option>';
        
        // Try different sources for effects
        let effects = [];
        if (typeof window.effectsData !== 'undefined' && window.effectsData.length > 0) {
            effects = window.effectsData; // From enemy-designer-new.js
        } else if (typeof getEffects === 'function') {
            effects = getEffects(); // From global-data.js
        } else if (typeof GlobalData !== 'undefined' && GlobalData.effects) {
            effects = GlobalData.effects;
        }
        
        console.log('Populating effects dropdown with', effects.length, 'effects');
        
        effects.forEach(effect => {
            const option = document.createElement('option');
            option.value = effect.id;
            option.textContent = `✨ #${effect.id} - ${effect.name || 'Unnamed effect'}`;
            effectSelect.appendChild(option);
        });
    }
    
    const hasEnemies = enemyGrid && enemyGrid.children.length > 0 && !enemyGrid.querySelector('p');
    const hasEffects = effectSelect && effectSelect.options.length > 1;
    
    if (hasEnemies || hasEffects) {
        expeditionState.dropdownsPopulated = true;
        console.log('✅ Dropdowns populated');
    }
}

function selectEnemyForOption(enemyId) {
    // Update hidden input
    document.getElementById('optionEnemyId').value = enemyId;
    
    // Update selection visual
    document.querySelectorAll('.enemy-picker-item').forEach(item => {
        item.classList.toggle('selected', item.dataset.enemyId == enemyId);
    });
}

function openOptionModal(slideId, optionIndex) {
    console.log('openOptionModal called', slideId, optionIndex);
    modalContext = { slideId, optionIndex };
    
    const slide = expeditionState.slides.get(slideId);
    if (!slide) return;
    
    // Ensure dropdowns are populated (in case init didn't catch them)
    if (!expeditionState.dropdownsPopulated) {
        populateDropdownsOnce();
    }
    
    const isEdit = optionIndex >= 0;
    const opt = isEdit ? slide.options[optionIndex] : { 
        text: '', 
        type: 'dialogue', 
        statType: null, 
        statRequired: null,
        effectId: null,
        effectAmount: null,
        enemyId: null
    };
    
    document.getElementById('optionModalTitle').textContent = isEdit ? 'Edit Option' : 'Add Option';
    document.getElementById('optionModalText').value = opt.text || '';
    document.getElementById('optionModalType').value = opt.type || 'dialogue';
    
    // Stat fields
    document.getElementById('optionStatType').value = opt.statType || '';
    document.getElementById('optionStatRequired').value = opt.statRequired || '';
    
    // Effect fields
    document.getElementById('optionEffectId').value = opt.effectId || '';
    document.getElementById('optionEffectAmount').value = opt.effectAmount || '';
    
    // Combat field - update hidden input and visual selection
    document.getElementById('optionEnemyId').value = opt.enemyId || '';
    selectEnemyForOption(opt.enemyId || null);
    
    // Show/hide relevant fields based on type
    updateOptionModalFields(opt.type || 'dialogue');
    
    document.getElementById('optionModal').classList.add('open');
}

function updateOptionModalFields(type) {
    const statFields = document.getElementById('optionStatFields');
    const effectFields = document.getElementById('optionEffectFields');
    const combatFields = document.getElementById('optionCombatFields');
    
    // Hide all
    if (statFields) statFields.style.display = 'none';
    if (effectFields) effectFields.style.display = 'none';
    if (combatFields) combatFields.style.display = 'none';
    
    // Show relevant
    if (type === 'skill' && statFields) {
        statFields.style.display = 'flex';
    } else if (type === 'effect' && effectFields) {
        effectFields.style.display = 'flex';
    } else if (type === 'combat' && combatFields) {
        combatFields.style.display = 'block';
    }
}

function closeOptionModal() {
    console.log('closeOptionModal called');
    document.getElementById('optionModal').classList.remove('open');
    modalContext = { slideId: null, optionIndex: -1 };
}

function saveOptionFromModal() {
    console.log('saveOptionFromModal called');
    const slide = expeditionState.slides.get(modalContext.slideId);
    if (!slide) {
        console.log('No slide found');
        return;
    }
    
    const text = document.getElementById('optionModalText').value || 'New option';
    const type = document.getElementById('optionModalType').value;
    
    const option = { text, type };
    
    // Get type-specific fields
    if (type === 'skill') {
        option.statType = document.getElementById('optionStatType').value || null;
        option.statRequired = parseInt(document.getElementById('optionStatRequired').value) || null;
    } else if (type === 'effect') {
        option.effectId = parseInt(document.getElementById('optionEffectId').value) || null;
        option.effectAmount = parseInt(document.getElementById('optionEffectAmount').value) || null;
    } else if (type === 'combat') {
        option.enemyId = parseInt(document.getElementById('optionEnemyId').value) || null;
    }
    
    if (modalContext.optionIndex >= 0) {
        // Edit existing
        slide.options[modalContext.optionIndex] = option;
    } else {
        // Add new
        slide.options.push(option);
    }
    
    renderSlide(slide);
    closeOptionModal();
}

// ==================== CANVAS PAN ====================
function onCanvasMouseDown(e) {
    // Middle mouse button (button 1) always pans
    if (e.button === 1) {
        e.preventDefault();
        expeditionState.isDragging = true;
        expeditionState.lastMouse = { x: e.clientX, y: e.clientY };
        const canvas = document.getElementById('expeditionCanvas');
        if (canvas) canvas.style.cursor = 'grabbing';
        return;
    }
    
    // Left click - only pan if clicking directly on canvas background (not on slides)
    if (e.button === 0) {
        // Check if clicking on a slide or interactive element
        const clickedSlide = e.target.closest('.expedition-slide');
        const clickedInteractive = e.target.closest('button, input, textarea, select, .option-connector');
        
        // Only start panning if NOT clicking on a slide or interactive element
        if (!clickedSlide && !clickedInteractive) {
            expeditionState.isDragging = true;
            expeditionState.lastMouse = { x: e.clientX, y: e.clientY };
            const canvas = document.getElementById('expeditionCanvas');
            if (canvas) canvas.style.cursor = 'grabbing';
        }
    }
}

function onCanvasMouseMove(e) {
    if (expeditionState.isDragging) {
        const dx = e.clientX - expeditionState.lastMouse.x;
        const dy = e.clientY - expeditionState.lastMouse.y;
        expeditionState.canvasOffset.x += dx;
        expeditionState.canvasOffset.y += dy;
        expeditionState.lastMouse = { x: e.clientX, y: e.clientY };
        
        const container = document.getElementById('slidesContainer');
        if (container) {
            container.style.transform = `translate(${expeditionState.canvasOffset.x}px, ${expeditionState.canvasOffset.y}px) scale(${expeditionState.zoom})`;
        }
        renderConnections();
    }
    
    if (expeditionState.isConnecting) {
        updateConnectionPreview(e);
    }
}

function onCanvasMouseUp(e) {
    if (expeditionState.isDragging) {
        expeditionState.isDragging = false;
        const canvas = document.getElementById('expeditionCanvas');
        if (canvas) canvas.style.cursor = 'grab';
    }
    
    // If clicking on empty canvas while connecting, cancel connection
    if (expeditionState.isConnecting && !e.target.closest('.expedition-slide')) {
        cancelConnection();
    }
}

// ==================== CONNECTION DRAG FUNCTIONS ====================
function startConnectionDrag(slideId, optionIndex, e, side = 'right') {
    console.log('Starting connection drag from slide', slideId, 'option', optionIndex, 'side', side);
    expeditionState.isConnecting = true;
    expeditionState.connectionStart = { slideId, optionIndex, side };
    
    document.body.style.cursor = 'crosshair';
    const canvas = document.getElementById('expeditionCanvas');
    if (canvas) canvas.classList.add('connecting');
    
    // Highlight all slides as potential targets
    document.querySelectorAll('.expedition-slide').forEach(s => {
        if (s.id !== `slide-${slideId}`) {
            s.classList.add('connection-target');
        }
    });
    
    // Track mouse movement on document level
    const onMouseMove = (ev) => {
        updateConnectionPreview(ev);
    };
    
    const onMouseUp = (ev) => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        
        // Check if we dropped on a slide
        const target = document.elementFromPoint(ev.clientX, ev.clientY);
        const slideEl = target?.closest('.expedition-slide');
        
        if (slideEl && expeditionState.connectionStart) {
            const toId = parseInt(slideEl.id.replace('slide-', ''));
            if (toId !== expeditionState.connectionStart.slideId) {
                // Check if this exact connection already exists
                const exists = expeditionState.connections.some(c => 
                    c.from === expeditionState.connectionStart.slideId && 
                    c.option === expeditionState.connectionStart.optionIndex &&
                    c.to === toId
                );
                
                // Only add if it doesn't already exist (prevent duplicates)
                if (!exists) {
                    expeditionState.connections.push({
                        from: expeditionState.connectionStart.slideId,
                        option: expeditionState.connectionStart.optionIndex,
                        to: toId
                    });
                }
                
                console.log('Connection created:', expeditionState.connections);
            }
        }
        
        // Clean up
        cancelConnectionDrag();
        renderConnections();
    };
    
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    
    // Initial preview
    updateConnectionPreview(e);
}

function cancelConnectionDrag() {
    expeditionState.isConnecting = false;
    expeditionState.connectionStart = null;
    document.body.style.cursor = 'default';
    
    const canvas = document.getElementById('expeditionCanvas');
    if (canvas) canvas.classList.remove('connecting');
    
    document.getElementById('connectionPreview')?.setAttribute('style', 'display:none');
    
    // Remove target highlighting
    document.querySelectorAll('.expedition-slide.connection-target').forEach(s => {
        s.classList.remove('connection-target');
    });
}

function resetView() {
    expeditionState.canvasOffset = { x: 0, y: 0 };
    expeditionState.zoom = 1;
    const container = document.getElementById('slidesContainer');
    if (container) container.style.transform = 'translate(0, 0) scale(1)';
    
    const indicator = document.getElementById('zoomIndicator');
    if (indicator) indicator.textContent = '100%';
    
    renderConnections();
}

function changeZoom(delta) {
    const newZoom = Math.max(0.1, Math.min(2, expeditionState.zoom + delta));
    expeditionState.zoom = newZoom;
    
    const container = document.getElementById('slidesContainer');
    if (container) {
        container.style.transform = `translate(${expeditionState.canvasOffset.x}px, ${expeditionState.canvasOffset.y}px) scale(${expeditionState.zoom})`;
    }
    
    const indicator = document.getElementById('zoomIndicator');
    if (indicator) {
        indicator.textContent = `${Math.round(expeditionState.zoom * 100)}%`;
    }
    
    renderConnections();
}
window.changeZoom = changeZoom;

// Pan canvas by delta
function panCanvas(dx, dy) {
    expeditionState.canvasOffset.x += dx;
    expeditionState.canvasOffset.y += dy;
    
    const container = document.getElementById('slidesContainer');
    if (container) {
        container.style.transform = `translate(${expeditionState.canvasOffset.x}px, ${expeditionState.canvasOffset.y}px) scale(${expeditionState.zoom})`;
    }
    
    renderConnections();
}
window.panCanvas = panCanvas;

// Center canvas on slides
function centerCanvas() {
    if (expeditionState.slides.size === 0) {
        expeditionState.canvasOffset = { x: 0, y: 0 };
    } else {
        // Calculate center of all slides
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        expeditionState.slides.forEach(slide => {
            minX = Math.min(minX, slide.x);
            minY = Math.min(minY, slide.y);
            maxX = Math.max(maxX, slide.x + 360); // slide width
            maxY = Math.max(maxY, slide.y + 480); // slide height
        });
        
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        
        const canvas = document.getElementById('expeditionCanvas');
        if (canvas) {
            const rect = canvas.getBoundingClientRect();
            expeditionState.canvasOffset.x = (rect.width / 2) - (centerX * expeditionState.zoom);
            expeditionState.canvasOffset.y = (rect.height / 2) - (centerY * expeditionState.zoom);
        }
    }
    
    const container = document.getElementById('slidesContainer');
    if (container) {
        container.style.transform = `translate(${expeditionState.canvasOffset.x}px, ${expeditionState.canvasOffset.y}px) scale(${expeditionState.zoom})`;
    }
    
    renderConnections();
}
window.centerCanvas = centerCanvas;

function onCanvasWheel(e) {
    // Note: preventDefault and stopPropagation are called in the document-level handler
    
    const container = document.getElementById('slidesContainer');
    if (!container) return false;
    
    // Ctrl+scroll = zoom, otherwise scroll = pan
    if (e.ctrlKey) {
        // Zoom
        const zoomSpeed = 0.1;
        const delta = e.deltaY > 0 ? -zoomSpeed : zoomSpeed;
        const newZoom = Math.max(0.1, Math.min(2, expeditionState.zoom + delta));
        
        expeditionState.zoom = newZoom;
        
        container.style.transform = `translate(${expeditionState.canvasOffset.x}px, ${expeditionState.canvasOffset.y}px) scale(${expeditionState.zoom})`;
        
        // Update zoom indicator
        const indicator = document.getElementById('zoomIndicator');
        if (indicator) {
            indicator.textContent = `${Math.round(expeditionState.zoom * 100)}%`;
        }
    } else {
        // Pan - scroll vertically, shift+scroll horizontally
        const panSpeed = 1;
        if (e.shiftKey) {
            // Horizontal pan
            expeditionState.canvasOffset.x -= e.deltaY * panSpeed;
        } else {
            // Vertical pan (also handle horizontal delta if trackpad)
            expeditionState.canvasOffset.x -= (e.deltaX || 0) * panSpeed;
            expeditionState.canvasOffset.y -= e.deltaY * panSpeed;
        }
        
        container.style.transform = `translate(${expeditionState.canvasOffset.x}px, ${expeditionState.canvasOffset.y}px) scale(${expeditionState.zoom})`;
    }
    
    renderConnections();
    return false;
}

// ==================== CONNECTIONS ====================
function updateConnectionPreview(e) {
    const preview = document.getElementById('connectionPreview');
    const canvas = document.getElementById('expeditionCanvas');
    if (!preview || !canvas || !expeditionState.connectionStart) return;
    
    const rect = canvas.getBoundingClientRect();
    // Use the side that was clicked (stored in connectionStart)
    const side = expeditionState.connectionStart.side || 'right';
    const fromEl = document.querySelector(`#slide-${expeditionState.connectionStart.slideId} .option-connector-${side}[data-option="${expeditionState.connectionStart.optionIndex}"]`);
    if (!fromEl) return;
    
    const fromRect = fromEl.getBoundingClientRect();
    const x1 = fromRect.left + fromRect.width/2 - rect.left;
    const y1 = fromRect.top + fromRect.height/2 - rect.top;
    const x2 = e.clientX - rect.left;
    const y2 = e.clientY - rect.top;
    
    // Curve control based on which side
    const curveX = side === 'right' ? x1 + 50 : x1 - 50;
    preview.setAttribute('d', `M ${x1} ${y1} Q ${curveX} ${y1}, ${x2} ${y2}`);
    preview.style.display = 'block';
}

function renderConnections() {
    const svg = document.getElementById('connectionsSvg');
    const canvas = document.getElementById('expeditionCanvas');
    if (!svg || !canvas) {
        console.log('renderConnections: svg or canvas not found');
        return;
    }
    
    const rect = canvas.getBoundingClientRect();
    
    // Remove old paths except preview
    svg.querySelectorAll('path:not(#connectionPreview)').forEach(p => p.remove());
    
    const slideWidth = 360;
    const slideHeight = 540;
    const zoom = expeditionState.zoom;
    const offsetX = expeditionState.canvasOffset.x;
    const offsetY = expeditionState.canvasOffset.y;
    
    expeditionState.connections.forEach((conn, i) => {
        const fromSlide = expeditionState.slides.get(conn.from);
        const toSlide = expeditionState.slides.get(conn.to);
        if (!fromSlide || !toSlide) return;
        
        // Convert target slide coordinates to screen space (accounting for zoom and offset)
        const toScreenX = toSlide.x * zoom + offsetX;
        const toScreenY = toSlide.y * zoom + offsetY;
        const toScreenWidth = slideWidth * zoom;
        const toScreenHeight = slideHeight * zoom;
        const toScreenCenterX = toScreenX + toScreenWidth / 2;
        const toScreenCenterY = toScreenY + toScreenHeight / 2;
        
        // Get from slide center in screen space to determine which connector to use
        const fromScreenCenterX = fromSlide.x * zoom + offsetX + (slideWidth * zoom) / 2;
        const useRightConnector = toScreenCenterX >= fromScreenCenterX;
        const connectorSide = useRightConnector ? 'right' : 'left';
        
        const fromEl = document.querySelector(`#slide-${conn.from} .option-connector-${connectorSide}[data-option="${conn.option}"]`);
        if (!fromEl) return;
        
        const fromRect = fromEl.getBoundingClientRect();
        const x1 = fromRect.left + fromRect.width/2 - rect.left;
        const y1 = fromRect.top + fromRect.height/2 - rect.top;
        
        // Target slide bounds in screen coordinates
        const targetLeft = toScreenX;
        const targetRight = toScreenX + toScreenWidth;
        const targetTop = toScreenY;
        const targetBottom = toScreenY + toScreenHeight;
        
        // Find intersection point with slide border
        let x2, y2;
        const dx = toScreenCenterX - x1;
        const dy = toScreenCenterY - y1;
        
        // Determine which edge to connect to based on angle
        const aspectRatio = toScreenWidth / toScreenHeight;
        
        if (Math.abs(dx) > Math.abs(dy) * aspectRatio) {
            // Intersects left or right edge
            if (dx > 0) {
                // Left edge of target
                x2 = targetLeft;
                y2 = y1 + (dy / dx) * (targetLeft - x1);
                y2 = Math.max(targetTop + 15, Math.min(targetBottom - 15, y2));
            } else {
                // Right edge of target
                x2 = targetRight;
                y2 = y1 + (dy / dx) * (targetRight - x1);
                y2 = Math.max(targetTop + 15, Math.min(targetBottom - 15, y2));
            }
        } else {
            // Intersects top or bottom edge
            if (dy > 0) {
                // Top edge of target
                y2 = targetTop;
                x2 = x1 + (dx / dy) * (targetTop - y1);
                x2 = Math.max(targetLeft + 15, Math.min(targetRight - 15, x2));
            } else {
                // Bottom edge of target
                y2 = targetBottom;
                x2 = x1 + (dx / dy) * (targetBottom - y1);
                x2 = Math.max(targetLeft + 15, Math.min(targetRight - 15, x2));
            }
        }
        
        // Create smooth bezier curve
        const distance = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
        const curveStrength = Math.min(distance * 0.25, 60);
        
        // Control point 1: extends from start point
        let cx1, cy1, cx2, cy2;
        if (useRightConnector) {
            cx1 = x1 + curveStrength;
            cy1 = y1;
        } else {
            cx1 = x1 - curveStrength;
            cy1 = y1;
        }
        
        // Control point 2: approaches the target edge perpendicularly
        if (Math.abs(dx) > Math.abs(dy) * aspectRatio) {
            cx2 = x2 + (dx > 0 ? -curveStrength : curveStrength);
            cy2 = y2;
        } else {
            cx2 = x2;
            cy2 = y2 + (dy > 0 ? -curveStrength : curveStrength);
        }
        
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`);
        path.setAttribute('class', 'connection-line');
        path.dataset.index = i;
        path.addEventListener('click', () => {
            if (confirm('Delete connection?')) {
                expeditionState.connections.splice(i, 1);
                renderConnections();
            }
        });
        svg.appendChild(path);
    });
}

// ==================== BACKGROUND PICKER ====================
let bgPickerSlideId = null;
let expeditionAssets = [];

function openBgPicker(slideId) {
    bgPickerSlideId = slideId;
    document.getElementById('bgPickerModal').classList.add('open');
    // Use cached assets, only load if empty
    if (expeditionAssets.length === 0) {
        loadBgAssets();
    } else {
        renderBgAssetsGrid();
    }
}

function closeBgPicker() {
    document.getElementById('bgPickerModal').classList.remove('open');
    bgPickerSlideId = null;
}

function loadBgAssets() {
    const grid = document.getElementById('bgAssetsGrid');
    if (!grid) return;
    
    grid.innerHTML = '<p style="color:#888;text-align:center;grid-column:1/-1;">Loading assets...</p>';
    
    // Fetch expedition assets from S3 using proper auth
    getCurrentAccessToken().then(token => {
        if (!token) {
            grid.innerHTML = '<p style="color:#f66;text-align:center;grid-column:1/-1;">Auth required</p>';
            return;
        }
        
        fetch('http://localhost:8080/api/getExpeditionAssets', {
            headers: { 'Authorization': `Bearer ${token}` }
        })
        .then(r => r.json())
        .then(data => {
            expeditionAssets = data.assets || [];
            renderBgAssetsGrid();
        })
        .catch(err => {
            console.log('Could not load assets:', err);
            expeditionAssets = [];
            renderBgAssetsGrid();
        });
    });
}

function renderBgAssetsGrid() {
    const grid = document.getElementById('bgAssetsGrid');
    if (!grid) return;
    
    if (expeditionAssets.length === 0) {
        grid.innerHTML = `
            <p style="color:#888;text-align:center;grid-column:1/-1;">
                No assets in S3 expeditions folder.<br>
                <small>Upload from device or enter URL below.</small>
            </p>
        `;
        return;
    }
    
    grid.innerHTML = expeditionAssets.map(asset => {
        const url = typeof asset === 'string' ? asset : asset.icon;
        return `
            <div class="bg-asset-item" data-url="${url}">
                <img src="${url}" alt="Asset" onerror="this.parentElement.style.display='none'">
            </div>
        `;
    }).join('');
    
    grid.querySelectorAll('.bg-asset-item').forEach(item => {
        item.addEventListener('click', () => selectBgAsset(item.dataset.url));
    });
}

function selectBgAsset(url) {
    const slide = expeditionState.slides.get(bgPickerSlideId);
    if (slide) {
        slide.assetUrl = url;
        renderSlide(slide);
        renderConnections();
    }
    closeBgPicker();
}

function applyBgUrl() {
    const input = document.getElementById('bgUrlInput');
    const url = input?.value?.trim();
    if (url && bgPickerSlideId) {
        selectBgAsset(url);
        input.value = '';
    }
}

function clearSlideBg() {
    const slide = expeditionState.slides.get(bgPickerSlideId);
    if (slide) {
        slide.assetUrl = null;
        renderSlide(slide);
        renderConnections();
    }
    closeBgPicker();
}

function uploadSlideBgFromDevice() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const uploadStatus = document.getElementById('bgUploadStatus');
        if (uploadStatus) uploadStatus.textContent = 'Converting...';
        
        try {
            const token = await getCurrentAccessToken();
            if (!token) {
                if (uploadStatus) uploadStatus.textContent = 'Auth required';
                return;
            }
            
            // Convert to base64
            const reader = new FileReader();
            reader.onload = async (readerEvent) => {
                if (uploadStatus) uploadStatus.textContent = 'Uploading...';
                
                const base64Data = readerEvent.target.result;
                
                try {
                    const response = await fetch('http://localhost:8080/api/uploadExpeditionAsset', {
                        method: 'POST',
                        headers: { 
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            imageData: base64Data,
                            contentType: file.type
                        })
                    });
                    
                    const result = await response.json();
                    if (result.success && result.icon) {
                        if (uploadStatus) uploadStatus.textContent = 'Uploaded!';
                        // Add to local cache as object (matching server format) and select it
                        expeditionAssets.unshift({ icon: result.icon, assetId: result.assetID });
                        renderBgAssetsGrid();
                        selectBgAsset(result.icon);
                    } else {
                        if (uploadStatus) uploadStatus.textContent = 'Upload failed';
                        console.error('Upload response:', result);
                    }
                } catch (err) {
                    console.error('Upload error:', err);
                    if (uploadStatus) uploadStatus.textContent = 'Upload failed';
                }
            };
            reader.readAsDataURL(file);
            
        } catch (err) {
            console.error('Upload error:', err);
            if (uploadStatus) uploadStatus.textContent = 'Upload failed';
        }
    };
    input.click();
}

// ==================== UTILS ====================
function updateCounter() {
    const counter = document.getElementById('slideCounter');
    if (counter) {
        counter.textContent = `${expeditionState.slides.size} slides`;
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ==================== MODIFICATION DETECTION ====================
// Check if a slide has been modified from its original server values
function isSlideModified(localId) {
    if (!expeditionState.serverSlides.has(localId)) return false; // New slides aren't "modified"
    
    const original = expeditionState.originalSlides.get(localId);
    if (!original) return false;
    
    const slide = expeditionState.slides.get(localId);
    if (!slide) return false;
    
    // Check slide-level changes
    if (slide.text !== original.text) return true;
    if (slide.isStart !== original.isStart) return true;
    if (getAssetIdFromUrl(slide.assetUrl) !== original.assetId) return true;
    
    // Check effect changes
    const slideEffectId = slide.effect?.effectId || null;
    const slideEffectFactor = slide.effect?.effectFactor || null;
    if (slideEffectId !== original.effectId) return true;
    if (slideEffectFactor !== original.effectFactor) return true;
    
    // Check reward changes
    if (!rewardsEqual(slide.reward, original.reward)) return true;
    
    // Check option-level changes
    for (let i = 0; i < slide.options.length; i++) {
        const optKey = `${localId}-${i}`;
        if (expeditionState.serverOptions.has(optKey)) {
            if (isOptionModified(localId, i)) return true;
        }
    }
    
    return false;
}

// Check if an option has been modified
function isOptionModified(localId, optIdx) {
    const optKey = `${localId}-${optIdx}`;
    if (!expeditionState.serverOptions.has(optKey)) return false; // New options aren't "modified"
    
    const original = expeditionState.originalOptions.get(optKey);
    if (!original) return false;
    
    const slide = expeditionState.slides.get(localId);
    if (!slide || !slide.options[optIdx]) return false;
    
    const opt = slide.options[optIdx];
    
    if (opt.text !== original.text) return true;
    if (opt.type !== original.type) return true;
    if (opt.statType !== original.statType) return true;
    if (opt.statRequired !== original.statRequired) return true;
    if (opt.effectId !== original.effectId) return true;
    if (opt.effectAmount !== original.effectAmount) return true;
    if (opt.enemyId !== original.enemyId) return true;
    
    return false;
}

// Helper to compare rewards
function rewardsEqual(r1, r2) {
    if (!r1 && !r2) return true;
    if (!r1 || !r2) return false;
    if (r1.type !== r2.type) return false;
    
    switch (r1.type) {
        case 'stat':
            return r1.statType === r2.statType && r1.amount === r2.amount;
        case 'item':
            return r1.itemId === r2.itemId;
        case 'perk':
            return r1.perkId === r2.perkId;
        case 'blessing':
            return r1.blessingId === r2.blessingId;
        case 'potion':
            return r1.potionId === r2.potionId;
        case 'talent':
            return true;
        default:
            return true;
    }
}

// Helper to extract asset ID from URL
function getAssetIdFromUrl(url) {
    if (!url) return null;
    const match = url.match(/\/(\d+)\.webp/);
    return match ? parseInt(match[1]) : null;
}

// Update modified state on element without full re-render
function checkAndUpdateModifiedState(el, slide) {
    const isNewSlide = !expeditionState.serverSlides.has(slide.id);
    if (isNewSlide) return; // New slides don't need modification highlighting
    
    const isModified = isSlideModified(slide.id);
    el.classList.toggle('modified-slide', isModified);
}

// Get all modified slides
function getModifiedSlides() {
    const modified = [];
    expeditionState.slides.forEach((slide, localId) => {
        if (expeditionState.serverSlides.has(localId) && isSlideModified(localId)) {
            modified.push({
                localId,
                toolingId: expeditionState.serverSlides.get(localId),
                slide
            });
        }
    });
    return modified;
}

// Get all modified options
function getModifiedOptions() {
    const modified = [];
    expeditionState.slides.forEach((slide, localId) => {
        if (!expeditionState.serverSlides.has(localId)) return; // Skip new slides
        
        slide.options.forEach((opt, optIdx) => {
            const optKey = `${localId}-${optIdx}`;
            if (expeditionState.serverOptions.has(optKey) && isOptionModified(localId, optIdx)) {
                modified.push({
                    localId,
                    optIdx,
                    optionToolingId: expeditionState.serverOptions.get(optKey),
                    option: opt
                });
            }
        });
    });
    return modified;
}

// ==================== SAVE EXPEDITION ====================
async function saveExpedition() {
    if (expeditionState.slides.size === 0) {
        alert('No slides to save. Create at least one slide first.');
        return;
    }

    const saveBtn = document.getElementById('saveExpeditionBtn');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = '⏳ Saving...';
    }

    try {
        // Debug: Log all connections before processing
        console.log('All connections before save:', expeditionState.connections);
        console.log('Server slides:', [...expeditionState.serverSlides.entries()]);
        console.log('Server options:', [...expeditionState.serverOptions.entries()]);
        console.log('Server outcomes:', [...expeditionState.serverOutcomes]);
        
        // Build slides array with proper structure for the API
        // ONLY include NEW slides (not ones already from server)
        const slides = [];
        const newOptions = []; // New options for existing slides
        const newConnections = []; // New connections for existing options
        
        expeditionState.slides.forEach((slide, localId) => {
            const isServerSlide = expeditionState.serverSlides.has(localId);
            const slideToolingId = isServerSlide ? expeditionState.serverSlides.get(localId) : null;
            
            if (isServerSlide) {
                // This is an existing server slide - check for new options
                slide.options.forEach((opt, optIdx) => {
                    const optionKey = `${localId}-${optIdx}`;
                    const isServerOption = expeditionState.serverOptions.has(optionKey);
                    
                    if (!isServerOption) {
                        // This is a NEW option on an existing slide
                        const connections = expeditionState.connections
                            .filter(conn => conn.from === localId && conn.option === optIdx)
                            .map(conn => {
                                const targetIsServer = expeditionState.serverSlides.has(conn.to);
                                return {
                                    targetSlideId: conn.to,
                                    targetToolingId: targetIsServer ? expeditionState.serverSlides.get(conn.to) : null,
                                    weight: conn.weight || 1
                                };
                            });
                        
                        newOptions.push({
                            slideToolingId: slideToolingId,
                            text: opt.text || '',
                            statType: opt.type === 'skill' ? opt.statType : null,
                            statRequired: opt.type === 'skill' ? opt.statRequired : null,
                            effectId: opt.type === 'effect' ? opt.effectId : null,
                            effectAmount: opt.type === 'effect' ? opt.effectAmount : null,
                            enemyId: opt.type === 'combat' ? opt.enemyId : null,
                            connections: connections
                        });
                        console.log(`New option on existing slide ${localId} (tooling ${slideToolingId}):`, opt.text);
                    } else {
                        // This is an existing server option - check for new connections
                        const optionToolingId = expeditionState.serverOptions.get(optionKey);
                        const optionConnections = expeditionState.connections
                            .filter(conn => conn.from === localId && conn.option === optIdx);
                        
                        optionConnections.forEach(conn => {
                            const targetIsServer = expeditionState.serverSlides.has(conn.to);
                            const targetToolingId = targetIsServer ? expeditionState.serverSlides.get(conn.to) : null;
                            
                            // Check if this connection already exists on server
                            const outcomeKey = `${optionToolingId}-${targetToolingId}`;
                            const alreadyOnServer = targetIsServer && expeditionState.serverOutcomes.has(outcomeKey);
                            
                            if (!alreadyOnServer) {
                                // This is a NEW connection (either to new slide or new connection to existing slide)
                                newConnections.push({
                                    optionToolingId: optionToolingId,
                                    targetSlideId: conn.to,
                                    targetToolingId: targetToolingId,
                                    weight: conn.weight || 1
                                });
                                console.log(`New connection from existing option ${optionToolingId} to slide ${conn.to} (tooling: ${targetToolingId})`);
                            }
                        });
                    }
                });
                return; // Skip adding to slides array
            }
            
            // This is a NEW slide
            // Build reward fields based on reward object
            let rewardStatType = null;
            let rewardStatAmount = null;
            let rewardTalent = null;
            let rewardItem = null;
            let rewardPerk = null;
            let rewardBlessing = null;
            let rewardPotion = null;

            if (slide.reward) {
                switch (slide.reward.type) {
                    case 'stat':
                        rewardStatType = slide.reward.statType || null;
                        rewardStatAmount = slide.reward.amount || null;
                        break;
                    case 'talent':
                        rewardTalent = true;
                        break;
                    case 'item':
                        rewardItem = slide.reward.itemId || null;
                        break;
                    case 'perk':
                        rewardPerk = slide.reward.perkId || null;
                        break;
                    case 'blessing':
                        rewardBlessing = slide.reward.blessingId || null;
                        break;
                    case 'potion':
                        rewardPotion = slide.reward.potionId || null;
                        break;
                }
            }

            // Build effect fields
            let effectId = null;
            let effectFactor = null;
            if (slide.effect) {
                effectId = slide.effect.effectId || null;
                effectFactor = slide.effect.effectFactor || null;
            }

            // Extract asset ID from assetUrl if needed
            let assetId = null;
            if (slide.assetUrl) {
                // Try to extract asset ID from URL pattern
                const match = slide.assetUrl.match(/\/(\d+)\.webp/);
                if (match) {
                    assetId = parseInt(match[1]);
                }
            }

            // Build options with their connections
            // For connections, we need to handle both new and existing target slides
            const options = slide.options.map((opt, optIdx) => {
                // Find all connections from this option
                const connections = expeditionState.connections
                    .filter(conn => conn.from === localId && conn.option === optIdx)
                    .map(conn => {
                        // If target is a server slide, use its toolingId
                        // If target is a new slide, use its localId (server will map it)
                        const targetIsServer = expeditionState.serverSlides.has(conn.to);
                        return {
                            targetSlideId: conn.to,
                            targetToolingId: targetIsServer ? expeditionState.serverSlides.get(conn.to) : null,
                            weight: conn.weight || 1
                        };
                    });
                
                console.log(`Slide ${localId} option ${optIdx} connections:`, connections);

                return {
                    text: opt.text || '',
                    statType: opt.type === 'skill' ? opt.statType : null,
                    statRequired: opt.type === 'skill' ? opt.statRequired : null,
                    effectId: opt.type === 'effect' ? opt.effectId : null,
                    effectAmount: opt.type === 'effect' ? opt.effectAmount : null,
                    enemyId: opt.type === 'combat' ? opt.enemyId : null,
                    connections: connections
                };
            });

            slides.push({
                id: localId,
                text: slide.text || '',
                assetId: assetId,
                effectId: effectId,
                effectFactor: effectFactor,
                isStart: slide.isStart || false,
                rewardStatType: rewardStatType,
                rewardStatAmount: rewardStatAmount,
                rewardTalent: rewardTalent,
                rewardItem: rewardItem,
                rewardPerk: rewardPerk,
                rewardBlessing: rewardBlessing,
                rewardPotion: rewardPotion,
                posX: slide.x || 100,
                posY: slide.y || 100,
                options: options
            });
        });

        // Build updates for modified slides
        const modifiedSlides = getModifiedSlides();
        const slideUpdates = modifiedSlides.map(({ localId, toolingId, slide }) => {
            // Build reward fields
            let rewardStatType = null, rewardStatAmount = null, rewardTalent = null;
            let rewardItem = null, rewardPerk = null, rewardBlessing = null, rewardPotion = null;
            
            if (slide.reward) {
                switch (slide.reward.type) {
                    case 'stat':
                        rewardStatType = slide.reward.statType || null;
                        rewardStatAmount = slide.reward.amount || null;
                        break;
                    case 'talent': rewardTalent = true; break;
                    case 'item': rewardItem = slide.reward.itemId || null; break;
                    case 'perk': rewardPerk = slide.reward.perkId || null; break;
                    case 'blessing': rewardBlessing = slide.reward.blessingId || null; break;
                    case 'potion': rewardPotion = slide.reward.potionId || null; break;
                }
            }
            
            return {
                toolingId: toolingId,
                text: slide.text || '',
                assetId: getAssetIdFromUrl(slide.assetUrl),
                effectId: slide.effect?.effectId || null,
                effectFactor: slide.effect?.effectFactor || null,
                isStart: slide.isStart || false,
                rewardStatType, rewardStatAmount, rewardTalent,
                rewardItem, rewardPerk, rewardBlessing, rewardPotion,
                posX: slide.x || 100,
                posY: slide.y || 100
            };
        });
        
        // Build updates for modified options
        const modifiedOptions = getModifiedOptions();
        const optionUpdates = modifiedOptions.map(({ optionToolingId, option }) => ({
            toolingId: optionToolingId,
            text: option.text || '',
            statType: option.type === 'skill' ? option.statType : null,
            statRequired: option.type === 'skill' ? option.statRequired : null,
            effectId: option.type === 'effect' ? option.effectId : null,
            effectAmount: option.type === 'effect' ? option.effectAmount : null,
            enemyId: option.type === 'combat' ? option.enemyId : null
        }));

        // Check if there's anything to save
        if (slides.length === 0 && newOptions.length === 0 && newConnections.length === 0 && slideUpdates.length === 0 && optionUpdates.length === 0) {
            alert('No changes to save. All slides, options, and connections are already on the server.');
            return;
        }

        console.log('Saving expedition:');
        console.log(`  - ${slides.length} new slides`);
        console.log(`  - ${newOptions.length} new options on existing slides`);
        console.log(`  - ${newConnections.length} new connections on existing options`);
        console.log(`  - ${slideUpdates.length} updated slides`);
        console.log(`  - ${optionUpdates.length} updated options`);

        // Get auth token
        const token = await getCurrentAccessToken();
        if (!token) {
            throw new Error('Not authenticated');
        }

        // Send to API
        const response = await fetch('http://localhost:8080/api/saveExpedition', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                slides: slides,
                newOptions: newOptions,
                newConnections: newConnections,
                slideUpdates: slideUpdates,
                optionUpdates: optionUpdates,
                settlementId: null // Could add settlement selector later
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Server error: ${errorText}`);
        }

        const result = await response.json();
        
        if (result.success) {
            // Mark the newly saved slides as server slides
            if (result.slideMapping) {
                for (const [localIdStr, toolingId] of Object.entries(result.slideMapping)) {
                    const localId = parseInt(localIdStr);
                    expeditionState.serverSlides.set(localId, toolingId);
                    
                    // Store original values for newly saved slides
                    const slide = expeditionState.slides.get(localId);
                    if (slide) {
                        expeditionState.originalSlides.set(localId, {
                            text: slide.text || '',
                            isStart: slide.isStart || false,
                            assetId: getAssetIdFromUrl(slide.assetUrl),
                            effectId: slide.effect?.effectId || null,
                            effectFactor: slide.effect?.effectFactor || null,
                            reward: slide.reward ? JSON.parse(JSON.stringify(slide.reward)) : null
                        });
                    }
                }
            }
            
            // Update original values for modified slides (so they're no longer marked as modified)
            for (const { localId, slide } of modifiedSlides) {
                expeditionState.originalSlides.set(localId, {
                    text: slide.text || '',
                    isStart: slide.isStart || false,
                    assetId: getAssetIdFromUrl(slide.assetUrl),
                    effectId: slide.effect?.effectId || null,
                    effectFactor: slide.effect?.effectFactor || null,
                    reward: slide.reward ? JSON.parse(JSON.stringify(slide.reward)) : null
                });
            }
            
            // Update original values for modified options
            for (const { localId, optIdx, option } of modifiedOptions) {
                const optKey = `${localId}-${optIdx}`;
                expeditionState.originalOptions.set(optKey, {
                    text: option.text || '',
                    type: option.type || 'dialogue',
                    statType: option.statType || null,
                    statRequired: option.statRequired || null,
                    effectId: option.effectId || null,
                    effectAmount: option.effectAmount || null,
                    enemyId: option.enemyId || null
                });
            }
            
            // Re-render slides to update visual (remove new-slide/modified-slide highlight)
            expeditionState.slides.forEach(slide => renderSlide(slide));
            
            const parts = [];
            if (slides.length > 0) parts.push(`${slides.length} new slides`);
            if (newOptions.length > 0) parts.push(`${newOptions.length} new options`);
            if (newConnections.length > 0) parts.push(`${newConnections.length} new connections`);
            if (slideUpdates.length > 0) parts.push(`${slideUpdates.length} updated slides`);
            if (optionUpdates.length > 0) parts.push(`${optionUpdates.length} updated options`);
            
            alert(`✅ Expedition saved successfully!\n\n${parts.join(', ')} saved to database.\n\nNote: Items are pending approval.`);
            console.log('Save result:', result);
        } else {
            throw new Error(result.message || 'Unknown error');
        }

    } catch (error) {
        console.error('Failed to save expedition:', error);
        alert(`❌ Failed to save expedition:\n${error.message}`);
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = '💾 Save Expedition';
        }
    }
}
window.saveExpedition = saveExpedition;

// ==================== LOAD EXPEDITION ====================
async function loadExpedition() {
    const loadBtn = document.getElementById('loadExpeditionBtn');
    if (loadBtn) {
        loadBtn.disabled = true;
        loadBtn.textContent = '⏳ Loading...';
    }

    try {
        const token = await getCurrentAccessToken();
        if (!token) {
            throw new Error('Not authenticated');
        }

        const response = await fetch('http://localhost:8080/api/getExpedition', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error(`Server error: ${response.status}`);
        }

        const data = await response.json();
        
        if (!data.success) {
            throw new Error('Failed to load expedition data');
        }

        console.log('Loaded expedition data:', data);

        // Clear existing state
        expeditionState.slides.clear();
        expeditionState.connections = [];
        expeditionState.serverSlides.clear();
        expeditionState.serverOptions.clear();
        expeditionState.serverOutcomes.clear();
        expeditionState.originalSlides.clear();
        expeditionState.originalOptions.clear();

        // Clear the canvas
        const container = document.getElementById('slidesContainer');
        if (container) {
            container.innerHTML = '';
        }

        // Create a mapping from server toolingId to local ID
        const toolingIdToLocalId = new Map();
        
        // First pass: create all slides
        let localId = 1;
        for (const serverSlide of data.slides) {
            const slide = {
                id: localId,
                text: serverSlide.text || '',
                isStart: serverSlide.isStart || false,
                x: serverSlide.posX || 100,
                y: serverSlide.posY || 100,
                options: [],
                assetUrl: serverSlide.assetId ? `https://gamedata-assets.s3.eu-north-1.amazonaws.com/images/expedition/${serverSlide.assetId}.webp` : null,
                reward: buildRewardFromServer(serverSlide),
                effect: serverSlide.effectId ? { effectId: serverSlide.effectId, effectFactor: serverSlide.effectFactor } : null
            };

            // Map toolingId -> localId
            toolingIdToLocalId.set(serverSlide.toolingId, localId);
            
            // Track this as a server slide
            expeditionState.serverSlides.set(localId, serverSlide.toolingId);
            
            // Store original values for change detection
            expeditionState.originalSlides.set(localId, {
                text: serverSlide.text || '',
                isStart: serverSlide.isStart || false,
                assetId: serverSlide.assetId || null,
                effectId: serverSlide.effectId || null,
                effectFactor: serverSlide.effectFactor || null,
                reward: buildRewardFromServer(serverSlide)
            });
            
            expeditionState.slides.set(localId, slide);
            localId++;
        }

        expeditionState.nextSlideId = localId;

        // Second pass: add options to slides
        for (const serverSlide of data.slides) {
            const slideLocalId = toolingIdToLocalId.get(serverSlide.toolingId);
            const slide = expeditionState.slides.get(slideLocalId);
            
            if (!slide || !serverSlide.options) continue;

            for (let optIdx = 0; optIdx < serverSlide.options.length; optIdx++) {
                const serverOpt = serverSlide.options[optIdx];
                
                // Determine option type
                let optType = 'dialogue';
                if (serverOpt.statType) optType = 'skill';
                else if (serverOpt.effectId) optType = 'effect';
                else if (serverOpt.enemyId) optType = 'combat';

                const option = {
                    text: serverOpt.text || '',
                    type: optType,
                    statType: serverOpt.statType,
                    statRequired: serverOpt.statRequired,
                    effectId: serverOpt.effectId,
                    effectAmount: serverOpt.effectAmount,
                    enemyId: serverOpt.enemyId
                };

                slide.options.push(option);
                
                // Track this as a server option
                const optionKey = `${slideLocalId}-${optIdx}`;
                expeditionState.serverOptions.set(optionKey, serverOpt.toolingId);
                
                // Store original option values for change detection
                expeditionState.originalOptions.set(optionKey, {
                    text: serverOpt.text || '',
                    type: optType,
                    statType: serverOpt.statType || null,
                    statRequired: serverOpt.statRequired || null,
                    effectId: serverOpt.effectId || null,
                    effectAmount: serverOpt.effectAmount || null,
                    enemyId: serverOpt.enemyId || null
                });

                // Third pass: create connections from outcomes
                if (serverOpt.outcomes) {
                    for (const outcome of serverOpt.outcomes) {
                        const targetLocalId = toolingIdToLocalId.get(outcome.targetSlideId);
                        if (targetLocalId) {
                            expeditionState.connections.push({
                                from: slideLocalId,
                                option: optIdx,
                                to: targetLocalId,
                                weight: outcome.weight || 1
                            });
                            // Track this as a server outcome using option->target key
                            const outcomeKey = `${serverOpt.toolingId}-${outcome.targetSlideId}`;
                            expeditionState.serverOutcomes.add(outcomeKey);
                        }
                    }
                }
            }
        }

        // Render all slides
        expeditionState.slides.forEach(slide => {
            renderSlide(slide);
        });

        // Render connections
        renderConnections();
        updateCounter();
        
        // Center the view
        centerCanvas();

        console.log(`✅ Loaded ${data.slides.length} slides from server`);

    } catch (error) {
        console.error('Failed to load expedition:', error);
        alert(`❌ Failed to load expedition:\n${error.message}`);
    } finally {
        if (loadBtn) {
            loadBtn.disabled = false;
            loadBtn.textContent = '📥 Load Expedition';
        }
    }
}
window.loadExpedition = loadExpedition;

// Helper to build reward object from server data
function buildRewardFromServer(serverSlide) {
    if (serverSlide.rewardStatType && serverSlide.rewardStatAmount) {
        return { type: 'stat', statType: serverSlide.rewardStatType, amount: serverSlide.rewardStatAmount };
    }
    if (serverSlide.rewardTalent) {
        return { type: 'talent' };
    }
    if (serverSlide.rewardItem) {
        return { type: 'item', itemId: serverSlide.rewardItem };
    }
    if (serverSlide.rewardPerk) {
        return { type: 'perk', perkId: serverSlide.rewardPerk };
    }
    if (serverSlide.rewardBlessing) {
        return { type: 'blessing', blessingId: serverSlide.rewardBlessing };
    }
    if (serverSlide.rewardPotion) {
        return { type: 'potion', potionId: serverSlide.rewardPotion };
    }
    return null;
}

// ==================== EXPOSE GLOBALLY ====================
window.initExpeditionDesigner = initExpeditionDesigner;
window.addExpeditionSlide = addSlide;
window.closeBgPicker = closeBgPicker;
window.applyBgUrl = applyBgUrl;
window.clearSlideBg = clearSlideBg;
window.closeOptionModal = closeOptionModal;
window.saveOptionFromModal = saveOptionFromModal;
window.uploadSlideBgFromDevice = uploadSlideBgFromDevice;
window.updateOptionModalFields = updateOptionModalFields;
window.populateExpeditionDropdowns = populateDropdownsOnce;

console.log('✅ expedition-designer.js READY');
