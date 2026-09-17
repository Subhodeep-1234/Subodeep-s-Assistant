const express = require('express');
const interviewPanelService = require('./interviewPanelService');
const { buildInterviewAssessmentPdf } = require('./interviewAssessmentPdf');

const router = express.Router();

// Base URL for the two shareable links - PUBLIC_BASE_URL isn't set anywhere
// else in this app yet (every other feature is same-origin), but this is
// the first one that needs an absolute URL a candidate/interviewer opens
// outside the app itself. Vercel sets VERCEL_URL to the deployment's own
// host with no protocol; falls back to the request's own host for local
// dev, so this works with no new env var required.
function baseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  if (process.env.VERCEL_URL) return 'https://' + process.env.VERCEL_URL;
  return req.protocol + '://' + req.get('host');
}

router.get('/', async (req, res) => {
  try {
    const candidates = await interviewPanelService.listCandidates();
    res.json({ candidates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const name = req.body && typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!name) return res.status(400).json({ error: 'Candidate name is required.' });
    const created = await interviewPanelService.createCandidate(req.hrUser.email, name);
    const base = baseUrl(req);
    res.json({
      ok: true,
      id: created.id,
      candidateLink: base + '/interview/candidate/' + created.candidateToken,
      interviewerLink: base + '/interview/interviewer/' + created.interviewerToken
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const record = await interviewPanelService.getCandidateById(req.params.id);
    if (!record) return res.status(404).json({ error: 'Candidate not found' });
    res.json({ candidate: record });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/pdf', async (req, res) => {
  try {
    const record = await interviewPanelService.getCandidateById(req.params.id);
    if (!record) return res.status(404).json({ error: 'Candidate not found' });
    const pdfBuffer = await buildInterviewAssessmentPdf(record);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="Interview_Assessment_' + (record.name || record.id).replace(/\s+/g, '_') + '.pdf"'
    );
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
