// services/fetch_tasks.js
// ----------------------
// Streams pages (tasks) from a Notion database (DB A) one by one.

const notion = require('./notion_client');
const logger = require('../logging/logger');

async function* getTasksFromDBA(dbId) {
    logger.info(`Starting to fetch tasks from database ID: ${dbId}`);
    let cursor = undefined;

    do {
        const response = await notion.databases.query({
            database_id: dbId,
            page_size: 100,
            start_cursor: cursor,
        });

        for (const page of response.results) {
            logger.debug(`Fetched page with ID: ${page.id}`);
            yield page;
        }

        cursor = response.has_more ? response.next_cursor : undefined;
    } while (cursor);

    logger.info(`Finished streaming all pages from database ID: ${dbId}`);
}

module.exports = { getTasksFromDBA };