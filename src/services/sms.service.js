import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';

/**
 * SMS / WhatsApp OTP delivery via Twilio when configured.
 * Falls back to console log in development (never log OTP in production logs).
 */
export async function sendSmsOtp(to, code, { channel = 'sms' } = {}) {
  const accountSid = env.twilio?.accountSid;
  const authToken = env.twilio?.authToken;
  const from = env.twilio?.fromNumber;

  if (!accountSid || !authToken || !from) {
    if (env.isDev) {
      console.log(`[SMS:${channel}] OTP to ${to} (dev — configure TWILIO_* to send)`);
      return { sent: false, dev: true };
    }
    throw new AppError(
      'SMS service is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM.',
      503,
      'SMS_NOT_CONFIGURED'
    );
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const body = new URLSearchParams({
    To: to,
    From: from,
    Body: `Your WWNGO verification code is ${code}. It expires in ${env.otp.expiresMinutes} minutes.`,
  });

  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new AppError(`SMS delivery failed: ${text.slice(0, 120)}`, 502, 'SMS_FAILED');
  }

  return { sent: true };
}

export async function sendWhatsAppOtp(to, code) {
  const accountSid = env.twilio?.accountSid;
  const authToken = env.twilio?.authToken;
  const from =
    env.twilio?.whatsappFrom ||
    (env.twilio?.fromNumber ? `whatsapp:${env.twilio.fromNumber}` : null);

  if (!accountSid || !authToken || !from) {
    if (env.isDev) {
      console.log(`[WhatsApp] OTP to ${to} (dev — configure TWILIO_* to send)`);
      return { sent: false, dev: true };
    }
    throw new AppError(
      'WhatsApp service is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM.',
      503,
      'SMS_NOT_CONFIGURED'
    );
  }

  const whatsappTo = String(to).startsWith('whatsapp:') ? to : `whatsapp:${to}`;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const body = new URLSearchParams({
    To: whatsappTo,
    From: from.startsWith('whatsapp:') ? from : `whatsapp:${from}`,
    Body: `Your WWNGO verification code is ${code}. It expires in ${env.otp.expiresMinutes} minutes.`,
  });

  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new AppError(`WhatsApp delivery failed: ${text.slice(0, 120)}`, 502, 'SMS_FAILED');
  }

  return { sent: true, channel: 'whatsapp' };
}
