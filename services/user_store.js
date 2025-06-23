// services/user_store.js

const logger = require('../logging/logger');

/**
 * A simple in-memory cache of Notion workspace users.
 * Polls the Notion API once upon init and caches results.
 */
class UserStore {
  /**
   * @param {import('@notionhq/client').Client} notionClient - Throttled Notion API client instance.
   */
  constructor(notionClient) {
    this.client = notionClient;
    this.users = null;
  }

  /**
   * Initialize the user cache by polling the Notion API.
   * Should be called once before lookups.
   * @returns {Promise<UserStore>}
   */
  async init() {
    if (this.users !== null) {
      return this;
    }
    logger.debug('UserStore initialization started.');
    this.users = [];
    let cursor = undefined;

    // Paginate through all users
    do {
      const response = await this.client.users.list({
        page_size: 100,
        start_cursor: cursor,
      });
      this.users.push(...response.results);
      cursor = response.next_cursor;
    } while (cursor);

    logger.debug(`UserStore initialization completed. Fetched ${this.users.length} users.`);
    return this;
  }

  /**
   * Find a user by their name (case-insensitive exact match).
   * @param {string} name
   * @returns {string|null} - Notion user ID or null if not found.
   */
  getUserIdByName(name) {
    if (!this.users) {
      throw new Error('UserStore not initialized. Call init() before lookups.');
    }
    const match = this.users.find(
      u => u.name && u.name.toLowerCase() === name.toLowerCase()
    );
    if (!match) {
      logger.debug(`UserStore: No user found with name "${name}".`);
    }
    return match ? match.id : null;
  }

  /**
   * Find a user by their email (case-insensitive).
   * @param {string} email
   * @returns {string|null} - Notion user ID or null if not found.
   */
  getUserIdByEmail(email) {
    if (!this.users) {
      throw new Error('UserStore not initialized. Call init() before lookups.');
    }
    const match = this.users.find(
      u => u.person && u.person.email && u.person.email.toLowerCase() === email.toLowerCase()
    );
    if (!match) {
      logger.debug(`UserStore: No user found with email "${email}".`);
    }
    return match ? match.id : null;
  }

  /**
   * Return the full list of cached users.
   * @returns {Array<Object>}
   */
  getAllUsers() {
    if (!this.users) {
      throw new Error('UserStore not initialized. Call init() before lookups.');
    }
    return this.users;
  }
}

module.exports = { UserStore };