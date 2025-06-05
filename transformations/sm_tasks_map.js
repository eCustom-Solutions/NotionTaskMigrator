// transformations/sm_tasks_map.js
// -------------------------------
const linkStore = require('../services/link_store');
const logger = require('../logging/logger');

module.exports = {
    mappings: {
        'Name':       'Name',
        'Brand':      'Brands',
        'Status':     'Social Media Status',
        // 'Teammates':  'People',   // we’ll keep this as multi-select below
        'Due Date':   'Due',
        'Link':       'Link',
        'Comments':   'Comments',
        'Teammates': 'Teammates',
        // other mappings…
    },

    virtualMappings: [
        'Department',
        'Assignee'
    ],


    hooks: {
        'Social Media Status': (sourceValue) => {
            const name = sourceValue.status?.name;
            return { status: { name: name || null } };
        },

        'Brands': async (sourceValue) => {
            if (!sourceValue.relation || sourceValue.relation.length === 0) {
                logger.info(`ℹ️ No Brands found on source task — skipping.`);
                return { relation: [] };
            }

            const relatedIds = [];

            for (const rel of sourceValue.relation) {
                const sourceId = rel.id;

                try {
                    const link = await linkStore.load(sourceId, 'tags');

                    if (link && link.targetId && link.status === 'success') {
                        relatedIds.push({ id: link.targetId });
                    } else {
                        logger.warn(`⚠️ No successful migration link found for Brand sourceId=${sourceId}. Skipping.`);
                    }
                } catch (err) {
                    logger.error(`❌ Error loading link for Brand sourceId=${sourceId}:`, err.message || err);
                }
            }

            return { relation: relatedIds };
        },

        // Keep Teammates as multi-select: just copy names
        'Teammates': (sourceValue) => {
            // sourceValue.multi_select is an array of { name, color, id }
            const teammateNames = sourceValue.multi_select?.map(opt => opt.name) || [];
            // Return multi_select shape for CENT DB – they’ll get new option IDs automatically.
            return {
                multi_select: teammateNames.map(name => ({ name }))
            };
        },

        'Link': (sourceValue) => {
            const firstFile = sourceValue.files?.[0];
            const firstUrl = firstFile?.external?.url || firstFile?.file?.url || null;
            return { url: firstUrl || null };
        },

        // NEW: Department hook—look up “Social Media” via link store (migrationType = 'tags')
        'Department': async (sourceValue) => {
            // We ignore sourceValue because we always want to assign the “Social Media” department.
            // Attempt to find that department’s link from the tags migration.
            const link = await linkStore.findBySourcePageName('Social Media', 'tags');
            if (link && link.targetId) {
                return { relation: [{ id: link.targetId }] };
            } else {
                console.warn(
                    '⚠️  Could not find a "Social Media" link under tags. ' +
                    'Please ensure that the “Social Media” department was migrated in migrate_tags.js.'
                );
                return { relation: [] };
            }
        },

        // NEW: Assignee hook (hardcoded to Derious Vaughn for now)
        'Assignee': async () => {
            const DERIOUS_VAUGHN_ID = process.env.DERIOUS_VAUGHN_ID;
            if (DERIOUS_VAUGHN_ID) {
                return {
                    people: [
                        { object: 'user', id: DERIOUS_VAUGHN_ID }
                    ]
                };
            } else {
                console.warn('⚠️  Missing DERIOUS_VAUGHN_ID in .env; skipping Assignee.');
                return { people: [] };
            }
        }
    },

    postProcess: async (payload) => {
        // If you still need a fallback or override, you can adjust here.
        // But since we do it in the hook, you may not need anything in postProcess.
        return payload;
    }
};