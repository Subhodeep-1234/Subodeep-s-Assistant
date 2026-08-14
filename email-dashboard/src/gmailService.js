const https = require('https');
const { google } = require('googleapis');
const { oauth2Client } = require('./auth');

https.globalAgent.keepAlive = true;

const WINDOW_DAYS = 30;
const MAX_RESULTS = 500;
const LIST_LIMIT = 50;
const ALL_LIST_LIMIT = 200;
const DETAIL_CONCURRENCY = 20;

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const CANDIDATE_KEYWORDS =
  '(subject:CV OR subject:CVs OR subject:resume OR subject:résumé OR subject:candidate ' +
  'OR subject:vacancy OR subject:"job application" OR subject:"applying for" ' +
  'OR subject:"application for" OR subject:interview)';

// Excludes CVs forwarded by recruitment/staffing agencies and internal company
// threads, so this tab shows only mail sent directly by the applicant.
const CONSULTANT_EXCLUSIONS =
  '-from:caliberassociates -from:omplacement -from:jhr -from:ongrid -from:alcoverealty.in';

const CATEGORY_QUERIES = {
  unread: (q) => `in:inbox is:unread ${q}`,
  important: (q) => `in:inbox is:unread is:important ${q}`,
  read: (q) => `in:inbox -is:unread ${q}`,
  recent: (q) => `in:inbox ${q}`,
  candidates: (q) => `in:inbox ${q} ${CANDIDATE_KEYWORDS} ${CONSULTANT_EXCLUSIONS}`
};

function gmail() {
  return google.gmail({ version: 'v1', auth: oauth2Client });
}

function headerValue(headers, name) {
  const header = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return header ? header.value : '';
}

function extractEmailAddress(fromHeader) {
  const match = fromHeader.match(/<([^>]+)>/);
  return match ? match[1] : fromHeader.trim();
}

function decodeHtmlEntities(text) {
  if (!text) return text;
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&');
}

async function listMessageIds(query, cap = MAX_RESULTS) {
  const client = gmail();
  let ids = [];
  let pageToken;
  do {
    const res = await client.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: Math.min(500, cap - ids.length),
      pageToken
    });
    if (res.data.messages) ids = ids.concat(res.data.messages);
    pageToken = res.data.nextPageToken;
  } while (pageToken && ids.length < cap);
  return ids;
}

async function getMessageSummary(id) {
  const client = gmail();
  const res = await client.users.messages.get({
    userId: 'me',
    id,
    format: 'metadata',
    metadataHeaders: ['Subject', 'From', 'Date']
  });
  const headers = res.data.payload.headers || [];
  const labelIds = res.data.labelIds || [];
  return {
    id: res.data.id,
    threadId: res.data.threadId,
    subject: headerValue(headers, 'Subject') || '(no subject)',
    from: headerValue(headers, 'From'),
    date: headerValue(headers, 'Date'),
    snippet: decodeHtmlEntities(res.data.snippet || ''),
    important: labelIds.includes('IMPORTANT'),
    unread: labelIds.includes('UNREAD')
  };
}

async function getSignedInAddress() {
  const client = gmail();
  const res = await client.users.getProfile({ userId: 'me' });
  return res.data.emailAddress;
}

async function getCounts() {
  const q = `newer_than:${WINDOW_DAYS}d`;
  const [emailAddress, unreadIds, importantIds, recentIds, candidateIds] = await Promise.all([
    getSignedInAddress(),
    listMessageIds(CATEGORY_QUERIES.unread(q)),
    listMessageIds(CATEGORY_QUERIES.important(q)),
    listMessageIds(CATEGORY_QUERIES.recent(q)),
    listMessageIds(CATEGORY_QUERIES.candidates(q))
  ]);

  return {
    emailAddress,
    windowDays: WINDOW_DAYS,
    counts: {
      unread: unreadIds.length,
      important: importantIds.length,
      recent: recentIds.length,
      candidates: candidateIds.length
    }
  };
}

async function getMessagesByCategory(category, { scope = 'default', search = '' } = {}) {
  const buildQuery = CATEGORY_QUERIES[category];
  if (!buildQuery) {
    throw new Error(`Unknown category: ${category}`);
  }
  const q = scope === 'all' ? '' : `newer_than:${WINDOW_DAYS}d`;
  let query = buildQuery(q).trim();
  if (search) query += ' ' + search;

  const limit = scope === 'all' ? ALL_LIST_LIMIT : LIST_LIMIT;
  const allIds = await listMessageIds(query);
  const total = allIds.length;
  const truncated = total > limit;
  const ids = allIds.slice(0, limit);
  const items = await mapWithConcurrency(ids, DETAIL_CONCURRENCY, (m) => getMessageSummary(m.id));
  items.sort((a, b) => new Date(b.date) - new Date(a.date));

  return { category, scope, total, truncated, items };
}

function decodeBase64Url(data) {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function findBodyPart(payload, mimeType) {
  if (!payload) return null;
  if (payload.mimeType === mimeType && payload.body && payload.body.data) {
    return payload.body.data;
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      const found = findBodyPart(part, mimeType);
      if (found) return found;
    }
  }
  return null;
}

function stripHtml(html) {
  const withoutTags = html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '');
  return decodeHtmlEntities(withoutTags)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function getFullMessage(id) {
  const client = gmail();
  const res = await client.users.messages.get({
    userId: 'me',
    id,
    format: 'full'
  });
  const headers = res.data.payload.headers || [];
  const plainData = findBodyPart(res.data.payload, 'text/plain');
  const htmlData = findBodyPart(res.data.payload, 'text/html');

  let bodyText;
  if (plainData) {
    bodyText = decodeBase64Url(plainData);
  } else if (htmlData) {
    bodyText = stripHtml(decodeBase64Url(htmlData));
  } else {
    bodyText = decodeHtmlEntities(res.data.snippet) || '(no content)';
  }

  return {
    id: res.data.id,
    threadId: res.data.threadId,
    subject: headerValue(headers, 'Subject') || '(no subject)',
    from: headerValue(headers, 'From'),
    date: headerValue(headers, 'Date'),
    bodyText
  };
}

function encodeHeaderText(text) {
  if (/^[\x00-\x7F]*$/.test(text)) return text;
  return '=?UTF-8?B?' + Buffer.from(text, 'utf8').toString('base64') + '?=';
}

function buildRawReply({ to, subject, origMessageId, references, replyText }) {
  const replySubject = /^re:/i.test(subject) ? subject : `Re: ${subject}`;
  const refs = [references, origMessageId].filter(Boolean).join(' ');
  const bodyBase64 = Buffer.from(replyText, 'utf8').toString('base64');
  const lines = [
    `To: ${to}`,
    `Subject: ${encodeHeaderText(replySubject)}`,
    `In-Reply-To: ${origMessageId}`,
    `References: ${refs}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    bodyBase64
  ];
  return Buffer.from(lines.join('\r\n'))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function sendReply({ messageId, replyText }) {
  const client = gmail();
  const original = await client.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'metadata',
    metadataHeaders: ['Subject', 'From', 'Message-ID', 'References']
  });
  const headers = original.data.payload.headers || [];
  const to = extractEmailAddress(headerValue(headers, 'From'));
  const subject = headerValue(headers, 'Subject');
  const origMessageId = headerValue(headers, 'Message-ID');
  const references = headerValue(headers, 'References');
  const threadId = original.data.threadId;

  const raw = buildRawReply({ to, subject, origMessageId, references, replyText });

  await client.users.messages.send({
    userId: 'me',
    requestBody: { raw, threadId }
  });

  await client.users.threads.modify({
    userId: 'me',
    id: threadId,
    requestBody: { removeLabelIds: ['UNREAD'] }
  });
}

async function trashMessage(id) {
  const client = gmail();
  await client.users.messages.trash({ userId: 'me', id });
}

module.exports = { getCounts, getMessagesByCategory, getFullMessage, sendReply, trashMessage };
