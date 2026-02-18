// Perk Designer JavaScript

// Current state - all variables prefixed with 'perk' to avoid conflicts with other designers
let allPerks = [];
let allPendingPerks = [];
let filteredPerks = [];
let filteredPendingPerks = [];
let selectedPerkId = null;
let perkActiveTab = 'game'; // 'game' or 'pending'
let isViewingPendingPerk = false;
let perkAssets = [];
let perkSelectedAssetId = null;
let perkSelectedAssetIcon = null;

let perkDesignerBootstrapped = false;

function ensurePerkDesignerInit() {
    if (perkDesignerBootstrapped) return;
    if (!document.getElementById('perkForm')) return;
    perkDesignerBootstrapped = true;
    initPerkDesigner();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensurePerkDesignerInit);
} else {
    ensurePerkDesignerInit();
}

function initPerkDesigner() {
    console.log('🎨 Initializing Perk Designer...');
    loadPerksAndEffects();
    setupPerkEventListeners();
    console.log('✅ Perk Designer initialized');
}

function setupPerkEventListeners() {
    // Tab buttons
    const gameTab = document.getElementById('gamePerksTab');
    const pendingTab = document.getElementById('pendingPerksTab');
    if (gameTab) {
        gameTab.addEventListener('click', () => switchPerkTab('game'));
    }
    if (pendingTab) {
        pendingTab.addEventListener('click', () => switchPerkTab('pending'));
    }
    
    // Search input
    const searchInput = document.getElementById('perkSearch');
    if (searchInput) {
        searchInput.addEventListener('input', filterPerks);
    }
    
    // New perk button
    const newPerkBtn = document.getElementById('newPerkBtn');
    if (newPerkBtn) {
        newPerkBtn.addEventListener('click', createNewPerk);
    }
    
    // Merge perks button
    const mergePerksBtn = document.getElementById('mergePerksBtn');
    if (mergePerksBtn) {
        mergePerksBtn.addEventListener('click', mergeApprovedPerks);
    }
    
    // Asset gallery button
    const assetGalleryBtn = document.getElementById('perkAssetGalleryBtn');
    if (assetGalleryBtn) {
        assetGalleryBtn.addEventListener('click', togglePerkAssetGallery);
    }
    
    // Asset gallery close button
    const assetGalleryClose = document.getElementById('perkAssetGalleryClose');
    if (assetGalleryClose) {
        assetGalleryClose.addEventListener('click', togglePerkAssetGallery);
    }
    
    // Close gallery when clicking overlay
    const assetGalleryOverlay = document.getElementById('perkAssetGalleryOverlay');
    if (assetGalleryOverlay) {
        assetGalleryOverlay.addEventListener('click', (e) => {
            if (e.target === assetGalleryOverlay) {
                togglePerkAssetGallery();
            }
        });
    }
    
    // Upload new asset button
    const uploadNewBtn = document.getElementById('perkUploadNewBtn');
    if (uploadNewBtn) {
        uploadNewBtn.addEventListener('click', () => {
            document.getElementById('perkIconFile').click();
        });
    }
    
    // File input change handler
    const fileInput = document.getElementById('perkIconFile');
    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                handlePerkIconUpload(file);
            }
        });
    }
    
    // Click on icon preview to open gallery
    const iconUploadArea = document.getElementById('perkIconUploadArea');
    if (iconUploadArea) {
        iconUploadArea.addEventListener('click', () => {
            togglePerkAssetGallery();
        });
        
        // Drag and drop
        iconUploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            iconUploadArea.classList.add('drag-over');
        });
        
        iconUploadArea.addEventListener('dragleave', () => {
            iconUploadArea.classList.remove('drag-over');
        });
        
        iconUploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            iconUploadArea.classList.remove('drag-over');
            const file = e.dataTransfer.files[0];
            if (file) {
                handlePerkIconUpload(file);
            }
        });
    }
    
    // Cancel button
    const cancelBtn = document.getElementById('perkCancelBtn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', cancelPerkEdit);
    }
    
    // Form submission
    const perkForm = document.getElementById('perkForm');
    if (perkForm) {
        perkForm.addEventListener('submit', savePerk);
    }
}

async function loadPerksAndEffects(options = {}) {
    const forceReload = options?.forceReload === true;
    if (forceReload) console.log('🔄 Reloading perks data...');
    
    try {
        // Load effects first
        await loadEffectsData();
        populatePerkEffectDropdowns();
        
        // Load shared perk assets (also used by talents)
        await loadPerkAssets({ forceReload });
        perkAssets = typeof getPerkAssets === 'function' ? (getPerkAssets() || []) : [];
        createPerkAssetGallery();
        
        // Load perks
        await loadPerksData({ forceReload });
        allPerks = getPerks();
        allPendingPerks = getPendingPerks();
        filteredPerks = [...allPerks];
        filteredPendingPerks = [...allPendingPerks];
        
        renderPerkList();
        renderPendingPerkList();
        
    } catch (error) {
        console.error('Error loading perks data:', error);
    }
}

function createPerkAssetGallery() {
    const grid = document.getElementById('perkAssetGrid');
    if (!grid) return;
    
    if (perkAssets.length === 0) {
        grid.innerHTML = '<p class="loading-text">No assets found. Upload a new one!</p>';
        return;
    }
    
    grid.innerHTML = perkAssets.map(asset => `
        <div class="asset-item" onclick="selectPerkAsset(${asset.assetID}, '${asset.icon}')">
            <img src="${asset.icon}" alt="Asset ${asset.assetID}">
        </div>
    `).join('');
}

function renderPerkList() {
    const perkList = document.getElementById('perkList');
    if (!perkList) return;
    
    if (filteredPerks.length === 0) {
        perkList.innerHTML = '<p class="loading-text">No perks found</p>';
        return;
    }
    
    perkList.innerHTML = filteredPerks.map(perk => `
        <div class="perk-list-item ${perk.id === selectedPerkId && perkActiveTab === 'game' ? 'selected' : ''}" 
             data-id="${perk.id}" onclick="selectPerk(${perk.id})">
            <div class="perk-name">${escapeHtml(perk.name)}</div>
        </div>
    `).join('');
}

function renderPendingPerkList() {
    const pendingList = document.getElementById('pendingPerkList');
    if (!pendingList) return;
    
    if (filteredPendingPerks.length === 0) {
        pendingList.innerHTML = '<p class="loading-text">No pending perks</p>';
        return;
    }
    
    pendingList.innerHTML = filteredPendingPerks.map(perk => `
        <div class="perk-list-item pending-perk ${perk.toolingId === selectedPerkId && perkActiveTab === 'pending' ? 'selected' : ''}" 
             data-id="${perk.toolingId}" onclick="selectPendingPerk(${perk.toolingId})">
            <div class="pending-perk-header">
                <span class="perk-name">${escapeHtml(perk.name)}</span>
                <span class="perk-action ${perk.action}">${perk.action}</span>
            </div>
            <div class="pending-perk-footer">
                <div class="pending-perk-actions" onclick="event.stopPropagation()">
                    <label class="approve-checkbox">
                        <input type="checkbox" ${perk.approved ? 'checked' : ''} 
                               onchange="togglePerkApproval(${perk.toolingId}, this.checked)">
                        <span>Approve</span>
                    </label>
                    <button class="btn-remove-pending" onclick="removePendingPerk(${perk.toolingId})" title="Remove pending perk">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    `).join('');
}

function filterPerks() {
    const searchTerm = document.getElementById('perkSearch')?.value.toLowerCase() || '';
    
    filteredPerks = allPerks.filter(perk => {
        return perk.name.toLowerCase().includes(searchTerm);
    });
    
    filteredPendingPerks = allPendingPerks.filter(perk => {
        return perk.name.toLowerCase().includes(searchTerm);
    });
    
    renderPerkList();
    renderPendingPerkList();
}

function switchPerkTab(tab) {
    perkActiveTab = tab;
    
    const gameTab = document.getElementById('gamePerksTab');
    const pendingTab = document.getElementById('pendingPerksTab');
    if (gameTab) gameTab.classList.toggle('active', tab === 'game');
    if (pendingTab) pendingTab.classList.toggle('active', tab === 'pending');
    
    const perkList = document.getElementById('perkList');
    const pendingList = document.getElementById('pendingPerkList');
    if (perkList) perkList.style.display = tab === 'game' ? 'block' : 'none';
    if (pendingList) pendingList.style.display = tab === 'pending' ? 'block' : 'none';
    
    // Show/hide buttons based on tab
    const newPerkBtn = document.getElementById('newPerkBtn');
    const mergePerksBtn = document.getElementById('mergePerksBtn');
    if (newPerkBtn) newPerkBtn.style.display = tab === 'game' ? 'block' : 'none';
    if (mergePerksBtn) mergePerksBtn.style.display = tab === 'pending' ? 'block' : 'none';
    
    selectedPerkId = null;
    isViewingPendingPerk = false;
    setPerkFormLocked(false);
    clearPerkForm();
    document.getElementById('perkEditorTitle').textContent = 'Create New Perk';
}

function selectPerk(perkId) {
    perkActiveTab = 'game';
    selectedPerkId = perkId;
    isViewingPendingPerk = false;
    const perk = allPerks.find(p => p.id === perkId);
    
    if (perk) {
        populatePerkForm(perk);
        setPerkFormLocked(false);
        document.getElementById('perkEditorTitle').textContent = 'Edit Perk';
    }
    
    renderPerkList();
    renderPendingPerkList();
}

function selectPendingPerk(toolingId) {
    perkActiveTab = 'pending';
    selectedPerkId = toolingId;
    isViewingPendingPerk = true;
    const perk = allPendingPerks.find(p => p.toolingId === toolingId);
    
    if (perk) {
        populatePerkFormFromPending(perk);
        setPerkFormLocked(true);
        document.getElementById('perkEditorTitle').textContent = `Pending: ${perk.action.toUpperCase()}`;
    }
    
    renderPerkList();
    renderPendingPerkList();
}

function populatePerkForm(perk) {
    document.getElementById('perkId').value = perk.id || '';
    document.getElementById('perkName').value = perk.name || '';
    document.getElementById('perkAssetID').value = perk.assetID || 1;
    document.getElementById('perkDescription').value = perk.description || '';
    document.getElementById('perkIsBlessing').checked = perk.is_blessing || false;
    
    // Effects
    document.getElementById('perkEffect1').value = perk.effect1_id || '';
    document.getElementById('perkFactor1').value = perk.factor1 || '';
    document.getElementById('perkEffect2').value = perk.effect2_id || '';
    document.getElementById('perkFactor2').value = perk.factor2 || '';
    
    // Update effect descriptions
    updatePerkEffectDescription(1);
    updatePerkEffectDescription(2);
    
    // Update icon preview
    updatePerkIconPreview(perk.assetID);
}

function populatePerkFormFromPending(perk) {
    document.getElementById('perkId').value = perk.gameId || '';
    document.getElementById('perkName').value = perk.name || '';
    document.getElementById('perkAssetID').value = perk.assetID || 1;
    document.getElementById('perkDescription').value = perk.description || '';
    document.getElementById('perkIsBlessing').checked = perk.is_blessing || false;
    
    // Effects
    document.getElementById('perkEffect1').value = perk.effect1_id || '';
    document.getElementById('perkFactor1').value = perk.factor1 || '';
    document.getElementById('perkEffect2').value = perk.effect2_id || '';
    document.getElementById('perkFactor2').value = perk.factor2 || '';
    
    // Update effect descriptions
    updatePerkEffectDescription(1);
    updatePerkEffectDescription(2);
    
    // Update icon preview
    updatePerkIconPreview(perk.assetID);
}

function setPerkFormLocked(locked) {
    const form = document.getElementById('perkForm');
    if (!form) return;
    
    const inputs = form.querySelectorAll('input, select, textarea');
    inputs.forEach(input => {
        input.disabled = locked;
    });
    
    const saveBtn = form.querySelector('.btn-save-perk');
    if (saveBtn) {
        saveBtn.style.display = locked ? 'none' : 'block';
    }
    
    form.classList.toggle('form-locked', locked);
}

function createNewPerk() {
    selectedPerkId = null;
    isViewingPendingPerk = false;
    setPerkFormLocked(false);
    clearPerkForm();
    document.getElementById('perkEditorTitle').textContent = 'Create New Perk';
    renderPerkList();
    renderPendingPerkList();
}

function clearPerkForm() {
    document.getElementById('perkId').value = '';
    document.getElementById('perkName').value = '';
    document.getElementById('perkAssetID').value = '1';
    document.getElementById('perkDescription').value = '';
    document.getElementById('perkEffect1').value = '';
    document.getElementById('perkFactor1').value = '';
    document.getElementById('perkEffect2').value = '';
    document.getElementById('perkFactor2').value = '';
    document.getElementById('perkIsBlessing').checked = false;
    
    // Reset effect descriptions
    const desc1 = document.getElementById('perkEffect1Desc');
    const desc2 = document.getElementById('perkEffect2Desc');
    if (desc1) desc1.textContent = 'Select an effect to see description';
    if (desc2) desc2.textContent = 'Select an effect to see description';
    
    clearPerkIconPreview();
}

function cancelPerkEdit() {
    selectedPerkId = null;
    isViewingPendingPerk = false;
    setPerkFormLocked(false);
    clearPerkForm();
    document.getElementById('perkEditorTitle').textContent = 'Create New Perk';
    renderPerkList();
    renderPendingPerkList();
}

function populatePerkEffectDropdowns() {
    const effect1Select = document.getElementById('perkEffect1');
    const effect2Select = document.getElementById('perkEffect2');
    if (!effect1Select || !effect2Select) return;
    
    const effects = getEffects();
    
    const optionsHTML = '<option value="">-- No Effect --</option>' +
        effects.map(e => `<option value="${e.id}">${e.name}</option>`).join('');
    
    effect1Select.innerHTML = optionsHTML;
    effect2Select.innerHTML = optionsHTML;
    
    // Add change listeners for effect descriptions
    effect1Select.addEventListener('change', () => updatePerkEffectDescription(1));
    effect2Select.addEventListener('change', () => updatePerkEffectDescription(2));

    if (typeof DesignerBase !== 'undefined' && typeof DesignerBase.bindDropdownSpace === 'function') {
        DesignerBase.bindDropdownSpace(effect1Select);
        DesignerBase.bindDropdownSpace(effect2Select);
    }
}

function updatePerkEffectDescription(effectNum) {
    const select = document.getElementById(`perkEffect${effectNum}`);
    const descSpan = document.getElementById(`perkEffect${effectNum}Desc`);
    if (!select || !descSpan) return;
    
    const effectId = parseInt(select.value);
    if (!effectId) {
        descSpan.textContent = 'Select an effect to see description';
        return;
    }
    
    const effects = getEffects();
    const effect = effects.find(e => e.id === effectId);
    descSpan.textContent = effect?.description || 'No description available';
}

async function savePerk(e) {
    e.preventDefault();
    
    const perkId = document.getElementById('perkId').value;
    const isUpdate = !!perkId;
    
    const perkData = {
        id: perkId ? parseInt(perkId) : null,
        name: document.getElementById('perkName').value,
        assetID: parseInt(document.getElementById('perkAssetID').value) || 1,
        description: document.getElementById('perkDescription').value || null,
        effect1_id: parseIntOrNull(document.getElementById('perkEffect1').value),
        factor1: parseIntOrNull(document.getElementById('perkFactor1').value),
        effect2_id: parseIntOrNull(document.getElementById('perkEffect2').value),
        factor2: parseIntOrNull(document.getElementById('perkFactor2').value),
        is_blessing: document.getElementById('perkIsBlessing').checked
    };
    
    console.log('Saving perk:', perkData);
    
    try {
        const token = await getCurrentAccessToken();
        if (!token) {
            alert('Authentication required');
            return;
        }
        
        const response = await fetch('http://localhost:8080/api/createPerk', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(perkData)
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert(isUpdate ? 'Perk updated successfully!' : 'Perk created successfully!');
            
            // Build a local pending object instead of full reload
            const pendingPerk = {
                toolingId: result.toolingId,
                gameId: perkData.id,
                name: perkData.name,
                assetID: perkData.assetID,
                description: perkData.description,
                effect1_id: perkData.effect1_id,
                factor1: perkData.factor1,
                effect2_id: perkData.effect2_id,
                factor2: perkData.factor2,
                is_blessing: perkData.is_blessing,
                action: result.action || (isUpdate ? 'update' : 'insert'),
                approved: false
            };

            // If editing an existing pending perk, replace it; otherwise push new
            const existingIdx = allPendingPerks.findIndex(p => p.toolingId === result.toolingId);
            if (existingIdx !== -1) {
                allPendingPerks[existingIdx] = pendingPerk;
            } else {
                allPendingPerks.push(pendingPerk);
            }
            filteredPendingPerks = [...allPendingPerks];
            // Keep GlobalData in sync
            setGlobalArray('pendingPerks', allPendingPerks);
            
            renderPendingPerkList();
            clearPerkForm();
            document.getElementById('perkEditorTitle').textContent = 'Create New Perk';
            selectedPerkId = null;
            switchPerkTab('pending');
        } else {
            alert('Error saving perk: ' + (result.message || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error saving perk:', error);
        alert('Error saving perk: ' + error.message);
    }
}

async function togglePerkApproval(toolingId, approved) {
    console.log(`Toggling approval for perk tooling_id: ${toolingId}`);
    
    try {
        const token = await getCurrentAccessToken();
        if (!token) {
            alert('Authentication required');
            return;
        }
        
        const response = await fetch('http://localhost:8080/api/toggleApprovePerk', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ toolingId: toolingId })
        });
        
        const result = await response.json();
        
        if (result.success) {
            console.log('✅ Perk approval toggled successfully');
            const perk = allPendingPerks.find(p => p.toolingId === toolingId);
            if (perk) {
                perk.approved = !perk.approved;
            }
        } else {
            alert('Error toggling approval: ' + (result.message || 'Unknown error'));
            const checkbox = document.querySelector(`input[onchange*="togglePerkApproval(${toolingId}"]`);
            if (checkbox) checkbox.checked = !approved;
        }
    } catch (error) {
        console.error('Error toggling perk approval:', error);
        alert('Error toggling approval: ' + error.message);
    }
}

async function removePendingPerk(toolingId) {
    const perk = allPendingPerks.find(p => p.toolingId === toolingId);
    const perkName = perk ? perk.name : `ID ${toolingId}`;
    
    if (!confirm(`Remove pending perk "${perkName}"? This cannot be undone.`)) {
        return;
    }
    
    console.log(`Removing pending perk: ${toolingId}`);
    
    try {
        const token = await getCurrentAccessToken();
        if (!token) {
            alert('Authentication required');
            return;
        }
        
        const response = await fetch('http://localhost:8080/api/removePendingPerk', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ toolingId: toolingId })
        });
        
        const result = await response.json();
        
        if (result.success) {
            console.log('✅ Pending perk removed successfully');
            // Remove from local state
            allPendingPerks = allPendingPerks.filter(p => p.toolingId !== toolingId);
            filteredPendingPerks = filteredPendingPerks.filter(p => p.toolingId !== toolingId);
            setGlobalArray('pendingPerks', allPendingPerks);
            
            // Clear form if this perk was selected
            if (selectedPerkId === toolingId && isViewingPendingPerk) {
                clearPerkForm();
            }
            
            renderPendingPerkList();
        } else {
            alert('Error removing pending perk: ' + (result.message || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error removing pending perk:', error);
        alert('Error removing pending perk: ' + error.message);
    }
}

async function mergeApprovedPerks() {
    if (!confirm('Merge all approved pending perks into the game database?')) {
        return;
    }
    
    try {
        const token = await getCurrentAccessToken();
        if (!token) {
            alert('Authentication required');
            return;
        }
        
        const response = await fetch('http://localhost:8080/api/mergePerks', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert('Perks merged successfully!');
            await loadPerksAndEffects({ forceReload: true });
        } else {
            alert('Error merging perks: ' + (result.message || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error merging perks:', error);
        alert('Error merging perks: ' + error.message);
    }
}

// Asset Gallery Functions
function togglePerkAssetGallery() {
    const overlay = document.getElementById('perkAssetGalleryOverlay');
    if (overlay) {
        overlay.classList.toggle('hidden');
    }
}

function selectPerkAsset(assetId, iconUrl) {
    console.log('Selected perk asset:', assetId);
    
    perkSelectedAssetId = assetId;
    perkSelectedAssetIcon = iconUrl;
    
    document.getElementById('perkAssetID').value = assetId;
    
    const preview = document.getElementById('perkIconPreview');
    const placeholder = document.getElementById('perkIconPlaceholder');
    const assetIdDisplay = document.getElementById('perkAssetIDDisplay');
    
    if (preview) {
        preview.src = iconUrl;
        preview.style.display = 'block';
    }
    if (placeholder) {
        placeholder.style.display = 'none';
    }
    if (assetIdDisplay) {
        assetIdDisplay.textContent = `Asset ID: ${assetId}`;
    }
    
    togglePerkAssetGallery();
}

function updatePerkIconPreview(assetId) {
    const asset = perkAssets.find(a => a.assetID === assetId);
    const preview = document.getElementById('perkIconPreview');
    const placeholder = document.getElementById('perkIconPlaceholder');
    const assetIdDisplay = document.getElementById('perkAssetIDDisplay');
    
    if (asset) {
        if (preview) {
            preview.src = asset.icon;
            preview.style.display = 'block';
        }
        if (placeholder) {
            placeholder.style.display = 'none';
        }
        if (assetIdDisplay) {
            assetIdDisplay.textContent = `Asset ID: ${assetId}`;
        }
    } else {
        if (preview) {
            preview.src = '';
            preview.style.display = 'none';
        }
        if (placeholder) {
            placeholder.style.display = 'block';
        }
        if (assetIdDisplay) {
            assetIdDisplay.textContent = assetId ? `Asset ID: ${assetId} (not found)` : 'Asset ID: None';
        }
    }
}

function clearPerkIconPreview() {
    perkSelectedAssetId = null;
    perkSelectedAssetIcon = null;
    
    const preview = document.getElementById('perkIconPreview');
    const placeholder = document.getElementById('perkIconPlaceholder');
    const assetIdDisplay = document.getElementById('perkAssetIDDisplay');
    
    if (preview) {
        preview.src = '';
        preview.style.display = 'none';
    }
    if (placeholder) {
        placeholder.style.display = 'block';
    }
    if (assetIdDisplay) {
        assetIdDisplay.textContent = 'Asset ID: None';
    }
}

async function handlePerkIconUpload(file) {
    if (!file.type.startsWith('image/')) {
        alert('Please upload an image file');
        return;
    }

    if (file.size > 10 * 1024 * 1024) {
        alert('File size should be less than 10MB');
        return;
    }

    try {
        console.log('Converting perk icon to WebP format...');
        
        const webpBlob = await convertImageToWebP(file, 128, 128, 0.8);
        const base64Data = await blobToBase64(webpBlob);
        
        const nextAssetID = getNextAvailablePerkAssetID();
        console.log('Next available perk asset ID:', nextAssetID);
        
        const preview = document.getElementById('perkIconPreview');
        const placeholder = document.getElementById('perkIconPlaceholder');
        const assetIdDisplay = document.getElementById('perkAssetIDDisplay');
        
        if (preview) {
            preview.src = base64Data;
            preview.style.display = 'block';
        }
        if (placeholder) {
            placeholder.style.display = 'none';
        }
        if (assetIdDisplay) {
            assetIdDisplay.textContent = `Uploading... (Asset ID: ${nextAssetID})`;
        }
        
        const token = await getCurrentAccessToken();
        if (!token) {
            alert('Authentication required');
            return;
        }
        
        const response = await fetch('http://localhost:8080/api/uploadPerkAsset', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                assetID: nextAssetID,
                imageData: base64Data,
                contentType: 'image/webp'
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            console.log('✅ Perk asset uploaded successfully:', result);
            
            perkSelectedAssetId = result.assetID;
            perkSelectedAssetIcon = result.icon || base64Data;
            
            document.getElementById('perkAssetID').value = result.assetID;
            
            if (assetIdDisplay) {
                assetIdDisplay.textContent = `Asset ID: ${result.assetID}`;
            }
            
            perkAssets.push({
                assetID: result.assetID,
                name: result.assetID.toString(),
                icon: result.icon || base64Data
            });
            
            createPerkAssetGallery();
            
            alert('Perk icon uploaded successfully!');
        } else {
            alert('Error uploading icon: ' + (result.message || 'Unknown error'));
            clearPerkIconPreview();
        }
        
    } catch (error) {
        console.error('Error uploading perk icon:', error);
        alert('Failed to upload icon. Please try again.');
        clearPerkIconPreview();
    }
}

function getNextAvailablePerkAssetID() {
    if (!perkAssets || perkAssets.length === 0) {
        return 1;
    }
    
    let maxID = 0;
    for (const asset of perkAssets) {
        if (asset.assetID > maxID) {
            maxID = asset.assetID;
        }
    }
    
    return maxID + 1;
}

// Helper functions (reuse from item-designer if available)
function parseIntOrNull(value) {
    if (value === '' || value === null || value === undefined) {
        return null;
    }
    const parsed = parseInt(value);
    return isNaN(parsed) ? null : parsed;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Expose functions globally
window.selectPerk = selectPerk;
window.selectPendingPerk = selectPendingPerk;
window.togglePerkApproval = togglePerkApproval;
window.selectPerkAsset = selectPerkAsset;

// Export module for page navigation
window.perkDesigner = {
    loadPerksAndEffects: loadPerksAndEffects,
    initPerkDesigner: initPerkDesigner
};

console.log('🎭 Perk Designer script loaded');
