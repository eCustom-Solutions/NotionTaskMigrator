const { Client } = require('@notionhq/client');
const path = require("path");
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });


const notion = new Client({ auth: process.env.NOTION_API_KEY });

(async () => {
    const databaseId = process.env.NOTION_DATABASE_ID;
    const response = await notion.databases.query({
        database_id: databaseId,
    });
    console.log(response);
})();