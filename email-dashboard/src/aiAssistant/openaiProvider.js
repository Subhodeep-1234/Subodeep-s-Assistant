// Real AI provider - OpenAI with tool (function) calling, wired to
// tools.js exactly like claudeProvider.js: OpenAI decides WHICH function
// to call from natural language and this file executes the real one.
// Inactive unless provider.js picks it (see provider.js, which is the
// only thing that imports this file, and only does so inside its own
// "if this is the chosen provider" branch - so this module never even
// loads, let alone makes a network call, otherwise).
//
// Deliberately plain fetch() against the REST API, not the openai SDK -
// avoids adding a dependency for a feature that's inactive until you
// paste in a key.
//
// SECURITY: the key is read from process.env only, inside this
// server-side module. It is never logged, never included in any
// response sent to the browser, and this file has no code path that
// could leak it into the { reply, card, actions } shape the client
// receives.
const tools = require('./tools');
const toolCallLog = require('./toolCallLog');

const API_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const MAX_TOKENS = 1024;

const SYSTEM_PROMPT =
  'Reply in the same language AND script (native or romanized/transliterated) as the user\'s ' +
  'most recent message only, ignoring what language or script earlier messages in this ' +
  'conversation used - never switch a romanized message into native script, or a native-script ' +
  'message into romanized, and never let an earlier message\'s language carry over. ' +
  'You are the HR Assistant, an AI agent built into this company\'s internal Workforce ' +
  'Intelligence platform. You help HR staff and managers get reports, employee data, and ' +
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
  'Keep replies short and professional (1-2 sentences) - the structured data itself is shown ' +
  'in a separate card, so do not repeat numbers or lists in your own reply. ' +
  'You are read-only: every tool available to you only retrieves or navigates, never creates, ' +
  'sends, modifies or deletes anything. If someone asks for something no tool covers, say so ' +
  'plainly rather than guessing. ' +
  'Report titles, card labels, table rows and employee data always stay in English exactly ' +
  'as the tools return them, regardless of what language your own reply is in.';

// One entry per tools.js function actually exposed to OpenAI, mirroring
// claudeProvider.js's TOOL_DEFS one-for-one, just reshaped into OpenAI's
// function-calling schema (parameters instead of input_schema, and each
// wrapped in a {type:'function', function:{...}} envelope).
const TOOL_DEFS = [
  {
    type: 'function',
    function: {
      name: 'get_department_headcount',
      description: 'Get active employee headcount broken down by department.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_location_headcount',
      description: 'Get active employee headcount broken down by work location/site.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_doer_headcount',
      description: 'Get active employee headcount broken down by Reporting DOER (the operational reporting-manager field used for this).',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_joining_this_month',
      description: 'List employees who joined in the current calendar month.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_joining_trend',
      description: 'Get the joining count trend for the last 12 months.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_pending_confirmations',
      description: 'List employees whose probation confirmation is due this month or next month.',
      parameters: {
        type: 'object',
        properties: { monthOffset: { type: 'integer', enum: [0, 1], description: '0 = this month, 1 = next month' } }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_retirement_this_month',
      description: 'List employees reaching retirement age (58) this month.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_birthdays_this_month',
      description: 'List employees (active and notice period) with a birthday this calendar month, sorted by day.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_workforce_movement',
      description: 'Get a summary of department transfers, promotions, company transfers and location transfers over a recent period.',
      parameters: {
        type: 'object',
        properties: { days: { type: 'integer', description: 'How many days back to look, e.g. 90 for the last 3 months.' } }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_health_insurance_pending_additions',
      description: 'List employees/family members pending addition to the health insurance policy.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_insurance_status',
      description: 'Get a named employee\'s health insurance coverage status and how many family members are covered. Never mentions premium or sum-insured amounts - those stay out of chat.',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: 'The employee\'s name, as mentioned by the user.' } },
        required: ['name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_data_quality_issues',
      description: 'Get a summary of data quality issues in employee records (missing fields, duplicate IDs).',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_insights',
      description: 'Get a list of automatically generated workforce insights (top department, top location, upcoming birthdays, etc).',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_demographics',
      description: 'Get a breakdown of active employees by age, gender, collar category (White/Blue/Group-D), or tenure (time at this company, bucketed, with the average).',
      parameters: {
        type: 'object',
        properties: { kind: { type: 'string', enum: ['age', 'gender', 'collar', 'tenure'] } },
        required: ['kind']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'find_employee',
      description: 'Search for an employee by name or employee ID.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Name or employee ID to search for.' } },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_direct_reports',
      description: 'List employees who report to a named manager or Reporting DOER (their direct team) - use for "who reports to X" or "who\'s on X\'s team".',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: 'The manager/DOER\'s name, as mentioned by the user.' } },
        required: ['name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_employees',
      description: 'Get an actual filtered, sortable list of individual employees (Emp Code, Name, Designation, Department, Status, DOJ) - use this whenever someone wants to SEE the employees themselves, not just a count (e.g. "list the engineers in Civil", "show me everyone who joined last quarter", "who is in the Sales department"). You DO have access to employee lists via this tool - never say you don\'t. The full list is already shown in the results card below your reply - do not repeat it as a table in your own text, just a short one-line summary.',
      parameters: {
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
    }
  },
  {
    type: 'function',
    function: {
      name: 'group_employees',
      description: 'Count employees grouped by one field (department, designation, status, location, gender, or category), optionally filtered first - use this for "how many X per Y" questions that don\'t match an existing preset report, e.g. "how many engineers per department".',
      parameters: {
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
    }
  },
  {
    type: 'function',
    function: {
      name: 'prepare_letter',
      description: 'Prepare a promotion/increment, increment-only, or confirmation letter for a named employee, ready to open in the Letter Generator.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The employee\'s name, as mentioned by the user.' },
          letterType: { type: 'string', enum: ['promotion', 'increment', 'confirmation'] }
        },
        required: ['name', 'letterType']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'navigate_to_view',
      description: 'Open an existing section of the app for the user (use this for requests like "show the organization chart" that are really just navigation, not a data report).',
      parameters: {
        type: 'object',
        properties: { view: { type: 'string', enum: Object.keys(tools.NAVIGABLE_VIEWS) } },
        required: ['view']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'no_data_needed',
      description: 'Call this when the message is a greeting, thanks, small talk, or any other message with no real HR question in it that no other tool covers. Returns nothing - just lets you reply conversationally without inventing data.',
      parameters: { type: 'object', properties: {} }
    }
  }
];

// Maps a tool_call name back to the real tools.js function + how to pull
// its arguments out of OpenAI's own (already-validated-by-schema) input.
// Identical mapping to claudeProvider.js's TOOL_RUNNERS.
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
// reply). Restating the rule as its own system message directly before
// the CURRENT user message, right where the model is about to answer,
// counters that recency/majority bias without touching how the message
// itself is stored or displayed anywhere else.
const LANGUAGE_REMINDER = 'Reminder: reply in the same language AND script as the very next user message only, regardless of what language or script earlier messages in this conversation were in.';

function toOpenAiMessages(history, message) {
  const msgs = [{ role: 'system', content: SYSTEM_PROMPT }];
  (history || [])
    .filter((h) => h && h.text)
    .forEach((h) => msgs.push({ role: h.role === 'assistant' ? 'assistant' : 'user', content: h.text }));
  msgs.push({ role: 'system', content: LANGUAGE_REMINDER });
  msgs.push({ role: 'user', content: message });
  return msgs;
}

async function callOpenAi(apiKey, messages, forceToolCall) {
  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + apiKey,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages,
      tools: TOOL_DEFS,
      // Forced on the FIRST call only - this is what closes the
      // hallucination hole: the model physically cannot skip straight to
      // a text answer (and invent a name/number) without going through a
      // real tool first, not even for greetings/small talk (no_data_needed
      // covers those). The follow-up call, after it's already seen the
      // real tool result, is left as 'auto' so it can just answer in text.
      tool_choice: forceToolCall ? 'required' : 'auto'
    })
  });
  if (!resp.ok) {
    const bodyText = await resp.text().catch(() => '');
    throw new Error('OpenAI API error ' + resp.status + (bodyText ? ': ' + bodyText.slice(0, 200) : ''));
  }
  return resp.json();
}

// Sums the two calls that make up one turn (the initial forced-tool-call
// request and the follow-up that turns the tool result into a reply) into
// one real, measured usage figure - not an estimate, straight from
// OpenAI's own response. cachedTokens (prompt_tokens_details.cached_tokens)
// is surfaced separately since OpenAI bills those at a discount when the
// system+tools prefix repeats across requests.
function combineOpenAiUsage(u1, u2) {
  const a = u1 || {};
  const b = u2 || {};
  return {
    promptTokens: (a.prompt_tokens || 0) + (b.prompt_tokens || 0),
    completionTokens: (a.completion_tokens || 0) + (b.completion_tokens || 0),
    cachedTokens: ((a.prompt_tokens_details && a.prompt_tokens_details.cached_tokens) || 0) +
      ((b.prompt_tokens_details && b.prompt_tokens_details.cached_tokens) || 0)
  };
}

async function getResponse({ message, history, user }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // provider.js is only supposed to reach this file when a key exists,
    // but this guard makes that assumption impossible to violate silently.
    throw new Error('openaiProvider.getResponse called without OPENAI_API_KEY set');
  }

  const messages = toOpenAiMessages(history, message);
  let data = await callOpenAi(apiKey, messages, true);
  let choice = data.choices && data.choices[0];
  let assistantMessage = choice && choice.message;
  const usage1 = data.usage || null;

  // At most one tool round-trip - every tool here is a single, direct
  // lookup with no reason for the model to chain multiple calls together;
  // capping it keeps latency and cost bounded and avoids ever looping.
  const toolCall = assistantMessage && assistantMessage.tool_calls && assistantMessage.tool_calls[0];
  if (toolCall) {
    const runner = TOOL_RUNNERS[toolCall.function.name];
    let input = {};
    try {
      input = toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {};
    } catch (err) {
      input = {};
    }
    let toolResult;
    let card = null;
    let actions = null;
    try {
      toolResult = runner ? await runner(input) : { error: 'Unknown tool: ' + toolCall.function.name };
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
      assistantMessage,
      {
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(toolResult).slice(0, 4000)
      }
    ]);
    data = await callOpenAi(apiKey, followUpMessages);
    choice = data.choices && data.choices[0];
    assistantMessage = choice && choice.message;
    const usage2 = data.usage || null;
    // Audit log: which tool, when, for whom, and the real token usage for
    // both calls in this turn - never the data a tool returned (see
    // toolCallLog.js).
    toolCallLog.recordToolCall({
      email: user && user.email,
      provider: 'openai',
      toolName: toolCall.function.name,
      params: input,
      usage: combineOpenAiUsage(usage1, usage2)
    });
    return { reply: (assistantMessage && assistantMessage.content) || 'Here you go.', card, actions };
  }

  toolCallLog.recordToolCall({
    email: user && user.email,
    provider: 'openai',
    toolName: null,
    params: {},
    usage: combineOpenAiUsage(usage1, null)
  });
  return { reply: (assistantMessage && assistantMessage.content) || "I'm not sure how to help with that yet.", card: null, actions: null };
}

module.exports = { getResponse };
