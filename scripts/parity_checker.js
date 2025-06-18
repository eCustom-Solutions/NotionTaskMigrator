/**
 * parity_checker.js
 *
 * Usage:
 *   node parity_checker.js SOURCE_DB_ID TARGET_DB_ID
 *
 * Output:
 *   {
 *     missingInTarget: [ … ],
 *     extraInTarget:   [ … ],
 *     mismatches: [
 *       {
 *         pageId: "...",
 *         title:  "...",
 *         diffs: [
 *           { field: "properties.Status", source: "In Progress", target: "Done" },
 *           { field: "blocks[2].text",  source: "foo",           target: "bar" }
 *         ]
 *       }, …
 *     ]
 *   }
 */

const { isDeepStrictEqual } = require('node:util');
const notion = require('../services/notion_client');  // still correct
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const SOURCE_DB_ID = process.env.NOTION_MCC_TASKS_DB_ID;
const TARGET_DB_ID = process.env.NOTION_CENT_DB_ID;


if (!SOURCE_DB_ID || !TARGET_DB_ID) {
    console.log("SOURCE_DB_ID", SOURCE_DB_ID);
    console.log("TARGET_DB_ID", TARGET_DB_ID);
    console.error('Usage: node parity_checker.js <source-db-id> <target-db-id>');
    process.exit(1);
}


/** Fetch all pages from a database (handles pagination) */
async function fetchAllPages(dbId) {
    let pages = [];
    let cursor;
    do {
        const res = await notion.databases.query({
            database_id: dbId,
            start_cursor: cursor,
        });
        pages = pages.concat(res.results);
        cursor = res.has_more ? res.next_cursor : null;
    } while (cursor);
    return pages;
}

/** Recursively fetch and flatten all blocks under a page */
async function fetchAllBlocks(pageId) {
    let blocks = [];
    let cursor;
    do {
        const res = await notion.blocks.children.list({
            block_id: pageId,
            start_cursor: cursor,
        });
        blocks = blocks.concat(res.results);
        cursor = res.has_more ? res.next_cursor : null;
    } while (cursor);
    // for deeper nesting, you could recurse here—but for simple top-level parity this may suffice
    return blocks.map(b => ({
        type: b.type,
        content: JSON.stringify(b[b.type])
    }));
}

/** Deep-diff two objects; returns list of { path, a, b } */
function diffProps(a, b, path = '') {
    if (isDeepStrictEqual(a, b)) return [];
    if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) {
        return [{ path, source: a, target: b }];
    }
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].flatMap(key =>
        diffProps(a[key], b[key], path ? `${path}.${key}` : key)
    );
}

(async () => {
    console.log('Fetching pages…');
    const [srcPages, tgtPages] = await Promise.all([
        fetchAllPages(SOURCE_DB_ID),
        fetchAllPages(TARGET_DB_ID),
    ]);

    const srcMap = new Map(srcPages.map(p => [p.id, p]));
    const tgtMap = new Map(tgtPages.map(p => [p.id, p]));

    const missingInTarget = [];
    const extraInTarget   = [];
    const mismatches      = [];

    // Existence
    for (let id of srcMap.keys()) {
        if (!tgtMap.has(id)) missingInTarget.push({ pageId: id, title: srcMap.get(id).properties.Name.title[0]?.plain_text });
    }
    for (let id of tgtMap.keys()) {
        if (!srcMap.has(id)) extraInTarget.push({ pageId: id, title: tgtMap.get(id).properties.Name.title[0]?.plain_text });
    }

    // Content checks
    for (let [id, srcPage] of srcMap.entries()) {
        if (!tgtMap.has(id)) continue;
        const tgtPage = tgtMap.get(id);

        let diffs = [];

        // 1) Properties (skip metadata)
        const pickProps = obj => {
            const { Created_time, Last_edited_time, ...rest } = obj;
            return rest;
        };
        diffs = diffs.concat(
            diffProps(
                pickProps(srcPage.properties),
                pickProps(tgtPage.properties),
                'properties'
            )
        );

        // 2) Blocks
        const [srcBlocks, tgtBlocks] = await Promise.all([
            fetchAllBlocks(srcPage.id),
            fetchAllBlocks(tgtPage.id)
        ]);
        const maxLen = Math.max(srcBlocks.length, tgtBlocks.length);
        for (let i = 0; i < maxLen; i++) {
            const a = srcBlocks[i] || {};
            const b = tgtBlocks[i] || {};
            if (!isDeepStrictEqual(a, b)) {
                diffs.push({
                    path: `blocks[${i}]`,
                    source: a,
                    target: b
                });
            }
        }

        if (diffs.length) {
            mismatches.push({
                pageId: id,
                title: srcPage.properties.Name.title[0]?.plain_text,
                issues: diffs
            });
        }
    }

    // Final report
    const report = { missingInTarget, extraInTarget, mismatches };
    console.log(JSON.stringify(report, null, 2));
})();