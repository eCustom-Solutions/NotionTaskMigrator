// migrate_tags.js
// ----------------
// Orchestrates migration of “related” pages from Global Tags DB → Brands/Verticals/Departments
//
// Usage: node migrate_tags.js [limit]
//   - If you supply a numeric argument, the script will stop after migrating that many related pages.
//   - If omitted, it defaults to 1 (dry-run). To process all pages, pass a very large number or remove the limit logic.

require('dotenv').config();
const notion          = require('./services/notion_client');
const logger          = require('./services/logger');
const linkStore       = require('./services/link_store');
const transformTagPage = require('./transformations/tag_transformer');
const { writeToDBB }  = require('./services/write_task');

// ── CONFIG ─────────────────────────────────────────────────────────────────────
const DEFAULT_LIMIT = 99;

// ── Environment / Target DB IDs ───────────────────────────────────────────────
const GLOBAL_TAGS_DB_ID = process.env.GLOBAL_TAGS_DB_ID;
const TARGET_DB_IDS = {
    Brand:    process.env.BRANDS_DB_ID,
    Vertical: process.env.VERTICALS_DB_ID,
    Team:     process.env.DEPARTMENTS_DB_ID
};

// ── Helper: stream all pages from a Notion database (paginated) ──────────────
async function* streamDB(dbId) {
    let cursor = undefined;
    do {
        const response = await notion.databases.query({
            database_id: dbId,
            page_size: 100,
            start_cursor: cursor
        });
        for (const page of response.results) {
            yield page;
        }
        cursor = response.has_more ? response.next_cursor : undefined;
    } while (cursor);
}

// ── Main orchestrator ────────────────────────────────────────────────────────
async function main() {
    // 1) Parse CLI argument for limit (dry-run)
    const rawLimit = process.argv[2];
    const limit = rawLimit ? parseInt(rawLimit, 10) : DEFAULT_LIMIT;
    if (isNaN(limit) || limit < 1) {
        console.error('⚠️  Invalid limit provided. Please pass a positive integer or omit for default 1.');
        process.exit(1);
    }

    // Fetch source DB name for richer links
    const sourceDbMeta = await notion.databases.retrieve({ database_id: GLOBAL_TAGS_DB_ID });
    const sourceDbName = sourceDbMeta.title[0]?.plain_text || '';

    logger.info('▶️  Starting Tag Migrator');
    logger.info(`   Source (Global Tags DB): ${GLOBAL_TAGS_DB_ID}`);
    logger.info(`   Dry-run limit: ${limit}\n`);

    let migratedCount = 0;

    // 2) Iterate all pages in Global Tags DB
    for await (const tagPage of streamDB(GLOBAL_TAGS_DB_ID)) {
        // 2a) Read the Tag title exactly (Notion Title → plain_text)
        const titleArray = tagPage.properties['Tag']?.title || [];
        const tagType = titleArray[0]?.plain_text?.trim() || null;

        // 2b) Only proceed if Tag is exactly "Brand", "Vertical", or "Team"
        if (!TARGET_DB_IDS[tagType]) {
            continue;
        }

        logger.info(`🔎 Processing Global Tag page (type="${tagType}"): ${tagPage.id}`);

        const targetDbId = TARGET_DB_IDS[tagType];
        const targetDbMeta = await notion.databases.retrieve({ database_id: targetDbId });
        const targetDbName = targetDbMeta.title[0]?.plain_text || '';

        const sourceType = tagType; // migration type
        const tagPageName = tagPage.properties['Tag']?.title?.[0]?.plain_text || '';
        const tagPageIcon = tagPage.icon?.type === 'emoji' ? tagPage.icon.emoji : null;

        // 3) Read its “Related Global Tags DB” relations array
        //    Each item is { id: <relatedPageId>, ... }
        const relations = tagPage.properties['Related Global Tags DB']?.relation || [];
        if (relations.length === 0) {
            logger.info(`   ↳ No related pages found for this ${tagType} tag → skipping.`);
            continue;
        }

        // 4) For each related page, migrate it into the target DB
        for (const rel of relations) {
            if (migratedCount >= limit) {
                logger.info(`🏁 Reached migration limit (${limit}). Exiting.`);
                process.exit(0);
            }

            const sourceId = rel.id;

            // 4a) Idempotency: skip if already migrated under "tags"
            const existing = await linkStore.load(sourceId, 'tags').catch(() => null);
            if (existing && existing.status === 'success') {
                logger.info(`   ↩️  Skipping related page ${sourceId} (already migrated).`);
                continue;
            }

            try {
                // 4b) Fetch full page object from Notion
                logger.info(`   📥 Fetching related page: ${sourceId}`);

                // Log before URL
                const beforeUrl = `https://notion.so/${sourceId.replace(/-/g, '')}`;
                logger.info(`   🔗 Before URL: ${beforeUrl}`);

                const page = await notion.pages.retrieve({ page_id: sourceId });

                const sourcePageName = page.properties['Tag']?.title?.[0]?.plain_text || '';
                const sourcePageIcon = page.icon?.type === 'emoji' ? page.icon.emoji : null;

                // 4c) Build a create-page payload via transformer
                logger.info(`   🛠  Transforming page for target DB "${tagType}"`);
                const payload = await transformTagPage(page, tagType);
                payload.parent = { database_id: targetDbId };

                // 4d) Write into the target DB (Brands/Verticals/Departments)
                logger.info(`   🚀 Writing to target DB (${targetDbId})`);
                const created = await writeToDBB(payload, targetDbId);
                logger.info(`   ✅ Created new page ${created.id} in target.`);

                // After creation, retrieve the new page to log its icon
                let targetPageName = '';
                let targetPageIcon = null;
                try {
                    const destPage = await notion.pages.retrieve({ page_id: created.id });
                    logger.info(`   🖼️  Destination icon: ${JSON.stringify(destPage.icon)}`);
                    targetPageName = destPage.properties[tagType === 'Brand' ? 'Brand Name' : tagType === 'Vertical' ? 'Vertical Name' : 'Name']?.title?.[0]?.plain_text || '';
                    targetPageIcon = destPage.icon?.type === 'emoji' ? destPage.icon.emoji : null;
                } catch (iconErr) {
                    logger.warn(`   ⚠️  Could not fetch destination page icon: ${iconErr.message || iconErr}`);
                }

                // Log after URL
                const afterUrl = `https://notion.so/${created.id.replace(/-/g, '')}`;
                logger.info(`   🔗 After URL: ${afterUrl}`);

                // 4e) Record the migration in link_store under "tags"
                await linkStore.save({
                    sourceId,
                    targetId: created.id,
                    status: 'success',
                    syncedAt: new Date().toISOString(),
                    sourceDbId: GLOBAL_TAGS_DB_ID,
                    sourceDbName,
                    targetDbId,
                    targetDbName,
                    type: sourceType,
                    sourcePageName,
                    sourcePageIcon,
                    targetPageName,
                    targetPageIcon,
                    notes: ''
                }, 'tags');
                logger.info(`   💾 Recorded link (${sourceId} → ${created.id}) under "tags"`);

                migratedCount += 1;
            } catch (err) {
                // 4f) On failure, still save a “fail” entry so we don’t retry endlessly
                logger.error(`   ❌ Failed to migrate related page ${sourceId}`, err);
                await linkStore.save({
                    sourceId,
                    targetId: null,
                    status: 'fail',
                    syncedAt: new Date().toISOString(),
                    sourceDbId: GLOBAL_TAGS_DB_ID,
                    sourceDbName,
                    targetDbId,
                    targetDbName,
                    type: sourceType,
                    sourcePageName: '',
                    sourcePageIcon: null,
                    targetPageName: '',
                    targetPageIcon: null,
                    notes: 'failure during migration'
                }, 'tags');
            }
        }
    }

    logger.info(`\n🏁 Migration complete. Total related pages processed: ${migratedCount}`);
}

// Invoke main(), catching unexpected errors
main().catch((err) => {
    console.error('Fatal error in migrate_tags.js:', err);
    process.exit(1);
});