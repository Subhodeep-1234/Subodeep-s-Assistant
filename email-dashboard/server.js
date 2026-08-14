require('dotenv').config();
const express = require('express');
const path = require('path');
const { getAuthUrl, handleCallback, isAuthenticated } = require('./src/auth');
const gmailService = require('./src/gmailService');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

function requireAuth(req, res, next) {
  if (!isAuthenticated()) {
    return res.redirect('/auth');
  }
  next();
}

app.get('/auth', (req, res) => {
  res.redirect(getAuthUrl());
});

app.get('/oauth2callback', async (req, res) => {
  try {
    await handleCallback(req.query.code);
    res.redirect('/');
  } catch (err) {
    res.status(500).send('Authentication failed: ' + err.message);
  }
});

app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

const VALID_CATEGORIES = ['unread', 'important', 'read', 'recent', 'candidates'];

app.get('/api/counts', requireAuth, async (req, res) => {
  try {
    const data = await gmailService.getCounts();
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
  const scope = req.query.scope === 'all' ? 'all' : 'default';
  const search = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 200) : '';
  try {
    const data = await gmailService.getMessagesByCategory(category, { scope, search });
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Email dashboard running at http://localhost:${PORT} (and on your LAN IP, port ${PORT})`);
});
