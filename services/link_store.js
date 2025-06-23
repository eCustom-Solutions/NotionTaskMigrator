// services/link_store.js
// ---------------------
// Tracks which source pages have been migrated by sharding each Link into its own JSON file.

const fs = require('fs').promises;
const path = require('path');
const Link = require('../models/Link');
const logger = require('../logging/logger');

const LINKS_DIR = path.resolve(__dirname, '../links');
const DEFAULT_MIGRATION_TYPE = 'tasks';

class LinkStore {
    constructor(dir) {
        this.dir = dir;
        // ensure links directory exists
        fs.mkdir(this.dir, { recursive: true }).catch(() => {});
        logger.trace(`Initialized LinkStore with directory: ${this.dir}`);
    }

    // todo: figure out why this function isn't async
    _dirForType(migrationType = DEFAULT_MIGRATION_TYPE) {
        const dir = path.join(this.dir, migrationType);
        fs.mkdir(dir, { recursive: true }).catch(() => {});
        logger.trace(`Resolved directory for migrationType "${migrationType}": ${dir}`);
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
        logger.debug(`Checking existence of sourceId file: ${file}`);
        try {
            await fs.access(file);
            return true;
        } catch {
            logger.debug(`SourceId file does not exist: ${file}`);
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

        // Merge with existing history (if any) for backwards compatibility
        let prevHistory = [];
        try {
            const prevContent = await fs.readFile(file, 'utf-8');
            logger.debug(`Read existing link file for save: ${file}`);
            const prevData = JSON.parse(prevContent);
            prevHistory = prevData.history || [];
        } catch (err) {
            logger.warn(`Failed to read or parse existing link file during save (may be first save): ${file} - ${err.message}`);
            // file didn't exist — first‑time save
        }

        const merged = {
            ...link,
            history: link.history ?? prevHistory
        };

        await fs.writeFile(file, JSON.stringify(merged, null, 2), 'utf-8');
        logger.debug(`Saved link file: ${file}`);
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
        logger.debug(`Loading link file: ${file}`);
        const content = await fs.readFile(file, 'utf-8');
        let data;
        try {
            data = JSON.parse(content);
        } catch (err) {
            logger.warn(`Failed to parse link JSON file: ${file} - ${err.message}`);
            throw err;
        }
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
            notes: data.notes || '',
            history: data.history || []
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
        logger.debug(`Loading raw link file: ${file}`);
        const content = await fs.readFile(file, 'utf-8');
        let data;
        try {
            data = JSON.parse(content);
        } catch (err) {
            logger.warn(`Failed to parse raw link JSON file: ${file} - ${err.message}`);
            throw err;
        }
        return data;
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
        let files;
        try {
            files = await fs.readdir(dir);
            logger.debug(`Read directory for findBySourcePageName: ${dir}`);
        } catch {
            logger.warn(`Failed to read directory for migrationType: ${migrationType}`);
            return null;
        }

        for (const fileName of files) {
            // skip non-JSON files just in case
            if (!fileName.endsWith('.json')) continue;
            const fullPath = path.join(dir, fileName);
            let raw;
            try {
                raw = await fs.readFile(fullPath, 'utf-8');
                logger.debug(`Read file during findBySourcePageName: ${fullPath}`);
            } catch {
                logger.warn(`Failed to read file during findBySourcePageName: ${fullPath}`);
                continue;
            }
            let data;
            try {
                data = JSON.parse(raw);
            } catch {
                logger.warn(`Failed to parse JSON during findBySourcePageName: ${fullPath}`);
                continue;
            }
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
                    notes: data.notes || '',
                    history: data.history || []
                });
            }
        }
        return null;
    }
}

module.exports = new LinkStore(LINKS_DIR);