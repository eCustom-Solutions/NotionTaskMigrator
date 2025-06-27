// delta_sync/filter_eligible.js
// Returns pages needing sync + summary stats.

module.exports = async function filterEligible (
    allPages,
    config,
    linkStore,
    LINK_TYPE,
    logger
) {
    const { force, onlyId } = config;
    const log = logger.child({ module: 'filterEligible' });

    const eligiblePages = [];

    let existingCount = 0;
    let updateCount   = 0;

    for (const page of allPages) {
        if (onlyId && page.id !== onlyId) continue;

        const existingLink =
            await linkStore.load(page.id, LINK_TYPE).catch(() => null);

        if (existingLink) existingCount++;

        const lastEdited = new Date(page.last_edited_time);
        const needsSync  =
            force ||
            !existingLink ||
            lastEdited > new Date(existingLink.syncedAt || 0);

        if (needsSync) {
            if (existingLink) updateCount++;
            eligiblePages.push(page);
        }
    }

    const summary = {
        event:            'sync_started',
        totalPages:       eligiblePages.length,
        existingCount,
        firstTimeSync:    eligiblePages.length - updateCount,
        updateCount
    };

    return { eligiblePages, summary };
};