// delta_sync/cleanup_orphans.js
// Archives target pages whose source no longer exists.

const archivePage = require('./archive_page');

module.exports = async function cleanupOrphans (
    allPages,
    linkStore,
    LINK_TYPE,
    logger
) {
    const log = logger.child({ module: 'cleanupOrphans' });

    const existingSourceIds = new Set(allPages.map(p => p.id));
    const allLinks = await linkStore.loadAll(LINK_TYPE).catch(() => []);

    const orphans = allLinks.filter(
        l => l.status === 'success' && !existingSourceIds.has(l.sourceId)
    );

    log.info({ count: orphans.length }, '🔍 Orphaned links to clean');

    for (const link of orphans) {
        try {
            await archivePage(link.targetId, log);
            await linkStore.save(
                {
                    ...link,
                    status:     'archived',
                    archivedAt: new Date().toISOString(),
                    notes:      'Archived due to missing source'
                },
                LINK_TYPE
            );
            log.info(`🗑 Archived orphan ${link.targetId}`);
        } catch (err) {
            log.warn({ err }, `Failed to archive orphan ${link.targetId}`);
        }
    }
};