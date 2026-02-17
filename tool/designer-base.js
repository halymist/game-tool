// Designer Base Module
// Shared functionality for Item, Perk, and Enemy designers

const DesignerBase = {
    
    // ==================== TAB MANAGEMENT ====================
    
    /**
     * Setup tab switching functionality
     * @param {Object} config - Configuration object
     * @param {string} config.gameTabId - ID of game tab button
     * @param {string} config.pendingTabId - ID of pending tab button
     * @param {string} config.gameListId - ID of game list container
     * @param {string} config.pendingListId - ID of pending list container
     * @param {string} config.newBtnId - ID of new item button
     * @param {string} config.mergeBtnId - ID of merge button
     * @param {Function} config.onTabSwitch - Callback when tab switches
     */
    setupTabs(config) {
        const gameTab = document.getElementById(config.gameTabId);
        const pendingTab = document.getElementById(config.pendingTabId);
        
        if (gameTab) {
            gameTab.addEventListener('click', () => this.switchTab('game', config));
        }
        if (pendingTab) {
            pendingTab.addEventListener('click', () => this.switchTab('pending', config));
        }
    },
    
    switchTab(tab, config) {
        // Update tab buttons
        const gameTab = document.getElementById(config.gameTabId);
        const pendingTab = document.getElementById(config.pendingTabId);
        if (gameTab) gameTab.classList.toggle('active', tab === 'game');
        if (pendingTab) pendingTab.classList.toggle('active', tab === 'pending');
        
        // Show/hide lists
        const gameList = document.getElementById(config.gameListId);
        const pendingList = document.getElementById(config.pendingListId);
        if (gameList) gameList.style.display = tab === 'game' ? 'block' : 'none';
        if (pendingList) pendingList.style.display = tab === 'pending' ? 'block' : 'none';
        
        // Show/hide buttons
        const newBtn = document.getElementById(config.newBtnId);
        const mergeBtn = document.getElementById(config.mergeBtnId);
        if (newBtn) newBtn.style.display = tab === 'game' ? 'block' : 'none';
        if (mergeBtn) mergeBtn.style.display = tab === 'pending' ? 'block' : 'none';
        
        // Call custom callback
        if (config.onTabSwitch) {
            config.onTabSwitch(tab);
        }
    },
    
    // ==================== FORM LOCKING ====================
    
    /**
     * Lock/unlock a form for pending item viewing
     * @param {string} formId - ID of the form
     * @param {boolean} locked - Whether to lock the form
     * @param {string} saveBtnSelector - CSS selector for save button
     */
    setFormLocked(formId, locked, saveBtnSelector = '.btn-save') {
        const form = document.getElementById(formId);
        if (!form) return;
        
        const inputs = form.querySelectorAll('input, select, textarea');
        inputs.forEach(input => {
            input.disabled = locked;
        });
        
        const saveBtn = form.querySelector(saveBtnSelector);
        if (saveBtn) {
            saveBtn.style.display = locked ? 'none' : 'block';
        }
        
        form.classList.toggle('form-locked', locked);
    },
    
    // ==================== ASSET GALLERY ====================
    
    /**
     * Setup asset gallery functionality
     * @param {Object} config - Configuration object
     */
    setupAssetGallery(config) {
        const {
            galleryBtnId,
            closeBtnId,
            overlayId,
            uploadBtnId,
            fileInputId,
            iconUploadAreaId,
            onFileSelect
        } = config;
        
        // Gallery toggle button
        const galleryBtn = document.getElementById(galleryBtnId);
        if (galleryBtn) {
            galleryBtn.addEventListener('click', () => this.toggleAssetGallery(overlayId));
        }
        
        // Close button
        const closeBtn = document.getElementById(closeBtnId);
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.toggleAssetGallery(overlayId));
        }
        
        // Click overlay to close
        const overlay = document.getElementById(overlayId);
        if (overlay) {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    this.toggleAssetGallery(overlayId);
                }
            });
        }
        
        // Upload button
        const uploadBtn = document.getElementById(uploadBtnId);
        const fileInput = document.getElementById(fileInputId);
        if (uploadBtn && fileInput) {
            uploadBtn.addEventListener('click', () => fileInput.click());
        }
        
        // File input change
        if (fileInput && onFileSelect) {
            fileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) onFileSelect(file);
            });
        }
        
        // Icon upload area (click and drag-drop)
        const iconArea = document.getElementById(iconUploadAreaId);
        if (iconArea && fileInput) {
            iconArea.addEventListener('click', () => fileInput.click());
            
            iconArea.addEventListener('dragover', (e) => {
                e.preventDefault();
                iconArea.classList.add('drag-over');
            });
            
            iconArea.addEventListener('dragleave', () => {
                iconArea.classList.remove('drag-over');
            });
            
            iconArea.addEventListener('drop', (e) => {
                e.preventDefault();
                iconArea.classList.remove('drag-over');
                const file = e.dataTransfer.files[0];
                if (file && onFileSelect) onFileSelect(file);
            });
        }
    },
    
    toggleAssetGallery(overlayId) {
        const overlay = document.getElementById(overlayId);
        if (overlay) {
            overlay.classList.toggle('hidden');
        }
    },
    
    /**
     * Render asset gallery grid
     * @param {string} gridId - ID of the grid container
     * @param {Array} assets - Array of asset objects with assetID and icon
     * @param {Function} onSelect - Callback when asset is selected (assetId, iconUrl)
     */
    renderAssetGallery(gridId, assets, onSelect) {
        const grid = document.getElementById(gridId);
        if (!grid) return;
        
        if (!assets || assets.length === 0) {
            grid.innerHTML = '<p class="loading-text">No assets found. Upload a new one!</p>';
            return;
        }
        
        grid.innerHTML = assets.map(asset => `
            <div class="asset-item" onclick="(${onSelect.name})(${asset.assetID}, '${asset.icon}')">
                <img src="${asset.icon}" alt="Asset ${asset.assetID}">
                <span class="asset-id">${asset.assetID}</span>
            </div>
        `).join('');
    },
    
    // ==================== IMAGE PROCESSING ====================
    
    /**
     * Convert image file to WebP format
     * @param {File} file - Image file
     * @param {number} maxSize - Max width/height (default 256)
     * @returns {Promise<Blob>} - WebP blob
     */
    async convertImageToWebP(file, maxSize = 256) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            img.onload = () => {
                let width = img.width;
                let height = img.height;
                
                // Scale down if needed
                if (width > maxSize || height > maxSize) {
                    if (width > height) {
                        height = (height / width) * maxSize;
                        width = maxSize;
                    } else {
                        width = (width / height) * maxSize;
                        height = maxSize;
                    }
                }
                
                canvas.width = width;
                canvas.height = height;
                ctx.drawImage(img, 0, 0, width, height);
                
                canvas.toBlob(blob => {
                    if (blob) {
                        resolve(blob);
                    } else {
                        reject(new Error('Failed to convert to WebP'));
                    }
                }, 'image/webp', 0.9);
            };
            
            img.onerror = () => reject(new Error('Failed to load image'));
            img.src = URL.createObjectURL(file);
        });
    },
    
    /**
     * Convert blob to base64 string
     * @param {Blob} blob - Blob to convert
     * @returns {Promise<string>} - Base64 string
     */
    async blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    },
    
    /**
     * Get next available asset ID from assets array
     * @param {Array} assets - Array of asset objects with assetID
     * @returns {number} - Next available ID
     */
    getNextAssetID(assets) {
        if (!assets || assets.length === 0) return 1;
        return Math.max(...assets.map(a => a.assetID)) + 1;
    },
    
    // ==================== ICON PREVIEW ====================
    
    /**
     * Update icon preview
     * @param {Object} config - Configuration object
     */
    updateIconPreview(config) {
        const { previewId, placeholderId, assetDisplayId, iconUrl, assetId } = config;
        
        const preview = document.getElementById(previewId);
        const placeholder = document.getElementById(placeholderId);
        const assetDisplay = document.getElementById(assetDisplayId);
        
        if (iconUrl) {
            if (preview) {
                preview.src = iconUrl;
                preview.style.display = 'block';
            }
            if (placeholder) {
                placeholder.style.display = 'none';
            }
            if (assetDisplay) {
                assetDisplay.textContent = `Asset ID: ${assetId}`;
            }
        } else {
            if (preview) {
                preview.src = '';
                preview.style.display = 'none';
            }
            if (placeholder) {
                placeholder.style.display = 'block';
            }
            if (assetDisplay) {
                assetDisplay.textContent = assetId ? `Asset ID: ${assetId} (not found)` : 'Asset ID: None';
            }
        }
    },
    
    clearIconPreview(config) {
        const { previewId, placeholderId, assetDisplayId } = config;
        
        const preview = document.getElementById(previewId);
        const placeholder = document.getElementById(placeholderId);
        const assetDisplay = document.getElementById(assetDisplayId);
        
        if (preview) {
            preview.src = '';
            preview.style.display = 'none';
        }
        if (placeholder) {
            placeholder.style.display = 'block';
        }
        if (assetDisplay) {
            assetDisplay.textContent = 'Asset ID: None';
        }
    },
    
    // ==================== API HELPERS ====================
    
    /**
     * Make authenticated API request
     * @param {string} endpoint - API endpoint
     * @param {string} method - HTTP method
     * @param {Object} body - Request body (optional)
     * @returns {Promise<Object>} - Response data
     */
    async apiRequest(endpoint, method = 'GET', body = null) {
        const token = await getCurrentAccessToken();
        if (!token) {
            throw new Error('Authentication required');
        }
        
        const options = {
            method,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        };
        
        if (body) {
            options.body = JSON.stringify(body);
        }
        
        const response = await fetch(`http://localhost:8080${endpoint}`, options);
        return response.json();
    },
    
    /**
     * Toggle approval for a pending item
     * @param {string} endpoint - API endpoint (e.g., /api/toggleApproveItem)
     * @param {number} toolingId - Tooling ID
     * @param {boolean} approved - Approval status
     * @param {Function} onSuccess - Callback on success
     */
    async toggleApproval(endpoint, toolingId, approved, onSuccess) {
        try {
            const result = await this.apiRequest(endpoint, 'POST', { toolingId, approved });
            
            if (result.success) {
                console.log(`✅ Approval toggled for ${toolingId}`);
                if (onSuccess) onSuccess();
            } else {
                alert('Error toggling approval: ' + (result.message || 'Unknown error'));
            }
        } catch (error) {
            console.error('Error toggling approval:', error);
            alert('Error toggling approval: ' + error.message);
        }
    },
    
    /**
     * Merge approved pending items
     * @param {string} endpoint - API endpoint (e.g., /api/mergeItems)
     * @param {string} entityName - Name for confirmation message (e.g., "items")
     * @param {Function} onSuccess - Callback on success
     */
    async mergeApproved(endpoint, entityName, onSuccess) {
        if (!confirm(`Merge all approved pending ${entityName} into the game database?`)) {
            return;
        }
        
        try {
            const result = await this.apiRequest(endpoint, 'POST');
            
            if (result.success) {
                alert(`${entityName.charAt(0).toUpperCase() + entityName.slice(1)} merged successfully!`);
                if (onSuccess) onSuccess();
            } else {
                alert(`Error merging ${entityName}: ` + (result.message || 'Unknown error'));
            }
        } catch (error) {
            console.error(`Error merging ${entityName}:`, error);
            alert(`Error merging ${entityName}: ` + error.message);
        }
    },
    
    /**
     * Upload asset to S3
     * @param {string} endpoint - API endpoint (e.g., /api/uploadItemAsset)
     * @param {number} assetId - Asset ID
     * @param {string} base64Data - Base64 encoded image data
     * @returns {Promise<Object>} - Upload result
     */
    async uploadAsset(endpoint, assetId, base64Data) {
        return this.apiRequest(endpoint, 'POST', {
            assetID: assetId,
            imageData: base64Data,
            contentType: 'image/webp'
        });
    },
    
    // ==================== EFFECT DROPDOWNS ====================
    
    /**
     * Populate effect dropdowns
     * @param {Array} selectIds - Array of select element IDs
     * @param {Array} effects - Array of effect objects
     */
    populateEffectDropdowns(selectIds, effects) {
        const optionsHTML = '<option value="">-- No Effect --</option>' +
            effects.map(e => `<option value="${e.id}">${e.name}</option>`).join('');
        
        selectIds.forEach(id => {
            const select = document.getElementById(id);
            if (select) {
                select.innerHTML = optionsHTML;
            }
        });
    },
    
    /**
     * Update effect description display
     * @param {string} selectId - ID of the select element
     * @param {string} descId - ID of the description element
     * @param {Array} effects - Array of effect objects
     */
    updateEffectDescription(selectId, descId, effects) {
        const select = document.getElementById(selectId);
        const descSpan = document.getElementById(descId);
        if (!select || !descSpan) return;
        
        const effectId = parseInt(select.value);
        if (!effectId) {
            descSpan.textContent = 'Select an effect to see description';
            return;
        }
        
        const effect = effects.find(e => e.id === effectId);
        descSpan.textContent = effect?.description || 'No description available';
    },

    /**
     * Scroll a dropdown into view so the native popup opens downward
     * @param {HTMLSelectElement} element
     * @param {Object} options
     * @param {number} [options.buffer=160] - Minimum pixels required below element
     * @param {ScrollBehavior} [options.behavior='smooth']
     */
    ensureDropdownSpace(element, { buffer = 160, behavior = 'smooth' } = {}) {
        if (!element || typeof element.getBoundingClientRect !== 'function') {
            return;
        }
        const rect = element.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        if (spaceBelow >= buffer) {
            return;
        }
        element.scrollIntoView({ block: 'center', behavior });
    },

    /**
     * Attach listeners that ensure there's space for native dropdowns to open downward
     * @param {HTMLSelectElement} select - The select element to enhance
     * @param {Object} options - Options forwarded to ensureDropdownSpace
     */
    bindDropdownSpace(select, options) {
        if (!select || typeof this.ensureDropdownSpace !== 'function') {
            return;
        }
        if (select.dataset.dropdownSpaceBound === 'true') {
            return;
        }

        const handler = () => this.ensureDropdownSpace(select, options);
        const pointerEvent = (typeof window !== 'undefined' && window.PointerEvent) ? 'pointerdown' : 'mousedown';

        select.addEventListener(pointerEvent, handler, { passive: true });
        select.addEventListener('focus', handler);
        select.dataset.dropdownSpaceBound = 'true';
    },
    
    // ==================== UTILITIES ====================
    
    /**
     * Parse integer or return null
     * @param {*} value - Value to parse
     * @returns {number|null}
     */
    parseIntOrNull(value) {
        if (value === '' || value === null || value === undefined) {
            return null;
        }
        const parsed = parseInt(value);
        return isNaN(parsed) ? null : parsed;
    },
    
    /**
     * Escape HTML to prevent XSS
     * @param {string} text - Text to escape
     * @returns {string} - Escaped text
     */
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};

// Export for use in other scripts
window.DesignerBase = DesignerBase;

console.log('🔧 Designer Base module loaded');
