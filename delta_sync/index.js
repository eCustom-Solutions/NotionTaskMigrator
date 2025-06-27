// delta_sync/index.js
// CLI entry-point / high-level orchestrator.

const path       = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const minimist   = require('minimist');

const logger     = require('../logging/logger');              // unchanged
const LinkStore  = require('../services/link_store');          // unchanged

// Local modules (new)
const TASK_MAP         = require('../transformations/apt_tasks_map');
const fetchSource      = require('./fetch_source');
const filterEligible   = require('./filter_eligible');
const syncTask         = require('./sync_task');
const cleanupOrphans   = require('./cleanup_orphans');

// ---------- CLI & runtime config ----------
const argv = minimist(process.argv.slice(2), {
    boolean: ['strict', 'dryRun', 'force'],
    default: { strict: true, dryRun: false, force: false }
});

const config = {
    dryRun:     argv.dryRun,
    force:      argv.force,
    onlyId:     argv.onlyId ?? null,
    strictMode: argv.strict
};

const LINK_TYPE      = 'apt_tasks_live';
const LINKS_DIR      = path.resolve(__dirname, '../links');
const SOURCE_DB_ID   = process.env.APT_DB_ID;
const TARGET_DB_ID   = process.env.NOTION_CENT_DB_ID;

const jobId = new Date().toISOString();
const log   = logger.child({ jobId });

console.log('LINKS_DIR', LINKS_DIR);

const linkStore = new LinkStore(LINKS_DIR, logger);

// ---------- main orchestrator ----------
(async () => {
    // 1️⃣ fetch every page from the source DB
    const { allPages, runtimeStart } =
        await fetchSource(SOURCE_DB_ID, log);

    // 2️⃣ decide which need syncing & gather metrics
    const { eligiblePages, summary } =
        await filterEligible(allPages, config, linkStore, LINK_TYPE, log);

    log.info(summary, '🔍 Pre-flight summary');
    log.info(`▶️  Delta sync (dryRun=${config.dryRun}, force=${config.force})`);

    // 3️⃣ sync eligible pages (sequential)
    const results = [];
    for (const page of eligiblePages) {
        const result = await syncTask(page, {
            runtimeStart,
            SOURCE_DB_ID,
            TARGET_DB_ID,
            LINK_TYPE,
            config,
            linkStore,
            logger: log
        }, TASK_MAP);
        results.push(result);
    }

    // tally results
    const updated = results.filter(r => r.status === 'updated').length;
    const skipped = results.filter(r => r.status === 'skipped').length;
    const failed  = results.filter(r => r.status === 'failed').length;

    // 4️⃣ orphan cleanup
    await cleanupOrphans(allPages, linkStore, LINK_TYPE, log);

    // 5️⃣ final log + exit status
    log.info(
        { updated, skipped, failed },
        `Δ-sync summary: ${updated} updated, ${skipped} skipped, ${failed} failed`
    );
    if (failed && config.strictMode) process.exitCode = 1;
})().catch(err => {
    log.error({ err }, 'Fatal error in delta_sync');
    process.exit(1);
});