/**
 * Active traveler trip window shown to senders (rolling, relative to today):
 * previous 5 days + today + next 7 days.
 */
export const TRIP_VISIBLE_PAST_DAYS = 5;
export const TRIP_VISIBLE_FUTURE_DAYS = 7;

/** SQL predicate fragment: trip.travel_date within the active sender-visible window. */
export const TRIP_TRAVEL_DATE_IN_ACTIVE_WINDOW_SQL = `(
  t.travel_date >= (CURRENT_DATE - INTERVAL '${TRIP_VISIBLE_PAST_DAYS} days')
  AND t.travel_date <= (CURRENT_DATE + INTERVAL '${TRIP_VISIBLE_FUTURE_DAYS} days')
)`;

function parseDateOnly(value) {
  if (value == null) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.slice(0, 10))) {
    const [y, m, d] = value.slice(0, 10).split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function formatDateOnly(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Inclusive YYYY-MM-DD bounds for the active trip window. */
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

/** True when travelDate (YYYY-MM-DD or Date) is within the active sender-visible window. */
export function isTravelDateInActiveTripWindow(travelDate, now = new Date()) {
  const tripDay = parseDateOnly(travelDate);
  if (!tripDay) return false;
  const { startDate, endDate } = activeTripTravelDateBounds(now);
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  return tripDay.getTime() >= start.getTime() && tripDay.getTime() <= end.getTime();
}

/**
 * Assert travelDate is YYYY-MM-DD and within the active window.
 * @throws {{ message: string, code: string }} shape compatible with AppError usage via caller
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
