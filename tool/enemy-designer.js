// Enemy Designer JavaScript

class EnemyDesigner {
    constructor() {
        this.currentIcon = null;
        this.loadedEnemies = [];
        this.loadedEffects = [];
        this.currentEnemyData = null;
        this.init();
    }

    init() {
        this.setupIconUpload();
        this.setupFormHandlers();
        this.setupEnemyNameHandler();
        this.initializeEffectOptions();
        // loadEnemiesAndEffects() will be called when the enemy designer is opened
    }

    setupIconUpload() {
        const uploadArea = document.getElementById('iconUploadArea');
        const fileInput = document.getElementById('iconFile');
        const iconPreview = document.getElementById('iconPreview');

        // Click to upload
        uploadArea.addEventListener('click', () => {
            fileInput.click();
        });

        // File input change
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                this.handleFileUpload(file);
            }
        });

        // Drag and drop
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });

        uploadArea.addEventListener('dragleave', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.handleFileUpload(files[0]);
            }
        });
    }

    handleFileUpload(file) {
        // Validate file type
        if (!file.type.startsWith('image/')) {
            alert('Please upload an image file');
            return;
        }

        // Validate file size (max 5MB)
        if (file.size > 5 * 1024 * 1024) {
            alert('File size should be less than 5MB');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const iconPreview = document.getElementById('iconPreview');
            const uploadContent = document.querySelector('.upload-content');
            
            iconPreview.innerHTML = `<img src="${e.target.result}" alt="Enemy Icon">`;
            this.currentIcon = e.target.result;
            
            // Hide upload text when image is loaded
            if (uploadContent) {
                uploadContent.style.display = 'none';
            }
        };
        reader.readAsDataURL(file);
    }

    setupFormHandlers() {
        const form = document.getElementById('enemyForm');
        const saveBtn = document.getElementById('saveBtn');
        const resetBtn = document.getElementById('resetBtn');

        saveBtn.addEventListener('click', (e) => {
            e.preventDefault();
            this.saveEnemy();
        });

        resetBtn.addEventListener('click', (e) => {
            e.preventDefault();
            this.resetForm();
        });

        // Real-time validation
        const nameInput = document.getElementById('enemyName');
        nameInput.addEventListener('input', (e) => {
            this.validateName(e.target.value);
        });

        // Stats validation
        const statInputs = document.querySelectorAll('.stat-input');
        statInputs.forEach(input => {
            input.addEventListener('input', (e) => {
                this.validateStat(e.target);
            });
        });
    }

    setupEnemyNameHandler() {
        const nameInput = document.getElementById('enemyName');
        if (!nameInput) {
            console.error('Enemy name input not found');
            return;
        }

        console.log('Setting up enemy name handler');

        // Listen for when user types in the input
        nameInput.addEventListener('input', async (e) => {
            const inputValue = e.target.value;
            console.log('User typed:', inputValue);
            
            // Check if this matches an existing enemy exactly
            const existingEnemy = this.loadedEnemies.find(enemy => enemy.name === inputValue);
            
            if (existingEnemy) {
                console.log('Exact match found for existing enemy:', inputValue);
                await this.loadEnemyData(existingEnemy);
            } else {
                // User is typing a new name or modified an existing one
                if (this.currentEnemyData && this.currentEnemyData.name !== inputValue) {
                    console.log('Clearing current enemy data - user changed name from', this.currentEnemyData.name, 'to', inputValue);
                    this.currentEnemyData = null;
                }
            }
        });

        // Listen for selection from datalist (when user clicks on a suggestion)
        nameInput.addEventListener('change', async (e) => {
            const selectedValue = e.target.value;
            console.log('Input changed to:', selectedValue);
            
            const existingEnemy = this.loadedEnemies.find(enemy => enemy.name === selectedValue);
            
            if (existingEnemy) {
                console.log('Loading enemy from change event:', selectedValue);
                await this.loadEnemyData(existingEnemy);
            }
        });

        // Add focus event to help users discover the datalist
        nameInput.addEventListener('focus', (e) => {
            console.log('Name input focused, available enemies:', this.loadedEnemies.map(e => e.name));
            
            // Show a hint if there are loaded enemies
            if (this.loadedEnemies.length > 0) {
                const hint = document.querySelector('.input-hint');
                if (hint) {
                    hint.textContent = `💡 Available enemies: ${this.loadedEnemies.map(e => e.name).join(', ')}`;
                    setTimeout(() => {
                        hint.textContent = '💡 Start typing to see existing enemies, or enter a new name';
                    }, 3000);
                }
            }
        });
    }

    async loadEnemyData(enemy) {
        if (!enemy) return;

        console.log('Loading enemy data for:', enemy.name);
        this.currentEnemyData = enemy;

        // Load basic data
        document.getElementById('enemyName').value = enemy.name;
        
        // Load stats
        if (enemy.stats) {
            document.getElementById('strength').value = enemy.stats.strength || 0;
            document.getElementById('stamina').value = enemy.stats.stamina || 0;
            document.getElementById('agility').value = enemy.stats.agility || 0;
            document.getElementById('luck').value = enemy.stats.luck || 0;
            document.getElementById('armor').value = enemy.stats.armor || 0;
        }

        // Load effects
        if (enemy.effects && Array.isArray(enemy.effects)) {
            for (let i = 0; i < 10; i++) {
                const effect = enemy.effects[i];
                const effectSelect = document.getElementById(`effect${i + 1}`);
                const factorInput = document.getElementById(`factor${i + 1}`);

                if (effectSelect && factorInput) {
                    effectSelect.value = effect?.type || '';
                    factorInput.value = effect?.factor || 1;

                    // Trigger change event to update description
                    effectSelect.dispatchEvent(new Event('change'));
                }
            }
        }

        // Load icon
        if (enemy.iconUrl) {
            // Use the signed URL directly for display
            console.log('Loading icon for enemy:', enemy.name, 'URL:', enemy.iconUrl);
            this.currentIcon = enemy.iconUrl; // Store the signed URL temporarily
            const iconPreview = document.getElementById('iconPreview');
            const uploadContent = document.querySelector('.upload-content');
            
            // Create img element without crossorigin to avoid CORS issues
            iconPreview.innerHTML = `<img src="${enemy.iconUrl}" alt="Enemy Icon" style="width: 100%; height: 100%; object-fit: cover;">`;
            
            if (uploadContent) {
                uploadContent.style.display = 'none';
            }
            
            console.log('Icon loaded successfully for:', enemy.name);
        } else if (enemy.iconKey) {
            // Fallback: try to get signed URL if we only have the key
            console.log('Loading icon for enemy:', enemy.name, 'Key:', enemy.iconKey);
            try {
                const signedUrl = await this.getSignedUrl(enemy.iconKey);
                if (signedUrl) {
                    this.currentIcon = signedUrl;
                    const iconPreview = document.getElementById('iconPreview');
                    const uploadContent = document.querySelector('.upload-content');
                    
                    // Create img element without crossorigin to avoid CORS issues
                    iconPreview.innerHTML = `<img src="${signedUrl}" alt="Enemy Icon" style="width: 100%; height: 100%; object-fit: cover;">`;
                    
                    if (uploadContent) {
                        uploadContent.style.display = 'none';
                    }
                    
                    console.log('Icon loaded successfully for:', enemy.name);
                } else {
                    console.warn('Could not get signed URL for enemy:', enemy.name);
                }
            } catch (error) {
                console.error('Error loading enemy icon:', error);
            }
        }

        console.log('Enemy data loaded successfully for:', enemy.name);
    }

    resetForm() {
        // Clear current enemy data
        this.currentEnemyData = null;
        this.currentIcon = null;

        // Reset form fields
        document.getElementById('enemyName').value = '';
        document.getElementById('strength').value = '0';
        document.getElementById('stamina').value = '0';
        document.getElementById('agility').value = '0';
        document.getElementById('luck').value = '0';
        document.getElementById('armor').value = '0';

        // Reset effects
        for (let i = 1; i <= 10; i++) {
            const effectSelect = document.getElementById(`effect${i}`);
            const factorInput = document.getElementById(`factor${i}`);
            const descriptionSpan = document.getElementById(`description${i}`);

            if (effectSelect) effectSelect.value = '';
            if (factorInput) factorInput.value = '1';
            if (descriptionSpan) descriptionSpan.textContent = '';
        }

        // Reset icon
        const iconPreview = document.getElementById('iconPreview');
        const uploadContent = document.querySelector('.upload-content');
        const fileInput = document.getElementById('iconFile');

        if (iconPreview) iconPreview.innerHTML = '';
        if (uploadContent) uploadContent.style.display = 'block';
        if (fileInput) fileInput.value = '';

        // Clear validation styles
        document.querySelectorAll('.error').forEach(el => el.classList.remove('error'));
        document.querySelectorAll('.stat-input').forEach(input => {
            input.style.borderColor = '#ddd';
        });

        console.log('Form reset');
    }

    initializeEffectOptions() {
        // Initialize empty effect dropdowns only if they don't already have options
        for (let i = 1; i <= 10; i++) {
            const select = document.getElementById(`effect${i}`);
            if (select && select.children.length === 0) {
                // Add default placeholder option only if dropdown is empty
                const defaultOption = document.createElement('option');
                defaultOption.value = '';
                defaultOption.textContent = 'Loading effects...';
                defaultOption.disabled = true;
                defaultOption.selected = true;
                select.appendChild(defaultOption);
            }
        }
        console.log('Effect dropdowns initialized - waiting for server data');
    }

    validateName(name) {
        const nameGroup = document.getElementById('enemyName').parentElement;
        if (name.length < 2) {
            nameGroup.classList.add('error');
            return false;
        } else {
            nameGroup.classList.remove('error');
            return true;
        }
    }

    validateStat(input) {
        const value = parseInt(input.value);
        if (isNaN(value) || value < 0 || value > 999) {
            input.style.borderColor = '#dc3545';
            return false;
        } else {
            input.style.borderColor = '#ddd';
            return true;
        }
    }

    collectFormData() {
        const formData = {
            name: document.getElementById('enemyName').value,
            icon: this.currentIcon,
            stats: {
                strength: parseInt(document.getElementById('strength').value) || 0,
                stamina: parseInt(document.getElementById('stamina').value) || 0,
                agility: parseInt(document.getElementById('agility').value) || 0,
                luck: parseInt(document.getElementById('luck').value) || 0,
                armor: parseInt(document.getElementById('armor').value) || 0
            },
            effects: []
        };

        // Collect all 10 effects (including empty ones to preserve order)
        for (let i = 1; i <= 10; i++) {
            const effectElement = document.getElementById(`effect${i}`);
            const factorElement = document.getElementById(`factor${i}`);
            
            if (!effectElement) {
                console.warn(`Effect dropdown ${i} not found!`);
                formData.effects.push({ type: "", factor: 1 });
                continue;
            }
            
            if (!factorElement) {
                console.warn(`Factor input ${i} not found!`);
                formData.effects.push({ type: "", factor: 1 });
                continue;
            }
            
            const effectValue = effectElement.value;
            const factorValue = parseInt(factorElement.value) || 1;
            
            formData.effects.push({
                type: effectValue, // Will be empty string if no effect selected
                factor: factorValue
            });
        }

        return formData;
    }

    validateForm() {
        const formData = this.collectFormData();
        const errors = [];

        // Name validation
        if (!formData.name || formData.name.length < 2) {
            errors.push('Enemy name must be at least 2 characters long');
        }

        // Icon validation
        if (!formData.icon) {
            errors.push('Please upload an enemy icon');
        }

        // Stats validation
        const statNames = ['strength', 'stamina', 'agility', 'luck', 'armor'];
        statNames.forEach(stat => {
            if (formData.stats[stat] < 0 || formData.stats[stat] > 999) {
                errors.push(`${stat.charAt(0).toUpperCase() + stat.slice(1)} must be between 0 and 999`);
            }
        });

        return errors;
    }

    saveEnemy() {
        const errors = this.validateForm();
        
        if (errors.length > 0) {
            alert('Please fix the following errors:\n' + errors.join('\n'));
            return;
        }

        const enemyData = this.collectFormData();
        
        // Determine if this is an update or create operation
        const isUpdate = this.currentEnemyData && this.currentEnemyData.id;
        
        if (isUpdate) {
            console.log('=== UPDATING EXISTING ENEMY ===');
            console.log('Original enemy:', this.currentEnemyData.name);
            
            // Check if image has changed
            const imageChanged = this.hasImageChanged();
            enemyData.imageChanged = imageChanged;
            
            if (!imageChanged) {
                // Preserve the original asset ID for updates without image changes
                enemyData.assetID = this.currentEnemyData.assetID;
                enemyData.icon = null; // Don't send icon data if not changed
            }
            
            console.log('Image changed:', imageChanged);
            console.log('Using assetID:', enemyData.assetID);
            
            this.sendToServer(enemyData, 'update');
        } else {
            console.log('=== CREATING NEW ENEMY ===');
            this.sendToServer(enemyData, 'create');
        }
    }

    hasImageChanged() {
        // If we don't have current enemy data, this is a new enemy
        if (!this.currentEnemyData) {
            return true;
        }
        
        // If currentIcon is base64 data (starts with 'data:'), then it's a new image
        if (this.currentIcon && this.currentIcon.startsWith('data:')) {
            return true;
        }
        
        // If currentIcon is a signed URL (starts with 'https://'), then it's the same image
        if (this.currentIcon && this.currentIcon.startsWith('https://')) {
            return false;
        }
        
        // If no icon at all, consider it changed (should not happen in valid form)
        return true;
    }

    async sendToServer(enemyData, operation) {
        try {
            // Get current access token
            const token = await getCurrentAccessToken();
            if (!token) {
                alert('Authentication required. Please log in again.');
                return;
            }

            // Show loading state
            const saveBtn = document.getElementById('saveBtn');
            const originalText = saveBtn.textContent;
            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving...';

            // Determine endpoint based on operation
            const endpoint = operation === 'create' ? 
                'http://localhost:8080/api/createEnemy' : 
                'http://localhost:8080/api/updateEnemy';

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(enemyData)
            });

            if (response.ok) {
                const result = await response.json();
                const action = operation === 'create' ? 'created' : 'updated';
                alert(`Enemy ${action} successfully!`);
                console.log('Server response:', result);
                
                // If this was a new enemy, we might want to reload the data to get the updated list
                if (operation === 'create') {
                    console.log('New enemy created, consider reloading enemy list');
                    // Optionally reload the enemies and effects data
                    // this.loadEnemiesAndEffects();
                }
                
                // Optional: Reset form after successful save
                // this.resetForm();
            } else {
                const error = await response.text();
                alert(`Failed to ${operation} enemy: ${error}`);
                console.error(`${operation} failed:`, error);
            }

        } catch (error) {
            console.error(`Error ${operation}ing enemy:`, error);
            alert(`Error ${operation}ing enemy. Please try again.`);
        } finally {
            // Restore button state
            const saveBtn = document.getElementById('saveBtn');
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save Enemy';
        }
    }

    // Force reload data from server (useful after saving new enemies)
    async forceReloadEnemiesAndEffects() {
        this.loadedEffects = [];
        this.loadedEnemies = [];
        await this.loadEnemiesAndEffects();
    }

    async loadEnemiesAndEffects() {
        try {
            // Skip loading if data is already loaded and effects are already populated
            if (this.loadedEffects.length > 0 && this.loadedEnemies.length > 0) {
                console.log('Data already loaded, skipping reload');
                return;
            }

            // Get current access token
            const token = await getCurrentAccessToken();
            if (!token) {
                console.error('Authentication required. Please log in again.');
                return;
            }

            console.log('Loading enemies and effects...');

            const response = await fetch('http://localhost:8080/api/getEnemies', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const data = await response.json();
                console.log('=== ENEMIES AND EFFECTS DATA ===');
                console.log('Success:', data.success);
                console.log('Enemies:', data.enemies);
                console.log('Effects:', data.effects);
                
                // Store the loaded data
                this.loadedEffects = data.effects || [];
                this.loadedEnemies = data.enemies || [];
                
                // Populate effect dropdowns with server data
                if (this.loadedEffects.length > 0) {
                    this.populateEffectDropdowns(this.loadedEffects);
                }
                
                // Populate enemy name datalist
                if (this.loadedEnemies.length > 0) {
                    this.populateEnemyDatalist(this.loadedEnemies);
                }
                
                // Process enemy images (server now provides signed URLs)
                if (this.loadedEnemies.length > 0) {
                    console.log('Processing enemy images...');
                    for (const enemy of this.loadedEnemies) {
                        if (enemy.iconUrl) {
                            console.log(`Enemy ${enemy.name} has signed image URL: ${enemy.iconUrl}`);
                        } else if (enemy.iconKey) {
                            console.log(`Enemy ${enemy.name} has iconKey but no signed URL: ${enemy.iconKey}`);
                        } else {
                            console.log(`Enemy ${enemy.name} has no icon`);
                        }
                    }
                }
                
            } else {
                const error = await response.text();
                console.error('Failed to load data:', error);
            }

        } catch (error) {
            console.error('Error loading enemies and effects:', error);
        }
    }

    // Helper function to get signed URL for an S3 key
    async getSignedUrl(key) {
        try {
            const token = await getCurrentAccessToken();
            if (!token) {
                console.error('Authentication required for signed URL request.');
                return null;
            }

            const response = await fetch('http://localhost:8080/api/getSignedUrl', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ key: key })
            });

            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    return data.url;
                } else {
                    console.error('Failed to get signed URL:', data);
                    return null;
                }
            } else {
                const error = await response.text();
                console.error('Failed to get signed URL:', error);
                return null;
            }
        } catch (error) {
            console.error('Error getting signed URL:', error);
            return null;
        }
    }

    // Helper function to load an image from S3 using signed URL
    // NOTE: This function is currently not used due to CORS issues with canvas
    // The image is displayed directly using the signed URL instead
    async loadImageFromS3(iconKey) {
        if (!iconKey) {
            return null;
        }

        try {
            const signedUrl = await this.getSignedUrl(iconKey);
            if (!signedUrl) {
                console.error('Could not get signed URL for key:', iconKey);
                return null;
            }

            // For now, just return the signed URL instead of converting to base64
            // The canvas conversion causes CORS issues with S3 signed URLs
            return signedUrl;

            // The following code would be used if we had proper CORS setup:
            /*
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.crossOrigin = 'anonymous'; // This requires CORS headers from S3
                img.onload = function() {
                    try {
                        const canvas = document.createElement('canvas');
                        const ctx = canvas.getContext('2d');
                        canvas.width = img.width;
                        canvas.height = img.height;
                        ctx.drawImage(img, 0, 0);
                        const dataURL = canvas.toDataURL('image/png');
                        resolve(dataURL);
                    } catch (error) {
                        console.error('Canvas conversion failed:', error);
                        reject(error);
                    }
                };
                img.onerror = function() {
                    console.error('Failed to load image from:', signedUrl);
                    reject(new Error('Failed to load image'));
                };
                img.src = signedUrl;
            });
            */
        } catch (error) {
            console.error('Error loading image from S3:', error);
            return null;
        }
    }

    // Populate effect dropdowns with data from server
    populateEffectDropdowns(effects) {
        // Add a "None" option and effects from server
        const effectOptions = [
            { id: null, name: "None", description: "No effect applied" },
            ...effects
        ];

        // Update all effect dropdowns (1-10)
        for (let i = 1; i <= 10; i++) {
            const select = document.getElementById(`effect${i}`);
            if (select) {
                // Store current selection before clearing
                const currentValue = select.value;
                
                // Clear existing options
                select.innerHTML = '';
                
                // Add options
                effectOptions.forEach(effect => {
                    const option = document.createElement('option');
                    option.value = effect.id || '';
                    option.textContent = effect.name;
                    option.dataset.description = effect.description || '';
                    select.appendChild(option);
                });

                // Restore previous selection if it still exists
                if (currentValue && select.querySelector(`option[value="${currentValue}"]`)) {
                    select.value = currentValue;
                    // Trigger change event to update description
                    select.dispatchEvent(new Event('change'));
                } else {
                    // Set to default (None)
                    select.value = '';
                }

                // Update description when selection changes (remove existing listeners first)
                const newSelect = select.cloneNode(true);
                select.parentNode.replaceChild(newSelect, select);
                
                newSelect.addEventListener('change', (e) => {
                    const description = e.target.selectedOptions[0]?.dataset.description || '';
                    const descriptionSpan = document.getElementById(`description${i}`);
                    if (descriptionSpan) {
                        descriptionSpan.textContent = description;
                    }
                });
            }
        }

        console.log('Effect dropdowns populated with', effects.length, 'effects');
    }

    // Populate enemy name datalist with existing enemies
    populateEnemyDatalist(enemies) {
        const datalist = document.getElementById('existingEnemies');
        if (datalist) {
            console.log('Found datalist element, populating with enemies:', enemies);
            
            // Clear existing options
            datalist.innerHTML = '';
            
            // Add enemy options
            enemies.forEach(enemy => {
                const option = document.createElement('option');
                option.value = enemy.name;
                option.textContent = enemy.name;
                datalist.appendChild(option);
                console.log('Added enemy option:', enemy.name);
            });

            console.log('Enemy datalist populated with', enemies.length, 'enemies');
            console.log('Datalist now has', datalist.children.length, 'options');
        } else {
            console.error('Could not find datalist with id "existingEnemies"');
        }
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    // Only initialize if we're on the enemy designer page
    if (document.getElementById('enemyForm')) {
        window.enemyDesigner = new EnemyDesigner();
    }
});
