// Pure functions over an already-fetched employee list — no Sheets calls
// here, so these are cheap to call repeatedly against the cached dataset.

function groupCount(employees, keyField, displayNames, filterFn) {
  const counts = new Map();
  for (const emp of employees) {
    if (filterFn && !filterFn(emp)) continue;
    const key = emp[keyField];
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const rows = Array.from(counts.entries()).map(([key, count]) => ({
    name: displayNames.get(key) || key,
    count
  }));
  rows.sort((a, b) => b.count - a.count);
  return rows;
}

function departmentBreakdown(employees, departmentNames, filterFn) {
  return groupCount(employees, 'departmentKey', departmentNames, filterFn);
}

function locationBreakdown(employees, locationNames, filterFn) {
  return groupCount(employees, 'locationKey', locationNames, filterFn);
}

function monthKey(date) {
  return date.getUTCFullYear() + '-' + String(date.getUTCMonth() + 1).padStart(2, '0');
}

function joiningTrend(employees, months = 12) {
  const now = new Date();
  const buckets = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    buckets.push({
      key: monthKey(d),
      label: d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }) + " '" + String(d.getUTCFullYear()).slice(-2),
      count: 0
    });
  }
  const byKey = new Map(buckets.map((b) => [b.key, b]));
  for (const emp of employees) {
    if (!emp.doj) continue;
    const bucket = byKey.get(monthKey(emp.doj));
    if (bucket) bucket.count++;
  }
  return buckets;
}

function isProbation(emp) {
  return emp.employmentType.toLowerCase() === 'probation';
}

function probationCompletionDate(doj) {
  return new Date(Date.UTC(doj.getUTCFullYear(), doj.getUTCMonth() + 6, doj.getUTCDate()));
}

function isCompletingProbationInMonth(emp, year, month) {
  if (!emp.doj || !isProbation(emp) || emp.status === 'INACTIVE') return false;
  const completion = probationCompletionDate(emp.doj);
  return completion.getUTCFullYear() === year && completion.getUTCMonth() === month;
}

function probationCompletingThisMonth(employees, now = new Date()) {
  return employees.filter((e) => isCompletingProbationInMonth(e, now.getUTCFullYear(), now.getUTCMonth()));
}

function turning58ThisMonth(employees, now = new Date()) {
  return employees.filter((e) => {
    if (!e.dob || e.status === 'INACTIVE') return false;
    const age = now.getUTCFullYear() - e.dob.getUTCFullYear();
    return e.dob.getUTCMonth() === now.getUTCMonth() && age === 58;
  });
}

function buildInsights(employees, departmentNames, locationNames) {
  const now = new Date();
  const insights = [];

  const activeByDept = departmentBreakdown(employees, departmentNames, (e) => e.status === 'ACTIVE');
  if (activeByDept.length) {
    insights.push({
      text: activeByDept[0].name + ' has the highest active headcount (' + activeByDept[0].count + ' employees).'
    });
  }

  const activeByLocation = locationBreakdown(employees, locationNames, (e) => e.status === 'ACTIVE');
  if (activeByLocation.length) {
    insights.push({
      text: activeByLocation[0].name + ' has the highest number of active employees (' + activeByLocation[0].count + ').'
    });
  }

  const noticeCount = employees.filter((e) => e.status === 'NOTICE PERIOD').length;
  insights.push({ text: noticeCount + ' employee' + (noticeCount === 1 ? ' is' : 's are') + ' currently serving notice.' });

  const probationDone = probationCompletingThisMonth(employees, now);
  insights.push({
    text: probationDone.length + ' employee' + (probationDone.length === 1 ? ' is' : 's are') +
      ' completing probation (6 months) this month.'
  });

  const turning58 = turning58ThisMonth(employees, now);
  if (turning58.length) {
    insights.push({
      text: turning58.length + ' employee' + (turning58.length === 1 ? '' : 's') + ' will turn 58 this month.'
    });
  }

  const trend = joiningTrend(employees, 12);
  const busiestMonth = trend.reduce((best, m) => (m.count > (best ? best.count : -1) ? m : best), null);
  if (busiestMonth && busiestMonth.count > 0) {
    insights.push({ text: busiestMonth.label + ' had the highest number of joiners (' + busiestMonth.count + ') in the last year.' });
  }

  return insights;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const TENURE_BUCKETS = [
  { key: 'lt6m', label: '< 6 months', maxDays: 182 },
  { key: '6to12m', label: '6-12 months', maxDays: 365 },
  { key: '1to2y', label: '1-2 years', maxDays: 730 },
  { key: '2to5y', label: '2-5 years', maxDays: 1826 },
  { key: '5to10y', label: '5-10 years', maxDays: 3652 },
  { key: '10to15y', label: '10-15 years', maxDays: 5478 },
  { key: 'gt15y', label: '15+ years', maxDays: Infinity }
];

function tenureAnalytics(employees, now = new Date()) {
  // Scoped to Active staff only, matching Employee Data's own default -
  // Notice Period and Inactive employees are excluded (their tenure is
  // about to end or already has, and Inactive's exit date isn't tracked
  // anyway - see the earlier "no exit date" gap).
  const activeEmployees = employees.filter((e) => e.status === 'ACTIVE');
  const eligible = activeEmployees.filter((e) => e.doj);
  const buckets = TENURE_BUCKETS.map((b) => ({ ...b, count: 0 }));
  let totalDays = 0;

  for (const emp of eligible) {
    const days = Math.max(0, Math.round((now.getTime() - emp.doj.getTime()) / DAY_MS));
    totalDays += days;
    const bucket = buckets.find((b) => days <= b.maxDays);
    (bucket || buckets[buckets.length - 1]).count++;
  }

  const averageYears = eligible.length ? totalDays / eligible.length / 365 : null;

  return {
    eligibleCount: eligible.length,
    activeCount: activeEmployees.length,
    missingDojCount: activeEmployees.length - eligible.length,
    averageTenureYears: averageYears === null ? null : Math.round(averageYears * 10) / 10,
    buckets: buckets.map(({ key, label, count }) => ({ key, label, count }))
  };
}

function dataQualityReport(employees) {
  const total = employees.length;
  const missing = {
    department: 0,
    location: 0,
    designation: 0,
    doj: 0,
    dob: 0,
    email: 0
  };
  const idCounts = new Map();

  for (const emp of employees) {
    if (!emp.department) missing.department++;
    if (!emp.location) missing.location++;
    if (!emp.designation) missing.designation++;
    if (!emp.doj) missing.doj++;
    if (!emp.dob) missing.dob++;
    if (!emp.email) missing.email++;
    if (emp.employeeId) idCounts.set(emp.employeeId, (idCounts.get(emp.employeeId) || 0) + 1);
  }

  const duplicateIds = Array.from(idCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([id, count]) => ({ employeeId: id, count }));

  return { total, missing, duplicateIds };
}

module.exports = {
  departmentBreakdown,
  locationBreakdown,
  joiningTrend,
  buildInsights,
  probationCompletingThisMonth,
  turning58ThisMonth,
  tenureAnalytics,
  dataQualityReport,
  isProbation
};
