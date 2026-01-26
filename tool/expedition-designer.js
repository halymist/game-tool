// Expedition Designer - Visual Slide Network Editor (Inline Editing)
console.log('📦 expedition-designer.js LOADED');

// ==================== STATE ====================
const expeditionState = {
    slides: new Map(),
    connections: [],
    selectedSlide: null,
    nextSlideId: 1,
    canvasOffset: { x: 0, y: 0 },
    isDragging: false,
    lastMouse: { x: 0, y: 0 },
    isConnecting: false,
    connectionStart: null
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
    
    const slide = {
        id: id,
        text: 'Click to edit text...',
        isStart: expeditionState.slides.size === 0,
        x: (rect.width / 2) - expeditionState.canvasOffset.x - 180,
        y: (rect.height / 2) - expeditionState.canvasOffset.y - 120,
        options: [],
        assetUrl: null
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
    el.className = `expedition-slide${slide.isStart ? ' start-slide' : ''}${expeditionState.selectedSlide === slide.id ? ' selected' : ''}`;
    el.style.left = `${slide.x}px`;
    el.style.top = `${slide.y}px`;
    
    const optionsHtml = slide.options.map((opt, i) => `
        <div class="slide-option" data-slide="${slide.id}" data-option="${i}">
            <span class="option-type-badge ${opt.type}">${getTypeIcon(opt.type)}</span>
            <input type="text" class="option-text-input" value="${escapeHtml(opt.text || '')}" 
                   data-slide="${slide.id}" data-option="${i}" placeholder="Option text...">
            ${opt.stat ? `<span class="option-stat-badge">${opt.stat.toUpperCase()}</span>` : ''}
            <button class="option-edit-btn" data-slide="${slide.id}" data-option="${i}" title="Edit option">⚙️</button>
            <button class="option-delete-btn" data-slide="${slide.id}" data-option="${i}" title="Delete option">×</button>
            <div class="option-connector" data-slide="${slide.id}" data-option="${i}" title="Drag to connect">●</div>
        </div>
    `).join('');
    
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
        </div>
        <div class="slide-options">
            ${optionsHtml}
            <button class="add-option-btn" data-slide="${slide.id}">+ Add Option</button>
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
    });
    textArea?.addEventListener('mousedown', (e) => e.stopPropagation());
    
    // Start checkbox - allow multiple start slides
    const startCb = el.querySelector('.start-checkbox input');
    startCb?.addEventListener('change', (e) => {
        e.stopPropagation();
        slide.isStart = e.target.checked;
        el.classList.toggle('start-slide', slide.isStart);
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
    
    // Option text inputs
    el.querySelectorAll('.option-text-input').forEach(input => {
        input.addEventListener('input', (e) => {
            const idx = parseInt(e.target.dataset.option);
            slide.options[idx].text = e.target.value;
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
    
    // Option connectors - start connection
    el.querySelectorAll('.option-connector').forEach(conn => {
        conn.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            expeditionState.isConnecting = true;
            expeditionState.connectionStart = {
                slideId: parseInt(conn.dataset.slide),
                optionIndex: parseInt(conn.dataset.option)
            };
            document.body.style.cursor = 'crosshair';
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
        el.classList.add('dragging');
        
        const onMove = (ev) => {
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
    return { combat: '⚔️', skill: '🎯', item: '🎒' }[type] || '💬';
}

// ==================== OPTION MODAL ====================
let modalContext = { slideId: null, optionIndex: -1 };

function openOptionModal(slideId, optionIndex) {
    modalContext = { slideId, optionIndex };
    
    const slide = expeditionState.slides.get(slideId);
    if (!slide) return;
    
    const isEdit = optionIndex >= 0;
    const opt = isEdit ? slide.options[optionIndex] : { text: '', type: 'dialogue', stat: '' };
    
    document.getElementById('optionModalTitle').textContent = isEdit ? 'Edit Option' : 'Add Option';
    document.getElementById('optionModalText').value = opt.text || '';
    document.getElementById('optionModalType').value = opt.type || 'dialogue';
    document.getElementById('optionModalStat').value = opt.stat || '';
    
    document.getElementById('optionModal').classList.add('open');
}

function closeOptionModal() {
    document.getElementById('optionModal').classList.remove('open');
    modalContext = { slideId: null, optionIndex: -1 };
}

function saveOptionFromModal() {
    const slide = expeditionState.slides.get(modalContext.slideId);
    if (!slide) return;
    
    const text = document.getElementById('optionModalText').value || 'New option';
    const type = document.getElementById('optionModalType').value;
    const stat = document.getElementById('optionModalStat').value || null;
    
    if (modalContext.optionIndex >= 0) {
        // Edit existing
        slide.options[modalContext.optionIndex] = { text, type, stat };
    } else {
        // Add new
        slide.options.push({ text, type, stat });
    }
    
    renderSlide(slide);
    closeOptionModal();
}

// ==================== CANVAS PAN ====================
function onCanvasMouseDown(e) {
    if (e.target.closest('.expedition-slide')) return;
    if (e.button === 0) {
        expeditionState.isDragging = true;
        expeditionState.lastMouse = { x: e.clientX, y: e.clientY };
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
            container.style.transform = `translate(${expeditionState.canvasOffset.x}px, ${expeditionState.canvasOffset.y}px)`;
        }
        renderConnections();
    }
    
    if (expeditionState.isConnecting) {
        updateConnectionPreview(e);
    }
}

function onCanvasMouseUp(e) {
    expeditionState.isDragging = false;
    
    if (expeditionState.isConnecting) {
        const target = e.target.closest('.expedition-slide');
        if (target && expeditionState.connectionStart) {
            const toId = parseInt(target.id.replace('slide-', ''));
            if (toId !== expeditionState.connectionStart.slideId) {
                // Remove existing connection from this option
                expeditionState.connections = expeditionState.connections.filter(c => 
                    !(c.from === expeditionState.connectionStart.slideId && c.option === expeditionState.connectionStart.optionIndex)
                );
                // Add new connection
                expeditionState.connections.push({
                    from: expeditionState.connectionStart.slideId,
                    option: expeditionState.connectionStart.optionIndex,
                    to: toId
                });
                renderConnections();
            }
        }
        expeditionState.isConnecting = false;
        expeditionState.connectionStart = null;
        document.body.style.cursor = 'default';
        document.getElementById('connectionPreview')?.setAttribute('style', 'display:none');
    }
}

function resetView() {
    expeditionState.canvasOffset = { x: 0, y: 0 };
    const container = document.getElementById('slidesContainer');
    if (container) container.style.transform = 'translate(0, 0)';
    renderConnections();
}

// ==================== CONNECTIONS ====================
function updateConnectionPreview(e) {
    const preview = document.getElementById('connectionPreview');
    const canvas = document.getElementById('expeditionCanvas');
    if (!preview || !canvas || !expeditionState.connectionStart) return;
    
    const rect = canvas.getBoundingClientRect();
    const fromEl = document.querySelector(`#slide-${expeditionState.connectionStart.slideId} .option-connector[data-option="${expeditionState.connectionStart.optionIndex}"]`);
    if (!fromEl) return;
    
    const fromRect = fromEl.getBoundingClientRect();
    const x1 = fromRect.left + fromRect.width/2 - rect.left;
    const y1 = fromRect.top + fromRect.height/2 - rect.top;
    const x2 = e.clientX - rect.left;
    const y2 = e.clientY - rect.top;
    
    preview.setAttribute('d', `M ${x1} ${y1} Q ${(x1+x2)/2} ${y1}, ${x2} ${y2}`);
    preview.style.display = 'block';
}

function renderConnections() {
    const svg = document.getElementById('connectionsSvg');
    const canvas = document.getElementById('expeditionCanvas');
    if (!svg || !canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    
    // Remove old paths except preview
    svg.querySelectorAll('path:not(#connectionPreview)').forEach(p => p.remove());
    
    expeditionState.connections.forEach((conn, i) => {
        const fromEl = document.querySelector(`#slide-${conn.from} .option-connector[data-option="${conn.option}"]`);
        const toEl = document.querySelector(`#slide-${conn.to} .slide-input-connector`);
        if (!fromEl || !toEl) return;
        
        const fromRect = fromEl.getBoundingClientRect();
        const toRect = toEl.getBoundingClientRect();
        
        const x1 = fromRect.left + fromRect.width/2 - rect.left;
        const y1 = fromRect.top + fromRect.height/2 - rect.top;
        const x2 = toRect.left + toRect.width/2 - rect.left;
        const y2 = toRect.top + toRect.height/2 - rect.top;
        
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', `M ${x1} ${y1} C ${x1 + 80} ${y1}, ${x2 - 80} ${y2}, ${x2} ${y2}`);
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
    loadBgAssets();
}

function closeBgPicker() {
    document.getElementById('bgPickerModal').classList.remove('open');
    bgPickerSlideId = null;
}

function loadBgAssets() {
    const grid = document.getElementById('bgAssetsGrid');
    if (!grid) return;
    
    grid.innerHTML = '<p style="color:#888;text-align:center;grid-column:1/-1;">Loading assets...</p>';
    
    // Fetch expedition assets from S3
    const token = localStorage.getItem('accessToken');
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
    
    grid.innerHTML = expeditionAssets.map(url => `
        <div class="bg-asset-item" data-url="${url}">
            <img src="${url}" alt="Asset" onerror="this.parentElement.style.display='none'">
        </div>
    `).join('');
    
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
        if (uploadStatus) uploadStatus.textContent = 'Uploading...';
        
        const formData = new FormData();
        formData.append('file', file);
        formData.append('folder', 'expeditions');
        
        try {
            const token = localStorage.getItem('accessToken');
            const response = await fetch('http://localhost:8080/api/uploadAsset', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });
            
            const result = await response.json();
            if (result.url) {
                if (uploadStatus) uploadStatus.textContent = 'Uploaded!';
                // Add to local cache and select it
                expeditionAssets.unshift(result.url);
                renderBgAssetsGrid();
                selectBgAsset(result.url);
            } else {
                if (uploadStatus) uploadStatus.textContent = 'Upload failed';
            }
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

// ==================== EXPOSE GLOBALLY ====================
window.initExpeditionDesigner = initExpeditionDesigner;
window.addExpeditionSlide = addSlide;
window.closeBgPicker = closeBgPicker;
window.applyBgUrl = applyBgUrl;
window.clearSlideBg = clearSlideBg;
window.closeOptionModal = closeOptionModal;
window.saveOptionFromModal = saveOptionFromModal;
window.uploadSlideBgFromDevice = uploadSlideBgFromDevice;

console.log('✅ expedition-designer.js READY');
