// migrate_tasks.js
// ------------
// Orchestrates the streaming ETL from SM Tasks DB to CENT Tasks DB
// Usage: node syncTasks.js
// Ensure .env contains NOTION_SM_TASKS_DB_ID and NOTION_CENT_DB_ID

require('dotenv').config();
const { getTasksFromDBA }      = require('./services/fetch_tasks');
const writeToDBB               = require('./services/write_task').writeToDBB;
const linkStore                = require('./services/link_store');
const transformModule = require('./transformations/task_transformer');
const transform = transformModule.default || transformModule;
const writePageWithBlocks = transformModule.writePageWithBlocks;
const logger = require('./logging/logger');
const { sanitizeBlocks } = require('./services/block_sanitizer');


// ── CONFIG ────────────────────────────────────────
const SOURCE_DB_ID = process.env.NOTION_MCC_TASKS_DB_ID;
const TARGET_DB_ID = process.env.NOTION_CENT_DB_ID;
const TASK_MAP = require('./transformations/mcc_tasks_map');
const LINKSTORE_TYPE = 'tasks_MCC_v2';


async function main() {
    logger.info(`▶️  Starting Task Migrator`);
    require('child_process').exec('say "Process begin"');
    logger.info(`   Source (SM): ${SOURCE_DB_ID}`);
    logger.info(`   Target (CENT): ${TARGET_DB_ID}\n`);

    let processed = 0;
    for await (const page of getTasksFromDBA(SOURCE_DB_ID)) {
        const sourceId = page.id;



        // Idempotency: skip if already migrated
        const existing = await linkStore.load(sourceId, LINKSTORE_TYPE).catch(() => null);
        if (existing && existing.status === 'success') {
            // logger.info(`↩️ Skipping ${sourceId} (already succeeded)`);
            // logger.info(`ℹ️ Link already exists in store:`, existing);
            continue;
        }

        // // Source page visibility
        // logger.info(`🔍 Source page for ${sourceId}:`);
        // logger.info(JSON.stringify(page, null, 2));

        logger.info("page", page);


        try {
            logger.info(`🛠 Transforming page ${sourceId}`);
            let payload = await transform(page, TASK_MAP);

            // Payload visibility
            logger.info(`🔍 Final payload for ${sourceId}:`);
            logger.info(JSON.stringify(payload, null, 2));

            // Write to CENT DB
            try {
                logger.info(`🚀 Writing page ${sourceId} to CENT DB`);
                // Create page with properties only
                const pageResult = await writeToDBB({ properties: payload.properties }, TARGET_DB_ID);
                logger.info(`✅ Page created ${pageResult.id} for source ${sourceId}`);

                // Append children blocks, if any
                if (payload.children?.length) {
                    logger.info(`🧩 Appending ${payload.children.length} top‑level blocks to ${pageResult.id}`);
                    await writePageWithBlocks(pageResult.id, payload.children);
                    logger.info(`✅ Blocks appended to ${pageResult.id}`);
                }

                logger.info(`✅ Migrated ${sourceId} → ${pageResult.id}`);
                logger.info(`\n-----------------------------------------------------------------------------------------\n\n`);


                // Record the link
                await linkStore.save({
                    sourceId,
                    targetId: result.id,
                    status: 'success',
                    syncedAt: new Date().toISOString(),
                    sourceDbId: SOURCE_DB_ID,
                    sourceDbName: 'SM Tasks',
                    targetDbId: TARGET_DB_ID,
                    targetDbName: 'CENT Tasks',
                    type: LINKSTORE_TYPE,
                    sourcePageName: page.properties?.Name?.title?.[0]?.plain_text || '',
                    sourcePageIcon: page.icon?.emoji || '',
                    targetPageName: payload.properties?.Name?.title?.[0]?.plain_text || '',
                    targetPageIcon: '',
                    notes: ''
                }, LINKSTORE_TYPE);
                logger.info(`💾 Link saved for ${sourceId}`);

            } catch (err) {
                // More context on failure:
                logger.info(`❌ Failed to migrate ${sourceId}`);
                const notionUrl = `https://www.notion.so/${sourceId.replace(/-/g, '')}`;
                logger.error(`🔗 Review in Notion: ${notionUrl}`);
                logger.info('• Notion error:', err);

                // still record failure to avoid infinite retry loops
                await linkStore.save({
                    sourceId,
                    targetId: null,
                    status: 'fail',
                    syncedAt: new Date().toISOString(),
                    sourceDbId: SOURCE_DB_ID,
                    sourceDbName: 'SM Tasks',
                    targetDbId: TARGET_DB_ID,
                    targetDbName: 'CENT Tasks',
                    type: LINKSTORE_TYPE,
                    sourcePageName: page.properties?.Name?.title?.[0]?.plain_text || '',
                    sourcePageIcon: page.icon?.emoji || '',
                    targetPageName: payload.properties?.Name?.title?.[0]?.plain_text || '',
                    targetPageIcon: '',
                    notes: ''
                }, LINKSTORE_TYPE);
                logger.info(`💾 Link saved for ${sourceId}`);
                logger.info(`\n-----------------------------------------------------------------------------------------\n\n`);
            }

            processed++;
            if (processed % 25 === 0) {
                const total = 'unknown'; // Optional: hardcode if known, or calculate beforehand
                require('child_process').exec(`say "Processed ${processed} of ${total}"`);
            }
        } catch (err) {
            if (err.message && err.message.startsWith('SkipPage')) {
                logger.warn(`⚠️ Skipping page ${sourceId} due to SkipPage error: ${err.message}`);
                continue;
            }
            throw err;
        }
    }

    require('child_process').exec('say "Process complete"');
    logger.info(`\n🏁 Migration complete! ${processed} pages processed.`);}

main().catch(err => {
    logger.error('Fatal error in syncTasks:', err);
    process.exit(1);
});