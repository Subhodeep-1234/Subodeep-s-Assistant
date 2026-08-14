const fs = require('fs');
const os = require('os');
const path = require('path');
const { google } = require('googleapis');

// Vercel's filesystem is read-only outside /tmp, and /tmp itself doesn't
// persist across invocations — so on Vercel we rely on GOOGLE_REFRESH_TOKEN
// (set in the project's environment variables) instead of a token file.
const IS_SERVERLESS = Boolean(process.env.VERCEL);
const TOKEN_PATH = IS_SERVERLESS
  ? path.join(os.tmpdir(), 'token.json')
  : path.join(__dirname, '..', 'token.json');
const CREDENTIALS_PATH = path.join(__dirname, '..', 'credentials.json');

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send'
];

function loadClientCredentials() {
  if (fs.existsSync(CREDENTIALS_PATH)) {
    const raw = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
    const creds = raw.web || raw.installed;
    return {
      clientId: creds.client_id,
      clientSecret: creds.client_secret,
      redirectUri:
        process.env.GOOGLE_REDIRECT_URI ||
        (creds.redirect_uris && creds.redirect_uris[0]) ||
        'http://localhost:3000/oauth2callback'
    };
  }
  return {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI
  };
}

const { clientId, clientSecret, redirectUri } = loadClientCredentials();

const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

function loadStoredTokens() {
  if (process.env.GOOGLE_REFRESH_TOKEN) {
    oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    return;
  }
  if (fs.existsSync(TOKEN_PATH)) {
    const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
    oauth2Client.setCredentials(tokens);
  }
}

oauth2Client.on('tokens', (tokens) => {
  try {
    const existing = fs.existsSync(TOKEN_PATH)
      ? JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'))
      : {};
    fs.writeFileSync(TOKEN_PATH, JSON.stringify({ ...existing, ...tokens }, null, 2));
  } catch {
    // Best-effort cache only (e.g. read-only filesystem) — refresh_token
    // from GOOGLE_REFRESH_TOKEN remains the source of truth.
  }
});

loadStoredTokens();

function getAuthUrl() {
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES
  });
}

async function handleCallback(code) {
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  return tokens;
}

function isAuthenticated() {
  return Boolean(process.env.GOOGLE_REFRESH_TOKEN) || fs.existsSync(TOKEN_PATH);
}

module.exports = { oauth2Client, getAuthUrl, handleCallback, isAuthenticated };
