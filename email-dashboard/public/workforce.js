const kpiGrid = document.getElementById('kpiGrid');
const wfDrawer = document.getElementById('wfDrawer');
const wfDrawerBackdrop = document.getElementById('wfDrawerBackdrop');
const menuBtn = document.getElementById('menuBtn');
const VIEWS = [
  'overview', 'directory', 'joining', 'exit', 'attrition', 'tenure', 'movement', 'insights', 'quality',
  'departmentFull', 'locationFull', 'movementDetail', 'doerManagement', 'ageDistribution', 'genderDistribution', 'profile'
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
const employeeList = document.getElementById('employeeList');

let activeFilters = { status: 'ACTIVE' };
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
  leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>',
  transfer: '<path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  star: '<polygon points="12 2 15 8.5 22 9.5 17 14.5 18.5 21.5 12 18 5.5 21.5 7 14.5 2 9.5 9 8.5 12 2"/>',
  exitDoor: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  trendDown: '<line x1="7" y1="7" x2="17" y2="17"/><polyline points="17 7 17 17 7 17"/>'
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

const demographicsToggle = document.getElementById('demographicsToggle');
const demographicsSubmenu = document.getElementById('demographicsSubmenu');
demographicsToggle.addEventListener('click', () => {
  const expanded = demographicsToggle.getAttribute('aria-expanded') === 'true';
  demographicsToggle.setAttribute('aria-expanded', String(!expanded));
  demographicsSubmenu.hidden = expanded;
});

async function logout() {
  try {
    await fetch('api/hr-auth/logout', { method: 'POST' });
  } finally {
    window.location.href = 'login';
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
  if (view === 'directory') {
    document.getElementById('directoryDetailPanel').hidden = true;
    document.getElementById('directoryListPanel').hidden = false;
    // Reached via the drawer or back button, not a filter click - the PDF
    // export should use the default column layout. applyFiltersAndShowDirectory
    // overrides this right after calling setView() when it has its own variant.
    directoryReportVariant = 'default';
    syncVariantButtons();
  }
  // All views live in the same scrolling document (sections are toggled via
  // [hidden], not real navigation), so the old scroll position otherwise
  // carries over - e.g. leaving a long list scrolled down, then reopening
  // it later lands mid-page instead of at the top.
  window.scrollTo(0, 0);
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
  if (view === 'departmentFull') return loadDepartmentFullView();
  if (view === 'locationFull') return loadLocationFullView();
  if (view === 'doerManagement') return loadDoerManagementView();
  if (view === 'ageDistribution') return loadAgeDistributionView();
  if (view === 'genderDistribution') return loadGenderDistributionView();
  if (view === 'profile') return loadProfile();
  if (view === 'movement') return loadMovementView();
  // exit / attrition are static "not available" panels — nothing to fetch.
  return Promise.resolve();
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

function kpiCard({ key, label, value, tone, icon: iconName, clickable, title, live, delta, deltaSub, data }) {
  const isNa = value === null || value === undefined;
  const displayValue = isNa ? 'N/A' : value;
  const deltaLine =
    (delta
      ? '<span class="kpi-delta ' + (delta.direction || 'flat') + '">' +
          (delta.direction === 'up' ? '↑' : delta.direction === 'down' ? '↓' : '') +
          ' ' + escapeHtml(delta.text) +
        '</span>'
      : '') +
    (deltaSub ? (delta ? ' ' : '') + '<span class="kpi-delta-sub">' + escapeHtml(deltaSub) + '</span>' : '');
  let dataAttrs = '';
  if (data) {
    Object.entries(data).forEach(([k, v]) => {
      if (v === undefined || v === null) return;
      const attrName = k.replace(/([A-Z])/g, '-$1').toLowerCase();
      dataAttrs += ' data-' + attrName + '="' + escapeHtml(String(v)) + '"';
    });
  }
  return (
    '<button class="kpi-card' + (tone ? ' tone-' + tone : '') + '" data-kpi="' + key + '"' + dataAttrs +
      (clickable === false || isNa ? ' disabled' : '') +
      (title ? ' title="' + escapeHtml(title) + '"' : '') +
    '>' +
      '<span class="kpi-icon">' + icon(iconName) + '</span>' +
      '<span class="kpi-body">' +
        '<span class="kpi-label">' + escapeHtml(label) +
          (live ? '<span class="live-dot" title="Live"></span>' : '') +
        '</span>' +
        '<span class="kpi-num' + (isNa ? ' na' : '') + '">' + displayValue + '</span>' +
        (deltaLine ? '<span class="kpi-delta-row">' + deltaLine + '</span>' : '') +
      '</span>' +
    '</button>'
  );
}

async function loadOverview(forceRefresh) {
  kpiGrid.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const [overview, activeBreakdowns, trend] = await Promise.all([
      fetchJson('/api/workforce/overview' + (forceRefresh ? '?refresh=1' : '')),
      fetchJson('/api/workforce/breakdowns?status=ACTIVE'),
      fetchJson('/api/workforce/joining-trend?months=12')
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
    // Same click-to-filter logic as Workforce Movement's chart: a point
    // jumps to Employee Data filtered to that month, no status filter
    // (this trend counts everyone regardless of Active/Notice/Inactive),
    // and the exported PDF gets the same Status-instead-of-Age column
    // swap since it's the same "who joined" report.
    renderJoiningLine('joiningLineChart', trend.buckets, (bucket) => {
      if (!bucket || !bucket.key) return;
      const range = monthKeyToRange(bucket.key);
      applyFiltersAndShowDirectory({ dateFrom: range.dateFrom, dateTo: range.dateTo }, 'workforceMovement');
    });
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

const statusLegendEl = document.getElementById('statusLegend');
statusLegendEl.addEventListener('click', (e) => {
  const row = e.target.closest('[data-status]');
  if (!row) return;
  const filters = { status: row.dataset.status };
  if (row.dataset.employmentType) filters.employmentType = row.dataset.employmentType;
  applyFiltersAndShowDirectory(filters);
});
statusLegendEl.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const row = e.target.closest('[data-status]');
  if (!row) return;
  e.preventDefault();
  row.click();
});

const locationLegendEl = document.getElementById('locationLegend');
locationLegendEl.addEventListener('click', (e) => {
  const row = e.target.closest('[data-location]');
  if (!row) return;
  applyFiltersAndShowDirectory({ status: 'ACTIVE', location: row.dataset.location });
});
locationLegendEl.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const row = e.target.closest('[data-location]');
  if (!row) return;
  e.preventDefault();
  row.click();
});

const ageRowsEl = document.getElementById('ageRows');
ageRowsEl.addEventListener('click', (e) => {
  const row = e.target.closest('[data-age-min]');
  if (!row) return;
  const filters = { status: 'ACTIVE', ageMin: row.dataset.ageMin };
  if (row.dataset.ageMax) filters.ageMax = row.dataset.ageMax;
  applyFiltersAndShowDirectory(filters, 'ageDistribution');
});
ageRowsEl.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const row = e.target.closest('[data-age-min]');
  if (!row) return;
  e.preventDefault();
  row.click();
});

const genderRowsEl = document.getElementById('genderRows');
genderRowsEl.addEventListener('click', (e) => {
  const row = e.target.closest('[data-gender]');
  if (!row) return;
  applyFiltersAndShowDirectory({ status: 'ACTIVE', gender: row.dataset.gender });
});
genderRowsEl.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const row = e.target.closest('[data-gender]');
  if (!row) return;
  e.preventDefault();
  row.click();
});

const employmentTypeStatsEl = document.getElementById('employmentTypeStats');
employmentTypeStatsEl.addEventListener('click', (e) => {
  const block = e.target.closest('[data-status]');
  if (!block) return;
  const filters = { status: block.dataset.status };
  if (block.dataset.employmentType) filters.employmentType = block.dataset.employmentType;
  applyFiltersAndShowDirectory(filters, block.dataset.employmentType === 'Probation' ? 'probation' : undefined);
});
employmentTypeStatsEl.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const block = e.target.closest('[data-status]');
  if (!block) return;
  e.preventDefault();
  block.click();
});

// Which Employee Data PDF column layout to use - 'default' everywhere
// except when reached via a Workforce Movement chart/stat-card click,
// which swaps Age out for Status; a Doer Management row click, which
// unlocks the extra "Export DOER Breakup" report; or the Dashboard's
// Probation stat block, which unlocks "Upcoming Confirmations". Reset on
// every navigation so it never leaks into an unrelated export (e.g.
// clicking Department right after).
let directoryReportVariant = 'default';

function syncVariantButtons() {
  const doerBtn = document.getElementById('exportDoerBreakupPdf');
  if (doerBtn) doerBtn.hidden = directoryReportVariant !== 'doerManagement';
  const confirmationsBtn = document.getElementById('exportPendingConfirmationsPdf');
  if (confirmationsBtn) confirmationsBtn.hidden = directoryReportVariant !== 'probation';
}

function applyFiltersAndShowDirectory(filters, reportVariant) {
  activeFilters = filters;
  filterStatus.value = filters.status || '';
  filterEmploymentType.value = filters.employmentType || '';
  filterDepartment.value = filters.department || '';
  filterLocation.value = filters.location || '';
  filterReportingManager.value = filters.reportingManager || '';
  filterCollar.value = filters.collar || '';
  wfSearch.value = filters.q || '';
  // setView() skips reloading the list when 'directory' was already visited
  // this session (see loadView's loadedViews cache) - force it here since
  // the filters just changed and the list must reflect the new KPI clicked.
  const alreadyLoaded = loadedViews.has('directory');
  setView('directory'); // resets directoryReportVariant to 'default' - set it after, not before
  directoryReportVariant = reportVariant || 'default';
  syncVariantButtons();
  if (alreadyLoaded) loadEmployees();
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
    legendRow(c.resolved, 'Active', overview.active, pct(overview.active), false, { status: 'ACTIVE' }) +
    legendRow(c.resolved, 'Probation', overview.activeProbation, pct(overview.activeProbation), true, { status: 'ACTIVE', employmentType: 'Probation' }) +
    legendRow(c.resolved, 'Confirmed', overview.activeConfirmed, pct(overview.activeConfirmed), true, { status: 'ACTIVE', employmentType: 'Confirmed' }) +
    legendRow(c.warning, 'Notice Period', overview.noticePeriod, pct(overview.noticePeriod), false, { status: 'NOTICE PERIOD' }) +
    legendRow(c.important, 'Inactive', overview.inactive, pct(overview.inactive), false, { status: 'INACTIVE' });
}

function legendRow(color, label, value, pct, sub, filter) {
  const classes = [sub ? 'sub' : null, filter ? 'clickable' : null].filter(Boolean).join(' ');
  let attrs = classes ? ' class="' + classes + '"' : '';
  if (filter) {
    attrs += ' tabindex="0" role="button"';
    Object.entries(filter).forEach(([key, filterValue]) => {
      if (!filterValue) return;
      const attrName = key.replace(/([A-Z])/g, '-$1').toLowerCase();
      attrs += ' data-' + attrName + '="' + escapeHtml(filterValue) + '"';
    });
  }
  return (
    '<li' + attrs + '>' +
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
    '<div class="stat-block clickable" tabindex="0" role="button" data-status="ACTIVE" data-employment-type="Probation">' +
      '<div class="stat-icon probation">' + icon('probation', 20) + '</div>' +
      '<div class="stat-label">Probation</div>' +
      '<div class="stat-num">' + probation + '</div>' +
      '<div class="stat-pct">(' + probPct + '%)</div>' +
    '</div>' +
    '<div class="stat-divider"></div>' +
    '<div class="stat-block clickable" tabindex="0" role="button" data-status="ACTIVE" data-employment-type="Confirmed">' +
      '<div class="stat-icon confirmed">' + icon('confirmed', 20) + '</div>' +
      '<div class="stat-label">Confirmed</div>' +
      '<div class="stat-num">' + confirmed + '</div>' +
      '<div class="stat-pct">(' + confPct + '%)</div>' +
    '</div>';
}

function renderDeptBarList(rows, shareTotal, targetId) {
  const max = rows.length ? rows[0].count : 1;
  document.getElementById(targetId || 'deptBarList').innerHTML = rows.length
    ? rows.map((r) => barListItem(deptIconFor(r.name), r.name, r.count, max, shareTotal, 'department')).join('')
    : '<li class="empty">No department data</li>';
}

async function loadDepartmentFullView() {
  const listEl = document.getElementById('departmentFullBarList');
  listEl.innerHTML = '<li class="empty"><div class="loading"><div class="spinner"></div></div></li>';
  try {
    const [overview, breakdowns] = await Promise.all([
      fetchJson('/api/workforce/overview'),
      fetchJson('/api/workforce/breakdowns?status=ACTIVE')
    ]);
    const rows = breakdowns.departments;
    const max = rows.length ? rows[0].count : 1;
    const total = rows.reduce((sum, r) => sum + r.count, 0);
    listEl.innerHTML = rows.length
      ? rows.map((r) => barListItem(deptIconFor(r.name), r.name, r.count, max, overview.active, 'department')).join('') +
        '<li class="wf-bar-total-row">' +
          '<span class="wf-bar-icon">' + icon('total', 18) + '</span>' +
          '<span class="wf-bar-main"><span class="wf-bar-name">Total</span></span>' +
          '<span class="wf-bar-count">' + total + '</span>' +
          '<span class="wf-bar-pct">100%</span>' +
        '</li>'
      : '<li class="empty">No department data</li>';
  } catch (err) {
    listEl.innerHTML = '<li class="error-banner">' + escapeHtml(err.message) + '</li>';
  }
}

// The dashboard's own Location Wise Headcount preview stays a donut+legend
// (renderLocationDonut, below) - only the "View all" full list gets the
// department-style bar list, per explicit request to leave the dashboard
// panel untouched.
async function loadLocationFullView() {
  const listEl = document.getElementById('locationFullBarList');
  listEl.innerHTML = '<li class="empty"><div class="loading"><div class="spinner"></div></div></li>';
  try {
    const [overview, breakdowns] = await Promise.all([
      fetchJson('/api/workforce/overview'),
      fetchJson('/api/workforce/breakdowns?status=ACTIVE')
    ]);
    const rows = breakdowns.locations;
    const max = rows.length ? rows[0].count : 1;
    const total = rows.reduce((sum, r) => sum + r.count, 0);
    // Same index-based color generator as the dashboard donut (renderLocationDonut),
    // so a row's icon here matches its chart slice color for the top 6 shown there.
    const palette = generateCategoricalPalette(rows.length);
    listEl.innerHTML = rows.length
      ? rows.map((r, i) => barListItem('location', r.name, r.count, max, overview.active, 'location', palette[i])).join('') +
        '<li class="wf-bar-total-row">' +
          '<span class="wf-bar-icon">' + icon('total', 18) + '</span>' +
          '<span class="wf-bar-main"><span class="wf-bar-name">Total</span></span>' +
          '<span class="wf-bar-count">' + total + '</span>' +
          '<span class="wf-bar-pct">100%</span>' +
        '</li>'
      : '<li class="empty">No location data</li>';
  } catch (err) {
    listEl.innerHTML = '<li class="error-banner">' + escapeHtml(err.message) + '</li>';
  }
}

// Fixed display order requested for Doer Management, independent of
// headcount - any DOER not in this list (a new one added to the sheet
// later) falls back to count order at the end instead of disappearing.
const DOER_DISPLAY_ORDER = [
  'amar nath shroff', 'ajay kumar shroff', 'archana shroff', 'yashaswi shroff',
  'saurabh baid', 'aakriti shroff', 'r & d', 'association', 'common'
];

let lastDoerRows = [];

async function loadDoerManagementView() {
  const rowsEl = document.getElementById('doerRows');
  rowsEl.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const [overview, breakdowns] = await Promise.all([
      fetchJson('/api/workforce/overview'),
      fetchJson('/api/workforce/breakdowns?status=ACTIVE')
    ]);
    const rows = breakdowns.doers.slice().sort((a, b) => {
      const ai = DOER_DISPLAY_ORDER.indexOf(a.name.toLowerCase().trim());
      const bi = DOER_DISPLAY_ORDER.indexOf(b.name.toLowerCase().trim());
      if (ai === -1 && bi === -1) return b.count - a.count;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
    lastDoerRows = rows;
    // A dedicated hue-per-row palette (same generator as the Location "View
    // all" list) rather than the 8-color distributionPalette used by Age/
    // Gender/Tenure - those are fixed small bucket sets, but DOER count can
    // exceed 8 and grow over time, which would otherwise force color reuse.
    const palette = generateCategoricalPalette(rows.length);
    const total = rows.reduce((sum, r) => sum + r.count, 0) || 1;
    document.getElementById('doerDonutTotal').textContent = total.toLocaleString();

    rowsEl.innerHTML = rows.length
      ? '<div class="wf-dist-row wf-dist-header">' +
          '<span class="wf-dist-label-col">Reporting DOER</span>' +
          '<span class="wf-dist-num-col">Employees</span>' +
          '<span class="wf-dist-num-col">% of Total</span>' +
        '</div>' +
        rows.map((r, i) => (
          '<div class="wf-dist-row clickable" tabindex="0" role="button" data-reporting-doer="' + escapeHtml(r.name) + '">' +
            '<span class="wf-dist-label-col"><span class="wf-dist-dot" style="background:' + palette[i] + '"></span>' + escapeHtml(r.name) + '</span>' +
            '<span class="wf-dist-num-col">' + r.count + '</span>' +
            '<span class="wf-dist-num-col">' + (Math.round((r.count / total) * 1000) / 10) + '%</span>' +
          '</div>'
        )).join('') +
        '<div class="wf-dist-row wf-dist-total-row">' +
          '<span class="wf-dist-label-col"><span class="wf-dist-total-icon">' + icon('total', 14) + '</span>Total</span>' +
          '<span class="wf-dist-num-col">' + total + '</span>' +
          '<span class="wf-dist-num-col">100%</span>' +
        '</div>'
      : '<div class="empty">No Reporting DOER data</div>';

    const missing = overview.active - total;
    document.getElementById('doerNote').textContent =
      missing > 0
        ? total + ' of ' + overview.active + ' Active employees shown — ' + missing +
          (missing === 1 ? ' is' : ' are') + ' missing a Reporting DOER.'
        : '';

    renderDoerDonut(rows, palette);
  } catch (err) {
    rowsEl.innerHTML = '<div class="error-banner">' + escapeHtml(err.message) + '</div>';
  }
}

function renderDoerDonut(rows, palette) {
  destroyChart('doerDonut');
  const ctx = document.getElementById('doerDonut');
  charts.doerDonut = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: rows.map((r) => r.name),
      datasets: [{ data: rows.map((r) => r.count), backgroundColor: palette, borderWidth: 2, borderColor: chartColors().surface }]
    },
    options: { cutout: '62%', plugins: { legend: { display: false }, tooltip: { enabled: true } } }
  });
}

const doerRowsEl = document.getElementById('doerRows');
doerRowsEl.addEventListener('click', (e) => {
  const row = e.target.closest('[data-reporting-doer]');
  if (!row) return;
  applyFiltersAndShowDirectory({ status: 'ACTIVE', reportingDoer: row.dataset.reportingDoer }, 'doerManagement');
});
doerRowsEl.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const row = e.target.closest('[data-reporting-doer]');
  if (!row) return;
  e.preventDefault();
  row.click();
});

document.getElementById('exportDoerManagementPdf').addEventListener('click', () => {
  const total = lastDoerRows.reduce((sum, r) => sum + r.count, 0) || 1;
  document.getElementById('printReportTitle').textContent = 'Reporting DOER Wise Headcount Report';
  document.getElementById('printReportSubtitle').textContent =
    'Active · ' + lastDoerRows.length + ' DOER' + (lastDoerRows.length === 1 ? '' : 's') + ' · ';
  document.getElementById('printReportDate').textContent =
    new Date().toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
  document.getElementById('printReportHead').innerHTML =
    '<th>Reporting Doer</th><th>Employees</th><th>% of Total</th>';
  document.getElementById('printReportBody').innerHTML = lastDoerRows.length
    ? lastDoerRows
        .map((r) => (
          '<tr>' +
            '<td>' + escapeHtml(r.name) + '</td>' +
            '<td>' + r.count + '</td>' +
            '<td>' + (Math.round((r.count / total) * 1000) / 10) + '%</td>' +
          '</tr>'
        ))
        .join('') +
      '<tr><td><b>Total</b></td><td><b>' + total + '</b></td><td><b>100%</b></td></tr>'
    : '<tr><td colspan="3">No Reporting DOER data</td></tr>';
  window.print();
});

function barListItem(iconName, name, count, max, shareTotal, filterKey, iconColor) {
  const pct = Math.max(4, Math.round((count / max) * 100));
  const share = shareTotal ? Math.round((count / shareTotal) * 1000) / 10 : null;
  // Kebab-case the filterKey for the HTML attribute name - needed for
  // multi-word keys like "reportingDoer" (HTML lowercases attribute names,
  // so an un-kebabbed "data-reportingDoer" would become "data-reportingdoer"
  // on parse, which the dataset API can no longer match back to reportingDoer).
  const filterAttr = filterKey ? ' data-' + filterKey.replace(/([A-Z])/g, '-$1').toLowerCase() + '="' + escapeHtml(name) + '"' : '';
  // When an explicit color is given (the location "View all" list matches
  // its rows to the donut chart's palette), tint the icon's background and
  // recolor the icon itself so a row is visually tied to its chart slice.
  const iconStyle = iconColor ? ' style="background:' + iconColor + '1a; color:' + iconColor + '"' : '';
  return (
    '<li class="clickable" tabindex="0" role="button"' + filterAttr + '>' +
      '<span class="wf-bar-icon"' + iconStyle + '>' + icon(iconName, 18) + '</span>' +
      '<span class="wf-bar-main">' +
        '<span class="wf-bar-name">' + escapeHtml(name) + '</span>' +
        '<span class="wf-bar-track"><span class="wf-bar-fill" style="width:' + pct + '%"></span></span>' +
      '</span>' +
      '<span class="wf-bar-count">' + count + '</span>' +
      (share !== null ? '<span class="wf-bar-pct">(' + share + '%)</span>' : '') +
    '</li>'
  );
}

// barListItem is used for department rows (both the dashboard preview and
// "View all") and, now, the location "View all" full list only - the
// dashboard's location preview keeps its own separate donut+legend markup.
function wireBarListClicks(id, filterKey) {
  const attrName = filterKey.replace(/([A-Z])/g, '-$1').toLowerCase();
  const el = document.getElementById(id);
  el.addEventListener('click', (e) => {
    const row = e.target.closest('[data-' + attrName + ']');
    if (!row) return;
    applyFiltersAndShowDirectory({ status: 'ACTIVE', [filterKey]: row.dataset[filterKey] });
  });
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest('[data-' + attrName + ']');
    if (!row) return;
    e.preventDefault();
    row.click();
  });
}
wireBarListClicks('deptBarList', 'department');
wireBarListClicks('departmentFullBarList', 'department');
wireBarListClicks('locationFullBarList', 'location');

function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x) => Math.round(255 * x).toString(16).padStart(2, '0');
  return '#' + toHex(f(0)) + toHex(f(8)) + toHex(f(4));
}

// Generates `count` visually distinct categorical colors via golden-angle
// hue rotation (avoids similar hues landing next to each other in
// sequence), with per-hue-range lightness/saturation correction for hue
// bands that otherwise read too light or too washed-out in sRGB
// (yellow-green, cyan, blue). Used so every location gets its own color
// on the dashboard donut, with none folded into a generic "Others" slice.
// Validated with the dataviz skill's palette checker up to 19 colors -
// passes lightness/chroma/normal-vision floors; CVD separation lands in
// the legal warn band, which is fine here since every color is paired
// with a name+count in the legend text (identity never relies on color
// alone).
const GOLDEN_ANGLE = 137.508;
function generateCategoricalPalette(count) {
  const colors = [];
  for (let i = 0; i < count; i++) {
    const hue = Math.round((GOLDEN_ANGLE * i) % 360);
    let lightness = i % 2 === 0 ? 40 : 47;
    let sat = 66;
    if (hue >= 170 && hue <= 220) { sat = 100; lightness -= 4; }
    if (hue >= 175 && hue <= 195) { lightness -= 5; }
    if (hue >= 225 && hue <= 260) { lightness += 6; }
    if (hue >= 60 && hue <= 110) { lightness -= 10; sat = 75; }
    if (hue >= 150 && hue < 170) { lightness -= 6; }
    colors.push(hslToHex(hue, sat, lightness));
  }
  return colors;
}

function renderLocationDonut(rows) {
  // The donut itself draws every location as its own wedge/color (a true,
  // fully-accurate breakdown of the whole Active headcount) - only the
  // text legend beneath it stays capped at the top 6, matching Department
  // Wise Headcount's own pattern so the dashboard doesn't get overwhelmed
  // with 19 rows of text. The full named list lives on "View all"
  // (loadLocationFullView). generateCategoricalPalette is index-based, so
  // the legend's 6 colors are the same as the chart's first 6 wedges.
  const palette = generateCategoricalPalette(rows.length);
  const top = rows.slice(0, 6);
  const total = rows.reduce((sum, r) => sum + r.count, 0) || 1;

  destroyChart('locationDonut');
  const ctx = document.getElementById('locationDonut');
  charts.locationDonut = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: rows.map((r) => r.name),
      datasets: [{ data: rows.map((r) => r.count), backgroundColor: palette, borderWidth: 0 }]
    },
    options: { cutout: '68%', plugins: { legend: { display: false } } }
  });

  document.getElementById('locationLegend').innerHTML = top.length
    ? top.map((r, i) => legendRow(palette[i], r.name, r.count, Math.round((r.count / total) * 1000) / 10, false, { status: 'ACTIVE', location: r.name })).join('')
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

function renderJoiningLine(canvasId, buckets, onPointClick) {
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
        // A much bigger invisible tap target than the 4px visible dot -
        // Chart.js's default hit area is tiny and hard to land a finger on.
        pointHitRadius: onPointClick ? 16 : 1,
        borderWidth: 2,
        fill: true,
        tension: 0.35
      }]
    },
    options: {
      layout: { padding: { top: 22 } },
      plugins: { legend: { display: false }, tooltip: { enabled: true } },
      // 'index' + intersect:false means a tap anywhere along that month's
      // vertical column registers, not just a pixel-precise hit on the
      // point itself - the default ('nearest' + intersect:true) is what
      // made this feel unclickable on a phone.
      interaction: onPointClick ? { mode: 'index', intersect: false } : undefined,
      scales: {
        x: { grid: { display: false }, ticks: { color: c.muted, font: { size: 10 } } },
        y: { beginAtZero: true, grid: { color: c.line }, ticks: { color: c.muted, font: { size: 10 } } }
      },
      onClick: onPointClick
        ? (evt, elements) => {
            if (!elements.length) return;
            onPointClick(buckets[elements[0].index]);
          }
        : undefined,
      onHover: onPointClick
        ? (evt, elements) => {
            evt.native.target.style.cursor = elements.length ? 'pointer' : 'default';
          }
        : undefined
    },
    plugins: [joiningValueLabelsPlugin]
  });
}

// ---------- Workforce Movement ----------
// Joining Trend is real data (DOJ dates from Employee_Master, same
// /api/workforce/joining-trend endpoint the Dashboard preview uses).
// Transfers/Promotions/Exit/Location Transfers would need historical
// change-dated records (who moved from what to what, and when) that the
// sheet doesn't have - it only holds each employee's current state - so
// those render as honest N/A tiles instead of invented numbers.

let movementTrendBuckets = null;
let movementActiveTab = 'monthly';

// Indian financial year: April-March. A calendar (year, 1-12 month) pair
// maps to whichever FY it actually falls in - Jan/Feb/Mar belong to the FY
// that started the *previous* calendar year.
function fyPeriod(year, month) {
  if (month >= 4) return { fyStartYear: year, q: Math.floor((month - 4) / 3) + 1 };
  return { fyStartYear: year - 1, q: 4 };
}

function fyStartYearOf(now) {
  return fyPeriod(now.getUTCFullYear(), now.getUTCMonth() + 1).fyStartYear;
}

// Quarterly/Yearly need every month of whatever FY they're summarizing, or
// a bar undercounts (e.g. "FY 2025-26" showing 72 instead of the real 224,
// because only the back half of that FY - Oct'25 onward - fell inside a
// plain trailing-12-months window). Keeps exactly the current FY-to-date
// plus the one immediately before it - not the full 36-month fetch - so
// Yearly still shows just 2 bars, not a wall of history.
function filterToLastTwoFYs(buckets, now = new Date()) {
  const earliestFYStart = fyStartYearOf(now) - 1;
  return buckets.filter((b) => {
    const [year, month] = b.key.split('-').map(Number);
    return fyPeriod(year, month).fyStartYear >= earliestFYStart;
  });
}

// "YYYY-MM" (1-indexed month) -> the calendar-day range that bucket covers,
// so a chart click / stat-card click can filter Employee Data to exactly
// who joined in that period.
function monthKeyToRange(key) {
  const [year, month] = key.split('-').map(Number);
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 0)); // day 0 of next month = last day of this one
  return { dateFrom: from.toISOString().slice(0, 10), dateTo: to.toISOString().slice(0, 10) };
}

function aggregateQuarterly(buckets) {
  const byQuarter = new Map();
  buckets.forEach((b) => {
    const [year, month] = b.key.split('-').map(Number);
    const { fyStartYear, q } = fyPeriod(year, month);
    const qKey = fyStartYear + '-Q' + q;
    const entry = byQuarter.get(qKey) || { fyStartYear, q, count: 0, monthKeys: [] };
    entry.count += b.count;
    entry.monthKeys.push(b.key);
    byQuarter.set(qKey, entry);
  });
  return Array.from(byQuarter.values())
    .sort((a, b) => a.fyStartYear - b.fyStartYear || a.q - b.q)
    .map((e) => {
      const sortedKeys = e.monthKeys.slice().sort();
      return {
        label: 'Q' + e.q + ' FY' + String(e.fyStartYear).slice(-2),
        count: e.count,
        dateFrom: monthKeyToRange(sortedKeys[0]).dateFrom,
        dateTo: monthKeyToRange(sortedKeys[sortedKeys.length - 1]).dateTo
      };
    });
}

function aggregateYearly(buckets) {
  const byFY = new Map();
  buckets.forEach((b) => {
    const [year, month] = b.key.split('-').map(Number);
    const { fyStartYear } = fyPeriod(year, month);
    const entry = byFY.get(fyStartYear) || { fyStartYear, count: 0, monthKeys: [] };
    entry.count += b.count;
    entry.monthKeys.push(b.key);
    byFY.set(fyStartYear, entry);
  });
  // dateFrom/dateTo span only the months that actually landed in this FY
  // bucket, not the full Apr-Mar calendar range - the trailing-12-months
  // window usually only covers part of the oldest/newest FY it touches, so
  // using the full FY range here would filter in employees the bar's own
  // count never included (clicking "72" would silently show ~224).
  return Array.from(byFY.values())
    .sort((a, b) => a.fyStartYear - b.fyStartYear)
    .map((e) => {
      const sortedKeys = e.monthKeys.slice().sort();
      return {
        label: 'FY ' + e.fyStartYear + '-' + String(e.fyStartYear + 1).slice(-2),
        count: e.count,
        dateFrom: monthKeyToRange(sortedKeys[0]).dateFrom,
        dateTo: monthKeyToRange(sortedKeys[sortedKeys.length - 1]).dateTo
      };
    });
}

async function loadMovementView() {
  const statsGrid = document.getElementById('movementStatsGrid');
  statsGrid.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  renderMovementBreakdown();
  try {
    // 36 months comfortably covers "current FY to date + the full previous
    // FY" no matter what month it is right now (worst case, e.g. today
    // being March, needs 24) - filterToLastTwoFYs then trims this down to
    // just those 2 FYs for Quarterly/Yearly, so the extra history fetched
    // here never actually reaches the chart.
    const trend = await fetchJson('/api/workforce/joining-trend?months=36');
    movementTrendBuckets = trend.buckets;
    renderMovementTab(movementActiveTab);
  } catch (err) {
    statsGrid.innerHTML = '<div class="error-banner">' + escapeHtml(err.message) + '</div>';
  }
}

// One entry per Employee Movements card - each is backed by movementTracker's
// own daily-snapshot + instant-webhook log (a separate spreadsheet, isolated
// from Employee_Master) watching one HR-sheet column. Editing that column
// directly drives that card's count, same mechanism for all four.
const MOVEMENT_TYPES = {
  department: {
    kpiKey: 'transfers', label: 'Inter-Department Transfers', tone: 'move-blue', icon: 'transfer',
    endpoint: '/api/workforce/dept-transfers', fromKey: 'fromDept', toKey: 'toDept',
    noun: 'transfer', clickTitle: 'View who transferred', emptyText: 'No inter-department transfers in the last 12 months'
  },
  designation: {
    kpiKey: 'promotions', label: 'Promotions', tone: 'move-green', icon: 'star',
    endpoint: '/api/workforce/promotions', fromKey: 'fromDesignation', toKey: 'toDesignation',
    noun: 'change', clickTitle: 'View who changed designation', emptyText: 'No designation changes in the last 12 months'
  },
  company: {
    kpiKey: 'exit', label: 'Company Transfers', tone: 'move-red', icon: 'transfer',
    endpoint: '/api/workforce/company-transfers', fromKey: 'fromCompany', toKey: 'toCompany',
    noun: 'transfer', clickTitle: 'View who transferred companies', emptyText: 'No company transfers in the last 12 months'
  },
  location: {
    kpiKey: 'locationTransfers', label: 'Location Transfers', tone: 'move-purple', icon: 'location',
    endpoint: '/api/workforce/location-transfers', fromKey: 'fromLocation', toKey: 'toLocation',
    noun: 'transfer', clickTitle: 'View who relocated', emptyText: 'No location transfers in the last 12 months'
  }
};

async function renderMovementBreakdown() {
  document.getElementById('movementBreakdownGrid').innerHTML = Object.entries(MOVEMENT_TYPES)
    .map(([type, m]) => kpiCard({ key: m.kpiKey, label: m.label, value: null, tone: m.tone, icon: m.icon, clickable: false, data: { movementType: type } }))
    .join('');

  await Promise.all(Object.entries(MOVEMENT_TYPES).map(async ([type, m]) => {
    try {
      const data = await fetchJson(m.endpoint + '?days=365');
      const card = document.querySelector('#movementBreakdownGrid [data-kpi="' + m.kpiKey + '"]');
      if (card) {
        card.outerHTML = kpiCard({
          key: m.kpiKey, label: m.label, value: data.total, tone: m.tone, icon: m.icon,
          clickable: data.total > 0,
          title: data.total > 0 ? m.clickTitle : '',
          data: { movementType: type }
        });
      }
    } catch (err) {
      // Leave that one N/A tile in place - a tracker fetch hiccup for one column shouldn't affect the other three.
    }
  }));
}

document.getElementById('movementBreakdownGrid').addEventListener('click', (e) => {
  const card = e.target.closest('[data-movement-type]');
  if (!card || card.disabled) return;
  openMovementDetail(card.dataset.movementType);
});

let movementDetailType = 'department';

function openMovementDetail(type) {
  movementDetailType = type;
  setView('movementDetail');
  loadMovementDetail();
}

async function loadMovementDetail() {
  const meta = MOVEMENT_TYPES[movementDetailType];
  document.getElementById('movementDetailTitle').textContent = meta.label;
  const listEl = document.getElementById('movementDetailList');
  listEl.innerHTML = '<li class="empty"><div class="loading"><div class="spinner"></div></div></li>';
  try {
    const data = await fetchJson(meta.endpoint + '?days=365');
    const items = data.items.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
    document.getElementById('movementDetailCount').textContent =
      data.total + ' ' + meta.noun + (data.total === 1 ? '' : 's') + ' in the last 12 months';
    listEl.innerHTML = items.length
      ? items.map((it) => {
          const badge = joinDateBadge(it.date);
          return (
            '<li>' +
              '<span class="wf-join-badge-wrap">' +
                '<span class="wf-join-badge"><b>' + badge.day + '</b><span>' + badge.month + '</span></span>' +
              '</span>' +
              '<span class="wf-join-main">' +
                '<span class="wf-join-name">' + escapeHtml(it.name) + '</span>' +
                '<span class="wf-join-sub wf-transfer-route">' +
                  escapeHtml(it[meta.fromKey]) +
                  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>' +
                  escapeHtml(it[meta.toKey]) +
                '</span>' +
              '</span>' +
            '</li>'
          );
        }).join('')
      : '<li class="empty">' + meta.emptyText + '</li>';
  } catch (err) {
    listEl.innerHTML = '<li class="error-banner">' + escapeHtml(err.message) + '</li>';
  }
}

function renderMovementTab(tab) {
  if (!movementTrendBuckets) return;
  movementActiveTab = tab;
  document.querySelectorAll('#movementTrendTabs [data-mtab]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.mtab === tab));
  });

  // Monthly still shows exactly the trailing 12 real months. Quarterly/
  // Yearly aggregate the current-FY-to-date + full previous FY instead
  // (filterToLastTwoFYs) - a plain trailing-12-months slice can cut a
  // financial year in half and undercount it (verified: "FY 2025-26" was
  // showing 72 instead of the real 224, since only Oct'25-Mar'26 of that
  // FY fell inside the old 12-month window).
  const monthly = movementTrendBuckets.slice(-12).map((b) => ({ ...b, ...monthKeyToRange(b.key) }));
  let buckets;
  let title;
  if (tab === 'quarterly') { buckets = aggregateQuarterly(filterToLastTwoFYs(movementTrendBuckets)); title = 'Joining Trend (Quarterly)'; }
  else if (tab === 'yearly') { buckets = aggregateYearly(filterToLastTwoFYs(movementTrendBuckets)); title = 'Joining Trend (Yearly)'; }
  else { buckets = monthly; title = 'Joining Trend (Monthly)'; }

  document.getElementById('movementTrendTitle').textContent = title;
  // The chart counts everyone regardless of status (Active/Notice/
  // Inactive), so clicking a point must not add a status filter - it would
  // silently show fewer people than the chart's own count implies.
  renderJoiningLine('movementTrendChart', buckets, (bucket) => {
    if (!bucket || !bucket.dateFrom) return;
    applyFiltersAndShowDirectory({ dateFrom: bucket.dateFrom, dateTo: bucket.dateTo }, 'workforceMovement');
  });

  // Avg/Highest/Lowest still summarize the trailing 12 real months,
  // regardless of which trend tab is showing. Total Joins is a separate,
  // FY-scoped comparison instead: current FY-to-date as the headline
  // number, against the full previous FY as the baseline - a trailing-
  // 12-vs-previous-12 split doesn't line up with how the business actually
  // reviews joining numbers (financial year over financial year).
  const currentFYStart = fyStartYearOf(new Date());
  const previousFYStart = currentFYStart - 1;
  const currentFYMonths = movementTrendBuckets
    .filter((b) => {
      const [year, month] = b.key.split('-').map(Number);
      return fyPeriod(year, month).fyStartYear === currentFYStart;
    })
    .map((b) => ({ ...b, ...monthKeyToRange(b.key) }));
  const previousFYMonths = movementTrendBuckets.filter((b) => {
    const [year, month] = b.key.split('-').map(Number);
    return fyPeriod(year, month).fyStartYear === previousFYStart;
  });
  const currentFYTotal = currentFYMonths.reduce((sum, b) => sum + b.count, 0);
  const previousFYTotal = previousFYMonths.reduce((sum, b) => sum + b.count, 0);
  const fyPctChange = previousFYTotal > 0 ? Math.round(((currentFYTotal - previousFYTotal) / previousFYTotal) * 1000) / 10 : null;
  const previousFYLabel = 'FY ' + previousFYStart + '-' + String(previousFYStart + 1).slice(-2);

  const currentTotal = monthly.reduce((sum, b) => sum + b.count, 0);
  const avgPerMonth = monthly.length ? Math.round((currentTotal / monthly.length) * 10) / 10 : 0;
  const highest = monthly.reduce((best, b) => (!best || b.count > best.count ? b : best), null) || { count: 0, label: '—' };
  const lowest = monthly.reduce((worst, b) => (!worst || b.count < worst.count ? b : worst), null) || { count: 0, label: '—' };

  document.getElementById('movementStatsGrid').innerHTML =
    kpiCard({
      key: 'totalJoins', label: 'Total Joins', value: currentFYTotal, tone: 'move-blue', icon: 'total',
      clickable: currentFYTotal > 0,
      data: currentFYMonths.length ? { dateFrom: currentFYMonths[0].dateFrom, dateTo: currentFYMonths[currentFYMonths.length - 1].dateTo } : null,
      delta: fyPctChange === null ? null : { direction: fyPctChange >= 0 ? 'up' : 'down', text: Math.abs(fyPctChange) + '%' },
      deltaSub: fyPctChange === null ? null : 'Previous ' + previousFYLabel + ': ' + previousFYTotal
    }) +
    kpiCard({ key: 'avgPerMonth', label: 'Avg. Per Month', value: avgPerMonth, tone: 'move-purple', icon: 'calendar', clickable: false, deltaSub: 'per month' }) +
    kpiCard({
      key: 'highestMonth', label: 'Highest Month', value: highest.count, tone: 'move-green', icon: 'star',
      clickable: highest.count > 0, data: highest.count > 0 ? { dateFrom: highest.dateFrom, dateTo: highest.dateTo } : null,
      deltaSub: highest.label
    }) +
    kpiCard({
      key: 'lowestMonth', label: 'Lowest Month', value: lowest.count, tone: 'move-red', icon: 'trendDown',
      clickable: lowest.count > 0, data: lowest.count > 0 ? { dateFrom: lowest.dateFrom, dateTo: lowest.dateTo } : null,
      deltaSub: lowest.label
    });
}

document.getElementById('movementStatsGrid').addEventListener('click', (e) => {
  const card = e.target.closest('[data-date-from]');
  if (!card || card.disabled) return;
  applyFiltersAndShowDirectory({ dateFrom: card.dataset.dateFrom, dateTo: card.dataset.dateTo }, 'workforceMovement');
});

document.getElementById('movementTrendTabs').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-mtab]');
  if (!btn || btn.dataset.mtab === movementActiveTab) return;
  renderMovementTab(btn.dataset.mtab);
});

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

let lastEmployeeList = [];

async function loadEmployees(forceRefresh) {
  const requestId = ++currentRequestId;
  employeeList.innerHTML = '<li class="empty"><div class="loading"><div class="spinner"></div></div></li>';
  // The label is derivable from activeFilters alone, so update it right
  // away; the count needs the server response, so blank it instead of
  // leaving the previous filter's number on screen while this one loads.
  document.getElementById('directoryTotalCount').textContent = '—';
  document.getElementById('directoryTotalLabel').textContent =
    activeFilters.status === 'ACTIVE' ? 'Active Employees' :
    Object.values(activeFilters).some(Boolean) ? 'Filtered Employees' : 'Total Employees';
  resultSummary.textContent = '';
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
    employeeList.innerHTML = '<li class="error-banner">' + escapeHtml(err.message) + '</li>';
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

function formatAgeYearsMonths(dobIso) {
  if (!dobIso) return '—';
  const dob = new Date(dobIso);
  if (isNaN(dob.getTime())) return '—';
  const now = new Date();
  let years = now.getFullYear() - dob.getFullYear();
  let months = now.getMonth() - dob.getMonth();
  if (now.getDate() < dob.getDate()) months--;
  if (months < 0) { years--; months += 12; }
  return years + 'Y ' + months + 'M';
}

// Precise (fractional) age in years, purely for sorting the Age Distribution
// report smallest-to-largest - missing DOB sorts to the end either way.
function ageInYearsForSort(dobIso) {
  if (!dobIso) return Infinity;
  const dob = new Date(dobIso);
  if (isNaN(dob.getTime())) return Infinity;
  return (Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
}

function titleCase(s) {
  return String(s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

const PERSON_ICON = '<circle cx="12" cy="8" r="4"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>';

function renderEmployees(data) {
  lastEmployeeList = data.items;
  document.getElementById('directoryTotalCount').textContent = data.total;
  document.getElementById('directoryTotalLabel').textContent =
    activeFilters.status === 'ACTIVE' ? 'Active Employees' :
    Object.values(activeFilters).some(Boolean) ? 'Filtered Employees' : 'Total Employees';
  resultSummary.textContent =
    data.total + ' employee' + (data.total === 1 ? '' : 's') +
    (data.truncated ? ' (showing first ' + data.items.length + ')' : '');

  if (!data.items.length) {
    employeeList.innerHTML = '<li class="empty">No employees match these filters</li>';
    return;
  }

  employeeList.innerHTML = data.items
    .map(
      (e, i) =>
        '<li data-emp-idx="' + i + '">' +
          '<span class="wf-emp-avatar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + PERSON_ICON + '</svg></span>' +
          '<span class="wf-emp-main">' +
            '<span class="wf-emp-name">' + escapeHtml(e.name) + '</span>' +
            '<span class="wf-emp-meta">' + escapeHtml(e.employeeId) + ' · <span class="wf-status-chip ' + statusChipClass(e.status) + '">' + escapeHtml(e.status) + '</span></span>' +
            '<span class="wf-emp-role">' + escapeHtml(e.designation || '—') + '</span>' +
          '</span>' +
        '</li>'
    )
    .join('');
}

employeeList.addEventListener('click', (e) => {
  const li = e.target.closest('[data-emp-idx]');
  if (!li) return;
  const emp = lastEmployeeList[Number(li.dataset.empIdx)];
  if (emp) showEmployeeDetail(emp);
});

// Best-effort seniority ranking for the PDF report - the sheet has 150+
// distinct freeform designation strings, so this matches on keyword tiers
// (checked top-down, first match wins - specific patterns like "Deputy
// Manager" are listed before the generic "Manager" catch-all so they don't
// get swallowed by it) rather than an exhaustive per-title map. There are
// two parallel ladders that both bottleneck through Manager: a corporate/
// office track (DEO < Jr Executive < Executive < Sr Executive < Asst
// Manager < Deputy Manager) and a project-site technical track (Engineer/
// Supervisor). DEO itself spans both offices and sites, ranking below both
// Engineer and Executive but above Supervisor. Anything unrecognized falls
// into the generic skilled-trade tier rather than accidentally sorting to
// the very top or bottom.
const DESIGNATION_RANK_TIERS = [
  { rank: 10, test: /\b(DIRECTOR|CHAIRMAN|COMPANY SECRETARY|MANAGING DIRECTOR)\b/ },
  { rank: 20, test: /\bVICE PRESIDENT\b/ },
  { rank: 30, test: /\b(GENERAL MANAGER|\bGM\b|PLANT MANAGER|FINANCE CONTROLLER)\b/ },
  { rank: 40, test: /\bDGM\b/ },
  { rank: 50, test: /\bAGM\b/ },
  { rank: 60, test: /\b(SR\.?|SENIOR)\s*MANAGER\b/ },
  { rank: 80, test: /\bDEPUTY MANAGER\b/ }, // before plain Manager
  { rank: 90, test: /\b(ASSISTANT MANAGER|ASST\.?\s*MAN[AG]ER)\b/ }, // before plain Manager
  { rank: 70, test: /\bMANAGER\b/ }, // generic catch-all for the Manager family, checked last
  { rank: 100, test: /\b(SR\.?|SENIOR)\s*ENGINEER\b/ },
  { rank: 100, test: /\b(SR\.?|SENIOR)\s*EXECUTIVE\b/ },
  { rank: 130, test: /\bJR\.?\s*EXECUTIVE\b|\bJUNIOR EXECUTIVE\b/ }, // before plain Executive
  { rank: 120, test: /\bENGINEER\b/ },
  { rank: 120, test: /\bEXECUTIVE\b/ },
  { rank: 130, test: /\bDTE\b/ }, // Diploma Trainee Engineer - junior to a full Engineer
  { rank: 135, test: /\b(SR\.?|SENIOR)\s*(DATA ENTRY OPERATOR|DEO)\b/ },
  { rank: 140, test: /\b(DATA ENTRY OPERATOR|DEO)\b/ }, // spans office & site, below Engineer/Executive, above Supervisor
  { rank: 150, test: /\b(SR\.?|SENIOR)\s*(SUPERVISOR|FOREMAN)\b/ },
  { rank: 160, test: /\b(SUPERVISOR|FOREMAN)\b/ },
  { rank: 180, test: /\b(SR\.?|SENIOR)\b/ }, // any other "Sr. <trade>" not already caught above
  { rank: 210, test: /\b(ASST\.?|ASSISTANT)\b/ }, // Asst./Assistant-prefixed trades (Asst. Electrician, Asst. Welder...) rank below their plain counterpart - checked after Assistant Manager/Engineer, which are already caught by their own higher tiers above
  { rank: 215, test: /\bOPERATOR\b/ }, // machine/equipment operators (Lift, JCB, Tower Crane, Batching Plant...) rank below assistant-level trades - Data Entry Operator is caught by its own tier above, before reaching this one
  { rank: 220, test: /\b(HELPER|LABOUR|LABOURER|SWEEPER|HOUSE\s*KEEP|HOUSE STAFF|OFFICE BOY|COOK|STEWARD|GARDENER|SECURITY GUARD|CARE\s*TAKER|PANDIT|DOG TRAINER)\b/ }
];
const DESIGNATION_RANK_DEFAULT = 200; // plain skilled trades (Electrician, Fitter, Mason, Driver, Operator...)

function designationRank(designation) {
  const upper = String(designation || '').toUpperCase();
  const tier = DESIGNATION_RANK_TIERS.find((t) => t.test.test(upper));
  return tier ? tier.rank : DESIGNATION_RANK_DEFAULT;
}

// Collar groups the report at the top level (White > Blue > Group-D), with
// the designation seniority tiers above applying inside each group.
const COLLAR_RANK = { White: 0, Blue: 1, 'Group-D': 2 };
function collarRank(collar) {
  return collar in COLLAR_RANK ? COLLAR_RANK[collar] : 99;
}

document.getElementById('exportEmployeesPdf').addEventListener('click', () => {
  const filterParts = [];
  if (activeFilters.status) filterParts.push(activeFilters.status === 'ACTIVE' ? 'Active' : activeFilters.status);
  if (activeFilters.department) filterParts.push(activeFilters.department);
  if (activeFilters.department) {
    // HOD-1 (the "Reporting Manager" field) is per-employee, but for a
    // single-department report it's effectively the department's HOD -
    // take whichever name is most common among the filtered list rather
    // than assuming every row agrees exactly.
    const managerCounts = {};
    lastEmployeeList.forEach((e) => {
      if (e.reportingManager) managerCounts[e.reportingManager] = (managerCounts[e.reportingManager] || 0) + 1;
    });
    let hodName = null;
    let hodCount = 0;
    Object.entries(managerCounts).forEach(([name, count]) => {
      if (count > hodCount) { hodName = name; hodCount = count; }
    });
    if (hodName) filterParts.push('HOD: ' + hodName);
  }
  if (activeFilters.employmentType) filterParts.push(activeFilters.employmentType);
  if (activeFilters.location) filterParts.push(activeFilters.location);

  // Age Distribution's own report sorts purely by actual age (small to
  // large) instead of the Collar/Department grouping every other report
  // uses - that grouping doesn't make sense once age, not collar, is the
  // organizing idea. Every other path (Department/Location/Gender/KPI
  // clicks, manual filters, Workforce Movement) is unaffected.
  const isAgeDistributionReport = directoryReportVariant === 'ageDistribution';
  const sortedList = lastEmployeeList.slice().sort((a, b) => {
    if (isAgeDistributionReport) {
      const ageDiff = ageInYearsForSort(a.dob) - ageInYearsForSort(b.dob);
      if (ageDiff !== 0) return ageDiff;
      return (a.name || '').localeCompare(b.name || '');
    }
    const collarDiff = collarRank(a.groupD) - collarRank(b.groupD);
    if (collarDiff !== 0) return collarDiff;
    const deptDiff = (a.department || '').localeCompare(b.department || '');
    if (deptDiff !== 0) return deptDiff;
    const rankDiff = designationRank(a.designation) - designationRank(b.designation);
    if (rankDiff !== 0) return rankDiff;
    const desigDiff = (a.designation || '').localeCompare(b.designation || '');
    if (desigDiff !== 0) return desigDiff;
    return (a.name || '').localeCompare(b.name || '');
  });

  document.getElementById('printReportTitle').textContent = 'Employee Data Report';
  document.getElementById('printReportSubtitle').textContent =
    (filterParts.length ? filterParts.join(' · ') + ' · ' : '') +
    sortedList.length + ' employee' + (sortedList.length === 1 ? '' : 's') + ' · ';
  // Only the Workforce Movement report swaps Age out for Status - every
  // other section's export (Department/Location/Age/Gender/KPI clicks,
  // manual filters) keeps the original Age column, unchanged.
  const isWorkforceMovementReport = directoryReportVariant === 'workforceMovement';
  document.getElementById('printReportHead').innerHTML = isWorkforceMovementReport
    ? '<th>Employee Code</th><th>Name</th><th>Designation</th><th>Department</th><th>Collar</th><th>Gender</th><th>Location</th><th>DOJ</th><th>Status</th>'
    : '<th>Employee Code</th><th>Name</th><th>Designation</th><th>Department</th><th>Collar</th><th>Age</th><th>Gender</th><th>Location</th><th>DOJ</th>';
  document.getElementById('printReportDate').textContent =
    new Date().toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
  let lastGroupHeading = null;
  document.getElementById('printReportBody').innerHTML = sortedList.length
    ? sortedList
        .map((e) => {
          // No Collar section headers for the age-sorted report - once rows
          // are ordered by age, collars no longer sit in contiguous blocks,
          // so a per-collar heading would just flicker in and out between rows.
          let sectionRow = '';
          if (!isAgeDistributionReport) {
            const heading = e.groupD || 'Unspecified Collar';
            if (heading !== lastGroupHeading) {
              sectionRow = '<tr class="print-section-row"><td colspan="9">' + escapeHtml(heading) + '</td></tr>';
              lastGroupHeading = heading;
            }
          }
          const lastCol = isWorkforceMovementReport
            ? '<td>' + escapeHtml(titleCase(e.status) || '—') + '</td>'
            : '<td>' + formatAgeYearsMonths(e.dob) + '</td>';
          return sectionRow + (
          '<tr>' +
            '<td>' + escapeHtml(e.employeeId) + '</td>' +
            '<td>' + escapeHtml(e.name) + '</td>' +
            '<td>' + escapeHtml(e.designation || '—') + '</td>' +
            '<td>' + escapeHtml(e.department || '—') + '</td>' +
            '<td>' + escapeHtml(e.groupD || '—') + '</td>' +
            (isWorkforceMovementReport ? '' : lastCol) +
            '<td>' + escapeHtml(e.gender || '—') + '</td>' +
            '<td>' + escapeHtml(e.location || '—') + '</td>' +
            '<td>' + formatDate(e.doj) + '</td>' +
            (isWorkforceMovementReport ? lastCol : '') +
          '</tr>'
          );
        })
        .join('')
    : '<tr><td colspan="9">No employees match these filters</td></tr>';
  window.print();
});

function collarSlug(collar) {
  const c = String(collar || '').toLowerCase();
  if (c === 'white') return 'white';
  if (c === 'blue') return 'blue';
  if (c === 'group-d') return 'groupd';
  return 'other';
}

// Only available when Employee Data was reached via a Doer Management row
// click (see doerRowsEl's applyFiltersAndShowDirectory call, 'doerManagement'
// variant) - a second, differently structured report on top of the regular
// Export PDF: the DOER's own name as the report heading, then a Department
// > Collar breakdown of their team instead of one flat list, each
// department carrying its own most-common HOD as a sub-label.
document.getElementById('exportDoerBreakupPdf').addEventListener('click', () => {
  const byDept = new Map();
  lastEmployeeList.forEach((e) => {
    const dept = e.department || 'Unspecified Department';
    if (!byDept.has(dept)) byDept.set(dept, []);
    byDept.get(dept).push(e);
  });
  const deptNames = Array.from(byDept.keys()).sort((a, b) => a.localeCompare(b));

  const doerName = String(activeFilters.reportingDoer || '').toUpperCase() || 'REPORTING DOER REPORT';
  document.getElementById('printReportTitle').textContent = doerName;
  document.getElementById('printReportSubtitle').textContent =
    'Reporting DOER · ' + lastEmployeeList.length + ' employee' + (lastEmployeeList.length === 1 ? '' : 's') + ' · ';
  document.getElementById('printReportDate').textContent =
    new Date().toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
  document.getElementById('printReportHead').innerHTML =
    '<th>Employee Code</th><th>Name</th><th>Designation</th><th>Age</th><th>Gender</th><th>Location</th><th>DOJ</th>';

  let bodyHtml = '';
  deptNames.forEach((deptName) => {
    const emps = byDept.get(deptName);
    // Same "most common HOD among the filtered list" technique as the
    // single-department export above, computed per department here since
    // a DOER's team can span many departments, each with its own HOD.
    const managerCounts = {};
    emps.forEach((e) => { if (e.reportingManager) managerCounts[e.reportingManager] = (managerCounts[e.reportingManager] || 0) + 1; });
    let hodName = null;
    let hodCount = 0;
    Object.entries(managerCounts).forEach(([name, count]) => {
      if (count > hodCount) { hodName = name; hodCount = count; }
    });
    const deptHeading = deptName + (hodName ? ' — HOD: ' + hodName : '');
    bodyHtml += '<tr class="print-doer-dept-row"><td colspan="7">' + escapeHtml(deptHeading) + '</td></tr>';

    const sortedEmps = emps.slice().sort((a, b) => {
      const collarDiff = collarRank(a.groupD) - collarRank(b.groupD);
      if (collarDiff !== 0) return collarDiff;
      const rankDiff = designationRank(a.designation) - designationRank(b.designation);
      if (rankDiff !== 0) return rankDiff;
      const desigDiff = (a.designation || '').localeCompare(b.designation || '');
      if (desigDiff !== 0) return desigDiff;
      return (a.name || '').localeCompare(b.name || '');
    });

    let lastCollar = null;
    sortedEmps.forEach((e) => {
      const collarHeading = e.groupD || 'Unspecified Collar';
      if (collarHeading !== lastCollar) {
        bodyHtml += '<tr class="print-subsection-row print-subsection-' + collarSlug(e.groupD) + '"><td colspan="7">' + escapeHtml(collarHeading) + '</td></tr>';
        lastCollar = collarHeading;
      }
      bodyHtml +=
        '<tr>' +
          '<td>' + escapeHtml(e.employeeId) + '</td>' +
          '<td>' + escapeHtml(e.name) + '</td>' +
          '<td>' + escapeHtml(e.designation || '—') + '</td>' +
          '<td>' + formatAgeYearsMonths(e.dob) + '</td>' +
          '<td>' + escapeHtml(e.gender || '—') + '</td>' +
          '<td>' + escapeHtml(e.location || '—') + '</td>' +
          '<td>' + formatDate(e.doj) + '</td>' +
        '</tr>';
    });
  });
  document.getElementById('printReportBody').innerHTML = bodyHtml || '<tr><td colspan="7">No employees match these filters</td></tr>';
  window.print();
});

// Only this report prints landscape - injects a top-level @page override
// right before printing and removes it again once the print dialog closes,
// so every other (portrait) export is unaffected. @page is deliberately
// NOT nested inside @media print here - some browsers apply a nested
// version inconsistently, and @page only ever takes effect for the print/
// paged context anyway, so the wrapper was redundant.
function printLandscape() {
  const style = document.createElement('style');
  style.textContent = '@page { size: landscape; }';
  document.head.appendChild(style);
  window.print();
  window.addEventListener('afterprint', function cleanup() {
    style.remove();
    window.removeEventListener('afterprint', cleanup);
  });
}

// Only available when Employee Data was reached via the Dashboard's
// Probation stat block (see employmentTypeStatsEl's applyFiltersAndShowDirectory
// call, 'probation' variant). Independent of whatever's currently filtered
// in Employee Data - always the whole current month's confirmation-due list
// (DOJ + 6 months, 1st to last day), regardless of what day it's generated
// on or whether an employee's Employment Type has already flipped to
// Confirmed - see pendingConfirmationsThisMonth in workforceAnalytics.js.
// Laid out for a physical HOD sign-off.
document.getElementById('exportPendingConfirmationsPdf').addEventListener('click', async () => {
  try {
    const data = await fetchJson('/api/workforce/pending-confirmations');
    const items = data.items.slice().sort((a, b) => {
      const dateDiff = new Date(a.confirmationDate) - new Date(b.confirmationDate);
      if (dateDiff !== 0) return dateDiff;
      return (a.name || '').localeCompare(b.name || '');
    });

    const monthLabel = new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    document.getElementById('printReportTitle').textContent = 'Pending Confirmations Report';
    document.getElementById('printReportSubtitle').textContent =
      monthLabel + ' · ' + items.length + ' employee' + (items.length === 1 ? '' : 's') + ' · ';
    document.getElementById('printReportDate').textContent =
      new Date().toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
    document.getElementById('printReportHead').innerHTML =
      '<th>Employee Code</th><th>Name</th><th>Designation</th><th>Department</th><th>Location</th>' +
      '<th>Confirmation Date</th><th>HOD Name</th><th class="print-signature-col">Signature</th>';
    document.getElementById('printReportBody').innerHTML = items.length
      ? items
          .map((it) => (
            '<tr>' +
              '<td>' + escapeHtml(it.employeeId) + '</td>' +
              '<td>' + escapeHtml(it.name) + '</td>' +
              '<td>' + escapeHtml(it.designation || '—') + '</td>' +
              '<td>' + escapeHtml(it.department || '—') + '</td>' +
              '<td>' + escapeHtml(it.location || '—') + '</td>' +
              '<td>' + formatDate(it.confirmationDate) + '</td>' +
              '<td>' + escapeHtml(it.reportingManager || '—') + '</td>' +
              '<td class="print-signature-col"></td>' +
            '</tr>'
          ))
          .join('')
      : '<tr><td colspan="8">No confirmations due this month</td></tr>';
    printLandscape();
  } catch (err) {
    alert('Failed to generate Upcoming Confirmations report: ' + err.message);
  }
});

document.getElementById('filterToggleBtn').addEventListener('click', () => {
  const expanded = document.getElementById('filterToggleBtn').getAttribute('aria-expanded') === 'true';
  document.getElementById('wfFilterbar').hidden = expanded;
  document.getElementById('filterToggleBtn').setAttribute('aria-expanded', String(!expanded));
});

function fieldRow(iconPath, label, value) {
  return (
    '<div class="wf-field-row">' +
      '<span class="wf-field-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + iconPath + '</svg></span>' +
      '<span class="wf-field-label">' + escapeHtml(label) + '</span>' +
      '<span class="wf-field-value">' + escapeHtml(value || '—') + '</span>' +
    '</div>'
  );
}

const FIELD_ICONS = {
  id: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h6"/>',
  person: PERSON_ICON,
  badge: '<circle cx="12" cy="8" r="6"/><path d="M15.5 13.5 17 22l-5-3-5 3 1.5-8.5"/>',
  building: '<rect x="4" y="2" width="16" height="20" rx="1"/><path d="M9 22v-4h6v4"/>',
  collar: '<path d="M20.59 13.41 13 21l-9-9 7.59-7.59A2 2 0 0 1 13 4h6a2 2 0 0 1 2 2v6a2 2 0 0 1-.41 1.41z"/>',
  pin: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  mail: '<path d="M4 12h4l2 3h4l2-3h4"/><path d="M5.5 6h13l1.5 6v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6l1.5-6z"/>',
  id2: '<rect x="2" y="4" width="20" height="16" rx="2"/><circle cx="8" cy="10" r="2"/><path d="M6 16c0-1.5 1-2.5 2-2.5s2 1 2 2.5"/><line x1="14" y1="9" x2="19" y2="9"/><line x1="14" y1="13" x2="19" y2="13"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>',
  home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  briefcase: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'
};

function showEmployeeDetail(e) {
  document.getElementById('directoryListPanel').hidden = true;
  document.getElementById('directoryDetailPanel').hidden = false;


  document.getElementById('empDetailBody').innerHTML =
    '<div class="wf-emp-profile-head">' +
      '<span class="wf-emp-profile-avatar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + PERSON_ICON + '</svg></span>' +
      '<span class="wf-emp-profile-info">' +
        '<span class="wf-emp-profile-name-row">' +
          '<span class="name">' + escapeHtml(e.name) + '</span>' +
          '<span class="wf-status-chip ' + statusChipClass(e.status) + '">' + escapeHtml(e.status) + '</span>' +
        '</span>' +
        '<div class="wf-emp-profile-sub">' + escapeHtml(e.employeeId) + ' · ' + escapeHtml(e.designation || '—') + '</div>' +
        '<div class="wf-emp-profile-sub">' + escapeHtml(e.department || '—') + '</div>' +
      '</span>' +
      (e.email ? '<a class="wf-emp-mail-btn" href="mailto:' + encodeURIComponent(e.email) + '" aria-label="Email"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + FIELD_ICONS.mail + '</svg></a>' : '') +
    '</div>' +

    '<div class="wf-field-section">' +
      '<h4>Personal &amp; Official Details</h4>' +
      fieldRow(FIELD_ICONS.id, 'Emp. No.', e.employeeId) +
      fieldRow(FIELD_ICONS.person, 'Name', e.name) +
      fieldRow(FIELD_ICONS.badge, 'Designation', e.designation) +
      fieldRow(FIELD_ICONS.building, 'Department', e.department) +
      fieldRow(FIELD_ICONS.collar, 'Collar Type', e.groupD) +
      fieldRow(FIELD_ICONS.pin, 'Location', e.location) +
      fieldRow(FIELD_ICONS.users, 'Reporting DOER', e.reportingDoer) +
      fieldRow(FIELD_ICONS.calendar, 'DOJ', formatDate(e.doj)) +
      fieldRow(FIELD_ICONS.clock, 'Tenure', e.tenure) +
      fieldRow(FIELD_ICONS.clock, 'Total Years of Exp.', e.totalExperience) +
      fieldRow(FIELD_ICONS.calendar, 'Date of Birth', formatDate(e.dob)) +
    '</div>' +

    '<div class="wf-field-section">' +
      '<h4>Identification Details</h4>' +
      fieldRow(FIELD_ICONS.shield, 'UAN Number', e.uan) +
      fieldRow(FIELD_ICONS.shield, 'ESI Number', e.esiNumber) +
      fieldRow(FIELD_ICONS.mail, 'Email ID- Official', e.email) +
      fieldRow(FIELD_ICONS.mail, 'Email ID- Personal', e.emailPersonal) +
      fieldRow(FIELD_ICONS.id2, 'AADHAR CARD', e.aadhar) +
      fieldRow(FIELD_ICONS.card, 'PAN CARD', e.pan) +
    '</div>' +

    '<div class="wf-field-section">' +
      '<h4>Contact &amp; Address Details</h4>' +
      fieldRow(FIELD_ICONS.phone, 'Contact number', e.contactNumber) +
      fieldRow(FIELD_ICONS.home, 'Permanent Address', e.permanentAddress) +
      fieldRow(FIELD_ICONS.home, 'Present Address', e.presentAddress) +
    '</div>' +

    '<div class="wf-field-section">' +
      '<h4>Employment Details</h4>' +
      fieldRow(FIELD_ICONS.briefcase, 'Employment Type', e.employmentType) +
      fieldRow(FIELD_ICONS.shield, 'STATUS', e.status) +
      fieldRow(FIELD_ICONS.users, 'Reporting Manager', e.reportingManager) +
    '</div>' +

    '<div class="wf-field-section">' +
      '<h4>Work Summary</h4>' +
      '<div class="wf-work-summary-grid">' +
        '<div class="wf-work-summary-card">' +
          '<div class="wf-ws-icon"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + FIELD_ICONS.clock + '</svg></div>' +
          '<div class="wf-ws-label">Tenure</div>' +
          '<div class="wf-ws-value">' + escapeHtml(e.tenure || '—') + '</div>' +
        '</div>' +
        '<div class="wf-work-summary-card">' +
          '<div class="wf-ws-icon"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + FIELD_ICONS.calendar + '</svg></div>' +
          '<div class="wf-ws-label">Date of Joining</div>' +
          '<div class="wf-ws-value">' + formatDate(e.doj) + '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
}

document.getElementById('empDetailBackBtn').addEventListener('click', () => {
  document.getElementById('directoryDetailPanel').hidden = true;
  document.getElementById('directoryListPanel').hidden = false;
});

// ---------- Joining tab ----------
// "Upcoming" is Gmail-sourced (confirmed new hires not yet in the HR sheet -
// same data as the Mail Management "Upcoming Joinings" widget). "Recent" is
// real Employee_Master data: whoever's DOJ falls in the last 1 month.

let joiningActiveTab = 'upcoming';
const joiningCache = {};

document.getElementById('joiningTabs').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-jtab]');
  if (!btn || btn.dataset.jtab === joiningActiveTab) return;
  joiningActiveTab = btn.dataset.jtab;
  document.querySelectorAll('#joiningTabs [data-jtab]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b === btn));
  });
  document.getElementById('exportJoiningsPdf').hidden = joiningActiveTab !== 'upcoming';
  renderJoiningTab(joiningActiveTab);
});

function joinDateBadge(doj) {
  const d = new Date(doj);
  if (isNaN(d.getTime())) return { day: '—', month: '' };
  return { day: String(d.getDate()).padStart(2, '0'), month: d.toLocaleDateString(undefined, { month: 'short' }) };
}

function daysUntilLabel(doj) {
  const d = new Date(doj);
  if (isNaN(d.getTime())) return '';
  const today = new Date();
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const dojUtc = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((dojUtc - todayUtc) / 86400000);
  if (days < 0) return '';
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return 'in ' + days + ' days';
}

function joinRow(name, designation, subLabel, doj, showCountdown) {
  const badge = joinDateBadge(doj);
  const countdown = showCountdown ? daysUntilLabel(doj) : '';
  return (
    '<li>' +
      '<span class="wf-join-badge-wrap">' +
        '<span class="wf-join-badge"><b>' + badge.day + '</b><span>' + badge.month + '</span></span>' +
        (countdown ? '<span class="wf-join-countdown">' + escapeHtml(countdown) + '</span>' : '') +
      '</span>' +
      '<span class="wf-join-main">' +
        '<span class="wf-join-name">' + escapeHtml(name) + '</span>' +
        '<span class="wf-join-sub" style="display:block;">' + escapeHtml(designation || '—') + ' · ' + escapeHtml(subLabel || '—') + '</span>' +
      '</span>' +
    '</li>'
  );
}

let upcomingJoiningsCache = [];

async function fetchJoiningTab(tab) {
  if (tab === 'upcoming') {
    const data = await fetchJson('/api/hr/upcoming-joinings');
    upcomingJoiningsCache = data.items;
    return data.items.length
      ? data.items.map((it) => joinRow(it.name, it.designation, it.company, it.doj, true)).join('')
      : '<li class="empty">No upcoming joinings found</li>';
  }
  const today = new Date();
  const from = new Date(today);
  from.setMonth(from.getMonth() - 1);
  const params = new URLSearchParams({
    dateFrom: from.toISOString().slice(0, 10),
    dateTo: today.toISOString().slice(0, 10)
  });
  const data = await fetchJson('/api/workforce/employees?' + params.toString());
  const items = data.items.slice().sort((a, b) => new Date(b.doj) - new Date(a.doj));
  return items.length
    ? items.map((it) => joinRow(it.name, it.designation, it.department, it.doj, false)).join('')
    : '<li class="empty">No recent joiners in the last month</li>';
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

document.getElementById('exportJoiningsPdf').addEventListener('click', async () => {
  if (!upcomingJoiningsCache.length) {
    await fetchJoiningTab('upcoming');
  }
  document.getElementById('printReportTitle').textContent = 'Upcoming Joinings Report';
  document.getElementById('printReportSubtitle').textContent = '';
  document.getElementById('printReportHead').innerHTML =
    '<th>Name</th><th>Designation</th><th>Company</th><th>Date of Joining</th><th>Days Remaining</th>';
  document.getElementById('printReportDate').textContent =
    new Date().toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
  document.getElementById('printReportBody').innerHTML = upcomingJoiningsCache.length
    ? upcomingJoiningsCache
        .map((it) => (
          '<tr>' +
            '<td>' + escapeHtml(it.name) + '</td>' +
            '<td>' + escapeHtml(it.designation || '—') + '</td>' +
            '<td>' + escapeHtml(it.company || '—') + '</td>' +
            '<td>' + formatDate(it.doj) + '</td>' +
            '<td>' + escapeHtml(daysUntilLabel(it.doj) || '—') + '</td>' +
          '</tr>'
        ))
        .join('')
    : '<tr><td colspan="5">No upcoming joinings found</td></tr>';
  window.print();
});

// ---------- Tenure tab ----------

async function loadTenureView() {
  const rowsEl = document.getElementById('tenureRows');
  rowsEl.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const data = await fetchJson('/api/workforce/tenure');
    const palette = distributionPalette();
    // The donut only covers tenure-eligible employees (inactive staff are
    // excluded - see the note below), so the center total is that eligible
    // count, not the company-wide headcount - it has to match what the
    // segments actually sum to.
    document.getElementById('tenureDonutTotal').textContent = data.eligibleCount.toLocaleString();

    const total = data.buckets.reduce((sum, b) => sum + b.count, 0) || 1;
    rowsEl.innerHTML =
      '<div class="wf-dist-row wf-dist-header">' +
        '<span class="wf-dist-label-col">Tenure Range</span>' +
        '<span class="wf-dist-num-col">Employees</span>' +
        '<span class="wf-dist-num-col">% of Total</span>' +
      '</div>' +
      data.buckets
        .map((b, i) => (
          '<div class="wf-dist-row">' +
            '<span class="wf-dist-label-col"><span class="wf-dist-dot" style="background:' + palette[i % palette.length] + '"></span>' + escapeHtml(b.label) + '</span>' +
            '<span class="wf-dist-num-col">' + b.count + '</span>' +
            '<span class="wf-dist-num-col">' + (Math.round((b.count / total) * 1000) / 10) + '%</span>' +
          '</div>'
        ))
        .join('') +
      '<div class="wf-dist-row wf-dist-total-row">' +
        '<span class="wf-dist-label-col"><span class="wf-dist-total-icon">' + icon('total', 14) + '</span>Total</span>' +
        '<span class="wf-dist-num-col">' + data.eligibleCount + '</span>' +
        '<span class="wf-dist-num-col">100%</span>' +
      '</div>';
    document.getElementById('tenureNote').textContent =
      data.missingDojCount > 0
        ? data.eligibleCount + ' of ' + data.activeCount + ' Active employees shown — ' + data.missingDojCount +
          (data.missingDojCount === 1 ? ' is' : ' are') + ' missing a Date of Joining, so tenure can\'t be calculated for them.'
        : '';
    renderTenureDonut(data.buckets);
  } catch (err) {
    rowsEl.innerHTML = '<div class="error-banner">' + escapeHtml(err.message) + '</div>';
  }
}

// No separate legend here - the label/value/pct rows above already cover
// that, so this donut is just the visual summary (matches the reference).
function renderTenureDonut(buckets) {
  const palette = distributionPalette();

  destroyChart('tenureDonut');
  const ctx = document.getElementById('tenureDonut');
  charts.tenureDonut = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: buckets.map((b) => b.label),
      datasets: [{ data: buckets.map((b) => b.count), backgroundColor: buckets.map((_, i) => palette[i % palette.length]), borderWidth: 2, borderColor: chartColors().surface }]
    },
    options: { cutout: '68%', plugins: { legend: { display: false }, tooltip: { enabled: true } } }
  });
}

// ---------- Age Distribution (Demographics) ----------

// Shared by Age Distribution (8 buckets) and Tenure (7 buckets) - the app's
// core semantic palette only has 6 (accent/resolved/warning/candidate/
// important/muted), so two more muted tones are added here, in the same
// desaturated style, for whichever chart needs the extra variety.
function distributionPalette() {
  const c = chartColors();
  return [c.accent, c.resolved, c.warning, c.candidate, c.important, c.muted, '#4a5a8a', '#7c5295'];
}

async function loadAgeDistributionView() {
  const rowsEl = document.getElementById('ageRows');
  rowsEl.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const data = await fetchJson('/api/workforce/age');
    const palette = distributionPalette();
    const total = data.buckets.reduce((sum, b) => sum + b.count, 0) || 1;

    document.getElementById('ageDonutTotal').textContent = data.eligibleCount.toLocaleString();

    rowsEl.innerHTML =
      '<div class="wf-dist-row wf-dist-header">' +
        '<span class="wf-dist-label-col">Age Range</span>' +
        '<span class="wf-dist-num-col">Employees</span>' +
        '<span class="wf-dist-num-col">% of Total</span>' +
      '</div>' +
      data.buckets
        .map((b, i) => (
          '<div class="wf-dist-row clickable" tabindex="0" role="button" data-age-min="' + b.minAge + '"' +
            (b.maxAge !== null && b.maxAge !== undefined ? ' data-age-max="' + b.maxAge + '"' : '') + '>' +
            '<span class="wf-dist-label-col"><span class="wf-dist-dot" style="background:' + palette[i % palette.length] + '"></span>' + escapeHtml(b.label) + '</span>' +
            '<span class="wf-dist-num-col">' + b.count + '</span>' +
            '<span class="wf-dist-num-col">' + (Math.round((b.count / total) * 1000) / 10) + '%</span>' +
          '</div>'
        ))
        .join('') +
      '<div class="wf-dist-row wf-dist-total-row">' +
        '<span class="wf-dist-label-col"><span class="wf-dist-total-icon">' + icon('total', 14) + '</span>Total</span>' +
        '<span class="wf-dist-num-col">' + data.eligibleCount + '</span>' +
        '<span class="wf-dist-num-col">100%</span>' +
      '</div>';

    document.getElementById('ageNote').textContent =
      data.missingDobCount > 0
        ? data.eligibleCount + ' of ' + data.activeCount + ' Active employees shown — ' + data.missingDobCount +
          (data.missingDobCount === 1 ? ' is' : ' are') + ' missing a Date of Birth, so age can\'t be calculated for them.'
        : '';
    renderAgeDonut(data.buckets);
  } catch (err) {
    rowsEl.innerHTML = '<div class="error-banner">' + escapeHtml(err.message) + '</div>';
  }
}

function renderAgeDonut(buckets) {
  const palette = distributionPalette();

  destroyChart('ageDonut');
  const ctx = document.getElementById('ageDonut');
  charts.ageDonut = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: buckets.map((b) => b.label),
      datasets: [{ data: buckets.map((b) => b.count), backgroundColor: buckets.map((_, i) => palette[i % palette.length]), borderWidth: 2, borderColor: chartColors().surface }]
    },
    options: { cutout: '62%', plugins: { legend: { display: false }, tooltip: { enabled: true } } }
  });
}

async function loadGenderDistributionView() {
  const rowsEl = document.getElementById('genderRows');
  rowsEl.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const data = await fetchJson('/api/workforce/gender');
    const palette = distributionPalette();
    const total = data.buckets.reduce((sum, b) => sum + b.count, 0) || 1;
    document.getElementById('genderDonutTotal').textContent = data.eligibleCount.toLocaleString();
    rowsEl.innerHTML =
      '<div class="wf-dist-row wf-dist-header">' +
        '<span class="wf-dist-label-col">Gender</span>' +
        '<span class="wf-dist-num-col">Employees</span>' +
        '<span class="wf-dist-num-col">% of Total</span>' +
      '</div>' +
      data.buckets.map((b, i) => (
        '<div class="wf-dist-row clickable" tabindex="0" role="button" data-gender="' + escapeHtml(b.label) + '">' +
          '<span class="wf-dist-label-col"><span class="wf-dist-dot" style="background:' + palette[i % palette.length] + '"></span>' + escapeHtml(b.label) + '</span>' +
          '<span class="wf-dist-num-col">' + b.count + '</span>' +
          '<span class="wf-dist-num-col">' + (Math.round((b.count / total) * 1000) / 10) + '%</span>' +
        '</div>'
      )).join('') +
      '<div class="wf-dist-row wf-dist-total-row">' +
        '<span class="wf-dist-label-col"><span class="wf-dist-total-icon">' + icon('total', 14) + '</span>Total</span>' +
        '<span class="wf-dist-num-col">' + data.eligibleCount + '</span>' +
        '<span class="wf-dist-num-col">100%</span>' +
      '</div>';
    document.getElementById('genderNote').textContent =
      data.missingGenderCount > 0
        ? data.eligibleCount + ' of ' + data.activeCount + ' Active employees shown — ' + data.missingGenderCount +
          (data.missingGenderCount === 1 ? ' is' : ' are') + ' missing a recorded Gender.'
        : '';
    renderGenderDonut(data.buckets);
  } catch (err) {
    rowsEl.innerHTML = '<div class="error-banner">' + escapeHtml(err.message) + '</div>';
  }
}

function renderGenderDonut(buckets) {
  const palette = distributionPalette();
  destroyChart('genderDonut');
  const ctx = document.getElementById('genderDonut');
  charts.genderDonut = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: buckets.map((b) => b.label),
      datasets: [{ data: buckets.map((b) => b.count), backgroundColor: buckets.map((_, i) => palette[i % palette.length]), borderWidth: 2, borderColor: chartColors().surface }]
    },
    options: { cutout: '62%', plugins: { legend: { display: false }, tooltip: { enabled: true } } }
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
