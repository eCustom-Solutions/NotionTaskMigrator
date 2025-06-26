const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const nodemailer = require('nodemailer');

/**
 * Sends a plain text email with the given subject and message body.
 *
 * @param {string} recipient - Email address to send to
 * @param {string} subject - Subject line
 * @param {string} message - Plain text message body
 * @param {string} attachmentPath - Optional file path of an attachment to include
 */
async function sendEmail(recipient, subject, message, attachmentPath) {
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GOOGLE_APP_USERNAME,
        pass: process.env.GOOGLE_APP_PASSWORD
      }
    });

    const mailOptions = {
      from: process.env.GOOGLE_APP_USERNAME,
      to: recipient,
      subject: subject,
      text: message,
      attachments: attachmentPath
        ? [{
            filename: path.basename(attachmentPath),
            path: attachmentPath
          }]
        : []
    };

    if (attachmentPath) {
      console.log('📎 Attaching file to email:', attachmentPath);
    } else {
      console.log('📭 No attachment specified for email.');
    }
    console.log('📤 Sending email to:', recipient);

    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Email sent successfully:', info);
  } catch (err) {
    console.error('❌ Error sending email:', err);
  }
}

module.exports = sendEmail;
