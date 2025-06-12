// services/link_store.js
// ---------------------
// Tracks which source pages have been migrated by sharding each Link into its own JSON file.

const fs = require('fs').promises;
const path = require('path');
const Link = require('../models/Link');

const LINKS_DIR = path.resolve(__dirname, '../links');
const DEFAULT_MIGRATION_TYPE = 'tasks';

class LinkStore {
    constructor(dir) {
        this.dir = dir;
        // ensure links directory exists
        fs.mkdir(this.dir, { recursive: true }).catch(() => {});
    }

    // todo: figure out why this function isn't async
    _dirForType(migrationType = DEFAULT_MIGRATION_TYPE) {
        const dir = path.join(this.dir, migrationType);
        fs.mkdir(dir, { recursive: true }).catch(() => {});
        return dir;
    }

    /**
     * Check if a given sourceId has already been linked.
     * @param {string} sourceId
     * @param {string} migrationType
     * @returns {Promise<boolean>}
     */
    async hasSourceId(sourceId, migrationType = DEFAULT_MIGRATION_TYPE) {
        const dir = this._dirForType(migrationType);
        const file = path.join(dir, `${sourceId}.json`);
        try {
            await fs.access(file);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Save a Link object to disk, sharded by sourceId.
     * @param {Link} link
     * @param {string} migrationType
     * @returns {Promise<void>}
     */
    async save(link, migrationType = DEFAULT_MIGRATION_TYPE) {
        const dir = this._dirForType(migrationType);
        const file = path.join(dir, `${link.sourceId}.json`);
        // Write full Link object as JSON
        await fs.writeFile(file, JSON.stringify(link, null, 2), 'utf-8');
    }

    /**
     * Load an existing Link by sourceId, instantiate a Link object.
     * @param {string} sourceId
     * @param {string} migrationType
     * @returns {Promise<Link>}
     */
    async load(sourceId, migrationType = DEFAULT_MIGRATION_TYPE) {
        const dir = this._dirForType(migrationType);
        const file = path.join(dir, `${sourceId}.json`);
        const content = await fs.readFile(file, 'utf-8');
        const data = JSON.parse(content);
        // Instantiate Link with full metadata
        return new Link({
            sourceId: data.sourceId,
            targetId: data.targetId,
            status: data.status,
            syncedAt: data.syncedAt,
            sourceDbId: data.sourceDbId,
            sourceDbName: data.sourceDbName,
            targetDbId: data.targetDbId,
            targetDbName: data.targetDbName,
            type: data.type,
            sourcePageName: data.sourcePageName,
            sourcePageIcon: data.sourcePageIcon || null,
            targetPageName: data.targetPageName,
            targetPageIcon: data.targetPageIcon || null,
            notes: data.notes || ''
        });
    }

    /**
     * Load raw JSON for debugging (without instantiating Link).
     * @param {string} sourceId
     * @param {string} migrationType
     * @returns {Promise<object>}
     */
    async loadRaw(sourceId, migrationType = DEFAULT_MIGRATION_TYPE) {
        const dir = this._dirForType(migrationType);
        const file = path.join(dir, `${sourceId}.json`);
        const content = await fs.readFile(file, 'utf-8');
        return JSON.parse(content);
    }

    /**
     * Find a Link by its sourcePageName under a given migration type.
     * Returns the first match, or null if none found.
     *
     * @param {string} sourcePageName
     * @param {string} migrationType
     * @returns {Promise<Link|null>}
     */
    async findBySourcePageName(sourcePageName, migrationType = DEFAULT_MIGRATION_TYPE) {
        const dir = this._dirForType(migrationType);
        console.info(`[LinkStore] Searching for "${sourcePageName}" in "${dir}"`);
        let files;
        try {
            files = await fs.readdir(dir);
        } catch {
            return null;
        }

        for (const fileName of files) {
            // skip non-JSON files just in case
            if (!fileName.endsWith('.json')) continue;
            const fullPath = path.join(dir, fileName);
            let raw;
            try {
                raw = await fs.readFile(fullPath, 'utf-8');
            } catch {
                continue;
            }
            let data;
            try {
                data = JSON.parse(raw);
            } catch {
                continue;
            }
            console.info(`[LinkStore] Checking file "${fileName}" with sourcePageName="${data.sourcePageName}" and status="${data.status}"`);
            // If sourcePageName field matches exactly, instantiate and return
            if (data.sourcePageName === sourcePageName && data.status === 'success') {
                return new Link({
                    sourceId: data.sourceId,
                    targetId: data.targetId,
                    status: data.status,
                    syncedAt: data.syncedAt,
                    sourceDbId: data.sourceDbId,
                    sourceDbName: data.sourceDbName,
                    targetDbId: data.targetDbId,
                    targetDbName: data.targetDbName,
                    type: data.type,
                    sourcePageName: data.sourcePageName,
                    sourcePageIcon: data.sourcePageIcon || null,
                    targetPageName: data.targetPageName,
                    targetPageIcon: data.targetPageIcon || null,
                    notes: data.notes || ''
                });
            }
        }
        console.warn(`[LinkStore] No match found for "${sourcePageName}" in "${dir}"`);
        return null;
    }
}

module.exports = new LinkStore(LINKS_DIR);