// Concept Editor

let conceptState = {
    payload: {},
    expeditionSchema: {}
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
        conceptState.expeditionSchema = getSchemaObject(data.expeditionJsonSchema);
        const systemPrompt = document.getElementById('conceptSystemPrompt');
        if (systemPrompt) systemPrompt.value = jsonbToText(data.systemPrompt);
        const wildsPrompt = document.getElementById('conceptWildsPrompt');
        if (wildsPrompt) wildsPrompt.value = jsonbToText(data.wildsPrompt);
        const expeditionClusterPrompt = document.getElementById('conceptExpeditionClusterPrompt');
        if (expeditionClusterPrompt) expeditionClusterPrompt.value = jsonbToText(data.expeditionClusterPrompt);
        renderConceptJson();
        renderExpeditionConceptJson();
    } catch (error) {
        console.error('Error loading concept:', error);
        setConceptStatus('Failed to load concept', true);
    }
}

function renderConceptJson() {
    const textarea = document.getElementById('conceptJson');
    if (!textarea) return;
    const schema = conceptState.payload?.json_schema ?? conceptState.payload ?? {};
    textarea.value = stringifySchema(schema);
}

function renderExpeditionConceptJson() {
    const textarea = document.getElementById('conceptExpeditionJson');
    if (!textarea) return;
    textarea.value = stringifySchema(conceptState.expeditionSchema || {});
}

async function saveConcept() {
    const textarea = document.getElementById('conceptJson');
    const expeditionTextarea = document.getElementById('conceptExpeditionJson');
    const systemPrompt = document.getElementById('conceptSystemPrompt');
    const wildsPrompt = document.getElementById('conceptWildsPrompt');
    const expeditionClusterPrompt = document.getElementById('conceptExpeditionClusterPrompt');
    if (!textarea) return;

    let parsed;
    try {
        parsed = JSON.parse(textarea.value || '{}');
    } catch (err) {
        setConceptStatus('Invalid JSON', true);
        return;
    }

    let parsedExpedition = {};
    if (expeditionTextarea) {
        try {
            parsedExpedition = parseSchemaInput(expeditionTextarea.value);
        } catch (err) {
            setConceptStatus('Invalid Expedition JSON', true);
            return;
        }
    }

    conceptState.expeditionSchema = parsedExpedition;

    try {
        const token = await getCurrentAccessToken();
        if (!token) return;

        const systemPromptJson = systemPrompt?.value || '';
        const wildsPromptJson = wildsPrompt?.value || '';
        const expeditionClusterPromptJson = expeditionClusterPrompt?.value || '';

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
                wildsPrompt: wildsPromptJson,
                expeditionClusterPrompt: expeditionClusterPromptJson,
                expeditionJsonSchema: parsedExpedition
            })
        });
        const data = await response.json();
        if (!data.success) {
            setConceptStatus(data.message || 'Save failed', true);
            return;
        }

        conceptState.payload = data.payload || promptPayload;
        if (systemPrompt) systemPrompt.value = jsonbToText(data.systemPrompt ?? systemPromptJson);
        if (wildsPrompt) wildsPrompt.value = jsonbToText(data.wildsPrompt ?? wildsPromptJson);
        if (expeditionClusterPrompt) expeditionClusterPrompt.value = jsonbToText(data.expeditionClusterPrompt ?? expeditionClusterPromptJson);
        renderConceptJson();
        conceptState.expeditionSchema = getSchemaObject(data.expeditionJsonSchema ?? parsedExpedition);
        renderExpeditionConceptJson();
        setConceptStatus('Saved', false);
    } catch (error) {
        console.error('Error saving concept:', error);
        setConceptStatus('Save failed', true);
    }
}

function jsonbToText(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object') {
        if (typeof value.text === 'string') return value.text;
        return JSON.stringify(value, null, 2);
    }
    return String(value);
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

function stringifySchema(schema) {
    try {
        const target = schema && typeof schema === 'object' ? schema : {};
        return JSON.stringify(target, null, 2);
    } catch (error) {
        console.warn('Failed to stringify schema:', error);
        return '{}';
    }
}

function parseSchemaInput(value) {
    if (!value || !value.trim()) return {};
    return JSON.parse(value);
}

function getSchemaObject(value) {
    if (!value) return {};
    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        } catch (error) {
            console.warn('Failed to parse schema JSON string:', error);
            return {};
        }
    }
    if (typeof value === 'object') return value;
    return {};
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
