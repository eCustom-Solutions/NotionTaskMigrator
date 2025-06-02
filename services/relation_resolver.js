// services/relation_resolver.js
// -----------------------------
// General-purpose helper for resolving or creating Notion relation pages.
// For a given target relation field on a database, this will:
//   1. Dynamically fetch the “relation” database ID (cache it).
//   2. For each source name:
//        • Query the relation-database for an existing page whose Name matches.
//        • If found, reuse its page ID.
//        • If not found, create a new page (setting only the Name property).
//   3. Return an array of `{ id: <page-id> }` suitable for a Notion “relation” property.
//
// Usage (from a transformer hook):
//   const { resolveOrCreateRelationPages } = require('../services/relation_resolver');
//   …
//   const relationRefs = await resolveOrCreateRelationPages({
//     targetDbId: CENT_DB_ID,
//     relationPropName: 'People',
//     sourceNames: ['Alice', 'Bob'],
//     nameProp: 'Name'
//   });
//   // relationRefs is now something like:
//   // [ { id: 'xxxx-xxxx-xxxx' }, { id: 'yyyy-yyyy-yyyy' } ]
//
// Notes:
//   • Caches relation DB IDs per (targetDbId, relationPropName) to avoid
//     repeated notion.databases.retrieve calls.
//   • Looks up by exact “Name” match; if multiple pages match, picks the first and logs a warning.
//   • Creates a new page with only the `nameProp` (title) when no existing match is found.
//   • Throws if `relationPropName` is not actually a relation field on `targetDbId`.

const notion = require('./notion_client');
const Bottleneck = require('bottleneck');

// In-memory cache for relation database IDs, keyed by `${targetDbId}|${relationPropName}`
const relationDbCache = {};

/**
 * Fetches (and caches) the database ID that the given relation property points to.
 *
 * @param {string} targetDbId         - The Notion database ID in which the relation property lives.
 * @param {string} relationPropName   - The name of the relation property (e.g. "People", "Brands").
 * @returns {Promise<string>}         - The related database's ID.
 * @throws {Error}                    - If the property doesn’t exist or isn’t a relation.
 */
async function getRelationDbId(targetDbId, relationPropName) {
    const cacheKey = `${targetDbId}|${relationPropName}`;
    if (relationDbCache[cacheKey]) {
        return relationDbCache[cacheKey];
    }

    const dbSchema = await notion.databases.retrieve({ database_id: targetDbId });
    const prop = dbSchema.properties[relationPropName];
    if (!prop) {
        throw new Error(`Property "${relationPropName}" not found on database ${targetDbId}.`);
    }
    if (prop.type !== 'relation' || !prop.relation || !prop.relation.database_id) {
        throw new Error(`Property "${relationPropName}" on database ${targetDbId} is not a relation field.`);
    }

    const relatedDbId = prop.relation.database_id;
    relationDbCache[cacheKey] = relatedDbId;
    return relatedDbId;
}

/**
 * Searches a Notion database for a page whose `nameProp` equals `name`.
 *
 * @param {string} relationDbId    - The ID of the database to query.
 * @param {string} nameProp        - The name of the title property to filter on (usually "Name").
 * @param {string} name            - The exact string to match.
 * @returns {Promise<string|null>} - The first matching page ID, or null if none found.
 */
async function findPageByName(relationDbId, nameProp, name) {
    // Notion filters for a title property look like `{ property: nameProp, title: { equals: name } }`
    const response = await notion.databases.query({
        database_id: relationDbId,
        page_size: 2, // we only need to know if ≥1 exist
        filter: {
            property: nameProp,
            title: {
                equals: name
            }
        }
    });

    if (response.results.length > 1) {
        console.warn(
            `Warning: Multiple pages found in DB ${relationDbId} where "${nameProp}" == "${name}". ` +
            `Using the first result (ID: ${response.results[0].id}).`
        );
    }

    return response.results.length > 0 ? response.results[0].id : null;
}

/**
 * Creates a new page in the given database with only the title property set to `name`.
 *
 * @param {string} relationDbId    - The ID of the database in which to create the page.
 * @param {string} nameProp        - The name of the title property (usually "Name").
 * @param {string} name            - The string value to set on that title property.
 * @returns {Promise<string>}      - The newly created page's ID.
 */
async function createPageWithName(relationDbId, nameProp, name) {
    // Build the minimal “properties” payload for a new page with only a title.
    const properties = {
        [nameProp]: {
            title: [
                {
                    text: {
                        content: name
                    }
                }
            ]
        }
    };

    const response = await notion.pages.create({
        parent: { database_id: relationDbId },
        properties
    });

    return response.id;
}

/**
 * For a list of source names, resolves or creates pages in the target relation database.
 *
 * @param {Object}   options
 * @param {string}   options.targetDbId         - The ID of the database containing the relation property.
 * @param {string}   options.relationPropName   - The name of the relation property on targetDbId.
 * @param {string[]} options.sourceNames        - Array of strings (e.g., ["Alice", "Bob"]) to resolve.
 * @param {string}   options.nameProp           - The title property key in the relation DB (usually "Name").
 * @returns {Promise<string[]>}                 - Array of page IDs, in the same order as `sourceNames`.
 *
 * @throws {Error} If any underlying API calls fail, or if the relation property is misconfigured.
 */
async function resolveOrCreateRelationPages({ targetDbId, relationPropName, sourceNames, nameProp }) {
    if (!Array.isArray(sourceNames)) {
        throw new Error(`sourceNames must be an array of strings.`);
    }

    // 1) Resolve the actual DB ID that this relation property points to (with caching).
    const relationDbId = await getRelationDbId(targetDbId, relationPropName);

    const resolvedIds = [];

    // 2) For each source name, find or create a page.
    for (const name of sourceNames) {
        if (typeof name !== 'string' || name.trim() === '') {
            // Skip empty names; return null or handle as desired.
            continue;
        }

        // 2a) Try to find an existing page by name.
        let pageId = await findPageByName(relationDbId, nameProp, name);

        // 2b) If none found, create a new page with that name.
        if (!pageId) {
            pageId = await createPageWithName(relationDbId, nameProp, name);
            console.log(`Created new relation page in DB ${relationDbId} with ${nameProp}="${name}", ID=${pageId}`);
        }

        resolvedIds.push(pageId);
    }

    return resolvedIds;
}

module.exports = {
    resolveOrCreateRelationPages
};