// Cosmetics Editor – 2-Panel Layout with Drag/Resize

let cosmeticState = {
    cosmetics: [],       // DB rows {id, type, name, price, offsetX, offsetY, scale}
    assets: [],          // R2 assets {assetID, icon}
    equipped: {},        // type -> {id, url, offsetX, offsetY, scale}
    activeType: null,
    byType: {},          // type -> [{id, url, name, price, offsetX, offsetY, scale}]
    dirty: new Set(),    // set of cosmetic IDs with unsaved changes
};

const COSMETIC_TYPES = ['face', 'eyes', 'mouth', 'nose', 'hair', 'beard', 'brows', 'ears', 'special'];
const COSMETIC_LAYER_ORDER = ['face', 'ears', 'nose', 'mouth', 'eyes', 'brows', 'beard', 'special', 'hair'];

let cosmeticDrag = null; // { startX, startY, origOffsetX, origOffsetY }

function registerCosmeticDesigner() {
    if (!document.getElementById('cosmetics-content')) return;
    window.initCosmeticDesigner = initCosmeticDesigner;
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', registerCosmeticDesigner);
} else {
    registerCosmeticDesigner();
}

async function initCosmeticDesigner() {
    await loadCosmeticData();
}

async function loadCosmeticData() {
    try {
        const token = await getCurrentAccessToken();
        if (!token) return;

        const [cosRes, assetRes] = await Promise.all([
            fetch('/api/getCosmetics', { headers: { 'Authorization': `Bearer ${token}` } }).then(r => r.json()),
            fetch('/api/getCosmeticAssets', { headers: { 'Authorization': `Bearer ${token}` } }).then(r => r.json()),
        ]);

        cosmeticState.cosmetics = cosRes.success ? (cosRes.cosmetics || []) : [];
        cosmeticState.assets = assetRes.success ? (assetRes.assets || []) : [];

        buildTypeIndex();
        autoEquipDefaults();
        renderCosmeticEditor();
    } catch (error) {
        console.error('Error loading cosmetics:', error);
    }
}

function buildTypeIndex() {
    const assetByID = new Map(cosmeticState.assets.map(a => [a.assetID, a]));
    cosmeticState.byType = {};

    for (const type of COSMETIC_TYPES) {
        cosmeticState.byType[type] = [];
    }

    for (const cosmetic of cosmeticState.cosmetics) {
        if (!cosmeticState.byType[cosmetic.type]) continue;
        const asset = assetByID.get(cosmetic.id);
        const url = asset ? asset.icon : '';

        const isFace = cosmetic.type === 'face';
        cosmeticState.byType[cosmetic.type].push({
            id: cosmetic.id,
            url: url,
            name: cosmetic.name || '',
            price: cosmetic.price || 0,
            offsetX: isFace ? 0 : (cosmetic.offsetX || 0),
            offsetY: isFace ? 0 : (cosmetic.offsetY || 0),
            scale: isFace ? 100 : (cosmetic.scale || 100)
        });
    }
}

function autoEquipDefaults() {
    for (const type of COSMETIC_TYPES) {
        if (cosmeticState.equipped[type]) continue;
        const items = cosmeticState.byType[type];
        if (items && items.length > 0 && items[0].url) {
            const item = items[0];
            cosmeticState.equipped[type] = {
                id: item.id, url: item.url,
                offsetX: item.offsetX, offsetY: item.offsetY, scale: item.scale
            };
        }
    }
}

function renderCosmeticEditor() {
    renderCategorySelectors();
    renderCosmeticPreview();
    renderCosmeticGallery();
    updateSaveButtonVisibility();
}

// ── Category selectors below preview ──
function renderCategorySelectors() {
    const container = document.getElementById('cosmeticCategorySelectors');
    if (!container) return;

    container.innerHTML = COSMETIC_TYPES.map(type => {
        const equipped = cosmeticState.equipped[type];
        const isActive = cosmeticState.activeType === type;

        return `
            <div class="cosmetic-cat-btn ${isActive ? 'active' : ''} ${equipped ? 'has-equipped' : ''}" onclick="selectCosmeticCategory('${type}')">
                <span class="cosmetic-cat-name">${type}</span>
            </div>
        `;
    }).join('');
}

function selectCosmeticCategory(type) {
    cosmeticState.activeType = cosmeticState.activeType === type ? null : type;
    renderCosmeticEditor();
}

function equipCosmeticDirect(type, id, url) {
    const items = cosmeticState.byType[type] || [];
    const item = items.find(i => i.id === id);
    cosmeticState.equipped[type] = {
        id, url,
        offsetX: item ? item.offsetX : 0,
        offsetY: item ? item.offsetY : 0,
        scale: item ? item.scale : 100
    };
    renderCosmeticEditor();
}

function unequipCosmeticType(type) {
    delete cosmeticState.equipped[type];
    renderCosmeticEditor();
}

// ── Preview with per-item transforms + mouse drag/resize ──
function renderCosmeticPreview() {
    const canvas = document.getElementById('cosmeticPreviewCanvas');
    if (!canvas) return;

    canvas.innerHTML = '';

    COSMETIC_LAYER_ORDER.forEach((type, idx) => {
        const equipped = cosmeticState.equipped[type];
        if (!equipped || !equipped.url) return;

        const ox = equipped.offsetX || 0;
        const oy = equipped.offsetY || 0;
        const sc = (equipped.scale || 100) / 100;

        const layerImg = document.createElement('img');
        layerImg.className = 'cosmetic-layer';
        if (type === cosmeticState.activeType) layerImg.classList.add('active-layer');
        layerImg.src = equipped.url;
        layerImg.dataset.type = type;
        layerImg.style.zIndex = String(idx);
        layerImg.style.transform = `translate(${ox}%, ${oy}%) scale(${sc})`;
        canvas.appendChild(layerImg);
    });

    setupCanvasInteraction(canvas);
}

function setupCanvasInteraction(canvas) {
    if (canvas._hasInteraction) return;
    canvas._hasInteraction = true;

    canvas.addEventListener('mousedown', (e) => {
        const type = cosmeticState.activeType;
        if (!type || type === 'face') return;
        const equipped = cosmeticState.equipped[type];
        if (!equipped) return;

        e.preventDefault();
        cosmeticDrag = {
            startX: e.clientX,
            startY: e.clientY,
            origOffsetX: equipped.offsetX || 0,
            origOffsetY: equipped.offsetY || 0
        };
        canvas.classList.add('dragging');
    });

    document.addEventListener('mousemove', (e) => {
        if (!cosmeticDrag) return;
        const type = cosmeticState.activeType;
        if (!type) return;
        const equipped = cosmeticState.equipped[type];
        if (!equipped) return;

        const rect = canvas.getBoundingClientRect();
        const dx = ((e.clientX - cosmeticDrag.startX) / rect.width) * 100;
        const dy = ((e.clientY - cosmeticDrag.startY) / rect.height) * 100;

        equipped.offsetX = Math.round((cosmeticDrag.origOffsetX + dx) * 10) / 10;
        equipped.offsetY = Math.round((cosmeticDrag.origOffsetY + dy) * 10) / 10;

        const layer = canvas.querySelector(`img[data-type="${type}"]`);
        if (layer) {
            layer.style.transform = `translate(${equipped.offsetX}%, ${equipped.offsetY}%) scale(${(equipped.scale || 100) / 100})`;
        }
    });

    document.addEventListener('mouseup', () => {
        if (!cosmeticDrag) return;
        cosmeticDrag = null;
        canvas.classList.remove('dragging');

        const type = cosmeticState.activeType;
        if (!type) return;
        const equipped = cosmeticState.equipped[type];
        if (!equipped) return;

        syncEquippedToByType(type);
        markCosmeticDirty(equipped.id);
    });

    canvas.addEventListener('wheel', (e) => {
        const type = cosmeticState.activeType;
        if (!type || type === 'face') return;
        const equipped = cosmeticState.equipped[type];
        if (!equipped) return;

        e.preventDefault();
        e.stopPropagation();
        const delta = e.deltaY > 0 ? -5 : 5;
        equipped.scale = Math.max(10, Math.min(300, (equipped.scale || 100) + delta));

        const layer = canvas.querySelector(`img[data-type="${type}"]`);
        if (layer) {
            layer.style.transform = `translate(${equipped.offsetX || 0}%, ${equipped.offsetY || 0}%) scale(${equipped.scale / 100})`;
        }

        clearTimeout(canvas._wheelSaveTimer);
        canvas._wheelSaveTimer = setTimeout(() => {
            syncEquippedToByType(type);
            markCosmeticDirty(equipped.id);
        }, 300);
    }, { passive: false });
}

function syncEquippedToByType(type) {
    const equipped = cosmeticState.equipped[type];
    if (!equipped) return;
    const items = cosmeticState.byType[type] || [];
    const item = items.find(i => i.id === equipped.id);
    if (item) {
        item.offsetX = equipped.offsetX;
        item.offsetY = equipped.offsetY;
        item.scale = equipped.scale;
    }
}

function markCosmeticDirty(id) {
    cosmeticState.dirty.add(id);
    updateSaveButtonVisibility();
}

function updateSaveButtonVisibility() {
    const btn = document.getElementById('cosmeticSaveBtn');
    const dismissBtn = document.getElementById('cosmeticDismissBtn');
    const hasDirty = cosmeticState.dirty.size > 0;
    if (btn) {
        btn.disabled = !hasDirty;
        btn.textContent = hasDirty ? `Save Changes (${cosmeticState.dirty.size})` : 'Save Changes';
    }
    if (dismissBtn) {
        dismissBtn.disabled = !hasDirty;
    }
}

function dismissCosmeticChanges() {
    // Revert all dirty items back to their original DB values
    for (const id of cosmeticState.dirty) {
        const cosmetic = cosmeticState.cosmetics.find(c => c.id === id);
        if (!cosmetic) continue;
        const items = cosmeticState.byType[cosmetic.type] || [];
        const item = items.find(i => i.id === id);
        if (item) {
            item.price = cosmetic.price;
            item.offsetX = cosmetic.offsetX;
            item.offsetY = cosmetic.offsetY;
            item.scale = cosmetic.scale;
        }
        // Also revert equipped preview
        const equipped = cosmeticState.equipped[cosmetic.type];
        if (equipped && equipped.id === id) {
            equipped.offsetX = cosmetic.offsetX;
            equipped.offsetY = cosmetic.offsetY;
            equipped.scale = cosmetic.scale;
        }
    }
    cosmeticState.dirty.clear();
    updateSaveButtonVisibility();
    renderCosmeticEditor();
    setCosmeticStatus('Changes dismissed', false);
}

async function saveAllCosmeticChanges() {
    const btn = document.getElementById('cosmeticSaveBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

    try {
        const token = await getCurrentAccessToken();
        if (!token) return;

        const promises = [];
        for (const id of cosmeticState.dirty) {
            const cosmetic = cosmeticState.cosmetics.find(c => c.id === id);
            if (!cosmetic) continue;

            // Merge in-memory byType data (which has latest price/transform from UI)
            const items = cosmeticState.byType[cosmetic.type] || [];
            const item = items.find(i => i.id === id);

            promises.push(fetch('/api/saveCosmetic', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id,
                    type: cosmetic.type,
                    name: cosmetic.name || '',
                    price: item ? item.price : (cosmetic.price || 0),
                    offsetX: item ? item.offsetX : (cosmetic.offsetX || 0),
                    offsetY: item ? item.offsetY : (cosmetic.offsetY || 0),
                    scale: item ? item.scale : (cosmetic.scale || 100)
                })
            }).then(r => r.json()));
        }

        const results = await Promise.all(promises);
        const failed = results.filter(r => !r.success).length;

        if (failed === 0) {
            // Sync back to cosmetics array
            for (const id of cosmeticState.dirty) {
                const cosmetic = cosmeticState.cosmetics.find(c => c.id === id);
                const items = cosmeticState.byType[cosmetic.type] || [];
                const item = items.find(i => i.id === id);
                if (cosmetic && item) {
                    cosmetic.price = item.price;
                    cosmetic.offsetX = item.offsetX;
                    cosmetic.offsetY = item.offsetY;
                    cosmetic.scale = item.scale;
                }
            }
            cosmeticState.dirty.clear();
            setCosmeticStatus(`Saved ${results.length} cosmetics`, false);
        } else {
            setCosmeticStatus(`${failed} save(s) failed`, true);
        }
    } catch (error) {
        console.error('Error saving cosmetics:', error);
        setCosmeticStatus('Save failed', true);
    }

    updateSaveButtonVisibility();
}

// ── Gallery ──
function renderCosmeticGallery() {
    const gallery = document.getElementById('cosmeticGallery');
    if (!gallery) return;

    const type = cosmeticState.activeType;
    if (!type) {
        gallery.innerHTML = '<div class="cosmetic-gallery-hint">Select a category to browse items</div>';
        return;
    }

    const items = cosmeticState.byType[type] || [];
    const equipped = cosmeticState.equipped[type];
    const equippedId = equipped ? equipped.id : null;

    gallery.innerHTML = `
        <div class="cosmetic-gallery-header">
            <span class="cosmetic-gallery-title">${type}</span>
            <span class="cosmetic-gallery-count">${items.length} items</span>
            <span id="cosmeticStatus" class="cosmetic-status"></span>
            <button id="cosmeticDismissBtn" class="cosmetic-dismiss-btn" onclick="dismissCosmeticChanges()" disabled>Dismiss</button>
            <button id="cosmeticSaveBtn" class="cosmetic-save-btn" onclick="saveAllCosmeticChanges()" disabled>Save Changes</button>
        </div>
        <div class="cosmetic-gallery-grid">
            <div class="cosmetic-gallery-item cosmetic-add-card" onclick="openCosmeticUploadDialog()">
                <div class="cosmetic-add-icon">+</div>
                <div class="cosmetic-add-label">Add</div>
            </div>
            ${items.map(item => `
                <div class="cosmetic-gallery-item ${item.id === equippedId ? 'equipped' : ''}"
                     onclick="equipCosmeticDirect('${type}', ${item.id}, '${item.url}')">
                    ${item.url ? `<img src="${item.url}" alt="${item.id}" loading="lazy">` : '<div class="cosmetic-no-asset">no asset</div>'}
                    <div class="cosmetic-gallery-item-info">
                        <span class="cosmetic-gallery-item-id" title="${item.name}">#${item.id}</span>
                        <input type="number" class="cosmetic-price-input" value="${item.price}" min="0"
                            onclick="event.stopPropagation()"
                            onchange="updateCosmeticPrice(${item.id}, this.value)">
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

// ── Upload dialog ──
function openCosmeticUploadDialog() {
    const type = cosmeticState.activeType;
    if (!type) return;

    const existing = document.getElementById('cosmeticUploadDialog');
    if (existing) existing.remove();

    const dialog = document.createElement('div');
    dialog.id = 'cosmeticUploadDialog';
    dialog.className = 'cosmetic-upload-overlay';
    dialog.innerHTML = `
        <div class="cosmetic-upload-dialog">
            <div class="cosmetic-upload-dialog-header">
                <span>Add ${type} cosmetic</span>
                <button onclick="closeCosmeticUploadDialog()" class="cosmetic-upload-close">&times;</button>
            </div>
            <div class="cosmetic-upload-dialog-body">
                <div class="cosmetic-upload-dropzone" id="cosmeticDropzone" onclick="document.getElementById('cosmeticDialogFile').click()">
                    <div class="cosmetic-upload-dropzone-text">Click to select image</div>
                    <img id="cosmeticDialogPreview" class="cosmetic-upload-preview" style="display:none">
                </div>
                <input type="file" id="cosmeticDialogFile" accept="image/*" style="display:none">
                <div class="cosmetic-upload-field">
                    <label>Price</label>
                    <input type="number" id="cosmeticDialogPrice" value="0" min="0">
                </div>
            </div>
            <div class="cosmetic-upload-dialog-footer">
                <button onclick="closeCosmeticUploadDialog()" class="cosmetic-upload-btn-cancel">Cancel</button>
                <button onclick="submitCosmeticUpload()" id="cosmeticDialogSubmit" class="cosmetic-upload-btn-submit" disabled>Upload</button>
            </div>
        </div>
    `;
    document.body.appendChild(dialog);

    dialog.addEventListener('click', (e) => {
        if (e.target === dialog) closeCosmeticUploadDialog();
    });

    document.getElementById('cosmeticDialogFile').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const preview = document.getElementById('cosmeticDialogPreview');
        const dropText = document.querySelector('.cosmetic-upload-dropzone-text');
        const reader = new FileReader();
        reader.onload = () => {
            preview.src = reader.result;
            preview.style.display = 'block';
            if (dropText) dropText.style.display = 'none';
            document.getElementById('cosmeticDialogSubmit').disabled = false;
        };
        reader.readAsDataURL(file);
    });
}

function closeCosmeticUploadDialog() {
    const dialog = document.getElementById('cosmeticUploadDialog');
    if (dialog) dialog.remove();
}

async function submitCosmeticUpload() {
    const type = cosmeticState.activeType;
    if (!type) return;

    const fileInput = document.getElementById('cosmeticDialogFile');
    const file = fileInput && fileInput.files[0];
    if (!file) return;

    const price = parseInt(document.getElementById('cosmeticDialogPrice').value, 10) || 0;
    const submitBtn = document.getElementById('cosmeticDialogSubmit');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Uploading...'; }

    const reader = new FileReader();
    reader.onload = async () => {
        const imageData = reader.result;
        const contentType = file.type || 'image/png';
        const name = file.name.replace(/\.[^.]+$/, '');

        try {
            const token = await getCurrentAccessToken();
            if (!token) return;

            const res = await fetch('/api/uploadCosmetic', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ type, name, imageData, contentType })
            });

            const data = await res.json();
            if (data.success) {
                if (price > 0) {
                    await fetch('/api/saveCosmetic', {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: data.id, type, name, price, offsetX: 0, offsetY: 0, scale: 100 })
                    });
                }
                closeCosmeticUploadDialog();
                setCosmeticStatus(`Uploaded #${data.id}`, false);
                await loadCosmeticData();
            } else {
                setCosmeticStatus(data.message || 'Upload failed', true);
                if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Upload'; }
            }
        } catch (error) {
            console.error('Error uploading cosmetic:', error);
            setCosmeticStatus('Upload failed', true);
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Upload'; }
        }
    };
    reader.readAsDataURL(file);
}

function updateCosmeticPrice(id, value) {
    const price = parseInt(value, 10) || 0;
    const cosmetic = cosmeticState.cosmetics.find(c => c.id === id);
    if (!cosmetic) return;

    cosmetic.price = price;
    for (const items of Object.values(cosmeticState.byType)) {
        const item = items.find(i => i.id === id);
        if (item) item.price = price;
    }
    markCosmeticDirty(id);
}

function setCosmeticStatus(message, isError) {
    const el = document.getElementById('cosmeticStatus');
    if (!el) return;
    el.textContent = message;
    el.className = `cosmetic-status ${isError ? 'error' : 'success'}`;
    if (!isError) {
        setTimeout(() => {
            el.textContent = '';
            el.className = 'cosmetic-status';
        }, 2000);
    }
}
