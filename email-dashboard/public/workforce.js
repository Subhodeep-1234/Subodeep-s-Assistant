const kpiGrid = document.getElementById('kpiGrid');
const wfDrawer = document.getElementById('wfDrawer');
const wfDrawerBackdrop = document.getElementById('wfDrawerBackdrop');
const menuBtn = document.getElementById('menuBtn');
const VIEWS = [
  'overview', 'directory', 'joining', 'exit', 'attrition', 'tenure', 'movement', 'insights', 'quality',
  'mailReplies', 'mailJoinings', 'profile'
];
const viewEls = Object.fromEntries(VIEWS.map((v) => [v, document.getElementById(v + 'View')]));

const wfSearch = document.getElementById('wfSearch');
const filterStatus = document.getElementById('filterStatus');
const filterEmploymentType = document.getElementById('filterEmploymentType');
const filterDepartment = document.getElementById('filterDepartment');
const filterLocation = document.getElementById('filterLocation');
const filterReportingManager = document.getElementById('filterReportingManager');
const filterCollar = document.getElementById('filterCollar');
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

// Login is open email+OTP, not tied to the HR sheet's employee records, so
// there's no real directory to look a name up in - the closest we can show
// is the email's own local-part turned into a name ("arindam.director@..."
// -> "Arindam Director").
function formatNameFromEmail(email) {
  if (!email) return 'there';
  const local = email.split('@')[0];
  return local
    .split(/[.\-_+]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || local;
}

const PROFILE_NAME_KEY = 'dashboardProfileName';
let currentUserEmail = '';

function getDisplayName(email) {
  const saved = localStorage.getItem(PROFILE_NAME_KEY);
  return saved || formatNameFromEmail(email);
}

function setDisplayName(name) {
  const trimmed = name.trim();
  if (trimmed) localStorage.setItem(PROFILE_NAME_KEY, trimmed);
  else localStorage.removeItem(PROFILE_NAME_KEY);
  const display = getDisplayName(currentUserEmail);
  document.getElementById('greetingName').textContent = display;
  document.getElementById('drawerName').textContent = display;
  renderProfileNameRow();
}

function renderProfileNameRow() {
  const row = document.getElementById('profileNameRow');
  if (!row) return;
  row.innerHTML =
    '<span>' + escapeHtml(getDisplayName(currentUserEmail)) + '</span>' +
    '<button class="wf-icon-btn" id="profileNameEditBtn" type="button" aria-label="Edit name" title="Edit name">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>' +
    '</button>';
  document.getElementById('profileNameEditBtn').addEventListener('click', () => {
    row.innerHTML =
      '<span class="wf-profile-name-edit">' +
        '<input type="text" id="profileNameInput" maxlength="60" value="' + escapeHtml(getDisplayName(currentUserEmail)) + '">' +
        '<button class="wf-icon-btn" id="profileNameSaveBtn" type="button" aria-label="Save name" title="Save">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' +
        '</button>' +
        '<button class="wf-icon-btn" id="profileNameCancelBtn" type="button" aria-label="Cancel" title="Cancel">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
        '</button>' +
      '</span>';
    const input = document.getElementById('profileNameInput');
    input.focus();
    input.select();
    const save = () => setDisplayName(input.value);
    document.getElementById('profileNameSaveBtn').addEventListener('click', save);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    document.getElementById('profileNameCancelBtn').addEventListener('click', renderProfileNameRow);
  });
}

function greetingForHour(hour) {
  if (hour < 5) return 'Good Night, 🌙';
  if (hour < 12) return 'Good Morning, 🌅';
  if (hour < 17) return 'Good Afternoon, ☀️';
  if (hour < 21) return 'Good Evening, 🌇';
  return 'Good Night, 🌙';
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

wfDrawer.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-view]');
  if (!btn) return;
  setView(btn.dataset.view);
  closeDrawer();
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

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-back]')) setView('overview');
});

function openDrawer() {
  wfDrawer.hidden = false;
  wfDrawerBackdrop.hidden = false;
  menuBtn.setAttribute('aria-expanded', 'true');
}
function closeDrawer() {
  wfDrawer.hidden = true;
  wfDrawerBackdrop.hidden = true;
  menuBtn.setAttribute('aria-expanded', 'false');
}
menuBtn.addEventListener('click', () => (wfDrawer.hidden ? openDrawer() : closeDrawer()));
wfDrawerBackdrop.addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !wfDrawer.hidden) closeDrawer();
});

async function logout() {
  try {
    await fetch('/api/hr-auth/logout', { method: 'POST' });
  } finally {
    window.location.href = '/login';
  }
}
document.getElementById('logoutBtn').addEventListener('click', logout);
document.getElementById('profileLogoutBtn').addEventListener('click', logout);

function setView(view) {
  if (!VIEWS.includes(view)) return;
  activeView = view;
  wfDrawer.querySelectorAll('[data-view]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.view === view));
  });
  VIEWS.forEach((v) => { viewEls[v].hidden = v !== view; });
  loadView(view, false);
}

function loadView(view, forceRefresh) {
  if (!forceRefresh && loadedViews.has(view)) return Promise.resolve();
  loadedViews.add(view);
  if (view === 'overview') return loadOverview(forceRefresh);
  if (view === 'directory') return loadEmployees(forceRefresh);
  if (view === 'joining') return loadJoiningView();
  if (view === 'tenure') return loadTenureView();
  if (view === 'insights') return loadInsightsView();
  if (view === 'quality') return loadQualityView();
  if (view === 'mailReplies') return loadMailReplies();
  if (view === 'mailJoinings') return loadMailJoinings();
  if (view === 'profile') return loadProfile();
  // exit / attrition / movement are static "not available" panels — nothing to fetch.
  return Promise.resolve();
}

async function loadMailReplies() {
  const el = document.getElementById('mailRepliesList');
  el.innerHTML = '<li class="empty">Loading…</li>';
  try {
    const data = await fetchJson('/api/hr/job-applications');
    el.innerHTML = data.items.length
      ? data.items.map((item) => (
          '<li>' +
            '<span class="wf-bar-main">' +
              '<span class="wf-bar-name">' + escapeHtml(item.subject || '(no subject)') + '</span>' +
              '<span style="display:block; font-size:.74rem; color:var(--muted);">' + escapeHtml(item.from) + '</span>' +
            '</span>' +
          '</li>'
        )).join('')
      : '<li class="empty">No job application emails found</li>';
  } catch (err) {
    el.innerHTML = '<li class="error-banner">' + escapeHtml(err.message) + '</li>';
  }
}

async function loadMailJoinings() {
  const body = document.getElementById('mailJoiningsBody');
  body.innerHTML = '<tr><td colspan="4"><div class="loading"><div class="spinner"></div></div></td></tr>';
  try {
    const data = await fetchJson('/api/hr/upcoming-joinings');
    body.innerHTML = data.items.length
      ? data.items.map((item) => (
          '<tr>' +
            '<td>' + escapeHtml(item.name) + '</td>' +
            '<td>' + escapeHtml(item.designation || '—') + '</td>' +
            '<td>' + escapeHtml(item.company || '—') + '</td>' +
            '<td>' + formatDate(item.doj) + '</td>' +
          '</tr>'
        )).join('')
      : '<tr><td colspan="4"><div class="empty">No joinings in the next 3 months</div></td></tr>';
  } catch (err) {
    body.innerHTML = '<tr><td colspan="4"><div class="error-banner">' + escapeHtml(err.message) + '</div></td></tr>';
  }
}

async function loadProfile() {
  try {
    const data = await fetchJson('/api/hr-auth/me');
    if (data.email) currentUserEmail = data.email;
    document.getElementById('profileEmail').textContent = data.email || '';
    renderProfileNameRow();
  } catch {
    // Profile display is non-critical - leave the placeholders.
  }
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
  kpiGrid.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
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
  } catch (err) {
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
  filterReportingManager.value = filters.reportingManager || '';
  filterCollar.value = filters.collar || '';
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
    data.reportingManagers.forEach((m) => filterReportingManager.add(new Option(m, m)));
    data.collars.forEach((c) => filterCollar.add(new Option(c, c)));
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

[filterStatus, filterEmploymentType, filterDepartment, filterLocation, filterReportingManager, filterCollar].forEach((el) => {
  el.addEventListener('change', () => {
    activeFilters = {
      ...activeFilters,
      status: filterStatus.value,
      employmentType: filterEmploymentType.value,
      department: filterDepartment.value,
      location: filterLocation.value,
      reportingManager: filterReportingManager.value,
      collar: filterCollar.value
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
  filterReportingManager.value = '';
  filterCollar.value = '';
  loadEmployees();
});

const EMPLOYEE_TABLE_COLSPAN = 22;

async function loadEmployees(forceRefresh) {
  const requestId = ++currentRequestId;
  employeeTableBody.innerHTML =
    '<tr><td colspan="' + EMPLOYEE_TABLE_COLSPAN + '"><div class="loading"><div class="spinner"></div></div></td></tr>';
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
      '<tr><td colspan="' + EMPLOYEE_TABLE_COLSPAN + '"><div class="error-banner">' + escapeHtml(err.message) + '</div></td></tr>';
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
    employeeTableBody.innerHTML =
      '<tr><td colspan="' + EMPLOYEE_TABLE_COLSPAN + '"><div class="empty">No employees match these filters</div></td></tr>';
    return;
  }

  employeeTableBody.innerHTML = data.items
    .map(
      (e) =>
        '<tr>' +
          '<td>' + escapeHtml(e.employeeId) + '</td>' +
          '<td>' + escapeHtml(e.name) + '</td>' +
          '<td>' + escapeHtml(e.designation) + '</td>' +
          '<td>' + escapeHtml(e.department) + '</td>' +
          '<td>' + escapeHtml(e.groupD) + '</td>' +
          '<td>' + escapeHtml(e.location) + '</td>' +
          '<td>' + escapeHtml(e.reportingDoer) + '</td>' +
          '<td>' + escapeHtml(e.reportingManager) + '</td>' +
          '<td>' + formatDate(e.doj) + '</td>' +
          '<td>' + escapeHtml(e.tenure) + '</td>' +
          '<td>' + formatDate(e.dob) + '</td>' +
          '<td>' + escapeHtml(e.uan) + '</td>' +
          '<td>' + escapeHtml(e.esiNumber) + '</td>' +
          '<td>' + escapeHtml(e.email) + '</td>' +
          '<td>' + escapeHtml(e.emailPersonal) + '</td>' +
          '<td>' + escapeHtml(e.aadhar) + '</td>' +
          '<td>' + escapeHtml(e.pan) + '</td>' +
          '<td>' + escapeHtml(e.contactNumber) + '</td>' +
          '<td>' + escapeHtml(e.permanentAddress) + '</td>' +
          '<td>' + escapeHtml(e.presentAddress) + '</td>' +
          '<td>' + escapeHtml(e.employmentType) + '</td>' +
          '<td><span class="wf-status-chip ' + statusChipClass(e.status) + '">' + escapeHtml(e.status) + '</span></td>' +
        '</tr>'
    )
    .join('');
}

// ---------- Joining tab ----------
// "Upcoming" is Gmail-sourced (confirmed new hires not yet in the HR sheet -
// same data as the Mail Management "Upcoming Joinings" widget). "Recent" is
// real Employee_Master data: whoever's DOJ falls in the last 60 days.

let joiningActiveTab = 'upcoming';
const joiningCache = {};

document.getElementById('joiningTabs').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-jtab]');
  if (!btn || btn.dataset.jtab === joiningActiveTab) return;
  joiningActiveTab = btn.dataset.jtab;
  document.querySelectorAll('#joiningTabs [data-jtab]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b === btn));
  });
  renderJoiningTab(joiningActiveTab);
});

function joinDateBadge(doj) {
  const d = new Date(doj);
  if (isNaN(d.getTime())) return { day: '—', month: '' };
  return { day: String(d.getDate()).padStart(2, '0'), month: d.toLocaleDateString(undefined, { month: 'short' }) };
}

function joinRow(name, designation, subLabel, doj) {
  const badge = joinDateBadge(doj);
  return (
    '<li>' +
      '<span class="wf-join-badge"><b>' + badge.day + '</b><span>' + badge.month + '</span></span>' +
      '<span>' +
        '<span class="wf-join-name">' + escapeHtml(name) + '</span>' +
        '<span class="wf-join-sub" style="display:block;">' + escapeHtml(designation || '—') + ' · ' + escapeHtml(subLabel || '—') + '</span>' +
      '</span>' +
    '</li>'
  );
}

async function fetchJoiningTab(tab) {
  if (tab === 'upcoming') {
    const data = await fetchJson('/api/hr/upcoming-joinings');
    return data.items.length
      ? data.items.map((it) => joinRow(it.name, it.designation, it.company, it.doj)).join('')
      : '<li class="empty">No upcoming joinings found</li>';
  }
  const today = new Date();
  const from = new Date(today.getTime() - 60 * 24 * 60 * 60 * 1000);
  const params = new URLSearchParams({
    dateFrom: from.toISOString().slice(0, 10),
    dateTo: today.toISOString().slice(0, 10)
  });
  const data = await fetchJson('/api/workforce/employees?' + params.toString());
  const items = data.items.slice().sort((a, b) => new Date(b.doj) - new Date(a.doj));
  return items.length
    ? items.map((it) => joinRow(it.name, it.designation, it.location, it.doj)).join('')
    : '<li class="empty">No recent joiners in the last 60 days</li>';
}

async function renderJoiningTab(tab) {
  const listEl = document.getElementById('joiningList');
  if (joiningCache[tab]) {
    listEl.innerHTML = joiningCache[tab];
    return;
  }
  listEl.innerHTML = '<li class="empty">Loading…</li>';
  try {
    const html = await fetchJoiningTab(tab);
    joiningCache[tab] = html;
    if (tab === joiningActiveTab) listEl.innerHTML = html;
  } catch (err) {
    if (tab === joiningActiveTab) listEl.innerHTML = '<li class="error-banner">' + escapeHtml(err.message) + '</li>';
  }
}

function loadJoiningView() {
  return renderJoiningTab(joiningActiveTab);
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

    const total = data.buckets.reduce((sum, b) => sum + b.count, 0) || 1;
    document.getElementById('tenureRows').innerHTML = data.buckets
      .map((b) => (
        '<div class="wf-row-3col">' +
          '<span class="wf-row-label">' + escapeHtml(b.label) + '</span>' +
          '<span class="wf-row-value">' + b.count + '</span>' +
          '<span class="wf-row-pct">' + (Math.round((b.count / total) * 1000) / 10) + '%</span>' +
        '</div>'
      ))
      .join('');
    document.getElementById('tenureNote').textContent =
      data.excludedInactiveCount > 0
        ? data.excludedInactiveCount + ' inactive employees excluded — their departure date isn\'t tracked, so tenure can\'t be pinned to an end date.'
        : '';
    renderTenureDonut(data.buckets);
  } catch (err) {
    kpisEl.innerHTML = '<div class="error-banner">' + escapeHtml(err.message) + '</div>';
  }
}

// No separate legend here - the label/value/pct rows above already cover
// that, so this donut is just the visual summary (matches the reference).
function renderTenureDonut(buckets) {
  const c = chartColors();
  const palette = [c.accent, c.resolved, c.warning, c.candidate, c.important, c.muted];

  destroyChart('tenureDonut');
  const ctx = document.getElementById('tenureDonut');
  charts.tenureDonut = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: buckets.map((b) => b.label),
      datasets: [{ data: buckets.map((b) => b.count), backgroundColor: buckets.map((_, i) => palette[i % palette.length]), borderWidth: 0 }]
    },
    options: { cutout: '68%', plugins: { legend: { display: false }, tooltip: { enabled: true } } }
  });
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
                '<td>' + escapeHtml(e.reportingDoer) + '</td>' +
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

const QUALITY_FIELDS = [
  { key: 'department', label: 'Department' },
  { key: 'location', label: 'Location' },
  { key: 'designation', label: 'Designation' },
  { key: 'doj', label: 'Date of Joining' },
  { key: 'dob', label: 'Date of Birth' },
  { key: 'email', label: 'Email' }
];

async function loadQualityView() {
  const completenessEl = document.getElementById('qualityCompletenessPanel');
  completenessEl.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const data = await fetchJson('/api/workforce/data-quality');
    const totalPoints = data.total * QUALITY_FIELDS.length;
    const missingSum = QUALITY_FIELDS.reduce((sum, f) => sum + data.missing[f.key], 0);
    const completenessPct = totalPoints ? Math.round(((totalPoints - missingSum) / totalPoints) * 1000) / 10 : 100;

    completenessEl.innerHTML =
      '<div class="wf-completeness-label">Data Completeness</div>' +
      '<div class="wf-completeness-num">' + completenessPct + '%</div>' +
      '<div class="wf-progress-track"><div class="wf-progress-fill" style="width:' + completenessPct + '%"></div></div>';

    document.getElementById('qualityMissingRows').innerHTML = QUALITY_FIELDS
      .map((f) => (
        '<div class="wf-stat-row' + (data.missing[f.key] ? ' warn' : ' ok') + '">' +
          '<span class="wf-row-label">' + escapeHtml(f.label) + '</span>' +
          '<span class="wf-row-value">' + data.missing[f.key] + '</span>' +
        '</div>'
      ))
      .join('') +
      '<div class="wf-stat-row' + (data.duplicateIds.length ? ' warn' : ' ok') + '">' +
        '<span class="wf-row-label">Duplicate Employee IDs</span>' +
        '<span class="wf-row-value">' + data.duplicateIds.length + '</span>' +
      '</div>';

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
    completenessEl.innerHTML = '<div class="error-banner">' + escapeHtml(err.message) + '</div>';
  }
}

// ---------- Init ----------

async function loadDrawerIdentity() {
  try {
    const data = await fetchJson('/api/hr-auth/me');
    if (!data.email) return;
    currentUserEmail = data.email;
    const name = getDisplayName(data.email);
    document.getElementById('drawerName').textContent = name;
    document.getElementById('drawerEmail').textContent = data.email;
    document.getElementById('greetingName').textContent = name;
  } catch {
    // Non-critical - drawer/greeting just keep their placeholder text.
  }
}

document.getElementById('greetingTime').textContent = greetingForHour(new Date().getHours());

setView('overview');
loadFilterOptions();
loadDrawerIdentity();
