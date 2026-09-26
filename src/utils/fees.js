/** Platform fee rules aligned with product spec (USD cents). */

export const MIN_WALLET_SENDER_CENTS = 200; // $2
export const MIN_WALLET_RECEIVER_CENTS = 200; // $2
export const MIN_WALLET_TRAVELER_CENTS = 300; // $3

/** Traveler platform fee — always $3 for Document and Object. */
export const TRAVELER_PLATFORM_FEE_CENTS = 300;

export const MAX_TRAVELER_REQUESTS_PER_DELIVERY = 2;
export const MAX_MEETUP_LOCATIONS = 3;

export function isDocumentCategory(category) {
  return String(category || '').toLowerCase() === 'documents';
}

/** Sender covers receiver platform fee when share is 0 (receiver owes nothing). */
export function senderPaysReceiverFee(delivery) {
  if (delivery?.paysReceiverFee === true) return true;
  if (delivery?.paysReceiverFee === false) return false;
  const share = Number(delivery?.platform_fee_share ?? delivery?.platformFeeShare ?? 0);
  return share <= 0;
}

export function parsePaysReceiverFee(body = {}) {
  const raw = body.paysReceiverFee;
  if (raw === true || raw === 'true' || raw === 1 || raw === '1') return true;
  if (raw === false || raw === 'false' || raw === 0 || raw === '0') return false;
  if (body.platformFeeShare != null && body.platformFeeShare !== '') {
    return Number(body.platformFeeShare) <= 0;
  }
  return false;
}

/** Derive stored platform fee fields from parcel category + sender fee choice. */
export function resolvePlatformFees(parcelCategory, paysReceiverFee = false) {
  const pays = Boolean(paysReceiverFee);
  return {
    paysReceiverFee: pays,
    platformFee: senderPlatformFeeCents(parcelCategory, pays) / 100,
    platformFeeShare: pays ? 0 : receiverPlatformFeeCents(parcelCategory, false) / 100,
  };
}

export function senderPlatformFeeCents(category, paysReceiverFee = false) {
  // Same for Document and Object: $2, or $3 when sender covers receiver fee.
  if (paysReceiverFee) return 300;
  return 200;
}

/**
 * Sender platform fee for a delivery row — uses stored platform_fee when valid,
 * otherwise recomputes from category + receiver-fee choice.
 *
 * Sender pays receiver fee: $3 (Document and Object).
 * Sender does not pay receiver fee: $2 (Document and Object).
 */
export function resolveSenderPlatformFeeCents(delivery) {
  const paysReceiver = senderPaysReceiverFee(delivery);
  const category = delivery?.parcel_category ?? delivery?.parcelCategory ?? 'documents';
  const expected = senderPlatformFeeCents(category, paysReceiver);
  const stored = Math.round(Number(delivery?.platform_fee ?? delivery?.platformFee ?? 0) * 100);
  if (stored > 0 && stored === expected) return stored;
  return expected;
}

export function receiverPlatformFeeCents(category, paysReceiverFee = false) {
  if (paysReceiverFee) return 0;
  // Same for Document and Object ($2).
  return 200;
}

export function travelerPlatformFeeCents(_category) {
  // Always $3 — Document and Object (category ignored).
  return TRAVELER_PLATFORM_FEE_CENTS;
}

export function travelerHandoffFeeCents(category) {
  return travelerPlatformFeeCents(category);
}

export function minWalletCentsForRole(role) {
  const r = String(role || '').toLowerCase();
  if (r === 'traveler') return MIN_WALLET_TRAVELER_CENTS;
  if (r === 'receiver') return MIN_WALLET_RECEIVER_CENTS;
  return MIN_WALLET_SENDER_CENTS;
}

/**
 * Minimum sender balance to post a delivery.
 * Must not use senderPlatformFeeCents — posting does not debit $2/$3.
 */
export function minWalletCentsForSenderCreate(
  _parcelCategory = 'documents',
  _paysReceiverFee = false
) {
  return MIN_WALLET_SENDER_CENTS;
}

/**
 * Minimum receiver balance historically used at accept.
 * Receiver platform fee is now charged at sender Pay Now — accept is consent only.
 */
export function minWalletCentsForReceiverAccept(parcelCategory, paysReceiverFee = false) {
  return receiverPlatformFeeCents(parcelCategory, paysReceiverFee);
}

export function platformFeeDescription(shipmentId) {
  return `Platform fee for ${shipmentId}`;
}
