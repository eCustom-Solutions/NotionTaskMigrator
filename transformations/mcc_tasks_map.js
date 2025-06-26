// transformations/mcc_tasks_map.js

const logger = require('../logging/logger');
const taskLog = logger.child({ module: 'MCC_TASKS_MAP' });
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
const PRIORITY_SOURCE_DB_ID = process.env.NOTION_MCC_TASKS_DB_ID;
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
        // 'Assignee': 'Assignee',
        'Brand': 'Brands',
        'Content Type': 'Content Type',
        'Priority': 'Priority (MCC)',
        // 'Task Owner': 'Task Owner',
        'Platform': 'Platform',
        'Series': 'Series',
        'Posting Date': 'Posting Date',
        'Design Due Date': 'Design Due Date',
        'Caption': 'Caption',
        'Instructions': 'Instructions',
        'Date Assigned': 'Date Assigned',
        // 'Final Video Content': 'Final Video Content',
        // 'Review Link': 'Review Link',
        // 'Canva Link': 'Canva Link',
        // 'Blog Link': 'Blog Link',
        // 'Final Design': 'Final Design',
        // 'Google Drive File': 'Google Drive File'
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
            taskLog.debug('Renaming "Design Due Date" to "Design Due Date (MCC)"');
            return sourceValue;
        },
        // Normalize Status: drop source ID, keep only name
        'Status (MCC)': async (sourceValue) => {
          if (!sourceValue || !sourceValue.status || !sourceValue.status.name) {
            return { status: null };
          }
          return { status: { name: sourceValue.status.name } };
        },
        // // Map Assignee dynamically from sourceValue.people, no fallback
        // Assignee: async (sourceValue) => {
        //     const people = Array.isArray(sourceValue.people) ? sourceValue.people : [];
        //     return {
        //         people: people.map(p => ({
        //             object: 'user',
        //             id: p.id
        //         }))
        //     };
        // },

        // // Map Task Owner from sourceValue.people, no fallback
        // 'Task Owner': async (sourceValue) => {
        //     const people = Array.isArray(sourceValue.people) ? sourceValue.people : [];
        //     return {
        //         people: people.map(p => ({
        //             object: 'user',
        //             id: p.id
        //         }))
        //     };
        // },

        Brands: async (sourceValue) => {
            taskLog.debug('🔍 Processing Brands field:', JSON.stringify(sourceValue));

            let names = [];

            if (Array.isArray(sourceValue.multi_select)) {
                names = sourceValue.multi_select.map(opt => opt.name);
            } else if (sourceValue.select && sourceValue.select.name) {
                names = [sourceValue.select.name];  // Normalize to array
            } else {
                taskLog.warn('⚠️ Brands field has unexpected format:', JSON.stringify(sourceValue));
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
                if (link && link.targetId) {
                    relations.push({ id: link.targetId });
                } else {
                    taskLog.warn(`Brand "${name}" not found in LinkStore, skipping relation`);
                }
            }

            return { relation: relations };
        },

        'Priority (MCC)': async (sourceValue) => {
            const id = sourceValue?.select?.id;

            if (!id) {
                taskLog.debug('🟡 No Priority selected on source page; field is null or undefined');
                return { select: null };
            }

            const name = priorityIdToNameMap[id];
            if (!name) {
                taskLog.warn(`❓ Priority ID "${id}" not found in source schema. Full sourceValue: ${JSON.stringify(sourceValue)}`);
                return { select: null };
            }

            taskLog.debug(`✅ Priority ID "${id}" resolved to name "${name}"`);
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
            const result = await handleFileProperty(files, mediaMigrator, logger, 'Final Video Content');
            taskLog.debug(`✅ Processed file upload for "Final Video Content" with ${files.length} files.`);
            return result;
        },
        'Review Link': async (sourceValue) => {
            const files = Array.isArray(sourceValue.files) ? sourceValue.files : [];
            const result = await handleFileProperty(files, mediaMigrator, logger, 'Review Link');
            taskLog.debug(`✅ Processed file upload for "Review Link" with ${files.length} files.`);
            return result;
        },
        'Canva Link': async (sourceValue) => {
            const files = Array.isArray(sourceValue.files) ? sourceValue.files : [];
            const result = await handleFileProperty(files, mediaMigrator, logger, 'Canva Link');
            taskLog.debug(`✅ Processed file upload for "Canva Link" with ${files.length} files.`);
            return result;
        },
        'Blog Link': async (sourceValue) => {
            const files = Array.isArray(sourceValue.files) ? sourceValue.files : [];
            const result = await handleFileProperty(files, mediaMigrator, logger, 'Blog Link');
            taskLog.debug(`✅ Processed file upload for "Blog Link" with ${files.length} files.`);
            return result;
        },
        'Final Design': async (sourceValue) => {
            const files = Array.isArray(sourceValue.files) ? sourceValue.files : [];
            const result = await handleFileProperty(files, mediaMigrator, logger, 'Final Design');
            taskLog.debug(`✅ Processed file upload for "Final Design" with ${files.length} files.`);
            return result;
        },

        // Inspect Google Drive file property during migration
        'Google Drive File': async (sourceValue) => {
            taskLog.debug('📂 Google Drive File sourceValue:', JSON.stringify(sourceValue, null, 2));
            return sourceValue;  // pass through untouched for now
        }
    },

    // Optionally adjust the payload after all mappings/hooks have run
    postProcess: async (payload) => {
        // No additional post-processing required for MCC
        return payload;
    }
};