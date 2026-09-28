// AI provider interface. getResponse({message, history, user}) always
// returns { reply, card, actions } (see mockProvider.js for the exact
// shape) - callers (the chat route) never need to know which provider
// answered.
//
// Picks claudeProvider when ANTHROPIC_API_KEY is set, mockProvider
// otherwise - so local/dev usage (and production, until the key is
// added) keeps working exactly as it does today. claudeProvider.js is
// only require()'d inside that branch, so with no key set it never even
// loads, let alone makes a network call. No UI or route code needs to
// change when the key is added later.
//
// If a Claude call itself fails once the key IS set (network issue, rate
// limit, temporary outage), that one request falls back to the mock
// provider rather than surfacing a raw error - the assistant stays
// useful even if Claude is briefly unavailable.
const mockProvider = require('./mockProvider');

async function getResponse({ message, history, user }) {
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const claudeProvider = require('./claudeProvider');
      return await claudeProvider.getResponse({ message, history, user });
    } catch (err) {
      console.error('[hr-assistant] Claude provider failed, falling back to mock:', err.message);
    }
  }
  return mockProvider.getResponse({ message, history, user });
}

module.exports = { getResponse };
