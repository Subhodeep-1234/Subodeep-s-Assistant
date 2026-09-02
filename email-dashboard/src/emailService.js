// OTP delivery via the same Gmail account already connected for Mail
// Management (src/auth.js) - no new signup, no domain verification needed,
// and it can send to any recipient since it's a real established mailbox.
const gmailService = require('./gmailService');

async function sendOtpEmail(to, code) {
  await gmailService.sendMail({
    to,
    subject: 'Your Workforce Intelligence login code',
    text:
      'Your one-time login code is ' + code + '.\n\n' +
      'This code expires in 10 minutes. If you did not request this, you can ignore this email.'
  });
  return { delivered: true };
}

module.exports = { sendOtpEmail };
