const { Client } = require('@notionhq/client');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const API_KEY = process.env.NOTION_API_KEY
console.log(API_KEY)
const notion = new Client({ auth: API_KEY });



(async () => {
    const response = await notion.users.list();
    console.log(response);
})();