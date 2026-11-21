// Email sending service for WaCRM
// Supports standard SMTP (Hostinger, Gmail, Outlook, AWS SES, etc.) via nodemailer
// and transactional HTTP API (Resend) via native fetch.
let nodemailer = null;
try {
  nodemailer = require('nodemailer');
} catch (e) {
  // nodemailer is optional
}

function isConfigured() {
  if (process.env.RESEND_API_KEY) return true;
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) return true;
  return false;
}

let cachedTransporter = null;
function getTransporter() {
  if (!nodemailer) return null;
  if (!cachedTransporter) {
    const port = parseInt(process.env.SMTP_PORT || '465', 10);
    const secure = process.env.SMTP_SECURE === 'true' || port === 465;
    cachedTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      },
      tls: {
        rejectUnauthorized: process.env.SMTP_ALLOW_INVALID_CERTS !== 'true'
      }
    });
  }
  return cachedTransporter;
}

function generateHtmlTemplate(otp, purpose = 'registration') {
  const isReset = purpose === 'reset_password';
  const title = isReset ? 'Reset Your Password' : 'Verify Your Email Address';
  const description = isReset
    ? 'Use the verification code below to reset the password for your WaCRM account.'
    : 'Thank you for registering with WaCRM Web. Use the verification code below to confirm your email:';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f6f8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f4f6f8; padding: 40px 10px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 520px; background-color: #ffffff; border-radius: 14px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.06);" cellspacing="0" cellpadding="0">
          <!-- Top Green Banner -->
          <tr>
            <td style="background-color: #00a884; padding: 26px 30px; text-align: center;">
              <span style="display: inline-block; width: 40px; height: 40px; line-height: 40px; border-radius: 50%; background-color: #ffffff; color: #00a884; font-size: 22px; font-weight: bold; margin-bottom: 8px;">
                ✓
              </span>
              <h2 style="color: #ffffff; margin: 0; font-size: 20px; font-weight: 700; letter-spacing: 0.5px;">
                WaCRM Web
              </h2>
              <span style="color: rgba(255,255,255,0.85); font-size: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: 1px;">
                WhatsApp Multi-Account Desk
              </span>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 36px 32px; color: #1e293b;">
              <h3 style="margin-top: 0; margin-bottom: 12px; font-size: 18px; color: #0f172a; font-weight: 600;">
                ${title}
              </h3>
              <p style="margin-top: 0; margin-bottom: 24px; font-size: 14px; line-height: 1.6; color: #475569;">
                ${description}
              </p>

              <!-- OTP Box -->
              <div style="background-color: #f0fdf4; border: 2px dashed #00a884; border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 24px;">
                <span style="display: block; font-size: 12px; color: #15803d; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 8px;">
                  Your Verification Code
                </span>
                <span style="font-family: monospace, Courier, sans-serif; font-size: 36px; font-weight: 800; color: #00a884; letter-spacing: 8px;">
                  ${otp}
                </span>
              </div>

              <p style="margin-top: 0; margin-bottom: 16px; font-size: 13px; color: #64748b; line-height: 1.5;">
                • This code is valid for <strong>10 minutes</strong>.<br>
                • For your security, never share this code with anyone.<br>
                • If you did not request this verification code, please ignore this email.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 18px 30px; text-align: center; font-size: 12px; color: #94a3b8;">
              © 2026 WaCRM Platform • End-to-end encrypted messaging desk
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

async function sendViaResend({ to, otp, purpose }) {
  const from = process.env.SMTP_FROM || 'WaCRM <onboarding@resend.dev>';
  const subject = purpose === 'reset_password'
    ? `${otp} is your WaCRM password reset code`
    : `${otp} is your WaCRM verification code`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html: generateHtmlTemplate(otp, purpose)
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Resend API HTTP ${res.status}: ${errText}`);
  }
  return { sent: true };
}

async function sendViaSmtp({ to, otp, purpose }) {
  const transporter = getTransporter();
  if (!transporter) {
    throw new Error('Nodemailer is not installed or SMTP transport could not be initialized');
  }

  const from = process.env.SMTP_FROM ||
               process.env.EMAIL_FROM ||
               (process.env.SMTP_FROM_NAME ? `"${process.env.SMTP_FROM_NAME}" <${process.env.SMTP_USER}>` : `"WaCRM Web" <${process.env.SMTP_USER}>`);
  const subject = purpose === 'reset_password'
    ? `${otp} is your WaCRM password reset code`
    : `${otp} is your WaCRM verification code`;

  const info = await transporter.sendMail({
    from,
    to,
    subject,
    text: `Your WaCRM verification code is: ${otp}. It expires in 10 minutes.`,
    html: generateHtmlTemplate(otp, purpose)
  });

  return { sent: true, messageId: info.messageId };
}

async function sendEmailOtp({ to, otp, purpose = 'registration' }) {
  if (process.env.RESEND_API_KEY) {
    return await sendViaResend({ to, otp, purpose });
  }
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    return await sendViaSmtp({ to, otp, purpose });
  }
  return { sent: false, unconfigured: true };
}

module.exports = {
  isConfigured,
  sendEmailOtp,
  generateHtmlTemplate
};
