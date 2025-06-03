// transformations/tag_transformer.js

const notion = require('../services/notion_client');

module.exports = async function transformTagPage(page, targetType) {
    // Log source page icon for visibility
    console.log('Source page icon:', page.icon);

    // Determine the title property key based on targetType
    let titleKey;
    if (targetType === 'Brand') {
        titleKey = 'Brand Name';
    } else if (targetType === 'Vertical') {
        titleKey = 'Vertical Name';
    } else if (targetType === 'Team') {
        titleKey = 'Name';
    } else {
        // Fallback if an unexpected type is passed
        titleKey = 'Name';
    }

    // ── Build a minimal payload object
    // The calling code will set `parent.database_id` before using this.
    const result = {
        parent: {},        // ⬅︎ caller will fill in the correct target DB ID
        properties: {
            // Copy the Title property from the source page's 'Tag' property
            [titleKey]: {
                title: page.properties['Tag']?.title || []
            }
        }
    };

    // ── Copy over the emoji/icon if one is present
    if (page.icon && page.icon.type === 'emoji') {
        result.icon = {
            type: 'emoji',
            emoji: page.icon.emoji
        };
    }

    // ── Fetch all of this page’s child blocks (if any)
    //    We iterate with pagination (page_size=100) to pull every block.
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

    // If we found any blocks, attach them as `children` in the payload
    if (blocks.length > 0) {
        result.children = blocks;
    }

    return result;
};