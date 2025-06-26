// transformations/task_transformer.js
// -----------------------------------
// Builds a task payload (properties, icon, cover, raw block tree).
// **No writing or media work happens here anymore.**

const notion  = require('../services/notion_client');

/* ── internal helper ──────────────────────────────────────────────── */
async function fetchBlockTree(blockId) {
    let cursor, out = [];
    do {
        const res = await notion.blocks.children.list({ block_id: blockId, page_size: 100, start_cursor: cursor });
        const expanded = await Promise.all(
            res.results.map(async blk => blk.has_children
                ? { ...blk, children: await fetchBlockTree(blk.id) }
                : blk)
        );
        out.push(...expanded);
        cursor = res.has_more ? res.next_cursor : undefined;
    } while (cursor);
    return out;
}

/* ── main transform function ─────────────────────────────────────── */
module.exports = async function transform(page, map, logger) {
    const result = { properties: {} };
    logger?.trace({ pageId: page?.id }, 'Entering transform() in task_transformer.js');

    logger?.trace('Running direct and hooked field mappings');
    // ── 1. DIRECT & HOOKED FIELD MAPPINGS ────────────────────────────
    for (const [srcKey, tgtKey] of Object.entries(map.mappings)) {
        const srcVal = page.properties[srcKey];
        if (srcVal == null) continue;

        if (map.hooks?.[tgtKey]) {
            result.properties[tgtKey] = await map.hooks[tgtKey](srcVal);
            continue;
        }

        const t = srcVal.type;
        if (!t) {
            logger.error(`❗ Unknown type for "${srcKey}" →`, srcVal);
            throw new Error(`Cannot infer type for property "${srcKey}"`);
        }
        result.properties[tgtKey] = t === 'title' ? { title: srcVal.title } : { [t]: srcVal[t] };
    }

    logger?.trace('Running virtual field mappings');
    // ── 2. VIRTUAL FIELDS ────────────────────────────────────────────
    if (Array.isArray(map.virtualMappings)) {
        for (const vKey of map.virtualMappings) {
            if (map.hooks?.[vKey]) {
                result.properties[vKey] = await map.hooks[vKey]();
            } else {
                logger.warn(`⚠️ No hook for virtual field "${vKey}" – skipping`);
            }
        }
    }

    logger?.trace('Running optional post-process step');
    // ── 3. OPTIONAL POST-PROCESS ─────────────────────────────────────
    if (typeof map.postProcess === 'function') {
        await map.postProcess(result, page);
    }

    logger?.trace('Copying icon and cover');
    // ── 4. ICON / COVER COPY ─────────────────────────────────────────
    if (page.icon)  result.icon  = page.icon;
    if (page.cover) result.cover = page.cover;

    logger?.trace('Fetching block tree if not skipped');
    // ── 5. BLOCK TREE (raw) ──────────────────────────────────────────
    if (!map?.options?.skipBlocks) {
        result.children = await fetchBlockTree(page.id); // leave sanitizing/media to write_task.js
    }

    logger?.trace({ pageId: page?.id }, 'Exiting transform() in task_transformer.js');
    return result;
};