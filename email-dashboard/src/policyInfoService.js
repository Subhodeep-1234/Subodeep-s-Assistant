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

async function readRows(sheets) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: TRACKER_SHEET_ID, range: `'${TAB}'!A2:B` });
  return res.data.values || [];
}

async function getPolicyInfo() {
  const sheets = getSheetsClient();
  await ensureTab(sheets);
  const rows = await readRows(sheets);
  const byKey = new Map(rows.map((r) => [r[0], r[1] || '']));
  const values = {};
  FIELDS.forEach((f) => { values[f.key] = byKey.get(f.key) || ''; });
  return values;
}

async function savePolicyInfoField(key, value) {
  if (!FIELD_KEYS.has(key)) throw new Error('Unknown field: ' + key);
  const sheets = getSheetsClient();
  await ensureTab(sheets);
  const rows = await readRows(sheets);
  const rowIndex = rows.findIndex((r) => r[0] === key);
  if (rowIndex >= 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: TRACKER_SHEET_ID,
      range: `'${TAB}'!B${rowIndex + 2}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[value]] }
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId: TRACKER_SHEET_ID,
      range: `'${TAB}'!A1`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [[key, value]] }
    });
  }
  return getPolicyInfo();
}

module.exports = { getPolicyInfo, savePolicyInfoField, FIELDS };
