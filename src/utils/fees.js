/** Platform fee rules aligned with product spec (USD cents). */

export const MIN_WALLET_SENDER_CENTS = 200; // $2
export const MIN_WALLET_RECEIVER_CENTS = 200; // $2
export const MIN_WALLET_TRAVELER_CENTS = 300; // $3

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
  const doc = isDocumentCategory(category);
  if (paysReceiverFee) return doc ? 300 : 600;
  return doc ? 200 : 400;
}

/**
 * Sender platform fee for a delivery row — uses stored platform_fee when valid,
 * otherwise recomputes from category + receiver-fee choice.
 *
 * Sender pays receiver fee: $3 documents / $6 objects.
 * Sender does not pay receiver fee: $2 documents / $4 objects.
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
  return isDocumentCategory(category) ? 200 : 300;
}

export function travelerPlatformFeeCents(category) {
  return isDocumentCategory(category) ? 200 : 400;
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
 * Must not use senderPlatformFeeCents — posting does not debit $2/$4/$3/$6.
 */
export function minWalletCentsForSenderCreate(
  _parcelCategory = 'documents',
  _paysReceiverFee = false
) {
  return MIN_WALLET_SENDER_CENTS;
}

/**
 * Minimum receiver balance to accept.
 * When the receiver owes a platform fee, that amount is required; otherwise $2 minimum.
 */
export function minWalletCentsForReceiverAccept(parcelCategory, paysReceiverFee = false) {
  const fee = receiverPlatformFeeCents(parcelCategory, paysReceiverFee);
  return fee > 0 ? fee : MIN_WALLET_RECEIVER_CENTS;
}

export function platformFeeDescription(shipmentId) {
  return `Platform fee for ${shipmentId}`;
}
