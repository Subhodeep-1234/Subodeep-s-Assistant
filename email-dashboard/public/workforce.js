const subtitle = document.getElementById('subtitle');
const kpiGrid = document.getElementById('kpiGrid');
const wfTabs = document.getElementById('wfTabs');
const overviewView = document.getElementById('overviewView');
const directoryView = document.getElementById('directoryView');

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

document.getElementById('refreshBtn').addEventListener('click', () => {
  loadStatus();
  loadOverview();
  if (!directoryView.hidden) loadEmployees();
});

wfTabs.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-view]');
  if (!btn) return;
  setView(btn.dataset.view);
});

function setView(view) {
  wfTabs.querySelectorAll('[data-view]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.view === view));
  });
  overviewView.hidden = view !== 'overview';
  directoryView.hidden = view !== 'directory';
  if (view === 'directory') loadEmployees();
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function loadStatus() {
  try {
    const res = await fetch('/api/workforce/status');
    if (!res.ok) throw new Error((await res.json()).error || 'Failed to load');
    const data = await res.json();
    subtitle.textContent = data.totalRecords + ' employee records · updated live from Google Sheets';
  } catch (err) {
    subtitle.textContent = 'Error loading status';
  }
}

function kpiCard({ key, label, value, tone, clickable, title }) {
  const isNa = value === null || value === undefined;
  const displayValue = isNa ? 'N/A' : value;
  return (
    '<button class="kpi-card' + (tone ? ' tone-' + tone : '') + '" data-kpi="' + key + '"' +
      (clickable === false || isNa ? ' disabled' : '') +
      (title ? ' title="' + escapeHtml(title) + '"' : '') +
    '>' +
      '<span class="kpi-num' + (isNa ? ' na' : '') + '">' + displayValue + '</span>' +
      '<span class="kpi-label">' + escapeHtml(label) + '</span>' +
    '</button>'
  );
}

async function loadOverview() {
  kpiGrid.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const res = await fetch('/api/workforce/overview');
    if (!res.ok) throw new Error((await res.json()).error || 'Failed to load');
    const data = await res.json();
    kpiGrid.innerHTML =
      kpiCard({ key: 'total', label: 'Total Employees', value: data.total }) +
      kpiCard({ key: 'active', label: 'Active', value: data.active, tone: 'active' }) +
      kpiCard({ key: 'notice', label: 'Notice Period', value: data.noticePeriod, tone: 'notice' }) +
      kpiCard({ key: 'inactive', label: 'Inactive', value: data.inactive, tone: 'inactive' }) +
      kpiCard({ key: 'probation', label: 'Probation', value: data.probation, tone: 'probation' }) +
      kpiCard({ key: 'confirmed', label: 'Confirmed', value: data.confirmed, tone: 'confirmed' }) +
      kpiCard({ key: 'joined', label: 'Joined This Month', value: data.joinedThisMonth, tone: 'active' });
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
    inactive: { status: 'INACTIVE' },
    probation: { employmentType: 'Probation' },
    confirmed: { employmentType: 'Confirmed' },
    joined: thisMonthRange()
  };
  applyFiltersAndShowDirectory(filterMap[card.dataset.kpi] || {});
});

function thisMonthRange() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return { dateFrom: start.toISOString(), dateTo: end.toISOString() };
}

function applyFiltersAndShowDirectory(filters) {
  activeFilters = filters;
  filterStatus.value = filters.status || '';
  filterEmploymentType.value = filters.employmentType || '';
  filterDepartment.value = filters.department || '';
  filterLocation.value = filters.location || '';
  wfSearch.value = filters.q || '';
  setView('directory');
}

async function loadFilterOptions() {
  try {
    const res = await fetch('/api/workforce/filters');
    if (!res.ok) return;
    const data = await res.json();
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

async function loadEmployees() {
  const requestId = ++currentRequestId;
  employeeTableBody.innerHTML =
    '<tr><td colspan="9"><div class="loading"><div class="spinner"></div></div></td></tr>';
  const params = new URLSearchParams();
  Object.entries(activeFilters).forEach(([k, v]) => {
    if (v) params.set(k, v);
  });
  try {
    const res = await fetch('/api/workforce/employees?' + params.toString());
    if (!res.ok) throw new Error((await res.json()).error || 'Failed to load');
    const data = await res.json();
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

loadStatus();
loadOverview();
loadFilterOptions();
