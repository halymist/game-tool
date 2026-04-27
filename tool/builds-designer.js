// ==================== BUILDS DESIGNER (Test2) ====================
// Build editor + per-milestone rankings.

const buildsState = {
    list: [],
    runs: [],
    selectedBuildId: null,
    selectedRunId: null,
    selectedMilestone: 70,
    talents: new Map(),       // talentId -> { points, talentOrder, perkId }
    talentOrderSeq: 0,
    runPollHandle: null,
    runStartedAt: 0,
    perks: [],
};

let buildsBooted = false;

function ensureBuildsInit() {
    if (buildsBooted) return;
    if (!document.getElementById('buildsNewBtn')) return;
    buildsBooted = true;
    initBuilds();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureBuildsInit);
} else {
    ensureBuildsInit();
}

function initBuilds() {
    document.getElementById('buildsNewBtn').addEventListener('click', startNewBuild);
    document.getElementById('buildsSaveBtn').addEventListener('click', saveCurrentBuild);
    document.getElementById('buildsDeleteBtn').addEventListener('click', deleteCurrentBuild);
    document.getElementById('buildsStartRunBtn').addEventListener('click', startBuildRun);

    // Activate when Test2 tab opens.
    document.querySelectorAll('.combat-sidebar-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.dataset.combatTab === 'test2') refreshBuildsData();
        });
    });

    // First load (talents/perks may not be ready yet — refreshBuildsData is idempotent).
    refreshBuildsData();
    if (typeof subscribeToGlobalData === 'function') {
        subscribeToGlobalData('talents', () => {
            buildsState.perks = typeof getPerks === 'function' ? getPerks() : [];
            if (buildsState.selectedBuildId !== null) renderTalentTree();
        });
    }
}

async function refreshBuildsData() {
    try {
        if (typeof loadEnemiesData === 'function' &&
            (!window.GlobalData || !GlobalData.talents || GlobalData.talents.length === 0)) {
            await loadEnemiesData();
        }
        buildsState.perks = typeof getPerks === 'function' ? getPerks() : [];
    } catch (e) {
        console.error('Builds: data load error', e);
    }
    await loadBuildsList();
    await loadBuildRunsList();
}

// ──────────────────────────────────────────────────────────────────
// Build list
// ──────────────────────────────────────────────────────────────────

async function loadBuildsList() {
    try {
        const token = await getCurrentAccessToken();
        if (!token) return;
        const resp = await fetch('/api/getBuilds', {
            headers: { 'Authorization': `Bearer ${token}` },
        });
        if (!resp.ok) return;
        const data = await resp.json();
        if (!data.success) return;
        buildsState.list = data.builds || [];
        renderBuildsList();
    } catch (e) {
        console.error('loadBuildsList', e);
    }
}

function renderBuildsList() {
    const el = document.getElementById('buildsList');
    if (!buildsState.list.length) {
        el.innerHTML = '<div class="builds-empty">No builds yet — click <strong>+ New</strong>.</div>';
        return;
    }
    el.innerHTML = buildsState.list.map(b => {
        const totalPoints = (b.talents || []).reduce((s, t) => s + (t.points || 0), 0);
        const isActive = b.buildId === buildsState.selectedBuildId ? 'builds-list-row-active' : '';
        return `
            <div class="builds-list-row ${isActive}" data-id="${b.buildId}">
                <div class="builds-list-name">${escBHtml(b.buildName)}</div>
                <div class="builds-list-meta">${totalPoints} pts · STR ${b.strength} STA ${b.stamina}</div>
            </div>
        `;
    }).join('');
    el.querySelectorAll('.builds-list-row').forEach(row => {
        row.addEventListener('click', () => selectBuild(parseInt(row.dataset.id, 10)));
    });
}

function startNewBuild() {
    buildsState.selectedBuildId = null;
    buildsState.talents = new Map();
    buildsState.talentOrderSeq = 0;
    document.getElementById('buildName').value = '';
    document.getElementById('buildStr').value = 10;
    document.getElementById('buildSta').value = 10;
    document.getElementById('buildAgi').value = 10;
    document.getElementById('buildLck').value = 10;
    document.getElementById('buildArm').value = 10;
    document.getElementById('buildMinDmg').value = 5;
    document.getElementById('buildMaxDmg').value = 10;
    showEditor();
    renderTalentTree();
    renderBuildsList();
    updatePointCount();
}

async function selectBuild(id) {
    buildsState.selectedBuildId = id;
    renderBuildsList();
    try {
        const token = await getCurrentAccessToken();
        const resp = await fetch(`/api/getBuild?id=${id}`, {
            headers: { 'Authorization': `Bearer ${token}` },
        });
        if (!resp.ok) return;
        const data = await resp.json();
        if (!data.success) return;
        const b = data.build;
        document.getElementById('buildName').value = b.buildName || '';
        document.getElementById('buildStr').value = b.strength;
        document.getElementById('buildSta').value = b.stamina;
        document.getElementById('buildAgi').value = b.agility;
        document.getElementById('buildLck').value = b.luck;
        document.getElementById('buildArm').value = b.armor;
        document.getElementById('buildMinDmg').value = b.minDamage;
        document.getElementById('buildMaxDmg').value = b.maxDamage;

        buildsState.talents = new Map();
        buildsState.talentOrderSeq = 0;
        (b.talents || []).forEach(bt => {
            buildsState.talents.set(bt.talentId, {
                points: bt.points,
                talentOrder: bt.talentOrder,
                perkId: bt.perkId || null,
            });
            if (bt.talentOrder > buildsState.talentOrderSeq) buildsState.talentOrderSeq = bt.talentOrder;
        });

        showEditor();
        renderTalentTree();
        updatePointCount();
    } catch (e) {
        console.error('selectBuild', e);
    }
}

function showEditor() {
    document.getElementById('buildsEditor').style.display = '';
    document.getElementById('buildsEditorEmpty').style.display = 'none';
}
function hideEditor() {
    document.getElementById('buildsEditor').style.display = 'none';
    document.getElementById('buildsEditorEmpty').style.display = '';
}

async function saveCurrentBuild() {
    const name = document.getElementById('buildName').value.trim();
    if (!name) { alert('Build name is required'); return; }

    const talents = [];
    buildsState.talents.forEach((data, talentId) => {
        if (data.points > 0) {
            talents.push({
                talentId,
                points: data.points,
                talentOrder: data.talentOrder,
                perkId: data.perkId || null,
            });
        }
    });

    const payload = {
        buildId: buildsState.selectedBuildId,
        buildName: name,
        strength:  parseInt(document.getElementById('buildStr').value)    || 0,
        stamina:   parseInt(document.getElementById('buildSta').value)    || 1,
        agility:   parseInt(document.getElementById('buildAgi').value)    || 0,
        luck:      parseInt(document.getElementById('buildLck').value)    || 0,
        armor:     parseInt(document.getElementById('buildArm').value)    || 0,
        minDamage: parseInt(document.getElementById('buildMinDmg').value) || 0,
        maxDamage: parseInt(document.getElementById('buildMaxDmg').value) || 0,
        talents,
    };

    try {
        const token = await getCurrentAccessToken();
        const resp = await fetch('/api/saveBuild', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!resp.ok) { alert('Save failed: ' + (await resp.text())); return; }
        const data = await resp.json();
        if (!data.success) { alert('Save failed'); return; }
        buildsState.selectedBuildId = data.buildId;
        await loadBuildsList();
    } catch (e) {
        alert('Error: ' + e.message);
    }
}

async function deleteCurrentBuild() {
    if (buildsState.selectedBuildId == null) return;
    if (!confirm('Delete this build? It will also be removed from any rankings.')) return;
    try {
        const token = await getCurrentAccessToken();
        const resp = await fetch('/api/deleteBuild', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ buildId: buildsState.selectedBuildId }),
        });
        if (!resp.ok) { alert('Delete failed'); return; }
        buildsState.selectedBuildId = null;
        hideEditor();
        await loadBuildsList();
    } catch (e) {
        alert('Error: ' + e.message);
    }
}

// ──────────────────────────────────────────────────────────────────
// Talent tree (reuses .ct-* classes from combat-tester.css for styling)
// ──────────────────────────────────────────────────────────────────

function getBuildTalents() {
    return typeof getTalents === 'function' ? getTalents() : [];
}

function renderTalentTree() {
    const grid = document.getElementById('buildTalentTree');
    if (!grid) return;
    grid.innerHTML = '';

    const talents = getBuildTalents();
    if (!talents.length) {
        grid.innerHTML = '<div class="ct-empty">No talents loaded yet</div>';
        return;
    }

    talents.forEach(talent => {
        const row = talent.row || 1;
        const col = talent.col || 1;
        if (row < 1 || row > 8 || col < 1 || col > 7) return;

        const wrapper = document.createElement('div');
        wrapper.className = 'ct-cell-wrapper';
        wrapper.style.gridRow = String(9 - row);
        wrapper.style.gridColumn = String(col);

        const cell = document.createElement('div');
        cell.className = 'ct-cell';
        cell.dataset.talentId = talent.talentId;

        const iconUrl = (typeof window.buildPublicAssetUrl === 'function')
            ? window.buildPublicAssetUrl(`images/perks/${talent.assetId}.webp`)
            : `https://pub-b959ac8ae579488bb4ed33c01a618ae2.r2.dev/images/perks/${talent.assetId}.webp`;
        const hasPerkSlot = talent.perkSlot === true || talent.perkSlot > 0;

        cell.innerHTML = `
            <div class="ct-points"><span class="ct-current">0</span>/${talent.maxPoints}</div>
            <img class="ct-icon" src="${iconUrl}" alt="" onerror="this.style.display='none'">
            ${hasPerkSlot ? '<div class="ct-perk-indicator">P</div>' : ''}
        `;

        cell.addEventListener('click', () => upgradeBuildTalent(talent.talentId));
        cell.addEventListener('contextmenu', (e) => { e.preventDefault(); downgradeBuildTalent(talent.talentId); });

        const label = document.createElement('div');
        label.className = 'ct-label';
        label.textContent = talent.talentName || '';

        wrapper.appendChild(cell);
        wrapper.appendChild(label);
        grid.appendChild(wrapper);
        updateTalentCell(talent.talentId);
    });
}

function isTalentUnlocked(talentId) {
    const talents = getBuildTalents();
    const target = talents.find(t => t.talentId === talentId);
    if (!target) return false;

    const row = target.row || 1;
    const col = target.col || 1;
    if (row <= 1) return true; // Bottom row is the starting row.

    const neighbors = talents.filter(t => {
        const nr = t.row || 1;
        const nc = t.col || 1;
        const dr = Math.abs(nr - row);
        const dc = Math.abs(nc - col);
        return dr + dc === 1;
    });

    return neighbors.some(n => {
        const state = buildsState.talents.get(n.talentId);
        return !!state && state.points >= (n.maxPoints || 0);
    });
}

function totalPointsSpent() {
    let n = 0;
    buildsState.talents.forEach(t => { n += t.points || 0; });
    return n;
}

function refreshTalentCells() {
    getBuildTalents().forEach(t => updateTalentCell(t.talentId));
}

function updatePointCount() {
    const el = document.getElementById('buildPointCount');
    if (el) el.textContent = `${totalPointsSpent()} / 70`;
}

function upgradeBuildTalent(talentId) {
    const talent = getBuildTalents().find(t => t.talentId === talentId);
    if (!talent) return;
    const cur = buildsState.talents.get(talentId) || { points: 0, talentOrder: 0, perkId: null };
    if (cur.points <= 0 && !isTalentUnlocked(talentId)) {
        return;
    }
    if (totalPointsSpent() >= 70) {
        return;
    }
    if (cur.points >= talent.maxPoints) return;

    buildsState.talentOrderSeq++;
    const newPoints = cur.points + 1;
    buildsState.talents.set(talentId, {
        points: newPoints,
        talentOrder: cur.talentOrder || buildsState.talentOrderSeq,
        perkId: cur.perkId || null,
    });
    refreshTalentCells();
    updatePointCount();

    if (newPoints >= talent.maxPoints && (talent.perkSlot === true || talent.perkSlot > 0)) {
        showBuildPerkModal(talent);
    }
}

function downgradeBuildTalent(talentId) {
    const talent = getBuildTalents().find(t => t.talentId === talentId);
    if (!talent) return;
    const cur = buildsState.talents.get(talentId);
    if (!cur || cur.points <= 0) return;
    const newPoints = cur.points - 1;
    if (newPoints <= 0) {
        buildsState.talents.delete(talentId);
    } else {
        buildsState.talents.set(talentId, {
            points: newPoints,
            talentOrder: cur.talentOrder,
            perkId: newPoints < talent.maxPoints ? null : cur.perkId,
        });
    }
    refreshTalentCells();
    updatePointCount();
}

function updateTalentCell(talentId) {
    const cell = document.querySelector(`#buildTalentTree .ct-cell[data-talent-id="${talentId}"]`);
    if (!cell) return;
    const talent = getBuildTalents().find(t => t.talentId === talentId);
    const cur = buildsState.talents.get(talentId) || { points: 0, perkId: null };
    const span = cell.querySelector('.ct-current');
    if (span) span.textContent = cur.points;
    const isLocked = cur.points <= 0 && !isTalentUnlocked(talentId);
    cell.classList.toggle('builds-talent-locked', isLocked);
    cell.classList.toggle('has-points', cur.points > 0);
    cell.classList.toggle('maxed', talent && cur.points >= talent.maxPoints);
    const ind = cell.querySelector('.ct-perk-indicator');
    if (ind) ind.classList.toggle('assigned', !!cur.perkId);
}

function showBuildPerkModal(talent) {
    const cur = buildsState.talents.get(talent.talentId) || { perkId: null };
    const perks = buildsState.perks || [];
    const modal = document.createElement('div');
    modal.className = 'ct-modal-overlay ct-perk-overlay';
    modal.innerHTML = `
        <div class="ct-modal">
            <div class="ct-modal-header">
                <h3>Select Perk for ${escBHtml(talent.talentName)}</h3>
                <button type="button" class="btn-close">✕</button>
            </div>
            <div class="ct-modal-body">
                <select class="ct-perk-select">
                    <option value="">-- No Perk --</option>
                    ${perks.map(p => `<option value="${p.id}" ${p.id === cur.perkId ? 'selected' : ''}>${escBHtml(p.name)}</option>`).join('')}
                </select>
            </div>
            <div class="ct-modal-actions">
                <button type="button" class="btn-confirm">Confirm</button>
                <button type="button" class="btn-cancel">Cancel</button>
            </div>
        </div>
    `;
    const close = () => modal.remove();
    modal.querySelector('.btn-close').addEventListener('click', close);
    modal.querySelector('.btn-cancel').addEventListener('click', close);
    modal.addEventListener('click', e => { if (e.target === modal) close(); });
    modal.querySelector('.btn-confirm').addEventListener('click', () => {
        const sel = modal.querySelector('.ct-perk-select').value;
        const perkId = sel ? parseInt(sel, 10) : null;
        const data = buildsState.talents.get(talent.talentId);
        if (data) {
            buildsState.talents.set(talent.talentId, { ...data, perkId });
            updateTalentCell(talent.talentId);
        }
        close();
    });
    document.body.appendChild(modal);
}

// ──────────────────────────────────────────────────────────────────
// Tournament runs
// ──────────────────────────────────────────────────────────────────

async function loadBuildRunsList() {
    try {
        const token = await getCurrentAccessToken();
        if (!token) return;
        const resp = await fetch('/api/getBuildRuns', {
            headers: { 'Authorization': `Bearer ${token}` },
        });
        if (!resp.ok) return;
        const data = await resp.json();
        if (!data.success) return;
        buildsState.runs = data.runs || [];
        renderRunsList();
    } catch (e) {
        console.error('loadBuildRunsList', e);
    }
}

function renderRunsList() {
    const el = document.getElementById('buildsRunsList');
    if (!buildsState.runs.length) {
        el.innerHTML = '<div class="builds-empty">No runs yet</div>';
        return;
    }
    el.innerHTML = buildsState.runs.map(r => {
        const isActive = r.runId === buildsState.selectedRunId ? 'builds-run-row-active' : '';
        const date = formatBuildsDate(r.createdAt);
        return `
            <div class="builds-run-row ${isActive}" data-id="${r.runId}">
                <div class="builds-run-id">#${r.runId} · ${date}</div>
                <button type="button" class="builds-run-del" data-id="${r.runId}" title="Delete">✕</button>
            </div>
        `;
    }).join('');
    el.querySelectorAll('.builds-run-row').forEach(row => {
        row.addEventListener('click', () => selectRun(parseInt(row.dataset.id, 10)));
    });
    el.querySelectorAll('.builds-run-del').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            deleteRun(parseInt(btn.dataset.id, 10));
        });
    });
}

async function startBuildRun() {
    const rounds = parseInt(document.getElementById('buildsRounds').value) || 6;
    const fightsPerPair = parseInt(document.getElementById('buildsFightsPerPair').value) || 20;
    const btn = document.getElementById('buildsStartRunBtn');
    btn.disabled = true;
    try {
        const token = await getCurrentAccessToken();
        const resp = await fetch('/api/startBuildRun', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ rounds, fightsPerPair }),
        });
        if (!resp.ok) {
            alert('Failed: ' + (await resp.text()));
            btn.disabled = false;
            return;
        }
        const data = await resp.json();
        buildsState.selectedRunId = data.runId;
        buildsState.runStartedAt = Date.now();
        showRankings();
        startRunPoll();
        await loadBuildRunsList();
    } catch (e) {
        alert('Error: ' + e.message);
    } finally {
        btn.disabled = false;
    }
}

function startRunPoll() {
    if (buildsState.runPollHandle) clearInterval(buildsState.runPollHandle);
    buildsState.runPollHandle = setInterval(pollRun, 1000);
    pollRun();
}

async function pollRun() {
    if (!buildsState.selectedRunId) return;
    try {
        const token = await getCurrentAccessToken();
        const resp = await fetch(`/api/getBuildRun?id=${buildsState.selectedRunId}`, {
            headers: { 'Authorization': `Bearer ${token}` },
        });
        if (!resp.ok) return;
        const data = await resp.json();
        if (!data.success) return;
        const run = data.run;
        renderRunProgress(run);
        renderMilestones(run);
        renderRankingsForMilestone(run);
        if (run.status !== 'running') {
            clearInterval(buildsState.runPollHandle);
            buildsState.runPollHandle = null;
            await loadBuildRunsList();
        }
    } catch (e) {
        console.error('pollRun', e);
    }
}

async function selectRun(id) {
    buildsState.selectedRunId = id;
    renderRunsList();
    showRankings();
    try {
        const token = await getCurrentAccessToken();
        const resp = await fetch(`/api/getBuildRun?id=${id}`, {
            headers: { 'Authorization': `Bearer ${token}` },
        });
        if (!resp.ok) return;
        const data = await resp.json();
        if (!data.success) return;
        const run = data.run;
        const ms = (run.config && run.config.milestones) || [];
        buildsState.selectedMilestone = ms[ms.length - 1] || 70;
        buildsState.runStartedAt = new Date(run.createdAt).getTime();
        renderRunProgress(run);
        renderMilestones(run);
        renderRankingsForMilestone(run);
        if (run.status === 'running') startRunPoll();
    } catch (e) {
        console.error('selectRun', e);
    }
}

async function deleteRun(id) {
    if (!confirm(`Delete run #${id}?`)) return;
    try {
        const token = await getCurrentAccessToken();
        const resp = await fetch('/api/deleteBuildRun', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ runId: id }),
        });
        if (!resp.ok) { alert('Delete failed'); return; }
        if (buildsState.selectedRunId === id) {
            buildsState.selectedRunId = null;
            document.getElementById('buildsRankings').style.display = 'none';
        }
        await loadBuildRunsList();
    } catch (e) {
        alert('Error: ' + e.message);
    }
}

function showRankings() {
    document.getElementById('buildsRankings').style.display = '';
}

function renderRunProgress(run) {
    document.getElementById('buildsRunLabel').textContent =
        `Run #${run.runId} · ${run.config?.rounds ?? '-'} rounds · ${run.config?.fightsPerPair ?? '-'} fights/pair`;
    const wrap = document.getElementById('buildsProgress');
    if (run.status === 'running') {
        wrap.style.display = '';
        const total = run.totalMatches || 1;
        const done = Math.min(run.completedMatches, total);
        const pct = (done / total) * 100;
        document.getElementById('buildsProgressFill').style.width = pct.toFixed(1) + '%';
        document.getElementById('buildsProgressText').textContent =
            `${done} / ${total} matches  (${pct.toFixed(1)}%) · day ${run.currentMilestone || '-'}`;
        if (done > 0) {
            const elapsed = (Date.now() - buildsState.runStartedAt) / 1000;
            const eta = (total - done) * (elapsed / done);
            document.getElementById('buildsProgressEta').textContent = `ETA: ${formatBuildsDuration(eta)}`;
        } else {
            document.getElementById('buildsProgressEta').textContent = '';
        }
    } else {
        wrap.style.display = 'none';
    }
}

function renderMilestones(run) {
    const ms = (run.config && run.config.milestones) || [];
    const el = document.getElementById('buildsMilestones');
    el.innerHTML = ms.map(d => {
        const cls = d === buildsState.selectedMilestone ? 'builds-milestone-active' : '';
        return `<button type="button" class="builds-milestone ${cls}" data-day="${d}">Day ${d}</button>`;
    }).join('');
    el.querySelectorAll('.builds-milestone').forEach(btn => {
        btn.addEventListener('click', () => {
            buildsState.selectedMilestone = parseInt(btn.dataset.day, 10);
            renderMilestones(run);
            renderRankingsForMilestone(run);
        });
    });
}

function renderRankingsForMilestone(run) {
    const tbody = document.getElementById('buildsRankingsBody');
    const day = buildsState.selectedMilestone;
    const all = run.results || [];
    const slice = all.filter(r => r.milestoneDay === day)
                     .sort((a, b) => (a.rank || 9999) - (b.rank || 9999));

    if (!slice.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="builds-empty">No results yet for this milestone…</td></tr>';
        return;
    }

    // Pre-index trace per build (rating across all milestones).
    const traceByBuild = new Map();
    all.forEach(r => {
        if (!traceByBuild.has(r.buildId)) traceByBuild.set(r.buildId, []);
        traceByBuild.get(r.buildId).push({ day: r.milestoneDay, rating: r.rating });
    });

    tbody.innerHTML = slice.map(r => {
        const total = r.wins + r.losses;
        const winPct = total > 0 ? ((r.wins / total) * 100).toFixed(1) + '%' : '-';
        const trace = (traceByBuild.get(r.buildId) || [])
            .sort((a, b) => a.day - b.day)
            .map(t => Math.round(t.rating))
            .join(' → ');
        return `
            <tr>
                <td class="builds-rank">${r.rank || '-'}</td>
                <td class="builds-name">${escBHtml(r.buildName || ('#' + r.buildId))}</td>
                <td class="builds-rating">${Math.round(r.rating)}</td>
                <td>${r.wins}</td>
                <td>${r.losses}</td>
                <td>${winPct}</td>
                <td class="builds-trace" title="${trace}">${trace}</td>
            </tr>
        `;
    }).join('');
}

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

function escBHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
}

function formatBuildsDuration(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '-';
    if (seconds < 60) return seconds.toFixed(0) + 's';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    if (m < 60) return `${m}m ${s}s`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
}

function formatBuildsDate(iso) {
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
