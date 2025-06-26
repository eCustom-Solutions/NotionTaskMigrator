const sendEmail = require('./send_email');
const { flushTmpDir } = require('./utils');
require('dotenv').config();
const summarizeLogs = require('./summarize_logs');
const formatSummaryForEmail = require('./format_email_body');
const { bundleLogs } = require('./bundle_logs');

(async () => {
  try {
    const summary = await summarizeLogs();
    console.log('📝 Daily Summary:', summary);

    const zipPath = await bundleLogs(summary.date);

    const emailBody = formatSummaryForEmail(summary);
    console.log('📧 Email Body:\n', emailBody);
    const recipient = process.env.GOOGLE_APP_USERNAME;
    const subject = `Migration Summary for ${summary.date}`;
    await sendEmail(recipient, subject, emailBody, zipPath);
    await flushTmpDir();
    console.log('🧹 Temporary directory flushed.');
    console.log('✅ Daily summary email sent.');
    // TODO: Send email with formatted summary
  } catch (err) {
    console.error('❌ Failed to generate daily report:', err);
    process.exit(1);
  }
})();
