import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import admin from 'firebase-admin';
import { pool } from '../db/pool.js';
import { env } from '../config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('firebase-admin/messaging').Messaging | null} */
let messagingClient = null;
let initAttempted = false;

function resolveServiceAccountPath() {
  const configured = env.fcm?.serviceAccountPath;
  if (!configured) return null;
  return path.isAbsolute(configured)
    ? configured
    : path.resolve(__dirname, '../../', configured);
}

function getMessagingClient() {
  if (messagingClient) return messagingClient;
  if (initAttempted) return null;
  initAttempted = true;

  const accountPath = resolveServiceAccountPath();
  if (!accountPath || !existsSync(accountPath)) {
    if (accountPath) {
      console.warn('[FCM] Service account file not found:', accountPath);
    } else if (env.fcm?.serverKey) {
      console.warn('[FCM] Using legacy server key (FCM_SERVER_KEY). Prefer FCM_SERVICE_ACCOUNT_PATH.');
    } else {
      console.warn('[FCM] Push disabled — set FCM_SERVICE_ACCOUNT_PATH in .env');
    }
    return null;
  }

  try {
    const serviceAccount = JSON.parse(readFileSync(accountPath, 'utf8'));
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    }
    messagingClient = admin.messaging();
    console.info('[FCM] Firebase Admin initialized for project', serviceAccount.project_id);
    return messagingClient;
  } catch (err) {
    console.warn('[FCM] Firebase Admin init failed:', err?.message || err);
    return null;
  }
}

async function sendLegacyPush(tokens, { title, body, data }) {
  const serverKey = env.fcm?.serverKey;
  if (!serverKey) return { sent: false, reason: 'not_configured', count: 0 };

  let sent = 0;
  for (const token of tokens) {
    try {
      const res = await fetch('https://fcm.googleapis.com/fcm/send', {
        method: 'POST',
        headers: {
          Authorization: `key=${serverKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: token,
          notification: { title, body },
          data: Object.fromEntries(
            Object.entries(data).map(([k, v]) => [k, String(v ?? '')])
          ),
          priority: 'high',
        }),
      });
      if (res.ok) sent += 1;
    } catch (err) {
      console.warn('[FCM] legacy send failed:', err?.message || err);
    }
  }

  return { sent: sent > 0, count: sent };
}

async function removeInvalidTokens(tokens) {
  if (!tokens.length) return;
  await pool.query(
    `DELETE FROM device_tokens WHERE token = ANY($1::text[])`,
    [tokens]
  );
}

/**
 * Send a push notification to all registered devices for a user.
 */
export async function sendPushToUser(userId, { title, body, data = {} } = {}) {
  const { rows } = await pool.query(
    `SELECT token FROM device_tokens WHERE user_id = $1`,
    [userId]
  );
  if (!rows.length) return { sent: false, reason: 'no_tokens', count: 0 };

  const tokens = rows.map((r) => r.token).filter(Boolean);
  const payloadData = Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, String(v ?? '')])
  );

  const messaging = getMessagingClient();
  if (!messaging) {
    return sendLegacyPush(tokens, { title, body, data: payloadData });
  }

  try {
    const response = await messaging.sendEachForMulticast({
      tokens,
      notification: { title, body },
      data: payloadData,
      android: { priority: 'high' },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          },
        },
      },
    });

    const invalidTokens = [];
    response.responses.forEach((item, index) => {
      if (item.success) return;
      const code = item.error?.code;
      if (
        code === 'messaging/invalid-registration-token' ||
        code === 'messaging/registration-token-not-registered'
      ) {
        invalidTokens.push(tokens[index]);
      } else if (item.error) {
        console.warn('[FCM] token send error:', item.error.message);
      }
    });

    if (invalidTokens.length) {
      await removeInvalidTokens(invalidTokens);
    }

    return {
      sent: response.successCount > 0,
      count: response.successCount,
      failed: response.failureCount,
    };
  } catch (err) {
    console.warn('[FCM] multicast send failed:', err?.message || err);
    return { sent: false, reason: 'send_failed', count: 0 };
  }
}

export async function registerDeviceToken(userId, { token, platform = 'unknown' } = {}) {
  const normalized = String(token || '').trim();
  if (!normalized) return null;

  const { rows } = await pool.query(
    `INSERT INTO device_tokens (user_id, token, platform)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, token) DO UPDATE SET platform = EXCLUDED.platform, updated_at = NOW()
     RETURNING *`,
    [userId, normalized, String(platform).slice(0, 32)]
  );
  return rows[0];
}

export async function removeDeviceToken(userId, token) {
  await pool.query(`DELETE FROM device_tokens WHERE user_id = $1 AND token = $2`, [
    userId,
    String(token || '').trim(),
  ]);
}

export function isFcmConfigured() {
  return Boolean(getMessagingClient() || env.fcm?.serverKey);
}
