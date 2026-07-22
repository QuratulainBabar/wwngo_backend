import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';

const PLACES_AUTOCOMPLETE =
  'https://maps.googleapis.com/maps/api/place/autocomplete/json';
const PLACES_DETAILS = 'https://maps.googleapis.com/maps/api/place/details/json';

function assertConfigured() {
  if (!env.googleMapsApiKey) {
    throw new AppError(
      'Google Maps is not configured. Set GOOGLE_MAPS_API_KEY on the server.',
      503,
      'MAPS_NOT_CONFIGURED'
    );
  }
}

/**
 * @param {string} query
 * @param {'cities'|'places'} mode
 */
export async function autocomplete(query, mode = 'places') {
  assertConfigured();
  const trimmed = String(query || '').trim();
  if (trimmed.length < 2) return { predictions: [] };

  const types = mode === 'cities' ? '(cities)' : 'establishment|geocode';
  const url = new URL(PLACES_AUTOCOMPLETE);
  url.searchParams.set('input', trimmed);
  url.searchParams.set('key', env.googleMapsApiKey);
  url.searchParams.set('types', types);

  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  const status = data.status || 'UNKNOWN';

  if (status !== 'OK' && status !== 'ZERO_RESULTS') {
    throw new AppError(
      data.error_message || `Places autocomplete failed (${status})`,
      502,
      'PLACES_API_ERROR'
    );
  }

  const predictions = (data.predictions || []).map((item) => {
    const structured = item.structured_formatting || {};
    return {
      name: structured.main_text || item.description || '',
      address: item.description || '',
      placeId: item.place_id || null,
    };
  });

  return { predictions };
}

/**
 * Resolve place details (country ISO + coordinates) for a place_id.
 */
export async function placeDetails(placeId) {
  assertConfigured();
  const id = String(placeId || '').trim();
  if (!id) {
    throw new AppError('placeId is required', 400, 'VALIDATION_ERROR');
  }

  const url = new URL(PLACES_DETAILS);
  url.searchParams.set('place_id', id);
  url.searchParams.set('fields', 'place_id,name,formatted_address,geometry,address_component');
  url.searchParams.set('key', env.googleMapsApiKey);

  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  const status = data.status || 'UNKNOWN';

  if (status !== 'OK') {
    throw new AppError(
      data.error_message || `Places details failed (${status})`,
      502,
      'PLACES_API_ERROR'
    );
  }

  const result = data.result || {};
  const components = result.address_components || [];
  const country = components.find((c) => (c.types || []).includes('country'));
  const locality =
    components.find((c) => (c.types || []).includes('locality')) ||
    components.find((c) => (c.types || []).includes('administrative_area_level_1'));

  return {
    name: locality?.long_name || result.name || '',
    address: result.formatted_address || result.name || '',
    placeId: result.place_id || id,
    countryCode: country?.short_name || null,
    latitude: result.geometry?.location?.lat ?? null,
    longitude: result.geometry?.location?.lng ?? null,
  };
}
