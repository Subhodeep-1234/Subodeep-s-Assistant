const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const TOKEN_PATH = path.join(__dirname, '..', 'token.json');
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
  if (fs.existsSync(TOKEN_PATH)) {
    const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
    oauth2Client.setCredentials(tokens);
  }
}

oauth2Client.on('tokens', (tokens) => {
  const existing = fs.existsSync(TOKEN_PATH)
    ? JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'))
    : {};
  fs.writeFileSync(TOKEN_PATH, JSON.stringify({ ...existing, ...tokens }, null, 2));
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
}

function isAuthenticated() {
  return fs.existsSync(TOKEN_PATH);
}

module.exports = { oauth2Client, getAuthUrl, handleCallback, isAuthenticated };
