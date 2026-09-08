const { getSheetsClient } = require('./sheetsAuth');
const employeeService = require('./employeeService');

// Deliberately a separate spreadsheet from HR Master Data - this is the
// only file the app ever writes to, keeping the write-scoped service
// account fully isolated from the real HR source of truth. Real Google
// Sheets/Drive revision history for the HR sheet only goes back ~8 days
// (checked directly against the live file), so there is no way to
// reconstruct a year of past department changes - this log starts
// counting from whenever it's first run and grows from there.
const TRACKER_SHEET_ID = process.env.MOVEMENT_TRACKER_SHEET_ID || '1cvPSC1djocn2mLkccUX9Q2euAU0DwOQBPlssPWeWgWY';
const STATE_TAB = 'Dept_State';
const LOG_TAB = 'Dept_Change_Log';
const STATE_HEADERS = ['Employee ID', 'Name', 'Department', 'Last Checked'];
const LOG_HEADERS = ['Date', 'Employee ID', 'Name', 'From Department', 'To Department'];

async function ensureHeaderRow(sheets, tab, headers) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: TRACKER_SHEET_ID, range: `'${tab}'!A1:Z1` });
  if (res.data.values && res.data.values.length) return;
  await sheets.spreadsheets.values.update({
    spreadsheetId: TRACKER_SHEET_ID,
    range: `'${tab}'!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [headers] }
  });
}

async function ensureTabs(sheets) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: TRACKER_SHEET_ID });
  const existingTitles = meta.data.sheets.map((s) => s.properties.title);
  const requests = [];
  if (!existingTitles.includes(STATE_TAB)) requests.push({ addSheet: { properties: { title: STATE_TAB } } });
  if (!existingTitles.includes(LOG_TAB)) requests.push({ addSheet: { properties: { title: LOG_TAB } } });
  if (requests.length) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: TRACKER_SHEET_ID, requestBody: { requests } });
  }
  await ensureHeaderRow(sheets, STATE_TAB, STATE_HEADERS);
  await ensureHeaderRow(sheets, LOG_TAB, LOG_HEADERS);
}

// Compares today's Employee_Master department per Active employee against
// yesterday's saved snapshot; any mismatch is a real detected transfer,
// logged with today's date. Employees with no prior snapshot (new hires,
// or the very first run ever) are seeded without generating a false
// "transfer" - there's nothing to compare against yet.
async function runDailySnapshot() {
  const sheets = getSheetsClient();
  await ensureTabs(sheets);

  const { employees } = await employeeService.getEmployeeData({ forceRefresh: true });
  const active = employees.filter((e) => e.status === 'ACTIVE' && e.employeeId && e.department);

  const stateRes = await sheets.spreadsheets.values.get({ spreadsheetId: TRACKER_SHEET_ID, range: `'${STATE_TAB}'!A2:D` });
  const priorState = new Map((stateRes.data.values || []).map((r) => [r[0], r[2]]));

  const today = new Date().toISOString().slice(0, 10);
  const changeRows = [];
  active.forEach((e) => {
    const priorDept = priorState.get(e.employeeId);
    if (priorDept && priorDept !== e.department) {
      changeRows.push([today, e.employeeId, e.name, priorDept, e.department]);
    }
  });

  if (changeRows.length) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: TRACKER_SHEET_ID,
      range: `'${LOG_TAB}'!A1`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: changeRows }
    });
  }

  // Overwrite the state tab with today's full snapshot (upsert, keyed by
  // employee - not appended, or every day would duplicate every row).
  await sheets.spreadsheets.values.clear({ spreadsheetId: TRACKER_SHEET_ID, range: `'${STATE_TAB}'!A2:D100000` });
  const newStateRows = active.map((e) => [e.employeeId, e.name, e.department, today]);
  if (newStateRows.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: TRACKER_SHEET_ID,
      range: `'${STATE_TAB}'!A2`,
      valueInputOption: 'RAW',
      requestBody: { values: newStateRows }
    });
  }

  return { checked: active.length, changesDetected: changeRows.length, isFirstRun: priorState.size === 0 };
}

async function getTransfersInLastDays(days = 365) {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: TRACKER_SHEET_ID, range: `'${LOG_TAB}'!A2:E` });
  const rows = res.data.values || [];
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const inWindow = rows.filter((r) => {
    const d = new Date(r[0]);
    return !isNaN(d.getTime()) && d >= cutoff;
  });
  return { total: inWindow.length, items: inWindow.map((r) => ({ date: r[0], employeeId: r[1], name: r[2], fromDept: r[3], toDept: r[4] })) };
}

module.exports = { runDailySnapshot, getTransfersInLastDays, TRACKER_SHEET_ID };
