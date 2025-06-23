// models/Link.js
// --------------
// Extended Link class that preserves full sync history.

class Link {
    /**
     * @param {object} params
     * @param {string} params.sourceId
     * @param {string} params.targetId
     * @param {string} [params.status='success']
     * @param {string} [params.syncedAt=now]
     * @param {string} params.sourceDbId
     * @param {string} params.sourceDbName
     * @param {string} params.targetDbId
     * @param {string} params.targetDbName
     * @param {string} params.type
     * @param {string} params.sourcePageName
     * @param {object|null} [params.sourcePageIcon=null]
     * @param {string} params.targetPageName
     * @param {object|null} [params.targetPageIcon=null]
     * @param {string} [params.notes='']
     * @param {Array<object>} [params.history=[]] – Previous syncs {targetId,syncedAt,deletedAt,notes}
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
                    notes = '',
                    history = [],
                }) {
        this.sourceId = sourceId;
        this.targetId = targetId;
        this.status   = status;
        this.syncedAt = syncedAt;

        this.sourceDbId   = sourceDbId;
        this.sourceDbName = sourceDbName;
        this.targetDbId   = targetDbId;
        this.targetDbName = targetDbName;

        this.type = type;

        this.sourcePageName = sourcePageName;
        this.sourcePageIcon = sourcePageIcon;
        this.targetPageName = targetPageName;
        this.targetPageIcon = targetPageIcon;

        this.notes   = notes;
        this.history = history;          // 🆕 lineage of prior target pages
    }
}

module.exports = Link;