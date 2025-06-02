// models/Link.js
// --------------
// Basic Link class used by link_store.js
// Represents a mapping from a source page to a target page.

class Link {
    /**
     * @param {string} sourceId
     * @param {string} targetId
     * @param {string} [status='success']
     * @param {string} [syncedAt=now]
     */
    constructor(sourceId, targetId, status = 'success', syncedAt = new Date().toISOString()) {
        this.sourceId = sourceId;
        this.targetId = targetId;
        this.status = status;
        this.syncedAt = syncedAt;
    }
}

module.exports = Link;