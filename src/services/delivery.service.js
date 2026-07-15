import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { AppError } from '../utils/errors.js';
import * as deliveryRepository from '../repositories/delivery.repository.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UPLOADS_ROOT = path.join(__dirname, '../../uploads');
export const DELIVERY_UPLOADS_DIR = path.join(UPLOADS_ROOT, 'deliveries');

const ALLOWED_TYPES = new Set(['city_to_city', 'country_to_country']);
const ALLOWED_CATEGORIES = new Set(['documents', 'objects']);
const ALLOWED_SIZES = new Set(['envelope', 'small box', 'medium box', 'large bag']);
const ALLOWED_MEETUPS = new Set([
  'Airport',
  'Coffee Shop',
  'Shopping Mall',
  'Bus Station',
  'Train Station',
  'Hotel Lobby',
]);

const DEFAULT_PLATFORM_FEE = 5.0;
const DEFAULT_PLATFORM_FEE_SHARE = 2.5;

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
    receiverEmail: row.receiver_email,
    receiverPhone: row.receiver_phone,
    route: buildRouteLabel(row),
    photos: photos.map(mapPhoto),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validatePayload(body, files) {
  const deliveryType = requireString(body.deliveryType, 'deliveryType');
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
  if (preferredMeetupLocations.length > 4) {
    throw new AppError('Select up to 4 preferred meetup locations', 400, 'VALIDATION_ERROR');
  }
  for (const loc of preferredMeetupLocations) {
    if (!ALLOWED_MEETUPS.has(loc)) {
      throw new AppError(`Invalid meetup location: ${loc}`, 400, 'VALIDATION_ERROR');
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

  const photoFiles = files || [];
  if (photoFiles.length < 1 || photoFiles.length > 3) {
    throw new AppError('Upload between 1 and 3 parcel photos', 400, 'VALIDATION_ERROR');
  }

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
    platformFee: body.platformFee != null
      ? toNumber(body.platformFee, 'platformFee')
      : DEFAULT_PLATFORM_FEE,
    platformFeeShare: body.platformFeeShare != null
      ? toNumber(body.platformFeeShare, 'platformFeeShare')
      : DEFAULT_PLATFORM_FEE_SHARE,
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
    return {
      ...base,
      fromCity: requireString(body.fromCity, 'fromCity'),
      fromCode: requireString(body.fromCode, 'fromCode').toUpperCase(),
      toCity: requireString(body.toCity, 'toCity'),
      toCode: requireString(body.toCode, 'toCode').toUpperCase(),
    };
  }

  return {
    ...base,
    originCountry: requireString(body.originCountry, 'originCountry'),
    originAirport: requireString(body.originAirport, 'originAirport'),
    destinationCountry: requireString(body.destinationCountry, 'destinationCountry'),
    destinationAirport: requireString(body.destinationAirport, 'destinationAirport'),
  };
}

async function ensureUploadDir() {
  await fs.mkdir(DELIVERY_UPLOADS_DIR, { recursive: true });
}

/**
 * Create a delivery for the authenticated sender.
 */
export async function createDelivery(senderId, body, files) {
  const payload = validatePayload(body, files);
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

      return mapDelivery(delivery, photos);
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
