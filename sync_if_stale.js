// sync_if_stale.js
// ----------------
// Incremental delta-sync orchestrator (delete + recreate strategy).

require('dotenv').config();
const minimist               = require('minimist');
const { getTasksFromDBA }     = require('./services/fetch_tasks');
const { writeToDBB }          = require('./services/write_task');
const linkStore               = require('./services/link_store');
const transform               = require('./transformations/task_transformer');
const notion                  = require('./services/notion_client');
const logger                  = require('./logging/logger');

const SOURCE_DB_ID = process.env.APT_DB_ID;
const TARGET_DB_ID = process.env.NOTION_CENT_DB_ID;
const TASK_MAP     = require('./transformations/apt_tasks_map');
const LINK_TYPE    = 'tasks_APT_test1';

// ---------- helpers -------------------------------------------------
async function archivePageIfExists(pageId) {
    try {
        await notion.pages.update({ page_id: pageId, archived: true });
        logger.info(`🗑 Archived old target ${pageId}`);
    } catch (e) {
        if (e.status === 404) {
            logger.warn(`⚠️ Target ${pageId} already gone`);
        } else {
            throw e;
        }
    }
}

// ---------- config -------------------------------------------------
const config = {
    dryRun: false,
    force: false,
    onlyId: null
};

// ---------- main loop ----------------------------------------------
(async () => {
    const { dryRun, force, onlyId } = config;
    logger.info(`▶️  Delta sync (dryRun=${dryRun}, force=${force})`);

    let updated = 0, skipped = 0;

    for await (const page of getTasksFromDBA(SOURCE_DB_ID)) {
        const sourceId = page.id;
        if (onlyId && onlyId !== sourceId) continue;

        const lastEdited = new Date(page.last_edited_time);
        const existing   = await linkStore.load(sourceId, LINK_TYPE).catch(() => null);

        const needsSync =
            force ||
            !existing ||
            lastEdited > new Date(existing.syncedAt || 0);

        if (!needsSync) {
            skipped++;
            continue;
        }

        if (dryRun) {
            logger.info(`↻ (dry) Would resync ${sourceId}`);
            continue;
        }

        // ---------- perform replace ----------------------------
        if (existing?.targetId) {
            await archivePageIfExists(existing.targetId);
            // push old entry to history
            existing.history = existing.history || [];
            existing.history.push({
                targetId: existing.targetId,
                syncedAt: existing.syncedAt,
                deletedAt: new Date().toISOString(),
                notes: 'Replaced due to drift',
            });
        }

        const payload    = await transform(page, TASK_MAP);
        const newPage    = await writeToDBB(payload, TARGET_DB_ID);

        const link = {
            sourceId,
            targetId: newPage.id,
            status:   'success',
            syncedAt: new Date().toISOString(),
            sourceDbId: SOURCE_DB_ID,
            sourceDbName: 'SM Tasks',
            targetDbId: TARGET_DB_ID,
            targetDbName: 'CENT Tasks',
            type: LINK_TYPE,
            sourcePageName: page.properties?.Name?.title?.[0]?.plain_text || '',
            sourcePageIcon: page.icon?.emoji || '',
            targetPageName: payload.properties?.Name?.title?.[0]?.plain_text || '',
            targetPageIcon: '',
            notes: '',
            history: existing?.history || [],
        };

        await linkStore.save(link, LINK_TYPE);
        logger.info(`↻ Re-synced ${sourceId} → ${newPage.id}`);
        updated++;
    }

    logger.info(`\nΔ-sync summary: ${updated} updated, ${skipped} skipped`);
})();