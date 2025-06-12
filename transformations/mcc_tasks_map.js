// transformations/mcc_tasks_map.js

const logger = require('../logging/logger');
const notion = require('../services/notion_client');
const { UserStore } = require('../services/user_store');
const linkStore = require('../services/link_store');
const path = require('path');
const { MediaMigrator } = require('../services/media_migrator');
const { handleFileProperty } = require('../services/file_handler');

// Instantiate media migrator and initialize
const mediaMigrator = new MediaMigrator({
  notion,
  tmpDir: path.join(__dirname, '../tmp/page_media'),
  logger,
  maxParallel: 20,
  chunkSizeMB: 19
});
(async () => { await mediaMigrator.init(); })();

// Initialize and cache workspace users
const userStore = new UserStore(notion);
(async () => { await userStore.init(); })();

// Cache source DB select option map for Priority
const PRIORITY_SOURCE_DB_ID = process.env.DUMMY_NOTION_MCC_TASKS_DB_ID;
const priorityIdToNameMap = {};

(async () => {
    try {
        const db = await notion.databases.retrieve({ database_id: PRIORITY_SOURCE_DB_ID });
        const options = db.properties?.Priority?.select?.options || [];
        for (const opt of options) {
            if (opt.id && opt.name) {
                priorityIdToNameMap[opt.id] = opt.name;
            } else {
            }
        }

    } catch (err) {
    }
})();

module.exports = {
    mappings: {
        'Name': 'Name',
        'Status': 'Status (MCC)',
        'Assignee': 'Assignee',
        'Brand': 'Brands',
        'Content Type': 'Content Type',
        'Priority': 'Priority (MCC)',
        'Task Owner': 'Task Owner',
        'Platform': 'Platform',
        'Series': 'Series',
        'Posting Date': 'Posting Date',
        'Design Due Date': 'Design Due Date',
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
        // Rename Design Due Date to Design Due Date (MCC) in the final payload
        'Design Due Date': async (sourceValue) => {
            // Pass through the value as-is; mapping already renames the field
            // This hook is here for logging/traceability
            logger.info('Renaming "Design Due Date" to "Design Due Date (MCC)"');
            return sourceValue;
        },
        // Normalize Status: drop source ID, keep only name
        'Status (MCC)': async (sourceValue) => {
          if (!sourceValue || !sourceValue.status || !sourceValue.status.name) {
            return { status: null };
          }
          return { status: { name: sourceValue.status.name } };
        },
        // Map Assignee → Derious Vaughn by name lookup
        Assignee: async (sourceValue) => {
            // sourceValue may be a people or text field; override with fixed user
            const userId = userStore.getUserIdByName('Derious Vaughn');
            if (!userId) {
                logger.warning('Assignee "Derious Vaughn" not found in user store');
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

        Brands: async (sourceValue) => {
            logger.info('sourceValue', sourceValue);

            let names = [];

            if (Array.isArray(sourceValue.multi_select)) {
                names = sourceValue.multi_select.map(opt => opt.name);
            } else if (sourceValue.select && sourceValue.select.name) {
                names = [sourceValue.select.name];  // Normalize to array
            } else {
                logger.warn('⚠️ Brands field has unexpected format:', JSON.stringify(sourceValue));
            }

            // Brand alias normalization
            const aliasMap = {
                'Settled': 'SettledUSA',
                'Taxvine': 'Tax Vine',
                'HarperKnowsHR': 'HarperknowsHR'
            };
            names = names.map(name => aliasMap[name] || name);

            const relations = [];
            for (const name of names) {
                const link = await linkStore.findBySourcePageName(name, 'tags');
                logger.info('link', link);
                if (link && link.targetId) {
                    relations.push({ id: link.targetId });
                } else {
                    logger.warn(`Brand "${name}" not found in LinkStore, skipping relation`);
                }
            }

            return { relation: relations };
        },

        'Priority (MCC)': async (sourceValue) => {
            const id = sourceValue?.select?.id;
            logger.info('Source id ', id)

            if (!id) {
                logger.info('🟡 No Priority selected on source page; field is null or undefined');
                return { select: null };
            }

            const name = priorityIdToNameMap[id];
            if (!name) {
                logger.warn(`❓ Priority ID "${id}" not found in source schema. Full sourceValue: ${JSON.stringify(sourceValue)}`);
                return { select: null };
            }

            logger.info(`✅ Priority ID "${id}" resolved to name "${name}"`);
            return { select: { name } };
        },

        'Content Type': async (sourceValue) => {
            const types = Array.isArray(sourceValue.multi_select) ? sourceValue.multi_select : [];
            return {
                multi_select: types.map(opt => ({ name: opt.name }))
            };
        },

        Series: async (sourceValue) => {
            if (!sourceValue || !sourceValue.select || !sourceValue.select.name) return { multi_select: [] };
            return { multi_select: [ { name: sourceValue.select.name } ] };
        },

        Platform: async (sourceValue) => {
            const values = Array.isArray(sourceValue.multi_select) ? sourceValue.multi_select : [];
            return {
                multi_select: values.map(opt => ({ name: opt.name }))
            };
        },

        // Always tag migrated tasks with "Master Content Calendar"
        Labels: async () => {
            return {
                multi_select: [
                    { name: 'Master Content Calendar' }
                ]
            };
        },

        // Migrate and re-upload video content files to Notion file_upload objects using handleFileProperty
        'Final Video Content': async (sourceValue) => {
            const files = Array.isArray(sourceValue.files) ? sourceValue.files : [];
            return await handleFileProperty(files, mediaMigrator, logger, 'Final Video Content');
        },
        'Review Link': async (sourceValue) => {
            const files = Array.isArray(sourceValue.files) ? sourceValue.files : [];
            return await handleFileProperty(files, mediaMigrator, logger, 'Review Link');
        },
        'Canva Link': async (sourceValue) => {
            const files = Array.isArray(sourceValue.files) ? sourceValue.files : [];
            return await handleFileProperty(files, mediaMigrator, logger, 'Canva Link');
        },
        'Blog Link': async (sourceValue) => {
            const files = Array.isArray(sourceValue.files) ? sourceValue.files : [];
            return await handleFileProperty(files, mediaMigrator, logger, 'Blog Link');
        },
        'Final Design': async (sourceValue) => {
            const files = Array.isArray(sourceValue.files) ? sourceValue.files : [];
            return await handleFileProperty(files, mediaMigrator, logger, 'Final Design');
        }
    },

    // Optionally adjust the payload after all mappings/hooks have run
    postProcess: async (payload) => {
        // No additional post-processing required for MCC
        return payload;
    }
};