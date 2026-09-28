// AI provider interface. getResponse({message, history, user}) always
// returns { reply, card, actions } (see mockProvider.js for the exact
// shape) - callers (the chat route) never need to know which provider
// answered.
//
// Today this always resolves to the mock provider. To connect a real
// Claude-backed provider later:
//   1. Add a claudeProvider.js in this same folder that reads
//      process.env.ANTHROPIC_API_KEY (server-side only - never send this
//      key to the client) and implements the same getResponse() shape,
//      using tools.js's functions as its own tool-calling targets.
//   2. Swap the export below to pick claudeProvider when
//      ANTHROPIC_API_KEY is set, falling back to the mock provider
//      otherwise (so local/dev usage keeps working without a key).
// No UI or route code needs to change for that swap - they only ever
// call this module's getResponse().
const mockProvider = require('./mockProvider');

async function getResponse({ message, history, user }) {
  // if (process.env.ANTHROPIC_API_KEY) {
  //   const claudeProvider = require('./claudeProvider');
  //   return claudeProvider.getResponse({ message, history, user });
  // }
  return mockProvider.getResponse({ message, history, user });
}

module.exports = { getResponse };
