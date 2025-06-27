// delta_sync/archive_page.js
// Safe archive helper (Notion 404-tolerant).

const notion = require('../services/notion_client'); // shared singleton

module.exports = async function archivePage (pageId, logger) {
    try {
        await notion.pages.update({ page_id: pageId, archived: true });
        logger.info(`🗑 Archived page ${pageId}`);
    } catch (e) {
        if (e.status === 404) {
            logger.warn(`⚠️ Page ${pageId} already archived or missing`);
        } else {
            throw e;
        }
    }
};