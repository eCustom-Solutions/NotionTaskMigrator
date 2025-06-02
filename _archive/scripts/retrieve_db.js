const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_API_KEY });

(async () => {
    const databaseId = process.env.NOTION_DATABASE_ID;
    const response = await notion.databases.retrieve({ database_id: databaseId });
    console.log(response);
})();