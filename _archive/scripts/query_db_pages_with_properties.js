// query_all_pages_with_properties_throttled.js
// ▶ Requires:
//    npm install @notionhq/client dotenv bottleneck

const path = require('path');
const fs = require('fs');
const { Client } = require('@notionhq/client');
const Bottleneck = require('bottleneck');
require('dotenv').config({
    path: path.resolve(__dirname, '../.env')
});

const notion = new Client({ auth: process.env.NOTION_API_KEY });

// ── 1) Set up a 3-req/sec limiter
const limiter = new Bottleneck({
    reservoir: 3,                      // initial tokens
    reservoirRefreshAmount: 3,         // refill 3 tokens...
    reservoirRefreshInterval: 1000,    // ...every 1000ms
});

// Helper to wrap Notion calls
const limited = (fn, ...args) => limiter.schedule(() => fn(...args));

const scriptStart = Date.now();
const formatElapsed = (start) => {
    const ms = Date.now() - start;
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
    const minutes = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
    const seconds = (totalSeconds % 60).toString().padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
};

// ── 2) Prepare CSV output
const csvPath = path.resolve(__dirname, '../output.csv');
const csvHeader = 'pageId,propertyName,propertyData\n';
if (!fs.existsSync(csvPath)) {
    fs.writeFileSync(csvPath, csvHeader);
}
const csvStream = fs.createWriteStream(csvPath, { flags: 'a' });

(async () => {
    const dbId = process.env.NOTION_DATABASE_ID;

    // → Fetch schema
    console.log('📥 1/4 – Retrieving database schema…');
    const { properties } = await limited(notion.databases.retrieve.bind(notion), { database_id: dbId });
    const schema = Object.entries(properties).map(([name, meta]) => ({ name, id: meta.id }));
    console.log(`✅ Retrieved ${schema.length} properties.\n`);

    // → Fetch all pages with pagination
    console.log('📄 2/4 – Querying all pages (100/page)…');
    let allPages = [], cursor = undefined, batch = 0;
    do {
        const resp = await limited(notion.databases.query.bind(notion), {
            database_id: dbId,
            page_size: 100,
            start_cursor: cursor
        });
        allPages.push(...resp.results);
        cursor = resp.has_more ? resp.next_cursor : undefined;
        batch++;
        console.log(`   → Batch #${batch}: fetched ${resp.results.length} pages (total ${allPages.length})`);
    } while (cursor);
    console.log(`✅ All pages fetched: ${allPages.length}\n`);

    // → Loop through pages & properties
    console.log('🔄 3/4 – Retrieving each property for every page…');
    for (let i = 0; i < allPages.length; i++) {
        const page = allPages[i];
        console.log(`   • Page ${i + 1}/${allPages.length} — ${page.id} | +${formatElapsed(scriptStart)} elapsed`);

        await Promise.all(schema.map(async ({ name, id }) => {
            try {
                const prop = await limited(
                    notion.pages.properties.retrieve.bind(notion),
                    { page_id: page.id, property_id: id }
                );

                const safe = JSON.stringify(prop).replace(/"/g, '""');
                csvStream.write(`"${page.id}","${name}","${safe}"\n`);
                console.log(`       ↳ [OK] ${name}`);
            } catch (err) {
                console.error(`       ↳ [FAIL] ${name}: ${err.message}`);
                csvStream.write(`"${page.id}","${name}",""\n`);
            }
        }));
    }

    console.log('\n📦 4/4 – Done. CSV streaming to:', csvPath);
    csvStream.end();
})();