// Concept Editor

let conceptState = {
    payload: {}
};

const defaultPromptPayload = {
    instructions: {},
    output_contract: {},
    json_schema: {},
    wilds_bible: {},
    settlement_context: {},
    npc_context: [],
    quest_chain_context: {},
    reference_quests: [],
    designer_prompt: {}
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
        const systemPrompt = document.getElementById('conceptSystemPrompt');
        if (systemPrompt) systemPrompt.value = toKeyValueLines(data.systemPrompt || {});
        const wildsPrompt = document.getElementById('conceptWildsPrompt');
        if (wildsPrompt) wildsPrompt.value = toKeyValueLines(data.wildsPrompt || {});
        renderConceptJson();
    } catch (error) {
        console.error('Error loading concept:', error);
        setConceptStatus('Failed to load concept', true);
    }
}

function renderConceptJson() {
    const textarea = document.getElementById('conceptJson');
    if (!textarea) return;
    const schema = conceptState.payload?.json_schema ?? conceptState.payload ?? {};
    textarea.value = JSON.stringify(schema, null, 2);
}

async function saveConcept() {
    const textarea = document.getElementById('conceptJson');
    const systemPrompt = document.getElementById('conceptSystemPrompt');
    const wildsPrompt = document.getElementById('conceptWildsPrompt');
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

        const systemPromptJson = parseKeyValueLines(systemPrompt?.value || '');
        const wildsPromptJson = parseKeyValueLines(wildsPrompt?.value || '');

        const schemaPayload = parsed;
        const promptPayload = buildPromptPayload(schemaPayload, systemPromptJson, wildsPromptJson);

        const response = await fetch('http://localhost:8080/api/saveConcept', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                payload: promptPayload,
                systemPrompt: systemPromptJson,
                wildsPrompt: wildsPromptJson
            })
        });
        const data = await response.json();
        if (!data.success) {
            setConceptStatus(data.message || 'Save failed', true);
            return;
        }

        conceptState.payload = data.payload || promptPayload;
        if (systemPrompt) systemPrompt.value = toKeyValueLines(data.systemPrompt || systemPromptJson);
        if (wildsPrompt) wildsPrompt.value = toKeyValueLines(data.wildsPrompt || wildsPromptJson);
        renderConceptJson();
        setConceptStatus('Saved', false);
    } catch (error) {
        console.error('Error saving concept:', error);
        setConceptStatus('Save failed', true);
    }
}

function parseKeyValueLines(text) {
    const result = {};
    text.split('\n').forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        const idx = trimmed.indexOf(':');
        if (idx === -1) return;
        const key = trimmed.slice(0, idx).trim();
        if (!key) return;
        const valueText = trimmed.slice(idx + 1).trim();
        if (!valueText) {
            result[key] = '';
            return;
        }
        const parsed = tryParseJsonValue(valueText);
        result[key] = parsed;
    });
    return result;
}

function toKeyValueLines(value) {
    if (!value) return '';
    if (typeof value === 'string') {
        try {
            value = JSON.parse(value);
        } catch {
            return value;
        }
    }
    if (typeof value !== 'object') {
        return String(value);
    }
    return Object.entries(value)
        .map(([key, val]) => `${key}: ${typeof val === 'string' ? val : JSON.stringify(val)}`)
        .join('\n');
}

function buildPromptPayload(schemaPayload, systemPromptJson, wildsPromptJson) {
    const base = { ...defaultPromptPayload, ...(conceptState.payload || {}) };
    base.instructions = systemPromptJson || {};
    base.wilds_bible = wildsPromptJson || {};
    base.json_schema = schemaPayload || {};

    if (!base.output_contract || typeof base.output_contract !== 'object') base.output_contract = {};
    if (!base.settlement_context || typeof base.settlement_context !== 'object') base.settlement_context = {};
    if (!base.quest_chain_context || typeof base.quest_chain_context !== 'object') base.quest_chain_context = {};
    if (!base.designer_prompt || typeof base.designer_prompt !== 'object') base.designer_prompt = {};
    if (!Array.isArray(base.npc_context)) base.npc_context = [];
    if (!Array.isArray(base.reference_quests)) base.reference_quests = [];

    return base;
}

function tryParseJsonValue(valueText) {
    const firstChar = valueText[0];
    const looksJson = firstChar === '{' || firstChar === '[' || firstChar === '"' || firstChar === '-' || /\d/.test(firstChar) || valueText === 'true' || valueText === 'false' || valueText === 'null';
    if (!looksJson) return valueText;
    try {
        return JSON.parse(valueText);
    } catch {
        return valueText;
    }
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
