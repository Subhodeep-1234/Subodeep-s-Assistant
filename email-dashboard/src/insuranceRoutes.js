const express = require('express');
const insuranceService = require('./insuranceService');
const employeeService = require('./employeeService');
const analytics = require('./insuranceAnalytics');
const gmailService = require('./gmailService');
const { buildTablePdfBuffer } = require('./pdfReport');

const router = express.Router();

const EXITS_PDF_COLUMNS = ['Sr No', 'Corporate_name', 'Employee ID/UHID', 'Name of Insured', 'Gender', 'Relationship', 'Date of Leaving', 'Reason'];
const EXIT_MAIL_TO = 'manager.hr@alcoverealty.in';
const EXIT_MAIL_CC = 'hr@alcoverealty.in';

function wantsForceRefresh(req) {
  return req.query.refresh === '1' || req.query.refresh === 'true';
}

router.get('/summary', async (req, res) => {
  try {
    const data = await insuranceService.getInsuranceData({ forceRefresh: wantsForceRefresh(req) });
    const summary = analytics.buildHealthInsuranceSummary(data);
    const renewal = analytics.policyRenewalInfo();
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
    const insuranceData = await insuranceService.getInsuranceData({});
    const rawRows = analytics.sortDeletionsSelfFirst(insuranceData.deletions);

    const pdfBuffer = await buildTablePdfBuffer({
      title: 'Health Insurance Exits Report',
      subtitle:
        rawRows.length + ' record' + (rawRows.length === 1 ? '' : 's') + ' · Generated ' +
        new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
      columns: EXITS_PDF_COLUMNS,
      rows: rawRows.map((r) => [r.srNo, r.corporateName, r.employeeId, r.name, r.gender, r.relationship, r.dateOfLeaving, r.reason])
    });

    await gmailService.sendMailWithAttachment({
      to: EXIT_MAIL_TO,
      cc: EXIT_MAIL_CC,
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

    res.json({ ok: true, sentTo: EXIT_MAIL_TO, cc: EXIT_MAIL_CC, recordCount: rawRows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
