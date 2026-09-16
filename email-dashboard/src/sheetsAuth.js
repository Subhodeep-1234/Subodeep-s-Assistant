const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

// Fully independent from src/auth.js (Gmail OAuth) — a service account has
// no consent screen, no refresh-token dance, and can't touch mail at all.
const SERVICE_ACCOUNT_PATH = path.join(__dirname, '..', 'service-account.json');
// Write scope is needed for movementTracker.js's daily snapshot log, which
// lives in its own separate spreadsheet (never Employee_Master) - by
// discipline, not by a technical restriction, since OAuth scope isn't
// per-file: everything reading the HR sheet only ever calls .get, never
// .update/.append/.batchUpdate.
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

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

// Separate scope and client from the Sheets one above - read-only, and
// deliberately never drive.file/drive (write) since this only ever lists
// and links to files someone else uploads (Policy Documents/Employee
// E-Cards - see policyDocumentsService.js), never creates or modifies them.
const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];
let driveClient = null;

function getDriveClient() {
  if (!credentials) {
    throw new Error(
      'Google service account not configured (missing service-account.json locally, ' +
      'or GOOGLE_SERVICE_ACCOUNT_JSON env var in production)'
    );
  }
  if (!driveClient) {
    const auth = new google.auth.GoogleAuth({ credentials, scopes: DRIVE_SCOPES });
    driveClient = google.drive({ version: 'v3', auth });
  }
  return driveClient;
}

module.exports = { getSheetsClient, hasServiceAccount, getDriveClient };
