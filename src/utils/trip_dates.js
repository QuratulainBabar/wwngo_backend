/**
 * Travel-date windows for traveler trips.
 *
 * Discover / trip posting (relative to today):
 *   previous 5 days + today + next 7 days.
 *
 * Matching Travelers (relative to the sender delivery travel date):
 *   delivery − 5 days through delivery + 7 days (inclusive).
 */
export const TRIP_VISIBLE_PAST_DAYS = 5;
export const TRIP_VISIBLE_FUTURE_DAYS = 7;

/** SQL predicate fragment: trip.travel_date within the today-relative discover window. */
export const TRIP_TRAVEL_DATE_IN_ACTIVE_WINDOW_SQL = `(
  t.travel_date >= (CURRENT_DATE - INTERVAL '${TRIP_VISIBLE_PAST_DAYS} days')
  AND t.travel_date <= (CURRENT_DATE + INTERVAL '${TRIP_VISIBLE_FUTURE_DAYS} days')
)`;

/**
 * SQL predicate for "travel date not older than the past window start".
 * Prefer TRIP_TRAVEL_DATE_IN_ACTIVE_WINDOW_SQL for discover lists.
 */
export const TRIP_TRAVEL_DATE_NOT_STALE_SQL = `(
  t.travel_date >= (CURRENT_DATE - INTERVAL '${TRIP_VISIBLE_PAST_DAYS} days')
)`;

function parseDateOnly(value) {
  if (value == null) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.slice(0, 10))) {
    const [y, m, d] = value.slice(0, 10).split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  // DATE / timestamptz-at-midnight from pg: prefer UTC calendar day.
  if (
    value instanceof Date ||
    (typeof value === 'string' && /T|Z|[+-]\d{2}:?\d{2}$/.test(value))
  ) {
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function formatDateOnly(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Inclusive YYYY-MM-DD bounds for the today-relative discover / posting window. */
export function activeTripTravelDateBounds(now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(today);
  start.setDate(start.getDate() - TRIP_VISIBLE_PAST_DAYS);
  const end = new Date(today);
  end.setDate(end.getDate() + TRIP_VISIBLE_FUTURE_DAYS);
  return {
    startDate: formatDateOnly(start),
    endDate: formatDateOnly(end),
  };
}

/**
 * Inclusive YYYY-MM-DD bounds for Matching Travelers relative to a delivery
 * travel date: delivery − pastDays … delivery + futureDays.
 */
export function matchingTripTravelDateBounds(deliveryTravelDate) {
  const anchor = parseDateOnly(deliveryTravelDate);
  if (!anchor) return activeTripTravelDateBounds();
  const start = new Date(anchor);
  start.setDate(start.getDate() - TRIP_VISIBLE_PAST_DAYS);
  const end = new Date(anchor);
  end.setDate(end.getDate() + TRIP_VISIBLE_FUTURE_DAYS);
  return {
    startDate: formatDateOnly(start),
    endDate: formatDateOnly(end),
  };
}

/** True when travelDate falls in the today-relative discover / posting window. */
export function isTravelDateInActiveTripWindow(travelDate, now = new Date()) {
  const tripDay = parseDateOnly(travelDate);
  if (!tripDay) return false;
  const { startDate, endDate } = activeTripTravelDateBounds(now);
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  return tripDay.getTime() >= start.getTime() && tripDay.getTime() <= end.getTime();
}

/**
 * True when tripTravelDate falls in the matching window for deliveryTravelDate
 * (delivery − 5 … delivery + 7 inclusive).
 */
export function isTravelDateInMatchingWindow(tripTravelDate, deliveryTravelDate) {
  const tripDay = parseDateOnly(tripTravelDate);
  if (!tripDay) return false;
  const { startDate, endDate } = matchingTripTravelDateBounds(deliveryTravelDate);
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  return tripDay.getTime() >= start.getTime() && tripDay.getTime() <= end.getTime();
}

/**
 * Assert travelDate is YYYY-MM-DD and within the today-relative posting window.
 */
export function assertTravelDateInActiveTripWindow(travelDateStr) {
  const bounds = activeTripTravelDateBounds();
  if (!isTravelDateInActiveTripWindow(travelDateStr)) {
    return {
      ok: false,
      message:
        `Travel date must be between ${bounds.startDate} and ${bounds.endDate} ` +
        `(previous ${TRIP_VISIBLE_PAST_DAYS} days, today, and next ${TRIP_VISIBLE_FUTURE_DAYS} days).`,
      bounds,
    };
  }
  return { ok: true, bounds };
}
