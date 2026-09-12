// Pure functions over already-fetched insurance data - no Sheets calls here.

// Sheet data has inconsistent casing ("Self" vs "SELF", "Son" vs "SON") -
// bucketed by lowercased relationship. Anything not recognized (a typo, a
// relationship type not seen yet) falls into "other" rather than being
// silently dropped, so the coverage breakdown's total always still adds
// up to the real Active member count.
const RELATIONSHIP_GROUPS = {
  self: 'employees',
  spouse: 'spouse',
  son: 'children',
  daughter: 'children',
  mother: 'parents',
  father: 'parents'
};

function relationshipGroup(relationship) {
  return RELATIONSHIP_GROUPS[String(relationship || '').toLowerCase()] || 'other';
}

function buildHealthInsuranceSummary({ members, additions, deletions, activeEmployees }) {
  const activeMembers = members.filter((m) => m.status === 'Active');
  const isSelf = (m) => String(m.relationship || '').toLowerCase() === 'self';

  const coveredEmployees = activeMembers.filter(isSelf).length;
  const familyMembers = activeMembers.length - coveredEmployees;

  let employeePremium = 0;
  let familyPremium = 0;
  const coverage = { employees: 0, spouse: 0, children: 0, parents: 0, other: 0 };

  activeMembers.forEach((m) => {
    if (isSelf(m)) {
      employeePremium += m.premiumWithGST;
    } else {
      familyPremium += m.premiumWithGST;
    }
    coverage[relationshipGroup(m.relationship)]++;
  });

  const totalActiveEmployees = activeEmployees.filter((e) => e.status === 'Active').length;

  // Annual Premium is the one figure meant to cover the whole Member List
  // regardless of status (Active, Notice Period, or Inactive) - every other
  // card here is Active-only, so this is summed separately rather than from
  // employeePremium + familyPremium.
  const annualPremium = members.reduce((sum, m) => sum + m.premiumWithGST, 0);

  return {
    coveredEmployees,
    totalActiveEmployees,
    familyMembers,
    totalInsuredLives: activeMembers.length,
    employeePremium,
    familyPremium,
    annualPremium,
    newAdditionRequests: additions.length,
    exits: deletions.length,
    coverage
  };
}

// One row per covered employee (their own "Self" row), with their family
// members on the same policy rolled into a count + combined premium.
// Member List has no Department/Designation column - the route layer
// cross-references those from the HR Master sheet by Employee ID, this
// function only groups what's actually in the insurance data itself.
function buildCoveredEmployeesList(members) {
  const activeMembers = members.filter((m) => m.status === 'Active');
  const byEmployee = new Map();
  activeMembers.forEach((m) => {
    if (!byEmployee.has(m.employeeId)) byEmployee.set(m.employeeId, []);
    byEmployee.get(m.employeeId).push(m);
  });

  const result = [];
  byEmployee.forEach((rows, employeeId) => {
    const selfRow = rows.find((r) => String(r.relationship || '').toLowerCase() === 'self');
    if (!selfRow) return; // family rows with no matching Self row - nothing to anchor a covered-employee entry on
    const totalPremium = rows.reduce((sum, r) => sum + r.premiumWithGST, 0);
    result.push({
      employeeId,
      name: selfRow.name,
      grade: selfRow.grade,
      status: selfRow.status,
      familyCount: rows.length - 1,
      totalPremium
    });
  });

  return result.sort((a, b) => a.name.localeCompare(b.name));
}

// One row per Active family member (everything but the Self row), each
// carrying the anchor employee's own name so the row can show whose family
// it belongs to - the Family Members drill-down.
function buildFamilyMembersList(members) {
  const activeMembers = members.filter((m) => m.status === 'Active');
  const selfNameByEmployee = new Map();
  activeMembers.forEach((m) => {
    if (String(m.relationship || '').toLowerCase() === 'self') selfNameByEmployee.set(m.employeeId, m.name);
  });

  return activeMembers
    .filter((m) => String(m.relationship || '').toLowerCase() !== 'self')
    .map((m) => ({
      employeeId: m.employeeId,
      name: m.name,
      relationship: m.relationship,
      relatedEmployeeName: selfNameByEmployee.get(m.employeeId) || '',
      premiumWithGST: m.premiumWithGST
    }))
    .sort((a, b) => a.employeeId.localeCompare(b.employeeId));
}

// Every Active member (Self + family) flat, one row each - the Total
// Insured Lives drill-down.
function buildTotalInsuredLivesList(members) {
  return members
    .filter((m) => m.status === 'Active')
    .map((m) => ({
      employeeId: m.employeeId,
      name: m.name,
      relationship: m.relationship,
      premiumWithGST: m.premiumWithGST
    }))
    .sort((a, b) => a.employeeId.localeCompare(b.employeeId));
}

// Same "Self row anchors the group, family rows roll into a count" shape as
// buildCoveredEmployeesList, but over the Deletions tab instead of Member
// List - no premium here, Deletions doesn't carry one.
function buildExitsList(deletions) {
  const byEmployee = new Map();
  deletions.forEach((d) => {
    if (!byEmployee.has(d.employeeId)) byEmployee.set(d.employeeId, []);
    byEmployee.get(d.employeeId).push(d);
  });

  const result = [];
  byEmployee.forEach((rows, employeeId) => {
    const selfRow = rows.find((r) => String(r.relationship || '').toLowerCase() === 'self');
    if (!selfRow) return; // family-only rows with no matching Self row - nothing to anchor an exit entry on
    result.push({
      employeeId,
      name: selfRow.name,
      dateOfLeaving: selfRow.dateOfLeaving,
      familyCount: rows.length - 1
    });
  });

  return result.sort((a, b) => a.name.localeCompare(b.name));
}

// Same grouping as buildExitsList, but returns the raw rows themselves
// (for the PDF export) instead of a summary - each employee's Self row
// first, immediately followed by their own family rows, one employee
// group after another (ordered the same way the on-screen list is:
// alphabetically by the Self row's name).
function sortDeletionsSelfFirst(deletions) {
  const byEmployee = new Map();
  const order = [];
  deletions.forEach((d) => {
    if (!byEmployee.has(d.employeeId)) {
      byEmployee.set(d.employeeId, []);
      order.push(d.employeeId);
    }
    byEmployee.get(d.employeeId).push(d);
  });

  const groups = order.map((employeeId) => {
    const rows = byEmployee.get(employeeId);
    const selfRow = rows.find((r) => String(r.relationship || '').toLowerCase() === 'self');
    const rest = rows.filter((r) => r !== selfRow);
    return { sortName: selfRow ? selfRow.name : rows[0].name, rows: selfRow ? [selfRow, ...rest] : rest };
  });
  groups.sort((a, b) => a.sortName.localeCompare(b.sortName));

  return groups.flatMap((g) => g.rows);
}

// Fixed policy period (no start/end date exists anywhere in the sheet -
// set directly per the real current policy, update here if it's ever
// renewed on different dates).
const POLICY_START = Date.UTC(2026, 5, 28); // 28 Jun 2026
const POLICY_END = Date.UTC(2027, 5, 27); // 27 Jun 2027
const DAY_MS = 24 * 60 * 60 * 1000;

function policyRenewalInfo(now = new Date()) {
  const nowMs = now.getTime();
  const totalMs = POLICY_END - POLICY_START;
  const elapsedMs = Math.max(0, Math.min(totalMs, nowMs - POLICY_START));
  const daysRemaining = Math.max(0, Math.ceil((POLICY_END - nowMs) / DAY_MS));
  const progressPct = totalMs > 0 ? Math.round((elapsedMs / totalMs) * 1000) / 10 : 0;
  return {
    daysRemaining,
    progressPct,
    startDate: new Date(POLICY_START).toISOString(),
    endDate: new Date(POLICY_END).toISOString()
  };
}

module.exports = {
  buildHealthInsuranceSummary,
  buildCoveredEmployeesList,
  buildFamilyMembersList,
  buildTotalInsuredLivesList,
  buildExitsList,
  sortDeletionsSelfFirst,
  policyRenewalInfo
};
