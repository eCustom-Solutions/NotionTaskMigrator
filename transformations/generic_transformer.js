// transformations/generic_transformer.js
// --------------------------------------
// A generic transformer that, given a Notion page and a mapping spec,
// builds the `properties` payload for creating/updating a page in the target DB.

const notion = require('../services/notion_client');

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
                console.error(`❗ sourceValue.type is undefined for property "${sourceKey}"`);
                console.error(`→ sourceValue was:`, sourceValue);
                throw new Error(`Cannot infer type for property "${sourceKey}"`);
            } else {
                result.properties[targetKey] = { [type]: sourceValue[type] };
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
        // Fetch and attach blocks (page contents)
        const blocks = [];
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

        if (blocks.length > 0) {
            result.children = blocks;
        }
    }

    return result;
};