// Fully public - no hrAuth session, no Google OAuth. A candidate or
// interviewer isn't a user of this system at all, just someone holding a
// long random token in a URL (see interviewPanelService.js's
// generateToken) - verified per-request against the sheet, the same way
// the cron webhooks in server.js verify their own bearer secret inline
// rather than relying on either of the app's two session-based auth
// systems.
const express = require('express');
const interviewPanelService = require('./interviewPanelService');

const router = express.Router();

// Only the fields a candidate is actually allowed to write - the read-only
// GET below never exposes interviewer-only fields to this page at all.
router.get('/candidate/:token', async (req, res) => {
  try {
    const record = await interviewPanelService.getByCandidateToken(req.params.token);
    if (!record) return res.status(404).json({ error: 'This link is invalid.' });
    if (record.candidateTokenUsedAt) {
      return res.json({ ok: true, alreadySubmitted: true });
    }
    res.json({ ok: true, alreadySubmitted: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/candidate/:token', async (req, res) => {
  try {
    const result = await interviewPanelService.submitCandidateForm(req.params.token, req.body || {});
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Candidate info is shown read-only at the top of the Interviewer Form -
// only sent once the candidate has actually submitted (see
// interviewPanelService's own guard, mirrored here so the page can show a
// clear "not ready yet" state instead of a blank/broken form).
router.get('/interviewer/:token', async (req, res) => {
  try {
    const record = await interviewPanelService.getByInterviewerToken(req.params.token);
    if (!record) return res.status(404).json({ error: 'This link is invalid.' });
    if (record.interviewerTokenUsedAt) {
      return res.json({ ok: true, alreadySubmitted: true });
    }
    if (!record.candidateTokenUsedAt) {
      return res.json({ ok: true, candidateNotReady: true });
    }
    res.json({
      ok: true,
      alreadySubmitted: false,
      candidate: {
        name: record.name,
        email: record.email,
        contactNo: record.contactNo,
        qualification: record.qualification,
        experience: record.experience,
        currentPosition: record.currentPosition,
        positionAppliedFor: record.positionAppliedFor,
        interviewDate: record.interviewDate,
        interviewPlace: record.interviewPlace,
        interviewMode: record.interviewMode,
        referenceName: record.referenceName,
        presentLastCompany: record.presentLastCompany,
        designation: record.designation,
        currentLastSalaryDrawn: record.currentLastSalaryDrawn,
        expectedSalary: record.expectedSalary,
        noticePeriod: record.noticePeriod,
        workedOnAlcoveProjects: record.workedOnAlcoveProjects,
        alcoveProjectsDetails: record.alcoveProjectsDetails
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/interviewer/:token', async (req, res) => {
  try {
    const result = await interviewPanelService.submitInterviewerForm(req.params.token, req.body || {});
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
