const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

// Fully independent from src/auth.js (Gmail OAuth) — a service account has
// no consent screen, no refresh-token dance, and can't touch mail at all.
const SERVICE_ACCOUNT_PATH = path.join(__dirname, '..', 'service-account.json');
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];

function loadCredentials() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  }
  if (fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    return JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
  }
  return null;
}

const credentials = loadCredentials();

function hasServiceAccount() {
  return Boolean(credentials);
}

// A single long-lived auth client + Sheets client, reused across every call.
// GoogleAuth caches its access token internally and only re-mints it near
// expiry — creating a fresh instance per request (the previous approach)
// threw that caching away and paid for a full token exchange every time.
let sheetsClient = null;

function getSheetsClient() {
  if (!credentials) {
    throw new Error(
      'Google service account not configured (missing service-account.json locally, ' +
      'or GOOGLE_SERVICE_ACCOUNT_JSON env var in production)'
    );
  }
  if (!sheetsClient) {
    const auth = new google.auth.GoogleAuth({ credentials, scopes: SCOPES });
    sheetsClient = google.sheets({ version: 'v4', auth });
  }
  return sheetsClient;
}

module.exports = { getSheetsClient, hasServiceAccount };
