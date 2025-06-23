// migrate_tasks.js
// ------------
// Orchestrates the streaming ETL from SM Tasks DB to CENT Tasks DB
// Usage: node migrate_tasks.js
// Ensure .env contains APT_DB_ID (source) and NOTION_CENT_DB_ID (target)

require('dotenv').config();
const { getTasksFromDBA }      = require('./services/fetch_tasks');
const writeToDBB               = require('./services/write_task').writeToDBB;
const linkStore                = require('./services/link_store');
const transformModule          = require('./transformations/task_transformer');
const transform                = transformModule.default || transformModule;
const logger                   = require('./logging/logger');
const childProcess             = require('child_process');

// ── CONFIG ────────────────────────────────────────
const SOURCE_DB_ID  = process.env.APT_DB_ID;
const TARGET_DB_ID  = process.env.NOTION_CENT_DB_ID;
const TASK_MAP      = require('./transformations/apt_tasks_map');
const LINKSTORE_TYPE = 'tasks_APT_live';

async function main () {
    /* ───────────────────────────────
       Job-scoped logger (adds jobId on every line)
    ─────────────────────────────── */
    const jobId = new Date().toISOString();
    const job   = logger.child({ jobId });

    const startedAt = Date.now();
    job.info('▶️  Task migration started', {
        sourceDb: SOURCE_DB_ID,
        targetDb: TARGET_DB_ID,
        map: TASK_MAP?.name || 'APT_MAP',
        linkStoreType: LINKSTORE_TYPE
    });

    childProcess.exec('say "Migration job begin"');

    // ── 1. Prefetch pages so we know total ───────────────────────────
    const pages = [];
    for await (const p of getTasksFromDBA(SOURCE_DB_ID)) pages.push(p);
    const total = pages.length;
    job.info({ total }, 'Total pages fetched from source');

    /* Counters */
    let processed = 0;
    let skipped   = 0;
    let failed    = 0;

    // ── 2. Process each page ─────────────────────────────────────────
    for (const page of pages) {
        const sourceId = page.id;

        /* Idempotency: skip if already migrated */
        const existing = await linkStore.load(sourceId, LINKSTORE_TYPE).catch(() => null);
        if (existing?.status === 'success') {
            skipped++;
            processed++;
            job.debug({ processed, total, sourceId }, 'Skipped (already migrated)');
            continue;
        }

        try {
            // ── 2a. Transform
            job.debug({ sourceId }, 'Transforming source page');
            const payload = await transform(page, TASK_MAP);

            // ── 2b. Write to target DB
            try {
                const pageResult = await writeToDBB(payload, TARGET_DB_ID);
                job.debug({ sourceId, targetId: pageResult.id }, 'Page written to target DB');

                // Record link success
                const existingLink = await linkStore.load(sourceId, LINKSTORE_TYPE).catch(() => null);
                await linkStore.save({
                    sourceId,
                    targetId:      pageResult.id,
                    status:        'success',
                    syncedAt:      new Date().toISOString(),
                    sourceDbId:    SOURCE_DB_ID,
                    sourceDbName:  'SM Tasks',
                    targetDbId:    TARGET_DB_ID,
                    targetDbName:  'CENT Tasks',
                    type:          LINKSTORE_TYPE,
                    sourcePageName: page.properties?.Name?.title?.[0]?.plain_text || '',
                    sourcePageIcon: page.icon?.emoji || '',
                    targetPageName: payload.properties?.Name?.title?.[0]?.plain_text || '',
                    targetPageIcon: '',
                    notes:          '',
                    history:        existingLink?.history || []
                }, LINKSTORE_TYPE);

            } catch (err) {
                failed++;
                job.warn({ sourceId, err: err.message }, 'Write to target DB failed');

                /* Record failure to avoid infinite retries */
                const existingLink = await linkStore.load(sourceId, LINKSTORE_TYPE).catch(() => null);
                await linkStore.save({
                    sourceId,
                    targetId: null,
                    status:   'fail',
                    syncedAt: new Date().toISOString(),
                    sourceDbId:   SOURCE_DB_ID,
                    sourceDbName: 'SM Tasks',
                    targetDbId:   TARGET_DB_ID,
                    targetDbName: 'CENT Tasks',
                    type:         LINKSTORE_TYPE,
                    sourcePageName: page.properties?.Name?.title?.[0]?.plain_text || '',
                    sourcePageIcon: page.icon?.emoji || '',
                    targetPageName: payload.properties?.Name?.title?.[0]?.plain_text || '',
                    targetPageIcon: '',
                    notes:         '',
                    history:       existingLink?.history || []
                }, LINKSTORE_TYPE);
            }

            processed++;

            /* Progress heartbeat every 50 items */
            if (processed % 50 === 0 || processed === total) {
                job.info({ processed, skipped, failed, total }, '📊 Progress update');
                childProcess.exec(`say "Processed ${processed} of ${total}"`);
            }

        } catch (err) {
            if (err.message?.startsWith('SkipPage')) {
                skipped++;
                job.warn({ sourceId, reason: err.message }, 'Page skipped by transformer');
                continue;
            }
            failed++;
            job.error({ sourceId, err }, 'Unhandled error, aborting job');
            throw err; /* Bubble up to main catch */
        }
    }

    // ── 3. Finish ────────────────────────────────────────────────────
    const elapsedMs = Date.now() - startedAt;
    childProcess.exec('say "Migration complete"');
    job.info({
        migrated: processed - skipped - failed,
        skipped,
        failed,
        total,
        elapsedMs
    }, '🏁 Migration finished');
}

/* eslint-disable no-void */
void main().catch(err => {
    logger.error({ err }, 'Fatal error in migrate_tasks');
    process.exit(1);
});