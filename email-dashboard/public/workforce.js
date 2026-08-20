const kpiGrid = document.getElementById('kpiGrid');
const wfTabs = document.getElementById('wfTabs');
const VIEWS = ['overview', 'directory', 'joining', 'exit', 'attrition', 'tenure', 'movement', 'insights', 'quality'];
const viewEls = Object.fromEntries(VIEWS.map((v) => [v, document.getElementById(v + 'View')]));
const bottomNavOverviewBtn = document.querySelector('.bottom-nav-item[data-jump="overview"]');
const bottomNavWorkforceBtn = document.getElementById('bottomNavWorkforceBtn');

const wfSearch = document.getElementById('wfSearch');
const filterStatus = document.getElementById('filterStatus');
const filterEmploymentType = document.getElementById('filterEmploymentType');
const filterDepartment = document.getElementById('filterDepartment');
const filterLocation = document.getElementById('filterLocation');
const clearFiltersBtn = document.getElementById('clearFilters');
const resultSummary = document.getElementById('resultSummary');
const employeeTableBody = document.getElementById('employeeTableBody');

let activeFilters = {};
let searchDebounce;
let currentRequestId = 0;
let activeView = 'overview';
const loadedViews = new Set();
const charts = {};

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------- Icons ----------
const ICONS = {
  total: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  active: '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M20 8l2 2 4-4"/>',
  notice: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  inactive: '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M18 8l4 4M22 8l-4 4"/>',
  probation: '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M21 3l1.5 3 3.5.5-2.5 2.4.6 3.6-3.1-1.7-3.1 1.7.6-3.6L16 6.5l3.5-.5z"/>',
  confirmed: '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M17 11l2 2 4-4"/>',
  department: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  location: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 17a2.5 2.5 0 0 0 2.5-2.5c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7.5 7.5 0 1 1-15 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2 5z"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  tool: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  building: '<rect x="4" y="2" width="16" height="20" rx="1"/><path d="M9 22v-4h6v4"/><path d="M9 6h1M14 6h1M9 10h1M14 10h1M9 14h1M14 14h1"/>',
  box: '<path d="M12.89 1.45l8 4A2 2 0 0 1 22 7.24v9.53a2 2 0 0 1-1.11 1.79l-8 4a2 2 0 0 1-1.79 0l-8-4a2 2 0 0 1-1.11-1.79V7.24a2 2 0 0 1 1.11-1.79l8-4a2 2 0 0 1 1.79 0z"/><path d="M2.32 6.16L12 11l9.68-4.84"/><path d="M12 22.5V11"/>',
  leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>'
};

// Real department names come straight off the sheet (e.g. "MEP DEPT.",
// "FACADE DEPT.", "FIRE", "ADMINISTRATION (HO)") rather than clean labels
// like the mockup's "Construction"/"Finance" - so icons are matched by
// keyword against the actual names, most-specific rule first, generic
// bar-chart icon as the fallback for anything unmatched.
const DEPARTMENT_ICON_RULES = [
  { test: /\bfire\b/i, icon: 'flame' },
  { test: /security/i, icon: 'shield' },
  { test: /health\s*safety|environment|quality/i, icon: 'shield' },
  { test: /\bmep\b|plant\s*&?\s*machinery|machinery|electrical|mechanical|plumbing/i, icon: 'tool' },
  { test: /facade|civil|structure|architecture|surveyor|planning|scaffold|contracts?\b|qs\s*&\s*billing/i, icon: 'building' },
  { test: /horticulture/i, icon: 'leaf' },
  { test: /store|purchase|godown/i, icon: 'box' },
  { test: /sales|marketing|business development|branding|communication/i, icon: 'total' },
  { test: /finance|accounts?|budget|banking/i, icon: 'department' },
  { test: /\bhr\b|human resource/i, icon: 'confirmed' },
  { test: /information\s*&?\s*technology|\bit\b|digital|tech/i, icon: 'monitor' },
  { test: /admin/i, icon: 'settings' },
  { test: /construction|site|project/i, icon: 'user' }
];
function deptIconFor(name) {
  const match = DEPARTMENT_ICON_RULES.find((r) => r.test.test(name || ''));
  return match ? match.icon : 'department';
}
function icon(name, size) {
  return '<svg viewBox="0 0 24 24" width="' + (size || 20) + '" height="' + (size || 20) +
    '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    ICONS[name] + '</svg>';
}

function chartColors() {
  const styles = getComputedStyle(document.documentElement);
  const get = (name) => styles.getPropertyValue(name).trim();
  return {
    ink: get('--ink'),
    muted: get('--muted'),
    line: get('--line'),
    accent: get('--accent'),
    important: get('--important'),
    resolved: get('--resolved'),
    warning: get('--warning'),
    candidate: get('--candidate'),
    surface: get('--surface')
  };
}

function destroyChart(key) {
  if (charts[key]) {
    charts[key].destroy();
    delete charts[key];
  }
}

// ---------- Navigation ----------

const refreshBtn = document.getElementById('refreshBtn');
refreshBtn.addEventListener('click', async () => {
  if (refreshBtn.classList.contains('spinning')) return;
  refreshBtn.classList.add('spinning');
  refreshBtn.disabled = true;
  loadedViews.clear();
  try {
    await loadView(activeView, true);
  } finally {
    refreshBtn.classList.remove('spinning');
    refreshBtn.disabled = false;
  }
});

wfTabs.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-view]');
  if (!btn) return;
  setView(btn.dataset.view);
});

document.addEventListener('click', (e) => {
  const jumpBtn = e.target.closest('[data-jump]');
  if (!jumpBtn) return;
  const target = jumpBtn.dataset.jump;
  if (target === 'directory' && jumpBtn.dataset.status) {
    activeFilters = { status: jumpBtn.dataset.status };
    filterStatus.value = jumpBtn.dataset.status;
  }
  setView(target);
});

if (bottomNavOverviewBtn) bottomNavOverviewBtn.addEventListener('click', () => setView('overview'));

function setView(view) {
  if (!VIEWS.includes(view)) return;
  activeView = view;
  wfTabs.querySelectorAll('[data-view]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.view === view));
  });
  VIEWS.forEach((v) => { viewEls[v].hidden = v !== view; });
  // Overview and Workforce Intelligence are mutually exclusive in the bottom
  // nav: Overview lights up only on that tab, Workforce Intelligence lights
  // up for every other tab — never both at once.
  const onOverview = view === 'overview';
  if (bottomNavOverviewBtn) bottomNavOverviewBtn.setAttribute('aria-current', String(onOverview));
  if (bottomNavWorkforceBtn) bottomNavWorkforceBtn.setAttribute('aria-current', String(!onOverview));
  loadView(view, false);
}

function loadView(view, forceRefresh) {
  if (!forceRefresh && loadedViews.has(view)) return Promise.resolve();
  loadedViews.add(view);
  if (view === 'overview') return loadOverview(forceRefresh);
  if (view === 'directory') return loadEmployees(forceRefresh);
  if (view === 'joining') return loadJoiningView(12);
  if (view === 'tenure') return loadTenureView();
  if (view === 'insights') return loadInsightsView();
  if (view === 'quality') return loadQualityView();
  // exit / attrition / movement are static "not available" panels — nothing to fetch.
  return Promise.resolve();
}

// ---------- Overview ----------

function kpiCard({ key, label, value, tone, icon: iconName, clickable, title, live }) {
  const isNa = value === null || value === undefined;
  const displayValue = isNa ? 'N/A' : value;
  return (
    '<button class="kpi-card' + (tone ? ' tone-' + tone : '') + '" data-kpi="' + key + '"' +
      (clickable === false || isNa ? ' disabled' : '') +
      (title ? ' title="' + escapeHtml(title) + '"' : '') +
    '>' +
      '<span class="kpi-icon">' + icon(iconName) + '</span>' +
      '<span class="kpi-body">' +
        '<span class="kpi-label">' + escapeHtml(label) +
          (live ? '<span class="live-dot" title="Live"></span>' : '') +
        '</span>' +
        '<span class="kpi-num' + (isNa ? ' na' : '') + '">' + displayValue + '</span>' +
      '</span>' +
    '</button>'
  );
}

async function loadOverview(forceRefresh) {
  const loadingEl = document.getElementById('overviewLoading');
  const contentEl = document.getElementById('overviewContent');
  loadingEl.hidden = false;
  contentEl.hidden = true;
  try {
    const [overview, activeBreakdowns, trend, insights] = await Promise.all([
      fetchJson('/api/workforce/overview' + (forceRefresh ? '?refresh=1' : '')),
      fetchJson('/api/workforce/breakdowns?status=ACTIVE'),
      fetchJson('/api/workforce/joining-trend?months=12'),
      fetchJson('/api/workforce/insights')
    ]);

    kpiGrid.innerHTML =
      kpiCard({ key: 'active', label: 'Active Employees', value: overview.active, tone: 'active', icon: 'active', live: true }) +
      kpiCard({ key: 'total', label: 'Total Employees', value: overview.total, tone: 'accent', icon: 'total' }) +
      kpiCard({ key: 'notice', label: 'Notice Period', value: overview.noticePeriod, tone: 'notice', icon: 'notice' }) +
      kpiCard({ key: 'inactive', label: 'Inactive Employees', value: overview.inactive, tone: 'inactive', icon: 'inactive' });

    renderStatusDonut(overview);
    renderEmploymentTypeStats(overview);
    renderDeptBarList(activeBreakdowns.departments.slice(0, 6), overview.active);
    renderLocationDonut(activeBreakdowns.locations);
    renderJoiningLine('joiningLineChart', trend.buckets);
    renderInsightsPreview(insights.insights);
    loadingEl.hidden = true;
    contentEl.hidden = false;
  } catch (err) {
    loadingEl.hidden = true;
    contentEl.hidden = false;
    kpiGrid.innerHTML = '<div class="error-banner">' + escapeHtml(err.message) + '</div>';
  }
}

kpiGrid.addEventListener('click', (e) => {
  const card = e.target.closest('[data-kpi]');
  if (!card || card.disabled) return;
  const filterMap = {
    total: {},
    active: { status: 'ACTIVE' },
    notice: { status: 'NOTICE PERIOD' },
    inactive: { status: 'INACTIVE' }
  };
  applyFiltersAndShowDirectory(filterMap[card.dataset.kpi] || {});
});

function applyFiltersAndShowDirectory(filters) {
  activeFilters = filters;
  filterStatus.value = filters.status || '';
  filterEmploymentType.value = filters.employmentType || '';
  filterDepartment.value = filters.department || '';
  filterLocation.value = filters.location || '';
  wfSearch.value = filters.q || '';
  setView('directory');
}

function renderStatusDonut(overview) {
  const c = chartColors();
  destroyChart('statusDonut');
  const ctx = document.getElementById('statusDonut');
  charts.statusDonut = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Active', 'Notice Period', 'Inactive'],
      datasets: [{
        data: [overview.active, overview.noticePeriod, overview.inactive],
        backgroundColor: [c.resolved, c.warning, c.important],
        borderWidth: 0
      }]
    },
    options: {
      cutout: '68%',
      plugins: { legend: { display: false }, tooltip: { enabled: true } }
    }
  });

  const total = overview.total || 1;
  const pct = (n) => Math.round((n / total) * 1000) / 10;
  document.getElementById('statusLegend').innerHTML =
    legendRow(c.resolved, 'Active', overview.active, pct(overview.active)) +
    legendRow(c.resolved, 'Probation', overview.activeProbation, pct(overview.activeProbation), true) +
    legendRow(c.resolved, 'Confirmed', overview.activeConfirmed, pct(overview.activeConfirmed), true) +
    legendRow(c.warning, 'Notice Period', overview.noticePeriod, pct(overview.noticePeriod)) +
    legendRow(c.important, 'Inactive', overview.inactive, pct(overview.inactive));
}

function legendRow(color, label, value, pct, sub) {
  return (
    '<li' + (sub ? ' class="sub"' : '') + '>' +
      '<span class="wf-legend-dot' + (sub ? ' outline' : '') + '" style="' + (sub ? 'color:' + color : 'background:' + color) + '"></span>' +
      '<span class="wf-legend-name">' + escapeHtml(label) + '</span>' +
      '<span class="wf-legend-value">' + value + '</span>' +
      '<span class="wf-legend-pct">(' + pct + '%)</span>' +
    '</li>'
  );
}

function renderEmploymentTypeStats(overview) {
  const probation = overview.activeProbation;
  const confirmed = overview.activeConfirmed;
  const total = probation + confirmed || 1;
  const probPct = Math.round((probation / total) * 1000) / 10;
  const confPct = Math.round((confirmed / total) * 1000) / 10;
  document.getElementById('employmentTypeStats').innerHTML =
    '<div>' +
      '<div class="stat-icon probation">' + icon('probation', 20) + '</div>' +
      '<div class="stat-label">Probation</div>' +
      '<div class="stat-num">' + probation + '</div>' +
      '<div class="stat-pct">(' + probPct + '%)</div>' +
    '</div>' +
    '<div class="stat-divider"></div>' +
    '<div>' +
      '<div class="stat-icon confirmed">' + icon('confirmed', 20) + '</div>' +
      '<div class="stat-label">Confirmed</div>' +
      '<div class="stat-num">' + confirmed + '</div>' +
      '<div class="stat-pct">(' + confPct + '%)</div>' +
    '</div>';
}

function renderDeptBarList(rows, shareTotal) {
  const max = rows.length ? rows[0].count : 1;
  document.getElementById('deptBarList').innerHTML = rows.length
    ? rows.map((r) => barListItem(deptIconFor(r.name), r.name, r.count, max, shareTotal)).join('')
    : '<li class="empty">No department data</li>';
}

function barListItem(iconName, name, count, max, shareTotal) {
  const pct = Math.max(4, Math.round((count / max) * 100));
  const share = shareTotal ? Math.round((count / shareTotal) * 1000) / 10 : null;
  return (
    '<li>' +
      '<span class="wf-bar-icon">' + icon(iconName, 18) + '</span>' +
      '<span class="wf-bar-main">' +
        '<span class="wf-bar-name">' + escapeHtml(name) + '</span>' +
        '<span class="wf-bar-track"><span class="wf-bar-fill" style="width:' + pct + '%"></span></span>' +
      '</span>' +
      '<span class="wf-bar-count">' + count + '</span>' +
      (share !== null ? '<span class="wf-bar-pct">(' + share + '%)</span>' : '') +
    '</li>'
  );
}

function renderLocationDonut(rows) {
  const c = chartColors();
  const palette = [c.accent, c.resolved, c.warning, c.candidate, c.important, c.muted];
  const top = rows.slice(0, 6);
  const total = rows.reduce((sum, r) => sum + r.count, 0) || 1;

  destroyChart('locationDonut');
  const ctx = document.getElementById('locationDonut');
  charts.locationDonut = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: top.map((r) => r.name),
      datasets: [{ data: top.map((r) => r.count), backgroundColor: top.map((_, i) => palette[i % palette.length]), borderWidth: 0 }]
    },
    options: { cutout: '68%', plugins: { legend: { display: false } } }
  });

  document.getElementById('locationLegend').innerHTML = top.length
    ? top.map((r, i) => legendRow(palette[i % palette.length], r.name, r.count, Math.round((r.count / total) * 1000) / 10)).join('')
    : '<li class="empty">No location data</li>';
}

const joiningValueLabelsPlugin = {
  id: 'joiningValueLabels',
  afterDatasetsDraw(chart) {
    const meta = chart.getDatasetMeta(0);
    const values = chart.data.datasets[0].data;
    const ctx = chart.ctx;
    ctx.save();
    ctx.font = '600 11px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = chartColors().ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    meta.data.forEach((point, i) => {
      const value = values[i];
      if (value === null || value === undefined) return;
      ctx.fillText(String(value), point.x, point.y - 10);
    });
    ctx.restore();
  }
};

function renderJoiningLine(canvasId, buckets) {
  const c = chartColors();
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.clientHeight || 220);
  gradient.addColorStop(0, c.accent + '3d');
  gradient.addColorStop(1, c.accent + '00');

  charts[canvasId] = new Chart(ctx, {
    type: 'line',
    data: {
      labels: buckets.map((b) => b.label),
      datasets: [{
        data: buckets.map((b) => b.count),
        borderColor: c.accent,
        backgroundColor: gradient,
        pointBackgroundColor: c.accent,
        pointBorderColor: c.surface,
        pointBorderWidth: 1.5,
        pointRadius: 4,
        pointHoverRadius: 6,
        borderWidth: 2,
        fill: true,
        tension: 0.35
      }]
    },
    options: {
      layout: { padding: { top: 22 } },
      plugins: { legend: { display: false }, tooltip: { enabled: true } },
      scales: {
        x: { grid: { display: false }, ticks: { color: c.muted, font: { size: 10 } } },
        y: { beginAtZero: true, grid: { color: c.line }, ticks: { color: c.muted, font: { size: 10 } } }
      }
    },
    plugins: [joiningValueLabelsPlugin]
  });
}

function renderInsightsPreview(insights) {
  const el = document.getElementById('insightsPreview');
  el.innerHTML = insights.length
    ? insights.slice(0, 4).map((i) => '<li>' + escapeHtml(i.text) + '</li>').join('')
    : '<li class="empty">No insights yet</li>';
}

// ---------- Employee Data ----------

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to load');
  return res.json();
}

async function loadFilterOptions() {
  try {
    const data = await fetchJson('/api/workforce/filters');
    data.departments.forEach((d) => filterDepartment.add(new Option(d, d)));
    data.locations.forEach((l) => filterLocation.add(new Option(l, l)));
  } catch {
    // Filter dropdowns just stay at "All" — not fatal.
  }
}

[wfSearch].forEach((el) => {
  el.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      activeFilters = { ...activeFilters, q: wfSearch.value.trim() };
      loadEmployees();
    }, 300);
  });
});

[filterStatus, filterEmploymentType, filterDepartment, filterLocation].forEach((el) => {
  el.addEventListener('change', () => {
    activeFilters = {
      ...activeFilters,
      status: filterStatus.value,
      employmentType: filterEmploymentType.value,
      department: filterDepartment.value,
      location: filterLocation.value
    };
    loadEmployees();
  });
});

clearFiltersBtn.addEventListener('click', () => {
  activeFilters = {};
  wfSearch.value = '';
  filterStatus.value = '';
  filterEmploymentType.value = '';
  filterDepartment.value = '';
  filterLocation.value = '';
  loadEmployees();
});

async function loadEmployees(forceRefresh) {
  const requestId = ++currentRequestId;
  employeeTableBody.innerHTML =
    '<tr><td colspan="9"><div class="loading"><div class="spinner"></div></div></td></tr>';
  const params = new URLSearchParams();
  Object.entries(activeFilters).forEach(([k, v]) => {
    if (v) params.set(k, v);
  });
  if (forceRefresh) params.set('refresh', '1');
  try {
    const data = await fetchJson('/api/workforce/employees?' + params.toString());
    if (requestId !== currentRequestId) return;
    renderEmployees(data);
  } catch (err) {
    if (requestId !== currentRequestId) return;
    employeeTableBody.innerHTML =
      '<tr><td colspan="9"><div class="error-banner">' + escapeHtml(err.message) + '</div></td></tr>';
  }
}

function statusChipClass(status) {
  if (status === 'ACTIVE') return 'active';
  if (status === 'NOTICE PERIOD') return 'notice';
  return 'inactive';
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

function renderEmployees(data) {
  resultSummary.textContent =
    data.total + ' employee' + (data.total === 1 ? '' : 's') +
    (data.truncated ? ' (showing first ' + data.items.length + ')' : '');

  if (!data.items.length) {
    employeeTableBody.innerHTML = '<tr><td colspan="9"><div class="empty">No employees match these filters</div></td></tr>';
    return;
  }

  employeeTableBody.innerHTML = data.items
    .map(
      (e) =>
        '<tr>' +
          '<td>' + escapeHtml(e.employeeId) + '</td>' +
          '<td>' + escapeHtml(e.name) + '</td>' +
          '<td>' + escapeHtml(e.department) + '</td>' +
          '<td>' + escapeHtml(e.designation) + '</td>' +
          '<td>' + escapeHtml(e.location) + '</td>' +
          '<td>' + formatDate(e.doj) + '</td>' +
          '<td><span class="wf-status-chip ' + statusChipClass(e.status) + '">' + escapeHtml(e.status) + '</span></td>' +
          '<td>' + escapeHtml(e.employmentType) + '</td>' +
          '<td>' + escapeHtml(e.reportingManager) + '</td>' +
        '</tr>'
    )
    .join('');
}

// ---------- Joining tab ----------

document.getElementById('joiningRangePills').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-months]');
  if (!btn) return;
  document.querySelectorAll('#joiningRangePills [data-months]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b === btn));
  });
  loadJoiningView(Number(btn.dataset.months));
});

async function loadJoiningView(months) {
  try {
    const data = await fetchJson('/api/workforce/joining-trend?months=' + months);
    renderJoiningLine('joiningLineChartFull', data.buckets);
  } catch (err) {
    document.getElementById('joiningView').querySelector('.wf-panel').insertAdjacentHTML(
      'beforeend',
      '<div class="error-banner">' + escapeHtml(err.message) + '</div>'
    );
  }
}

// ---------- Tenure tab ----------

async function loadTenureView() {
  const kpisEl = document.getElementById('tenureKpis');
  kpisEl.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const data = await fetchJson('/api/workforce/tenure');
    kpisEl.innerHTML =
      kpiCard({ key: 'avg', label: 'Average Tenure', value: data.averageTenureYears !== null ? data.averageTenureYears + ' yrs' : null, tone: 'accent', icon: 'total', clickable: false }) +
      kpiCard({ key: 'eligible', label: 'Employees Counted', value: data.eligibleCount, tone: 'active', icon: 'active', clickable: false });

    const max = Math.max(1, ...data.buckets.map((b) => b.count));
    document.getElementById('tenureBarList').innerHTML = data.buckets
      .map((b) => barListItem('total', b.label, b.count, max))
      .join('');
    document.getElementById('tenureNote').textContent =
      data.excludedInactiveCount > 0
        ? data.excludedInactiveCount + ' inactive employees excluded — their departure date isn\'t tracked, so tenure can\'t be pinned to an end date.'
        : '';
  } catch (err) {
    kpisEl.innerHTML = '<div class="error-banner">' + escapeHtml(err.message) + '</div>';
  }
}

// ---------- Insights tab ----------

async function loadInsightsView() {
  const listEl = document.getElementById('insightsFull');
  const probBody = document.getElementById('probationTableBody');
  listEl.innerHTML = '<li class="empty">Loading…</li>';
  try {
    const [insights, probation] = await Promise.all([
      fetchJson('/api/workforce/insights'),
      fetchJson('/api/workforce/probation-completing')
    ]);
    listEl.innerHTML = insights.insights.length
      ? insights.insights.map((i) => '<li>' + escapeHtml(i.text) + '</li>').join('')
      : '<li class="empty">No insights yet</li>';

    probBody.innerHTML = probation.items.length
      ? probation.items
          .map(
            (e) =>
              '<tr>' +
                '<td>' + escapeHtml(e.employeeId) + '</td>' +
                '<td>' + escapeHtml(e.name) + '</td>' +
                '<td>' + escapeHtml(e.department) + '</td>' +
                '<td>' + escapeHtml(e.designation) + '</td>' +
                '<td>' + escapeHtml(e.location) + '</td>' +
                '<td>' + formatDate(e.doj) + '</td>' +
                '<td>' + escapeHtml(e.reportingManager) + '</td>' +
              '</tr>'
          )
          .join('')
      : '<tr><td colspan="7"><div class="empty">No one is completing probation this month</div></td></tr>';
  } catch (err) {
    listEl.innerHTML = '<li class="error-banner">' + escapeHtml(err.message) + '</li>';
  }
}

document.getElementById('exportProbationPdf').addEventListener('click', () => {
  window.print();
});

// ---------- Data Quality tab ----------

async function loadQualityView() {
  const kpisEl = document.getElementById('qualityKpis');
  kpisEl.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const data = await fetchJson('/api/workforce/data-quality');
    kpisEl.innerHTML =
      kpiCard({ key: 'total', label: 'Total Records', value: data.total, tone: 'accent', icon: 'total', clickable: false }) +
      kpiCard({ key: 'doj', label: 'Missing DOJ', value: data.missing.doj, tone: data.missing.doj ? 'inactive' : 'confirmed', icon: 'notice', clickable: false }) +
      kpiCard({ key: 'dob', label: 'Missing Date of Birth', value: data.missing.dob, tone: data.missing.dob ? 'notice' : 'confirmed', icon: 'notice', clickable: false }) +
      kpiCard({ key: 'email', label: 'Missing Email', value: data.missing.email, tone: data.missing.email ? 'notice' : 'confirmed', icon: 'notice', clickable: false }) +
      kpiCard({ key: 'dept', label: 'Missing Department', value: data.missing.department, tone: data.missing.department ? 'inactive' : 'confirmed', icon: 'department', clickable: false }) +
      kpiCard({ key: 'dup', label: 'Duplicate Employee IDs', value: data.duplicateIds.length, tone: data.duplicateIds.length ? 'inactive' : 'confirmed', icon: 'total', clickable: false });

    const dupPanel = document.getElementById('duplicatesPanel');
    if (data.duplicateIds.length) {
      dupPanel.hidden = false;
      document.getElementById('duplicatesList').innerHTML = data.duplicateIds
        .map((d) => '<li><span class="wf-bar-main"><span class="wf-bar-name">' + escapeHtml(d.employeeId) + '</span></span><span class="wf-bar-count">' + d.count + 'x</span></li>')
        .join('');
    } else {
      dupPanel.hidden = true;
    }
  } catch (err) {
    kpisEl.innerHTML = '<div class="error-banner">' + escapeHtml(err.message) + '</div>';
  }
}

// ---------- Init ----------

setView('overview');
loadFilterOptions();
