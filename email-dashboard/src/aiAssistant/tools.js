// HR Assistant "tools" - one thin async function per capability, each
// reusing this app's EXISTING data services/analytics (employeeService,
// workforceAnalytics, movementTracker, insuranceService) instead of
// duplicating any HR calculation. mockProvider.js decides which of these
// to call from a person's typed message; a future real AI provider would
// make that same decision via tool-calling, calling the exact same
// functions - nothing here is mock, only the intent-matching that picks
// which one runs is.
const employeeService = require('../employeeService');
const analytics = require('../workforceAnalytics');
const movementTracker = require('../movementTracker');
const insuranceService = require('../insuranceService');

const isActive = (e) => e.status === 'ACTIVE';

const CARD_ROW_LIMIT = 8;

async function departmentHeadcount() {
  const { employees, departmentNames } = await employeeService.getEmployeeData();
  const rows = analytics.departmentBreakdown(employees, departmentNames, isActive);
  const total = employees.filter(isActive).length;
  const top = rows.slice(0, CARD_ROW_LIMIT);
  const rest = rows.length - top.length;
  return {
    title: 'Department-wise Active Headcount' + (rest > 0 ? ' (Top ' + CARD_ROW_LIMIT + ')' : ''),
    rows: top.map((r) => ({ label: r.name, value: r.count })),
    footer: { label: 'Total Active Employees', value: total },
    actions: [{ label: 'View Full Report', view: 'directory' }, { label: 'Download PDF', downloadUrl: '/api/workforce/department-breakdown/pdf' }]
  };
}

async function joiningThisMonth() {
  const { employees, departmentNames } = await employeeService.getEmployeeData();
  const now = new Date();
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  const joiners = employees.filter((e) => e.doj && e.doj.getUTCFullYear() === y && e.doj.getUTCMonth() === m);
  return {
    title: 'Employees Joining This Month',
    rows: joiners.slice(0, CARD_ROW_LIMIT).map((e) => ({
      label: e.name,
      value: (departmentNames.get(e.departmentKey) || e.department) + ' · ' + e.doj.toISOString().slice(0, 10)
    })),
    footer: { label: 'Total Joiners', value: joiners.length },
    actions: [{ label: 'Open Joining Report', view: 'joining' }]
  };
}

// monthOffset 0 = this month, 1 = next month - "confirmation due next
// month" is one of the spec's own example commands, so this needs to
// look at a month other than the current one.
async function pendingConfirmations(monthOffset = 0) {
  const { employees, departmentNames } = await employeeService.getEmployeeData();
  const now = new Date();
  const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthOffset, 1));
  const list = analytics.pendingConfirmationsThisMonth(employees, target);
  const label = monthOffset === 0 ? 'This Month' : 'Next Month';
  return {
    title: 'Confirmations Due ' + label,
    rows: list.slice(0, CARD_ROW_LIMIT).map((e) => ({ label: e.name, value: departmentNames.get(e.departmentKey) || e.department })),
    footer: { label: 'Total Pending', value: list.length },
    actions: [{ label: 'Open Tenure View', view: 'tenure' }]
  };
}

async function joiningTrend() {
  const { employees } = await employeeService.getEmployeeData();
  const trend = analytics.joiningTrend(employees, 12);
  return {
    title: 'Joining Trend (Last 12 Months)',
    rows: trend.map((t) => ({ label: t.month || t.label || t.key, value: t.count })),
    actions: [{ label: 'Open Joining Report', view: 'joining' }]
  };
}

async function retirementThisMonth() {
  const { employees, departmentNames } = await employeeService.getEmployeeData();
  const list = analytics.turning58ThisMonth(employees);
  return {
    title: 'Employees Reaching Retirement Age This Month',
    rows: list.slice(0, CARD_ROW_LIMIT).map((e) => ({ label: e.name, value: departmentNames.get(e.departmentKey) || e.department })),
    footer: { label: 'Total', value: list.length },
    actions: list.length ? [{ label: 'Open Employee Data', view: 'directory' }] : null
  };
}

async function workforceMovement(days = 90) {
  const [department, designation, company, location] = await Promise.all([
    movementTracker.getTransfersInLastDays(days),
    movementTracker.getPromotionsInLastDays(days),
    movementTracker.getCompanyTransfersInLastDays(days),
    movementTracker.getLocationTransfersInLastDays(days)
  ]);
  return {
    title: 'Workforce Movement (last ' + Math.round(days / 30) + ' months)',
    rows: [
      { label: 'Department Transfers', value: department.total },
      { label: 'Promotions', value: designation.total },
      { label: 'Company Transfers', value: company.total },
      { label: 'Location Transfers', value: location.total }
    ],
    actions: [{ label: 'Open Workforce Movement', view: 'movement' }]
  };
}

async function healthInsurancePendingAdditions() {
  const insuranceData = await insuranceService.getInsuranceData();
  const additions = insuranceData.additions || [];
  return {
    title: 'Pending Health Insurance Additions',
    rows: additions.slice(0, CARD_ROW_LIMIT).map((a) => ({ label: a.name, value: a.employeeId })),
    footer: { label: 'Total Pending', value: additions.length },
    actions: [{ label: 'Open Health Insurance', view: 'healthInsurance' }]
  };
}

async function dataQualityIssues() {
  const { employees } = await employeeService.getEmployeeData();
  const report = analytics.dataQualityReport(employees);
  const labels = { department: 'Missing Department', location: 'Missing Location', designation: 'Missing Designation', doj: 'Missing Date of Joining', dob: 'Missing Date of Birth', email: 'Missing Email' };
  const rows = Object.entries(report.missing).map(([key, count]) => ({ label: labels[key] || key, value: count }));
  rows.push({ label: 'Duplicate Employee IDs', value: report.duplicateIds.length });
  return {
    title: 'Data Quality Issues',
    rows,
    footer: { label: 'Total Employees Checked', value: report.total },
    actions: [{ label: 'Open Data Quality', view: 'quality' }]
  };
}

async function insightsSummary() {
  const { employees, departmentNames, locationNames, doerNames } = await employeeService.getEmployeeData();
  const list = analytics.buildInsights(employees, departmentNames, locationNames, doerNames);
  return {
    title: 'Insights',
    rows: list.slice(0, 8).map((i) => ({ label: i.text, value: '' })),
    actions: [{ label: 'Open Insights', view: 'insights' }]
  };
}

async function demographics(kind) {
  const { employees } = await employeeService.getEmployeeData();
  const fn = {
    age: analytics.ageAnalytics,
    gender: analytics.genderAnalytics,
    collar: analytics.collarAnalytics,
    tenure: analytics.tenureAnalytics
  }[kind];
  const view = { age: 'ageDistribution', gender: 'genderDistribution', collar: 'collarDistribution', tenure: 'tenure' }[kind];
  const title = { age: 'Age Distribution', gender: 'Gender Distribution', collar: 'Category Distribution', tenure: 'Tenure Distribution' }[kind];
  const data = fn(employees);
  return {
    title: kind === 'tenure' && data.averageTenureYears !== null
      ? title + ' (avg ' + data.averageTenureYears + ' yrs)'
      : title,
    rows: data.buckets.map((b) => ({ label: b.label, value: b.count })),
    footer: { label: 'Active Employees', value: data.activeCount },
    actions: [{ label: 'Open ' + title, view }]
  };
}

const LIST_DEFAULT_LIMIT = 50;
const LIST_MAX_LIMIT = 200;

// Same filter shape as /api/workforce/employees and its PDF export
// (employeeService.filterEmployees) - so "Download PDF" below can just
// point at that existing, already-tested route with the same query
// params, no new PDF-building code needed.
function buildEmployeeQueryString(filters) {
  const params = new URLSearchParams();
  [
    'designation', 'department', 'status', 'dateFrom', 'dateTo', 'q',
    'tenureYearsMin', 'tenureYearsMax', 'experienceYearsMin', 'experienceYearsMax'
  ].forEach((key) => {
    if (filters && filters[key] !== undefined && filters[key] !== null && filters[key] !== '') {
      params.set(key, filters[key]);
    }
  });
  const qs = params.toString();
  return qs ? '?' + qs : '';
}

const LIST_SORT_FIELDS = {
  name: (e) => (e.name || '').toLowerCase(),
  employeeId: (e) => (e.employeeId || '').toLowerCase(),
  designation: (e) => (e.designation || '').toLowerCase(),
  department: (e, departmentNames) => (departmentNames.get(e.departmentKey) || e.department || '').toLowerCase(),
  doj: (e) => (e.doj ? e.doj.getTime() : 0)
};

// A genuine filtered/sorted employee LIST (as opposed to every other tool
// here, which returns a count or summary) - the gap that made the
// assistant wrongly claim "no access to employee lists" for a request
// like "list engineers in my active data". Read-only: this only ever
// reads via employeeService.getEmployeeData()/filterEmployees, the exact
// same read path the rest of the app uses - no new data access, just a
// new shape (a real row-per-employee table) for the AI to return.
async function listEmployees(filters = {}) {
  const { employees, departmentNames } = await employeeService.getEmployeeData();
  const filtered = employeeService.filterEmployees(employees, filters);

  const sortKey = LIST_SORT_FIELDS[filters.sortBy] ? filters.sortBy : 'name';
  const sortDir = filters.sortDir === 'desc' ? -1 : 1;
  const getSortValue = LIST_SORT_FIELDS[sortKey];
  const sorted = filtered.slice().sort((a, b) => {
    const va = getSortValue(a, departmentNames);
    const vb = getSortValue(b, departmentNames);
    if (va < vb) return -1 * sortDir;
    if (va > vb) return 1 * sortDir;
    return 0;
  });

  const limit = Math.max(1, Math.min(Number(filters.limit) || LIST_DEFAULT_LIMIT, LIST_MAX_LIMIT));
  const shown = sorted.slice(0, limit);
  const truncated = filtered.length > shown.length;

  return {
    title: 'Employee List',
    columns: ['Emp Code', 'Name', 'Designation', 'Department', 'Status', 'DOJ'],
    tableRows: shown.map((e) => [
      e.employeeId,
      e.name,
      e.designation || '—',
      departmentNames.get(e.departmentKey) || e.department || '—',
      e.status,
      e.doj ? e.doj.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
    ]),
    footer: { label: 'Total Matching', value: filtered.length },
    note: truncated
      ? ('Showing ' + shown.length + ' of ' + filtered.length + ' - narrow your filters, sort differently, or download the full PDF to see the rest.')
      : null,
    actions: [
      { label: 'View Full Report', view: 'directory' },
      { label: 'Download PDF', downloadUrl: '/api/workforce/employees/pdf' + buildEmployeeQueryString(filters) }
    ]
  };
}

const GROUP_BY_FIELDS = {
  department: (e, names) => names.departmentNames.get(e.departmentKey) || e.department || 'Unspecified',
  designation: (e) => e.designation || 'Unspecified',
  status: (e) => e.status || 'Unspecified',
  location: (e, names) => names.locationNames.get(e.locationKey) || e.location || 'Unspecified',
  gender: (e) => e.gender || 'Unspecified',
  collar: (e) => employeeService.formatCollar(e.groupD) || 'Unspecified'
};
const GROUP_BY_LABELS = {
  department: 'Department', designation: 'Designation', status: 'Status',
  location: 'Location', gender: 'Gender', collar: 'Category'
};

// Counts, grouped by any one field, over the same filtered set list_
// employees would return - answers "how many X per Y" (e.g. "how many
// engineers per department") without a preset report existing for it.
async function groupEmployees(filters = {}, groupBy = 'department') {
  const { employees, departmentNames, locationNames } = await employeeService.getEmployeeData();
  const filtered = employeeService.filterEmployees(employees, filters);
  const getGroupKey = GROUP_BY_FIELDS[groupBy] || GROUP_BY_FIELDS.department;
  const names = { departmentNames, locationNames };

  const counts = new Map();
  filtered.forEach((e) => {
    const key = getGroupKey(e, names);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const allRows = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({ label, value }));
  const top = allRows.slice(0, CARD_ROW_LIMIT);
  const rest = allRows.length - top.length;
  const groupLabel = GROUP_BY_LABELS[groupBy] || 'Department';

  return {
    title: 'Employee Count by ' + groupLabel + (rest > 0 ? ' (Top ' + CARD_ROW_LIMIT + ')' : ''),
    rows: top,
    footer: { label: 'Total Matching', value: filtered.length },
    actions: [
      { label: 'View Full Report', view: 'directory' },
      { label: 'Download PDF', downloadUrl: '/api/workforce/employees/pdf' + buildEmployeeQueryString(filters) }
    ]
  };
}

// Simple substring match on name/employeeId - the same convention every
// existing employee-search list in workforce.js already uses.
async function findEmployee(query) {
  const { employees, departmentNames } = await employeeService.getEmployeeData();
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return employees
    .filter((e) => e.name.toLowerCase().includes(q) || e.employeeId.toLowerCase().includes(q))
    .slice(0, 5)
    .map((e) => ({
      employeeId: e.employeeId,
      name: e.name,
      designation: e.designation,
      department: departmentNames.get(e.departmentKey) || e.department
    }));
}

// Shared by both providers (mockProvider's letter rule and
// claudeProvider's "prepareLetter" tool both call this) so the exact same
// employee-lookup + card shape backs a letter request regardless of
// which one is answering.
const LETTER_TYPES = {
  promotion: 'Promotion & Increment Letter',
  increment: 'Increment Letter',
  confirmation: 'Confirmation Letter'
};

async function prepareLetter({ name, letterType }) {
  const type = LETTER_TYPES[letterType] || LETTER_TYPES.promotion;
  const matches = name ? await findEmployee(name) : [];
  if (!matches.length) {
    return { title: null, rows: null, actions: [{ label: 'Open Letter Generator', view: 'letterGenerator' }], notFound: name };
  }
  const emp = matches[0];
  return {
    title: type,
    rows: [
      { label: 'Employee Name', value: emp.name },
      { label: 'Employee ID', value: emp.employeeId },
      { label: 'Designation', value: emp.designation },
      { label: 'Department', value: emp.department },
      { label: 'Letter Type', value: type }
    ],
    actions: [{ label: 'Open Letter Generator', view: 'letterGenerator', employeeId: emp.employeeId }]
  };
}

// A pure navigation "tool" - no data lookup, just tells the UI which
// existing view to open (setView() in workforce.js, unchanged). Scoped
// to the same view names the drawer nav itself exposes, so this can
// never navigate anywhere the existing app doesn't already have a menu
// item for.
const NAVIGABLE_VIEWS = {
  overview: 'Dashboard', directory: 'Employee Data', joining: 'Joining', tenure: 'Tenure',
  movement: 'Workforce Movement', doerManagement: 'Doer Management', orgChart: 'Organization Chart',
  healthInsurance: 'Health Insurance', interviewPanel: 'Interview Panel', letterGenerator: 'Letter Generator',
  insights: 'Insights', quality: 'Data Quality', ageDistribution: 'Age Distribution',
  genderDistribution: 'Gender Distribution', collarDistribution: 'Category Distribution'
};

async function navigateToView(view) {
  const label = NAVIGABLE_VIEWS[view];
  if (!label) return { title: null, rows: null, actions: null };
  return { title: null, rows: null, actions: [{ label: 'Open ' + label, view }] };
}

module.exports = {
  departmentHeadcount,
  joiningThisMonth,
  joiningTrend,
  pendingConfirmations,
  retirementThisMonth,
  workforceMovement,
  healthInsurancePendingAdditions,
  dataQualityIssues,
  insightsSummary,
  demographics,
  findEmployee,
  listEmployees,
  groupEmployees,
  prepareLetter,
  navigateToView,
  NAVIGABLE_VIEWS
};
