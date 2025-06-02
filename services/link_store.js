// services/link_store.js
// ---------------------
// Tracks which source pages have been migrated by sharding each Link into its own JSON file.

const fs = require('fs').promises;
const path = require('path');
const Link = require('../models/Link');

const LINKS_DIR = path.resolve(__dirname, '../links');

class LinkStore {
    constructor(dir) {
        this.dir = dir;
        // ensure links directory exists
        fs.mkdir(this.dir, { recursive: true }).catch(() => {});
    }

    /**
     * Check if a given sourceId has already been linked.
     * @param {string} sourceId
     * @returns {Promise<boolean>}
     */
    async hasSourceId(sourceId) {
        const file = path.join(this.dir, `${sourceId}.json`);
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
     * @returns {Promise<void>}
     */
    async save(link) {
        const file = path.join(this.dir, `${link.sourceId}.json`);
        await fs.writeFile(file, JSON.stringify(link, null, 2), 'utf-8');
    }

    /**
     * (Optional) Load an existing Link by sourceId.
     * @param {string} sourceId
     * @returns {Promise<Link>}
     */
    async load(sourceId) {
        const file = path.join(this.dir, `${sourceId}.json`);
        const content = await fs.readFile(file, 'utf-8');
        const data = JSON.parse(content);
        return new Link(data.sourceId, data.targetId, data.status, data.syncedAt);
    }
}

module.exports = new LinkStore(LINKS_DIR);