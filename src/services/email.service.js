import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';

let transporter;

function isPlaceholderSmtp() {
  const user = (env.smtp.user || '').toLowerCase();
  const pass = (env.smtp.pass || '').toLowerCase();
  return (
    !user ||
    !pass ||
    user.includes('your-gmail') ||
    user.includes('example.com') ||
    pass.includes('your-16-char') ||
    pass.includes('your-app-password') ||
    pass === 'password' ||
    pass === 'changeme'
  );
}

function getTransporter() {
  if (transporter) return transporter;

  if (isPlaceholderSmtp()) {
    throw new AppError(
      'Email service is not configured. Set SMTP_USER and SMTP_PASS in .env to a real Gmail address and App Password.',
      503,
      'EMAIL_NOT_CONFIGURED'
    );
  }

  transporter = nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.port === 465,
    requireTLS: env.smtp.port === 587,
    auth: {
      user: env.smtp.user,
      pass: env.smtp.pass,
    },
    tls: {
      // Fixes "self-signed certificate in certificate chain" from local SSL inspection.
      rejectUnauthorized: env.smtp.tlsRejectUnauthorized,
      minVersion: 'TLSv1.2',
    },
  });

  return transporter;
}

/**
 * Send a one-time passcode email via Gmail SMTP.
 * Never log the OTP code.
 * @param {string} to
 * @param {string} code
 * @param {{ subject?: string, purposeLabel?: string }} [options]
 */
export async function sendOtpEmail(to, code, options = {}) {
  const purposeLabel = options.purposeLabel || 'verification';
  const subject = options.subject || `Your WWNGO ${purposeLabel} code`;
  const expires = env.otp.expiresMinutes;

  const mail = {
    from: env.smtp.from,
    to,
    subject,
    text:
      `Your WWNGO ${purposeLabel} code is ${code}.\n\n` +
      `It expires in ${expires} minutes. If you did not request this, ignore this email.`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111">
        <h2 style="margin:0 0 12px">WWNGO ${purposeLabel} code</h2>
        <p style="margin:0 0 16px">Use this code to continue:</p>
        <p style="font-size:28px;letter-spacing:6px;font-weight:700;margin:0 0 16px">${code}</p>
        <p style="margin:0;color:#555">This code expires in ${expires} minutes.</p>
        <p style="margin:16px 0 0;color:#888;font-size:13px">If you did not request this, you can ignore this email.</p>
      </div>
    `,
  };

  try {
    await getTransporter().sendMail(mail);
    if (env.isDev) {
      console.log(`[EMAIL] OTP email accepted by SMTP for ${to} (${purposeLabel})`);
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('[EMAIL] Failed to send OTP:', err?.message || err);
    throw new AppError(
      env.isDev
        ? `Unable to send verification email: ${err?.message || err}`
        : 'Unable to send verification email. Please try again later.',
      502,
      'EMAIL_SEND_FAILED'
    );
  }
}
