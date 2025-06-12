// transformations/task_transformer.js
// --------------------------------------
// A generic transformer that, given a Notion page and a mapping spec,
// builds the `properties` payload for creating/updating a page in the target DB.

const path = require('path');
const os = require('os');
const notion = require('../services/notion_client');
const logger = require('../logging/logger');
const sanitizeBlocks = require('../services/block_sanitizer');
const { MediaMigrator } = require('../services/media_migrator');
const tmpDir = path.resolve(process.cwd(), 'tmp', 'page_media');
logger.info('tmpDir', tmpDir);
const mediaMigrator = new MediaMigrator({
    notion,
    tmpDir: tmpDir,
    logger,
    maxParallel: 10,
    chunkSizeMB: 19
});

module.exports = async function transform(page, map) {
    const result = {properties: {}};

    for (const [sourceKey, targetKey] of Object.entries(map.mappings)) {
        const sourceValue = page.properties[sourceKey];
        if (sourceValue == null) {
            // no such property on source page
            continue;
        }

        if (map.hooks && typeof map.hooks[targetKey] === 'function') {
            const hookResult = await map.hooks[targetKey](sourceValue);
            result.properties[targetKey] = hookResult;
        } else {
            const type = sourceValue.type;

            if (type === 'title') {
                result.properties[targetKey] = {
                    title: sourceValue.title
                };
            } else if (!type) {
                logger.error(`❗ sourceValue.type is undefined for property "${sourceKey}"`);
                logger.error(`→ sourceValue was:`, sourceValue);
                throw new Error(`Cannot infer type for property "${sourceKey}"`);
            } else {
                result.properties[targetKey] = { [type]: sourceValue[type] };
            }
        }
    }

// --- virtual fields ---
    if (Array.isArray(map.virtualMappings)) {
        for (const targetKey of map.virtualMappings) {
            if (map.hooks && typeof map.hooks[targetKey] === 'function') {
                const hookResult = await map.hooks[targetKey](/* undefined or null */);
                result.properties[targetKey] = hookResult;
            } else {
                logger.warn(`⚠️ No hook defined for virtualMapping "${targetKey}" — skipping`);
            }
        }
    }

    // Optional post-processing hook
    if (typeof map.postProcess === 'function') {
        await map.postProcess(result, page);
    }

    // Optional: skip copying blocks if map opts in
    const skipBlocks = map?.options?.skipBlocks === true;
    let blocks;
    if (!skipBlocks) {
        // Fetch and attach blocks (page contents)
        blocks = [];
        let cursor = undefined;

        do {
            const response = await notion.blocks.children.list({
                block_id: page.id,
                page_size: 100,
                start_cursor: cursor
            });

            blocks.push(...response.results);
            cursor = response.has_more ? response.next_cursor : undefined;
        } while (cursor);
    }
    if (!skipBlocks && blocks?.length > 0) {
        const sanitizedBlocks = sanitizeBlocks(blocks);
        const mediaResolvedBlocks = await mediaMigrator.transformMediaBlocks(null, sanitizedBlocks);

        result.children = mediaResolvedBlocks;
    }

    return result;
};