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
const logger = require('./logging/logger');

// ── Helper: Sanitize blocks to remove invalid data URLs for images ─────────────
function sanitizeBlocks(blocks) {
    return blocks.filter(block => {
        if (block.type === 'image' && block.image && block.image.type === 'external') {
            const url = block.image.external.url;
            if (url.startsWith('data:')) {
                logger.info(`⚠️ Skipping image block with invalid data URL: ${url.substring(0, 50)}...`);
                return false;
            }
        }
        return true;
    });
}

// ── CONFIG ────────────────────────────────────────
const SOURCE_DB_ID = process.env.NOTION_SM_TASKS_DB_ID;
const TARGET_DB_ID = process.env.NOTION_CENT_DB_ID;
const TASK_MAP = require('./transformations/sm_tasks_map');
const LINKSTORE_TYPE = 'tasks_SM';

const mapSpec                  = TASK_MAP;

async function main() {
    logger.info(`▶️  Starting Task Migrator`);
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

        logger.info(`🔎 Full source page object for ${sourceId}:`);
        logger.info(JSON.stringify(page, null, 2));


        logger.info(`🛠 Transforming page ${sourceId}`);
        let payload = await transform(page, TASK_MAP);

        // Sanitize children blocks to remove invalid data URLs
        if (payload.children) {
            payload.children = sanitizeBlocks(payload.children);
            logger.info(`🔧 Sanitized children blocks for ${sourceId}`);
        }

        logger.info(`🔍 Final payload for ${sourceId}:`);
        logger.info(JSON.stringify(payload, null, 2));

        // Write to CENT DB
        try {
            logger.info(`🚀 Writing page ${sourceId} to CENT DB`);
            const result = await writeToDBB(payload, TARGET_DB_ID);
            logger.info(`✅ Write result for ${sourceId}:`, result);
            logger.info(`✅ Migrated ${sourceId} → ${result.id}`);

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
            console.error(`❌ Failed to migrate ${sourceId}`);
            const notionUrl = `https://www.notion.so/${sourceId.replace(/-/g, '')}`; console.error(`🔗 Review in Notion: ${notionUrl}`);
            console.error('• Notion error:', err);

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
        }

        processed++;
    }

    logger.info(`\n🏁 Migration complete! ${processed} pages processed.`);
}

main().catch(err => {
    console.error('Fatal error in syncTasks:', err);
    process.exit(1);
});