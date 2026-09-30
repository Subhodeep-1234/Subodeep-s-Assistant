// Real AI provider - Claude with tool calling, wired to tools.js so
// Claude decides WHICH function to call from natural language and this
// file executes the real one. Inactive until ANTHROPIC_API_KEY is set
// (see provider.js, which is the only thing that imports this file, and
// only does so inside its own "if key is set" branch - so this module
// never even loads, let alone runs a network call, when no key exists).
//
// Deliberately plain fetch() against the REST API, not the @anthropic-ai
// SDK - avoids adding a dependency for a feature that's inactive until
// you paste in a key.
//
// SECURITY: the key is read from process.env only, inside this
// server-side module. It is never logged, never included in any
// response sent to the browser, and this file has no code path that
// could leak it into the { reply, card, actions } shape the client
// receives.
const tools = require('./tools');
const toolCallLog = require('./toolCallLog');

const API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const MAX_TOKENS = 1024;

const SYSTEM_PROMPT =
  'Match the language and script of the user\'s most recent message only, never an earlier one. ' +
  'You are the HR Assistant, an AI agent built into this company\'s internal Workforce ' +
  'Intelligence platform. Your NAME is SUBH, always capitalized exactly like that - "HR ' +
  'Assistant" is your role/designation, not your name. If asked who or what you are, say ' +
  'something like "I\'m SUBH, your HR Assistant." Refer to yourself as SUBH naturally where ' +
  'it fits in conversation, but do not force the name into every reply. ' +
  'You help HR staff and managers get reports, employee data, and ' +
  'perform HR tasks by calling the tools you\'re given. ' +
  'You have direct access to real employee records, not just summaries: list_employees ' +
  'returns an actual filtered, sorted list of employees (Emp Code, Name, Designation, ' +
  'Department, Status, DOJ), and group_employees returns counts grouped by any field. Never ' +
  'say you lack access to employee lists or can\'t filter/list employees - use these tools. ' +
  'You must call a tool on every turn, including this one - there is no way to reply without ' +
  'calling one. If the message is just a greeting, thanks, or anything with no real HR ' +
  'question in it, call no_data_needed. Never state a specific name, number, or date unless ' +
  'it came from a tool result in this exchange - if a tool returns an empty or missing result, ' +
  'say plainly that there is no data for that, and do not fill the gap with a plausible-sounding ' +
  'guess. ' +
  'If a tool result includes unmatchedFilters, one of the values you passed (e.g. a department ' +
  'or designation) does not match anything real in the data at all - do NOT report a count of 0 ' +
  'as if it were a real answer. Say plainly that you could not find that value, and mention a ' +
  'few of the real values from validValues so the person can correct their request (or retry the ' +
  'tool yourself with the closest one if it is obvious which they meant). If a tool result has no ' +
  'unmatchedFilters but genuinely no matching rows (its note says so), that IS a real answer - say ' +
  'plainly that nothing matches those filters, as a normal [[PLAIN]] reply. ' +
  'Keep replies short and professional. Every reply must start with exactly one marker (it will ' +
  'be removed before the person sees it): [[PLAIN]] if they asked a simple factual question - a ' +
  'single value, date, name or count - then state ONLY that value in one short line, nothing ' +
  'else, no surrounding details even if the tool result has more; or [[CARD]] if they asked for ' +
  'a list, table, breakdown, trend or analysis - then give a short one-line intro only, since ' +
  'the structured data itself is shown in a separate card below your reply, so do not repeat ' +
  'numbers or lists in your own reply text. Decide by what was actually asked, not by which ' +
  'tool you happened to call - the same tool can serve either kind of question. ' +
  'You are read-only: every tool available to you only retrieves or navigates, never creates, ' +
  'sends, modifies or deletes anything. If someone asks for something no tool covers, say so ' +
  'plainly rather than guessing. ' +
  'Report titles, card labels, table rows and employee data always stay in English exactly ' +
  'as the tools return them.';

// One entry per tools.js function actually exposed to Claude. Kept
// separate from tools.js's own exports (rather than generating this from
// them) because the JSON Schema each tool needs is a decision about the
// AI's own interface, not about the function itself.
const TOOL_DEFS = [
  {
    name: 'get_department_headcount',
    description: 'Get active employee headcount broken down by department.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'get_location_headcount',
    description: 'Get active employee headcount broken down by work location/site.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'get_doer_headcount',
    description: 'Get active employee headcount broken down by Reporting DOER (the operational reporting-manager field used for this).',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'get_joining_this_month',
    description: 'List employees who joined in the current calendar month.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'get_joining_trend',
    description: 'Get the joining count trend for the last 12 months.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'get_pending_confirmations',
    description: 'List employees whose probation confirmation is due this month or next month.',
    input_schema: {
      type: 'object',
      properties: { monthOffset: { type: 'integer', enum: [0, 1], description: '0 = this month, 1 = next month' } }
    }
  },
  {
    name: 'get_retirement_this_month',
    description: 'List employees reaching retirement age (58) this month.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'get_birthdays_this_month',
    description: 'List employees (active and notice period) with a birthday this calendar month, sorted by day.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'get_workforce_movement',
    description: 'Get a summary of department transfers, promotions, company transfers and location transfers over a recent period.',
    input_schema: {
      type: 'object',
      properties: { days: { type: 'integer', description: 'How many days back to look, e.g. 90 for the last 3 months.' } }
    }
  },
  {
    name: 'get_health_insurance_pending_additions',
    description: 'List employees/family members pending addition to the health insurance policy.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'get_insurance_status',
    description: 'Get a named employee\'s health insurance coverage status and how many family members are covered. Never mentions premium or sum-insured amounts - those stay out of chat.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'The employee\'s name, as mentioned by the user.' } },
      required: ['name']
    }
  },
  {
    name: 'get_data_quality_issues',
    description: 'Get a summary of data quality issues in employee records (missing fields, duplicate IDs).',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'get_insights',
    description: 'Get a list of automatically generated workforce insights (top department, top location, upcoming birthdays, etc).',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'get_demographics',
    description: 'Get a breakdown of active employees by age, gender, collar category (White/Blue/Group-D), or tenure (time at this company, bucketed, with the average).',
    input_schema: {
      type: 'object',
      properties: { kind: { type: 'string', enum: ['age', 'gender', 'collar', 'tenure'] } },
      required: ['kind']
    }
  },
  {
    name: 'find_employee',
    description: 'Search for an employee by name or employee ID.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Name or employee ID to search for.' } },
      required: ['query']
    }
  },
  {
    name: 'get_direct_reports',
    description: 'List employees who report to a named manager or Reporting DOER (their direct team) - use for "who reports to X" or "who\'s on X\'s team".',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'The manager/DOER\'s name, as mentioned by the user.' } },
      required: ['name']
    }
  },
  {
    name: 'get_employee_detail',
    description: 'Get a single named employee\'s profile: Employee ID, Designation, Department, Status, Date of Birth, Tenure, Total Experience, Reporting Manager. This tool never returns and you must never claim to have Aadhar, PAN, contact number, address, bank details, UAN, ESI number or email - those are excluded entirely, permanently, by design.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'The employee\'s name or ID, as mentioned by the user.' } },
      required: ['name']
    }
  },
  {
    name: 'list_employees',
    description: 'Get an actual filtered, sortable list of individual employees (Emp Code, Name, Designation, Department, Status, DOJ) - use this whenever someone wants to SEE the employees themselves, not just a count (e.g. "list the engineers in Civil", "show me everyone who joined last quarter", "who is in the Sales department"). You DO have access to employee lists via this tool - never say you don\'t. The full list is already shown in the results card below your reply - do not repeat it as a table in your own text, just a short one-line summary.',
    input_schema: {
      type: 'object',
      properties: {
        designation: { type: 'string', description: 'Substring match on designation/title, e.g. "engineer" matches Engineer, Jr. Engineer, Senior Engineer, etc.' },
        department: { type: 'string', description: 'Exact department name.' },
        status: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'NOTICE PERIOD'] },
        dateFrom: { type: 'string', description: 'Joining date range start, YYYY-MM-DD.' },
        dateTo: { type: 'string', description: 'Joining date range end, YYYY-MM-DD.' },
        q: { type: 'string', description: 'Free-text search across name, employee ID, email, department, designation, location.' },
        tenureYearsMin: { type: 'number', description: 'Minimum years at this company (tenure), e.g. 5 for "5+ years with us".' },
        tenureYearsMax: { type: 'number', description: 'Maximum years at this company (tenure).' },
        experienceYearsMin: { type: 'number', description: 'Minimum total career experience in years, e.g. 10 for "10+ years experience".' },
        experienceYearsMax: { type: 'number', description: 'Maximum total career experience in years.' },
        sortBy: { type: 'string', enum: ['name', 'employeeId', 'designation', 'department', 'doj'] },
        sortDir: { type: 'string', enum: ['asc', 'desc'] },
        limit: { type: 'integer', description: 'Max rows to return (default 50, max 200).' }
      }
    }
  },
  {
    name: 'group_employees',
    description: 'Count employees grouped by one field (department, designation, status, location, gender, or category), optionally filtered first - use this for "how many X per Y" questions that don\'t match an existing preset report, e.g. "how many engineers per department".',
    input_schema: {
      type: 'object',
      properties: {
        groupBy: { type: 'string', enum: ['department', 'designation', 'status', 'location', 'gender', 'collar'] },
        designation: { type: 'string', description: 'Substring match on designation/title to filter by first, e.g. "engineer".' },
        department: { type: 'string' },
        status: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'NOTICE PERIOD'] },
        dateFrom: { type: 'string', description: 'Joining date range start, YYYY-MM-DD.' },
        dateTo: { type: 'string', description: 'Joining date range end, YYYY-MM-DD.' },
        q: { type: 'string', description: 'Free-text search to filter by first.' },
        tenureYearsMin: { type: 'number', description: 'Minimum years at this company (tenure), to filter by first.' },
        tenureYearsMax: { type: 'number', description: 'Maximum years at this company (tenure), to filter by first.' },
        experienceYearsMin: { type: 'number', description: 'Minimum total career experience in years, to filter by first.' },
        experienceYearsMax: { type: 'number', description: 'Maximum total career experience in years, to filter by first.' }
      },
      required: ['groupBy']
    }
  },
  {
    name: 'prepare_letter',
    description: 'Prepare a promotion/increment, increment-only, or confirmation letter for a named employee, ready to open in the Letter Generator.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The employee\'s name, as mentioned by the user.' },
        letterType: { type: 'string', enum: ['promotion', 'increment', 'confirmation'] }
      },
      required: ['name', 'letterType']
    }
  },
  {
    name: 'navigate_to_view',
    description: 'Open an existing section of the app for the user (use this for requests like "show the organization chart" that are really just navigation, not a data report).',
    input_schema: {
      type: 'object',
      properties: { view: { type: 'string', enum: Object.keys(tools.NAVIGABLE_VIEWS) } },
      required: ['view']
    }
  },
  {
    name: 'no_data_needed',
    description: 'Call this when the message is a greeting, thanks, small talk, or any other message with no real HR question in it that no other tool covers. Returns nothing - just lets you reply conversationally without inventing data.',
    input_schema: { type: 'object', properties: {} }
  }
];

// Maps a tool_use name back to the real tools.js function + how to pull
// its arguments out of Claude's own (already-validated-by-schema) input.
const TOOL_RUNNERS = {
  get_department_headcount: () => tools.departmentHeadcount(),
  get_location_headcount: () => tools.locationHeadcount(),
  get_doer_headcount: () => tools.doerHeadcount(),
  get_joining_this_month: () => tools.joiningThisMonth(),
  get_joining_trend: () => tools.joiningTrend(),
  get_pending_confirmations: (input) => tools.pendingConfirmations(input.monthOffset || 0),
  get_retirement_this_month: () => tools.retirementThisMonth(),
  get_birthdays_this_month: () => tools.birthdaysThisMonth(),
  get_workforce_movement: (input) => tools.workforceMovement(input.days || 90),
  get_health_insurance_pending_additions: () => tools.healthInsurancePendingAdditions(),
  get_insurance_status: (input) => tools.insuranceStatus(input.name),
  get_data_quality_issues: () => tools.dataQualityIssues(),
  get_insights: () => tools.insightsSummary(),
  get_demographics: (input) => tools.demographics(input.kind),
  find_employee: (input) => tools.findEmployee(input.query),
  get_direct_reports: (input) => tools.directReports(input.name),
  get_employee_detail: (input) => tools.employeeDetail(input.name),
  list_employees: (input) => tools.listEmployees(input),
  group_employees: (input) => tools.groupEmployees(input, input.groupBy),
  prepare_letter: (input) => tools.prepareLetter({ name: input.name, letterType: input.letterType }),
  navigate_to_view: (input) => tools.navigateToView(input.view),
  no_data_needed: () => ({ title: null, rows: null, actions: null })
};

// The language rule lives in SYSTEM_PROMPT's first line, but earlier turns
// in `history` are real examples of whatever language they happened to be
// in - the model can end up pattern-matching the conversation's dominant
// language instead of the latest message (confirmed live: a run of
// Banglish turns dragged a later plain-English message into a Banglish
// reply). Restating the rule as a second content block directly attached
// to the CURRENT user message, right where the model is about to answer,
// counters that recency/majority bias without touching how the message
// itself is stored or displayed anywhere else.
const LANGUAGE_REMINDER = 'Reminder: match the language and script of the message below only.';

function toClaudeMessages(history, message) {
  const msgs = (history || [])
    .filter((h) => h && h.text)
    .map((h) => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: h.text }));
  msgs.push({
    role: 'user',
    content: [
      { type: 'text', text: LANGUAGE_REMINDER },
      { type: 'text', text: message }
    ]
  });
  return msgs;
}

async function callClaude(apiKey, messages, forceToolCall) {
  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json'
    },
    body: JSON.stringify(Object.assign(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        tools: TOOL_DEFS,
        messages
      },
      // Forced on the FIRST call only - closes the hallucination hole: the
      // model physically cannot skip straight to a text answer (and invent
      // a name/number) without going through a real tool first, not even
      // for greetings/small talk (no_data_needed covers those). The
      // follow-up call, after it's already seen the real tool result, is
      // left unset (defaults to 'auto') so it can just answer in text.
      forceToolCall ? { tool_choice: { type: 'any' } } : {}
    ))
  });
  if (!resp.ok) {
    const bodyText = await resp.text().catch(() => '');
    throw new Error('Claude API error ' + resp.status + (bodyText ? ': ' + bodyText.slice(0, 200) : ''));
  }
  return resp.json();
}

function extractText(content) {
  return (content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join(' ')
    .trim();
}

// The system prompt requires every reply to start with a [[PLAIN]] or
// [[CARD]] marker (stripped before the person ever sees it) - this is how
// the model tells us whether it answered a simple factual question (in
// which case the tool's card/buttons are suppressed entirely, even though
// the tool itself returned them, since the SAME tool serves both a "what
// is X's DOB" question and a "show me everyone in X" question) or a
// list/report request (card and buttons shown as the tool built them).
// Falls back to showing the card if the marker is missing/unrecognised -
// erring toward showing real data rather than silently hiding it.
const REPLY_MARKER_RE = /^\s*\[\[(PLAIN|CARD)\]\]\s*/;

function finalizeReply(rawContent, card, actions, fallbackText) {
  const raw = rawContent || '';
  const match = raw.match(REPLY_MARKER_RE);
  const isPlain = Boolean(match && match[1] === 'PLAIN');
  const cleaned = (match ? raw.slice(match[0].length) : raw).trim();
  return {
    reply: cleaned || fallbackText,
    card: isPlain ? null : card,
    actions: isPlain ? null : actions
  };
}

async function getResponse({ message, history, user }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // provider.js is only supposed to reach this file when a key exists,
    // but this guard makes that assumption impossible to violate silently.
    throw new Error('claudeProvider.getResponse called without ANTHROPIC_API_KEY set');
  }

  const messages = toClaudeMessages(history, message);
  let data = await callClaude(apiKey, messages, true);

  // At most one tool round-trip - every tool here is a single, direct
  // lookup with no reason for Claude to chain multiple calls together;
  // capping it keeps latency and cost bounded and avoids ever looping.
  if (data.stop_reason === 'tool_use') {
    const toolUseBlock = data.content.find((b) => b.type === 'tool_use');
    const runner = toolUseBlock && TOOL_RUNNERS[toolUseBlock.name];
    // Audit log: which tool, when, for whom - never the data it returns
    // (see toolCallLog.js). Logged regardless of whether the tool name
    // resolved, so an unrecognised tool_use attempt is visible too.
    toolCallLog.recordToolCall({
      email: user && user.email,
      provider: 'claude',
      toolName: toolUseBlock && toolUseBlock.name,
      params: (toolUseBlock && toolUseBlock.input) || {}
    });
    let toolResult;
    let card = null;
    let actions = null;
    try {
      toolResult = runner ? await runner(toolUseBlock.input || {}) : { error: 'Unknown tool: ' + toolUseBlock.name };
      if (toolResult && !toolResult.error) {
        card = toolResult.title
          ? {
              title: toolResult.title,
              rows: toolResult.rows || null,
              columns: toolResult.columns || null,
              tableRows: toolResult.tableRows || null,
              footer: toolResult.footer || null,
              note: toolResult.note || null
            }
          : null;
        actions = toolResult.actions || null;
      }
    } catch (err) {
      toolResult = { error: err.message };
    }

    const followUpMessages = messages.concat([
      { role: 'assistant', content: data.content },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: toolUseBlock.id, content: JSON.stringify(toolResult).slice(0, 4000) }]
      }
    ]);
    data = await callClaude(apiKey, followUpMessages);
    return finalizeReply(extractText(data.content), card, actions, 'Here you go.');
  }

  return finalizeReply(extractText(data.content), null, null, "I'm not sure how to help with that yet.");
}

module.exports = { getResponse };
