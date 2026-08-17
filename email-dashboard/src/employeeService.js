const { getSheetsClient, hasServiceAccount } = require('./sheetsAuth');

const SHEET_ID = process.env.HR_SHEET_ID || '1I1vJJy5vXDMysBvXkXREImNZORr6ko1OMvPoNo984RI';
const TAB_NAME = 'Employee_Master';
const DATA_START_ROW = 5; // row 1: title, row 2: blank, row 3: column numbers, row 4: headers
const CACHE_TTL_MS = 2 * 60 * 1000;

// 0-based column indexes within Employee_Master, from the real header row (row 4).
const COLS = {
  employeeId: 1,       // New Emp. No.
  name: 2,              // Person Accountable (confirmed = employee name)
  designation: 3,
  department: 4,
  location: 7,
  reportingManager: 10,
  doj: 12,
  dob: 16,
  email: 26,
  employmentType: 37,
  status: 38
};

const MONTH_ABBR = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
};

function parseSheetDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (!m) return null;
  const [, d, mon, yRaw] = m;
  const monthIndex = MONTH_ABBR[mon.toLowerCase()];
  if (monthIndex === undefined) return null;
  let year = Number(yRaw);
  if (yRaw.length === 2) year = year <= 49 ? 2000 + year : 1900 + year;
  const date = new Date(Date.UTC(year, monthIndex, Number(d)));
  return isNaN(date.getTime()) ? null : date;
}

function cleanValue(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeKey(value) {
  return cleanValue(value).toLowerCase().replace(/\s+/g, ' ');
}

function parseRow(row, index) {
  const employeeId = cleanValue(row[COLS.employeeId]);
  const name = cleanValue(row[COLS.name]);
  if (!employeeId && !name) return null; // skip blank/spacer rows

  const department = cleanValue(row[COLS.department]);
  const location = cleanValue(row[COLS.location]);

  return {
    rowNumber: DATA_START_ROW + index,
    employeeId,
    name,
    designation: cleanValue(row[COLS.designation]),
    department,
    departmentKey: normalizeKey(department),
    location,
    locationKey: normalizeKey(location),
    doj: parseSheetDate(row[COLS.doj]),
    dob: parseSheetDate(row[COLS.dob]),
    employmentType: cleanValue(row[COLS.employmentType]),
    status: cleanValue(row[COLS.status]).toUpperCase(),
    reportingManager: cleanValue(row[COLS.reportingManager]),
    email: cleanValue(row[COLS.email])
  };
}

// Department/Location names have real-world case inconsistencies (e.g.
// "HORTICULTURE" vs "Horticulture"). Group by normalized key, but display
// whichever original spelling is most common for that key.
function buildDisplayNames(employees, field) {
  const keyField = field + 'Key';
  const variantCounts = new Map();
  for (const emp of employees) {
    const key = emp[keyField];
    if (!key) continue;
    const variants = variantCounts.get(key) || new Map();
    variants.set(emp[field], (variants.get(emp[field]) || 0) + 1);
    variantCounts.set(key, variants);
  }
  const display = new Map();
  for (const [key, variants] of variantCounts.entries()) {
    let best = null;
    let bestCount = -1;
    for (const [variant, count] of variants.entries()) {
      if (count > bestCount) {
        best = variant;
        bestCount = count;
      }
    }
    display.set(key, best);
  }
  return display;
}

let cache = { employees: null, fetchedAt: 0, departmentNames: new Map(), locationNames: new Map() };
let inFlight = null;

async function fetchRawRows() {
  const sheets = getSheetsClient();
  // Only A:AM (through STATUS) is ever read — cuts payload size vs the full
  // A:BC range, which included columns this app never uses.
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `'${TAB_NAME}'!A${DATA_START_ROW}:AM`
  });
  return res.data.values || [];
}

function refreshCache() {
  // Collapse concurrent callers into a single in-flight fetch instead of
  // hammering the Sheets API when several report requests land at once.
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const rows = await fetchRawRows();
    const employees = rows.map(parseRow).filter(Boolean);
    cache = {
      employees,
      fetchedAt: Date.now(),
      departmentNames: buildDisplayNames(employees, 'department'),
      locationNames: buildDisplayNames(employees, 'location')
    };
    return cache;
  })();

  return inFlight.finally(() => {
    inFlight = null;
  });
}

async function getEmployeeData({ forceRefresh = false } = {}) {
  const now = Date.now();
  const isStale = !cache.employees || now - cache.fetchedAt >= CACHE_TTL_MS;

  // Only block the caller when there's truly nothing to serve yet. Once a
  // cache exists, every call returns instantly — a stale cache is refreshed
  // quietly in the background so the *next* call is fresh, instead of
  // making *this* call (e.g. a dashboard refresh) wait on a live fetch.
  if (!cache.employees) {
    return refreshCache();
  }
  if (forceRefresh || isStale) {
    refreshCache().catch(() => {});
  }
  return cache;
}

// Warm the cache as soon as the server starts, so the first real request
// doesn't have to pay for the initial Sheets fetch either.
getEmployeeData().catch(() => {});

function getConfigStatus() {
  return {
    ok: hasServiceAccount(),
    missing: hasServiceAccount() ? [] : ['GOOGLE_SERVICE_ACCOUNT_JSON (or local service-account.json)']
  };
}

module.exports = {
  getEmployeeData,
  getConfigStatus,
  normalizeKey,
  CACHE_TTL_MS
};
