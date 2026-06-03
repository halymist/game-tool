let analyticsState = {
    servers: [],
    selectedServerId: 'all',
    metric: 'players',
    activeWindowDays: 14,
};
let analyticsDashboardInitialized = false;

function registerAnalyticsDashboard() {
    if (!document.getElementById('analytics-content')) return;
    window.initAnalyticsDashboard = initAnalyticsDashboard;
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', registerAnalyticsDashboard);
} else {
    registerAnalyticsDashboard();
}

async function initAnalyticsDashboard() {
    if (analyticsDashboardInitialized) return;
    analyticsDashboardInitialized = true;
    setupAnalyticsListeners();
    await loadAnalyticsOverview();
}

function setupAnalyticsListeners() {
    document.getElementById('analyticsRefreshBtn')?.addEventListener('click', () => loadAnalyticsOverview());
    document.getElementById('analyticsServerFilter')?.addEventListener('change', (event) => {
        analyticsState.selectedServerId = event.target.value || 'all';
        renderAnalyticsDashboard();
    });
    document.getElementById('analyticsMetricSelect')?.addEventListener('change', (event) => {
        analyticsState.metric = event.target.value || 'players';
        renderAnalyticsDashboard();
    });
}

async function loadAnalyticsOverview() {
    const status = document.getElementById('analyticsStatus');
    if (status) {
        status.textContent = 'Loading analytics…';
        status.classList.remove('is-error');
    }

    try {
        const response = await getAuthenticatedJson('/api/getAnalyticsOverview');
        analyticsState.servers = Array.isArray(response?.servers) ? response.servers : [];
        analyticsState.activeWindowDays = Number(response?.activeWindowDays) || 14;
        populateAnalyticsServerFilter();
        renderAnalyticsDashboard();
        if (status) {
            const generatedAt = response?.generatedAt ? formatAnalyticsDateTime(response.generatedAt) : 'just now';
            status.textContent = `Updated ${generatedAt}`;
        }
    } catch (error) {
        console.error('Analytics load failed:', error);
        if (status) {
            status.textContent = typeof normalizeRequestErrorMessage === 'function'
                ? normalizeRequestErrorMessage(error, 'Failed to load analytics.')
                : (error?.message || 'Failed to load analytics.');
            status.classList.add('is-error');
        }
    }
}

function populateAnalyticsServerFilter() {
    const select = document.getElementById('analyticsServerFilter');
    if (!select) return;

    const current = analyticsState.selectedServerId;
    const options = ['<option value="all">All servers</option>']
        .concat(analyticsState.servers.map((server) => {
            return `<option value="${server.serverId}">${analyticsEscape(server.serverName || `Server ${server.serverId}`)}</option>`;
        }));
    select.innerHTML = options.join('');

    const hasCurrent = current === 'all' || analyticsState.servers.some((server) => String(server.serverId) === String(current));
    analyticsState.selectedServerId = hasCurrent ? current : 'all';
    select.value = analyticsState.selectedServerId;
}

function getFilteredAnalyticsServers() {
    if (analyticsState.selectedServerId === 'all') {
        return analyticsState.servers.slice();
    }
    return analyticsState.servers.filter((server) => String(server.serverId) === String(analyticsState.selectedServerId));
}

function renderAnalyticsDashboard() {
    const servers = getFilteredAnalyticsServers();
    renderAnalyticsSummaryCards(servers);
    renderAnalyticsChart(servers);
    renderAnalyticsTable(servers);
}

function renderAnalyticsSummaryCards(servers) {
    const container = document.getElementById('analyticsSummaryCards');
    if (!container) return;

    const playerCount = servers.reduce((sum, server) => sum + Number(server.playerCount || 0), 0);
    const characterCount = servers.reduce((sum, server) => sum + Number(server.characterCount || 0), 0);
    const activeAvailable = servers.some((server) => typeof server.activePlayerCount === 'number');
    const activeCount = activeAvailable ? servers.reduce((sum, server) => sum + Number(server.activePlayerCount || 0), 0) : null;
    const inactiveCount = activeAvailable ? servers.reduce((sum, server) => sum + Number(server.inactivePlayerCount || 0), 0) : null;

    const cards = [
        { label: 'Servers', value: `${servers.length}`, tone: 'neutral' },
        { label: 'Players', value: `${playerCount}`, tone: 'primary' },
        { label: 'Characters', value: `${characterCount}`, tone: 'secondary' },
        { label: `Active (${analyticsState.activeWindowDays}d)`, value: activeCount == null ? '—' : `${activeCount}`, tone: 'success' },
        { label: 'Inactive', value: inactiveCount == null ? '—' : `${inactiveCount}`, tone: 'warning' },
    ];

    container.innerHTML = cards.map((card) => `
        <div class="analytics-summary-card tone-${card.tone}">
            <span class="analytics-summary-label">${analyticsEscape(card.label)}</span>
            <strong class="analytics-summary-value">${analyticsEscape(card.value)}</strong>
        </div>
    `).join('');
}

function renderAnalyticsChart(servers) {
    const empty = document.getElementById('analyticsChartEmpty');
    const chart = document.getElementById('analyticsChart');
    const legend = document.getElementById('analyticsLegend');
    const subtitle = document.getElementById('analyticsChartSubtitle');
    if (!chart || !legend || !subtitle || !empty) return;

    if (!servers.length) {
        chart.innerHTML = '';
        legend.innerHTML = '';
        empty.style.display = '';
        subtitle.textContent = 'No server data available.';
        return;
    }

    empty.style.display = 'none';
    const metric = analyticsState.metric;
    const chartSeries = buildAnalyticsSeries(metric, servers);
    subtitle.textContent = chartSeries.subtitle;
    legend.innerHTML = chartSeries.legend.map((entry) => `
        <span class="analytics-legend-item"><span class="analytics-legend-swatch" style="background:${entry.color}"></span>${analyticsEscape(entry.label)}</span>
    `).join('');

    const maxValue = Math.max(1, ...chartSeries.groups.map((group) => group.segments.reduce((sum, segment) => sum + segment.value, 0)));
    chart.innerHTML = chartSeries.groups.map((group) => {
        const total = group.segments.reduce((sum, segment) => sum + segment.value, 0);
        const stacks = group.segments.map((segment) => {
            const height = total > 0 ? (segment.value / maxValue) * 100 : 0;
            return `<div class="analytics-bar-segment" style="height:${height}%;background:${segment.color}" title="${analyticsEscape(segment.label)}: ${segment.value}"></div>`;
        }).join('');

        return `
            <div class="analytics-bar-group">
                <div class="analytics-bar-stack">${stacks}</div>
                <span class="analytics-bar-total">${total}</span>
                <span class="analytics-bar-label">${analyticsEscape(group.label)}</span>
            </div>
        `;
    }).join('');
}

function buildAnalyticsSeries(metric, servers) {
    if (metric === 'characters') {
        return {
            subtitle: 'Character count per server.',
            legend: [{ label: 'Characters', color: '#0f766e' }],
            groups: servers.map((server) => ({
                label: server.serverName || `Server ${server.serverId}`,
                segments: [{ label: 'Characters', value: Number(server.characterCount || 0), color: '#0f766e' }],
            })),
        };
    }

    if (metric === 'factions') {
        const palette = {
            0: '#94a3b8',
            1: '#2563eb',
            2: '#f59e0b',
            3: '#10b981',
        };
        return {
            subtitle: analyticsState.selectedServerId === 'all'
                ? 'Faction character distribution by server.'
                : 'Faction character distribution for the selected server.',
            legend: [0, 1, 2, 3].map((faction) => ({
                label: analyticsFactionLabel(faction),
                color: palette[faction],
            })),
            groups: servers.map((server) => ({
                label: server.serverName || `Server ${server.serverId}`,
                segments: [0, 1, 2, 3].map((faction) => ({
                    label: analyticsFactionLabel(faction),
                    value: Number((server.factions || []).find((entry) => Number(entry.faction) === faction)?.count || 0),
                    color: palette[faction],
                })),
            })),
        };
    }

    if (metric === 'activity') {
        const activityAvailable = servers.some((server) => typeof server.activePlayerCount === 'number');
        if (!activityAvailable) {
            return {
                subtitle: 'Active/inactive tracking will appear once last-played data is available.',
                legend: [],
                groups: servers.map((server) => ({
                    label: server.serverName || `Server ${server.serverId}`,
                    segments: [],
                })),
            };
        }

        return {
            subtitle: `Player activity split using a ${analyticsState.activeWindowDays}-day active window.`,
            legend: [
                { label: 'Active', color: '#16a34a' },
                { label: 'Inactive', color: '#f97316' },
            ],
            groups: servers.map((server) => ({
                label: server.serverName || `Server ${server.serverId}`,
                segments: [
                    { label: 'Active', value: Number(server.activePlayerCount || 0), color: '#16a34a' },
                    { label: 'Inactive', value: Number(server.inactivePlayerCount || 0), color: '#f97316' },
                ],
            })),
        };
    }

    return {
        subtitle: 'Distinct player count per server.',
        legend: [{ label: 'Players', color: '#2563eb' }],
        groups: servers.map((server) => ({
            label: server.serverName || `Server ${server.serverId}`,
            segments: [{ label: 'Players', value: Number(server.playerCount || 0), color: '#2563eb' }],
        })),
    };
}

function renderAnalyticsTable(servers) {
    const body = document.getElementById('analyticsTableBody');
    if (!body) return;

    if (!servers.length) {
        body.innerHTML = '<tr><td colspan="7" class="analytics-empty-row">No analytics data available.</td></tr>';
        return;
    }

    body.innerHTML = servers.map((server) => {
        const factionSummary = (server.factions || []).map((entry) => `${entry.label}: ${entry.count}`).join(' · ') || '—';
        const activitySummary = typeof server.activePlayerCount === 'number'
            ? `${server.activePlayerCount} / ${server.inactivePlayerCount || 0}`
            : '—';
        return `
            <tr>
                <td>${analyticsEscape(server.serverName || `Server ${server.serverId}`)}</td>
                <td>${server.currentDay || 1}</td>
                <td>${server.playerCount || 0}</td>
                <td>${server.characterCount || 0}</td>
                <td>${activitySummary}</td>
                <td>${analyticsEscape(factionSummary)}</td>
                <td>${analyticsEscape(formatAnalyticsDate(server.createdAt))}</td>
            </tr>
        `;
    }).join('');
}

function analyticsEscape(value) {
    const node = document.createElement('div');
    node.textContent = String(value ?? '');
    return node.innerHTML;
}

function analyticsFactionLabel(faction) {
    const map = { 0: 'Neutral', 1: 'Order', 2: 'Guild', 3: 'Companions' };
    return map[Number(faction)] || `Faction ${faction}`;
}

function formatAnalyticsDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}

function formatAnalyticsDateTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}