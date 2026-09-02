require('dotenv').config();
const express = require('express');
const path = require('path');
const { getAuthUrl, handleCallback, isAuthenticated, getConfigStatus } = require('./src/auth');
const gmailService = require('./src/gmailService');
const workforceRoutes = require('./src/workforceRoutes');
const hrAuth = require('./src/hrAuth');
const emailService = require('./src/emailService');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/api/status', (req, res) => {
  const status = getConfigStatus();
  res.json({
    ok: status.ok,
    missing: status.missing,
    runningOnVercel: Boolean(process.env.VERCEL)
  });
});

function configErrorMessage(missing) {
  return (
    'Missing configuration: ' + missing.join(', ') + '.\n\n' +
    'Set these in your environment (Vercel: Project Settings → Environment Variables ' +
    '→ make sure they are enabled for Production → redeploy), then try again.'
  );
}

function requireAuth(req, res, next) {
  const status = getConfigStatus();
  if (!status.ok) {
    return res.status(500).send(configErrorMessage(status.missing));
  }
  if (!isAuthenticated()) {
    return res.redirect('/auth');
  }
  next();
}

app.get('/auth', (req, res) => {
  const status = getConfigStatus();
  if (!status.ok) {
    return res.status(500).send(configErrorMessage(status.missing));
  }
  res.redirect(getAuthUrl());
});

app.get('/oauth2callback', async (req, res) => {
  try {
    const tokens = await handleCallback(req.query.code);
    if (process.env.VERCEL) {
      // Nothing written here survives past this request on Vercel, so hand
      // the refresh token back once for the user to save as an env var.
      return res.send(
        '<pre style="white-space:pre-wrap;font-family:monospace;padding:20px;">' +
          'Signed in. Copy the value below into this project\'s GOOGLE_REFRESH_TOKEN ' +
          'environment variable on Vercel, then redeploy:\n\n' +
          (tokens.refresh_token || '(no refresh_token returned — remove existing Vercel access via ' +
            'https://myaccount.google.com/permissions and try again so Google issues a new one)') +
          '</pre>'
      );
    }
    res.redirect('/mail');
  } catch (err) {
    res.status(500).send('Authentication failed: ' + err.message);
  }
});

// These two HTML documents are the entry point that decides which
// versioned CSS/JS URLs the browser even requests — if the *document*
// itself gets cached (res.sendFile's own defaults, or any CDN in between),
// bumping ?v=N on the assets never even reaches the client. no-store is
// deliberately more aggressive than the static middleware's max-age:0.
function sendNoStore(res, filePath) {
  res.set('Cache-Control', 'no-store, must-revalidate');
  res.sendFile(filePath);
}

// The bare domain is now the link shared with directors, so it goes straight
// to the new login instead of the old Mail Management inbox tool.
app.get('/', (req, res) => {
  res.redirect('/login');
});

app.get('/mail', requireAuth, (req, res) => {
  sendNoStore(res, path.join(__dirname, 'public', 'index.html'));
});

// Workforce Intelligence is gated by the separate email+OTP login below
// (hrAuth), not the Google OAuth used for the Mail Management page above -
// director access shouldn't depend on this app's single Gmail account.
app.get('/workforce.html', hrAuth.requireHrAuth, (req, res) => {
  sendNoStore(res, path.join(__dirname, 'public', 'workforce.html'));
});

app.get('/login', (req, res) => {
  sendNoStore(res, path.join(__dirname, 'public', 'login.html'));
});

app.post('/api/hr-auth/request-otp', async (req, res) => {
  const email = hrAuth.normalizeEmail(req.body.email);
  if (!hrAuth.isValidEmail(email)) {
    return res.status(400).json({ error: 'Enter a valid email address' });
  }
  const waitSeconds = hrAuth.checkAndSetResendCooldown(req, res, email);
  if (waitSeconds > 0) {
    return res.status(429).json({ error: 'Please wait before requesting another code', waitSeconds });
  }
  try {
    const code = hrAuth.generateOtp(email);
    await emailService.sendOtpEmail(email, code);
    res.json({ ok: true, cooldownSeconds: Math.round(hrAuth.RESEND_COOLDOWN_MS / 1000) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/hr-auth/verify-otp', (req, res) => {
  const email = hrAuth.normalizeEmail(req.body.email);
  const code = req.body.code;
  if (!hrAuth.isValidEmail(email) || !code) {
    return res.status(400).json({ error: 'Email and code are required' });
  }
  if (hrAuth.tooManyAttempts(req, email)) {
    return res.status(429).json({ error: 'Too many attempts. Request a new code.' });
  }
  if (!hrAuth.verifyOtp(email, code)) {
    hrAuth.recordFailedAttempt(req, res, email);
    return res.status(401).json({ error: 'Incorrect or expired code' });
  }
  hrAuth.createSession(res, email);
  res.json({ ok: true });
});

app.post('/api/hr-auth/logout', (req, res) => {
  hrAuth.destroySession(res);
  res.json({ ok: true });
});

app.get('/api/hr-auth/me', (req, res) => {
  try {
    const session = hrAuth.readSession(req);
    res.json({ email: session ? session.email : null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// max-age: 0 forces the browser to revalidate (conditional GET) every time
// instead of silently serving a stale cached copy of app.js/workforce.js —
// we've hit that exact "my change isn't showing up" issue more than once.
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  lastModified: true,
  cacheControl: true,
  maxAge: 0
}));

app.use('/api/workforce', hrAuth.requireHrAuth, workforceRoutes);

// Read-only equivalents of the old standalone Mail Management page's two
// most useful reports, folded into the HR app's own menu. These still run
// against the admin's existing Gmail OAuth (gmailService) internally - the
// director viewing them doesn't need their own Gmail access, only an
// hr_session from the OTP login above.
app.get('/api/hr/job-applications', hrAuth.requireHrAuth, async (req, res) => {
  const search = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 200) : '';
  try {
    const data = await gmailService.getMessagesByCategory('candidates', { search });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/hr/upcoming-joinings', hrAuth.requireHrAuth, async (req, res) => {
  try {
    const data = await gmailService.getUpcomingJoinings();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use(
  '/vendor/chart.js',
  express.static(path.join(__dirname, 'node_modules', 'chart.js', 'dist'), { maxAge: '7d' })
);

const VALID_CATEGORIES = ['unread', 'important', 'read', 'recent', 'candidates'];

app.get('/api/counts', requireAuth, async (req, res) => {
  try {
    const data = await gmailService.getCounts();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/joinings', requireAuth, async (req, res) => {
  try {
    const data = await gmailService.getUpcomingJoinings();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/messages/:category', requireAuth, async (req, res) => {
  const { category } = req.params;
  if (!VALID_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }
  const search = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 200) : '';
  try {
    const data = await gmailService.getMessagesByCategory(category, { search });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/message/:id', requireAuth, async (req, res) => {
  try {
    const data = await gmailService.getFullMessage(req.params.id);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/message/:id', requireAuth, async (req, res) => {
  try {
    await gmailService.trashMessage(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/reply', requireAuth, async (req, res) => {
  try {
    const { messageId, replyText } = req.body;
    if (!messageId || !replyText) {
      return res.status(400).json({ error: 'messageId and replyText are required' });
    }
    await gmailService.sendReply({ messageId, replyText });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

if (!process.env.VERCEL) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Email dashboard running at http://localhost:${PORT} (and on your LAN IP, port ${PORT})`);
  });
}

module.exports = app;
