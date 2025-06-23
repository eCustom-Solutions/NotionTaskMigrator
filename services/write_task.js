// services/write_task.js
// ---------------------
// Creates a Notion page (task) **and** writes its entire block tree—
// including nested child_page recursion—in one call.

const path = require('path');
const notion = require('./notion_client');
const logger = require('../logging/logger');

const sanitizeBlocks   = require('./block_sanitizer');
const { MediaMigrator } = require('./media_migrator');

// ── ONE-TIME MEDIA-MIGRATOR ──────────────────────────────────────────
const mediaMigrator = new MediaMigrator({
    notion,
    tmpDir: path.resolve(process.cwd(), 'tmp', 'page_media'),
    logger,
    maxParallel: 10,
    chunkSizeMB: 19,
});
(async () => {
    try { await mediaMigrator.init(); } catch (e) { logger.warn('MediaMigrator init failed', e); }
})();

// ── UTILITIES ────────────────────────────────────────────────────────
function stripNestedChildren({ children, ...block }) {
    // Remove the read-only `children` array before writing
    return block;
}

// Retry wrapper for occasional Notion conflict errors
async function safeAppendBlocks(parentId, blocks, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            return await notion.blocks.children.append({ block_id: parentId, children: blocks });
        } catch (err) {
            if (err.code === 'conflict_error' && i < retries - 1) {
                logger.warn(`🔁 Conflict on ${parentId}, retrying (${i + 1})…`);
                await new Promise(r => setTimeout(r, 500 * (i + 1)));
                continue;
            }
            throw err;
        }
    }
}

// Recursively writes block trees (handles child_page blocks natively)
async function appendBlocksRecursively(parentId, blocks) {
    const q = blocks.map(b => ({ parentId, block: b }));

    while (q.length) {
        const { parentId: pid, block } = q.shift();

        // Handle nested pages
        if (block.type === 'child_page') {
            const pagePayload = {
                parent: { page_id: pid },
                properties: { title: [{ type: 'text', text: { content: block.child_page.title } }] },
            };
            const childPage = await notion.pages.create(pagePayload);
            if (block.children?.length) {
                q.push(...block.children.map(c => ({ parentId: childPage.id, block: c })));
            }
            continue;
        }

        // Normal block path
        const res = await safeAppendBlocks(pid, [stripNestedChildren(block)]);
        const createdBlockId = res.results?.[0]?.id;

        if (block.children?.length && createdBlockId) {
            q.push(...block.children.map(c => ({ parentId: createdBlockId, block: c })));
        }
    }
}

// ── MAIN ENTRYPOINT ──────────────────────────────────────────────────
/**
 * @param {object} transformedTask – { properties, children?, icon?, cover? }
 * @param {string} dbId            – target Notion DB ID
 * @returns {Promise<object>}      – Notion page object
 */
async function writeToDBB(transformedTask, dbId) {
    logger.info(`Starting writeToDBB for dbId ${dbId}`);
    const payload = {
        parent: { database_id: dbId },
        properties: transformedTask.properties,
    };
    if (transformedTask.icon) {
        logger.debug('Assigning icon to page payload');
        payload.icon = transformedTask.icon;
    }
    if (transformedTask.cover) {
        logger.debug('Assigning cover to page payload');
        payload.cover = transformedTask.cover;
    }

    logger.debug('Creating Notion page with payload');
    const page = await notion.pages.create(payload);
    logger.debug(`Created Notion page with id ${page.id}`);

    if (transformedTask.children?.length) {
        logger.debug('Sanitizing children blocks');
        // 1) clean up unsupported blocks
        const sanitized = sanitizeBlocks(transformedTask.children);
        logger.debug('Transforming media blocks');
        // 2) resolve media → file_upload blocks
        const mediaReady = await mediaMigrator.transformMediaBlocks(page.id, sanitized);
        logger.debug('Appending blocks recursively (including nested pages/blocks)');
        // 3) write everything, including nested pages/blocks
        await appendBlocksRecursively(page.id, mediaReady);
    } else {
        logger.warn('No children blocks to write after page creation');
    }

    logger.info(`Finished writeToDBB for dbId ${dbId}, pageId ${page.id}`);
    return page;
}

module.exports = { writeToDBB };