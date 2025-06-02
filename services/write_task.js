// services/write_task.js
// ---------------------
// Writes a single transformed task into Notion DB B and returns the created page.

const notion = require('./notion_client');

/**
 * @param {object} transformedTask  – shape: { properties: { ... }, children?: [...] }
 * @param {string} dbId             – Notion Database B ID
 * @returns {Promise<object>}       – Notion response (including `id` of new page)
 */
async function writeToDBB(transformedTask, dbId) {
    const payload = {
        parent: { database_id: dbId },
        properties: transformedTask.properties,
    };

    // If your transformer produces children blocks, include them
    if (transformedTask.children) {
        payload.children = transformedTask.children;
    }

    const response = await notion.pages.create(payload);
    return response;
}

module.exports = { writeToDBB };