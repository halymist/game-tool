// ==================== BULK COMBAT (effect calibration) ====================
// Iteratively finds a per-effect factor value such that all effects end up
// approximately equal strength. Each phase: Swiss tournament → Elo →
// nudge each effect's value toward the mean rating.

const bulkState = {
    activeRunId: null,
    pollHandle: null,
    runs: [],
    selectedRunId: null,
    startedAt: 0,
    totalMatches: 0,
};

let bulkCombatBooted = false;

function ensureBulkCombatInit() {
    if (bulkCombatBooted) return;
    if (!document.getElementById('bulkStartBtn')) return;
    bulkCombatBooted = true;
    initBulkCombat();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureBulkCombatInit);
} else {
    ensureBulkCombatInit();
}

function initBulkCombat() {
    document.getElementById('bulkStartBtn').addEventListener('click', startBulkRun);

    document.querySelectorAll('.combat-sidebar-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.dataset.combatTab === 'bulk') loadBulkHistory();
        });
    });

    loadBulkHistory();
}

// ── Start ───────────────────────────────────────────────

async function startBulkRun() {
    const btn = document.getElementById('bulkStartBtn');
    btn.disabled = true;

    const payload = {
        baseline: {
            strength:  parseInt(document.getElementById('bulkStr').value)    || 0,
            stamina:   parseInt(document.getElementById('bulkSta').value)    || 1,
            agility:   parseInt(document.getElementById('bulkAgi').value)    || 0,
            luck:      parseInt(document.getElementById('bulkLck').value)    || 0,
            armor:     parseInt(document.getElementById('bulkArm').value)    || 0,
            minDamage: parseInt(document.getElementById('bulkMinDmg').value) || 0,
            maxDamage: parseInt(document.getElementById('bulkMaxDmg').value) || 0,
        },
        effectValue:   parseFloat(document.getElementById('bulkEffectValue').value)   || 5,
        fightsPerPair: parseInt(document.getElementById('bulkFightsPerPair').value)   || 20,
        rounds:        parseInt(document.getElementById('bulkRounds').value)          || 6,
        phases:        parseInt(document.getElementById('bulkPhases').value)          || 4,
        valueMin:      parseFloat(document.getElementById('bulkValueMin').value)      || 1,
        valueMax:      parseFloat(document.getElementById('bulkValueMax').value)      || 50,
        effectIds:     [],
    };

    setBulkStatus('Starting calibration…');

    try {
        const token = await getCurrentAccessToken();
        if (!token) { alert('Auth required'); btn.disabled = false; return; }

        const resp = await fetch('/api/startBulkCombat', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!resp.ok) {
            setBulkStatus('Failed: ' + (await resp.text()), true);
            btn.disabled = false;
            return;
        }
        const data = await resp.json();
        bulkState.activeRunId   = data.runId;
        bulkState.selectedRunId = data.runId;
        bulkState.totalMatches  = data.totalMatches;
        bulkState.startedAt     = Date.now();

        document.getElementById('bulkProgress').style.display = '';
        setBulkStatus(`Run #${data.runId} · ${data.effectCount} effects · ${data.phases} phases`);
        startProgressPoll();
        loadBulkHistory();
    } catch (e) {
        setBulkStatus('Error: ' + e.message, true);
        btn.disabled = false;
    }
}

// ── Polling ─────────────────────────────────────────────

function startProgressPoll() {
    if (bulkState.pollHandle) clearInterval(bulkState.pollHandle);
    bulkState.pollHandle = setInterval(pollProgress, 1000);
    pollProgress();
}

async function pollProgress() {
    if (!bulkState.activeRunId) return;
    try {
        const token = await getCurrentAccessToken();
        const resp = await fetch(`/api/getBulkCombatRun?id=${bulkState.activeRunId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!resp.ok) return;
        const data = await resp.json();
        if (!data.success) return;
        const run = data.run;

        renderBulkProgress(run);
        renderBulkResults(run);

        if (run.status !== 'running') {
            clearInterval(bulkState.pollHandle);
            bulkState.pollHandle = null;
            bulkState.activeRunId = null;
            document.getElementById('bulkStartBtn').disabled = false;
            setBulkStatus(run.status === 'finished'
                ? `✅ Finished run #${run.runId}`
                : `⚠️ Run ${run.status}`);
            loadBulkHistory();
        }
    } catch (e) {
        console.error('Bulk poll error', e);
    }
}

function renderBulkProgress(run) {
    const fill = document.getElementById('bulkProgressFill');
    const text = document.getElementById('bulkProgressText');
    const eta  = document.getElementById('bulkProgressEta');

    const total = run.totalMatches || 1;
    const done  = Math.min(run.completedMatches, total);
    const pct   = (done / total) * 100;
    fill.style.width = pct.toFixed(1) + '%';
    const phaseInfo = run.phases > 1
        ? ` · phase ${Math.max(run.currentPhase, 1)}/${run.phases}`
        : '';
    text.textContent = `${done} / ${total} matches  (${pct.toFixed(1)}%)${phaseInfo}`;

    if (run.status === 'running' && done > 0) {
        const elapsed = (Date.now() - bulkState.startedAt) / 1000;
        const perMatch = elapsed / done;
        const remaining = (total - done) * perMatch;
        eta.textContent = `ETA: ${formatBulkDuration(remaining)}`;
    } else if (run.status === 'finished' && run.finishedAt) {
        const dur = (new Date(run.finishedAt) - new Date(run.createdAt)) / 1000;
        eta.textContent = `Took ${formatBulkDuration(dur)}`;
    } else {
        eta.textContent = '';
    }
}

// ── Results ─────────────────────────────────────────────

function renderBulkResults(run) {
    const tbody = document.getElementById('bulkResultsBody');
    const label = document.getElementById('bulkResultsLabel');

    if (!run.results || !run.results.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="bulk-empty">No data yet…</td></tr>';
        label.textContent = '';
        return;
    }

    label.textContent = `Run #${run.runId} · start ${run.config?.effectValue ?? '-'} · `
        + `${run.config?.fightsPerPair ?? '-'} fights/pair · `
        + `${run.config?.rounds ?? '-'} rounds · ${run.phases ?? 1} phases`;

    const rows = run.results.map((r, idx) => {
        const total = r.wins + r.losses;
        const winPct = total > 0 ? ((r.wins / total) * 100).toFixed(1) : '-';
        const rank = r.rank > 0 ? r.rank : (idx + 1);
        const trace = (r.phaseHistory || [])
            .map(p => p.value.toFixed(1))
            .join(' → ') || '-';
        return `
            <tr>
                <td class="bulk-rank">${rank}</td>
                <td class="bulk-effect-name">${escapeBulkHtml(r.effectName || ('#' + r.effectId))}</td>
                <td class="bulk-value">${r.currentValue.toFixed(2)}</td>
                <td class="bulk-rating">${Math.round(r.rating)}</td>
                <td>${r.wins}</td>
                <td>${r.losses}</td>
                <td>${winPct}${winPct === '-' ? '' : '%'}</td>
                <td class="bulk-trace" title="${trace}">${trace}</td>
            </tr>
        `;
    }).join('');
    tbody.innerHTML = rows;
}

// ── History ─────────────────────────────────────────────

async function loadBulkHistory() {
    try {
        const token = await getCurrentAccessToken();
        if (!token) return;
        const resp = await fetch('/api/getBulkCombatRuns', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!resp.ok) return;
        const data = await resp.json();
        if (!data.success) return;
        bulkState.runs = data.runs || [];
        renderBulkHistory();
    } catch (e) {
        console.error('Bulk history error', e);
    }
}

function renderBulkHistory() {
    const tbody = document.getElementById('bulkHistoryBody');
    if (!bulkState.runs.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="bulk-empty">No runs yet</td></tr>';
        return;
    }
    tbody.innerHTML = bulkState.runs.map(run => {
        const effectCount = run.config?.effectIds?.length ?? 0;
        const date = formatBulkDateTime(run.createdAt);
        const matches = `${run.completedMatches}/${run.totalMatches}`;
        const isActive = run.runId === bulkState.selectedRunId ? 'bulk-history-row-active' : '';
        const statusBadge = `<span class="bulk-status-badge bulk-status-${run.status}">${run.status}</span>`;
        return `
            <tr class="bulk-history-row ${isActive}" onclick="selectBulkRun(${run.runId})">
                <td>${run.runId}</td>
                <td>${date}</td>
                <td>${effectCount}</td>
                <td>${matches}</td>
                <td>${statusBadge}</td>
                <td><button type="button" class="bulk-delete-btn" onclick="event.stopPropagation(); deleteBulkRun(${run.runId})" title="Delete">✕</button></td>
            </tr>
        `;
    }).join('');
}

async function selectBulkRun(runId) {
    bulkState.selectedRunId = runId;
    renderBulkHistory();
    try {
        const token = await getCurrentAccessToken();
        const resp = await fetch(`/api/getBulkCombatRun?id=${runId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!resp.ok) return;
        const data = await resp.json();
        if (!data.success) return;
        renderBulkResults(data.run);
        document.getElementById('bulkProgress').style.display = '';
        renderBulkProgress(data.run);
        if (data.run.status === 'running') {
            bulkState.activeRunId = runId;
            bulkState.startedAt = new Date(data.run.createdAt).getTime();
            startProgressPoll();
        }
    } catch (e) {
        console.error('selectBulkRun error', e);
    }
}
window.selectBulkRun = selectBulkRun;

async function deleteBulkRun(runId) {
    if (!confirm(`Delete bulk combat run #${runId}? This cannot be undone.`)) return;
    try {
        const token = await getCurrentAccessToken();
        const resp = await fetch('/api/deleteBulkCombatRun', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ runId }),
        });
        if (!resp.ok) {
            alert('Failed: ' + (await resp.text()));
            return;
        }
        if (bulkState.selectedRunId === runId) {
            bulkState.selectedRunId = null;
            document.getElementById('bulkResultsBody').innerHTML =
                '<tr><td colspan="8" class="bulk-empty">Start a run or pick one from history.</td></tr>';
            document.getElementById('bulkResultsLabel').textContent = '';
            document.getElementById('bulkProgress').style.display = 'none';
        }
        loadBulkHistory();
    } catch (e) {
        alert('Error: ' + e.message);
    }
}
window.deleteBulkRun = deleteBulkRun;

// ── Helpers ─────────────────────────────────────────────

function setBulkStatus(text, isError) {
    const el = document.getElementById('bulkStatus');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('bulk-status-error', !!isError);
}

function escapeBulkHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
}

function formatBulkDuration(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '-';
    if (seconds < 60) return seconds.toFixed(0) + 's';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    if (m < 60) return `${m}m ${s}s`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
}

function formatBulkDateTime(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '-';
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}
