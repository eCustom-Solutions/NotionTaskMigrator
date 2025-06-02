// transformations/sm_tasks_map.js
// -------------------------------

const { resolveOrCreateRelationPages } = require('../services/relation_resolver');

module.exports = {
    mappings: {
        'Name':       'Name',
        'Brand':      'Brands',
        'Status':     'Social Media Status',
        // 'Teammates':  'People',   // source "Teammates" → target "People"
        'Due Date':   'Due',
        'Link':       'Link',
        'Comments':   'Comments',
    },

    hooks: {
        'Social Media Status': (sourceValue) => {
            const name = sourceValue.status?.name;
            return { status: { name: name || null } };
        },
        'Brands': async (sourceValue) => {
            const brandNames = sourceValue.relation?.length > 0
                ? await Promise.all(sourceValue.relation.map(async rel => {
                    // Fetch source Brand page to read its Name
                    const page = await notion.pages.retrieve({ page_id: rel.id });
                    return page.properties['Name']?.title?.[0]?.plain_text || null;
                }))
                : [];

            // Clean out nulls
            const filteredBrandNames = brandNames.filter(Boolean);

            if (filteredBrandNames.length === 0) {
                return { relation: [] };
            }

            const CENT_DB_ID = process.env.NOTION_CENT_DB_ID;

            const pageIds = await resolveOrCreateRelationPages({
                targetDbId: CENT_DB_ID,
                relationPropName: 'Brands',
                sourceNames: filteredBrandNames,
                nameProp: 'Name'
            });

            return { relation: pageIds.map(id => ({ id })) };
        }

        // // Updated People hook to use the relation_resolver
        // 'People': async (sourceValue) => {
        //     // Extract names from the source multi_select “Teammates”
        //     const teammateNames = sourceValue.multi_select?.map(option => option.name) || [];
        //
        //     if (teammateNames.length === 0) {
        //         return null;
        //     }
        //
        //     // Call our helper:
        //     //  • targetDbId: your CENT DB ID (pull from env or pass in context)
        //     //  • relationPropName: “People”
        //     //  • sourceNames: array of teammate names
        //     //  • nameProp: the title property in the People-relation DB (usually "Name")
        //     const CENT_DB_ID = process.env.NOTION_CENT_DB_ID;
        //
        //     const pageIds = await resolveOrCreateRelationPages({
        //         targetDbId: CENT_DB_ID,
        //         relationPropName: 'People',
        //         sourceNames: teammateNames,
        //         nameProp: 'Full Name'
        //     });
        //
        //     // Return the array in Notion’s expected shape:
        //     return { relation: pageIds.map(id => ({ id })) };
        // }
    },

    postProcess: async (payload) => {
        payload.properties['Department'] = {
            relation: [
                { id: '1de6824d5503804c91d4fdf1d5303433' }  // Social Media Management
            ]
        };
        return payload;
    }
};