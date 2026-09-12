const express = require('express');
const insuranceService = require('./insuranceService');
const analytics = require('./insuranceAnalytics');

const router = express.Router();

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

module.exports = router;
