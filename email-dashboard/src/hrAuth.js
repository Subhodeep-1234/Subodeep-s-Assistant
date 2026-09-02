const crypto = require('crypto');

const OTP_WINDOW_MS = 5 * 60 * 1000;
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const RESEND_COOLDOWN_MS = 45 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;
const COOKIE_NAME = 'hr_session';

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function hmac(secret, data) {
  return crypto.createHmac('sha256', secret).update(data).digest();
}

function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function requireOtpSecret() {
  const secret = process.env.HR_OTP_SECRET;
  if (!secret) throw new Error('HR_OTP_SECRET is not configured');
  return secret;
}

function requireSessionSecret() {
  const secret = process.env.HR_SESSION_SECRET;
  if (!secret) throw new Error('HR_SESSION_SECRET is not configured');
  return secret;
}

// ---------- OTP: stateless, HMAC-derived from email + a 5-minute time step.
// No storage anywhere - identical result on any serverless instance / cold start.

function otpForStep(email, timeStep) {
  const digest = hmac(requireOtpSecret(), normalizeEmail(email) + ':' + timeStep);
  const code = digest.readUInt32BE(0) % 1000000;
  return String(code).padStart(6, '0');
}

function currentTimeStep() {
  return Math.floor(Date.now() / OTP_WINDOW_MS);
}

function generateOtp(email) {
  return otpForStep(email, currentTimeStep());
}

// Accepts the current and previous window (10 minutes effective validity).
function verifyOtp(email, submittedCode) {
  const code = String(submittedCode || '').trim();
  const step = currentTimeStep();
  return timingSafeEqualStr(code, otpForStep(email, step)) ||
    timingSafeEqualStr(code, otpForStep(email, step - 1));
}

// ---------- Small signed cookies (hand-rolled, no cookie-parser needed for one value).

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  });
  return out;
}

function sign(secret, payloadB64) {
  return hmac(secret, payloadB64).toString('hex');
}

function signedCookieValue(secret, payloadObj) {
  const payloadB64 = base64url(Buffer.from(JSON.stringify(payloadObj)));
  return payloadB64 + '.' + sign(secret, payloadB64);
}

function readSignedCookie(secret, raw) {
  if (!raw) return null;
  const dot = raw.lastIndexOf('.');
  if (dot === -1) return null;
  const payloadB64 = raw.slice(0, dot);
  const signature = raw.slice(dot + 1);
  if (!timingSafeEqualStr(signature, sign(secret, payloadB64))) return null;
  try {
    const json = Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function setCookie(res, name, value, maxAgeMs) {
  const parts = [
    name + '=' + encodeURIComponent(value),
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=' + Math.round(maxAgeMs / 1000)
  ];
  if (process.env.VERCEL) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

function clearCookie(res, name) {
  const parts = [name + '=', 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (process.env.VERCEL) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

// ---------- Session

function createSession(res, email) {
  const value = signedCookieValue(requireSessionSecret(), {
    email: normalizeEmail(email),
    exp: Date.now() + SESSION_MAX_AGE_MS
  });
  setCookie(res, COOKIE_NAME, value, SESSION_MAX_AGE_MS);
}

function readSession(req) {
  const cookies = parseCookies(req);
  const payload = readSignedCookie(requireSessionSecret(), cookies[COOKIE_NAME]);
  if (!payload || !payload.email || !payload.exp) return null;
  if (Date.now() > payload.exp) return null;
  return { email: payload.email };
}

function destroySession(res) {
  clearCookie(res, COOKIE_NAME);
}

function requireHrAuth(req, res, next) {
  if (!process.env.HR_OTP_SECRET || !process.env.HR_SESSION_SECRET) {
    return res.status(500).send('Missing configuration: HR_OTP_SECRET / HR_SESSION_SECRET.');
  }
  const session = readSession(req);
  if (!session) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not logged in' });
    return res.redirect('/login');
  }
  req.hrUser = session;
  next();
}

// ---------- Resend cooldown + verify-attempt limiting (both stateless, per-email signed cookies).

function cooldownCookieName(email) {
  return 'hr_otp_cd_' + crypto.createHash('sha256').update(normalizeEmail(email)).digest('hex').slice(0, 16);
}

function checkAndSetResendCooldown(req, res, email) {
  const name = cooldownCookieName(email);
  const cookies = parseCookies(req);
  const payload = readSignedCookie(requireOtpSecret(), cookies[name]);
  if (payload && payload.until && Date.now() < payload.until) {
    return Math.ceil((payload.until - Date.now()) / 1000);
  }
  const until = Date.now() + RESEND_COOLDOWN_MS;
  setCookie(res, name, signedCookieValue(requireOtpSecret(), { until }), RESEND_COOLDOWN_MS);
  return 0;
}

function attemptsCookieName(email) {
  return 'hr_otp_at_' + crypto.createHash('sha256').update(normalizeEmail(email)).digest('hex').slice(0, 16);
}

function tooManyAttempts(req, email) {
  const cookies = parseCookies(req);
  const payload = readSignedCookie(requireOtpSecret(), cookies[attemptsCookieName(email)]);
  return Boolean(payload && payload.step === currentTimeStep() && payload.count >= MAX_VERIFY_ATTEMPTS);
}

function recordFailedAttempt(req, res, email) {
  const cookies = parseCookies(req);
  const payload = readSignedCookie(requireOtpSecret(), cookies[attemptsCookieName(email)]);
  const step = currentTimeStep();
  const count = payload && payload.step === step ? payload.count + 1 : 1;
  setCookie(res, attemptsCookieName(email), signedCookieValue(requireOtpSecret(), { step, count }), OTP_WINDOW_MS);
}

module.exports = {
  normalizeEmail,
  isValidEmail,
  generateOtp,
  verifyOtp,
  createSession,
  readSession,
  destroySession,
  requireHrAuth,
  checkAndSetResendCooldown,
  tooManyAttempts,
  recordFailedAttempt,
  RESEND_COOLDOWN_MS
};
