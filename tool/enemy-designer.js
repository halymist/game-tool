// Enemy Designer JavaScript

// === DATA STRUCTURE DEFINITIONS ===
// These match the server-side Go structs

// EnemyMessage structure for victory/defeat messages
const EnemyMessage = {
    create: (type, message) => ({
        type: type,      // "onWin" or "onLose" - JSON: "type"
        message: message // The actual message text - JSON: "message"
    })
};

// Enemy Stats structure
const EnemyStats = {
    create: () => ({
        strength: 0,  // JSON: "strength"
        stamina: 0,   // JSON: "stamina"
        agility: 0,   // JSON: "agility"
        luck: 0,      // JSON: "luck"
        armor: 0      // JSON: "armor"
    })
};

// Enemy Effect structure
const EnemyEffect = {
    create: (type = 0, factor = 1) => ({
        type: type,     // Effect type ID (0 for empty, otherwise integer) - JSON: "type"
        factor: factor  // Effect factor (default: 1) - JSON: "factor"
    })
};

// Main Enemy structure (matches Go struct with JSON field names)
const Enemy = {
    create: () => ({
        id: null,              // Optional, set by database - JSON: "id,omitempty"
        name: "",              // Enemy name - JSON: "name"
        description: "",       // Enemy description - JSON: "description"
        stats: EnemyStats.create(),      // Enemy stats object - JSON: "stats"
        effects: [],           // Array of up to 10 effects - JSON: "effects"
        icon: null,            // Base64 image data or signed URL - JSON: "icon,omitempty"
        assetID: 0,            // Asset ID for existing images - JSON: "assetID,omitempty"
        messages: []           // Array of victory/defeat messages - JSON: "messages,omitempty"
    }),
    
    // Load data from form into Enemy struct
    loadFromForm: () => {
        const enemy = Enemy.create();
        
        // === POPULATE BASIC ENEMY INFORMATION ===
        enemy.name = document.getElementById('enemyName').value;
        enemy.description = document.getElementById('enemyDescription').value;
        
        // Handle icon - currentIcon should always be base64 data now
        enemy.icon = currentIcon; // This is always base64 data (either new upload or fetched from S3)
        
        // If currentAssetID is set, it means we're reusing an existing asset
        if (currentAssetID > 0) {
            enemy.assetID = currentAssetID; // Set the asset ID for reusing existing assets
            console.log('Reusing existing asset with ID:', currentAssetID, 'sending as base64 data');
        } else {
            console.log('Using new uploaded image as base64 data');
        }
        
        // === POPULATE ENEMY STATS ===
        enemy.stats.strength = parseInt(document.getElementById('strength').value) || 0;
        enemy.stats.stamina = parseInt(document.getElementById('stamina').value) || 0;
        enemy.stats.agility = parseInt(document.getElementById('agility').value) || 0;
        enemy.stats.luck = parseInt(document.getElementById('luck').value) || 0;
        enemy.stats.armor = parseInt(document.getElementById('armor').value) || 0;

        // === POPULATE ENEMY EFFECTS (up to 10 effects) ===
        enemy.effects = [];
        for (let i = 1; i <= 10; i++) {
            const effectElement = document.getElementById(`effect${i}`);
            const factorElement = document.getElementById(`factor${i}`);
            
            if (!effectElement || !factorElement) {
                enemy.effects.push(EnemyEffect.create(0, 1)); // Use 0 for empty effects
                continue;
            }
            
            const effectValue = effectElement.value || "";
            const factorValue = parseInt(factorElement.value) || 1;
            
            // Convert empty string to 0 for database compatibility
            const effectType = effectValue === "" ? 0 : parseInt(effectValue) || 0;
            
            enemy.effects.push(EnemyEffect.create(effectType, factorValue));
        }

        // === POPULATE VICTORY/DEFEAT MESSAGES ===
        enemy.messages = [];
        
        // Collect victory messages (onWin type)
        const victoryTextareas = document.querySelectorAll('#victory-messages-list .message-textarea');
        victoryTextareas.forEach(textarea => {
            const messageText = textarea.value.trim();
            if (messageText) {
                enemy.messages.push(EnemyMessage.create('onWin', messageText));
            }
        });

        // Collect defeat messages (onLose type)  
        const defeatTextareas = document.querySelectorAll('#defeat-messages-list .message-textarea');
        defeatTextareas.forEach(textarea => {
            const messageText = textarea.value.trim();
            if (messageText) {
                enemy.messages.push(EnemyMessage.create('onLose', messageText));
            }
        });

        // === LOG COLLECTED DATA FOR DEBUGGING ===
        console.log('=== LOADED ENEMY DATA FROM FORM ===');
        console.log('Name:', enemy.name);
        console.log('Description:', enemy.description);
        console.log('Stats:', enemy.stats);
        console.log('Effects (total):', enemy.effects.length);
        console.log('Active Effects:', enemy.effects.filter(e => e.type).length);
        console.log('Victory Messages:', enemy.messages.filter(m => m.type === 'onWin').length);
        console.log('Defeat Messages:', enemy.messages.filter(m => m.type === 'onLose').length);
        console.log('Total Messages:', enemy.messages.length);
        console.log('Full Enemy Struct:', enemy);

        return enemy;
    }
};

// === GLOBAL VARIABLES ===
let currentIcon = null;
let currentAssetID = 0; // Track selected existing asset ID
let loadedEnemies = [];
let loadedEffects = [];
let currentEnemyData = null;

// === FUNCTIONS ===

function setupMessageHandlers() {
    // Victory
    const victoryList = document.getElementById('victory-messages-list');
    const addVictoryBtn = document.getElementById('add-victory-message');
    addVictoryBtn.addEventListener('click', () => addMessageField(victoryList, 'victory'));
    // Defeat
    const defeatList = document.getElementById('defeat-messages-list');
    const addDefeatBtn = document.getElementById('add-defeat-message');
    addDefeatBtn.addEventListener('click', () => addMessageField(defeatList, 'defeat'));
    // Add one field by default if empty
    if (victoryList.children.length === 0) addMessageField(victoryList, 'victory');
    if (defeatList.children.length === 0) addMessageField(defeatList, 'defeat');
}

function addMessageField(listElem, type, value = '') {
    const template = document.getElementById('message-field-template');
    if (!template) {
        console.error('Message field template not found');
        return;
    }
    
    const clone = template.content.cloneNode(true);
    const textarea = clone.querySelector('.message-textarea');
    textarea.placeholder = type === 'victory' ? 'Victory message...' : 'Defeat message...';
    textarea.value = value;
    
    listElem.appendChild(clone);
}

function setupIconUpload() {
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
            handleFileUpload(file);
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
            handleFileUpload(files[0]);
        }
    });
}

// Convert image to WebP format at 256x256 with 70% quality
async function convertImageToWebP(file, maxSize = 256, quality = 0.7) {
    return new Promise((resolve, reject) => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const img = new Image();
        
        img.onload = () => {
            // Set canvas to desired size
            canvas.width = maxSize;
            canvas.height = maxSize;
            
            // Clear canvas with transparent background
            ctx.clearRect(0, 0, maxSize, maxSize);
            
            // Calculate scaling to maintain aspect ratio while fitting in square
            const scale = Math.min(maxSize / img.width, maxSize / img.height);
            const scaledWidth = img.width * scale;
            const scaledHeight = img.height * scale;
            
            // Center the image in the canvas
            const x = (maxSize - scaledWidth) / 2;
            const y = (maxSize - scaledHeight) / 2;
            
            // Draw and resize image
            ctx.drawImage(img, x, y, scaledWidth, scaledHeight);
            
            // Convert to WebP with quality compression
            canvas.toBlob(
                (blob) => {
                    if (blob) {
                        resolve(blob);
                    } else {
                        reject(new Error('Failed to convert image to WebP'));
                    }
                }, 
                'image/webp', 
                quality
            );
        };
        
        img.onerror = () => {
            reject(new Error('Failed to load image'));
        };
        
        img.src = URL.createObjectURL(file);
    });
}

async function handleFileUpload(file) {
    // Validate file type
    if (!file.type.startsWith('image/')) {
        alert('Please upload an image file');
        return;
    }

    // Validate file size (max 10MB for original file)
    if (file.size > 10 * 1024 * 1024) {
        alert('File size should be less than 10MB');
        return;
    }

    try {
        console.log('Converting image to WebP format...');
        console.log('Original file:', file.name, 'Size:', (file.size / 1024).toFixed(2) + 'KB');
        
        // Convert to WebP 256x256 with 70% quality
        const webpBlob = await convertImageToWebP(file, 256, 0.7);
        console.log('WebP converted size:', (webpBlob.size / 1024).toFixed(2) + 'KB');
        console.log('Compression ratio:', ((1 - webpBlob.size / file.size) * 100).toFixed(1) + '% reduction');
        
        // Convert WebP blob to base64 for storage
        const reader = new FileReader();
        reader.onload = (e) => {
            const iconPreview = document.getElementById('iconPreview');
            const uploadContent = document.querySelector('.upload-content');
            
            // Store the WebP base64 data
            currentIcon = e.target.result;
            currentAssetID = 0; // Clear any selected existing asset
            
            // Show preview
            iconPreview.innerHTML = `<img src="${e.target.result}" alt="Enemy Icon" style="width: 100%; height: 100%; object-fit: stretch;">`;
            
            // Hide upload text when image is loaded
            if (uploadContent) {
                uploadContent.style.display = 'none';
            }
            
            console.log('✅ WebP image ready for upload (256x256, 70% quality)');
        };
        
        reader.onerror = () => {
            alert('Failed to process converted image');
        };
        
        reader.readAsDataURL(webpBlob);
        
    } catch (error) {
        console.error('Error converting image:', error);
        alert('Failed to convert image. Please try a different image.');
    }
}

function setupFormHandlers() {
    const form = document.getElementById('enemyForm');
    const saveBtn = document.getElementById('saveBtn');
    const resetBtn = document.getElementById('resetBtn');

    saveBtn.addEventListener('click', (e) => {
        e.preventDefault();
        saveEnemy();
    });

    resetBtn.addEventListener('click', (e) => {
        e.preventDefault();
        resetForm();
    });

    // Real-time validation
    const nameInput = document.getElementById('enemyName');
    nameInput.addEventListener('input', (e) => {
        validateName(e.target.value);
    });

    // Stats validation
    const statInputs = document.querySelectorAll('.stat-input');
    statInputs.forEach(input => {
        input.addEventListener('input', (e) => {
            validateStat(e.target);
        });
    });
}

function setupEnemyNameHandler() {
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
        const enemies = getEnemies(); // Get enemies from global data
        const existingEnemy = enemies.find(enemy => enemy.name === inputValue);
        
        if (existingEnemy) {
            console.log('Exact match found for existing enemy:', inputValue);
            await selectExistingEnemy(existingEnemy);
        }
    });

    // Listen for selection from datalist (when user clicks on a suggestion)
    nameInput.addEventListener('change', async (e) => {
        const selectedValue = e.target.value;
        console.log('Input changed to:', selectedValue);
        
        const enemies = getEnemies(); // Get enemies from global data
        const existingEnemy = enemies.find(enemy => enemy.name === selectedValue);
        
        if (existingEnemy) {
            console.log('Loading enemy from change event:', selectedValue);
            await selectExistingEnemy(existingEnemy);
        }
    });

    // Add focus event to help users discover the datalist
    nameInput.addEventListener('focus', (e) => {
        console.log('Name input focused');
        
        // Show a hint if there are loaded enemies
        const enemies = getEnemies();
        if (enemies.length > 0) {
            const hint = document.querySelector('.input-hint');
            if (hint) {
                hint.textContent = `💡 Available enemies: ${enemies.map(e => e.name).join(', ')}`;
                setTimeout(() => {
                    hint.textContent = '💡 Start typing to see existing enemies, or enter a new name';
                }, 3000);
            }
        }
    });
}

function resetForm() {
    // Clear current enemy data
    currentEnemyData = null;
    currentIcon = null;
    currentAssetID = 0; // Clear selected asset ID

    // Reset form fields
    document.getElementById('enemyName').value = '';
    document.getElementById('enemyDescription').value = '';
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

    // Reset messages
    document.getElementById('victory-messages-list').innerHTML = '';
    document.getElementById('defeat-messages-list').innerHTML = '';
    addMessageField(document.getElementById('victory-messages-list'), 'victory');
    addMessageField(document.getElementById('defeat-messages-list'), 'defeat');

    // Clear validation styles
    document.querySelectorAll('.error').forEach(el => el.classList.remove('error'));
    document.querySelectorAll('.stat-input').forEach(input => {
        input.style.borderColor = '#ddd';
    });

    console.log('Form reset');
}

function initializeEffectOptions() {
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

function validateName(name) {
    const nameGroup = document.getElementById('enemyName').parentElement;
    if (name.length < 2) {
        nameGroup.classList.add('error');
        return false;
    } else {
        nameGroup.classList.remove('error');
        return true;
    }
}

function validateStat(input) {
    const value = parseInt(input.value);
    if (isNaN(value) || value < 0 || value > 999) {
        input.style.borderColor = '#dc3545';
        return false;
    } else {
        input.style.borderColor = '#ddd';
        return true;
    }
}

function validateForm() {
    const enemy = Enemy.loadFromForm();
    const errors = [];

    // === BASIC INFORMATION VALIDATION ===
    // Name validation
    if (!enemy.name || enemy.name.length < 2) {
        errors.push('Enemy name must be at least 2 characters long');
    }

    // Description validation (optional but recommended)
    if (enemy.description && enemy.description.length > 1000) {
        errors.push('Enemy description must be less than 1000 characters');
    }

    // Icon validation
    if (!enemy.icon) {
        errors.push('Please upload an enemy icon');
    }

    // === STATS VALIDATION ===
    const statNames = ['strength', 'stamina', 'agility', 'luck', 'armor'];
    statNames.forEach(stat => {
        if (enemy.stats[stat] < 0 || enemy.stats[stat] > 999) {
            errors.push(`${stat.charAt(0).toUpperCase() + stat.slice(1)} must be between 0 and 999`);
        }
    });

    // === EFFECTS VALIDATION ===
    const activeEffects = enemy.effects.filter(effect => effect.type);
    if (activeEffects.length > 10) {
        errors.push('Maximum 10 effects allowed per enemy');
    }

    // Validate effect factors
    activeEffects.forEach((effect, index) => {
        if (effect.factor < 0.1 || effect.factor > 10) {
            errors.push(`Effect ${index + 1} factor must be between 0.1 and 10`);
        }
    });

    // === MESSAGES VALIDATION ===
    const totalMessages = enemy.messages.length;
    if (totalMessages > 20) {
        errors.push('Maximum 20 total messages allowed (victory + defeat)');
    }

    // Validate message lengths
    enemy.messages.forEach((messageObj, index) => {
        if (messageObj.message.length > 500) {
            errors.push(`Message ${index + 1} must be less than 500 characters`);
        }
    });

    return errors;
}

function saveEnemy() {
    // === FORM VALIDATION ===
    const errors = validateForm();
    
    if (errors.length > 0) {
        alert('Please fix the following errors:\n' + errors.join('\n'));
        return;
    }

    // === LOAD FORM DATA INTO ENEMY STRUCT ===
    const enemy = Enemy.loadFromForm();
    
    // === DETERMINE OPERATION TYPE ===
    const isUpdate = currentEnemyData && currentEnemyData.id;
    
    if (isUpdate) {
        console.log('=== UPDATING EXISTING ENEMY ===');
        console.log('Original enemy:', currentEnemyData.name);
        console.log('Updated enemy name:', enemy.name);
        console.log('Updated description:', enemy.description);
        console.log('Updated messages count:', enemy.messages.length);
        
        // For updates, we can infer image changes based on assetID
        if (currentAssetID > 0 && currentAssetID !== currentEnemyData.assetID) {
            console.log('Image changed - using different asset:', currentAssetID, 'vs original:', currentEnemyData.assetID);
            enemy.assetID = currentAssetID;
        } else if (currentAssetID === 0) {
            console.log('Image changed - new upload detected');
            // New upload, assetID will be 0
        } else {
            console.log('Image unchanged - preserving assetID:', currentEnemyData.assetID);
            enemy.assetID = currentEnemyData.assetID;
            enemy.icon = null; // Don't send icon data if not changed
        }
        
        sendToServer(enemy, 'update');
    } else {
        console.log('=== CREATING NEW ENEMY ===');
        console.log('Enemy name:', enemy.name);
        console.log('Enemy description:', enemy.description);
        console.log('Enemy stats:', enemy.stats);
        console.log('Active effects:', enemy.effects.filter(e => e.type).length);
        console.log('Total messages:', enemy.messages.length);
        console.log('Victory messages:', enemy.messages.filter(m => m.type === 'onWin').length);
        console.log('Defeat messages:', enemy.messages.filter(m => m.type === 'onLose').length);
        
        sendToServer(enemy, 'create');
    }
}

async function sendToServer(enemy, operation) {
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

        console.log('=== SENDING ENEMY STRUCT TO SERVER ===');
        console.log('Enemy struct being sent:', enemy);

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(enemy)
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
                // loadEnemiesAndEffects();
            }
            
            resetForm();
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
async function forceReloadEnemiesAndEffects() {
    loadedEffects = [];
    loadedEnemies = [];
    await loadEnemiesAndEffects();
}

async function loadEnemiesAndEffects() {
    try {
        // Skip loading if data is already loaded and effects are already populated
        if (loadedEffects.length > 0 && loadedEnemies.length > 0) {
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
            loadedEffects = data.effects || [];
            loadedEnemies = data.enemies || [];
            
            // Populate effect dropdowns with server data
            if (loadedEffects.length > 0) {
                populateEffectDropdowns(loadedEffects);
            }
            
            // Populate enemy name datalist
            if (loadedEnemies.length > 0) {
                populateEnemyDatalist(loadedEnemies);
            }
            
            // Process enemy images (server now provides signed URLs)
            if (loadedEnemies.length > 0) {
                console.log('Processing enemy images...');
                for (const enemy of loadedEnemies) {
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
async function getSignedUrl(key) {
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

// Populate effect dropdowns using global effects data
function populateEffectDropdownsFromGlobal() {
    // Check if global data is loaded
    if (!isGlobalDataLoaded()) {
        console.warn('Global effects data not loaded yet, cannot populate dropdowns');
        return;
    }

    const effects = getEffects();
    console.log('Populating effect dropdowns with global data:', effects.length, 'effects');

    // Add a "None" option and effects from global data
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

    console.log('✅ Effect dropdowns populated from global data');
}

// Legacy function for backward compatibility
function populateEffectDropdowns(effects) {
    console.warn('populateEffectDropdowns is deprecated, use populateEffectDropdownsFromGlobal instead');
    populateEffectDropdownsFromGlobal();
}

// Populate enemy name datalist with existing enemies
function populateEnemyDatalist(enemies) {
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

// === ENEMY ASSET MANAGEMENT ===

/**
 * Create an asset gallery overlay for reusing existing enemy icons
 */
function createAssetGallery() {
    // Check if global data is loaded
    if (!isGlobalDataLoaded()) {
        console.warn('Global data not loaded yet, cannot create asset gallery');
        return;
    }

    const enemies = getEnemiesWithAssets();
    if (enemies.length === 0) {
        console.log('No enemies with assets available for reuse');
        return;
    }

    console.log('Creating asset gallery with', enemies.length, 'available enemies');

    // Get the existing toggle button and set up click handler
    const toggleBtn = document.getElementById('assetGalleryToggle');
    if (toggleBtn) {
        toggleBtn.onclick = () => toggleAssetGallery();
    }

    // Get the existing overlay and set up click handler
    const overlay = document.getElementById('assetGalleryOverlay');
    if (overlay) {
        // Close overlay when clicking outside the gallery
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                toggleAssetGallery();
            }
        });
    }

    // Populate asset grid
    const assetGrid = document.getElementById('assetGrid');
    if (assetGrid) {
        assetGrid.innerHTML = ''; // Clear existing content

        enemies.forEach(enemy => {
            const assetItem = document.createElement('div');
            assetItem.className = 'asset-item';
            assetItem.dataset.assetId = enemy.assetID;
            assetItem.innerHTML = `
                <img src="${enemy.icon}" alt="${enemy.name}" class="asset-thumbnail">
                <div class="asset-label">${enemy.name} (ID: ${enemy.assetID})</div>
            `;
            
            // Add click handler to select only the asset (not the full enemy data)
            assetItem.addEventListener('click', () => selectExistingAsset(enemy));
            
            assetGrid.appendChild(assetItem);
        });
    }
}

/**
 * Toggle the visibility of the asset gallery overlay
 */
function toggleAssetGallery() {
    const overlay = document.getElementById('assetGalleryOverlay');
    
    if (overlay) {
        const isVisible = !overlay.classList.contains('hidden');
        
        if (isVisible) {
            overlay.classList.add('hidden');
        } else {
            overlay.classList.remove('hidden');
        }
    }
}

/**
 * Select an existing asset for reuse (without loading enemy data)
 * @param {Object} enemy - The enemy object that has the asset we want to reuse
 */
async function selectExistingAsset(enemy) {
    console.log('Selected existing asset from enemy:', enemy.name, 'AssetID:', enemy.assetID);
    
    try {
        // Load only the enemy's icon if available
        if (enemy.icon) {
            // Fetch the image from S3 using the signed URL and convert to base64
            console.log('Fetching asset icon from S3:', enemy.icon);
            const response = await fetch(enemy.icon);
            if (!response.ok) {
                throw new Error(`Failed to fetch image: ${response.status}`);
            }
            
            const blob = await response.blob();
            console.log('Image fetched, size:', (blob.size / 1024).toFixed(2) + 'KB');
            
            // Convert blob to base64
            const reader = new FileReader();
            reader.onload = (e) => {
                // Store the base64 data directly (this is what the server expects)
                currentIcon = e.target.result;
                currentAssetID = enemy.assetID; // Store the asset ID for reference
                
                console.log('✅ Asset icon converted to base64 and ready for use');
                console.log('Base64 length:', currentIcon.length);
                
                // Update the preview using the texture URL for display
                const iconPreview = document.getElementById('iconPreview');
                const uploadContent = document.querySelector('.upload-content');
                
                if (iconPreview) {
                    iconPreview.innerHTML = `<img src="${enemy.icon}" alt="Asset ${enemy.assetID}" style="width: 100%; height: 100%; object-fit: stretch;">`;
                }
                
                if (uploadContent) {
                    uploadContent.style.display = 'none';
                }
            };
            
            reader.onerror = () => {
                console.error('Failed to convert fetched image to base64');
                alert('Failed to process the asset. Please try again.');
                return;
            };
            
            reader.readAsDataURL(blob);
        } else {
            // No icon for this enemy
            currentIcon = null;
            currentAssetID = 0;
            alert('This enemy has no asset to reuse.');
            return;
        }
        
    } catch (error) {
        console.error('Error loading asset:', error);
        alert('Failed to load the selected asset. Please try again.');
        return;
    }
    
    // Close the asset gallery overlay
    toggleAssetGallery();
    
    // Add visual feedback in the gallery
    const allAssetItems = document.querySelectorAll('.asset-item');
    allAssetItems.forEach(item => item.classList.remove('selected'));
    const selectedItem = document.querySelector(`[data-asset-id="${enemy.assetID}"]`);
    if (selectedItem) {
        selectedItem.classList.add('selected');
    }
    
    console.log('✅ Asset selected and ready for reuse (enemy data not loaded)');
}

/**
 * Select an existing enemy and load all its data into the form
 * @param {Object} enemy - The selected enemy object
 */
async function selectExistingEnemy(enemy) {
    console.log('Selected existing enemy:', enemy.name, 'ID:', enemy.id, 'AssetID:', enemy.assetID);
    
    try {
        // Load the enemy's icon if available
        if (enemy.icon) {
            // Fetch the image from S3 using the signed URL and convert to base64
            console.log('Fetching enemy icon from S3:', enemy.icon);
            const response = await fetch(enemy.icon);
            if (!response.ok) {
                throw new Error(`Failed to fetch image: ${response.status}`);
            }
            
            const blob = await response.blob();
            console.log('Image fetched, size:', (blob.size / 1024).toFixed(2) + 'KB');
            
            // Convert blob to base64
            const reader = new FileReader();
            reader.onload = (e) => {
                // Store the base64 data directly (this is what the server expects)
                currentIcon = e.target.result;
                currentAssetID = enemy.assetID; // Store the asset ID for reference
                
                console.log('✅ Enemy icon converted to base64 and ready for use');
                console.log('Base64 length:', currentIcon.length);
                
                // Update the preview using the texture URL for display
                const iconPreview = document.getElementById('iconPreview');
                const uploadContent = document.querySelector('.upload-content');
                
                if (iconPreview) {
                    iconPreview.innerHTML = `<img src="${enemy.icon}" alt="${enemy.name}" style="width: 100%; height: 100%; object-fit: stretch;">`;
                }
                
                if (uploadContent) {
                    uploadContent.style.display = 'none';
                }
            };
            
            reader.onerror = () => {
                console.error('Failed to convert fetched image to base64');
                alert('Failed to process the enemy icon. Please try again.');
                return;
            };
            
            reader.readAsDataURL(blob);
        } else {
            // No icon for this enemy
            currentIcon = null;
            currentAssetID = 0;
        }
        
        // Load all enemy data into the form
        loadEnemyIntoForm(enemy);
        
    } catch (error) {
        console.error('Error loading enemy data:', error);
        alert('Failed to load the selected enemy. Please try again.');
        return;
    }
    
    // Close the asset gallery overlay
    toggleAssetGallery();
    
    // Add visual feedback in the gallery
    const allAssetItems = document.querySelectorAll('.asset-item');
    allAssetItems.forEach(item => item.classList.remove('selected'));
    const selectedItem = document.querySelector(`[data-asset-id="${enemy.assetID}"]`);
    if (selectedItem) {
        selectedItem.classList.add('selected');
    }
    
    console.log('✅ Enemy loaded into form successfully');
}

/**
 * Load complete enemy data into the form fields
 * @param {Object} enemy - The enemy object to load
 */
function loadEnemyIntoForm(enemy) {
    console.log('Loading enemy data into form:', enemy.name);
    
    // Load basic information
    document.getElementById('enemyName').value = enemy.name || '';
    document.getElementById('enemyDescription').value = enemy.description || '';
    
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
        for (let i = 0; i < Math.min(enemy.effects.length, 10); i++) {
            const effect = enemy.effects[i];
            const effectElement = document.getElementById(`effect${i + 1}`);
            const factorElement = document.getElementById(`factor${i + 1}`);
            
            if (effectElement) {
                effectElement.value = effect.type || 0;
            }
            if (factorElement) {
                factorElement.value = effect.factor || 1;
            }
        }
    }
    
    // Load messages
    if (enemy.messages && Array.isArray(enemy.messages)) {
        // Clear existing messages
        clearMessages('victory');
        clearMessages('defeat');
        
        enemy.messages.forEach(message => {
            if (message.type === 'onWin') {
                addMessage('victory', message.message);
            } else if (message.type === 'onLose') {
                addMessage('defeat', message.message);
            }
        });
    }
    
    console.log('✅ All enemy data loaded into form');
}

// Keyboard support for asset gallery overlay
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        const overlay = document.getElementById('assetGalleryOverlay');
        if (overlay && !overlay.classList.contains('hidden')) {
            toggleAssetGallery();
        }
    }
});

// === INITIALIZATION ===
async function initEnemyDesigner() {
    console.log('🎮 Initializing Enemy Designer...');
    
    setupIconUpload();
    setupFormHandlers();
    setupEnemyNameHandler();
    initializeEffectOptions();
    setupMessageHandlers();
    
    // Wait for global data to be loaded, then populate dropdowns and create asset gallery
    try {
        if (!isGlobalDataLoaded()) {
            console.log('Waiting for global data to load...');
            await initializeGlobalData();
        }
        
        // Populate effect dropdowns with global data
        populateEffectDropdownsFromGlobal();

        // Populate enemy name datalist with global data
        const enemies = getEnemies();
        if (enemies.length > 0) {
            populateEnemyDatalist(enemies);
        }
        
        // Create asset gallery for reusing existing enemy icons
        createAssetGallery();
        
        console.log('✅ Enemy Designer initialized successfully');
    } catch (error) {
        console.error('Failed to initialize global data for enemy designer:', error);
        // Still initialize basic functionality even if global data fails
        console.log('Continuing with basic initialization...');
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    // Only initialize if we're on the enemy designer page
    if (document.getElementById('enemyForm')) {
        initEnemyDesigner();
    }
});

// === HELPER FUNCTIONS FOR ENEMY LOADING ===

/**
 * Clear all messages of a specific type
 * @param {string} type - 'victory' or 'defeat'
 */
function clearMessages(type) {
    const listId = type === 'victory' ? 'victory-messages-list' : 'defeat-messages-list';
    const listElem = document.getElementById(listId);
    if (listElem) {
        listElem.innerHTML = '';
    }
}

/**
 * Add a message of a specific type
 * @param {string} type - 'victory' or 'defeat'
 * @param {string} message - The message text to add
 */
function addMessage(type, message) {
    const listId = type === 'victory' ? 'victory-messages-list' : 'defeat-messages-list';
    const listElem = document.getElementById(listId);
    if (listElem) {
        addMessageField(listElem, type, message);
    }
}
