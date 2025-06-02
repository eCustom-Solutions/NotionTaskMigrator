// migrate_tasks.js
// ------------
// Orchestrates the streaming ETL from SM Tasks DB to CENT Tasks DB
// Usage: node syncTasks.js
// Ensure .env contains NOTION_SM_TASKS_DB_ID and NOTION_CENT_DB_ID

require('dotenv').config();
const { getTasksFromDBA }      = require('./services/fetch_tasks');
const writeToDBB               = require('./services/write_task').writeToDBB;
const linkStore                = require('./services/link_store');
const transform                = require('./transformations/generic_transformer');
const mapSpec                  = require('./transformations/sm_tasks_map');
const logger = require('./services/logger');

const SM_DB_ID   = process.env.NOTION_SM_TASKS_DB_ID;
const CENT_DB_ID = process.env.NOTION_CENT_DB_ID;

async function main() {
    logger.info(`▶️  Starting Task Migrator`);
    logger.info(`   Source (SM): ${SM_DB_ID}`);
    logger.info(`   Target (CENT): ${CENT_DB_ID}\n`);

    let processed = 0;
    for await (const page of getTasksFromDBA(SM_DB_ID)) {
        const sourceId = page.id;

        // Idempotency: skip if already migrated
        const existing = await linkStore.load(sourceId).catch(() => null);
        if (existing && existing.status === 'success') {
            logger.info(`↩️ Skipping ${sourceId} (already succeeded)`);
            logger.info(`ℹ️ Link already exists in store:`, existing);
            continue;
        }

        // Transform to CENT schemasuccess') {
        //             // logger.info(`↩️ Skipping ${sourceId} (already succeeded)`);
        //             // logger.info(`ℹ️ Link already exists in store:`, existing);
        //             continue;
            //         }
            logger.info(`🛠 Transforming page ${sourceId}`);
        const payload = await transform(page, mapSpec);

        // Write to CENT DB
        try {
            logger.info(`🚀 Writing page ${sourceId} to CENT DB`);
            const result = await writeToDBB(payload, CENT_DB_ID);
            logger.info(`✅ Write result for ${sourceId}:`, result);
            logger.info(`✅ Migrated ${sourceId} → ${result.id}`);

            // Record the link
            await linkStore.save({
                sourceId,
                targetId: result.id,
                status: 'success',
                syncedAt: new Date().toISOString()
            });
            logger.info(`💾 Link saved for ${sourceId}`);

        } catch (err) {
            // More context on failure:
            console.error(`❌ Failed to migrate ${sourceId}`);
            console.error('• Notion error:', err);

            // still record failure to avoid infinite retry loops
            await linkStore.save({
                sourceId,
                targetId: null,
                status: 'fail',
                syncedAt: new Date().toISOString()
            });
            logger.info(`💾 Link saved for ${sourceId}`);
        }

        processed++;
    }

    logger.info(`\n🏁 Migration complete! ${processed} pages processed.`);
}

main().catch(err => {
    console.error('Fatal error in syncTasks:', err);
    process.exit(1);
});