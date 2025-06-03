// scripts/stream_db_contents.js
// ---------------------

const path = require('path');

// Force dotenv to load from project root
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const notion = require('../services/notion_client');  // still correct

const SM_DB_ID   = process.env.NOTION_SM_TASKS_DB_ID;
const CENT_DB_ID = process.env.NOTION_CENT_DB_ID;
const GLOBAL_TAGS_DB_ID = process.env.GLOBAL_TAGS_DB_ID

// Debug: confirm values loaded
console.log('cwd:', process.cwd());
console.log('dirname:', __dirname);
console.log('SM_DB_ID:', SM_DB_ID);
console.log('CENT_DB_ID:', CENT_DB_ID);
console.log('GLOBAL_TAGS_DB_ID', GLOBAL_TAGS_DB_ID);

async function* streamDB(dbId) {
    let cursor = undefined;

    do {
        const response = await notion.databases.query({
            database_id: dbId,
            page_size: 100,
            start_cursor: cursor,
        });

        for (const page of response.results) {
            yield page;
        }

        cursor = response.has_more ? response.next_cursor : undefined;
    } while (cursor);
}

async function main() {
    console.log(`▶️  Streaming SM Tasks DB (${GLOBAL_TAGS_DB_ID})`);
    for await (const page of streamDB(GLOBAL_TAGS_DB_ID)) {
        console.log(`SM Page ID: ${page.id}`);
        console.dir(page.properties, { depth: null });
        console.log('---');
    }

    // console.log(`\n▶️  Streaming CENT Tasks DB (${CENT_DB_ID})`);
    // for await (const page of streamDB(CENT_DB_ID)) {
    //     console.log(`CENT Page ID: ${page.id}`);
    //     console.dir(page.properties, { depth: null });
    //     console.log('---');
    // }

    console.log(`\n🏁 Done streaming both databases.`);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});