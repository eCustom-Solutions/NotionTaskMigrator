// delta_sync/fetch_source.js
// Streams every page from SOURCE_DB_ID & returns them + runtimeStart.

const { getTasksFromDBA } = require('../services/fetch_tasks');

module.exports = async function fetchSource (SOURCE_DB_ID, logger) {
    const runtimeStart = new Date();
    runtimeStart.setSeconds(0, 0);
    runtimeStart.setMinutes(runtimeStart.getMinutes() - 1); // grace period

    const log = logger.child({ module: 'fetchSource' });
    log.trace('Fetching tasks from source DB');

    const allPages = [];
    for await (const p of getTasksFromDBA(SOURCE_DB_ID)) {
        allPages.push(p);
        log.trace({ pageId: p.id }, 'Fetched task page');
    }

    return { allPages, runtimeStart };
};