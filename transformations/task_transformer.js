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
const mediaMigrator = new MediaMigrator({
    notion,
    tmpDir: tmpDir,
    logger,
    maxParallel: 10,
    chunkSizeMB: 19
});

async function fetchBlockTree(blockId) {
    let blocks = [];
    let cursor;

    do {
        const response = await notion.blocks.children.list({
            block_id: blockId,
            page_size: 100,
            start_cursor: cursor
        });

        const childBlocks = await Promise.all(
            response.results.map(async block => {
                if (block.has_children) {
                    const nestedChildren = await fetchBlockTree(block.id);
                    return { ...block, children: nestedChildren };
                }
                return block;
            })
        );

        blocks.push(...childBlocks);
        cursor = response.has_more ? response.next_cursor : undefined;
    } while (cursor);

    return blocks;
}

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

    if (!skipBlocks) {
        const recursiveBlocks = await fetchBlockTree(page.id);
        const sanitizedBlocks = sanitizeBlocks(recursiveBlocks);
        const mediaResolvedBlocks = await mediaMigrator.transformMediaBlocks(null, sanitizedBlocks);
        result.children = mediaResolvedBlocks;
    }

    return result;
};

// Retries Notion block appends on conflict_error
async function safeAppendBlocks(parentId, children, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            return await notion.blocks.children.append({
                block_id: parentId,
                children
            });
        } catch (err) {
            if (err.code === 'conflict_error' && i < retries - 1) {
                logger.warn(`🔁 Conflict on ${parentId}, retrying (${i + 1})`);
                await new Promise(resolve => setTimeout(resolve, 500 * (i + 1)));
                continue;
            }
            throw err;
        }
    }
}

// Recursively appends blocks to a page using Notion's API, preserving hierarchy, in serialized order.
async function writePageWithBlocks(pageId, children) {
    const queue = children.map(block => ({ parentId: pageId, block }));

    while (queue.length > 0) {
        const { parentId, block } = queue.shift();

        const response = await safeAppendBlocks(parentId, [stripNestedChildren(block)]);

        const createdBlock = response.results[0];
        if (block.children?.length) {
            block.children.forEach(child => {
                queue.push({ parentId: createdBlock.id, block: child });
            });
        }
    }
}

function stripNestedChildren({ children, ...rest }) {
    return rest;
}

module.exports.writePageWithBlocks = writePageWithBlocks;