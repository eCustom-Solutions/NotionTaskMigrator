// transformations/mcc_tasks_map.js

const logger = require('../logging/logger');
const notion = require('../services/notion_client');
const { UserStore } = require('../services/user_store');
const linkStore = require('../services/link_store');

// Initialize and cache workspace users
const userStore = new UserStore(notion);
(async () => { await userStore.init(); })();

module.exports = {
    mappings: {
        'Name': 'Name',
        'Status': 'Status (MCC)',
        'Assignee': 'Assignee',
        'Brand': 'Brands',
        'Content Type': 'Content Type',
        'Priority': 'Priority',
        'Task Owner': 'Task Owner',
        'Platform': 'Platform',
        'Series': 'Series',
        'Posting Date': 'Posting Date',
        'Design Due Date': 'Design Due Date (MCC)',
        'Caption': 'Caption',
        'Instructions': 'Instructions',
        'Date Assigned': 'Date Assigned',
        'Final Video Content': 'Final Video Content',
        'Review Link': 'Review Link',
        'Canva Link': 'Canva Link',
        'Blog Link': 'Blog Link',
        'Final Design': 'Final Design',
        'Google Drive File': 'Google Drive File'
        // Created time and Finished time are intentionally skipped
    },

    // Always add this label
    virtualMappings: [
        'Labels'
    ],

    hooks: {
        // Map Assignee → Derious Vaughn by name lookup
        Assignee: async (sourceValue) => {
            // sourceValue may be a people or text field; override with fixed user
            const userId = userStore.getUserIdByName('Derious Vaughn');
            if (!userId) {
                logger.warn('Assignee "Derious Vaughn" not found in user store');
                return { people: [] };
            }
            return { people: [ { object: 'user', id: userId } ] };
        },

        // Map Task Owner → Derious Vaughn as well
        'Task Owner': async (sourceValue) => {
            const userId = userStore.getUserIdByName('Derious Vaughn');
            if (!userId) {
                logger.warn('Task Owner "Derious Vaughn" not found in user store');
                return { people: [] };
            }
            return { people: [ { object: 'user', id: userId } ] };
        },

        // Convert Brand multi-select names to relations via LinkStore
        Brands: async (sourceValue) => {
            const names = Array.isArray(sourceValue.multi_select)
                ? sourceValue.multi_select.map(opt => opt.name)
                : [];
            const relations = [];
            for (const name of names) {
                const link = linkStore.findBySourcePageName(name, 'tags');
                if (link && link.targetPageId) {
                    relations.push({ id: link.targetPageId });
                } else {
                    logger.warn(`Brand "${name}" not found in LinkStore, skipping relation`);
                }
            }
            return { relation: relations };
        },

        // Always tag migrated tasks with "Master Content Calendar"
        Labels: async () => {
            return {
                multi_select: [
                    { name: 'Master Content Calendar' }
                ]
            };
        }
    },

    // Optionally adjust the payload after all mappings/hooks have run
    postProcess: async (payload) => {
        // No additional post-processing required for MCC
        return payload;
    }
};