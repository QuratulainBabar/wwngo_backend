/** Platform fee rules aligned with product spec (USD cents). */

export const MIN_WALLET_SENDER_CENTS = 200; // $2
export const MIN_WALLET_RECEIVER_CENTS = 200; // $2
export const MIN_WALLET_TRAVELER_CENTS = 300; // $3

export const MAX_TRAVELER_REQUESTS_PER_DELIVERY = 2;
export const MAX_MEETUP_LOCATIONS = 3;

export function isDocumentCategory(category) {
  return String(category || '').toLowerCase() === 'documents';
}

/** Sender pays receiver fee when platform_fee_share > 0. */
export function senderPaysReceiverFee(delivery) {
  return Number(delivery?.platform_fee_share ?? delivery?.platformFeeShare ?? 0) > 0;
}

export function senderPlatformFeeCents(category, paysReceiverFee = false) {
  const doc = isDocumentCategory(category);
  if (paysReceiverFee) return doc ? 300 : 600;
  return doc ? 200 : 400;
}

export function receiverPlatformFeeCents(category, paysReceiverFee = false) {
  if (paysReceiverFee) return 0;
  return isDocumentCategory(category) ? 200 : 400;
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
  return MIN_WALLET_SENDER_CENTS;
}
