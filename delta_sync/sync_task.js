// delta_sync/sync_task.js
// Syncs ONE page: transform → write → link store → archive.

const transform   = require('../transformations/task_transformer');
const { writeToDBB } = require('../services/write_task');
const archivePage   = require('./archive_page');

module.exports = async function syncTask (page, ctx, taskMap) {
    const {
        runtimeStart,
        SOURCE_DB_ID,
        TARGET_DB_ID,
        LINK_TYPE,
        config,
        linkStore,
        logger
    } = ctx;

    const { dryRun } = config;
    const sourceId   = page.id;
    const log        = logger.child({ module: 'syncTask', sourceId });

    const existing = await linkStore.load(sourceId, LINK_TYPE).catch(() => null);
    const lastEdited = new Date(page.last_edited_time);
    const needsSync  =
        config.force ||
        !existing ||
        lastEdited > new Date(existing?.syncedAt || 0);

    if (!needsSync) {
        log.debug('No drift → skip');
        return { status: 'skipped', sourceId };
    }

    if (dryRun) {
        log.info('↻ (dryRun) Would sync page');
        return { status: 'skipped', sourceId };
    }

    let newPage = null;
    try {
        // transform & write
        const payload = await transform(page, taskMap, log);
        newPage       = await writeToDBB(payload, TARGET_DB_ID, log);

        // link history handling
        const history = [...(existing?.history || [])];
        if (existing?.targetId) {
            history.push({
                targetId:  existing.targetId,
                syncedAt:  existing.syncedAt,
                deletedAt: null,
                notes:     'Replaced due to drift'
            });
        }

        // save link
        await linkStore.save(
            {
                sourceId,
                targetId: newPage.id,
                status:   'success',
                syncedAt: runtimeStart.toISOString(),
                sourceDbId: SOURCE_DB_ID,
                targetDbId: TARGET_DB_ID,
                type: LINK_TYPE,
                history
            },
            LINK_TYPE
        );

        // archive prior copy
        if (existing?.targetId) {
            await archivePage(existing.targetId);
            history[history.length - 1].deletedAt = new Date().toISOString();
            await linkStore.save(
                { ...existing, targetId: newPage.id, history },
                LINK_TYPE
            );
        }

        log.info(`✓ Synced ${sourceId} → ${newPage.id}`);
        return { status: 'updated', sourceId };
    } catch (err) {
        log.error({ err }, 'Sync failed');

        // best-effort rollback
        if (newPage?.id) await archivePage(newPage.id).catch(() => {});

        await linkStore.save(
            {
                sourceId,
                targetId: newPage?.id || null,
                status:   'fail',
                syncedAt: runtimeStart.toISOString(),
                sourceDbId: SOURCE_DB_ID,
                targetDbId: TARGET_DB_ID,
                type: LINK_TYPE,
                notes: err.message,
                history: existing?.history || []
            },
            LINK_TYPE
        );

        if (config.strictMode) throw err;
        return { status: 'failed', sourceId, err };
    }
};