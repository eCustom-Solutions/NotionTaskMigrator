// transformations/apt_tasks_map.js
// --------------------------------
// Maps “Ad Production Tasks” (APT) DB → CENT Tasks DB.
//
// HOW TO USE
//   const TASK_MAP = require('./transformations/apt_tasks_map');
//
// Dry-run defaults:
//   • Assignee / Task Owner / Person → []   (no notifications)
//   • Department hook is a no-op until Victoria clarifies mapping
//   • Labels always tag the task with “Ad Production Tasks”
//
// When you’re ready for live user mapping:
//   • Uncomment the three hooks under “PEOPLE HOOKS” and
//     make sure userStore.init() is called somewhere at startup.
//   • Add real logic to the Department hook or point it to Verticals/Brands.

const linkStore = require('../services/link_store');
const { UserStore } = require('../services/user_store');
const notion       = require('../services/notion_client');
const logger       = require('../logging/logger');

// --------------------------------------------
// OPTIONAL: workspace-user cache for live runs
// --------------------------------------------
const userStore = new UserStore(notion);
/* Uncomment when you want live people lookups
(async () => { await userStore.init(); })();
*/

function blankPeople()   { return { people: [] }; }
function blankRelation() { return { relation: [] }; }

async function relationFromSourceId(id) {
    if (!id) return blankRelation();
    try {
        const link = await linkStore.load(id, 'tags'); // reuse existing load API
        return link?.status === 'success' && link.targetId
            ? { relation: [{ id: link.targetId }] }
            : blankRelation();
    } catch (error) {
        return blankRelation();
    }
}

module.exports = {
    // ─── 1. DIRECT FIELD MAPPINGS ───────────────────────────────────────────────
    mappings: {
        'Name':                  'Name',                     // title
        'Production Status':     'Production Status (APT)',  // status
        'Priority':              'Priority (APT)',           // select
        'Brand':                 'Brands',                   // relation
        'Vertical':              'Verticals',                // relation
        'Language':              'Language',                 // multi-select
        'Content Due Date':      'Content Due Date',         // date
        'Design Due Date':       'Design Due Date',          // date
        'Advertising Due Date':  'Advertising Due Date',     // date
        'Google Drive Folder':   'Google Drive Folder',      // url
        'Date Created':          'Date Created',             // date
        'Date Completed':        'Date Completed',           // date
        'Design Start':          'Design Start',             // date
        'Design Complete':       'Design Complete',          // date
        'CC Start':              'CC Start',                 // date
        'CC Complete':           'CC Complete',              // date
        'Video Edit Start':      'Video Edit Start',         // date
        'Video Edit Complete':   'Video Edit Complete',      // date
        'Revision Count':        'Revision Count',           // number
        'Video Edit Due Date':   'Video Edit Due Date',      // date
        'Team':                  'Department',               // relation
        'Assignee':              'Assignee',                 // person
        "Task Owner":            'Task Owner',               // person
        'Person':                'Person',                   // person

        // Formula fields are omitted; CENT already owns those formulas
    },

    // ─── 2. FIELDS THAT ALWAYS EXIST IN TARGET ──────────────────────────────────
    virtualMappings: [
        'Labels',
    ],

    // ─── 3. SPECIAL-CASE HOOKS ──────────────────────────────────────────────────
    hooks: {
        // --- Tag every migrated task --------------------------------------------
        Labels: () => ({
            multi_select: [{ name: 'Ad Production Tasks' }]
        }),

        // --- Relation lookups ----------------------------------------------------
        Brands: async (sourceValue) =>
            relationFromSourceId(sourceValue?.relation?.[0]?.id),

        Verticals: async (sourceValue) =>
            relationFromSourceId(sourceValue?.relation?.[0]?.id),

        // --- Department (Team) -- waiting on Victoria ---------------------------
        Department: async (sourceValue) =>
            relationFromSourceId(sourceValue?.relation?.[0]?.id),

        // --- PEOPLE HOOKS (updated for real user mapping) -----------------------
        Assignee: async (sourceValue) => {
            blankPeople();
        },

        'Task Owner': async (sourceValue) => {
            blankPeople()
        },

        Person: async (sourceValue) => {
            blankPeople()
        },

        // Normalize select/multi-select by stripping IDs and using only names
        'Production Status (APT)': async (sourceValue) => {
            const name = sourceValue?.status?.name;
            return name ? { status: { name } } : { status: null };
        },

        'Priority (APT)': async (sourceValue) => {
            const name = sourceValue?.select?.name;
            return name ? { select: { name } } : { select: null };
        },

        Language: async (sourceValue) => {
            const values = Array.isArray(sourceValue.multi_select) ? sourceValue.multi_select : [];
            return {
                multi_select: values.map(opt => ({ name: opt.name }))
            };
        },

        /* ↑↑↑  UNCOMMENT & REPLACE with below when ready  ↑↑↑
        // Assignee maps source people → same people in CENT (by ID)
        Assignee: async (src) => ({
          people: (src.people || []).map(p => ({ object: 'user', id: p.id }))
        }),

        // Task Owner hardcoded to Derious for now
        'Task Owner': () => {
          const id = userStore.getUserIdByName('Derious Vaughn');
          return id ? { people: [{ object: 'user', id }] } : blankPeople();
        },

        // Person mirrors Assignee logic
        Person: async (src) => ({
          people: (src.people || []).map(p => ({ object: 'user', id: p.id }))
        }),
        */
    },

    // ─── 4. POST-PROCESS (none needed yet) ─────────────────────────────────────
    postProcess: async (payload /*, page */) => payload
};