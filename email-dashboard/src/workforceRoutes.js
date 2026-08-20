const express = require('express');
const employeeService = require('./employeeService');
const analytics = require('./workforceAnalytics');

const router = express.Router();
const EMPLOYEE_LIST_CAP = 1000;

function configErrorMessage(missing) {
  return 'Missing configuration: ' + missing.join(', ') + '.';
}

function wantsForceRefresh(req) {
  return req.query.refresh === '1' || req.query.refresh === 'true';
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
    const { departmentNames, locationNames } = await employeeService.getEmployeeData();
    res.json({
      departments: Array.from(departmentNames.values()).sort((a, b) => a.localeCompare(b)),
      locations: Array.from(locationNames.values()).sort((a, b) => a.localeCompare(b))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function matchesFilters(emp, query, normalizeKey) {
  if (query.status && emp.status !== String(query.status).toUpperCase()) return false;
  if (query.department && emp.departmentKey !== normalizeKey(query.department)) return false;
  if (query.location && emp.locationKey !== normalizeKey(query.location)) return false;
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
  return true;
}

router.get('/employees', async (req, res) => {
  try {
    const { employees, departmentNames, locationNames } = await employeeService.getEmployeeData({
      forceRefresh: wantsForceRefresh(req)
    });
    const filtered = employees.filter((e) => matchesFilters(e, req.query, employeeService.normalizeKey));
    const items = filtered.slice(0, EMPLOYEE_LIST_CAP).map((e) => ({
      employeeId: e.employeeId,
      name: e.name,
      department: departmentNames.get(e.departmentKey) || e.department,
      designation: e.designation,
      groupD: e.groupD,
      location: locationNames.get(e.locationKey) || e.location,
      reportingDoer: e.reportingDoer,
      reportingManager: e.reportingManager,
      doj: e.doj ? e.doj.toISOString() : null,
      tenure: e.tenure,
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
    const { employees, departmentNames, locationNames } = await employeeService.getEmployeeData();
    const statusFilter = req.query.status
      ? (e) => e.status === String(req.query.status).toUpperCase()
      : null;
    res.json({
      departments: analytics.departmentBreakdown(employees, departmentNames, statusFilter),
      locations: analytics.locationBreakdown(employees, locationNames, statusFilter)
    });
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
    const { employees, departmentNames, locationNames } = await employeeService.getEmployeeData();
    res.json({ insights: analytics.buildInsights(employees, departmentNames, locationNames) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/probation-completing', async (req, res) => {
  try {
    const { employees, departmentNames, locationNames } = await employeeService.getEmployeeData();
    const matches = analytics.probationCompletingThisMonth(employees).map((e) => ({
      employeeId: e.employeeId,
      name: e.name,
      department: departmentNames.get(e.departmentKey) || e.department,
      designation: e.designation,
      location: locationNames.get(e.locationKey) || e.location,
      doj: e.doj ? e.doj.toISOString() : null,
      reportingDoer: e.reportingDoer
    }));
    res.json({ total: matches.length, items: matches });
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

router.get('/data-quality', async (req, res) => {
  try {
    const { employees } = await employeeService.getEmployeeData();
    res.json(analytics.dataQualityReport(employees));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
