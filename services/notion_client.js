// services/notion_client.js
// ----------------------
// Centralized Notion client with rate-limiting via Bottleneck.
// Provides wrapped methods for all Notion API calls used in Task Migrator.
// Exported functions are safe to call directly—each is throttled to respect API limits.

const { Client } = require('@notionhq/client');
const Bottleneck = require('bottleneck');
require('dotenv').config(); // Ensure NOTION_API_KEY is loaded

// ── 1) Configure Bottleneck limiter to 3 requests/sec
const limiter = new Bottleneck({
    reservoir: 3,                   // start with 3 tokens
    reservoirRefreshAmount: 3,      // refill to 3 tokens...
    reservoirRefreshInterval: 1000, // ...every 1000ms (1 sec)
    maxConcurrent: 1,              // execute one at a time for safety
});

// ── 2) Initialize Notion client using API key
const notion = new Client({ auth: process.env.NOTION_API_KEY });

// ── 3) Helper to wrap any Notion SDK method with rate limiting
const _wrap = (fn) => {
    return (...args) => limiter.schedule(() => fn(...args));
};

// ── 4) Export limited versions of the Notion API methods used
module.exports = {
    // Databases
    databases: {
        retrieve: _wrap(notion.databases.retrieve.bind(notion)),
        query:    _wrap(notion.databases.query.bind(notion)),
    },

    // Pages
    pages: {
        create:    _wrap(notion.pages.create.bind(notion)),
        update:    _wrap(notion.pages.update.bind(notion)),
        retrieve:  _wrap(notion.pages.retrieve.bind(notion)),

        // Page properties
        properties: {
            retrieve: _wrap(notion.pages.properties.retrieve.bind(notion)),
        },
    },

    // Blocks (if needed later)
    blocks: {
        children: {
            list: _wrap(notion.blocks.children.list.bind(notion)),
        },
    },

    // Expose limiter for testing or introspection
    __limiter: limiter,
};

// ── 5) Testing this module
// In your tests, you can:
//  - Mock `@notionhq/client` methods to return fixed values.
//  - Verify that calling exported methods returns promises.
//  - Inspect `__limiter` metrics (e.g., limiter.counts()) to ensure scheduling.
//  - Use Bottleneck's events (limiter.on('failed', ...) ) to test retry logic if added.
