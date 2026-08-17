const https = require('https');
const { google } = require('googleapis');
const { oauth2Client } = require('./auth');

https.globalAgent.keepAlive = true;

const MAX_RESULTS = 500;
const DISPLAY_LIMIT = 200;
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
  unread: 'in:inbox is:unread',
  important: 'in:inbox is:unread is:important',
  read: 'in:inbox -is:unread',
  recent: 'in:inbox',
  candidates: `in:inbox ${CANDIDATE_KEYWORDS} ${CONSULTANT_EXCLUSIONS}`
};

const JOININGS_WINDOW_DAYS = 365;
const JOININGS_SEARCH_CAP = 300;

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
};

function parseDojString(raw) {
  if (!raw) return null;
  const cleaned = raw.trim();

  const numeric = cleaned.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (numeric) {
    let [, d, m, y] = numeric;
    if (y.length === 2) y = '20' + y;
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    return isNaN(date.getTime()) ? null : date;
  }

  const textual = cleaned.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([A-Za-z]+)\.?,?\s+(\d{4})$/);
  if (textual) {
    const [, d, monthName, y] = textual;
    const monthIndex = MONTHS[monthName.slice(0, 3).toLowerCase()];
    if (monthIndex === undefined) return null;
    const date = new Date(Number(y), monthIndex, Number(d));
    return isNaN(date.getTime()) ? null : date;
  }

  return null;
}

function parseConfirmationMail(bodyTextRaw) {
  // Original offer template consistently bolds "Dear X,", the quoted
  // designation, and the date — plain-text export renders that as *asterisks*.
  const bodyText = bodyTextRaw.replace(/\*/g, '');

  const nameMatch = bodyText.match(/Dear\s+([A-Za-z][A-Za-z.\s]*?)\s*,/i);
  const name = nameMatch ? nameMatch[1].replace(/\s+/g, ' ').trim() : '';

  const designationMatch = bodyText.match(/offer you[^"]*"([^"]+)"/i);
  const designation = designationMatch ? designationMatch[1].replace(/\s+/g, ' ').trim() : '';

  const companyMatch = bodyText.match(/\bat\s+([A-Z][\w&.,\s]*?)\s+on\b/);
  const company = companyMatch ? companyMatch[1].replace(/\s+/g, ' ').trim() : '';

  const dojMatch = bodyText.match(
    /\bon(?:\s+or\s+before)?\s+(\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?[A-Za-z]+\.?,?\s+\d{4})/i
  );
  const dojDate = dojMatch ? parseDojString(dojMatch[1]) : null;

  return { name, designation, company, dojDate };
}

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

function formatCount(ids) {
  // MAX_RESULTS is a pagination cap, not necessarily the true total — be
  // honest that there may be more instead of implying an exact count.
  return ids.length >= MAX_RESULTS ? MAX_RESULTS + '+' : ids.length;
}

async function getCounts() {
  const [emailAddress, unreadIds, importantIds, recentIds, candidateIds] = await Promise.all([
    getSignedInAddress(),
    listMessageIds(CATEGORY_QUERIES.unread),
    listMessageIds(CATEGORY_QUERIES.important),
    listMessageIds(CATEGORY_QUERIES.recent),
    listMessageIds(CATEGORY_QUERIES.candidates)
  ]);

  return {
    emailAddress,
    counts: {
      unread: formatCount(unreadIds),
      important: formatCount(importantIds),
      recent: formatCount(recentIds),
      candidates: formatCount(candidateIds)
    }
  };
}

async function getMessagesByCategory(category, { search = '' } = {}) {
  const baseQuery = CATEGORY_QUERIES[category];
  if (!baseQuery) {
    throw new Error(`Unknown category: ${category}`);
  }
  const query = search ? `${baseQuery} ${search}` : baseQuery;

  const allIds = await listMessageIds(query);
  const total = allIds.length;
  const truncated = total > DISPLAY_LIMIT;
  const ids = allIds.slice(0, DISPLAY_LIMIT);
  const items = await mapWithConcurrency(ids, DETAIL_CONCURRENCY, (m) => getMessageSummary(m.id));
  items.sort((a, b) => new Date(b.date) - new Date(a.date));

  return { category, total, truncated, items };
}

async function getUpcomingJoinings() {
  const client = gmail();
  // Not scoped to in:sent — most originals are sent by HR colleagues
  // (e.g. Ayan Das) and only reach this mailbox as a CC'd copy in Inbox.
  const query = `subject:"Alcove Confirmation" newer_than:${JOININGS_WINDOW_DAYS}d`;
  const ids = await listMessageIds(query, JOININGS_SEARCH_CAP);

  const messages = await mapWithConcurrency(ids, DETAIL_CONCURRENCY, async (m) => {
    const res = await client.users.messages.get({ userId: 'me', id: m.id, format: 'full' });
    return res.data;
  });

  // A thread accumulates Re:/Fwd: replies over time (cancellations, resignation
  // asks, etc.) — only the first message reliably carries the clean offer
  // template, so that's the one we parse.
  const earliestByThread = new Map();
  for (const msg of messages) {
    const internalDate = Number(msg.internalDate);
    const existing = earliestByThread.get(msg.threadId);
    if (!existing || internalDate < existing.internalDate) {
      earliestByThread.set(msg.threadId, { msg, internalDate });
    }
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const threeMonthsOut = new Date(today);
  threeMonthsOut.setMonth(threeMonthsOut.getMonth() + 3);

  const rows = [];
  for (const { msg } of earliestByThread.values()) {
    const headers = msg.payload.headers || [];
    const plainData = findBodyPart(msg.payload, 'text/plain');
    const htmlData = findBodyPart(msg.payload, 'text/html');
    let bodyText;
    if (plainData) bodyText = decodeBase64Url(plainData);
    else if (htmlData) bodyText = stripHtml(decodeBase64Url(htmlData));
    else bodyText = decodeHtmlEntities(msg.snippet || '');

    const parsed = parseConfirmationMail(bodyText);
    if (!parsed.name || !parsed.dojDate) continue;
    if (parsed.dojDate < today || parsed.dojDate > threeMonthsOut) continue;

    rows.push({
      id: msg.id,
      threadId: msg.threadId,
      name: parsed.name,
      designation: parsed.designation,
      company: parsed.company,
      doj: parsed.dojDate.toISOString(),
      subject: headerValue(headers, 'Subject') || '',
      to: headerValue(headers, 'To') || ''
    });
  }

  rows.sort((a, b) => new Date(a.doj) - new Date(b.doj));
  return { total: rows.length, items: rows };
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

module.exports = { getCounts, getMessagesByCategory, getFullMessage, sendReply, trashMessage, getUpcomingJoinings };
