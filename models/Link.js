// models/Link.js
// --------------
// Extended Link class for richer metadata
// Represents a mapping from a source page to a target page, including context.

class Link {
    /**
     * @param {object} params
     * @param {string} params.sourceId           – Source page ID in Notion
     * @param {string} params.targetId           – Target page ID in Notion
     * @param {string} [params.status='success'] – 'success' or 'fail'
     * @param {string} [params.syncedAt=now]     – ISO timestamp when synced
     * @param {string} params.sourceDbId         – Source database ID (Notion)
     * @param {string} params.sourceDbName       – Source database name (title)
     * @param {string} params.targetDbId         – Target database ID (Notion)
     * @param {string} params.targetDbName       – Target database name (title)
     * @param {string} params.type               – Migration type (e.g., 'Brand', 'Task', etc.)
     * @param {string} params.sourcePageName     – Title of the source page at migration time
     * @param {object|null} [params.sourcePageIcon=null] – Full icon object from source page, if any
     * @param {string} params.targetPageName     – Title of the target page at migration time
     * @param {object|null} [params.targetPageIcon=null] – Full icon object from target page, if any
     * @param {string} [params.notes='']         – Optional free-text notes
     */
    constructor({
                    sourceId,
                    targetId,
                    status = 'success',
                    syncedAt = new Date().toISOString(),
                    sourceDbId,
                    sourceDbName,
                    targetDbId,
                    targetDbName,
                    type,
                    sourcePageName,
                    sourcePageIcon = null,
                    targetPageName,
                    targetPageIcon = null,
                    notes = ''
                }) {
        // Required IDs
        this.sourceId = sourceId;
        this.targetId = targetId;

        // Status and timestamp
        this.status = status;
        this.syncedAt = syncedAt;

        // Database context
        this.sourceDbId = sourceDbId;
        this.sourceDbName = sourceDbName;
        this.targetDbId = targetDbId;
        this.targetDbName = targetDbName;

        // Semantic migration type
        this.type = type;

        // Page metadata for human legibility
        this.sourcePageName = sourcePageName;
        this.sourcePageIcon = sourcePageIcon;   // ⬅ now holds full icon object or null
        this.targetPageName = targetPageName;
        this.targetPageIcon = targetPageIcon;   // ⬅ now holds full icon object or null

        // Optional notes
        this.notes = notes;
    }
}

module.exports = Link;