const { getSheetsClient } = require('./sheetsAuth');

// Stored in the Movement Tracker spreadsheet - the one sheet the service
// account can write to (see movementTracker.js's own note on this); the
// Mediclaim sheet itself is read-only, and none of its tabs have an
// Insurer Name/TPA/Sum Insured field anyway, since this is manually entered
// policy metadata that exists nowhere else in either sheet.
const TRACKER_SHEET_ID = process.env.MOVEMENT_TRACKER_SHEET_ID || '1cvPSC1djocn2mLkccUX9Q2euAU0DwOQBPlssPWeWgWY';
const TAB = 'Policy_Info';

// Deliberately no Policy Number field, per explicit request.
const FIELDS = [
  { key: 'insurerName', label: 'Insurer Name' },
  { key: 'tpaName', label: 'TPA Name' },
  { key: 'policyStartDate', label: 'Policy Start Date' },
  { key: 'policyEndDate', label: 'Policy End Date' },
  { key: 'sumInsured', label: 'Sum Insured' },
  { key: 'totalEmployeesCovered', label: 'Total Employees Covered' },
  { key: 'totalPremium', label: 'Total Premium' }
];
const FIELD_KEYS = new Set(FIELDS.map((f) => f.key));

let ensured = false;
async function ensureTab(sheets) {
  if (ensured) return;
  const meta = await sheets.spreadsheets.get({ spreadsheetId: TRACKER_SHEET_ID });
  const exists = meta.data.sheets.some((s) => s.properties.title === TAB);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: TRACKER_SHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: TAB } } }] }
    });
  }
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: TRACKER_SHEET_ID, range: `'${TAB}'!A1:B1` });
  if (!res.data.values || !res.data.values.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: TRACKER_SHEET_ID,
      range: `'${TAB}'!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [['Field Key', 'Value']] }
    });
  }
  ensured = true;
}

// This had no caching at all until now - every single call (including the
// Dashboard's own background prefetch, fired on every page load) was a live
// Sheets API read, which is exactly the bug already fixed once before in
// movementTracker.js for the same reason (a burst of uncached reads tripping
// the Sheets API's per-minute read quota). Same 2-minute cache + in-flight
// dedup pattern as employeeService/insuranceService/movementTracker.
const CACHE_TTL_MS = 2 * 60 * 1000;
let cache = { rows: null, fetchedAt: 0 };
let inFlight = null;

async function fetchRows() {
  const sheets = getSheetsClient();
  await ensureTab(sheets);
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: TRACKER_SHEET_ID, range: `'${TAB}'!A2:B` });
  return res.data.values || [];
}

function refreshCache() {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const rows = await fetchRows();
    cache = { rows, fetchedAt: Date.now() };
    return cache;
  })();
  return inFlight.finally(() => {
    inFlight = null;
  });
}

async function getCachedRows() {
  const hasCache = Boolean(cache.rows);
  const isStale = !hasCache || Date.now() - cache.fetchedAt >= CACHE_TTL_MS;
  if (!hasCache) return (await refreshCache()).rows;
  if (isStale) refreshCache().catch(() => {});
  return cache.rows;
}

function rowsToValues(rows) {
  const byKey = new Map(rows.map((r) => [r[0], r[1] || '']));
  const values = {};
  FIELDS.forEach((f) => { values[f.key] = byKey.get(f.key) || ''; });
  return values;
}

async function getPolicyInfo() {
  const rows = await getCachedRows();
  return rowsToValues(rows);
}

async function savePolicyInfoField(key, value) {
  if (!FIELD_KEYS.has(key)) throw new Error('Unknown field: ' + key);
  const sheets = getSheetsClient();
  await ensureTab(sheets);
  const rows = await getCachedRows();
  const rowIndex = rows.findIndex((r) => r[0] === key);
  if (rowIndex >= 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: TRACKER_SHEET_ID,
      range: `'${TAB}'!B${rowIndex + 2}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[value]] }
    });
    rows[rowIndex] = [key, value];
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId: TRACKER_SHEET_ID,
      range: `'${TAB}'!A1`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [[key, value]] }
    });
    rows.push([key, value]);
  }
  // Keep the cache in sync with what was just written instead of leaving it
  // stale until the next refresh, or forcing an extra live read right after
  // the write we just made.
  cache = { rows, fetchedAt: Date.now() };
  return rowsToValues(rows);
}

module.exports = { getPolicyInfo, savePolicyInfoField, FIELDS };
