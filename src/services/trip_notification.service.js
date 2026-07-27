import { pool } from '../db/pool.js';
import * as notificationCreateService from './notification_create.service.js';

function buildRouteLabel(tripRow) {
  if (tripRow.trip_type === 'country_to_country') {
    return `${tripRow.origin_country} → ${tripRow.destination_country}`;
  }
  return `${tripRow.from_city} → ${tripRow.to_city}`;
}

function formatTravelDate(tripRow) {
  const raw = tripRow.travel_date;
  if (!raw) return '';
  const d = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(d.getTime())) return String(raw).slice(0, 10);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

async function loadTravelerName(travelerId) {
  const { rows } = await pool.query(`SELECT name FROM users WHERE id = $1`, [travelerId]);
  return String(rows[0]?.name ?? '').trim() || 'A traveler';
}

async function listSenderUserIds(excludeUserId) {
  const { rows } = await pool.query(
    `SELECT id FROM users
     WHERE id <> $1
       AND COALESCE(account_status, 'active') <> 'suspended'`,
    [excludeUserId]
  );
  return rows.map((row) => row.id);
}

/**
 * Notify all senders when a traveler posts a new trip (city-to-city or country-to-country).
 * Trip-first flow: senders see the trip and may create a delivery if the route fits.
 * Non-fatal for trip creation — errors are logged only.
 */
export async function notifyRelevantSendersForNewTrip(tripRow, travelerId) {
  const senderIds = await listSenderUserIds(travelerId);
  if (!senderIds.length) return 0;

  const travelerName = await loadTravelerName(travelerId);
  const route = buildRouteLabel(tripRow);
  const tripPublicId = tripRow.public_id;
  const travelDate = formatTravelDate(tripRow);
  const tripKind =
    tripRow.trip_type === 'country_to_country' ? 'country-to-country' : 'city-to-city';

  let sent = 0;
  for (const senderId of senderIds) {
    await notificationCreateService.createNotification({
      userId: senderId,
      role: 'sender',
      type: 'matching',
      title: 'New traveler trip on your routes',
      body:
        `${travelerName} posted a ${tripKind} trip ${tripPublicId} (${route})` +
        (travelDate ? ` on ${travelDate}` : '') +
        '. View trip details and send a parcel if this route works for you.',
      route: `/discover-trips/${tripPublicId}`,
    });
    sent += 1;
  }

  if (sent > 0) {
    console.log(
      `[trip] notified ${sent} sender(s) for new trip ${tripPublicId} (${route})`
    );
  }

  return sent;
}
