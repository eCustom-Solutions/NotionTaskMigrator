// services/fetch_tasks.js
// ----------------------
// Streams pages (tasks) from a Notion database (DB A) one by one.

const notion = require('./notion_client');

async function* getTasksFromDBA(dbId) {
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

module.exports = { getTasksFromDBA };