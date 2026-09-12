const { getSheetsClient } = require('./sheetsAuth');

// Separate spreadsheet from HR Master Data - "Mediclaim Addition & Deletion
// Automation", shared with the same service account, read-only here.
const INSURANCE_SHEET_ID = process.env.INSURANCE_SHEET_ID || '1CrItGvLoD31VYSiCf4HQDoA7UUdkEdIvKzbd2s7xsuc';
const CACHE_TTL_MS = 2 * 60 * 1000;

function cleanValue(value) {
  return String(value == null ? '' : value).trim();
}

function parseAmount(value) {
  const n = parseFloat(cleanValue(value).replace(/[^0-9.-]/g, ''));
  return isNaN(n) ? 0 : n;
}

function isRowPopulated(row) {
  return Array.isArray(row) && row.some((c) => c && String(c).trim() !== '');
}

// 0-based column indexes within the "Member List" tab's real header row.
const MEMBER_COLS = {
  employeeId: 0,
  name: 1,
  gender: 2,
  dob: 3,
  age: 4,
  ageBand: 5,
  relationship: 6,
  grade: 7,
  sumInsured: 8,
  premiumWithoutGST: 11,
  premiumWithGST: 13,
  status: 14
};

function parseMemberRow(row) {
  return {
    employeeId: cleanValue(row[MEMBER_COLS.employeeId]),
    name: cleanValue(row[MEMBER_COLS.name]),
    gender: cleanValue(row[MEMBER_COLS.gender]),
    dob: cleanValue(row[MEMBER_COLS.dob]),
    age: cleanValue(row[MEMBER_COLS.age]),
    relationship: cleanValue(row[MEMBER_COLS.relationship]),
    grade: cleanValue(row[MEMBER_COLS.grade]),
    sumInsured: cleanValue(row[MEMBER_COLS.sumInsured]),
    premiumWithoutGST: parseAmount(row[MEMBER_COLS.premiumWithoutGST]),
    premiumWithGST: parseAmount(row[MEMBER_COLS.premiumWithGST]),
    status: cleanValue(row[MEMBER_COLS.status])
  };
}

// The "Deletions" tab has a free-text note row above where the real log
// starts ("Deletion automation to be added later...") - it survives a
// plain blank-row filter since it has text in column A, so rows are only
// kept here when Sr No (column A) actually parses as a number.
function parseDeletionRow(row) {
  return {
    srNo: cleanValue(row[0]),
    corporateName: cleanValue(row[1]),
    employeeId: cleanValue(row[3]),
    name: cleanValue(row[4]),
    gender: cleanValue(row[5]),
    relationship: cleanValue(row[6]),
    dateOfLeaving: cleanValue(row[7]),
    reason: cleanValue(row[8])
  };
}

function parseActiveEmployeeRow(row) {
  return {
    employeeId: cleanValue(row[0]),
    name: cleanValue(row[1]),
    doj: cleanValue(row[2]),
    status: cleanValue(row[3]),
    collar: cleanValue(row[4])
  };
}

async function fetchRaw() {
  const sheets = getSheetsClient();
  const [memberRes, additionsRes, deletionsRes, activeEmpRes] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId: INSURANCE_SHEET_ID, range: "'Member List'!A2:O" }),
    sheets.spreadsheets.values.get({ spreadsheetId: INSURANCE_SHEET_ID, range: "'Additions'!A2:M" }),
    sheets.spreadsheets.values.get({ spreadsheetId: INSURANCE_SHEET_ID, range: "'Deletions'!A2:I" }),
    sheets.spreadsheets.values.get({ spreadsheetId: INSURANCE_SHEET_ID, range: "'Active Employees'!A2:E" })
  ]);

  const members = (memberRes.data.values || []).filter(isRowPopulated).map(parseMemberRow);
  const additions = (additionsRes.data.values || []).filter(isRowPopulated);
  const deletions = (deletionsRes.data.values || [])
    .filter(isRowPopulated)
    .filter((r) => cleanValue(r[0]) !== '' && !isNaN(Number(cleanValue(r[0]))))
    .map(parseDeletionRow);
  const activeEmployees = (activeEmpRes.data.values || []).filter(isRowPopulated).map(parseActiveEmployeeRow);

  return { members, additions, deletions, activeEmployees };
}

let cache = { data: null, fetchedAt: 0 };
let inFlight = null;

function refreshCache() {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const data = await fetchRaw();
    cache = { data, fetchedAt: Date.now() };
    return cache;
  })();
  return inFlight.finally(() => {
    inFlight = null;
  });
}

async function getInsuranceData({ forceRefresh = false } = {}) {
  const hasCache = Boolean(cache.data);
  const isStale = !hasCache || Date.now() - cache.fetchedAt >= CACHE_TTL_MS;

  if (!hasCache) return (await refreshCache()).data;
  if (forceRefresh) return (await refreshCache()).data;
  if (isStale) refreshCache().catch(() => {});
  return cache.data;
}

module.exports = { getInsuranceData };
