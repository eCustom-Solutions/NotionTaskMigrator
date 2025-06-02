// testServices.js
// ----------------------
// Quick script to validate fetchTasks, writeTask, and linkStore services
// Run with:   node testServices.js
// Ensure your .env defines NOTION_SM_TASKS_DB_ID and NOTION_CENT_DB_ID

require('dotenv').config();
const { getTasksFromDBA } = require('../services/fetch_tasks');
const { writeToDBB }       = require('../services/write_task');
const linkStore            = require('../services/link_store');

const SM_DB_ID   = process.env.NOTION_SM_TASKS_DB_ID;
const CENT_DB_ID = process.env.NOTION_CENT_DB_ID;

async function testFetchTasks() {
    console.log('🔍 Testing fetchTasks (first 3 pages)...');
    let count = 0;
    for await (const page of getTasksFromDBA(SM_DB_ID)) {
        console.log(`  • Page ID: ${page.id}`);
        count++;
        if (count >= 3) break;
    }
    if (count === 0) {
        console.warn('  ⚠️ No pages fetched—check NOTION_SM_TASKS_DB_ID and connectivity.');
    }
}

async function testWriteTask() {
    console.log('\n✏️ Testing writeTask (creating a dummy page in CENT DB)...');
    const dummyTask = {
        properties: {
            Name: {
                title: [
                    { text: { content: '🛠️ Test Task from testServices.js' } }
                ]
            }
        }
    };

    try {
        const result = await writeToDBB(dummyTask, CENT_DB_ID);
        console.log(`  ✅ Created page in CENT DB with ID: ${result.id}`);
        return result.id;
    } catch (err) {
        console.error('  ❌ writeToDBB failed:', err.message);
    }
}

async function testLinkStore(createdTargetId) {
    console.log('\n📦 Testing linkStore (save, hasSourceId, load)...');
    const testSourceId = 'test-source-123';
    const dummyLink = {
        sourceId:  testSourceId,
        targetId:  createdTargetId || 'dummy-target-456',
        status:    'success',
        syncedAt:  new Date().toISOString()
    };

    // Save
    await linkStore.save(dummyLink);
    console.log('  • Saved link:', dummyLink);

    // hasSourceId
    const exists = await linkStore.hasSourceId(testSourceId);
    console.log(`  • hasSourceId('${testSourceId}') → ${exists}`);

    // load
    const loaded = await linkStore.load(testSourceId);
    console.log('  • Loaded link:', loaded);
}

(async function main() {
    try {
        await testFetchTasks();
        const newPageId = await testWriteTask();
        await testLinkStore(newPageId);
        console.log('\n🎉 All service tests complete.');
        process.exit(0);
    } catch (err) {
        console.error('\n🚨 testServices encountered an error:', err);
        process.exit(1);
    }
})();