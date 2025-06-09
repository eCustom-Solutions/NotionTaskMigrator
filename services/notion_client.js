// services/notion_client.js
// --------------------------
// Proxy-wrapped Notion client with global rate limiting via Bottleneck.
// All method calls (including on nested properties) are automatically
// scheduled through the limiter.

const { Client } = require('@notionhq/client');
const Bottleneck = require('bottleneck');
require('dotenv').config();

// Configure Bottleneck limiter to 3 requests/sec, one at a time
const limiter = new Bottleneck({
  reservoir: 3,
  reservoirRefreshAmount: 3,
  reservoirRefreshInterval: 1000,
  maxConcurrent: 1,
});

// Initialize raw Notion client
const rawNotion = new Client({ auth: process.env.NOTION_API_KEY });

/**
 * Create a Proxy handler that wraps functions via the limiter,
 * and applies recursively to nested objects.
 */
function createThrottledProxy(target) {
  return new Proxy(target, {
    get(obj, prop) {
      const value = obj[prop];
      if (typeof value === 'function') {
        return (...args) => limiter.schedule(() => value.apply(obj, args));
      }
      if (value !== null && typeof value === 'object') {
        return createThrottledProxy(value);
      }
      return value;
    },
  });
}

// Export the Proxy-wrapped client
const notion = createThrottledProxy(rawNotion);

// Expose the limiter for testing or introspection if needed
notion.__limiter = limiter;

module.exports = notion;
