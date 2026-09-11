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

function doerBreakdown(employees, doerNames, filterFn) {
  return groupCount(employees, 'reportingDoerKey', doerNames, filterFn);
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

// Same DOJ + 6 months math as isCompletingProbationInMonth, but without
// requiring Employment Type to still say "Probation" - used by the Pending
// Confirmations report, which needs the whole month's list (1st to last
// day) regardless of what day it's generated on. Without this, anyone
// whose confirmation date already passed earlier in the month - and who's
// since been manually flipped to "Confirmed" in the sheet - would silently
// drop off the list, making it look like only the still-upcoming ones
// count instead of the full month.
function isPendingConfirmationInMonth(emp, year, month) {
  if (!emp.doj || emp.status === 'INACTIVE') return false;
  const completion = probationCompletionDate(emp.doj);
  return completion.getUTCFullYear() === year && completion.getUTCMonth() === month;
}

function pendingConfirmationsThisMonth(employees, now = new Date()) {
  return employees.filter((e) => isPendingConfirmationInMonth(e, now.getUTCFullYear(), now.getUTCMonth()));
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
      text: activeByLocation[0].name + ' location has the highest number of active employees (' + activeByLocation[0].count + ').'
    });
  }

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

  const birthdays = birthdaysThisMonth(employees, now);
  insights.push({
    text: birthdays.length
      ? birthdays.length + ' employee' + (birthdays.length === 1 ? ' has' : 's have') + ' a birthday this month.'
      : 'No employees have a birthday this month.'
  });

  return insights;
}

// Whole current month (1st to last day), sorted earliest-to-latest in the
// month - Active/Notice Period only, matching turning58ThisMonth's own
// convention (an Inactive/departed employee's birthday isn't relevant here).
function birthdaysThisMonth(employees, now = new Date()) {
  return employees
    .filter((e) => e.dob && e.status !== 'INACTIVE' && e.dob.getUTCMonth() === now.getUTCMonth())
    .sort((a, b) => a.dob.getUTCDate() - b.dob.getUTCDate());
}

const DAY_MS = 24 * 60 * 60 * 1000;
const TENURE_BUCKETS = [
  { key: 'lt6m', label: '< 6 months', minDays: 0, maxDays: 182 },
  { key: '6to12m', label: '6-12 months', minDays: 183, maxDays: 365 },
  { key: '1to2y', label: '1-2 years', minDays: 366, maxDays: 730 },
  { key: '2to5y', label: '2-5 years', minDays: 731, maxDays: 1826 },
  { key: '5to10y', label: '5-10 years', minDays: 1827, maxDays: 3652 },
  { key: '10to15y', label: '10-15 years', minDays: 3653, maxDays: 5478 },
  { key: 'gt15y', label: '15+ years', minDays: 5479, maxDays: Infinity }
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
    buckets: buckets.map(({ key, label, count, minDays, maxDays }) => ({
      key,
      label,
      count,
      minDays,
      maxDays: maxDays === Infinity ? null : maxDays
    }))
  };
}

// The 58 cutoff isn't arbitrary - it's this company's retirement age
// (see turning58ThisMonth in the insights below), so it's kept as its own
// boundary rather than folded into a generic "55+" bucket.
const AGE_BUCKETS = [
  { key: 'lt18', label: '< 18 years', minAge: 0, maxAge: 17 },
  { key: '18to25', label: '18 - 25 years', minAge: 18, maxAge: 25 },
  { key: '26to30', label: '26 - 30 years', minAge: 26, maxAge: 30 },
  { key: '31to35', label: '31 - 35 years', minAge: 31, maxAge: 35 },
  { key: '36to40', label: '36 - 40 years', minAge: 36, maxAge: 40 },
  { key: '41to50', label: '41 - 50 years', minAge: 41, maxAge: 50 },
  { key: '51to57', label: '51 - 57 years', minAge: 51, maxAge: 57 },
  { key: 'gt58', label: '>=58 years', minAge: 58, maxAge: Infinity }
];

function calcAge(dob, now) {
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const hadBirthdayThisYear =
    now.getUTCMonth() > dob.getUTCMonth() ||
    (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() >= dob.getUTCDate());
  if (!hadBirthdayThisYear) age--;
  return age;
}

function ageAnalytics(employees, now = new Date()) {
  // Scoped to Active staff only, matching Tenure/Data Quality's convention.
  const activeEmployees = employees.filter((e) => e.status === 'ACTIVE');
  const eligible = activeEmployees.filter((e) => e.dob);
  const buckets = AGE_BUCKETS.map((b) => ({ ...b, count: 0 }));
  let totalAge = 0;

  for (const emp of eligible) {
    const age = calcAge(emp.dob, now);
    totalAge += age;
    const bucket = buckets.find((b) => age <= b.maxAge);
    (bucket || buckets[buckets.length - 1]).count++;
  }

  const averageAge = eligible.length ? totalAge / eligible.length : null;

  return {
    eligibleCount: eligible.length,
    activeCount: activeEmployees.length,
    missingDobCount: activeEmployees.length - eligible.length,
    averageAge: averageAge === null ? null : Math.round(averageAge * 10) / 10,
    buckets: buckets.map(({ key, label, count, minAge, maxAge }) => ({
      key, label, count, minAge, maxAge: maxAge === Infinity ? null : maxAge
    }))
  };
}

function genderAnalytics(employees) {
  // Scoped to Active staff only, matching Tenure/Age's convention.
  const activeEmployees = employees.filter((e) => e.status === 'ACTIVE');
  const eligible = activeEmployees.filter((e) => e.gender);
  const counts = new Map();
  for (const emp of eligible) {
    counts.set(emp.gender, (counts.get(emp.gender) || 0) + 1);
  }
  const buckets = Array.from(counts.entries())
    .map(([key, count]) => ({ key: key.toLowerCase(), label: key, count }))
    .sort((a, b) => b.count - a.count);

  return {
    eligibleCount: eligible.length,
    activeCount: activeEmployees.length,
    missingGenderCount: activeEmployees.length - eligible.length,
    buckets
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

// ---------- Organization Chart ----------

// "0" in the sheet's Group - D column means White collar (mirrors
// workforceRoutes.js's own formatCollar - kept as a small local copy here
// rather than importing across files for one line).
function formatCollarForChart(value) {
  return value === '0' ? 'White' : value;
}

// A market-standard corporate seniority ladder for grouping designation
// cards top-to-bottom within a collar section. The Manager family in
// particular needs its own finer tiers, not one lumped-together "Manager"
// bucket - lumping General/Senior/Deputy/Assistant Manager together was a
// real bug found in Accounts, where "Assistant General Manager", "Senior
// Manager" and "Assistant Manager" all tied at the same rank and fell back
// to alphabetical order (wrongly putting Assistant Manager above Senior
// Manager). Most-specific patterns are checked first so a title like
// "Assistant General Manager" matches its own AGM tier rather than the
// generic "General Manager" or "Assistant Manager" catch-alls it also
// contains as substrings. Unrecognized designations land at
// ORG_DESIGNATION_DEFAULT_RANK and fall back to alphabetical order.
const ORG_DESIGNATION_TIERS = [
  // Leadership
  { rank: 5, test: /\b(CHAIRMAN|MANAGING DIRECTOR|EXECUTIVE DIRECTOR|COMPANY SECRETARY|DIRECTOR)\b/ },
  { rank: 15, test: /VICE\s*PRESIDENT|\bVP\b/ },
  // General Manager family - spelled-out "Deputy/Assistant General
  // Manager" and the DGM/AGM abbreviations, checked before the generic
  // "General Manager" catch-all (which they'd otherwise also match).
  { rank: 40, test: /DEPUTY GENERAL MANAGER|\bDGM\b/ },
  { rank: 50, test: /ASST\.?\s*GENERAL MANAGER|ASSISTANT GENERAL MANAGER|\bAGM\b/ },
  { rank: 30, test: /\b(GENERAL MANAGER|\bGM\b|PLANT MANAGER|FINANCE CONTROLLER)\b/ },
  // Manager family - Senior/Deputy/Assistant before the generic Manager
  // catch-all, for the same reason.
  { rank: 60, test: /\b(SR\.?|SENIOR)\s*MANAGER\b/ },
  { rank: 80, test: /\bDEPUTY MANAGER\b/ },
  { rank: 90, test: /\b(ASSISTANT MANAGER|ASST\.?\s*MAN[AG]ER)\b/ },
  { rank: 70, test: /\bMANAGER\b/ },
  { rank: 18, test: /\b(HOD|HEAD)\b/ },
  // Engineer/Executive/Officer family
  { rank: 100, test: /\b(SR\.?|SENIOR)\s*(ENGINEER|EXECUTIVE|OFFICER)\b/ },
  { rank: 110, test: /\b(JR\.?|JUNIOR)\b/ },
  { rank: 120, test: /\b(ENGINEER|EXECUTIVE|OFFICER)\b/ },
  { rank: 135, test: /\b(SR\.?|SENIOR)\s*(DATA ENTRY OPERATOR|DEO)\b/ },
  { rank: 140, test: /\b(DATA ENTRY OPERATOR|DEO)\b/ },
  // Supervisory/trade ladder - Sr.<trade> (any trade prefixed Sr./Senior,
  // not just Supervisor) outranks a plain/unmatched trade title, which in
  // turn outranks Asst.<trade>, Operator, Technician and finally Helper.
  { rank: 150, test: /\b(SR\.?|SENIOR)\s*(SUPERVISOR|FOREMAN)\b/ },
  { rank: 160, test: /\b(SUPERVISOR|FOREMAN)\b/ },
  { rank: 180, test: /\b(SR\.?|SENIOR)\b/ }, // any other "Sr. <trade>" not already caught above
  // (plain/unmatched trades fall through to ORG_DESIGNATION_DEFAULT_RANK
  // here, between the Sr.<trade> catch-all above and Asst.<trade> below)
  { rank: 210, test: /\b(ASST\.?|ASSISTANT)\b/ },
  { rank: 215, test: /\bOPERATOR\b/ },
  { rank: 220, test: /\bTECHNICIAN\b/ },
  { rank: 230, test: /\b(HELPER|LABOUR|LABOURER|SWEEPER|HOUSE\s*KEEP|OFFICE BOY|COOK|STEWARD|GARDENER|SECURITY GUARD|CARE\s*TAKER)\b/ }
];
const ORG_DESIGNATION_DEFAULT_RANK = 190;

function orgDesignationRank(designation) {
  const upper = String(designation || '').toUpperCase();
  const tier = ORG_DESIGNATION_TIERS.find((t) => t.test.test(upper));
  return tier ? tier.rank : ORG_DESIGNATION_DEFAULT_RANK;
}

function groupByDesignation(list) {
  const byDesig = new Map();
  list.forEach((e) => {
    const key = e.designation || 'Unspecified';
    if (!byDesig.has(key)) byDesig.set(key, []);
    byDesig.get(key).push({ name: e.name, employeeId: e.employeeId });
  });
  return Array.from(byDesig.entries())
    .map(([designation, emps]) => ({
      designation,
      count: emps.length,
      employees: emps.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    }))
    .sort((a, b) => {
      const rankDiff = orgDesignationRank(a.designation) - orgDesignationRank(b.designation);
      if (rankDiff !== 0) return rankDiff;
      return a.designation.localeCompare(b.designation);
    });
}

// Finds whichever value of employeeField (e.g. "reportingManager" for HOD,
// "reportingDoer" for the Director-level DOER) is most common among a
// department's own employees, then looks that person up by name across
// the WHOLE company (not just this department) for their real Employee ID
// and Designation - they're usually their own employee record elsewhere,
// not counted inside the department they oversee.
function findMostCommonPerson(deptEmployees, allEmployees, employeeField) {
  const counts = {};
  deptEmployees.forEach((e) => {
    if (e[employeeField]) counts[e[employeeField]] = (counts[e[employeeField]] || 0) + 1;
  });
  let name = null;
  let bestCount = 0;
  Object.entries(counts).forEach(([n, count]) => {
    if (count > bestCount) { name = n; bestCount = count; }
  });
  if (!name) return null;
  const key = name.trim().toLowerCase();
  const match = allEmployees.find((e) => e.name && e.name.trim().toLowerCase() === key);
  // If the identified person's own record has gone Inactive, the box stays
  // exactly as it is (same design, still rendered) but with a blank name/
  // designation instead of a departed person's stale info - an empty (not
  // null) name here keeps it out of the "Not identified" fallback, which
  // is reserved for when no one could be identified at all. Once the
  // department's staff get retagged to a new (active) HOD/DOER in the
  // sheet, that new name naturally takes over here.
  if (match && match.status === 'INACTIVE') return { name: '', employeeId: null, designation: null };
  return { name, employeeId: match ? match.employeeId : null, designation: match ? match.designation : null };
}

// Active and Notice Period stay on the Org Chart - only Inactive staff
// drop off, per explicit request (unlike every other department breakdown
// in the app, which is Active-only). A designation's card disappears on
// its own once no one in it qualifies any more (groupByDesignation only
// creates a card for designations with at least one person), and
// reappears the moment someone with that designation does - no extra
// logic needed for that, it falls out of filtering from the current list
// every time this runs.
function buildOrgChart(employees, departmentNames, targetDepartmentKey) {
  const deptEmployees = employees.filter((e) => e.status !== 'INACTIVE' && e.departmentKey === targetDepartmentKey);
  const departmentName =
    departmentNames.get(targetDepartmentKey) || (deptEmployees[0] && deptEmployees[0].department) || '';

  // HOD = whichever Reporting Manager (HOD-1) name is most common among
  // this department's own employees. Doer = same technique against
  // Reporting DOER - shown as the Director-level box above the HOD, since
  // that's the same real oversight hierarchy Doer Management already uses.
  const hod = findMostCommonPerson(deptEmployees, employees, 'reportingManager');
  const doer = findMostCommonPerson(deptEmployees, employees, 'reportingDoer');

  // Both already get their own boxes up top - if either is also counted
  // among this department's own employees, drop them from the card lists
  // below so their name/designation isn't shown a second time. totalEmployees
  // still counts them - they ARE part of the department's real headcount.
  const excludeIds = new Set([hod && hod.employeeId, doer && doer.employeeId].filter(Boolean));
  const cardEmployees = excludeIds.size ? deptEmployees.filter((e) => !excludeIds.has(e.employeeId)) : deptEmployees;
  const whiteCollar = cardEmployees.filter((e) => formatCollarForChart(e.groupD) === 'White');
  const blueGroupD = cardEmployees.filter((e) => formatCollarForChart(e.groupD) !== 'White');

  return {
    department: departmentName,
    totalEmployees: deptEmployees.length,
    doer,
    hod,
    whiteCollarGroups: groupByDesignation(whiteCollar),
    blueGroupDGroups: groupByDesignation(blueGroupD)
  };
}

module.exports = {
  departmentBreakdown,
  locationBreakdown,
  doerBreakdown,
  joiningTrend,
  buildInsights,
  probationCompletingThisMonth,
  pendingConfirmationsThisMonth,
  probationCompletionDate,
  turning58ThisMonth,
  birthdaysThisMonth,
  tenureAnalytics,
  ageAnalytics,
  genderAnalytics,
  dataQualityReport,
  isProbation,
  calcAge,
  buildOrgChart
};
