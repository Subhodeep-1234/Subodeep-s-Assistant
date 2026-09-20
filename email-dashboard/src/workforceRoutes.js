const express = require('express');
const employeeService = require('./employeeService');
const analytics = require('./workforceAnalytics');
const movementTracker = require('./movementTracker');
const { buildIncrementLetterPdf, buildPromotionIncrementLetterPdf } = require('./letterPdf');
const insuranceService = require('./insuranceService');
const gmailService = require('./gmailService');
const { buildTablePdfBuffer } = require('./pdfReport');

const router = express.Router();
const EMPLOYEE_LIST_CAP = 1000;

function configErrorMessage(missing) {
  return 'Missing configuration: ' + missing.join(', ') + '.';
}

function wantsForceRefresh(req) {
  return req.query.refresh === '1' || req.query.refresh === 'true';
}

// "0" in the sheet's Group - D column means White collar - the other two
// values already read as real labels ("Group-D", "Blue").
function formatCollar(value) {
  return value === '0' ? 'White' : value;
}

// Exact server-side copy of the on-screen "Export PDF" report's own sort/
// grouping (public/workforce.js: DESIGNATION_RANK_TIERS/designationRank/
// COLLAR_RANK/collarRank/formatAgeYearsMonths), used by the Doer Management
// "Send Mail" PDF attachment below to match that report's design exactly -
// deliberately a separate copy from workforceAnalytics.js's own
// ORG_DESIGNATION_TIERS, which uses different rank numbers for the org
// chart's own (different) card ordering.
const EMPLOYEE_REPORT_DESIGNATION_TIERS = [
  { rank: 10, test: /\b(DIRECTOR|CHAIRMAN|COMPANY SECRETARY|MANAGING DIRECTOR)\b/ },
  { rank: 20, test: /\bVICE PRESIDENT\b/ },
  { rank: 30, test: /\b(GENERAL MANAGER|\bGM\b|PLANT MANAGER|FINANCE CONTROLLER)\b/ },
  { rank: 40, test: /\bDGM\b/ },
  { rank: 50, test: /\bAGM\b/ },
  { rank: 60, test: /\b(SR\.?|SENIOR)\s*MANAGER\b/ },
  { rank: 80, test: /\bDEPUTY MANAGER\b/ },
  { rank: 90, test: /\b(ASSISTANT MANAGER|ASST\.?\s*MAN[AG]ER)\b/ },
  { rank: 70, test: /\bMANAGER\b/ },
  { rank: 100, test: /\b(SR\.?|SENIOR)\s*ENGINEER\b/ },
  { rank: 100, test: /\b(SR\.?|SENIOR)\s*EXECUTIVE\b/ },
  { rank: 130, test: /\bJR\.?\s*EXECUTIVE\b|\bJUNIOR EXECUTIVE\b/ },
  { rank: 120, test: /\bENGINEER\b/ },
  { rank: 120, test: /\bEXECUTIVE\b/ },
  { rank: 130, test: /\bDTE\b/ },
  { rank: 135, test: /\b(SR\.?|SENIOR)\s*(DATA ENTRY OPERATOR|DEO)\b/ },
  { rank: 140, test: /\b(DATA ENTRY OPERATOR|DEO)\b/ },
  { rank: 150, test: /\b(SR\.?|SENIOR)\s*(SUPERVISOR|FOREMAN)\b/ },
  { rank: 160, test: /\b(SUPERVISOR|FOREMAN)\b/ },
  { rank: 180, test: /\b(SR\.?|SENIOR)\b/ },
  { rank: 210, test: /\b(ASST\.?|ASSISTANT)\b/ },
  { rank: 215, test: /\bOPERATOR\b/ },
  { rank: 220, test: /\b(HELPER|LABOUR|LABOURER|SWEEPER|HOUSE\s*KEEP|HOUSE STAFF|OFFICE BOY|COOK|STEWARD|GARDENER|SECURITY GUARD|CARE\s*TAKER|PANDIT|DOG TRAINER)\b/ }
];
const EMPLOYEE_REPORT_DESIGNATION_DEFAULT_RANK = 200;

function employeeReportDesignationRank(designation) {
  const upper = String(designation || '').toUpperCase();
  const tier = EMPLOYEE_REPORT_DESIGNATION_TIERS.find((t) => t.test.test(upper));
  return tier ? tier.rank : EMPLOYEE_REPORT_DESIGNATION_DEFAULT_RANK;
}

const EMPLOYEE_REPORT_COLLAR_RANK = { White: 0, Blue: 1, 'Group-D': 2 };
function employeeReportCollarRank(collar) {
  return collar in EMPLOYEE_REPORT_COLLAR_RANK ? EMPLOYEE_REPORT_COLLAR_RANK[collar] : 99;
}

function formatAgeYearsMonths(dob) {
  if (!dob) return '—';
  const now = new Date();
  let years = now.getUTCFullYear() - dob.getUTCFullYear();
  let months = now.getUTCMonth() - dob.getUTCMonth();
  if (now.getUTCDate() < dob.getUTCDate()) months--;
  if (months < 0) { years--; months += 12; }
  return years + 'Y ' + months + 'M';
}

// DOB with the current year substituted in - exact server-side copy of the
// client's own formatDobCurrentYear (public/workforce.js), used by the
// Birthday Send Mail PDF for the same reason: a birthday list is for this
// year's upcoming date, not the real birth year.
function formatDobCurrentYear(dob, now) {
  if (!dob) return '—';
  const thisYear = new Date(Date.UTC(now.getUTCFullYear(), dob.getUTCMonth(), dob.getUTCDate()));
  return thisYear.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

router.use((req, res, next) => {
  const status = employeeService.getConfigStatus();
  if (!status.ok) {
    return res.status(500).json({ error: configErrorMessage(status.missing) });
  }
  next();
});

router.get('/status', async (req, res) => {
  try {
    const { employees, fetchedAt } = await employeeService.getEmployeeData({
      forceRefresh: wantsForceRefresh(req)
    });
    res.json({
      ok: true,
      totalRecords: employees.length,
      lastFetched: new Date(fetchedAt).toISOString(),
      cacheTtlSeconds: employeeService.CACHE_TTL_MS / 1000
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/overview', async (req, res) => {
  try {
    const { employees } = await employeeService.getEmployeeData({
      forceRefresh: wantsForceRefresh(req)
    });
    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const currentMonth = now.getUTCMonth();

    const total = employees.length;
    const active = employees.filter((e) => e.status === 'ACTIVE').length;
    const noticePeriod = employees.filter((e) => e.status === 'NOTICE PERIOD').length;
    const inactive = employees.filter((e) => e.status === 'INACTIVE').length;
    const probation = employees.filter((e) => e.employmentType.toLowerCase() === 'probation').length;
    const confirmed = employees.filter((e) => e.employmentType.toLowerCase() === 'confirmed').length;
    const activeProbation = employees.filter((e) => e.status === 'ACTIVE' && e.employmentType.toLowerCase() === 'probation').length;
    const activeConfirmed = employees.filter((e) => e.status === 'ACTIVE' && e.employmentType.toLowerCase() === 'confirmed').length;
    const joinedThisMonth = employees.filter(
      (e) => e.doj && e.doj.getUTCFullYear() === currentYear && e.doj.getUTCMonth() === currentMonth
    ).length;

    res.json({
      total,
      active,
      noticePeriod,
      inactive,
      probation,
      confirmed,
      activeProbation,
      activeConfirmed,
      joinedThisMonth
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/filters', async (req, res) => {
  try {
    const { employees, departmentNames, locationNames, reportingManagerNames } = await employeeService.getEmployeeData();
    const collars = Array.from(new Set(employees.map((e) => formatCollar(e.groupD)).filter(Boolean)));
    res.json({
      departments: Array.from(departmentNames.values()).sort((a, b) => a.localeCompare(b)),
      locations: Array.from(locationNames.values()).sort((a, b) => a.localeCompare(b)),
      reportingManagers: Array.from(reportingManagerNames.values()).sort((a, b) => a.localeCompare(b)),
      collars: collars.sort((a, b) => a.localeCompare(b))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Company Name dropdown on Generate Letter's forms - the MASTER tab's own
// company list (column Q), not Employee_Master's per-employee Company
// column, since the user wants the sheet's maintained master list here.
router.get('/companies', async (req, res) => {
  try {
    const companies = await employeeService.getCompanyList();
    res.json({ companies });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function matchesFilters(emp, query, normalizeKey) {
  if (query.status && emp.status !== String(query.status).toUpperCase()) return false;
  // "Anyone but Inactive" - distinct from an exact status match above, for
  // filters (some Insights points) that mean to include Notice Period
  // alongside Active rather than pin down to exactly one status.
  if (query.statusNot && emp.status === String(query.statusNot).toUpperCase()) return false;
  if (query.department && emp.departmentKey !== normalizeKey(query.department)) return false;
  if (query.location && emp.locationKey !== normalizeKey(query.location)) return false;
  if (query.reportingManager && emp.reportingManagerKey !== normalizeKey(query.reportingManager)) return false;
  if (query.collar && formatCollar(emp.groupD).toLowerCase() !== String(query.collar).toLowerCase()) return false;
  if (query.gender && (emp.gender || '').toLowerCase() !== String(query.gender).toLowerCase()) return false;
  if (query.reportingDoer && emp.reportingDoerKey !== normalizeKey(query.reportingDoer)) return false;
  if (query.employmentType && emp.employmentType.toLowerCase() !== String(query.employmentType).toLowerCase()) {
    return false;
  }
  if (query.dateFrom) {
    const from = new Date(query.dateFrom);
    if (!emp.doj || isNaN(from.getTime()) || emp.doj < from) return false;
  }
  if (query.dateTo) {
    const to = new Date(query.dateTo);
    if (!emp.doj || isNaN(to.getTime()) || emp.doj > to) return false;
  }
  if (query.q) {
    const needle = String(query.q).toLowerCase();
    const haystack = [emp.employeeId, emp.name, emp.email, emp.department, emp.designation, emp.location]
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  if (query.ageMin || query.ageMax) {
    if (!emp.dob) return false;
    const age = analytics.calcAge(emp.dob, new Date());
    if (query.ageMin && age < Number(query.ageMin)) return false;
    if (query.ageMax && age > Number(query.ageMax)) return false;
  }
  // dobMonth (1-12) / dobYear - birth-month and exact-birth-year matches on
  // DOB, for Insights' birthday/retirement-this-month points (calcAge's
  // ageMin/ageMax above is birthday-aware "current age", not a fixed match
  // on the birth year itself, so it can't express "turning 58 this month").
  if (query.dobMonth) {
    if (!emp.dob || emp.dob.getUTCMonth() !== Number(query.dobMonth) - 1) return false;
  }
  if (query.dobYear) {
    if (!emp.dob || emp.dob.getUTCFullYear() !== Number(query.dobYear)) return false;
  }
  if (query.missingContact === '1' && emp.contactNumber) return false;
  return true;
}

router.get('/employees', async (req, res) => {
  try {
    const { employees, departmentNames, locationNames, reportingManagerNames } = await employeeService.getEmployeeData({
      forceRefresh: wantsForceRefresh(req)
    });
    const filtered = employees.filter((e) => matchesFilters(e, req.query, employeeService.normalizeKey));
    const items = filtered.slice(0, EMPLOYEE_LIST_CAP).map((e) => ({
      employeeId: e.employeeId,
      name: e.name,
      department: departmentNames.get(e.departmentKey) || e.department,
      designation: e.designation,
      groupD: formatCollar(e.groupD),
      gender: e.gender,
      location: locationNames.get(e.locationKey) || e.location,
      reportingDoer: e.reportingDoer,
      reportingManager: reportingManagerNames.get(e.reportingManagerKey) || e.reportingManager,
      doj: e.doj ? e.doj.toISOString() : null,
      tenure: e.tenure,
      totalExperience: e.totalExperience,
      dob: e.dob ? e.dob.toISOString() : null,
      uan: e.uan,
      esiNumber: e.esiNumber,
      email: e.email,
      emailPersonal: e.emailPersonal,
      aadhar: e.aadhar,
      pan: e.pan,
      contactNumber: e.contactNumber,
      permanentAddress: e.permanentAddress,
      presentAddress: e.presentAddress,
      employmentType: e.employmentType,
      status: e.status
    }));
    res.json({
      total: filtered.length,
      truncated: filtered.length > items.length,
      items
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/breakdowns', async (req, res) => {
  try {
    const { employees, departmentNames, locationNames, doerNames } = await employeeService.getEmployeeData();
    const statusFilter = req.query.status
      ? (e) => e.status === String(req.query.status).toUpperCase()
      : null;
    res.json({
      departments: analytics.departmentBreakdown(employees, departmentNames, statusFilter),
      locations: analytics.locationBreakdown(employees, locationNames, statusFilter),
      doers: analytics.doerBreakdown(employees, doerNames, statusFilter)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/org-chart', async (req, res) => {
  try {
    if (!req.query.department) {
      return res.status(400).json({ error: 'department is required' });
    }
    const { employees, departmentNames } = await employeeService.getEmployeeData({
      forceRefresh: wantsForceRefresh(req)
    });
    const targetKey = employeeService.normalizeKey(req.query.department);
    // Optional: narrow the chart to one specific HOD's own tagged staff,
    // for departments with more than one real HOD (see buildOrgChart's own
    // hodOptions) - omitted or not one of that department's actual HODs,
    // falls back to the default whole-department view.
    const hodKey = req.query.hod ? employeeService.normalizeKey(req.query.hod) : null;
    res.json(analytics.buildOrgChart(employees, departmentNames, targetKey, hodKey));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PDF-only, deeper hierarchy (Managing Director -> Director(s) ->
// HOD(s) -> designation cards) for departments that actually have more
// than one Director/HOD - see buildOrgChartPdfTree. The on-screen view
// keeps using plain /org-chart above, unaffected.
router.get('/org-chart-pdf', async (req, res) => {
  try {
    if (!req.query.department) {
      return res.status(400).json({ error: 'department is required' });
    }
    const { employees, departmentNames } = await employeeService.getEmployeeData({
      forceRefresh: wantsForceRefresh(req)
    });
    const targetKey = employeeService.normalizeKey(req.query.department);
    res.json(analytics.buildOrgChartPdfTree(employees, departmentNames, targetKey));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Doer Management's "Send Mail" button - emails that Reporting DOER's own
// active team list as a PDF to their EA, using the same PDF-attachment
// pattern as the Mediclaim Exits/Additions "Send Mail" buttons
// (src/insuranceRoutes.js). Recipients come from the same "Mediclaim
// Addition & Deletion Automation" spreadsheet's "Mail Id" tab, but a
// separate per-doer block of columns (F/G) from the flat insurance
// recipients (A/B) - see insuranceService.getAllDoerMailRecipients.
// Live default To/Cc for the doer/send-mail compose popup below to
// pre-fill (public/workforce.js's openMailCompose) - same lookup the send
// route itself falls back to when no override is given.
router.get('/doer/mail-defaults', async (req, res) => {
  try {
    const reportingDoer = String(req.query.reportingDoer || '').trim();
    if (!reportingDoer) {
      return res.status(400).json({ error: 'reportingDoer is required' });
    }
    const recipientsMap = await insuranceService.getAllDoerMailRecipients();
    const recipients = recipientsMap.get(reportingDoer.toLowerCase());
    if (!recipients || !recipients.to) {
      return res.status(400).json({ error: 'No mail recipients configured for "' + reportingDoer + '" in the Mail Id sheet.' });
    }
    res.json(recipients);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/doer/send-mail', async (req, res) => {
  try {
    const reportingDoer = String((req.body && req.body.reportingDoer) || '').trim();
    if (!reportingDoer) {
      return res.status(400).json({ error: 'reportingDoer is required' });
    }
    // The Send Mail compose popup always sends whatever's currently in its
    // To/Cc fields (defaulted from, but editable past, the Mail Id sheet) -
    // only falls back to looking those up itself when called without an
    // override, e.g. a future direct API caller.
    const overrideTo = req.body && typeof req.body.to === 'string' ? req.body.to.trim() : '';

    const { employees, departmentNames } = await employeeService.getEmployeeData({ forceRefresh: true });

    const doerKey = employeeService.normalizeKey(reportingDoer);
    const teamEmployees = employees.filter((e) => e.status === 'ACTIVE' && e.reportingDoerKey === doerKey);
    if (!teamEmployees.length) {
      return res.status(400).json({ error: 'No active employees found for Reporting DOER "' + reportingDoer + '".' });
    }

    let recipients;
    if (overrideTo) {
      recipients = { to: overrideTo, cc: req.body && typeof req.body.cc === 'string' ? req.body.cc.trim() : '' };
    } else {
      const recipientsMap = await insuranceService.getAllDoerMailRecipients();
      recipients = recipientsMap.get(reportingDoer.toLowerCase());
      if (!recipients || !recipients.to) {
        return res.status(400).json({ error: 'No mail recipients configured for "' + reportingDoer + '" in the Mail Id sheet.' });
      }
    }

    // Same sort as the on-screen "Export PDF" report: Collar, then
    // Department, then designation seniority tier, then Designation text,
    // then Name - see EMPLOYEE_REPORT_DESIGNATION_TIERS/collarRank above.
    const sorted = teamEmployees.slice().sort((a, b) => {
      const collarA = employeeReportCollarRank(formatCollar(a.groupD));
      const collarB = employeeReportCollarRank(formatCollar(b.groupD));
      if (collarA !== collarB) return collarA - collarB;
      const deptA = departmentNames.get(a.departmentKey) || a.department || '';
      const deptB = departmentNames.get(b.departmentKey) || b.department || '';
      const deptDiff = deptA.localeCompare(deptB);
      if (deptDiff !== 0) return deptDiff;
      const rankDiff = employeeReportDesignationRank(a.designation) - employeeReportDesignationRank(b.designation);
      if (rankDiff !== 0) return rankDiff;
      const desigDiff = (a.designation || '').localeCompare(b.designation || '');
      if (desigDiff !== 0) return desigDiff;
      return (a.name || '').localeCompare(b.name || '');
    });

    // Same shape as the on-screen report: a full-width Collar heading bar
    // (print-section-row) each time the collar changes, exactly like
    // exportEmployeesPdf's own lastGroupHeading tracking.
    const now = new Date();
    const rows = [];
    let lastCollarHeading = null;
    sorted.forEach((e) => {
      const collarHeading = formatCollar(e.groupD) || 'Unspecified Collar';
      if (collarHeading !== lastCollarHeading) {
        rows.push({ section: collarHeading });
        lastCollarHeading = collarHeading;
      }
      rows.push([
        e.employeeId,
        e.name,
        e.designation || '—',
        departmentNames.get(e.departmentKey) || e.department || '—',
        formatCollar(e.groupD) || '—',
        formatAgeYearsMonths(e.dob),
        e.gender || '—',
        e.location || '—',
        e.doj ? e.doj.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
      ]);
    });

    const pdfBuffer = await buildTablePdfBuffer({
      title: 'Employee Data Report',
      subtitle:
        'Reporting DOER: ' + reportingDoer + ' · ' +
        sorted.length + ' employee' + (sorted.length === 1 ? '' : 's') + ' · Generated ' +
        now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
      columns: ['Employee Code', 'Name', 'Designation', 'Department', 'Collar', 'Age', 'Gender', 'Location', 'DOJ'],
      rows,
      // exportEmployeesPdf ("Export PDF") prints portrait - only the
      // separate Pending Confirmations report forces landscape.
      landscape: false
    });

    await gmailService.sendMailWithAttachment({
      to: recipients.to,
      cc: recipients.cc,
      subject: 'Updated Doer List – ' + reportingDoer,
      text:
        'Hi,\n\n' +
        'Please find the attached Doer list currently working under ' + reportingDoer + ', shared for your reference and records.',
      attachment: {
        filename: 'Doer_List_' + reportingDoer.replace(/\s+/g, '_') + '_' + now.toISOString().slice(0, 10) + '.pdf',
        content: pdfBuffer,
        contentType: 'application/pdf'
      }
    });

    res.json({ ok: true, sentTo: recipients.to, cc: recipients.cc, employeeCount: sorted.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Live default To/Cc for the birthdays/send-mail compose popup below to
// pre-fill (public/workforce.js's openMailCompose).
router.get('/birthdays/mail-defaults', async (req, res) => {
  try {
    const recipients = await insuranceService.getBirthdayMailRecipients();
    if (!recipients || !recipients.to) {
      return res.status(400).json({ error: 'No mail recipients configured for the Birthday List in the Mail Id sheet.' });
    }
    res.json(recipients);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// All Insights' Birthday point "Send Mail" button - emails this month's
// birthday list to the Graphics team as the same PDF Export PDF produces
// for that point (Employee Code, Name, Designation, Department, Collar,
// Location, Date - see exportEmployeesPdf's isBirthdayReport branch,
// public/workforce.js). No body needed beyond an optional To/Cc override -
// the send always means "this month", matching the insight's own scope,
// same as pendingConfirmationsThisMonth needing no input either.
router.post('/birthdays/send-mail', async (req, res) => {
  try {
    const overrideTo = req.body && typeof req.body.to === 'string' ? req.body.to.trim() : '';

    const { employees, departmentNames } = await employeeService.getEmployeeData({ forceRefresh: true });

    const now = new Date();
    const birthdayEmployees = employees.filter(
      (e) => e.status !== 'INACTIVE' && e.dob && e.dob.getUTCMonth() === now.getUTCMonth()
    );
    if (!birthdayEmployees.length) {
      return res.status(400).json({ error: 'No employees have a birthday this month.' });
    }

    let recipients;
    if (overrideTo) {
      recipients = { to: overrideTo, cc: req.body && typeof req.body.cc === 'string' ? req.body.cc.trim() : '' };
    } else {
      recipients = await insuranceService.getBirthdayMailRecipients();
      if (!recipients || !recipients.to) {
        return res.status(400).json({ error: 'No mail recipients configured for the Birthday List in the Mail Id sheet.' });
      }
    }

    // Sorted by day of the month, 1st through the last day - same as the
    // on-screen Birthday List Export PDF (exportEmployeesPdf's
    // isBirthdayReport branch, public/workforce.js). Every row here already
    // shares the same birth month (that's how they were filtered above), so
    // just the day decides order - no Collar grouping, since once sorted by
    // day collars no longer sit in contiguous blocks.
    const sorted = birthdayEmployees.slice().sort((a, b) => {
      const dayDiff = a.dob.getUTCDate() - b.dob.getUTCDate();
      if (dayDiff !== 0) return dayDiff;
      return (a.name || '').localeCompare(b.name || '');
    });

    const rows = sorted.map((e) => [
      e.employeeId,
      e.name,
      e.designation || '—',
      departmentNames.get(e.departmentKey) || e.department || '—',
      formatCollar(e.groupD) || '—',
      e.location || '—',
      formatDobCurrentYear(e.dob, now)
    ]);

    const monthName = now.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });

    const pdfBuffer = await buildTablePdfBuffer({
      title: 'Birthday List',
      subtitle:
        monthName + ' ' + now.getUTCFullYear() + ' · ' +
        sorted.length + ' employee' + (sorted.length === 1 ? '' : 's') + ' · Generated ' +
        now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
      columns: ['Employee Code', 'Name', 'Designation', 'Department', 'Collar', 'Location', 'Date'],
      rows,
      landscape: false
    });

    await gmailService.sendMailWithAttachment({
      to: recipients.to,
      cc: recipients.cc,
      subject: monthName + ' Birthday Greeting Cards – Design Request',
      text:
        'Hi,\n\n' +
        'Please find the list of the below employees having birthdays this month & kindly design individual birthday greeting cards, so we can share these in the group on their respective dates.',
      attachment: {
        filename: 'Birthday_List_' + monthName + '_' + now.getUTCFullYear() + '.pdf',
        content: pdfBuffer,
        contentType: 'application/pdf'
      }
    });

    res.json({ ok: true, sentTo: recipients.to, cc: recipients.cc, employeeCount: sorted.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Autocomplete source for every Send Mail compose popup's To/Cc fields
// (public/workforce.js's getMailDirectory) - every active employee with an
// email on file, plus every address already configured across the Mail Id
// sheet's own blocks (Doer, Birthday), deduped by email. Addresses with no
// employee behind them (design@, hr@, manager.hr@...) just use the address
// itself as the display name, same as an unnamed contact in Gmail.
router.get('/mail-directory', async (req, res) => {
  try {
    const [{ employees }, doerRecipients, birthdayRecipients] = await Promise.all([
      employeeService.getEmployeeData(),
      insuranceService.getAllDoerMailRecipients(),
      insuranceService.getBirthdayMailRecipients()
    ]);

    const seen = new Map();
    employees.forEach((e) => {
      if (e.status === 'INACTIVE' || !e.email) return;
      const key = e.email.trim().toLowerCase();
      if (!seen.has(key)) seen.set(key, { name: e.name || e.email, email: e.email.trim() });
    });
    function addAddresses(recipients) {
      if (!recipients) return;
      [recipients.to, recipients.cc].forEach((field) => {
        (field || '').split(',').map((s) => s.trim()).filter(Boolean).forEach((email) => {
          const key = email.toLowerCase();
          if (!seen.has(key)) seen.set(key, { name: email, email });
        });
      });
    }
    doerRecipients.forEach((recipients) => addAddresses(recipients));
    addAddresses(birthdayRecipients);

    const directory = Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
    res.json({ directory });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/joining-trend', async (req, res) => {
  try {
    const { employees } = await employeeService.getEmployeeData();
    const months = Math.min(36, Math.max(1, Number(req.query.months) || 12));
    res.json({ buckets: analytics.joiningTrend(employees, months) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/insights', async (req, res) => {
  try {
    const { employees, departmentNames, locationNames, doerNames } = await employeeService.getEmployeeData();
    res.json({ insights: analytics.buildInsights(employees, departmentNames, locationNames, doerNames) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Powers the Pending Confirmations report (Dashboard -> Probation ->
// "Pending Confirmations") - the whole current month's confirmation-due
// list (1st to last day), regardless of whether an employee's Employment
// Type has already been updated to Confirmed by the time this is generated
// later in the month.
router.get('/pending-confirmations', async (req, res) => {
  try {
    const { employees, departmentNames, locationNames, reportingManagerNames } = await employeeService.getEmployeeData();
    const matches = analytics.pendingConfirmationsThisMonth(employees).map((e) => ({
      employeeId: e.employeeId,
      name: e.name,
      department: departmentNames.get(e.departmentKey) || e.department,
      designation: e.designation,
      location: locationNames.get(e.locationKey) || e.location,
      doj: e.doj ? e.doj.toISOString() : null,
      confirmationDate: e.doj ? analytics.probationCompletionDate(e.doj).toISOString() : null,
      reportingDoer: e.reportingDoer,
      reportingManager: reportingManagerNames.get(e.reportingManagerKey) || e.reportingManager
    }));
    res.json({ total: matches.length, items: matches });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// A real PDF file for the Probation stat block's Share button (on the
// Dashboard's own "Employment Type" panel) - the on-screen "Pending
// Confirmations" button itself is a plain window.print() with no file to
// hand to navigator.share. Same title/columns/rows/landscape layout as that
// on-screen report (renderPendingConfirmationsReport in workforce.js),
// through the same pdfReport.js builder the Mediclaim/Upcoming Joinings
// PDFs already use. Signature column is left blank, same as on screen -
// meant for a pen signature on the printed page, not a real value.
router.get('/pending-confirmations/pdf', async (req, res) => {
  try {
    const { employees, departmentNames, locationNames, reportingManagerNames } = await employeeService.getEmployeeData();
    const items = analytics.pendingConfirmationsThisMonth(employees).map((e) => ({
      employeeId: e.employeeId,
      name: e.name,
      designation: e.designation,
      department: departmentNames.get(e.departmentKey) || e.department,
      location: locationNames.get(e.locationKey) || e.location,
      confirmationDate: e.doj ? analytics.probationCompletionDate(e.doj) : null,
      reportingManager: reportingManagerNames.get(e.reportingManagerKey) || e.reportingManager
    })).sort((a, b) => {
      const dateDiff = new Date(a.confirmationDate) - new Date(b.confirmationDate);
      if (dateDiff !== 0) return dateDiff;
      return (a.name || '').localeCompare(b.name || '');
    });

    const monthLabel = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    const pdfBuffer = await buildTablePdfBuffer({
      title: 'Pending Confirmations Report',
      subtitle: monthLabel + ' · ' + items.length + ' employee' + (items.length === 1 ? '' : 's') + ' · Generated ' +
        new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
      columns: ['Employee Code', 'Name', 'Designation', 'Department', 'Location', 'Confirmation Date', 'HOD Name', 'Signature'],
      rows: items.length
        ? items.map((it) => [
            it.employeeId,
            it.name,
            it.designation || '—',
            it.department || '—',
            it.location || '—',
            it.confirmationDate ? new Date(it.confirmationDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—',
            it.reportingManager || '—',
            ''
          ])
        : [['No confirmations due this month', '', '', '', '', '', '', '']],
      landscape: true
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="Pending_Confirmations.pdf"');
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/tenure', async (req, res) => {
  try {
    const { employees } = await employeeService.getEmployeeData();
    res.json(analytics.tenureAnalytics(employees));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/age', async (req, res) => {
  try {
    const { employees } = await employeeService.getEmployeeData();
    res.json(analytics.ageAnalytics(employees));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/gender', async (req, res) => {
  try {
    const { employees } = await employeeService.getEmployeeData();
    res.json(analytics.genderAnalytics(employees));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Real change counts from movementTracker's own daily-snapshot logs (a
// separate spreadsheet, isolated from Employee_Master) - each starts at 0
// from whenever its tracker first ran, since no backdated history exists
// to reconstruct.
router.get('/dept-transfers', async (req, res) => {
  try {
    const days = Math.min(3650, Math.max(1, Number(req.query.days) || 365));
    const data = await movementTracker.getTransfersInLastDays(days);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Department is cross-referenced from the HR Master sheet by Employee ID,
// the same way covered-employees/family-members do it - Generate Letter
// needs it (for the letter's own recipient block) and the tracker log
// itself has no department column.
router.get('/promotions', async (req, res) => {
  try {
    const days = Math.min(3650, Math.max(1, Number(req.query.days) || 365));
    const [data, hrData] = await Promise.all([
      movementTracker.getPromotionsInLastDays(days),
      employeeService.getEmployeeData({})
    ]);
    const hrByEmployeeId = new Map(hrData.employees.map((e) => [e.employeeId, e]));
    const items = data.items.map((it) => {
      const hr = hrByEmployeeId.get(it.employeeId);
      return { ...it, department: hr ? (hrData.departmentNames.get(hr.departmentKey) || hr.department) : '' };
    });
    res.json({ total: data.total, items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/company-transfers', async (req, res) => {
  try {
    const days = Math.min(3650, Math.max(1, Number(req.query.days) || 365));
    const data = await movementTracker.getCompanyTransfersInLastDays(days);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/location-transfers', async (req, res) => {
  try {
    const days = Math.min(3650, Math.max(1, Number(req.query.days) || 365));
    const data = await movementTracker.getLocationTransfersInLastDays(days);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Increment Letter PDF - a real, final-format document (see letterPdf.js
// for why it reproduces the company's own Word template exactly rather
// than a generic layout).
router.post('/letters/increment', async (req, res) => {
  try {
    const {
      title, employeeName, employeeId, department, companyName, refNo,
      currentDesignation, currentGross, revisedGross, currentNotice, revisedNotice,
      effectiveDate, incrementYear
    } = req.body || {};
    if (!employeeName || !companyName || !refNo || !currentGross || !revisedGross || !effectiveDate) {
      return res.status(400).json({ error: 'Missing required letter fields' });
    }
    const buffer = await buildIncrementLetterPdf({
      title: title || 'Mr.',
      employeeName,
      employeeId: employeeId || '',
      department: department || '',
      companyName,
      refNo,
      currentDesignation: currentDesignation || '',
      currentGross,
      revisedGross,
      currentNotice: currentNotice || '',
      revisedNotice: revisedNotice || '',
      effectiveDate,
      incrementYear: incrementYear || ''
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      'inline; filename="Increment_Letter_' + employeeName.replace(/[^a-z0-9]+/gi, '_') + '.pdf"'
    );
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Promotion & Increment Letter PDF - same idea, its own template (see
// letterPdf.js).
router.post('/letters/promotion-increment', async (req, res) => {
  try {
    const {
      title, employeeName, employeeId, department, companyName, refNo,
      fromDesignation, toDesignation, currentGross, revisedGross,
      currentNotice, revisedNotice, effectiveDate, incrementYear
    } = req.body || {};
    if (!employeeName || !companyName || !refNo || !fromDesignation || !toDesignation ||
        !currentGross || !revisedGross || !effectiveDate) {
      return res.status(400).json({ error: 'Missing required letter fields' });
    }
    const buffer = await buildPromotionIncrementLetterPdf({
      title: title || 'Mr.',
      employeeName,
      employeeId: employeeId || '',
      department: department || '',
      companyName,
      refNo,
      fromDesignation,
      toDesignation,
      currentGross,
      revisedGross,
      currentNotice: currentNotice || '',
      revisedNotice: revisedNotice || '',
      effectiveDate,
      incrementYear: incrementYear || ''
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      'inline; filename="Promotion_Increment_Letter_' + employeeName.replace(/[^a-z0-9]+/gi, '_') + '.pdf"'
    );
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/data-quality', async (req, res) => {
  try {
    const { employees } = await employeeService.getEmployeeData();
    res.json(analytics.dataQualityReport(employees));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
