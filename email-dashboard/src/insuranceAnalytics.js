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

  return {
    coveredEmployees,
    totalActiveEmployees,
    familyMembers,
    totalInsuredLives: activeMembers.length,
    employeePremium,
    familyPremium,
    annualPremium: employeePremium + familyPremium,
    newAdditionRequests: additions.length,
    exits: deletions.length,
    coverage
  };
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

module.exports = { buildHealthInsuranceSummary, policyRenewalInfo };
