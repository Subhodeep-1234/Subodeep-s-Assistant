require('dotenv').config();
const express = require('express');
const path = require('path');
const { getAuthUrl, handleCallback, isAuthenticated, getConfigStatus } = require('./src/auth');
const gmailService = require('./src/gmailService');
const workforceRoutes = require('./src/workforceRoutes');

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
    res.redirect('/');
  } catch (err) {
    res.status(500).send('Authentication failed: ' + err.message);
  }
});

app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/workforce.html', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'workforce.html'));
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

app.use('/api/workforce', requireAuth, workforceRoutes);

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
