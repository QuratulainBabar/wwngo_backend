import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { AppError } from '../utils/errors.js';
import * as deliveryRepository from '../repositories/delivery.repository.js';
import * as notificationRepository from '../repositories/notification.repository.js';
import * as notificationCreateService from './notification_create.service.js';
import * as deliveryState from './delivery_state.service.js';
import * as escrowService from './escrow.service.js';
import { sendReceiverParcelRequestEmail } from './email.service.js';
import { pool } from '../db/pool.js';
import {
  parsePaysReceiverFee,
  resolvePlatformFees,
  senderPaysReceiverFee,
  receiverPlatformFeeCents,
  minWalletCentsForReceiverAccept,
  platformFeeDescription,
} from '../utils/fees.js';
import { labelsInSameArea } from '../utils/meetup_location_match.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UPLOADS_ROOT = path.join(__dirname, '../../uploads');
export const DELIVERY_UPLOADS_DIR = path.join(UPLOADS_ROOT, 'deliveries');

const ALLOWED_TYPES = new Set(['city_to_city', 'country_to_country']);
const ALLOWED_CATEGORIES = new Set(['documents', 'objects']);
const ALLOWED_SIZES = new Set(['envelope', 'small box', 'medium box', 'large bag']);
const MAX_MEETUP_LABEL_LENGTH = 240;
const DEFAULT_PLATFORM_FEE = 5.0;
const DEFAULT_PLATFORM_FEE_SHARE = 2.5;
const SENDER_CANCEL_MIN_HOURS_BEFORE_TRAVEL = 24;
const MEETUP_ORIGIN_VALIDATION_MESSAGE =
  'The selected meetup location must be within the selected From City. Please choose a valid meetup location.';
const MEETUP_DESTINATION_VALIDATION_MESSAGE =
  "The selected meetup location must be within the sender's destination city. Please choose a valid meetup location.";

function generatePublicId() {
  const n = crypto.randomInt(10000, 99999);
  return `WW-${n}`;
}

function parseMeetupLocations(raw) {
  if (raw == null || raw === '') return [];
  if (Array.isArray(raw)) return raw.map((s) => String(s).trim()).filter(Boolean);
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((s) => String(s).trim()).filter(Boolean);
      }
    } catch {
      // fall through
    }
    return trimmed
      .replace(/^\[/, '')
      .replace(/\]$/, '')
      .split(',')
      .map((s) => s.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean);
  }
  return [];
}

function toBool(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  const s = String(value ?? '').trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

function toNumber(value, field) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new AppError(`${field} must be a valid number`, 400, 'VALIDATION_ERROR');
  }
  return n;
}

function requireString(value, field) {
  const s = String(value ?? '').trim();
  if (!s) {
    throw new AppError(`${field} is required`, 400, 'VALIDATION_ERROR');
  }
  return s;
}

function meetupBelongsToOrigin(meetupLabel, originCity, originCountryCode, options = {}) {
  return labelsInSameArea(meetupLabel, originCity, {
    routeCountryCode: originCountryCode,
    sameCountrySufficient: Boolean(options.sameCountrySufficient),
  });
}

function assertMeetupsWithinOrigin(
  meetupLocations,
  originCity,
  originCountryCode,
  options = {}
) {
  const city = String(originCity ?? '').trim();
  if (!city) return;
  for (const loc of meetupLocations) {
    if (!meetupBelongsToOrigin(loc, city, originCountryCode, options)) {
      throw new AppError(MEETUP_ORIGIN_VALIDATION_MESSAGE, 400, 'VALIDATION_ERROR');
    }
  }
}

function meetupBelongsToDestination(
  meetupLabel,
  destinationCity,
  destinationCountryCode,
  options = {}
) {
  return labelsInSameArea(meetupLabel, destinationCity, {
    routeCountryCode: destinationCountryCode,
    sameCountrySufficient: Boolean(options.sameCountrySufficient),
  });
}

function assertMeetupWithinDestination(
  meetupLabel,
  destinationCity,
  destinationCountryCode,
  options = {}
) {
  const city = String(destinationCity ?? '').trim();
  if (!city) return;
  if (!meetupBelongsToDestination(meetupLabel, city, destinationCountryCode, options)) {
    throw new AppError(MEETUP_DESTINATION_VALIDATION_MESSAGE, 400, 'VALIDATION_ERROR');
  }
}

function assertCountryToCountryMeetups({
  meetupLocations,
  receiverMeetupLocation,
  originCity,
  originAirport,
  originCountry,
  originCountryCode,
  destinationCity,
  destinationAirport,
  destinationCountry,
  destinationCountryCode,
}) {
  const originOk = (label) =>
    meetupBelongsToOrigin(label, originAirport, originCountryCode, {
      sameCountrySufficient: true,
    }) ||
    meetupBelongsToOrigin(label, originCity, originCountryCode, {
      sameCountrySufficient: true,
    }) ||
    meetupBelongsToOrigin(label, originCountry, originCountryCode, {
      sameCountrySufficient: true,
    });
  for (const loc of meetupLocations) {
    if (!originOk(loc)) {
      throw new AppError(MEETUP_ORIGIN_VALIDATION_MESSAGE, 400, 'VALIDATION_ERROR');
    }
  }

  const destOk =
    meetupBelongsToDestination(
      receiverMeetupLocation,
      destinationAirport,
      destinationCountryCode,
      { sameCountrySufficient: true }
    ) ||
    meetupBelongsToDestination(
      receiverMeetupLocation,
      destinationCity,
      destinationCountryCode,
      { sameCountrySufficient: true }
    ) ||
    meetupBelongsToDestination(
      receiverMeetupLocation,
      destinationCountry,
      destinationCountryCode,
      { sameCountrySufficient: true }
    );
  if (!destOk) {
    throw new AppError(MEETUP_DESTINATION_VALIDATION_MESSAGE, 400, 'VALIDATION_ERROR');
  }
}

function buildRouteLabel(row) {
  if (row.delivery_type === 'country_to_country') {
    return `${row.origin_country} → ${row.destination_country}`;
  }
  return `${row.from_city} → ${row.to_city}`;
}

function photoPublicUrl(filePath) {
  const normalized = String(filePath).replace(/\\/g, '/');
  return `/uploads/${normalized.replace(/^uploads\//, '')}`;
}

function mapPhoto(row) {
  return {
    id: row.id,
    url: photoPublicUrl(row.file_path),
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    sortOrder: row.sort_order,
  };
}

function formatDateOnly(value) {
  if (value == null) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  // node-pg returns DATE as local midnight — use local getters, not toISOString().
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function mapDelivery(row, photos = []) {
  return {
    id: row.id,
    publicId: row.public_id,
    senderId: row.sender_id,
    senderName: row.sender_name || null,
    deliveryType: row.delivery_type,
    status: row.status,
    fromCity: row.from_city,
    fromCode: row.from_code,
    toCity: row.to_city,
    toCode: row.to_code,
    originCountry: row.origin_country,
    originAirport: row.origin_airport,
    destinationCountry: row.destination_country,
    destinationAirport: row.destination_airport,
    travelDate: formatDateOnly(row.travel_date),
    parcelCategory: row.parcel_category,
    parcelSize: row.parcel_size,
    weightKg: Number(row.weight_kg),
    maxBudget: Number(row.max_budget),
    description: row.description,
    preferredMeetupLocations: row.preferred_meetup_locations || [],
    acknowledged: row.acknowledged,
    platformFee: Number(row.platform_fee),
    platformFeeShare: Number(row.platform_fee_share),
    paysReceiverFee: senderPaysReceiverFee(row),
    receiverEmail: row.receiver_email,
    receiverPhone: row.receiver_phone,
    receiverMeetupLocation: row.receiver_meetup_location || null,
    receiverId: row.receiver_id || null,
    receiverName: row.receiver_name || null,
    receiverAcceptedAt: row.receiver_accepted_at || null,
    receiverPaidAt: row.receiver_paid_at || null,
    receiverPaymentDueAt: row.receiver_payment_due_at || null,
    receiverFeeCents: row.receiver_fee_cents != null ? Number(row.receiver_fee_cents) : 0,
    travelerId: row.traveler_id || null,
    travelerName: row.traveler_name || null,
    bidAmount: row.bid_amount != null ? Number(row.bid_amount) : null,
    meetupLocation: row.meetup_location || null,
    chatUnlocked: Boolean(row.chat_unlocked),
    route: buildRouteLabel(row),
    photos: photos.map(mapPhoto),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateDeliveryFormBody(body, deliveryType) {
  if (!ALLOWED_TYPES.has(deliveryType)) {
    throw new AppError(
      'deliveryType must be city_to_city or country_to_country',
      400,
      'VALIDATION_ERROR'
    );
  }

  const parcelCategory = requireString(body.parcelCategory, 'parcelCategory').toLowerCase();
  if (!ALLOWED_CATEGORIES.has(parcelCategory)) {
    throw new AppError('Invalid parcel category', 400, 'VALIDATION_ERROR');
  }

  const parcelSize = requireString(body.parcelSize, 'parcelSize').toLowerCase();
  if (!ALLOWED_SIZES.has(parcelSize)) {
    throw new AppError('Invalid parcel size', 400, 'VALIDATION_ERROR');
  }

  const weightKg = toNumber(body.weightKg, 'weightKg');
  if (weightKg <= 0) {
    throw new AppError('weightKg must be greater than 0', 400, 'VALIDATION_ERROR');
  }

  const maxBudget = toNumber(body.maxBudget, 'maxBudget');
  if (maxBudget <= 0) {
    throw new AppError('maxBudget must be greater than 0', 400, 'VALIDATION_ERROR');
  }

  const travelDate = requireString(body.travelDate, 'travelDate');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(travelDate)) {
    throw new AppError('travelDate must be YYYY-MM-DD', 400, 'VALIDATION_ERROR');
  }

  const description = String(body.description ?? '').trim();
  const acknowledged = toBool(body.acknowledged);
  if (!acknowledged) {
    throw new AppError('Parcel acknowledgement is required', 400, 'VALIDATION_ERROR');
  }

  const preferredMeetupLocations = parseMeetupLocations(body.preferredMeetupLocations);
  if (preferredMeetupLocations.length < 1) {
    throw new AppError('Select at least one preferred meetup location', 400, 'VALIDATION_ERROR');
  }
  if (preferredMeetupLocations.length > 3) {
    throw new AppError('Select up to 3 preferred meetup locations', 400, 'VALIDATION_ERROR');
  }
  for (const loc of preferredMeetupLocations) {
    if (loc.length > MAX_MEETUP_LABEL_LENGTH) {
      throw new AppError(
        `Meetup location is too long (max ${MAX_MEETUP_LABEL_LENGTH} characters)`,
        400,
        'VALIDATION_ERROR'
      );
    }
  }

  const receiverEmail = requireString(body.receiverEmail, 'receiverEmail').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(receiverEmail)) {
    throw new AppError('receiverEmail must be a valid email', 400, 'VALIDATION_ERROR');
  }

  const receiverPhone = requireString(body.receiverPhone, 'receiverPhone');
  const phoneDigits = receiverPhone.replace(/\D/g, '');
  if (phoneDigits.length < 8 || phoneDigits.length > 15) {
    throw new AppError('receiverPhone must be a valid phone number', 400, 'VALIDATION_ERROR');
  }

  const receiverMeetupLocation = requireString(
    body.receiverMeetupLocation,
    'receiverMeetupLocation'
  );
  if (receiverMeetupLocation.length > MAX_MEETUP_LABEL_LENGTH) {
    throw new AppError(
      `Meetup location is too long (max ${MAX_MEETUP_LABEL_LENGTH} characters)`,
      400,
      'VALIDATION_ERROR'
    );
  }

  const paysReceiverFee = parsePaysReceiverFee(body);
  const platformFees = resolvePlatformFees(parcelCategory, paysReceiverFee);

  const base = {
    deliveryType,
    travelDate,
    parcelCategory,
    parcelSize,
    weightKg,
    maxBudget,
    description,
    preferredMeetupLocations,
    acknowledged: true,
    receiverEmail,
    receiverPhone,
    receiverMeetupLocation,
    platformFee: platformFees.platformFee,
    platformFeeShare: platformFees.platformFeeShare,
    paysReceiverFee: platformFees.paysReceiverFee,
    fromCity: null,
    fromCode: null,
    toCity: null,
    toCode: null,
    originCountry: null,
    originAirport: null,
    destinationCountry: null,
    destinationAirport: null,
  };

  if (deliveryType === 'city_to_city') {
    const fromCity = requireString(body.fromCity, 'fromCity');
    const toCity = requireString(body.toCity, 'toCity');
    const payload = {
      ...base,
      fromCity,
      fromCode: requireString(body.fromCode, 'fromCode').toUpperCase(),
      toCity,
      toCode: requireString(body.toCode, 'toCode').toUpperCase(),
    };
    assertMeetupsWithinOrigin(
      preferredMeetupLocations,
      fromCity,
      payload.fromCode
    );
    assertMeetupWithinDestination(
      receiverMeetupLocation,
      toCity,
      payload.toCode
    );
    return payload;
  }

  const originCountry = requireString(body.originCountry, 'originCountry');
  const originAirport = requireString(body.originAirport, 'originAirport');
  const originCity = String(body.originCity ?? '').trim();
  const destinationCountry = requireString(body.destinationCountry, 'destinationCountry');
  const destinationAirport = requireString(body.destinationAirport, 'destinationAirport');
  const destinationCity = String(body.destinationCity ?? '').trim();
  const fromCode = String(body.fromCode ?? '').trim().toUpperCase();
  const toCode = String(body.toCode ?? '').trim().toUpperCase();
  assertCountryToCountryMeetups({
    meetupLocations: preferredMeetupLocations,
    receiverMeetupLocation,
    originCity,
    originAirport,
    originCountry,
    originCountryCode: fromCode,
    destinationCity,
    destinationAirport,
    destinationCountry,
    destinationCountryCode: toCode,
  });

  return {
    ...base,
    originCountry,
    originAirport,
    destinationCountry,
    destinationAirport,
    fromCode: fromCode || null,
    toCode: toCode || null,
  };
}

function validatePayload(body, files) {
  const deliveryType = requireString(body.deliveryType, 'deliveryType');
  const photoFiles = files || [];
  if (photoFiles.length < 1 || photoFiles.length > 3) {
    throw new AppError('Upload between 1 and 3 parcel photos', 400, 'VALIDATION_ERROR');
  }
  return validateDeliveryFormBody(body, deliveryType);
}

function normalizePhoneDigits(phone) {
  return String(phone ?? '').replace(/\D/g, '');
}

async function assertReceiverDistinctFromSender(senderId, receiverEmail, receiverPhone) {
  const { rows } = await pool.query(
    `SELECT email, phone FROM users WHERE id = $1`,
    [senderId]
  );
  const sender = rows[0];
  if (!sender) return;

  const normalizedReceiverEmail = String(receiverEmail).trim().toLowerCase();
  const senderEmail = String(sender.email ?? '').trim().toLowerCase();
  if (senderEmail && normalizedReceiverEmail === senderEmail) {
    throw new AppError(
      'Receiver email must be different from your sender account email. The receiver should sign in with their own Gmail.',
      400,
      'RECEIVER_EMAIL_SAME_AS_SENDER'
    );
  }

  const receiverDigits = normalizePhoneDigits(receiverPhone);
  const senderDigits = normalizePhoneDigits(sender.phone);
  if (receiverDigits && senderDigits && receiverDigits === senderDigits) {
    throw new AppError(
      'Receiver phone must be different from your sender account phone. Each role should use its own account.',
      400,
      'RECEIVER_PHONE_SAME_AS_SENDER'
    );
  }
}

async function ensureUploadDir() {
  await fs.mkdir(DELIVERY_UPLOADS_DIR, { recursive: true });
}

/**
 * Create a delivery for the authenticated sender.
 */
export async function createDelivery(senderId, body, files) {
  const payload = validatePayload(body, files);
  await assertReceiverDistinctFromSender(
    senderId,
    payload.receiverEmail,
    payload.receiverPhone
  );
  await ensureUploadDir();

  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const publicId = generatePublicId();
    const deliveryFolder = path.join(DELIVERY_UPLOADS_DIR, publicId);
    await fs.mkdir(deliveryFolder, { recursive: true });

    const photoRecords = [];
    try {
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        const ext = path.extname(file.originalname || '') || guessExt(file.mimetype);
        const filename = `photo_${i + 1}${ext}`;
        const absolutePath = path.join(deliveryFolder, filename);
        await fs.writeFile(absolutePath, file.buffer);
        photoRecords.push({
          filePath: `deliveries/${publicId}/${filename}`,
          originalName: file.originalname || filename,
          mimeType: file.mimetype,
          sizeBytes: file.size,
        });
      }

      const { delivery, photos } = await deliveryRepository.createDeliveryWithPhotos({
        delivery: {
          publicId,
          senderId,
          ...payload,
        },
        photos: photoRecords,
      });

      let mapped = mapDelivery(delivery, photos);
      const senderName = await loadSenderName(senderId);

      // Do not debit sender platform fees here (documents $2 / objects $4,
      // or $3 / $6 when the sender pays 100%). Those are collected at Pay Now.
      // receiver lists update even if SMTP is slow/down (Flutter times out at 20s).
      try {
        const receiverUserId =
          (await deliveryRepository.findUserIdByEmail(payload.receiverEmail)) ||
          (await deliveryRepository.findUserIdByPhone(payload.receiverPhone));
        console.log(
          `[delivery] ${publicId} receiver lookup:`,
          receiverUserId ? `user=${receiverUserId}` : 'no matching account'
        );
        if (receiverUserId && receiverUserId !== senderId) {
          const linked = await deliveryRepository.linkReceiverUser(
            delivery.id,
            receiverUserId
          );
          if (linked) {
            mapped = mapDelivery(linked, photos);
          }
          await notificationCreateService.createNotification({
            userId: receiverUserId,
            role: 'receiver',
            type: 'parcelRequest',
            title: 'Incoming Parcel Request',
            body:
              'A sender wants to send a parcel through you. Please review the request and accept or decline it.',
            route: `/receiver-incoming-request/${mapped.publicId}`,
          });
          console.log(`[delivery] ${publicId} receiver alert created`);
        }
      } catch (err) {
        // Non-fatal: delivery already created — log so linking failures are visible.
        console.error('[delivery] receiver notify/link failed:', err?.message || err);
      }

      // Email the form address in background (IPv4 SMTP). Never block the HTTP
      // response — notify/link already completed above.
      void sendReceiverParcelRequestEmail(payload.receiverEmail, {
        publicId: mapped.publicId,
        senderName,
        deliveryType: mapped.deliveryType,
        route: mapped.route,
        travelDate: mapped.travelDate,
        parcelCategory: mapped.parcelCategory,
        maxBudget: mapped.maxBudget,
      })
        .then(() => {
          console.log(
            `[delivery] ${publicId} receiver email accepted for ${payload.receiverEmail}`
          );
        })
        .catch((err) => {
          console.error('[delivery] receiver email failed:', err?.message || err);
        });

      return mapped;
    } catch (err) {
      await fs.rm(deliveryFolder, { recursive: true, force: true }).catch(() => {});
      // Retry on rare public_id collision.
      if (err?.code === '23505' && String(err?.constraint || '').includes('public_id')) {
        lastError = err;
        continue;
      }
      throw err;
    }
  }

  throw lastError || new AppError('Unable to allocate delivery ID', 500, 'INTERNAL_ERROR');
}

function guessExt(mime) {
  switch (mime) {
    case 'image/jpeg':
      return '.jpg';
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    case 'image/heic':
      return '.heic';
    default:
      return '.jpg';
  }
}

export async function getDeliveryForSender(senderId, idOrPublicId) {
  const looksLikeUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      idOrPublicId
    );

  const row = looksLikeUuid
    ? await deliveryRepository.findDeliveryByIdForSender(idOrPublicId, senderId)
    : await deliveryRepository.findDeliveryByPublicIdForSender(idOrPublicId, senderId);

  if (!row) {
    throw new AppError('Delivery not found', 404, 'NOT_FOUND');
  }

  const photos = await deliveryRepository.listPhotosForDelivery(row.id);
  return mapDelivery(row, photos);
}

export async function listSenderDeliveries(senderId, query = {}) {
  const limit = Math.min(Number(query.limit) || 50, 100);
  const offset = Math.max(Number(query.offset) || 0, 0);
  const rows = await deliveryRepository.listDeliveriesForSender(senderId, { limit, offset });
  const photos = await deliveryRepository.listPhotosForDeliveries(rows.map((r) => r.id));
  const byDelivery = new Map();
  for (const photo of photos) {
    if (!byDelivery.has(photo.delivery_id)) byDelivery.set(photo.delivery_id, []);
    byDelivery.get(photo.delivery_id).push(photo);
  }
  return rows.map((row) => mapDelivery(row, byDelivery.get(row.id) || []));
}

async function loadUserContact(userId) {
  const { rows } = await pool.query(
    `SELECT email, phone FROM users WHERE id = $1`,
    [userId]
  );
  return rows[0] || { email: '', phone: '' };
}

async function loadSenderName(senderId) {
  const { rows } = await pool.query(`SELECT name FROM users WHERE id = $1`, [senderId]);
  return rows[0]?.name || null;
}

async function resolveUserContact(user) {
  const contact = await loadUserContact(user.id);
  return {
    email: contact.email || user.email || '',
    phone: contact.phone || '',
  };
}

/**
 * GET list for authenticated user.
 * role=receiver → incoming parcels; role=traveler → assigned bookings; else sender posts.
 */
export async function listDeliveriesForUser(user, query = {}) {
  const role = String(query.role || 'sender').toLowerCase();
  if (role === 'receiver') {
    return listReceiverDeliveries(user, query);
  }
  if (role === 'traveler') {
    return listTravelerDeliveries(user.id, query);
  }
  return listSenderDeliveries(user.id, query);
}

export async function listTravelerDeliveries(travelerId, query = {}) {
  const limit = Math.min(Number(query.limit) || 50, 100);
  const offset = Math.max(Number(query.offset) || 0, 0);
  const rows = await deliveryRepository.listDeliveriesForTraveler(travelerId, {
    limit,
    offset,
  });
  const photos = await deliveryRepository.listPhotosForDeliveries(rows.map((r) => r.id));
  const byDelivery = new Map();
  for (const photo of photos) {
    if (!byDelivery.has(photo.delivery_id)) byDelivery.set(photo.delivery_id, []);
    byDelivery.get(photo.delivery_id).push(photo);
  }
  return rows.map((row) => mapDelivery(row, byDelivery.get(row.id) || []));
}

export async function getDeliveryForTraveler(travelerId, idOrPublicId) {
  const looksLikeUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      idOrPublicId
    );

  const row = looksLikeUuid
    ? await deliveryRepository.findDeliveryByIdForTraveler(idOrPublicId, travelerId)
    : await deliveryRepository.findDeliveryByPublicIdForTraveler(
        idOrPublicId,
        travelerId
      );

  if (!row) {
    throw new AppError('Delivery not found', 404, 'NOT_FOUND');
  }

  const photos = await deliveryRepository.listPhotosForDelivery(row.id);
  return mapDelivery(row, photos);
}

export async function listReceiverDeliveries(user, query = {}) {
  const limit = Math.min(Number(query.limit) || 50, 100);
  const offset = Math.max(Number(query.offset) || 0, 0);
  const contact = await resolveUserContact(user);

  const rows = await deliveryRepository.listDeliveriesForReceiver(
    user.id,
    contact.email,
    contact.phone,
    { limit, offset }
  );

  // Heal missing in-app alerts for pending requests (older creates / failed notify).
  await ensureReceiverParcelRequestNotifications(user.id, rows);

  const photos = await deliveryRepository.listPhotosForDeliveries(rows.map((r) => r.id));
  const byDelivery = new Map();
  for (const photo of photos) {
    if (!byDelivery.has(photo.delivery_id)) byDelivery.set(photo.delivery_id, []);
    byDelivery.get(photo.delivery_id).push(photo);
  }
  return rows.map((row) => mapDelivery(row, byDelivery.get(row.id) || []));
}

/**
 * Ensure each pending incoming delivery has a receiver Alerts item.
 * Idempotent — skips routes that already exist.
 */
async function ensureReceiverParcelRequestNotifications(userId, rows) {
  for (const row of rows) {
    if (row.status !== 'posted' || row.receiver_accepted_at) continue;
    const publicId = row.public_id;
    if (!publicId) continue;

    if (!row.receiver_id) {
      try {
        await deliveryRepository.linkReceiverUser(row.id, userId);
      } catch (err) {
        console.error('[delivery] backfill link failed:', err?.message || err);
      }
    }

    const route = `/receiver-incoming-request/${publicId}`;
    try {
      const exists = await notificationRepository.existsByUserRoleRoute(
        userId,
        'receiver',
        route
      );
      if (exists) continue;

      await notificationCreateService.createNotification({
        userId,
        role: 'receiver',
        type: 'parcelRequest',
        title: 'Incoming Parcel Request',
        body:
          'A sender wants to send a parcel through you. Please review the request and accept or decline it.',
        route,
      });
      console.log(`[delivery] backfilled receiver alert for ${publicId}`);
    } catch (err) {
      console.error(
        `[delivery] backfill notify failed for ${publicId}:`,
        err?.message || err
      );
    }
  }
}

export async function getDeliveryForUser(user, idOrPublicId, query = {}) {
  const role = String(query.role || '').toLowerCase();
  if (role === 'receiver') {
    return getDeliveryForReceiver(user, idOrPublicId);
  }
  if (role === 'traveler') {
    return getDeliveryForTraveler(user.id, idOrPublicId);
  }

  // Try sender first, then traveler, then receiver (deep links / shared IDs).
  try {
    return await getDeliveryForSender(user.id, idOrPublicId);
  } catch (err) {
    if (err?.statusCode !== 404 && err?.status !== 404) throw err;
  }
  try {
    return await getDeliveryForTraveler(user.id, idOrPublicId);
  } catch (err) {
    if (err?.statusCode !== 404 && err?.status !== 404) throw err;
    return getDeliveryForReceiver(user, idOrPublicId);
  }
}

export async function getDeliveryForReceiver(user, idOrPublicId) {
  const contact = await resolveUserContact(user);

  const looksLikeUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      idOrPublicId
    );

  const row = looksLikeUuid
    ? await deliveryRepository.findDeliveryByIdForReceiver(
        idOrPublicId,
        user.id,
        contact.email,
        contact.phone
      )
    : await deliveryRepository.findDeliveryByPublicIdForReceiver(
        idOrPublicId,
        user.id,
        contact.email,
        contact.phone
      );

  if (!row) {
    throw new AppError('Delivery not found', 404, 'NOT_FOUND');
  }

  const photos = await deliveryRepository.listPhotosForDelivery(row.id);
  return mapDelivery(row, photos);
}

export async function acceptDeliveryAsReceiver(user, idOrPublicId, options = {}) {
  const delivery = await getDeliveryForReceiver(user, idOrPublicId);
  if (delivery.senderId === user.id) {
    throw new AppError(
      'You cannot accept a delivery you created as sender. Sign in with the receiver Gmail account instead.',
      400,
      'SENDER_CANNOT_ACCEPT_AS_RECEIVER'
    );
  }
  if (delivery.status === 'cancelled' || delivery.status === 'delivered') {
    throw new AppError('This request can no longer be accepted', 400, 'INVALID_STATUS');
  }
  if (delivery.receiverAcceptedAt) {
    return delivery;
  }

  const paysReceiver = senderPaysReceiverFee(delivery);
  const receiverFeeCents = receiverPlatformFeeCents(
    delivery.parcelCategory,
    paysReceiver
  );
  const requiredCents = minWalletCentsForReceiverAccept(
    delivery.parcelCategory,
    paysReceiver
  );

  const walletRepo = await import('../repositories/wallet.repository.js');
  const wallet = await walletRepo.getWallet(user.id);
  if (Number(wallet.available_cents) < requiredCents) {
    throw new AppError(
      receiverFeeCents > 0
        ? `Insufficient wallet balance. You need at least $${(requiredCents / 100).toFixed(2)} to accept (includes platform fee).`
        : `Insufficient wallet balance. You need at least $${(requiredCents / 100).toFixed(2)} to accept.`,
      403,
      'INSUFFICIENT_WALLET'
    );
  }

  if (receiverFeeCents > 0 && !delivery.receiverPaidAt) {
    await escrowService.chargeWalletOrCard({
      userId: user.id,
      role: 'receiver',
      amountCents: receiverFeeCents,
      description: platformFeeDescription(delivery.publicId),
      shipmentId: delivery.publicId,
      paymentIntentId: options.paymentIntentId || null,
      allowPaymentRequired: true,
    });
  }

  const updated = await deliveryRepository.acceptDeliveryAsReceiver(
    delivery.id,
    user.id,
    { receiverFeeCents }
  );
  if (!updated) {
    throw new AppError('Unable to accept this request', 400, 'ACCEPT_FAILED');
  }

  const photos = await deliveryRepository.listPhotosForDelivery(updated.id);
  const mapped = mapDelivery(
    { ...updated, sender_name: delivery.senderName },
    photos
  );

  await notificationCreateService.createNotification({
    userId: delivery.senderId,
    role: 'sender',
    type: 'deliveryStatus',
    title: 'Receiver accepted',
    body: `Receiver accepted ${mapped.publicId}. Matching travelers are now available.`,
    route: `/bid-requests/${mapped.publicId}`,
  }).catch(() => {});

  // Ensure a chat thread exists between sender and receiver for this parcel.
  try {
    const chatRepo = await import('../repositories/chat.repository.js');
    await chatRepo.ensureConversation({
      deliveryId: mapped.id,
      participantAId: delivery.senderId,
      participantBId: user.id,
    });
  } catch {
    // Non-fatal.
  }

  return mapped;
}

export async function declineDeliveryAsReceiver(user, idOrPublicId) {
  const delivery = await getDeliveryForReceiver(user, idOrPublicId);
  if (delivery.receiverAcceptedAt) {
    throw new AppError('Accepted requests cannot be declined', 400, 'ALREADY_ACCEPTED');
  }
  if (delivery.status !== 'posted') {
    throw new AppError('This request can no longer be declined', 400, 'INVALID_STATUS');
  }

  const updated = await deliveryRepository.declineDeliveryAsReceiver(delivery.id);
  if (!updated) {
    throw new AppError('Unable to decline this request', 400, 'DECLINE_FAILED');
  }

  const photos = await deliveryRepository.listPhotosForDelivery(updated.id);
  return mapDelivery({ ...updated, sender_name: delivery.senderName }, photos);
}

/**
 * Receiver pays platform fee share ($0 / $2 docs / $3 objects).
 * Normally collected when the receiver accepts; this endpoint remains for
 * legacy/backfill when acceptance happened without a fee charge.
 */
export async function submitReceiverPayment(
  user,
  idOrPublicId,
  { feeCents, paymentIntentId = null } = {}
) {
  const delivery = await getDeliveryForReceiver(user, idOrPublicId);
  if (delivery.receiverPaidAt) {
    return delivery;
  }
  if (!['bid_accepted', 'waiting_receiver', 'posted'].includes(delivery.status)) {
    throw new AppError('Payment is not required for this delivery state', 400, 'INVALID_STATUS');
  }

  const paysReceiver = senderPaysReceiverFee(delivery);
  const expectedCents = receiverPlatformFeeCents(delivery.parcelCategory, paysReceiver);
  const cents = Number(feeCents);
  if (cents !== expectedCents) {
    throw new AppError(
      `feeCents must be ${expectedCents} for this delivery`,
      400,
      'VALIDATION_ERROR'
    );
  }
  if (cents === 0) {
    const { rows } = await pool.query(
      `UPDATE deliveries
       SET receiver_paid_at = COALESCE(receiver_paid_at, NOW()),
           receiver_fee_cents = 0,
           receiver_payment_due_at = NULL,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [delivery.id]
    );
    const updated = rows[0];
    const photos = await deliveryRepository.listPhotosForDelivery(updated.id);
    return mapDelivery({ ...updated, sender_name: delivery.senderName }, photos);
  }

  await escrowService.chargeWalletOrCard({
    userId: user.id,
    role: 'receiver',
    amountCents: cents,
    description: `Receiver platform fee for ${delivery.publicId}`,
    shipmentId: delivery.publicId,
    paymentIntentId: paymentIntentId || null,
    allowPaymentRequired: true,
  });

  const { rows } = await pool.query(
    `UPDATE deliveries
     SET receiver_paid_at = NOW(),
         receiver_fee_cents = $2,
         receiver_payment_due_at = NULL,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [delivery.id, cents]
  );

  const updated = rows[0];
  const photos = await deliveryRepository.listPhotosForDelivery(updated.id);
  const mapped = mapDelivery({ ...updated, sender_name: delivery.senderName }, photos);

  await notificationCreateService.createNotification({
    userId: delivery.senderId,
    role: 'sender',
    type: 'deliveryStatus',
    title: 'Receiver paid fee share',
    body: `Receiver paid their platform fee for ${mapped.publicId}.`,
    route: `/track/${mapped.publicId}`,
  }).catch(() => {});

  return mapped;
}

/**
 * Open a dispute on an active delivery.
 */
export async function openDispute(user, idOrPublicId, { reason } = {}) {
  const text = String(reason || '').trim();
  if (!text) {
    throw new AppError('Dispute reason is required', 400, 'VALIDATION_ERROR');
  }

  const isUuid = /^[0-9a-f-]{36}$/i.test(String(idOrPublicId));
  let delivery = isUuid
    ? await deliveryRepository.findDeliveryByIdForSender(idOrPublicId, user.id)
    : await deliveryRepository.findDeliveryByPublicIdForUser(idOrPublicId, user.id);

  if (!delivery && isUuid) {
    delivery = await deliveryRepository.findDeliveryByPublicIdForUser(idOrPublicId, user.id);
  }
  if (!delivery) {
    throw new AppError('Delivery not found', 404, 'NOT_FOUND');
  }

  if (['cancelled', 'delivered'].includes(delivery.status)) {
    throw new AppError('Cannot dispute a completed or cancelled delivery', 400, 'INVALID_STATUS');
  }

  const { rows: existing } = await pool.query(
    `SELECT id FROM disputes WHERE delivery_id = $1 AND status IN ('open', 'under_review') LIMIT 1`,
    [delivery.id]
  );
  if (existing[0]) {
    throw new AppError('A dispute is already open for this delivery', 409, 'DISPUTE_EXISTS');
  }

  const deliveryState = await import('./delivery_state.service.js');
  await deliveryState.transitionDelivery({
    deliveryId: delivery.id,
    toStatus: 'disputed',
    actorId: user.id,
    note: text.slice(0, 500),
  });

  const { rows } = await pool.query(
    `INSERT INTO disputes (delivery_id, opened_by, reason)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [delivery.id, user.id, text]
  );

  await escrowService.freezeEscrowForDelivery(delivery.public_id).catch(() => {});

  return { dispute: rows[0], deliveryId: delivery.id, publicId: delivery.public_id };
}

function assertSenderCanModifyPostedDelivery(delivery) {
  if (delivery.status !== 'posted') {
    throw new AppError(
      'Only posted deliveries can be edited or cancelled',
      400,
      'INVALID_STATUS'
    );
  }
}

function parseTravelDateForCancelCheck(travelDateStr) {
  if (!travelDateStr || !/^\d{4}-\d{2}-\d{2}$/.test(travelDateStr)) {
    return null;
  }
  const [y, m, d] = travelDateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function assertSenderCanCancelBeforeTravel(travelDateStr) {
  if (!isHoursUntilTravelAtLeast(travelDateStr, SENDER_CANCEL_MIN_HOURS_BEFORE_TRAVEL)) {
    throw new AppError(
      `Cancellations must be made at least ${SENDER_CANCEL_MIN_HOURS_BEFORE_TRAVEL} hours before travel`,
      400,
      'CANCEL_TOO_LATE'
    );
  }
}

function isHoursUntilTravelAtLeast(travelDateStr, minHours) {
  const travelDate = parseTravelDateForCancelCheck(travelDateStr);
  if (!travelDate) {
    return false;
  }
  const msUntilTravel = travelDate.getTime() - Date.now();
  const hoursUntilTravel = msUntilTravel / (1000 * 60 * 60);
  return hoursUntilTravel >= minHours;
}

function parseRetainedPhotoIds(raw) {
  if (raw == null || raw === '') return [];
  if (Array.isArray(raw)) {
    return raw.map((id) => String(id).trim()).filter(Boolean);
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((id) => String(id).trim()).filter(Boolean);
      }
    } catch {
      return trimmed
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
    }
  }
  return [];
}

async function saveDeliveryPhotoFiles(publicId, files) {
  const deliveryFolder = path.join(DELIVERY_UPLOADS_DIR, publicId);
  await fs.mkdir(deliveryFolder, { recursive: true });
  const photoRecords = [];
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    const ext = path.extname(file.originalname || '') || guessExt(file.mimetype);
    const filename = `photo_${Date.now()}_${i + 1}${ext}`;
    const absolutePath = path.join(deliveryFolder, filename);
    await fs.writeFile(absolutePath, file.buffer);
    photoRecords.push({
      filePath: `deliveries/${publicId}/${filename}`,
      originalName: file.originalname || filename,
      mimeType: file.mimetype,
      sizeBytes: file.size,
    });
  }
  return photoRecords;
}

/**
 * PATCH sender delivery — all fields from delivery creation.
 */
export async function updateDeliveryForSender(senderId, idOrPublicId, body, files = []) {
  const delivery = await getDeliveryForSender(senderId, idOrPublicId);
  assertSenderCanModifyPostedDelivery(delivery);

  const payload = validateDeliveryFormBody(
    { ...body, deliveryType: delivery.deliveryType, acknowledged: 'true' },
    delivery.deliveryType
  );
  await assertReceiverDistinctFromSender(
    senderId,
    payload.receiverEmail,
    payload.receiverPhone
  );

  const retainedPhotoIds = parseRetainedPhotoIds(body.retainedPhotoIds);
  const newFiles = files || [];
  const existingPhotos = await deliveryRepository.listPhotosForDelivery(delivery.id);
  const validRetained = retainedPhotoIds.filter((id) =>
    existingPhotos.some((photo) => photo.id === id)
  );
  const totalPhotos = validRetained.length + newFiles.length;
  if (totalPhotos < 1 || totalPhotos > 3) {
    throw new AppError('Upload between 1 and 3 parcel photos', 400, 'VALIDATION_ERROR');
  }

  const updated = await deliveryRepository.updateDeliveryForSender(
    delivery.id,
    senderId,
    delivery.deliveryType,
    payload
  );
  if (!updated) {
    throw new AppError('Unable to update this delivery', 400, 'UPDATE_FAILED');
  }

  let photos = existingPhotos;
  if (newFiles.length > 0 || validRetained.length !== existingPhotos.length) {
    const photoRecords =
      newFiles.length > 0 ? await saveDeliveryPhotoFiles(delivery.publicId, newFiles) : [];
    await deliveryRepository.replaceDeliveryPhotos(
      delivery.id,
      photoRecords,
      validRetained
    );
    photos = await deliveryRepository.listPhotosForDelivery(delivery.id);
  }

  return mapDelivery({ ...updated, sender_name: delivery.senderName }, photos);
}

/**
 * POST sender cancel — open listings (≥24h before travel) or booked shipments
 * through collected (escrow always refunded; platform fees per 24h rule).
 */
export async function cancelDeliveryForSender(senderId, idOrPublicId) {
  const delivery = await getDeliveryForSender(senderId, idOrPublicId);

  const openCancellable = ['posted', 'waiting_receiver'];
  const bookingCancellable = [
    'bid_accepted',
    'matched',
    'ready_for_handoff',
    'collected',
  ];
  const isOpen = openCancellable.includes(delivery.status);
  const isBooking = bookingCancellable.includes(delivery.status);

  if (!isOpen && !isBooking) {
    throw new AppError(
      'This delivery cannot be cancelled at its current stage',
      400,
      'INVALID_STATUS'
    );
  }

  if (isOpen) {
    if (!parseTravelDateForCancelCheck(delivery.travelDate)) {
      throw new AppError('Invalid travel date on delivery', 400, 'VALIDATION_ERROR');
    }
    assertSenderCanCancelBeforeTravel(delivery.travelDate);
  }

  const platformFeesRefundable = isHoursUntilTravelAtLeast(
    delivery.travelDate,
    SENDER_CANCEL_MIN_HOURS_BEFORE_TRAVEL
  );

  await deliveryState.transitionDelivery({
    deliveryId: delivery.id,
    toStatus: 'cancelled',
    actorId: senderId,
    note: 'Cancelled by sender',
  });

  const refund = await escrowService.refundEscrowForDelivery(
    delivery.publicId,
    'Sender cancelled delivery'
  );

  let platformFeeRefund = { refunded: false, entries: [] };
  if (platformFeesRefundable) {
    platformFeeRefund = await escrowService.refundPlatformFeesForDelivery(
      delivery.publicId
    );
  }

  const updated = await deliveryRepository.findDeliveryByIdForSender(
    delivery.id,
    senderId
  );
  if (!updated) {
    throw new AppError('Delivery not found after cancel', 500, 'INTERNAL_ERROR');
  }

  if (updated?.receiver_id) {
    await notificationCreateService.createNotification({
      userId: updated.receiver_id,
      role: 'receiver',
      type: 'cancellation',
      title: 'Delivery cancelled',
      body: `The sender cancelled parcel request ${delivery.publicId}.`,
      route: '/receiver-incoming',
    }).catch(() => {});
  }

  if (updated?.traveler_id) {
    await notificationCreateService.createNotification({
      userId: updated.traveler_id,
      role: 'traveler',
      type: 'cancellation',
      title: 'Delivery cancelled',
      body: `Parcel ${delivery.publicId} was cancelled by the sender.`,
      route: '/matching-requests',
    }).catch(() => {});
  }

  const photos = await deliveryRepository.listPhotosForDelivery(updated.id);
  return {
    ...mapDelivery({ ...updated, sender_name: delivery.senderName }, photos),
    escrowRefund: refund,
    platformFeesRefunded: platformFeesRefundable && platformFeeRefund.refunded,
  };
}
