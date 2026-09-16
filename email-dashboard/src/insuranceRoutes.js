const express = require('express');
const insuranceService = require('./insuranceService');
const employeeService = require('./employeeService');
const analytics = require('./insuranceAnalytics');
const gmailService = require('./gmailService');
const { buildTablePdfBuffer } = require('./pdfReport');
const policyInfoService = require('./policyInfoService');
const policyDocumentsService = require('./policyDocumentsService');

const router = express.Router();

const EXITS_PDF_COLUMNS = ['Sr No', 'Corporate_name', 'Employee ID/UHID', 'Name of Insured', 'Gender', 'Relationship', 'Date of Leaving', 'Reason'];
const ADDITIONS_PDF_COLUMNS = ['Sl. No.', 'Corporate_name', 'Emp ID', 'Full Name', 'DOJ/DOM', 'DOB', 'Gender', 'Relationship', 'Sum Insured'];
// To/Cc recipients for both Send Mail buttons come from the "Mediclaim
// Addition & Deletion Automation" sheet's own "Mail Id" tab (see
// insuranceService.getMailRecipients) rather than being hardcoded here -
// editing that tab is how the user adds/removes recipients going forward.

function wantsForceRefresh(req) {
  return req.query.refresh === '1' || req.query.refresh === 'true';
}

router.get('/summary', async (req, res) => {
  try {
    const [data, policyValues] = await Promise.all([
      insuranceService.getInsuranceData({ forceRefresh: wantsForceRefresh(req) }),
      policyInfoService.getPolicyInfo()
    ]);
    const summary = analytics.buildHealthInsuranceSummary(data);
    const renewal = analytics.policyRenewalInfo(policyValues.policyStartDate, policyValues.policyEndDate);
    res.json({ ...summary, renewal });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Member List has no Department/Designation column - cross-referenced here
// from the HR Master sheet by Employee ID, since that's a separate fetch
// this analytics-only module shouldn't have to know about.
router.get('/covered-employees', async (req, res) => {
  try {
    const forceRefresh = wantsForceRefresh(req);
    const [insuranceData, hrData] = await Promise.all([
      insuranceService.getInsuranceData({ forceRefresh }),
      employeeService.getEmployeeData({ forceRefresh })
    ]);
    const hrByEmployeeId = new Map(hrData.employees.map((e) => [e.employeeId, e]));

    const items = analytics.buildCoveredEmployeesList(insuranceData.members).map((c) => {
      const hr = hrByEmployeeId.get(c.employeeId);
      return {
        employeeId: c.employeeId,
        name: c.name,
        department: hr ? (hrData.departmentNames.get(hr.departmentKey) || hr.department) : '',
        designation: hr ? hr.designation : '',
        familyCount: c.familyCount,
        totalPremium: c.totalPremium,
        status: c.status
      };
    });

    res.json({ total: items.length, items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Family members list - cross-referenced by Employee ID against the HR
// Master sheet the same way covered-employees is, for the department the
// related employee (not the family member themselves) belongs to.
router.get('/family-members', async (req, res) => {
  try {
    const forceRefresh = wantsForceRefresh(req);
    const [insuranceData, hrData] = await Promise.all([
      insuranceService.getInsuranceData({ forceRefresh }),
      employeeService.getEmployeeData({ forceRefresh })
    ]);
    const hrByEmployeeId = new Map(hrData.employees.map((e) => [e.employeeId, e]));

    const items = analytics.buildFamilyMembersList(insuranceData.members).map((m) => {
      const hr = hrByEmployeeId.get(m.employeeId);
      return {
        employeeId: m.employeeId,
        name: m.name,
        relationship: m.relationship,
        relatedEmployeeName: m.relatedEmployeeName,
        department: hr ? (hrData.departmentNames.get(hr.departmentKey) || hr.department) : '',
        premiumWithGST: m.premiumWithGST
      };
    });

    res.json({ total: items.length, items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Count + total premium per family relationship group (Spouse/Children/
// Parents/Other) - the Family Premium drill-down.
router.get('/family-premium-breakdown', async (req, res) => {
  try {
    const insuranceData = await insuranceService.getInsuranceData({ forceRefresh: wantsForceRefresh(req) });
    const groups = analytics.buildFamilyPremiumBreakdown(insuranceData.members);
    res.json({ groups });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Count + total premium per relationship group, across every member
// regardless of status - the Annual Premium drill-down (Annual Premium
// itself is the one figure that isn't Active-only, see
// buildHealthInsuranceSummary's own comment on it).
router.get('/annual-premium-breakdown', async (req, res) => {
  try {
    const insuranceData = await insuranceService.getInsuranceData({ forceRefresh: wantsForceRefresh(req) });
    const groups = analytics.buildAnnualPremiumBreakdown(insuranceData.members);
    res.json({ groups });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Every Active member (Self + family) flat - the Total Insured Lives
// drill-down.
router.get('/total-insured-lives', async (req, res) => {
  try {
    const forceRefresh = wantsForceRefresh(req);
    const [insuranceData, hrData] = await Promise.all([
      insuranceService.getInsuranceData({ forceRefresh }),
      employeeService.getEmployeeData({ forceRefresh })
    ]);
    const hrByEmployeeId = new Map(hrData.employees.map((e) => [e.employeeId, e]));

    const items = analytics.buildTotalInsuredLivesList(insuranceData.members).map((m) => {
      const hr = hrByEmployeeId.get(m.employeeId);
      return {
        employeeId: m.employeeId,
        name: m.name,
        relationship: m.relationship,
        department: hr ? (hrData.departmentNames.get(hr.departmentKey) || hr.department) : '',
        premiumWithGST: m.premiumWithGST
      };
    });

    res.json({ total: items.length, items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Deletions tab has no Department/Designation column either - cross-referenced
// the same way covered-employees is, by Employee ID against the HR Master sheet.
router.get('/exits', async (req, res) => {
  try {
    const forceRefresh = wantsForceRefresh(req);
    const [insuranceData, hrData] = await Promise.all([
      insuranceService.getInsuranceData({ forceRefresh }),
      employeeService.getEmployeeData({ forceRefresh })
    ]);
    const hrByEmployeeId = new Map(hrData.employees.map((e) => [e.employeeId, e]));

    const items = analytics.buildExitsList(insuranceData.deletions).map((c) => {
      const hr = hrByEmployeeId.get(c.employeeId);
      return {
        employeeId: c.employeeId,
        name: c.name,
        department: hr ? (hrData.departmentNames.get(hr.departmentKey) || hr.department) : '',
        designation: hr ? hr.designation : '',
        status: hr ? hr.status : '',
        dateOfLeaving: c.dateOfLeaving,
        familyCount: c.familyCount
      };
    });

    // Raw Deletions rows (Sr No, Corporate Name, Employee ID, Name of
    // Insured, Gender, Relationship, Date of Leaving, Reason) - separate
    // from `items` above (which is grouped one-row-per-exited-employee for
    // the on-screen list) since the PDF export wants every logged row, each
    // employee's Self row immediately followed by their own family rows.
    const rawRows = analytics.sortDeletionsSelfFirst(insuranceData.deletions);

    res.json({ total: items.length, items, rawRows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Emails the same rows the Exits page's own PDF export shows (Self row
// first, family rows right after) as a real attachment, straight to the
// company's Mediclaim contacts. Regenerates fresh rather than trusting
// whatever the client last rendered, since this is a real outbound email.
router.post('/exits/send-mail', async (req, res) => {
  try {
    const [insuranceData, recipients] = await Promise.all([
      insuranceService.getInsuranceData({}),
      insuranceService.getMailRecipients()
    ]);
    const rawRows = analytics.sortDeletionsSelfFirst(insuranceData.deletions);

    const pdfBuffer = await buildTablePdfBuffer({
      title: 'Health Insurance Exits Report',
      subtitle:
        rawRows.length + ' record' + (rawRows.length === 1 ? '' : 's') + ' · Generated ' +
        new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
      columns: EXITS_PDF_COLUMNS,
      // Sr No is a fresh running serial over the displayed (Self-first) order,
      // not the sheet's original Sr No column - that would otherwise show
      // out-of-sequence numbers like 4, 7, 13, 3... after the reorder.
      rows: rawRows.map((r, i) => [i + 1, r.corporateName, r.employeeId, r.name, r.gender, r.relationship, r.dateOfLeaving, r.reason])
    });

    await gmailService.sendMailWithAttachment({
      to: recipients.to,
      cc: recipients.cc,
      subject: 'Request for Deletion of Member(s) under Group Mediclaim Policy',
      text:
        'Dear Sir/Madam,\n\n' +
        'We would like to request the deletion of the following member(s) under our Group Mediclaim Policy. Kindly confirm the deletion at the earliest.',
      attachment: {
        filename: 'Health_Insurance_Exits_' + new Date().toISOString().slice(0, 10) + '.pdf',
        content: pdfBuffer,
        contentType: 'application/pdf'
      }
    });

    res.json({ ok: true, sentTo: recipients.to, cc: recipients.cc, recordCount: rawRows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Additions tab has no Department/Designation column either - cross-referenced
// the same way exits is, by Employee ID against the HR Master sheet.
router.get('/additions', async (req, res) => {
  try {
    const forceRefresh = wantsForceRefresh(req);
    const [insuranceData, hrData] = await Promise.all([
      insuranceService.getInsuranceData({ forceRefresh }),
      employeeService.getEmployeeData({ forceRefresh })
    ]);
    const hrByEmployeeId = new Map(hrData.employees.map((e) => [e.employeeId, e]));

    const items = analytics.buildAdditionsList(insuranceData.additions).map((c) => {
      const hr = hrByEmployeeId.get(c.employeeId);
      return {
        employeeId: c.employeeId,
        name: c.name,
        department: hr ? (hrData.departmentNames.get(hr.departmentKey) || hr.department) : '',
        designation: hr ? hr.designation : '',
        status: hr ? hr.status : '',
        doj: c.doj,
        familyCount: c.familyCount
      };
    });

    // Raw Additions rows (Sl. No., Corporate Name, Emp ID, Full Name,
    // DOJ/DOM, DOB, Gender, Relationship, Sum Insured) - separate from
    // `items` above (grouped one-row-per-employee for the on-screen list)
    // since the PDF export wants every logged row, each employee's Self
    // row immediately followed by their own family rows.
    const rawRows = analytics.sortAdditionsSelfFirst(insuranceData.additions);

    res.json({ total: items.length, items, rawRows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Emails the same rows the New Addition Requests page's own PDF export
// shows (Self row first, family rows right after) as a real attachment,
// straight to the company's Mediclaim contacts. Regenerates fresh rather
// than trusting whatever the client last rendered, since this is a real
// outbound email.
router.post('/additions/send-mail', async (req, res) => {
  try {
    const [insuranceData, recipients] = await Promise.all([
      insuranceService.getInsuranceData({}),
      insuranceService.getMailRecipients()
    ]);
    const rawRows = analytics.sortAdditionsSelfFirst(insuranceData.additions);

    const pdfBuffer = await buildTablePdfBuffer({
      title: 'Health Insurance New Addition Requests',
      subtitle:
        rawRows.length + ' record' + (rawRows.length === 1 ? '' : 's') + ' · Generated ' +
        new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
      columns: ADDITIONS_PDF_COLUMNS,
      // Sl. No. is a fresh running serial over the displayed (Self-first)
      // order, not the sheet's original Sl. No. column - same reasoning
      // as the Exits PDF's Sr No.
      rows: rawRows.map((r, i) => [i + 1, r.corporateName, r.employeeId, r.name, r.doj, r.dob, r.gender, r.relationship, r.sumInsured])
    });

    await gmailService.sendMailWithAttachment({
      to: recipients.to,
      cc: recipients.cc,
      subject: 'Request for Addition of Member(s) under Group Mediclaim Policy',
      text:
        'Dear Sir/Madam,\n\n' +
        'We would like to request the addition of the following member(s) under our Group Mediclaim Policy. Kindly confirm the addition and share the e-card(s) at the earliest.',
      attachment: {
        filename: 'Health_Insurance_Additions_' + new Date().toISOString().slice(0, 10) + '.pdf',
        content: pdfBuffer,
        contentType: 'application/pdf'
      }
    });

    res.json({ ok: true, sentTo: recipients.to, cc: recipients.cc, recordCount: rawRows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manually-entered policy metadata (Insurer Name, TPA, dates, Sum Insured,
// etc.) - no live sheet source exists for these, so they're stored/edited
// through this route instead (see policyInfoService.js for where).
router.get('/policy-info', async (req, res) => {
  try {
    const values = await policyInfoService.getPolicyInfo();
    // Renewal is derived from this same Start/End Date pair - included here
    // so the page's status banner reflects it without a second fetch.
    const renewal = analytics.policyRenewalInfo(values.policyStartDate, values.policyEndDate);
    res.json({ fields: policyInfoService.FIELDS, values, renewal });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/policy-info', async (req, res) => {
  try {
    const { key, value } = req.body || {};
    if (!key) return res.status(400).json({ error: 'Missing field key' });
    const values = await policyInfoService.savePolicyInfoField(key, String(value == null ? '' : value));
    res.json({ ok: true, values });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Policy Documents and Employee E-Cards, listed live from the shared Drive
// folder - see policyDocumentsService.js for the folder layout convention
// (loose files at the root are Policy Documents, its "Employee E Cards"
// subfolder holds the E-Cards). One route for both since the Policy
// Information page loads them together; search is client-side against
// this same small list, same as most other lists in this app.
router.get('/policy-documents', async (req, res) => {
  try {
    const data = await policyDocumentsService.getPolicyDriveData({
      forceRefresh: req.query.refresh === '1'
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
