// Concept Editor

let conceptState = {
    payload: {}
};

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('concept-content')) {
        window.initConceptManager = initConceptManager;
        window.loadConceptData = loadConceptData;
    }
});

async function initConceptManager() {
    setupConceptListeners();
    await loadConceptData();
}

function setupConceptListeners() {
    document.getElementById('conceptSaveBtn')?.addEventListener('click', saveConcept);
    document.getElementById('conceptAddBtn')?.addEventListener('click', addToConceptArray);
}

async function loadConceptData() {
    try {
        const token = await getCurrentAccessToken();
        if (!token) return;

        const response = await fetch('http://localhost:8080/api/getConcept', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (!data.success) {
            setConceptStatus(data.message || 'Failed to load concept', true);
            return;
        }

        conceptState.payload = data.payload || {};
        renderConceptJson();
    } catch (error) {
        console.error('Error loading concept:', error);
        setConceptStatus('Failed to load concept', true);
    }
}

function renderConceptJson() {
    const textarea = document.getElementById('conceptJson');
    if (!textarea) return;
    textarea.value = JSON.stringify(conceptState.payload, null, 2);
}

async function saveConcept() {
    const textarea = document.getElementById('conceptJson');
    if (!textarea) return;

    let parsed;
    try {
        parsed = JSON.parse(textarea.value || '{}');
    } catch (err) {
        setConceptStatus('Invalid JSON', true);
        return;
    }

    try {
        const token = await getCurrentAccessToken();
        if (!token) return;

        const response = await fetch('http://localhost:8080/api/saveConcept', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ payload: parsed })
        });
        const data = await response.json();
        if (!data.success) {
            setConceptStatus(data.message || 'Save failed', true);
            return;
        }

        conceptState.payload = data.payload || parsed;
        renderConceptJson();
        setConceptStatus('Saved', false);
    } catch (error) {
        console.error('Error saving concept:', error);
        setConceptStatus('Save failed', true);
    }
}

function addToConceptArray() {
    const pathInput = document.getElementById('conceptPath');
    const valueInput = document.getElementById('conceptValue');
    if (!pathInput || !valueInput) return;

    const path = pathInput.value.trim();
    if (!path) {
        setConceptStatus('Path required', true);
        return;
    }

    let value;
    try {
        value = JSON.parse(valueInput.value);
    } catch {
        value = valueInput.value;
    }

    let parsed;
    try {
        parsed = JSON.parse(document.getElementById('conceptJson').value || '{}');
    } catch {
        setConceptStatus('Invalid JSON', true);
        return;
    }

    const segments = path.split('.');
    let current = parsed;
    for (let i = 0; i < segments.length; i++) {
        const key = segments[i];
        if (i === segments.length - 1) {
            if (!Array.isArray(current[key])) {
                current[key] = [];
            }
            current[key].push(value);
        } else {
            if (!current[key] || typeof current[key] !== 'object') {
                current[key] = {};
            }
            current = current[key];
        }
    }

    conceptState.payload = parsed;
    renderConceptJson();
    setConceptStatus('Added to array', false);
}

function setConceptStatus(message, isError) {
    const status = document.getElementById('conceptStatus');
    if (!status) return;
    status.textContent = message;
    status.className = `concept-status ${isError ? 'error' : 'success'}`;
    if (!isError) {
        setTimeout(() => {
            status.textContent = '';
            status.className = 'concept-status';
        }, 2000);
    }
}
