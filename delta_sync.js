// delta_sync.js
// ----------------
// Incremental delta-sync orchestrator (delete + recreate strategy).

const path = require('path');

require('dotenv').config();
const minimist               = require('minimist');
const argv = minimist(process.argv.slice(2));
const { getTasksFromDBA }     = require('./services/fetch_tasks');
const { writeToDBB }          = require('./services/write_task');
const LINKS_DIR = path.resolve(__dirname, './links');
const transform                = require('./transformations/task_transformer');
const LinkStore = require('./services/link_store');

const notion                  = require('./services/notion_client');
const logger                  = require('./logging/logger');

const jobId = new Date().toISOString();
const log   = logger.child({ jobId });


// ---------- config -------------------------------------------------
const config = {
    dryRun: false,
    force: false,
    onlyId: null,
    strictMode: true
};


const SOURCE_DB_ID = process.env.DUMMY_NOTION_MCC_TASKS_DB_ID;
const TARGET_DB_ID = process.env.DUMMY_NOTION_CENT_DB_ID;
const TASK_MAP     = require('./transformations/mcc_tasks_map');
const LINK_TYPE    = 'dummy_mcc_sync_a';

const linkStore = new LinkStore(LINKS_DIR, logger);


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


// ---------- main loop ----------------------------------------------
void (async () => {
    const { dryRun, force, onlyId } = config;
    const runtimeStart = new Date();
    console.log('runtimeStart a', runtimeStart);
    runtimeStart.setSeconds(0, 0); // floor to start of minute
    runtimeStart.setMinutes(runtimeStart.getMinutes() - 1); // subtract one minute as grace period
    console.log('runtimeStart b', runtimeStart);
    log.trace('↪️ Entered main delta sync runtime');

    log.trace('Fetching tasks from source DB');
    // Preload all source pages for metrics
    const allPages = [];
    for await (const p of getTasksFromDBA(SOURCE_DB_ID)) {
      allPages.push(p);
      log.trace({ pageId: p.id }, 'Fetched task page from source');
    }

    log.trace('Filtering eligible pages based on last edited time and existing links');
    const eligiblePages = allPages.filter(p => {
      if (onlyId && onlyId !== p.id) return false;
      const existingLink = linkStore.load(p.id, LINK_TYPE).catch(() => null);
      return !existingLink || force || new Date(p.last_edited_time) >= new Date(existingLink.syncedAt || 0);
    });

    const totalPages = eligiblePages.length;

    let existingCount = 0;
    let updateCount = 0;
    for (const p of allPages) {
      const existingLink = await linkStore.load(p.id, LINK_TYPE).catch(() => null);
      if (existingLink) {
        existingCount++;
        const lastEdited = new Date(p.last_edited_time);
        if (lastEdited > new Date(existingLink.syncedAt || 0)) {
          updateCount++;
        }
      }
    }
    const firstTimeSyncCount = totalPages - existingCount;

    log.info({ event: 'sync_started', totalPages, existingCount, firstTimeSyncCount, updateCount }, '🔍 Pre-sync summary');

    log.info(`▶️  Delta sync (dryRun=${dryRun}, force=${force})`);

    log.trace({ count: eligiblePages.length }, 'Beginning delta sync loop');

    let updated = 0, skipped = 0, failed = 0;
    let fatalErrorsInARow = 0;
    let totalFatalErrors = 0;
    let processed = 0;

    for (const page of eligiblePages) {
        processed++;
        log.info(`Processing page ${processed}/${totalPages}: ${page.id}`);
        const sourceId = page.id;
        log.trace({ sourceId }, 'Entered sync loop for page');

        if (onlyId && onlyId !== sourceId) continue;

        const lastEdited = new Date(page.last_edited_time);
        const existing   = await linkStore.load(sourceId, LINK_TYPE).catch(() => null);

        log.debug(`Evaluating page ${sourceId}: lastEdited=${lastEdited.toISOString()}, existingSyncedAt=${existing?.syncedAt}`);

        const needsSync =
            force ||
            !existing ||
            lastEdited > new Date(existing.syncedAt || 0);

        if (!needsSync) {
            log.debug({ event: 'page_skipped', sourceId }, `No sync needed for ${sourceId}`);
            skipped++;
            continue;
        }

        if (dryRun) {
            log.info(`↻ (dry) Would resync ${sourceId}`);
            continue;
        }

        let newPage = null;
        try {
            // ---------- perform replace ----------------------------

            const payload    = await transform(page, TASK_MAP, log);
            log.trace(`Transformed payload for ${sourceId}: ${JSON.stringify(payload)}`);

            newPage    = await writeToDBB(payload, TARGET_DB_ID, log);
            log.trace(`New Notion page created: ${newPage.id}`);

            // Construct history _before_ first save so the old targetId is captured
            const newHistory = [...(existing?.history || [])];

            if (existing?.targetId) {
                newHistory.push({
                    targetId:  existing.targetId,
                    syncedAt:  existing.syncedAt,
                    deletedAt: null,                     // will be set after archive succeeds
                    notes:     'Replaced due to drift'
                });
            }

            const link = {
                sourceId,
                targetId: newPage.id,
                status:   'success',
                syncedAt: runtimeStart.toISOString(),
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
                history: newHistory
            };

            await linkStore.save(link, LINK_TYPE);
            log.info({ event: 'page_synced', sourceId, targetId: newPage.id }, `↻ Re-synced ${sourceId} → ${newPage.id}`);
            updated++;
            fatalErrorsInARow = 0;

            if (existing?.targetId) {
                log.debug(`Archiving existing page ${existing.targetId} for ${sourceId}`);
                await archivePageIfExists(existing.targetId);

                // update deletedAt timestamp in history
                link.history[link.history.length - 1].deletedAt = new Date().toISOString();
                await linkStore.save(link, LINK_TYPE);
            }
        } catch (err) {
            failed++;


            if (newPage?.id) {
                try {
                    log.info('archiving page')
                    await archivePageIfExists(newPage.id);
                } catch (e) {
                    log.warn({ sourceId, err: e.message }, 'Rollback archive failed');
                }
            }

            fatalErrorsInARow++;
            totalFatalErrors++;

            const shouldDeferRatioCheck = processed < 10;
            const fatalErrorRate = totalFatalErrors / (updated + skipped + failed);
            const shouldExit = fatalErrorsInARow >= 3 ||
                               totalFatalErrors >= 50 ||
                               (!shouldDeferRatioCheck && fatalErrorRate > 0.2);

            const failLink = {
                sourceId,
                targetId: newPage?.id || null,
                status: 'fail',
                syncedAt: runtimeStart.toISOString(),
                sourceDbId: SOURCE_DB_ID,
                sourceDbName: 'SM Tasks',
                targetDbId: TARGET_DB_ID,
                targetDbName: 'CENT Tasks',
                type: LINK_TYPE,
                sourcePageName: page.properties?.Name?.title?.[0]?.plain_text || '',
                sourcePageIcon: page.icon?.emoji || '',
                targetPageName: '',
                targetPageIcon: '',
                notes: err.message,
                history: existing?.history || []
            };
            await linkStore.save(failLink, LINK_TYPE);
            log.error({ event: 'page_failed', sourceId, err: err.message }, 'Delta‑sync failed');

            if (config.strictMode) {
                log.error({ sourceId, err: err.message }, 'Strict mode enabled — rethrowing fatal error to crash process');
                throw err;
            }

            if (shouldExit) {
                log.error(`❌ Exiting early due to fatal error threshold: ${fatalErrorsInARow} in a row, ${totalFatalErrors} total, ${Math.round(fatalErrorRate * 100)}% rate`);
                break;
            }

            continue;
        }
    }

    log.trace('Initiating orphan cleanup phase');
    // ── 4. Orphan Cleanup ─────────────────────────────────────────────
    const sourceIdSet = new Set(allPages.map(p => p.id));
    const allLinks = await linkStore.loadAll(LINK_TYPE).catch(() => []);
    const orphanedLinks = allLinks.filter(link => {
        return link.status === 'success' && !sourceIdSet.has(link.sourceId);
    });

    log.info({ count: orphanedLinks.length }, '🔍 Found orphaned links to clean up');

    log.trace({ count: orphanedLinks.length }, 'Looping through orphaned links');
    for (const link of orphanedLinks) {
        const targetId = link.targetId;
        try {
            await archivePageIfExists(targetId);
            log.info({ event: 'orphan_archived', sourceId: link.sourceId, targetId }, `🗑 Archived orphaned target page ${targetId} from missing source ${link.sourceId}`);

            const updatedLink = {
                ...link,
                status: 'archived',
                archivedAt: new Date().toISOString(),
                notes: 'Archived due to missing source',
                history: [...(link.history || []), {
                    targetId: link.targetId,
                    syncedAt: link.syncedAt,
                    deletedAt: new Date().toISOString(),
                    notes: 'Archived due to missing source'
                }]
            };
            await linkStore.save(updatedLink, LINK_TYPE);
        } catch (err) {
            log.warn({ event: 'orphan_archive_failed', sourceId: link.sourceId, targetId, err: err.message }, 'Failed to archive orphaned page');
        }
    }

    log.trace('Delta sync complete. Preparing final summary.');
    log.info({ event: 'sync_complete', updated, skipped, failed }, `\nΔ‑sync summary: ${updated} updated, ${skipped} skipped, ${failed} failed`);
})().catch(err => {
    logger.error({ err }, 'Fatal error in delta_sync');
    process.exit(1);
});