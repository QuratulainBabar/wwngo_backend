import { pool } from '../db/pool.js';
import { NOTIFICATION_STRINGS } from './notification_strings.generated.js';

export const SUPPORTED_NOTIFICATION_LANGS = Object.freeze(
  Object.keys(NOTIFICATION_STRINGS)
);

const TITLE_KEY_BY_ENGLISH = Object.freeze({
  'Matching traveler available': 'matchingTravelerAvailable',
  'Incoming Parcel Request': 'incomingParcelRequest',
  'Receiver accepted': 'receiverAcceptedTitle',
  'Receiver paid fee share': 'receiverPaidFeeShare',
  'Offer accepted': 'offerAcceptedTitle',
  'New counter offer': 'newCounterOfferTitle',
  'Counter offer updated': 'counterOfferUpdatedTitle',
  'Counter offer accepted': 'counterOfferAcceptedTitle',
  'Counter offer declined': 'counterOfferDeclined',
  'New Sender Request': 'newSenderRequestTitle',
  'Delivery cancelled': 'deliveryCancelledTitle',
  'Delivery auto-cancelled': 'deliveryAutoCancelled',
  'Traveler did not respond in time': 'travelerDidNotRespondInTime',
  'Sender request expired': 'senderRequestExpired',
  'NFC verification successful': 'nfcVerificationSuccessful',
  'Delivery complete': 'deliveryComplete',
  'Parcel in transit': 'parcelInTransit',
  'Platform fee paid': 'platformFeePaid',
  'New review received': 'newReviewReceived',
  'Parcel collected': 'parcelCollected',
  'New message': 'newMessage',
  '📷 Photo': 'photoMessage',
});

/** @typedef {{ key: string, params?: Record<string, string> }} BodyMatch */

/**
 * @param {string} english
 * @returns {BodyMatch | null}
 */
function matchBody(english) {
  const text = String(english || '');

  let m = text.match(
    /^Your parcel (.+) has been collected by the traveler after successful NFC handoff\.$/
  );
  if (m) return { key: 'parcelCollectedBody', params: { id: m[1] } };

  m = text.match(
    /^A sender accepted your counter offer of (.+) for (.+) \((.+)\)\.$/
  );
  if (m) {
    return {
      key: 'senderAcceptedCounterOfferBody',
      params: { amount: m[1], id: m[2], route: m[3] },
    };
  }

  m = text.match(
    /^A sender declined your counter offer of (.+) for (.+) \((.+)\)\.$/
  );
  if (m) {
    return {
      key: 'senderDeclinedCounterOfferBody',
      params: { amount: m[1], id: m[2], route: m[3] },
    };
  }

  m = text.match(/^(.+) accepted your offer of (.+) for (.+) \((.+)\)\.$/);
  if (m) {
    return {
      key: 'travelerAcceptedOfferBody',
      params: { name: m[1], amount: m[2], id: m[3], route: m[4] },
    };
  }

  m = text.match(
    /^(.+) updated their counter offer to (.+) for (.+) \((.+)\)\.$/
  );
  if (m) {
    return {
      key: 'travelerUpdatedCounterOfferBody',
      params: { name: m[1], amount: m[2], id: m[3], route: m[4] },
    };
  }

  m = text.match(/^(.+) sent a counter offer of (.+) for (.+) \((.+)\)\.$/);
  if (m) {
    return {
      key: 'travelerSentCounterOfferBody',
      params: { name: m[1], amount: m[2], id: m[3], route: m[4] },
    };
  }

  m = text.match(
    /^NFC match confirmed for Trip\/Delivery (.+)\. You and the Traveler verified the same delivery — the Traveler is connected to the correct Sender for this parcel\. Status is now Collected\.$/
  );
  if (m) return { key: 'nfcMatchSenderCp1Body', params: { id: m[1] } };

  m = text.match(
    /^NFC match confirmed for Trip\/Delivery (.+)\. You and the Sender verified the same delivery — you are connected to the correct Sender for this parcel\. Status is now Collected\. Mark in transit when you begin travel\.$/
  );
  if (m) return { key: 'nfcMatchTravelerCp1Body', params: { id: m[1] } };

  m = text.match(
    /^NFC match confirmed for Trip\/Delivery (.+)\. You and the Receiver verified the same delivery — you are handing over the parcel to the correct Receiver for this exact trip\/delivery\. Status is now Delivered\. Escrow released\.$/
  );
  if (m) return { key: 'nfcMatchTravelerCp2Body', params: { id: m[1] } };

  m = text.match(
    /^NFC match confirmed for Trip\/Delivery (.+)\. You and the Traveler verified the same delivery — the Traveler is handing over the parcel to you \(the correct Receiver\) for this exact trip\/delivery\. Status is now Delivered\. You can leave a review\.$/
  );
  if (m) return { key: 'nfcMatchReceiverCp2Body', params: { id: m[1] } };

  m = text.match(
    /^A traveler posted a trip on (.+) that matches your parcel (.+)\.$/
  );
  if (m) {
    return {
      key: 'matchingTravelerAvailableBody',
      params: { route: m[1], id: m[2] },
    };
  }

  m = text.match(
    /^A sender requested your trip (.+) for parcel (.+) \((.+)\)\.$/
  );
  if (m) {
    return {
      key: 'newSenderRequestBody',
      params: { tripId: m[1], id: m[2], route: m[3] },
    };
  }

  m = text.match(
    /^Receiver accepted (.+)\. Matching travelers are now available\.$/
  );
  if (m) return { key: 'receiverAcceptedBody', params: { id: m[1] } };

  m = text.match(/^Receiver paid their platform fee for (.+)\.$/);
  if (m) return { key: 'receiverPaidFeeShareBody', params: { id: m[1] } };

  m = text.match(/^The sender cancelled parcel request (.+)\.$/);
  if (m) return { key: 'senderCancelledParcelRequestBody', params: { id: m[1] } };

  m = text.match(/^Parcel (.+) was cancelled by the sender\.$/);
  if (m) return { key: 'parcelCancelledBySenderBody', params: { id: m[1] } };

  m = text.match(
    /^Parcel (.+) was cancelled — receiver did not pay within 2 hours\.$/
  );
  if (m) return { key: 'deliveryAutoCancelledBody', params: { id: m[1] } };

  m = text.match(
    /^Your request for parcel (.+) expired — the traveler did not respond before the deadline\.$/
  );
  if (m) return { key: 'travelerDidNotRespondBody', params: { id: m[1] } };

  m = text.match(
    /^A sender request for (.+) expired because it was not accepted in time\.$/
  );
  if (m) return { key: 'senderRequestExpiredBody', params: { id: m[1] } };

  m = text.match(/^Parcel (.+) was delivered successfully\.$/);
  if (m) return { key: 'parcelDeliveredBody', params: { id: m[1] } };

  m = text.match(/^Parcel (.+) is now in transit\.$/);
  if (m) return { key: 'parcelInTransitBody', params: { id: m[1] } };

  m = text.match(
    /^(.+) platform fee deducted from your card for (.+)\.$/
  );
  if (m) {
    return {
      key: 'platformFeeDeductedBody',
      params: { amount: m[1], id: m[2] },
    };
  }

  m = text.match(
    /^(.+) platform fee deducted from your wallet for (.+)\.$/
  );
  if (m) {
    return {
      key: 'platformFeeDeductedWalletBody',
      params: { amount: m[1], id: m[2] },
    };
  }

  m = text.match(
    /^(.+) platform fee paid for (.+) \((.+) from wallet \+ (.+) from card\)\.$/
  );
  if (m) {
    return {
      key: 'platformFeePaidMixedBody',
      params: { amount: m[1], id: m[2], wallet: m[3], card: m[4] },
    };
  }

  m = text.match(/^(.+) left you a (\d+-star) review( for (.+))?\.$/);
  if (m) {
    const shipment = m[4] ? ` for ${m[4]}` : '';
    return {
      key: 'newReviewReceivedBody',
      params: { name: m[1], stars: m[2], shipment },
    };
  }

  if (
    text ===
    'A sender wants to send a parcel through you. Please review the request and accept or decline it.'
  ) {
    return { key: 'incomingParcelRequestBody' };
  }

  if (text === 'New message') return { key: 'newMessage' };
  if (text === '📷 Photo') return { key: 'photoMessage' };

  return null;
}

/**
 * @param {string | null | undefined} code
 * @returns {string}
 */
export function normalizeLanguageCode(code) {
  const raw = String(code || 'en')
    .trim()
    .toLowerCase()
    .split(/[_-]/)[0];
  if (SUPPORTED_NOTIFICATION_LANGS.includes(raw)) return raw;
  return 'en';
}

/**
 * @param {string} lang
 * @param {string} key
 * @param {Record<string, string>} [params]
 */
function formatKey(lang, key, params = {}) {
  const table = NOTIFICATION_STRINGS[lang] || NOTIFICATION_STRINGS.en;
  let template = table[key] || NOTIFICATION_STRINGS.en[key] || key;
  for (const [name, value] of Object.entries(params)) {
    template = template.split(`{${name}}`).join(String(value ?? ''));
  }
  return template;
}

/**
 * Localize an English notification title/body for FCM / system tray.
 * Unknown strings are returned unchanged (e.g. free-form chat text).
 *
 * @param {{ title?: string, body?: string, language?: string }} input
 */
export function localizeNotificationText({ title, body, language }) {
  const lang = normalizeLanguageCode(language);
  if (lang === 'en') {
    return {
      title: title == null ? title : String(title),
      body: body == null ? body : String(body),
      language: lang,
    };
  }

  let nextTitle = title == null ? title : String(title);
  let nextBody = body == null ? body : String(body);

  if (nextTitle) {
    const titleKey = TITLE_KEY_BY_ENGLISH[nextTitle];
    if (titleKey) nextTitle = formatKey(lang, titleKey);
  }

  if (nextBody) {
    const matched = matchBody(nextBody);
    if (matched) {
      nextBody = formatKey(lang, matched.key, matched.params || {});
    }
  }

  return { title: nextTitle, body: nextBody, language: lang };
}

/**
 * @param {string} userId
 * @returns {Promise<string>}
 */
export async function getUserPreferredLanguage(userId) {
  try {
    const { rows } = await pool.query(
      `SELECT preferred_language FROM users WHERE id = $1`,
      [String(userId)]
    );
    return normalizeLanguageCode(rows[0]?.preferred_language);
  } catch (err) {
    // Column may not exist yet before migration — fall back to English.
    console.warn(
      '[i18n] preferred_language lookup failed:',
      err?.message || err
    );
    return 'en';
  }
}

/**
 * Localize push copy for a specific user.
 * @param {string} userId
 * @param {{ title?: string, body?: string }} payload
 */
export async function localizePushForUser(userId, { title, body }) {
  const language = await getUserPreferredLanguage(userId);
  return localizeNotificationText({ title, body, language });
}
