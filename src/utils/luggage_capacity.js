import { AppError } from './errors.js';

/**
 * Parse a kg value from DB/API input. Non-finite values become NaN.
 */
export function parseWeightKg(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * True when traveler luggage capacity can carry the parcel weight.
 * Requires capacity >= parcelWeight for any finite non-negative values.
 * Invalid / missing numbers fail closed (cannot match).
 */
export function tripCanCarryParcelWeight(capacityKg, parcelWeightKg) {
  const capacity = parseWeightKg(capacityKg);
  const weight = parseWeightKg(parcelWeightKg);
  if (!Number.isFinite(capacity) || !Number.isFinite(weight)) return false;
  if (capacity < 0 || weight < 0) return false;
  return capacity >= weight;
}

/**
 * Reject selection / acceptance when capacity is below parcel weight.
 */
export function assertTripCanCarryParcel(capacityKg, parcelWeightKg) {
  if (tripCanCarryParcelWeight(capacityKg, parcelWeightKg)) return;
  throw new AppError(
    'This traveler does not have enough luggage capacity for your parcel weight.',
    400,
    'INSUFFICIENT_LUGGAGE_CAPACITY'
  );
}
