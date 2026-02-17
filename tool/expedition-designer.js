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
    // Settlement filter
    selectedSettlementId: null,
    settlements: [],
    // Track which slides/options/outcomes already exist on the server (by slideId/optionId)
    serverSlides: new Map(), // localId -> slideId
    serverOptions: new Map(), // "localSlideId-optionIndex" -> optionId
    serverOutcomes: new Set(), // Set of "optionId-targetSlideId" keys
    // Track original values for change detection
    originalSlides: new Map(), // localId -> { text, assetId, effectId, effectFactor, isStart, reward, ... }
    originalOptions: new Map(), // "localSlideId-optionIndex" -> { text, type, statType, statRequired, ... }
    // Track staged deletions that will be committed on save
    pendingSlideDeletes: new Set(),
    pendingOptionDeletes: new Set(),
    pendingConnectionDeletes: new Set(),
    selectedSlides: new Set()
};

const expeditionGenerateState = {
    npcs: [],
    rewardItems: [],
    rewardPerks: [],
    rewardPotions: [],
    rewardBlessings: [],
    lastRequest: null
};

const expeditionPreviewState = {
    isOpen: false,
    currentSlideId: null,
    history: [],
    settlementId: null
};

const EXPEDITION_ASSET_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
const expeditionDataSubscriptions = [];

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
    
    // Direct wheel listener on zoom indicator for better reliability
    const zoomIndicator = document.getElementById('zoomIndicator');
    if (zoomIndicator) {
        zoomIndicator.addEventListener('wheel', function(e) {
            e.preventDefault();
            e.stopPropagation();
            const zoomSpeed = 0.05;
            const delta = e.deltaY > 0 ? -zoomSpeed : zoomSpeed;
            changeZoom(delta);
        }, { passive: false });
        console.log('✅ Wheel event listener attached directly to zoomIndicator');
    }
    
    // Zoom with mouse wheel on canvas - use document-level capture to prevent browser interference
    document.addEventListener('wheel', function(e) {
        const canvas = document.getElementById('expeditionCanvas');
        if (!canvas) return;
        
        // Only handle wheel events if expedition page is visible
        const expeditionPage = document.getElementById('dungeons-content');
        if (!expeditionPage || expeditionPage.style.display === 'none') return;
        
        // Don't capture wheel if asset gallery overlay is open (allow scrolling in gallery)
        const galleryOverlay = document.getElementById('expeditionAssetGalleryOverlay');
        if (galleryOverlay && galleryOverlay.classList.contains('active')) return;

        const panel = document.getElementById('expeditionGenerateOverlay');
        if (panel && panel.style.display === 'flex') {
            return;
        }
        
        // Check if mouse is over the canvas
        const canvasRect = canvas.getBoundingClientRect();
        const isOverCanvas = e.clientX >= canvasRect.left && e.clientX <= canvasRect.right &&
                            e.clientY >= canvasRect.top && e.clientY <= canvasRect.bottom;
        
        if (isOverCanvas) {
            e.preventDefault();
            e.stopPropagation();
            expeditionOnCanvasWheel(e);
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
    
    // Asset gallery upload button
    const uploadBtn = document.getElementById('expeditionUploadBtn');
    if (uploadBtn) {
        uploadBtn.addEventListener('click', () => {
            document.getElementById('expeditionAssetFileInput').click();
        });
    }
    
    const fileInput = document.getElementById('expeditionAssetFileInput');
    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                uploadExpeditionAsset(file);
            }
            e.target.value = ''; // Reset for next upload
        });
    }
    
    // Asset gallery - click overlay to close
    const expeditionGalleryOverlay = document.getElementById('expeditionAssetGalleryOverlay');
    if (expeditionGalleryOverlay) {
        expeditionGalleryOverlay.addEventListener('click', (e) => {
            if (e.target === expeditionGalleryOverlay) {
                closeExpeditionAssetGallery();
            }
        });
    }
    
    // Asset gallery - ESC to close
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const galleryOverlay = document.getElementById('expeditionAssetGalleryOverlay');
            if (galleryOverlay && galleryOverlay.classList.contains('active')) {
                closeExpeditionAssetGallery();
            }
        }
    });
    
    // Asset gallery - filter input
    const expeditionAssetFilter = document.getElementById('expeditionAssetFilter');
    if (expeditionAssetFilter) {
        expeditionAssetFilter.addEventListener('input', (e) => {
            populateExpeditionAssetGallery(e.target.value);
        });
    }
    
    updateCounter();
    console.log('✅ Expedition Designer ready');
    
    setupExpeditionDataSubscriptions();
    // Load expedition assets from GlobalData (shared quest assets)
    loadExpeditionAssets();
    
    // Load settlements for dropdown
    loadExpeditionSettlements();

    setupExpeditionGeneratePanel();
    setupExpeditionPreviewOverlay();
}

function setupExpeditionDataSubscriptions() {
    if (typeof subscribeToGlobalData !== 'function') {
        return;
    }

    if (expeditionDataSubscriptions.length > 0) {
        expeditionDataSubscriptions.forEach((unsubscribe) => unsubscribe());
        expeditionDataSubscriptions.length = 0;
    }

    expeditionDataSubscriptions.push(subscribeToGlobalData('settlements', () => {
        expeditionState.settlements = GlobalData?.settlements || [];
        populateSettlementDropdown();
    }));

    expeditionDataSubscriptions.push(subscribeToGlobalData('items', () => {
        expeditionState.dropdownsPopulated = false;
        populateDropdownsOnce();
        populateRewardPickers();
        populateExpeditionGenerateRewards();
    }));

    expeditionDataSubscriptions.push(subscribeToGlobalData('perks', () => {
        expeditionState.dropdownsPopulated = false;
        populateDropdownsOnce();
        populateRewardPickers();
        populateExpeditionGenerateRewards();
    }));

    expeditionDataSubscriptions.push(subscribeToGlobalData('effects', () => {
        expeditionState.dropdownsPopulated = false;
        populateDropdownsOnce();
    }));

    expeditionDataSubscriptions.push(subscribeToGlobalData('questAssets', () => {
        if (isExpeditionAssetGalleryOpen()) {
            const filterValue = document.getElementById('expeditionAssetFilter')?.value || '';
            populateExpeditionAssetGallery(filterValue);
        }
    }));
}

// ==================== EXPEDITION PREVIEW ====================
function setupExpeditionPreviewOverlay() {
    const toggleBtn = document.getElementById('expeditionPreviewToggle');
    const resetBtn = document.getElementById('expeditionPreviewReset');
    const closeBtn = document.getElementById('expeditionPreviewClose');
    const backBtn = document.getElementById('expeditionPreviewBack');
    const overlay = document.getElementById('expeditionPreviewOverlay');

    toggleBtn?.addEventListener('click', () => openExpeditionPreviewOverlay());
    resetBtn?.addEventListener('click', () => resetExpeditionPreview());
    closeBtn?.addEventListener('click', closeExpeditionPreviewOverlay);
    backBtn?.addEventListener('click', expeditionPreviewGoBack);

    overlay?.addEventListener('click', (e) => {
        if (e.target === overlay) {
            closeExpeditionPreviewOverlay();
        }
    });

    document.addEventListener('keydown', expeditionPreviewHandleKeydown);
}

function expeditionPreviewHandleKeydown(e) {
    if (e.key === 'Escape' && expeditionPreviewState.isOpen) {
        closeExpeditionPreviewOverlay();
    }
}

function openExpeditionPreviewOverlay(preferredSlideId = null) {
    const overlay = document.getElementById('expeditionPreviewOverlay');
    if (!overlay) return;
    expeditionPreviewState.isOpen = true;
    overlay.classList.add('active');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('quest-preview-open');
    startExpeditionPreview(preferredSlideId);
}

function closeExpeditionPreviewOverlay() {
    const overlay = document.getElementById('expeditionPreviewOverlay');
    if (!overlay) return;
    overlay.classList.remove('active');
    overlay.setAttribute('aria-hidden', 'true');
    const questOverlay = document.getElementById('questPreviewOverlay');
    const questOpen = questOverlay?.classList.contains('active');
    if (!questOpen) {
        document.body.classList.remove('quest-preview-open');
    }
    expeditionPreviewState.isOpen = false;
    expeditionPreviewState.currentSlideId = null;
    expeditionPreviewState.history = [];
}

function resetExpeditionPreview(preferredSlideId = null) {
    if (!expeditionPreviewState.isOpen) return;
    startExpeditionPreview(preferredSlideId);
}

function startExpeditionPreview(preferredSlideId = null) {
    if (!expeditionPreviewState.isOpen) return;
    expeditionPreviewState.settlementId = expeditionState.selectedSettlementId || null;
    const slides = getExpeditionPreviewSlides(expeditionPreviewState.settlementId);
    if (!slides.length) {
        expeditionPreviewState.currentSlideId = null;
        expeditionPreviewState.history = [];
        renderExpeditionPreviewEmpty('No slides match the current settlement filter.');
        return;
    }

    const startSlide = findExpeditionPreviewStartSlide(slides, preferredSlideId);
    if (!startSlide) {
        expeditionPreviewState.currentSlideId = null;
        expeditionPreviewState.history = [];
        renderExpeditionPreviewEmpty('No slides match the current settlement filter.');
        return;
    }

    expeditionPreviewState.currentSlideId = startSlide.id;
    expeditionPreviewState.history = [];
    renderExpeditionPreview();
}

function getExpeditionPreviewSlides(settlementId) {
    const slides = [];
    expeditionState.slides.forEach(slide => {
        if (!settlementId || slide.settlementId === settlementId) {
            slides.push(slide);
        }
    });
    return slides;
}

function findExpeditionPreviewStartSlide(slides, preferredSlideId = null) {
    const settlementId = expeditionState.selectedSettlementId || null;
    if (preferredSlideId) {
        const preferred = expeditionState.slides.get(preferredSlideId);
        if (preferred && (!settlementId || preferred.settlementId === settlementId)) {
            return preferred;
        }
    }

    const selectedId = expeditionState.selectedSlide;
    if (selectedId) {
        const selected = expeditionState.slides.get(selectedId);
        if (selected && (!settlementId || selected.settlementId === settlementId)) {
            return selected;
        }
    }

    const startSlides = slides.filter(slide => slide.isStart);
    if (startSlides.length) {
        return startSlides[Math.floor(Math.random() * startSlides.length)];
    }

    return slides[Math.floor(Math.random() * slides.length)] || null;
}

function renderExpeditionPreview() {
    if (!expeditionPreviewState.isOpen) return;
    const slide = expeditionState.slides.get(expeditionPreviewState.currentSlideId);
    if (!slide) {
        renderExpeditionPreviewEmpty('Select a slide to start previewing the expedition.');
        return;
    }

    const titleEl = document.getElementById('expeditionPreviewTitle');
    if (titleEl) {
        titleEl.textContent = slide.isStart ? `Start Slide #${slide.id}` : `Slide #${slide.id}`;
    }

    const sceneEl = document.getElementById('expeditionPreviewScene');
    if (sceneEl) {
        const previewUrl = slide.assetPreviewUrl;
        const hasBackground = previewUrl && previewUrl !== EXPEDITION_ASSET_PLACEHOLDER;
        if (hasBackground) {
            sceneEl.style.backgroundImage = `linear-gradient(180deg, rgba(5,10,25,0.1) 5%, rgba(5,10,25,0.85) 95%), url(${previewUrl})`;
            sceneEl.style.backgroundSize = 'cover';
            sceneEl.style.backgroundPosition = 'center';
        } else {
            sceneEl.style.backgroundImage = 'linear-gradient(180deg, #1b2350, #0f142d)';
        }
    }

    const textEl = document.getElementById('expeditionPreviewText');
    if (textEl) {
        textEl.innerHTML = formatExpeditionPreviewText(slide.text);
    }

    const rewardEl = document.getElementById('expeditionPreviewReward');
    if (rewardEl) {
        const rewardText = getExpeditionPreviewRewardText(slide.reward);
        if (rewardText) {
            rewardEl.style.display = 'block';
            rewardEl.textContent = rewardText;
        } else {
            rewardEl.style.display = 'none';
            rewardEl.textContent = '';
        }
    }

    renderExpeditionPreviewOptions(slide);

    const statusEl = document.getElementById('expeditionPreviewStatus');
    if (statusEl) {
        const settlementLabel = getExpeditionPreviewSettlementLabel(expeditionPreviewState.settlementId);
        const optionCount = slide.options.length;
        const optionLabel = optionCount === 1 ? '1 option' : `${optionCount} options`;
        statusEl.textContent = `${settlementLabel} • ${optionLabel}`;
    }

    const backBtn = document.getElementById('expeditionPreviewBack');
    if (backBtn) {
        backBtn.disabled = expeditionPreviewState.history.length === 0;
    }
}

function renderExpeditionPreviewEmpty(message) {
    const titleEl = document.getElementById('expeditionPreviewTitle');
    if (titleEl) titleEl.textContent = 'Expedition Preview';

    const sceneEl = document.getElementById('expeditionPreviewScene');
    if (sceneEl) {
        sceneEl.style.backgroundImage = 'linear-gradient(180deg, #1b2350, #0f142d)';
    }

    const textEl = document.getElementById('expeditionPreviewText');
    if (textEl) {
        textEl.innerHTML = `<span class="quest-preview-empty">${escapeHtml(message)}</span>`;
    }

    const rewardEl = document.getElementById('expeditionPreviewReward');
    if (rewardEl) {
        rewardEl.style.display = 'none';
        rewardEl.textContent = '';
    }

    const optionsEl = document.getElementById('expeditionPreviewOptions');
    if (optionsEl) {
        optionsEl.innerHTML = '';
        const empty = document.createElement('p');
        empty.className = 'quest-preview-empty';
        empty.textContent = message;
        optionsEl.appendChild(empty);
    }

    const statusEl = document.getElementById('expeditionPreviewStatus');
    if (statusEl) statusEl.textContent = '';

    const backBtn = document.getElementById('expeditionPreviewBack');
    if (backBtn) backBtn.disabled = true;
}

function renderExpeditionPreviewOptions(slide) {
    const container = document.getElementById('expeditionPreviewOptions');
    if (!container) return;
    container.innerHTML = '';

    if (!slide.options.length) {
        const empty = document.createElement('p');
        empty.className = 'quest-preview-empty';
        empty.textContent = 'No options configured yet.';
        container.appendChild(empty);
        return;
    }

    slide.options.forEach((option, idx) => {
        const connections = getExpeditionPreviewConnections(slide.id, idx);
        const typeBadge = getExpeditionOptionTypeBadge(option.type || 'dialogue');
        const requirement = getExpeditionOptionRequirement(option);
        const summaryParts = [typeBadge];
        if (requirement) summaryParts.push(requirement);
        summaryParts.push(formatExpeditionConnectionSummary(connections));

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'quest-preview-option';
        btn.innerHTML = `
            <span class="option-label">${escapeHtml(option.text || `Option ${idx + 1}`)}</span>
            <span class="option-meta">${summaryParts.filter(Boolean).join(' • ')}</span>
        `;

        if (connections.length) {
            btn.addEventListener('click', () => advanceExpeditionPreview(slide.id, idx));
        } else {
            btn.disabled = true;
        }

        container.appendChild(btn);
    });
}

function getExpeditionOptionRequirement(option) {
    switch (option.type) {
        case 'skill':
            if (option.statType && option.statRequired) {
                return `Requires ${option.statRequired}+ ${option.statType}`;
            }
            return 'Skill check';
        case 'effect':
            if (option.effectId) {
                return `Needs effect #${option.effectId}${option.effectAmount ? ` (${option.effectAmount})` : ''}`;
            }
            return 'Effect gate';
        case 'combat':
            if (option.enemyId) {
                return `Enemy #${option.enemyId}`;
            }
            return 'Combat encounter';
        case 'faction':
            if (option.factionRequired) {
                const label = option.factionRequired.charAt(0).toUpperCase() + option.factionRequired.slice(1);
                return `${label} members`;
            }
            return 'Faction gate';
        default:
            return '';
    }
}

function getExpeditionOptionTypeBadge(type) {
    const labels = {
        dialogue: 'Dialogue',
        skill: 'Skill Check',
        effect: 'Effect Check',
        combat: 'Combat',
        faction: 'Faction Gate'
    };
    const safeType = type || 'dialogue';
    return `${getTypeIcon(safeType)} ${labels[safeType] || 'Choice'}`;
}

function getExpeditionPreviewConnections(slideId, optionIndex) {
    const settlementId = expeditionPreviewState.settlementId ?? expeditionState.selectedSettlementId ?? null;
    return expeditionState.connections
        .filter(conn => conn.from === slideId && conn.option === optionIndex)
        .map(conn => ({ ...conn, target: expeditionState.slides.get(conn.to) }))
        .filter(conn => conn.target && (!settlementId || conn.target.settlementId === settlementId));
}

function pickWeightedConnection(connections) {
    if (!connections.length) return null;
    const total = connections.reduce((sum, conn) => sum + (conn.weight || 1), 0);
    let roll = Math.random() * total;
    for (const conn of connections) {
        roll -= conn.weight || 1;
        if (roll <= 0) return conn;
    }
    return connections[connections.length - 1];
}

function advanceExpeditionPreview(slideId, optionIndex) {
    const connections = getExpeditionPreviewConnections(slideId, optionIndex);
    if (!connections.length) return;

    if (expeditionPreviewState.currentSlideId != null) {
        expeditionPreviewState.history.push(expeditionPreviewState.currentSlideId);
    }

    const target = pickWeightedConnection(connections);
    if (!target || !target.target) return;

    expeditionPreviewState.currentSlideId = target.target.id;
    renderExpeditionPreview();
}

function expeditionPreviewGoBack() {
    if (!expeditionPreviewState.history.length) return;
    expeditionPreviewState.currentSlideId = expeditionPreviewState.history.pop();
    renderExpeditionPreview();
}

function formatExpeditionPreviewText(text) {
    if (!text || !text.trim()) {
        return '<span class="quest-preview-empty">No text yet.</span>';
    }
    return escapeHtml(text).replace(/\r?\n/g, '<br>');
}

function getExpeditionPreviewRewardText(reward) {
    if (!reward || !reward.type) return '';
    const label = getRewardLabel(reward);
    return label ? `You receive ${label}` : '';
}

function getExpeditionPreviewSettlementLabel(settlementId) {
    if (!settlementId) return 'All settlements';
    const match = (expeditionState.settlements || []).find(settlement => String(settlement.settlement_id) === String(settlementId));
    return match?.settlement_name || `Settlement #${settlementId}`;
}

function formatExpeditionConnectionSummary(connections) {
    if (!connections.length) return 'No linked slides';
    if (connections.length === 1) {
        return `Leads to Slide #${connections[0].target.id}`;
    }
    return `Random outcome (${connections.length})`;
}

function syncExpeditionPreviewWithFilter() {
    if (!expeditionPreviewState.isOpen) return;
    const currentSettlement = expeditionState.selectedSettlementId || null;
    const slide = expeditionState.slides.get(expeditionPreviewState.currentSlideId);

    if (currentSettlement !== expeditionPreviewState.settlementId) {
        resetExpeditionPreview();
        return;
    }

    if (!slide || (currentSettlement && slide.settlementId !== currentSettlement)) {
        resetExpeditionPreview();
        return;
    }

    renderExpeditionPreview();
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
        assetId: null,
        assetUrl: null,
        assetPreviewUrl: null,
        reward: null,
        effect: null,  // { effectId, effectFactor }
        settlementId: expeditionState.selectedSettlementId || null
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
    const isSelected = expeditionState.selectedSlides.has(slide.id);
    el.className = `expedition-slide${slide.isStart ? ' start-slide' : ''}${isSelected ? ' selected' : ''}${isNewSlide ? ' new-slide' : ''}${isModified ? ' modified-slide' : ''}`;
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
        // Build detail badges for option metadata
        const detailBadges = [];
        if (opt.type === 'skill' && opt.statType) {
            detailBadges.push(`<span class="option-detail-badge skill">${opt.statType.slice(0,3).toUpperCase()}:${opt.statRequired || '?'}</span>`);
        } else if (opt.type === 'effect' && opt.effectId) {
            detailBadges.push(`<span class="option-detail-badge effect">E#${opt.effectId}:${opt.effectAmount || '?'}</span>`);
        } else if (opt.type === 'combat' && opt.enemyId) {
            detailBadges.push(`<span class="option-detail-badge combat">⚔️#${opt.enemyId}</span>`);
        } else if (opt.type === 'faction' && opt.factionRequired) {
            const factionLabel = opt.factionRequired.charAt(0).toUpperCase() + opt.factionRequired.slice(1);
            detailBadges.push(`<span class="option-detail-badge faction">${factionLabel}</span>`);
        }
        const detailsBadge = detailBadges.join('');
		
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
    const previewUrl = slide.assetPreviewUrl;
    const hasBackground = previewUrl && previewUrl !== EXPEDITION_ASSET_PLACEHOLDER;
    const bodyBgStyle = hasBackground
        ? `style="background-image: url(${previewUrl});"`
        : '';
    const bodyClass = hasBackground ? 'slide-body has-bg' : 'slide-body';
    
    const canAddMoreOptions = slide.options.length < 4;
    const addOptionButtonHtml = canAddMoreOptions
        ? `<button class="add-option-btn" data-slide="${slide.id}">+ Add Option</button>`
        : '';

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
                ${addOptionButtonHtml}
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

        const alreadySelected = expeditionState.selectedSlides.has(slide.id);
        if (e.shiftKey) {
            selectSlide(slide.id, { append: true });
        } else if (!alreadySelected || expeditionState.selectedSlides.size === 0) {
            selectSlide(slide.id);
        } else {
            expeditionState.selectedSlide = slide.id;
            updateSelectedSlideHighlights();
        }

        const activeSelection = expeditionState.selectedSlides.size
            ? Array.from(expeditionState.selectedSlides)
            : [slide.id];
        const startMouseX = e.clientX;
        const startMouseY = e.clientY;
        const startPositions = activeSelection.map(id => {
            const targetSlide = expeditionState.slides.get(id);
            return {
                id,
                startX: targetSlide?.x ?? 0,
                startY: targetSlide?.y ?? 0,
                element: document.getElementById(`slide-${id}`)
            };
        });

        const onMove = (ev) => {
            if (expeditionState.isConnecting) return;
            const deltaX = (ev.clientX - startMouseX) / expeditionState.zoom;
            const deltaY = (ev.clientY - startMouseY) / expeditionState.zoom;

            startPositions.forEach(({ id, startX, startY, element }) => {
                const targetSlide = expeditionState.slides.get(id);
                if (!targetSlide) return;
                targetSlide.x = startX + deltaX;
                targetSlide.y = startY + deltaY;
                if (element) {
                    element.style.left = `${targetSlide.x}px`;
                    element.style.top = `${targetSlide.y}px`;
                    element.classList.add('dragging');
                }
            });
            renderConnections();
        };

        const onUp = () => {
            startPositions.forEach(({ element }) => element?.classList.remove('dragging'));
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

function selectSlide(id, options = {}) {
    const { append = false, toggle = true } = options;
    if (!append) {
        expeditionState.selectedSlides.clear();
    }

    const isSelected = expeditionState.selectedSlides.has(id);
    if (append && toggle && isSelected) {
        expeditionState.selectedSlides.delete(id);
    } else {
        expeditionState.selectedSlides.add(id);
    }

    expeditionState.selectedSlide = id;
    updateSelectedSlideHighlights();
}

function updateSelectedSlideHighlights() {
    document.querySelectorAll('.expedition-slide').forEach(el => {
        const slideId = parseInt(el.id.replace('slide-', ''));
        el.classList.toggle('selected', expeditionState.selectedSlides.has(slideId));
    });
}

function queueServerConnectionDeletion(connection) {
    if (!connection) return;
    const optionKey = `${connection.from}-${connection.option}`;
    const optionId = expeditionState.serverOptions.get(optionKey);
    if (!optionId) return;

    let targetSlideId = null;
    if (expeditionState.serverSlides.has(connection.to)) {
        targetSlideId = expeditionState.serverSlides.get(connection.to);
    } else if (typeof connection.targetSlideDbId === 'number' && connection.targetSlideDbId > 0) {
        targetSlideId = connection.targetSlideDbId;
    }

    if (!targetSlideId) return;

    const outcomeKey = `${optionId}-${targetSlideId}`;
    expeditionState.pendingConnectionDeletes.add(outcomeKey);
    if (expeditionState.serverOutcomes.has(outcomeKey)) {
        expeditionState.serverOutcomes.delete(outcomeKey);
    }
}

async function deleteSlide(id) {
    if (!confirm('Delete this slide and all its connections?')) return;
    const slide = expeditionState.slides.get(id);
    if (!slide) return;

    const isServerSlide = expeditionState.serverSlides.has(id);
    const slideId = isServerSlide ? expeditionState.serverSlides.get(id) : null;

    const removedConnections = expeditionState.connections.filter(c => c.from === id || c.to === id);
    removedConnections.forEach(queueServerConnectionDeletion);

    // Remove connections
    expeditionState.connections = expeditionState.connections.filter(c => c.from !== id && c.to !== id);

    if (isServerSlide && slideId) {
        expeditionState.pendingSlideDeletes.add(slideId);
        expeditionState.serverSlides.delete(id);
        expeditionState.originalSlides.delete(id);

        // Clean up server options for this slide
        slide.options.forEach((_, optionIndex) => {
            const optionKey = `${id}-${optionIndex}`;
            const optionId = expeditionState.serverOptions.get(optionKey);
            if (!optionId) return;
            expeditionState.serverOptions.delete(optionKey);
            expeditionState.originalOptions.delete(optionKey);

            for (const outcomeKey of Array.from(expeditionState.serverOutcomes)) {
                if (outcomeKey.startsWith(`${optionId}-`)) {
                    expeditionState.serverOutcomes.delete(outcomeKey);
                }
            }
        });
    }
    
    // Remove element
    document.getElementById(`slide-${id}`)?.remove();
    
    // Remove from state
    expeditionState.slides.delete(id);
    expeditionState.selectedSlides.delete(id);
    if (expeditionState.selectedSlide === id) {
        expeditionState.selectedSlide = null;
    }
    updateSelectedSlideHighlights();
    
    renderConnections();
    updateCounter();
}

async function deleteOption(slideId, optionIndex) {
    const slide = expeditionState.slides.get(slideId);
    if (!slide) return;
    
    const optionKey = `${slideId}-${optionIndex}`;
    const isServerOption = expeditionState.serverOptions.has(optionKey);
    const optionId = isServerOption ? expeditionState.serverOptions.get(optionKey) : null;

    const optionConnections = expeditionState.connections.filter(conn => 
        conn.from === slideId && conn.option === optionIndex
    );
    optionConnections.forEach(queueServerConnectionDeletion);
    
    // If it's a server option, delete from database first
    if (isServerOption && optionId) {
        if (!confirm('Delete this option? It will be removed on Save.')) return;

        expeditionState.pendingOptionDeletes.add(optionId);
        expeditionState.serverOptions.delete(optionKey);
        expeditionState.originalOptions.delete(optionKey);

        for (const outcomeKey of Array.from(expeditionState.serverOutcomes)) {
            if (outcomeKey.startsWith(`${optionId}-`)) {
                expeditionState.serverOutcomes.delete(outcomeKey);
            }
        }
    }

    if (!isServerOption) {
        // Remove any tracked originals for unsaved options as part of reindexing
        expeditionState.originalOptions.delete(optionKey);
    }
    
    // Remove connections for this option
    expeditionState.connections = expeditionState.connections.filter(c => 
        !(c.from === slideId && c.option === optionIndex)
    );
    // Adjust indices for connections with higher option indices
    expeditionState.connections.forEach(c => {
        if (c.from === slideId && c.option > optionIndex) c.option--;
    });
    
    slide.options.splice(optionIndex, 1);
    renderSlide(slide);
    renderConnections();

    if (isServerOption) {
        // Re-index remaining options for server tracking
        for (let i = optionIndex; i < slide.options.length; i++) {
            const oldKey = `${slideId}-${i + 1}`;
            const newKey = `${slideId}-${i}`;
            if (expeditionState.serverOptions.has(oldKey)) {
                expeditionState.serverOptions.set(newKey, expeditionState.serverOptions.get(oldKey));
                expeditionState.serverOptions.delete(oldKey);
            }
            if (expeditionState.originalOptions.has(oldKey)) {
                expeditionState.originalOptions.set(newKey, expeditionState.originalOptions.get(oldKey));
                expeditionState.originalOptions.delete(oldKey);
            }
        }
    }
}

function getTypeIcon(type) {
    return { combat: '⚔️', skill: '🎯', effect: '✨', item: '🎒', faction: '🛡️' }[type] || '💬';
}

function getRewardIcon(type) {
    const icons = {
        stat: '📊',
        talent: '⭐',
        item: '🎒',
        perk: '🔮',
        blessing: '✨',
        potion: '🧪',
        silver: '🪙'
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
        case 'silver':
            return `${reward.amount || 0} silver`;
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
    const silverInput = document.getElementById('rewardSilverAmount');
    if (silverInput) {
        silverInput.value = reward.type === 'silver' ? (reward.amount || 0) : 100;
    }
    
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
        potion: document.getElementById('rewardPotionFields'),
        silver: document.getElementById('rewardSilverFields')
    };
    
    // Hide all
    Object.values(fields).forEach(f => { if (f) f.style.display = 'none'; });
    
    // Show relevant one
    if (type === 'stat' && fields.stat) fields.stat.style.display = 'block';
    if (type === 'item' && fields.item) fields.item.style.display = 'block';
    if (type === 'perk' && fields.perk) fields.perk.style.display = 'block';
    if (type === 'blessing' && fields.blessing) fields.blessing.style.display = 'block';
    if (type === 'potion' && fields.potion) fields.potion.style.display = 'block';
    if (type === 'silver' && fields.silver) fields.silver.style.display = 'block';
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
        case 'silver':
            reward.amount = parseInt(document.getElementById('rewardSilverAmount').value) || 0;
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
        enemyId: null,
        factionRequired: null
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

    const factionSelect = document.getElementById('optionFactionRequired');
    if (factionSelect) {
        factionSelect.value = opt.type === 'faction' ? (opt.factionRequired || '') : '';
    }
    
    // Show/hide relevant fields based on type
    updateOptionModalFields(opt.type || 'dialogue');
    
    document.getElementById('optionModal').classList.add('open');
}

function updateOptionModalFields(type) {
    const statFields = document.getElementById('optionStatFields');
    const effectFields = document.getElementById('optionEffectFields');
    const combatFields = document.getElementById('optionCombatFields');
    const factionFields = document.getElementById('optionFactionFields');
    
    // Hide all
    if (statFields) statFields.style.display = 'none';
    if (effectFields) effectFields.style.display = 'none';
    if (combatFields) combatFields.style.display = 'none';
    if (factionFields) factionFields.style.display = 'none';
    
    // Show relevant
    if (type === 'skill' && statFields) {
        statFields.style.display = 'flex';
    } else if (type === 'effect' && effectFields) {
        effectFields.style.display = 'flex';
    } else if (type === 'combat' && combatFields) {
        combatFields.style.display = 'block';
    } else if (type === 'faction' && factionFields) {
        factionFields.style.display = 'block';
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

    if (type !== 'skill') {
        option.statType = null;
        option.statRequired = null;
    }
    if (type !== 'effect') {
        option.effectId = null;
        option.effectAmount = null;
    }
    if (type !== 'combat') {
        option.enemyId = null;
    }

    if (type === 'faction') {
        option.factionRequired = document.getElementById('optionFactionRequired').value || null;
    } else {
        option.factionRequired = null;
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

function expeditionOnCanvasWheel(e) {
    // Note: preventDefault and stopPropagation are called in the document-level handler
    
    const container = document.getElementById('slidesContainer');
    if (!container) return false;
    
    // Scroll wheel = zoom (default), Shift+scroll = horizontal pan, Ctrl+scroll = vertical pan
    if (e.shiftKey) {
        // Horizontal pan
        const panSpeed = 1;
        expeditionState.canvasOffset.x -= e.deltaY * panSpeed;
        container.style.transform = `translate(${expeditionState.canvasOffset.x}px, ${expeditionState.canvasOffset.y}px) scale(${expeditionState.zoom})`;
        renderConnections();
    } else if (e.ctrlKey) {
        // Vertical pan
        const panSpeed = 1;
        expeditionState.canvasOffset.y -= e.deltaY * panSpeed;
        container.style.transform = `translate(${expeditionState.canvasOffset.x}px, ${expeditionState.canvasOffset.y}px) scale(${expeditionState.zoom})`;
        renderConnections();
    } else {
        // Zoom (default - no modifier needed)
        const zoomSpeed = 0.05;
        const delta = e.deltaY > 0 ? -zoomSpeed : zoomSpeed;
        const newZoom = Math.max(0.1, Math.min(2, expeditionState.zoom + delta));
        
        expeditionState.zoom = newZoom;
        
        container.style.transform = `translate(${expeditionState.canvasOffset.x}px, ${expeditionState.canvasOffset.y}px) scale(${expeditionState.zoom})`;
        
        // Update zoom indicator
        const indicator = document.getElementById('zoomIndicator');
        if (indicator) {
            indicator.textContent = `${Math.round(expeditionState.zoom * 100)}%`;
        }
        
        renderConnections();
    }
    
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
    
    // Helper to check if a slide passes the current filter
    const slidePassesFilter = (slide) => {
        if (!expeditionState.selectedSettlementId) return true;
        return slide.settlementId === expeditionState.selectedSettlementId;
    };
    
    expeditionState.connections.forEach((conn, i) => {
        const fromSlide = expeditionState.slides.get(conn.from);
        const toSlide = expeditionState.slides.get(conn.to);
        if (!fromSlide || !toSlide) return;
        
        // Skip connection if either slide is filtered out
        if (!slidePassesFilter(fromSlide) || !slidePassesFilter(toSlide)) return;
        
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
                queueServerConnectionDeletion(conn);
                expeditionState.connections.splice(i, 1);
                renderConnections();
            }
        });
        svg.appendChild(path);
    });
}

// ==================== EXPEDITION ASSET GALLERY (uses shared quest assets) ====================
let expeditionEditingSlide = null;

function openExpeditionAssetGallery(slideId) {
    expeditionEditingSlide = slideId;
    
    const overlay = document.getElementById('expeditionAssetGalleryOverlay');
    if (overlay) {
        // Clear filter
        const filterInput = document.getElementById('expeditionAssetFilter');
        if (filterInput) filterInput.value = '';
        
        populateExpeditionAssetGallery();
        overlay.classList.add('active');
    }
}
window.openBgPicker = openExpeditionAssetGallery; // Keep old function name for compatibility

function closeExpeditionAssetGallery() {
    const overlay = document.getElementById('expeditionAssetGalleryOverlay');
    if (overlay) overlay.classList.remove('active');
    expeditionEditingSlide = null;
}
window.closeExpeditionAssetGallery = closeExpeditionAssetGallery;
window.closeBgPicker = closeExpeditionAssetGallery; // Alias for compatibility

function isExpeditionAssetGalleryOpen() {
    const overlay = document.getElementById('expeditionAssetGalleryOverlay');
    return overlay?.classList.contains('active') || false;
}

function getExpeditionAssetThumbSrc(asset) {
    if (!asset) return EXPEDITION_ASSET_PLACEHOLDER;
    if (asset.localUrl) return asset.localUrl;
    if (typeof getQuestAssetObjectUrl === 'function') {
        const cached = getQuestAssetObjectUrl(asset);
        if (cached) return cached;
    }
    return EXPEDITION_ASSET_PLACEHOLDER;
}

function hydrateExpeditionAssetThumbnails(assets) {
    if (typeof ensureQuestAssetObjectUrl !== 'function') return;
    const gallery = document.getElementById('expeditionAssetGallery');
    if (!gallery || !Array.isArray(assets)) return;

    assets.forEach((asset) => {
        ensureQuestAssetObjectUrl(asset)
            .then((objectUrl) => {
                const img = gallery.querySelector(`.expedition-asset-item[data-asset-id="${asset.id}"] img`);
                if (img) {
                    img.src = objectUrl;
                    img.dataset.loaded = 'true';
                }
            })
            .catch(() => {
                const img = gallery.querySelector(`.expedition-asset-item[data-asset-id="${asset.id}"] img`);
                if (img && !img.dataset.loaded) {
                    img.src = asset.url;
                    img.dataset.loaded = 'fallback';
                }
            });
    });
}

function hydrateSlideAssetPreview(slideId, assetId, fallbackUrl = null) {
    if (typeof ensureQuestAssetObjectUrl !== 'function' || !assetId) return;
    ensureQuestAssetObjectUrl(assetId)
        .then((objectUrl) => {
            const slide = expeditionState.slides.get(slideId);
            if (slide && slide.assetId === assetId) {
                slide.assetPreviewUrl = objectUrl;
                renderSlide(slide);
                renderConnections();
            }
        })
        .catch(() => {
            if (!fallbackUrl) return;
            const slide = expeditionState.slides.get(slideId);
            if (slide && slide.assetId === assetId) {
                slide.assetPreviewUrl = fallbackUrl;
                renderSlide(slide);
                renderConnections();
            }
        });
}

function primeSlideAssetPreview(slide, assetId, remoteUrl) {
    if (!slide) return;
    slide.assetId = assetId ?? null;
    slide.assetUrl = remoteUrl ?? slide.assetUrl ?? null;
    if (!slide.assetId || !slide.assetUrl) {
        slide.assetPreviewUrl = null;
        return;
    }
    const cachedPreview = typeof getQuestAssetObjectUrl === 'function'
        ? getQuestAssetObjectUrl(slide.assetId)
        : null;
    slide.assetPreviewUrl = cachedPreview || EXPEDITION_ASSET_PLACEHOLDER;
    if (!cachedPreview) {
        hydrateSlideAssetPreview(slide.id, slide.assetId, slide.assetUrl);
    }
}

async function loadExpeditionAssets() {
    // Use GlobalData.questAssets (shared with quests)
    if (typeof loadQuestAssetsData === 'function') {
        await loadQuestAssetsData();
    }
    console.log('✅ Expedition using GlobalData.questAssets:', GlobalData.questAssets?.length || 0, 'assets');
}

// Get location-asset mapping from GlobalData (shared with quest)
function getExpeditionLocationAssetIds() {
    const assetLocationMap = new Map();
    const settlements = GlobalData.settlements || [];
    
    settlements.forEach(settlement => {
        const locations = settlement.locations || [];
        locations.forEach(loc => {
            if (loc.texture_id) {
                const existing = assetLocationMap.get(loc.texture_id) || [];
                existing.push(loc.name);
                assetLocationMap.set(loc.texture_id, existing);
            }
        });
    });
    
    return assetLocationMap;
}

function populateExpeditionAssetGallery(filterText = '') {
    const gallery = document.getElementById('expeditionAssetGallery');
    if (!gallery) return;
    
    // Use quest assets from GlobalData
    const assets = GlobalData.questAssets || [];
    
    // Get current asset ID for selected state
    const currentSlide = expeditionEditingSlide ? expeditionState.slides.get(expeditionEditingSlide) : null;
    const currentAssetId = currentSlide
        ? (currentSlide.assetId ?? getAssetIdFromUrl(currentSlide.assetUrl))
        : null;
    
    if (assets.length === 0) {
        gallery.innerHTML = '<p style="color:#a0aec0;text-align:center;padding:40px;">No assets yet. Upload some!</p>';
        return;
    }
    
    // Get location-asset mapping for filtering
    const assetLocationMap = getExpeditionLocationAssetIds();
    
    // Filter assets by location name if filter text provided
    let filteredAssets = assets;
    if (filterText.trim()) {
        const searchTerm = filterText.toLowerCase().trim();
        filteredAssets = assets.filter(asset => {
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
        const thumbSrc = getExpeditionAssetThumbSrc(asset);
        return `
            <div class="expedition-asset-item ${asset.id === currentAssetId ? 'selected' : ''}" 
                 data-asset-id="${asset.id}">
                <img src="${thumbSrc}" alt="Asset ${asset.id}" loading="lazy">
                <div class="asset-id">${locationLabel || `ID: ${asset.id}`}</div>
            </div>
        `;
    }).join('');
    
    // Add click listeners
    gallery.querySelectorAll('.expedition-asset-item').forEach(item => {
        item.addEventListener('click', () => {
            const assetId = parseInt(item.dataset.assetId);
            const asset = assets.find(a => a.id === assetId);
            if (asset) {
                selectExpeditionAsset(asset.id, asset.url);
            }
        });
    });

    hydrateExpeditionAssetThumbnails(filteredAssets);
}

function selectExpeditionAsset(assetId, assetUrl) {
    if (!expeditionEditingSlide) return;
    
    const slide = expeditionState.slides.get(expeditionEditingSlide);
    if (slide) {
        const sourceAssets = GlobalData.questAssets || [];
        const asset = sourceAssets.find(a => a.id === assetId) || { id: assetId, url: assetUrl };
        primeSlideAssetPreview(slide, assetId, assetUrl);
        if (slide.assetPreviewUrl == null) {
            slide.assetPreviewUrl = getExpeditionAssetThumbSrc(asset);
        }
        renderSlide(slide);
        renderConnections();
    }
    
    closeExpeditionAssetGallery();
}

function applyBgUrl(url) {
    if (!expeditionEditingSlide) return;
    const slide = expeditionState.slides.get(expeditionEditingSlide);
    if (slide) {
        slide.assetId = url ? getAssetIdFromUrl(url) : null;
        slide.assetUrl = url || null;
        slide.assetPreviewUrl = url || null;
        renderSlide(slide);
        renderConnections();
    }
    closeExpeditionAssetGallery();
}

function clearSlideBg() {
    if (!expeditionEditingSlide) return;
    const slide = expeditionState.slides.get(expeditionEditingSlide);
    if (slide) {
        slide.assetId = null;
        slide.assetUrl = null;
        slide.assetPreviewUrl = null;
        renderSlide(slide);
        renderConnections();
    }
    closeExpeditionAssetGallery();
}

function setupExpeditionGeneratePanel() {
    document.getElementById('expeditionGenerateBtn')?.addEventListener('click', toggleExpeditionGeneratePanel);
    document.getElementById('expeditionGenerateClose')?.addEventListener('click', toggleExpeditionGeneratePanel);
    document.getElementById('expeditionGenerateRun')?.addEventListener('click', generateExpeditionClusterPreview);
    document.getElementById('expeditionGenerateLocationFilter')?.addEventListener('input', (e) => {
        populateExpeditionGenerateLocations(e.target.value);
    });
    document.getElementById('expeditionGenerateNpcFilter')?.addEventListener('input', (e) => {
        populateExpeditionGenerateNpcs(e.target.value);
    });
    document.getElementById('expeditionGenerateEnemyFilter')?.addEventListener('input', (e) => {
        populateExpeditionGenerateEnemies(e.target.value);
    });
    document.getElementById('expeditionGenerateItemRewardFilter')?.addEventListener('input', (e) => {
        populateExpeditionGenerateRewardItems(e.target.value);
    });
    document.getElementById('expeditionGeneratePerkRewardFilter')?.addEventListener('input', (e) => {
        populateExpeditionGenerateRewardPerks(e.target.value);
    });
    document.getElementById('expeditionGeneratePotionRewardFilter')?.addEventListener('input', (e) => {
        populateExpeditionGenerateRewardPotions(e.target.value);
    });
    document.getElementById('expeditionGenerateBlessingRewardFilter')?.addEventListener('input', (e) => {
        populateExpeditionGenerateRewardBlessings(e.target.value);
    });
}

function toggleExpeditionGeneratePanel() {
    const overlay = document.getElementById('expeditionGenerateOverlay');
    if (!overlay) return;
    const isOpen = overlay.style.display === 'flex';
    overlay.style.display = isOpen ? 'none' : 'flex';
    if (!isOpen) {
        populateExpeditionGeneratePanel();
    }
}

function setExpeditionGenerateLoading(isLoading, message = 'Generating...') {
    const status = document.getElementById('expeditionGenerateStatus');
    const statusText = status?.querySelector('.generate-status-text');
    const runBtn = document.getElementById('expeditionGenerateRun');
    const closeBtn = document.getElementById('expeditionGenerateClose');
    if (status) status.style.display = isLoading ? 'flex' : 'none';
    if (statusText) statusText.textContent = message;
    if (runBtn) runBtn.disabled = isLoading;
    if (closeBtn) closeBtn.disabled = isLoading;
}

async function populateExpeditionGeneratePanel() {
    if ((!GlobalData?.settlements || GlobalData.settlements.length === 0) && typeof loadSettlementsData === 'function') {
        await loadSettlementsData();
    }
    populateExpeditionGenerateLocations(document.getElementById('expeditionGenerateLocationFilter')?.value || '');
    await loadExpeditionGenerateNpcs();
    populateExpeditionGenerateNpcs(document.getElementById('expeditionGenerateNpcFilter')?.value || '');
    populateExpeditionGenerateEnemies(document.getElementById('expeditionGenerateEnemyFilter')?.value || '');
    populateExpeditionGenerateRewards();
}

function populateExpeditionGenerateLocations(filterText = '') {
    const select = document.getElementById('expeditionGenerateLocation');
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

async function loadExpeditionGenerateNpcs() {
    if (expeditionGenerateState.npcs.length) return;
    try {
        const token = await getCurrentAccessToken();
        if (!token) return;
        const response = await fetch('http://localhost:8080/api/getNpcs', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (data && data.npcs) {
            expeditionGenerateState.npcs = data.npcs;
        }
    } catch (error) {
        console.error('Failed to load NPCs for expedition generator:', error);
    }
}

function populateExpeditionGenerateNpcs(filterText = '') {
    const select = document.getElementById('expeditionGenerateNpcs');
    if (!select) return;
    select.innerHTML = '';
    const search = filterText.trim().toLowerCase();
    expeditionGenerateState.npcs
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

function populateExpeditionGenerateEnemies(filterText = '') {
    const select = document.getElementById('expeditionGenerateEnemies');
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

function populateExpeditionGenerateRewards() {
    const items = typeof getItems === 'function' ? getItems() : (GlobalData?.items || []);
    const perks = typeof getPerks === 'function' ? getPerks() : (GlobalData?.perks || []);
    expeditionGenerateState.rewardItems = items;
    expeditionGenerateState.rewardPerks = perks;
    expeditionGenerateState.rewardPotions = items.filter(item => item.type === 'potion');
    expeditionGenerateState.rewardBlessings = perks.filter(perk => perk.is_blessing);
    populateExpeditionGenerateRewardItems();
    populateExpeditionGenerateRewardPerks();
    populateExpeditionGenerateRewardPotions();
    populateExpeditionGenerateRewardBlessings();
}

function populateExpeditionGenerateRewardItems(filterText = '') {
    const select = document.getElementById('expeditionGenerateRewardItems');
    if (!select) return;
    select.innerHTML = '';
    const search = filterText.trim().toLowerCase();
    expeditionGenerateState.rewardItems
        .filter(item => {
            if (!search) return true;
            const name = (item.itemName || item.item_name || item.name || '').toLowerCase();
            return name.includes(search);
        })
        .forEach(item => {
            const id = item.itemId || item.item_id || item.id;
            const name = item.itemName || item.item_name || item.name || `Item ${id}`;
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = name;
            select.appendChild(opt);
        });
}

function populateExpeditionGenerateRewardPerks(filterText = '') {
    const select = document.getElementById('expeditionGenerateRewardPerks');
    if (!select) return;
    select.innerHTML = '';
    const search = filterText.trim().toLowerCase();
    expeditionGenerateState.rewardPerks
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

function populateExpeditionGenerateRewardPotions(filterText = '') {
    const select = document.getElementById('expeditionGenerateRewardPotions');
    if (!select) return;
    select.innerHTML = '';
    const search = filterText.trim().toLowerCase();
    expeditionGenerateState.rewardPotions
        .filter(item => {
            if (!search) return true;
            const name = (item.itemName || item.item_name || item.name || '').toLowerCase();
            return name.includes(search);
        })
        .forEach(item => {
            const id = item.itemId || item.item_id || item.id;
            const name = item.itemName || item.item_name || item.name || `Item ${id}`;
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = name;
            select.appendChild(opt);
        });
}

function populateExpeditionGenerateRewardBlessings(filterText = '') {
    const select = document.getElementById('expeditionGenerateRewardBlessings');
    if (!select) return;
    select.innerHTML = '';
    const search = filterText.trim().toLowerCase();
    expeditionGenerateState.rewardBlessings
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

function getSelectedValues(selectId) {
    const select = document.getElementById(selectId);
    if (!select) return [];
    return Array.from(select.selectedOptions).map(opt => opt.value).filter(Boolean);
}

function parseExpeditionSchema(rawValue) {
    if (!rawValue) return {};
    if (typeof rawValue === 'string') {
        try {
            return JSON.parse(rawValue);
        } catch (error) {
            console.warn('Failed to parse expedition schema string:', error);
            return {};
        }
    }
    if (typeof rawValue === 'object') return rawValue;
    return {};
}

function getExpeditionNewSlidesTemplate() {
    return {
        settlementId: 1,
        slides: [
            {
                id: 1,
                text: '',
                assetId: null,
                effectId: null,
                effectFactor: null,
                isStart: false,
                rewardStatType: null,
                rewardStatAmount: null,
                rewardTalent: null,
                rewardItem: null,
                rewardPerk: null,
                rewardBlessing: null,
                rewardPotion: null,
                rewardSilver: null,
                posX: 0,
                posY: 0,
                options: [
                    {
                        text: '',
                        statType: null,
                        statRequired: null,
                        effectId: null,
                        effectAmount: null,
                        enemyId: null,
                        factionRequired: null,
                        connections: [
                            {
                                targetSlideId: 1,
                                targetSlideDbId: null,
                                weight: 1
                            }
                        ]
                    }
                ]
            }
        ],
        newOptions: [],
        newConnections: [],
        slideUpdates: [],
        optionUpdates: []
    };
}

async function generateExpeditionClusterPreview() {
    const locationId = document.getElementById('expeditionGenerateLocation')?.value || '';
    const prompt = document.getElementById('expeditionGeneratePrompt')?.value || '';
    const selectedNpcIds = getSelectedValues('expeditionGenerateNpcs').map(id => parseInt(id, 10));
    const selectedEnemyIds = getSelectedValues('expeditionGenerateEnemies').map(id => parseInt(id, 10));
    const selectedItemIds = getSelectedValues('expeditionGenerateRewardItems').map(id => parseInt(id, 10));
    const selectedPerkIds = getSelectedValues('expeditionGenerateRewardPerks').map(id => parseInt(id, 10));
    const selectedPotionIds = getSelectedValues('expeditionGenerateRewardPotions').map(id => parseInt(id, 10));
    const selectedBlessingIds = getSelectedValues('expeditionGenerateRewardBlessings').map(id => parseInt(id, 10));

    let conceptPayload = {};
    let expeditionClusterPrompt = '';
    let expeditionSchema = {};
    try {
        const token = await getCurrentAccessToken();
        if (token) {
            const response = await fetch('http://localhost:8080/api/getConcept', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await response.json();
            if (data?.success) {
                conceptPayload = data.payload || {};
                expeditionClusterPrompt = typeof data.expeditionClusterPrompt === 'string' ? data.expeditionClusterPrompt : (data.expeditionClusterPrompt || '');
                expeditionSchema = parseExpeditionSchema(data.expeditionJsonSchema);
            }
        }
    } catch (error) {
        console.error('Failed to load concept for expedition generator:', error);
    }

    const schemaFallback = conceptPayload?.expedition_json_schema ?? conceptPayload ?? {};
    const schema = Object.keys(expeditionSchema).length ? expeditionSchema : schemaFallback;

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

    const npcLookup = new Map((expeditionGenerateState.npcs || []).map(npc => [npc.npc_id || npc.id, npc]));
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

    let enemies = [];
    if (typeof allEnemies !== 'undefined' && allEnemies.length > 0) {
        enemies = allEnemies;
    } else if (typeof getEnemies === 'function') {
        enemies = getEnemies();
    } else if (typeof GlobalData !== 'undefined' && GlobalData.enemies) {
        enemies = GlobalData.enemies;
    }
    const enemyLookup = new Map(enemies.map(enemy => [enemy.enemyId || enemy.enemy_id || enemy.id, enemy]));
    const selectedEnemies = selectedEnemyIds
        .map(id => enemyLookup.get(id))
        .filter(Boolean)
        .map(enemy => ({
            id: enemy.enemyId || enemy.enemy_id || enemy.id,
            name: enemy.enemyName || enemy.enemy_name || enemy.name || ''
        }));

    const items = (expeditionGenerateState.rewardItems || [])
        .filter(item => selectedItemIds.includes(item.itemId || item.item_id || item.id))
        .map(item => ({
            id: item.itemId || item.item_id || item.id,
            name: item.itemName || item.item_name || item.name || ''
        }));

    const perks = (expeditionGenerateState.rewardPerks || [])
        .filter(perk => selectedPerkIds.includes(perk.perk_id || perk.id))
        .map(perk => ({
            id: perk.perk_id || perk.id,
            name: perk.perk_name || perk.name || ''
        }));

    const potions = (expeditionGenerateState.rewardPotions || [])
        .filter(item => selectedPotionIds.includes(item.itemId || item.item_id || item.id))
        .map(item => ({
            id: item.itemId || item.item_id || item.id,
            name: item.itemName || item.item_name || item.name || ''
        }));

    const blessings = (expeditionGenerateState.rewardBlessings || [])
        .filter(perk => selectedBlessingIds.includes(perk.perk_id || perk.id))
        .map(perk => ({
            id: perk.perk_id || perk.id,
            name: perk.perk_name || perk.name || ''
        }));

    const settlementPayload = settlement
        ? {
            id: settlement.settlement_id || settlement.id,
            name: settlement.settlement_name || settlement.name || '',
            context: settlement.expedition_context || settlement.context || '',
            key_issues: Array.isArray(settlement.key_issues) ? settlement.key_issues : (settlement.key_issues ? [settlement.key_issues] : []),
            recent_events: Array.isArray(settlement.recent_events) ? settlement.recent_events : (settlement.recent_events ? [settlement.recent_events] : [])
        }
        : null;

    const userContent = {
        output_struct: schema,
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
        enemies: selectedEnemies,
        rewards: {
            possible_item_rewards: items,
            possible_perk_rewards: perks,
            possible_potion_rewards: potions,
            possible_blessing_rewards: blessings,
            possible_stat_rewards: ['strength', 'stamina', 'agility', 'luck', 'armor'],
            reward_silver: true,
            reward_talent: true
        },
        prompt
    };

    const payload = {
        model: 'o3',
        response_format: { type: 'json_object' },
        messages: [
            {
                role: 'system',
                content: expeditionClusterPrompt
            },
            {
                role: 'user',
                content: JSON.stringify(userContent)
            }
        ]
    };

    console.log('Expedition cluster generate payload:', JSON.stringify(payload, null, 2));
    console.log('Expedition new-slide JSON template:', JSON.stringify(getExpeditionNewSlidesTemplate(), null, 2));

    try {
        setExpeditionGenerateLoading(true, 'Generating expedition cluster...');
        const token = await getCurrentAccessToken();
        if (!token) {
            alert('Not authenticated');
            setExpeditionGenerateLoading(false);
            return;
        }

        const response = await fetch('http://localhost:8080/api/generateExpeditionCluster', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        console.log('Expedition cluster response:', data);

        let content = data?.choices?.[0]?.message?.content;
        if (!content && Array.isArray(data?.output)) {
            const message = data.output.find(item => item.type === 'message');
            const outputText = message?.content?.find(part => part.type === 'output_text');
            content = outputText?.text || '';
        }

        if (content) {
            try {
                const parsed = JSON.parse(content);
                console.log('Expedition cluster JSON:', parsed);
                const responseSettlementId = parsed.settlementId ?? parsed.settlement_id ?? null;
                const fallbackSettlementId = settlement?.settlement_id ?? settlement?.id ?? expeditionState.selectedSettlementId ?? null;
                const targetSettlementId = responseSettlementId ?? fallbackSettlementId;
                const normalizedSettlementId = normalizeNumericId(targetSettlementId);
                if (normalizedSettlementId !== null) {
                    expeditionState.selectedSettlementId = normalizedSettlementId;
                    const settlementSelect = document.getElementById('expeditionSettlementSelect');
                    if (settlementSelect) {
                        settlementSelect.value = String(normalizedSettlementId);
                    }
                }
                applyGeneratedExpedition(parsed, normalizedSettlementId);
                setExpeditionGenerateLoading(false, 'Expedition applied to canvas.');
                toggleExpeditionGeneratePanel();
            } catch (err) {
                console.warn('Failed to parse expedition cluster JSON:', err, content);
                setExpeditionGenerateLoading(false, 'Failed to parse response.');
            }
        } else {
            setExpeditionGenerateLoading(false, 'No content returned.');
        }
    } catch (error) {
        console.error('Expedition cluster generate failed:', error);
        alert(`❌ Expedition generation failed: ${error.message || error}`);
        setExpeditionGenerateLoading(false, 'Generation failed.');
    }
}

// Apply freshly generated expedition slides to the local canvas
function applyGeneratedExpedition(data, settlementIdOverride = null) {
    if (!data || !Array.isArray(data.slides) || data.slides.length === 0) {
        console.warn('Generated expedition missing slides array');
        return;
    }

    const generatedSlides = data.slides;
    const normalizedOverride = normalizeNumericId(settlementIdOverride);
    const generatedIdMap = new Map();

    generatedSlides.forEach((slideData, index) => {
        const localId = expeditionState.nextSlideId++;
        const referenceKey = getGeneratedSlideKey(slideData, index);
        generatedIdMap.set(referenceKey, localId);

        const assetIdValue = slideData.assetId ?? slideData.asset_id ?? null;
        const effectId = slideData.effectId ?? slideData.effect_id ?? null;
        const effectFactor = slideData.effectFactor ?? slideData.effect_factor ?? null;
        const slideSettlementId = normalizeNumericId(
            slideData.settlementId ?? slideData.settlement_id ?? normalizedOverride ?? expeditionState.selectedSettlementId
        );

        const remoteAssetUrl = assetIdValue ? `https://gamedata-assets.s3.eu-north-1.amazonaws.com/images/quests/${assetIdValue}.webp` : null;
        const slide = {
            id: localId,
            text: slideData.text || '',
            isStart: Boolean(slideData.isStart ?? slideData.start ?? false),
            x: slideData.posX ?? slideData.pos_x ?? slideData.x ?? (100 + index * 60),
            y: slideData.posY ?? slideData.pos_y ?? slideData.y ?? (100 + index * 60),
            options: [],
            assetId: assetIdValue,
            assetUrl: remoteAssetUrl,
            assetPreviewUrl: null,
            reward: buildRewardFromServer(slideData),
            effect: effectId ? { effectId, effectFactor } : null,
            settlementId: slideSettlementId ?? null
        };
        primeSlideAssetPreview(slide, assetIdValue, remoteAssetUrl);

        expeditionState.slides.set(localId, slide);
    });

    generatedSlides.forEach((slideData, index) => {
        const referenceKey = getGeneratedSlideKey(slideData, index);
        const localId = generatedIdMap.get(referenceKey);
        const slide = expeditionState.slides.get(localId);
        if (!slide) return;

        const options = Array.isArray(slideData.options) ? slideData.options : [];
        options.forEach((optData) => {
            const optionIndex = slide.options.length;
            slide.options.push(normalizeGeneratedExpeditionOption(optData));

            const connections = Array.isArray(optData.connections) ? optData.connections : [];
            connections.forEach((connection) => {
                const targetLocalId = resolveGeneratedConnectionTarget(connection, generatedIdMap);
                if (!targetLocalId) return;
                const exists = expeditionState.connections.some(c => c.from === localId && c.option === optionIndex && c.to === targetLocalId);
                if (exists) return;
                expeditionState.connections.push({
                    from: localId,
                    option: optionIndex,
                    to: targetLocalId,
                    weight: connection?.weight || 1
                });
            });
        });
    });

    filterAndRenderSlides();
    console.log(`✅ Applied ${generatedSlides.length} generated expedition slides to the canvas`);
}

function normalizeGeneratedExpeditionOption(optData = {}) {
    const text = optData.text ?? optData.option_text ?? '';
    const statType = optData.statType ?? optData.stat_type ?? null;
    const statRequired = optData.statRequired ?? optData.stat_required ?? null;
    const effectId = optData.effectId ?? optData.effect_id ?? null;
    const effectAmount = optData.effectAmount ?? optData.effect_amount ?? null;
    const enemyId = optData.enemyId ?? optData.enemy_id ?? null;
    const factionRequired = optData.factionRequired ?? optData.faction_required ?? null;

    let optType = 'dialogue';
    if (factionRequired) optType = 'faction';
    else if (statType) optType = 'skill';
    else if (effectId) optType = 'effect';
    else if (enemyId) optType = 'combat';

    return {
        text,
        type: optType,
        statType,
        statRequired,
        effectId,
        effectAmount,
        enemyId,
        factionRequired
    };
}

function resolveGeneratedConnectionTarget(connection, generatedIdMap) {
    if (!connection) return null;
    const candidateKeys = [
        connection.targetSlideId,
        connection.target_slide_id,
        connection.targetSlideID,
        connection.targetId,
        connection.target_id,
        connection.targetLocalId,
        connection.target_local_id
    ];

    for (const key of candidateKeys) {
        if (key === undefined || key === null) continue;
        const mapped = generatedIdMap.get(String(key));
        if (mapped) return mapped;
    }

    const serverSlideId = connection.targetSlideDbId ?? connection.targetToolingId ?? connection.target_tooling_id;
    if (serverSlideId !== undefined && serverSlideId !== null) {
        return findLocalSlideIdByServerSlideId(serverSlideId);
    }
    return null;
}

function getGeneratedSlideKey(slideData, index) {
    const rawKey = slideData?.id ?? slideData?.slideId ?? slideData?.slide_id ?? slideData?.toolingId ?? slideData?.tooling_id;
    return rawKey !== undefined && rawKey !== null ? String(rawKey) : `generated-${index}`;
}

function findLocalSlideIdByServerSlideId(serverSlideId) {
    if (serverSlideId === undefined || serverSlideId === null) return null;
    const target = String(serverSlideId);
    for (const [localId, storedSlideId] of expeditionState.serverSlides.entries()) {
        if (String(storedSlideId) === target) {
            return localId;
        }
    }
    return null;
}

function normalizeNumericId(value) {
    if (value === null || value === undefined || value === '') return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}

// Upload expedition asset (uses quest assets endpoint for shared folder)
async function uploadExpeditionAsset(file) {
    if (!file.type.startsWith('image/')) {
        alert('Please select an image file');
        return;
    }

    const uploadStatus = document.getElementById('expeditionAssetUploadStatus');
    if (uploadStatus) {
        uploadStatus.textContent = 'Converting...';
        uploadStatus.className = 'expedition-upload-status';
    }

    try {
        const token = await getCurrentAccessToken();
        if (!token) {
            if (uploadStatus) uploadStatus.textContent = 'Auth required';
            return;
        }

        // Convert to WebP format (9:16 aspect ratio)
        const webpBlob = await convertExpeditionImageToWebP(file);
        
        // Convert to base64
        const reader = new FileReader();
        const base64Promise = new Promise((resolve, reject) => {
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
        });
        reader.readAsDataURL(webpBlob);
        const base64Data = await base64Promise;

        if (uploadStatus) uploadStatus.textContent = 'Uploading...';

        // Use quest asset endpoint for shared folder
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
        console.log('✅ Expedition asset uploaded:', result);

        // Add to GlobalData.questAssets (shared array)
        GlobalData.questAssets.push({ id: result.assetId, url: result.url });
        if (typeof notifyGlobalDataChange === 'function') {
            notifyGlobalDataChange('questAssets', GlobalData.questAssets);
        }
        if (typeof ensureQuestAssetObjectUrl === 'function') {
            ensureQuestAssetObjectUrl({ id: result.assetId, url: result.url }).catch(() => {});
        }

        // Refresh gallery and auto-select
        populateExpeditionAssetGallery();
        selectExpeditionAsset(result.assetId, result.url);

        if (uploadStatus) {
            uploadStatus.textContent = 'Upload complete!';
            setTimeout(() => { uploadStatus.textContent = ''; }, 2000);
        }

    } catch (error) {
        console.error('Upload failed:', error);
        if (uploadStatus) {
            uploadStatus.textContent = 'Upload failed: ' + error.message;
            uploadStatus.className = 'expedition-upload-status error';
        }
    }
}

// Convert image to WebP format for expedition assets
function convertExpeditionImageToWebP(file) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            // Target 9:16 aspect ratio at 512x910
            canvas.width = 512;
            canvas.height = 910;
            
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            
            canvas.toBlob(
                blob => blob ? resolve(blob) : reject(new Error('Failed to convert')),
                'image/webp',
                0.9
            );
        };
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = URL.createObjectURL(file);
    });
}

// Helper to extract asset ID from URL
function getAssetIdFromUrl(url) {
    if (!url) return null;
    const match = url.match(/\/(\d+)\.webp$/);
    return match ? parseInt(match[1]) : null;
}

// ==================== UTILS ====================
function updateCounter() {
    const counter = document.getElementById('slideCounter');
    if (counter) {
        const total = expeditionState.slides.size;
        if (expeditionState.selectedSettlementId) {
            let filtered = 0;
            expeditionState.slides.forEach(slide => {
                if (slide.settlementId === expeditionState.selectedSettlementId) filtered++;
            });
            counter.textContent = `${filtered}/${total} slides`;
        } else {
            counter.textContent = `${total} slides`;
        }
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
    
    // Check slide-level changes (normalize values same as when storing)
    if ((slide.text || '') !== original.text) return true;
    if ((slide.isStart || false) !== original.isStart) return true;
    const slideAssetId = slide.assetId ?? getAssetIdFromUrl(slide.assetUrl);
    if (slideAssetId !== original.assetId) return true;
    const slidePosX = slide.x ?? 100;
    const slidePosY = slide.y ?? 100;
    const originalPosX = original.posX ?? 100;
    const originalPosY = original.posY ?? 100;
    if (slidePosX !== originalPosX) return true;
    if (slidePosY !== originalPosY) return true;
    
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
    
    // Normalize values same as when storing originals
    if ((opt.text || '') !== original.text) return true;
    if ((opt.type || 'dialogue') !== original.type) return true;
    if ((opt.statType || null) !== original.statType) return true;
    if ((opt.statRequired || null) !== original.statRequired) return true;
    if ((opt.effectId || null) !== original.effectId) return true;
    if ((opt.effectAmount || null) !== original.effectAmount) return true;
    if ((opt.enemyId || null) !== original.enemyId) return true;
    if ((opt.factionRequired || null) !== (original.factionRequired || null)) return true;
    
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
        case 'silver':
            return (r1.amount || null) === (r2.amount || null);
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
                slideId: expeditionState.serverSlides.get(localId),
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
                    optionId: expeditionState.serverOptions.get(optKey),
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
        const deletedSlides = Array.from(expeditionState.pendingSlideDeletes);
        const deletedOptions = Array.from(expeditionState.pendingOptionDeletes);
        const deletedConnections = Array.from(expeditionState.pendingConnectionDeletes)
            .map(key => {
                const [optionIdStr, targetSlideIdStr] = key.split('-');
                const optionId = parseInt(optionIdStr, 10);
                const targetSlideId = parseInt(targetSlideIdStr, 10);
                if (Number.isNaN(optionId) || Number.isNaN(targetSlideId)) {
                    return null;
                }
                return { optionId, targetSlideId };
            })
            .filter(Boolean);
        
        expeditionState.slides.forEach((slide, localId) => {
            const isServerSlide = expeditionState.serverSlides.has(localId);
            const slideServerId = isServerSlide ? expeditionState.serverSlides.get(localId) : null;
            
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
                                    targetSlideDbId: targetIsServer ? expeditionState.serverSlides.get(conn.to) : null,
                                    weight: conn.weight || 1
                                };
                            });
                        
                        newOptions.push({
                            slideLocalId: localId,
                            optionIndex: optIdx,
                            slideId: slideServerId,
                            text: opt.text || '',
                            statType: opt.type === 'skill' ? opt.statType : null,
                            statRequired: opt.type === 'skill' ? opt.statRequired : null,
                            effectId: opt.type === 'effect' ? opt.effectId : null,
                            effectAmount: opt.type === 'effect' ? opt.effectAmount : null,
                            enemyId: opt.type === 'combat' ? opt.enemyId : null,
                            factionRequired: opt.type === 'faction' ? opt.factionRequired : null,
                            connections: connections
                        });
                        console.log(`New option on existing slide ${localId} (slide_id ${slideServerId}):`, opt.text);
                    } else {
                        // This is an existing server option - check for new connections
                        const optionId = expeditionState.serverOptions.get(optionKey);
                        const optionConnections = expeditionState.connections
                            .filter(conn => conn.from === localId && conn.option === optIdx);
                        
                        optionConnections.forEach(conn => {
                            const targetIsServer = expeditionState.serverSlides.has(conn.to);
                            const targetSlideDbId = targetIsServer ? expeditionState.serverSlides.get(conn.to) : null;
                            
                            // Check if this connection already exists on server
                            const outcomeKey = `${optionId}-${targetSlideDbId}`;
                            const alreadyOnServer = targetIsServer && expeditionState.serverOutcomes.has(outcomeKey);
                            
                            if (!alreadyOnServer) {
                                // This is a NEW connection (either to new slide or new connection to existing slide)
                                newConnections.push({
                                    optionId: optionId,
                                    targetSlideId: conn.to,
                                    targetSlideDbId: targetSlideDbId,
                                    weight: conn.weight || 1
                                });
                                console.log(`New connection from existing option ${optionId} to slide ${conn.to} (target slide_id: ${targetSlideDbId ?? 'pending'})`);
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
            let rewardSilver = null;

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
                    case 'silver':
                        rewardSilver = slide.reward.amount || null;
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
                        // If target is a server slide, use its slideId
                        // If target is a new slide, use its localId (server will map it)
                        const targetIsServer = expeditionState.serverSlides.has(conn.to);
                        return {
                            targetSlideId: conn.to,
                            targetSlideDbId: targetIsServer ? expeditionState.serverSlides.get(conn.to) : null,
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
                    factionRequired: opt.type === 'faction' ? opt.factionRequired : null,
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
                rewardSilver: rewardSilver,
                posX: slide.x || 100,
                posY: slide.y || 100,
                options: options
            });
        });

        // Build updates for modified slides
        const modifiedSlides = getModifiedSlides();
        const slideUpdates = modifiedSlides.map(({ localId, slideId, slide }) => {
            // Build reward fields
            let rewardStatType = null, rewardStatAmount = null, rewardTalent = null;
            let rewardItem = null, rewardPerk = null, rewardBlessing = null, rewardPotion = null;
            let rewardSilver = null;
            
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
                    case 'silver': rewardSilver = slide.reward.amount || null; break;
                }
            }
            
            return {
                slideId: slideId,
                text: slide.text || '',
                assetId: slide.assetId ?? getAssetIdFromUrl(slide.assetUrl),
                effectId: slide.effect?.effectId || null,
                effectFactor: slide.effect?.effectFactor || null,
                isStart: slide.isStart || false,
                rewardStatType, rewardStatAmount, rewardTalent,
                rewardItem, rewardPerk, rewardBlessing, rewardPotion, rewardSilver,
                posX: slide.x || 100,
                posY: slide.y || 100
            };
        });
        
        // Build updates for modified options
        const modifiedOptions = getModifiedOptions();
        const optionUpdates = modifiedOptions.map(({ optionId, option }) => ({
            optionId: optionId,
            text: option.text || '',
            statType: option.type === 'skill' ? option.statType : null,
            statRequired: option.type === 'skill' ? option.statRequired : null,
            effectId: option.type === 'effect' ? option.effectId : null,
            effectAmount: option.type === 'effect' ? option.effectAmount : null,
            enemyId: option.type === 'combat' ? option.enemyId : null,
            factionRequired: option.type === 'faction' ? option.factionRequired : null
        }));

        // Check if there's anything to save
        if (
            slides.length === 0 &&
            newOptions.length === 0 &&
            newConnections.length === 0 &&
            slideUpdates.length === 0 &&
            optionUpdates.length === 0 &&
            deletedSlides.length === 0 &&
            deletedOptions.length === 0 &&
            deletedConnections.length === 0
        ) {
            alert('No changes to save. All slides, options, and connections are already on the server.');
            return;
        }

        console.log('Saving expedition:');
        console.log(`  - ${slides.length} new slides`);
        console.log(`  - ${newOptions.length} new options on existing slides`);
        console.log(`  - ${newConnections.length} new connections on existing options`);
        console.log(`  - ${slideUpdates.length} updated slides`);
        console.log(`  - ${optionUpdates.length} updated options`);
        console.log(`  - ${deletedSlides.length} deleted slides`);
        console.log(`  - ${deletedOptions.length} deleted options`);
        console.log(`  - ${deletedConnections.length} deleted connections`);

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
                deletedSlides: deletedSlides,
                deletedOptions: deletedOptions,
                deletedConnections: deletedConnections,
                settlementId: expeditionState.selectedSettlementId || null
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
                for (const [localIdStr, slideId] of Object.entries(result.slideMapping)) {
                    const localId = parseInt(localIdStr);
                    expeditionState.serverSlides.set(localId, slideId);
                    
                    // Store original values for newly saved slides
                    const slide = expeditionState.slides.get(localId);
                    if (slide) {
                        expeditionState.originalSlides.set(localId, {
                            text: slide.text || '',
                            isStart: slide.isStart || false,
                            assetId: slide.assetId ?? getAssetIdFromUrl(slide.assetUrl),
                            effectId: slide.effect?.effectId || null,
                            effectFactor: slide.effect?.effectFactor || null,
                            posX: slide.x || 100,
                            posY: slide.y || 100,
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
                    assetId: slide.assetId ?? getAssetIdFromUrl(slide.assetUrl),
                    effectId: slide.effect?.effectId || null,
                    effectFactor: slide.effect?.effectFactor || null,
                    posX: slide.x || 100,
                    posY: slide.y || 100,
                    reward: slide.reward ? JSON.parse(JSON.stringify(slide.reward)) : null
                });
            }
            
            // Update original values for modified options
            for (const { localId, optIdx, option } of modifiedOptions) {
                const optKey = `${localId}-${optIdx}`;
                expeditionState.originalOptions.set(optKey, {
                    text: option.text || '',
                    type: option.type || 'dialogue',
                    statType: option.type === 'skill' ? (option.statType || null) : null,
                    statRequired: option.type === 'skill' ? (option.statRequired || null) : null,
                    effectId: option.type === 'effect' ? (option.effectId || null) : null,
                    effectAmount: option.type === 'effect' ? (option.effectAmount || null) : null,
                    enemyId: option.type === 'combat' ? (option.enemyId || null) : null,
                    factionRequired: option.type === 'faction' ? (option.factionRequired || null) : null
                });
            }
            
            // Track newly saved options from result.optionMapping
            if (result.optionMapping) {
                for (const [optionKey, optionId] of Object.entries(result.optionMapping)) {
                    expeditionState.serverOptions.set(optionKey, optionId);
                    
                    // Also store original values for newly saved options
                    const [slideIdStr, optIdxStr] = optionKey.split('-');
                    const slideId = parseInt(slideIdStr);
                    const optIdx = parseInt(optIdxStr);
                    const slide = expeditionState.slides.get(slideId);
                    if (slide && slide.options[optIdx]) {
                        const opt = slide.options[optIdx];
                        expeditionState.originalOptions.set(optionKey, {
                            text: opt.text || '',
                            type: opt.type || 'dialogue',
                            statType: opt.type === 'skill' ? (opt.statType || null) : null,
                            statRequired: opt.type === 'skill' ? (opt.statRequired || null) : null,
                            effectId: opt.type === 'effect' ? (opt.effectId || null) : null,
                            effectAmount: opt.type === 'effect' ? (opt.effectAmount || null) : null,
                            enemyId: opt.type === 'combat' ? (opt.enemyId || null) : null,
                            factionRequired: opt.type === 'faction' ? (opt.factionRequired || null) : null
                        });
                    }
                }
            }
            
            // Track newly saved connections
            // For new slides, their options are now tracked, so we need to register their connections
            for (const slide of slides) {
                const slideId = result.slideMapping[slide.id];
                if (!slideId) continue;
                
                slide.options.forEach((opt, optIdx) => {
                    const optionKey = `${slide.id}-${optIdx}`;
                    const optionId = result.optionMapping[optionKey];
                    if (!optionId) return;
                    
                    // Track all connections from this option
                    opt.connections.forEach(conn => {
                        const targetSlideId = conn.targetSlideDbId || result.slideMapping[conn.targetSlideId];
                        if (targetSlideId) {
                            const outcomeKey = `${optionId}-${targetSlideId}`;
                            expeditionState.serverOutcomes.add(outcomeKey);
                        }
                    });
                });
            }
            
            // Track connections from newOptions - now we have the proper mapping
            for (const newOpt of newOptions) {
                const optionKey = `${newOpt.slideLocalId}-${newOpt.optionIndex}`;
                const optionId = result.optionMapping[optionKey];
                
                if (optionId) {
                    // Register its connections
                    newOpt.connections.forEach(conn => {
                        const targetSlideId = conn.targetSlideDbId || result.slideMapping[conn.targetSlideId];
                        if (targetSlideId) {
                            const outcomeKey = `${optionId}-${targetSlideId}`;
                            expeditionState.serverOutcomes.add(outcomeKey);
                        }
                    });
                }
            }
            
            // Track connections from newConnections
            for (const newConn of newConnections) {
                const targetSlideId = newConn.targetSlideDbId || result.slideMapping[newConn.targetSlideId];
                if (targetSlideId) {
                    const outcomeKey = `${newConn.optionId}-${targetSlideId}`;
                    expeditionState.serverOutcomes.add(outcomeKey);
                    console.log(`Tracked new connection: ${outcomeKey}`);
                }
            }

            expeditionState.pendingSlideDeletes.clear();
            expeditionState.pendingOptionDeletes.clear();
            expeditionState.pendingConnectionDeletes.clear();
            
            // Re-render slides to update visual (remove new-slide/modified-slide highlight)
            // Use filterAndRenderSlides to respect the current settlement filter
            filterAndRenderSlides();
            
            const parts = [];
            if (slides.length > 0) parts.push(`${slides.length} new slides`);
            if (newOptions.length > 0) parts.push(`${newOptions.length} new options`);
            if (newConnections.length > 0) parts.push(`${newConnections.length} new connections`);
            if (slideUpdates.length > 0) parts.push(`${slideUpdates.length} updated slides`);
            if (optionUpdates.length > 0) parts.push(`${optionUpdates.length} updated options`);
            if (deletedSlides.length > 0) parts.push(`${deletedSlides.length} deleted slides`);
            if (deletedOptions.length > 0) parts.push(`${deletedOptions.length} deleted options`);
            if (deletedConnections.length > 0) parts.push(`${deletedConnections.length} deleted connections`);
            
            alert(`✅ Expedition saved successfully!\n\n${parts.join(', ')} saved to database.`);
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

// ==================== MERGE EXPEDITION ====================
async function mergeExpedition() {
    if (!confirm('Publish the current tooling expedition graph to the live game schema?')) {
        return;
    }

    const mergeBtn = document.getElementById('mergeExpeditionBtn');
    if (mergeBtn) {
        mergeBtn.disabled = true;
        mergeBtn.textContent = '🚀 Publishing...';
    }

    try {
        const token = await getCurrentAccessToken();
        if (!token) {
            throw new Error('Not authenticated');
        }

        const response = await fetch('http://localhost:8080/api/mergeExpeditions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText || 'Server error');
        }

        const payload = await response.json();
        if (!payload.success) {
            throw new Error(payload.message || 'Merge failed');
        }

        alert('✅ Expedition graph published to the game schema. Clients will now see the latest approved version.');
    } catch (error) {
        console.error('Failed to merge expeditions:', error);
        alert(`❌ Failed to publish expedition:\n${error.message}`);
    } finally {
        if (mergeBtn) {
            mergeBtn.disabled = false;
            mergeBtn.textContent = '🚀 Publish to Game';
        }
    }
}
window.mergeExpedition = mergeExpedition;

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
        expeditionState.pendingSlideDeletes.clear();
        expeditionState.pendingOptionDeletes.clear();
        expeditionState.pendingConnectionDeletes.clear();

        // Clear the canvas
        const container = document.getElementById('slidesContainer');
        if (container) {
            container.innerHTML = '';
        }

        // Create a mapping from server slideId to local ID
        const slideIdToLocalId = new Map();
        
        // First pass: create all slides
        let localId = 1;
        for (const serverSlide of data.slides) {
            const serverSlideId = serverSlide.slideId ?? serverSlide.toolingId ?? serverSlide.id;
            const slide = {
                id: localId,
                text: serverSlide.text || '',
                isStart: serverSlide.isStart || false,
                x: serverSlide.posX || 100,
                y: serverSlide.posY || 100,
                options: [],
                assetId: serverSlide.assetId || null,
                assetUrl: serverSlide.assetId ? `https://gamedata-assets.s3.eu-north-1.amazonaws.com/images/quests/${serverSlide.assetId}.webp` : null,
                assetPreviewUrl: null,
                reward: buildRewardFromServer(serverSlide),
                effect: serverSlide.effectId ? { effectId: serverSlide.effectId, effectFactor: serverSlide.effectFactor } : null,
                settlementId: serverSlide.settlementId || null
            };

            primeSlideAssetPreview(slide, slide.assetId, slide.assetUrl);

            // Map slideId -> localId
            slideIdToLocalId.set(serverSlideId, localId);
            
            // Track this as a server slide
            expeditionState.serverSlides.set(localId, serverSlideId);
            
            // Store original values for change detection
            expeditionState.originalSlides.set(localId, {
                text: serverSlide.text || '',
                isStart: serverSlide.isStart || false,
                assetId: serverSlide.assetId || null,
                effectId: serverSlide.effectId || null,
                effectFactor: serverSlide.effectFactor || null,
                posX: serverSlide.posX || 100,
                posY: serverSlide.posY || 100,
                reward: buildRewardFromServer(serverSlide)
            });
            
            expeditionState.slides.set(localId, slide);
            localId++;
        }

        expeditionState.nextSlideId = localId;

        // Second pass: add options to slides
        for (const serverSlide of data.slides) {
            const serverSlideId = serverSlide.slideId ?? serverSlide.toolingId ?? serverSlide.id;
            const slideLocalId = slideIdToLocalId.get(serverSlideId);
            const slide = expeditionState.slides.get(slideLocalId);
            
            if (!slide || !serverSlide.options) continue;

            for (let optIdx = 0; optIdx < serverSlide.options.length; optIdx++) {
                const serverOpt = serverSlide.options[optIdx];
                
                // Determine option type
                let optType = 'dialogue';
                if (serverOpt.factionRequired) optType = 'faction';
                else if (serverOpt.statType) optType = 'skill';
                else if (serverOpt.effectId) optType = 'effect';
                else if (serverOpt.enemyId) optType = 'combat';

                const option = {
                    text: serverOpt.text || '',
                    type: optType,
                    statType: optType === 'skill' ? serverOpt.statType : null,
                    statRequired: optType === 'skill' ? serverOpt.statRequired : null,
                    effectId: optType === 'effect' ? serverOpt.effectId : null,
                    effectAmount: optType === 'effect' ? serverOpt.effectAmount : null,
                    enemyId: optType === 'combat' ? serverOpt.enemyId : null,
                    factionRequired: optType === 'faction' ? (serverOpt.factionRequired || null) : null
                };

                slide.options.push(option);
                
                // Track this as a server option
                const optionKey = `${slideLocalId}-${optIdx}`;
                const serverOptionId = serverOpt.optionId ?? serverOpt.toolingId ?? serverOpt.id;
                expeditionState.serverOptions.set(optionKey, serverOptionId);
                
                // Store original option values for change detection
                expeditionState.originalOptions.set(optionKey, {
                    text: serverOpt.text || '',
                    type: optType,
                    statType: optType === 'skill' ? (serverOpt.statType || null) : null,
                    statRequired: optType === 'skill' ? (serverOpt.statRequired || null) : null,
                    effectId: optType === 'effect' ? (serverOpt.effectId || null) : null,
                    effectAmount: optType === 'effect' ? (serverOpt.effectAmount || null) : null,
                    enemyId: optType === 'combat' ? (serverOpt.enemyId || null) : null,
                    factionRequired: optType === 'faction' ? (serverOpt.factionRequired || null) : null
                });

                // Third pass: create connections from outcomes
                if (serverOpt.outcomes) {
                    for (const outcome of serverOpt.outcomes) {
                        const targetLocalId = slideIdToLocalId.get(outcome.targetSlideId);
                        if (targetLocalId) {
                            expeditionState.connections.push({
                                from: slideLocalId,
                                option: optIdx,
                                to: targetLocalId,
                                weight: outcome.weight || 1
                            });
                            // Track this as a server outcome using option->target key
                            const outcomeKey = `${serverOptionId}-${outcome.targetSlideId}`;
                            expeditionState.serverOutcomes.add(outcomeKey);
                        }
                    }
                }
            }
        }

        // Render slides based on current filter
        filterAndRenderSlides();
        
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
    if (serverSlide.rewardSilver != null) {
        return { type: 'silver', amount: serverSlide.rewardSilver };
    }
    return null;
}

// ==================== SETTLEMENT SELECTION ====================
async function loadExpeditionSettlements() {
    console.log('🏘️ Loading settlements for expedition designer...');
    
    // Check if loadSettlementsData function exists
    if (typeof loadSettlementsData !== 'function') {
        console.error('❌ loadSettlementsData function not found! Check global-data.js');
        return;
    }
    
    // Use GlobalData.settlements (shared across all pages)
    try {
        console.log('Calling loadSettlementsData()...');
        await loadSettlementsData();
        console.log('loadSettlementsData completed. GlobalData.settlements:', GlobalData.settlements);
        expeditionState.settlements = GlobalData.settlements || [];
        populateSettlementDropdown();
        console.log(`✅ Using ${expeditionState.settlements.length} settlements from GlobalData`);
    } catch (error) {
        console.error('Failed to load settlements:', error);
    }
}

function populateSettlementDropdown() {
    const select = document.getElementById('expeditionSettlementSelect');
    if (!select) return;

    const previousValue = select.value || (expeditionState.selectedSettlementId ? String(expeditionState.selectedSettlementId) : '');
    select.innerHTML = '';

    if (expeditionState.settlements.length === 0) {
        const emptyOption = document.createElement('option');
        emptyOption.value = '';
        emptyOption.textContent = '-- No Settlements --';
        select.appendChild(emptyOption);
        select.value = '';
        if (expeditionState.selectedSettlementId !== null) {
            expeditionState.selectedSettlementId = null;
            filterAndRenderSlides();
        }
        return;
    }

    expeditionState.settlements.forEach(settlement => {
        const option = document.createElement('option');
        option.value = settlement.settlement_id;
        option.textContent = settlement.settlement_name || `Settlement #${settlement.settlement_id}`;
        select.appendChild(option);
    });

    const hasPrevious = previousValue && select.querySelector(`option[value="${previousValue}"]`);
    const nextValue = hasPrevious ? previousValue : (select.options[0]?.value || '');
    select.value = nextValue;

    const numericValue = nextValue ? parseInt(nextValue, 10) : null;
    const sanitizedValue = Number.isNaN(numericValue) ? null : numericValue;
    if (sanitizedValue !== expeditionState.selectedSettlementId) {
        expeditionState.selectedSettlementId = sanitizedValue;
        filterAndRenderSlides();
    }
}

function onExpeditionSettlementChange() {
    const select = document.getElementById('expeditionSettlementSelect');
    if (!select) return;

    const value = select.value;
    expeditionState.selectedSettlementId = value ? parseInt(value) : null;
    
    console.log(`🏘️ Settlement filter changed to: ${expeditionState.selectedSettlementId || 'all'}`);
    
    // Filter slides client-side and re-render
    filterAndRenderSlides();
}
window.onExpeditionSettlementChange = onExpeditionSettlementChange;

// Filter slides based on selected settlement and re-render
function filterAndRenderSlides() {
    const container = document.getElementById('slidesContainer');
    if (!container) return;
    
    // Clear container
    container.innerHTML = '';
    
    // Render only slides matching the filter (or all if no filter)
    expeditionState.slides.forEach(slide => {
        const matchesFilter = !expeditionState.selectedSettlementId || 
                              slide.settlementId === expeditionState.selectedSettlementId;
        if (matchesFilter) {
            renderSlide(slide);
        }
    });
    
    // Re-render connections (only for visible slides)
    renderConnections();
    updateCounter();
    syncExpeditionPreviewWithFilter();
}

async function loadExpeditionForSettlement(settlementId) {
    console.log(`📥 Loading expedition for settlement: ${settlementId || 'all'}`);

    try {
        const token = await getCurrentAccessToken();
        if (!token) {
            throw new Error('Not authenticated');
        }

        // Build URL with optional settlement filter
        let url = 'http://localhost:8080/api/getExpedition';
        if (settlementId) {
            url += `?settlementId=${settlementId}`;
        }

        const response = await fetch(url, {
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

        // Create a mapping from server slideId to local ID
        const slideIdToLocalId = new Map();
        
        // First pass: create all slides
        let localId = 1;
        for (const serverSlide of data.slides) {
            const serverSlideId = serverSlide.slideId ?? serverSlide.toolingId ?? serverSlide.id;
            const slide = {
                id: localId,
                text: serverSlide.text || '',
                isStart: serverSlide.isStart || false,
                x: serverSlide.posX || 100,
                y: serverSlide.posY || 100,
                options: [],
                assetId: serverSlide.assetId || null,
                assetUrl: serverSlide.assetId ? `https://gamedata-assets.s3.eu-north-1.amazonaws.com/images/quests/${serverSlide.assetId}.webp` : null,
                assetPreviewUrl: null,
                reward: buildRewardFromServer(serverSlide),
                effect: serverSlide.effectId ? { effectId: serverSlide.effectId, effectFactor: serverSlide.effectFactor } : null,
                settlementId: serverSlide.settlementId
            };

            primeSlideAssetPreview(slide, slide.assetId, slide.assetUrl);

            // Map slideId -> localId
            slideIdToLocalId.set(serverSlideId, localId);
            
            // Track this as a server slide
            expeditionState.serverSlides.set(localId, serverSlideId);
            
            // Store original values for change detection
            expeditionState.originalSlides.set(localId, {
                text: serverSlide.text || '',
                isStart: serverSlide.isStart || false,
                assetId: serverSlide.assetId || null,
                effectId: serverSlide.effectId || null,
                effectFactor: serverSlide.effectFactor || null,
                posX: serverSlide.posX || 100,
                posY: serverSlide.posY || 100,
                reward: buildRewardFromServer(serverSlide)
            });
            
            expeditionState.slides.set(localId, slide);
            localId++;
        }

        expeditionState.nextSlideId = localId;

        // Second pass: add options to slides
        for (const serverSlide of data.slides) {
            const serverSlideId = serverSlide.slideId ?? serverSlide.toolingId ?? serverSlide.id;
            const slideLocalId = slideIdToLocalId.get(serverSlideId);
            const slide = expeditionState.slides.get(slideLocalId);
            
            if (!slide || !serverSlide.options) continue;

            for (let optIdx = 0; optIdx < serverSlide.options.length; optIdx++) {
                const serverOpt = serverSlide.options[optIdx];
                
                // Determine option type
                let optType = 'dialogue';
                if (serverOpt.factionRequired) optType = 'faction';
                else if (serverOpt.statType) optType = 'skill';
                else if (serverOpt.effectId) optType = 'effect';
                else if (serverOpt.enemyId) optType = 'combat';

                const option = {
                    text: serverOpt.text || '',
                    type: optType,
                    statType: optType === 'skill' ? serverOpt.statType : null,
                    statRequired: optType === 'skill' ? serverOpt.statRequired : null,
                    effectId: optType === 'effect' ? serverOpt.effectId : null,
                    effectAmount: optType === 'effect' ? serverOpt.effectAmount : null,
                    enemyId: optType === 'combat' ? serverOpt.enemyId : null,
                    factionRequired: optType === 'faction' ? (serverOpt.factionRequired || null) : null
                };

                slide.options.push(option);
                
                // Track this as a server option
                const optionKey = `${slideLocalId}-${optIdx}`;
                const serverOptionId = serverOpt.optionId ?? serverOpt.toolingId ?? serverOpt.id;
                expeditionState.serverOptions.set(optionKey, serverOptionId);
                
                // Store original option values for change detection
                expeditionState.originalOptions.set(optionKey, {
                    text: serverOpt.text || '',
                    type: optType,
                    statType: optType === 'skill' ? (serverOpt.statType || null) : null,
                    statRequired: optType === 'skill' ? (serverOpt.statRequired || null) : null,
                    effectId: optType === 'effect' ? (serverOpt.effectId || null) : null,
                    effectAmount: optType === 'effect' ? (serverOpt.effectAmount || null) : null,
                    enemyId: optType === 'combat' ? (serverOpt.enemyId || null) : null,
                    factionRequired: optType === 'faction' ? (serverOpt.factionRequired || null) : null
                });

                // Third pass: build connections from outcomes
                if (serverOpt.connections) {
                    for (const conn of serverOpt.connections) {
                        const targetServerSlideId = conn.targetSlideId ?? conn.targetSlideDbId ?? conn.targetToolingId;
                        const targetLocalId = slideIdToLocalId.get(targetServerSlideId);
                        if (targetLocalId) {
                            expeditionState.connections.push({
                                fromSlide: slideLocalId,
                                fromOption: optIdx,
                                toSlide: targetLocalId,
                                weight: conn.weight || 1
                            });
                            
                            // Track this as a server outcome
                            const outcomeKey = `${serverOptionId}-${targetServerSlideId}`;
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

        console.log(`✅ Loaded ${data.slides.length} slides for settlement ${settlementId || 'all'}`);

    } catch (error) {
        console.error('Failed to load expedition:', error);
        // Clear canvas on error
        expeditionState.slides.clear();
        expeditionState.connections = [];
        const container = document.getElementById('slidesContainer');
        if (container) container.innerHTML = '';
        renderConnections();
        updateCounter();
    }
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
