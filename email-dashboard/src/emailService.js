// OTP delivery via a transactional email provider (Resend's HTTP API), kept
// separate from the Gmail OAuth in src/auth.js on purpose - that stays the
// admin's own inbox access, unrelated to who's logging into the HR app.

async function sendOtpEmail(to, code) {
  const apiKey = process.env.EMAIL_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    console.log('[hr-auth] EMAIL_API_KEY/EMAIL_FROM not set - OTP for ' + to + ' is: ' + code);
    return { delivered: false, reason: 'not_configured' };
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from,
      to,
      subject: 'Your Workforce Intelligence login code',
      text:
        'Your one-time login code is ' + code + '.\n\n' +
        'This code expires in 10 minutes. If you did not request this, you can ignore this email.'
    })
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error('Email provider error (' + res.status + '): ' + body.slice(0, 300));
  }

  return { delivered: true };
}

module.exports = { sendOtpEmail };
