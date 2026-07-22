import * as placesService from '../services/places.service.js';
import { asyncHandler } from '../utils/errors.js';

/**
 * GET /api/v1/places/autocomplete?q=&mode=cities|places
 */
export const autocomplete = asyncHandler(async (req, res) => {
  const q = String(req.query.q || req.query.input || '').trim();
  const mode = String(req.query.mode || 'places').toLowerCase() === 'cities'
    ? 'cities'
    : 'places';
  const data = await placesService.autocomplete(q, mode);
  res.json({ success: true, data });
});

/**
 * GET /api/v1/places/details?placeId=
 */
export const details = asyncHandler(async (req, res) => {
  const placeId = String(req.query.placeId || '').trim();
  const data = await placesService.placeDetails(placeId);
  res.json({ success: true, data });
});
