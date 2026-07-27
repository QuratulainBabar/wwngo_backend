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

function formatDeliveryTypeLabel(deliveryType) {
  switch (deliveryType) {
    case 'country_to_country':
      return 'Country to Country';
    case 'city_to_city':
    default:
      return 'City to City';
  }
}

/**
 * Notify a receiver that a sender posted a parcel for them.
 * Non-blocking for delivery creation — callers should catch/log failures.
 * @param {string} to
 * @param {{
 *   publicId: string,
 *   senderName?: string | null,
 *   deliveryType: string,
 *   route: string,
 *   travelDate: string,
 *   parcelCategory?: string,
 *   maxBudget?: number,
 * }} details
 */
export async function sendReceiverParcelRequestEmail(to, details) {
  const senderLabel = String(details.senderName || '').trim() || 'A WWNGO sender';
  const deliveryTypeLabel = formatDeliveryTypeLabel(details.deliveryType);
  const route = String(details.route || '').trim() || '—';
  const travelDate = String(details.travelDate || '').trim() || '—';
  const parcelId = String(details.publicId || '').trim() || '—';
  const category = String(details.parcelCategory || '').trim();
  const maxBudget =
    details.maxBudget != null && Number.isFinite(Number(details.maxBudget))
      ? `$${Number(details.maxBudget).toFixed(2)}`
      : null;

  const subject = `WWNGO — Incoming parcel request (${parcelId})`;
  const categoryLine = category ? `\nParcel type: ${category}` : '';
  const budgetLine = maxBudget ? `\nMaximum budget: ${maxBudget}` : '';

  const text =
    `Hello,\n\n` +
    `${senderLabel} has requested to send you a parcel on WWNGO.\n\n` +
    `Delivery type: ${deliveryTypeLabel}\n` +
    `Route: ${route}\n` +
    `Travel date: ${travelDate}\n` +
    `Parcel ID: ${parcelId}` +
    `${categoryLine}` +
    `${budgetLine}\n\n` +
    `Open the WWNGO app, sign in with this email address, and review the request to accept or decline.\n\n` +
    `If you were not expecting this parcel, you can ignore this email.`;

  const htmlCategory = category
    ? `<tr><td style="padding:4px 12px 4px 0;color:#555">Parcel type</td><td>${category}</td></tr>`
    : '';
  const htmlBudget = maxBudget
    ? `<tr><td style="padding:4px 12px 4px 0;color:#555">Maximum budget</td><td>${maxBudget}</td></tr>`
    : '';

  const mail = {
    from: env.smtp.from,
    to,
    subject,
    text,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111;max-width:560px">
        <h2 style="margin:0 0 12px">Incoming parcel request</h2>
        <p style="margin:0 0 16px">
          <strong>${senderLabel}</strong> has requested to send you a parcel on WWNGO.
        </p>
        <table style="border-collapse:collapse;margin:0 0 16px;font-size:15px">
          <tr><td style="padding:4px 12px 4px 0;color:#555">Delivery type</td><td>${deliveryTypeLabel}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#555">Route</td><td>${route}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#555">Travel date</td><td>${travelDate}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#555">Parcel ID</td><td><strong>${parcelId}</strong></td></tr>
          ${htmlCategory}
          ${htmlBudget}
        </table>
        <p style="margin:0 0 16px">
          Open the <strong>WWNGO</strong> app, sign in with this email address, and review the request to accept or decline.
        </p>
        <p style="margin:0;color:#888;font-size:13px">
          If you were not expecting this parcel, you can ignore this email.
        </p>
      </div>
    `,
  };

  try {
    await getTransporter().sendMail(mail);
    if (env.isDev) {
      console.log(`[EMAIL] Parcel request notification sent to ${to} (${parcelId})`);
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('[EMAIL] Failed to send parcel request notification:', err?.message || err);
    throw new AppError(
      env.isDev
        ? `Unable to send parcel request email: ${err?.message || err}`
        : 'Unable to send parcel request email.',
      502,
      'EMAIL_SEND_FAILED'
    );
  }
}
