/**
 * Destination (To) matching for sender deliveries ↔ traveler trips.
 *
 * A traveler matches only when their To location matches the sender's To.
 *
 * City-to-city: compare destination city labels (to_city).
 *   to_code is a country ISO — it must NOT be used as a city match key.
 * Country-to-country (air): compare destination country ISO codes and/or names.
 * Country-to-country (land): traveler To city must match the city of the
 *   sender's selected destination airport (air + land both eligible).
 * Cross-type is allowed when ISO codes agree (e.g. country parcel CZ ↔
 * city trip ending in CZ / "Prague, Czechia") — for land city trips that
 * city must still match the airport city when the delivery is airport-based.
 */

/** Common official / colloquial country name variants → canonical key. */
const COUNTRY_NAME_ALIASES = {
  czechia: 'czechia',
  'czech republic': 'czechia',
  'united states': 'united states',
  'united states of america': 'united states',
  usa: 'united states',
  'u s a': 'united states',
  'u s': 'united states',
  'united kingdom': 'united kingdom',
  'great britain': 'united kingdom',
  britain: 'united kingdom',
  uk: 'united kingdom',
  'u k': 'united kingdom',
  russia: 'russia',
  'russian federation': 'russia',
  'south korea': 'south korea',
  'korea republic of': 'south korea',
  'republic of korea': 'south korea',
  'north korea': 'north korea',
  'korea democratic people s republic of': 'north korea',
  vietnam: 'vietnam',
  'viet nam': 'vietnam',
  laos: 'laos',
  'lao people s democratic republic': 'laos',
  syria: 'syria',
  'syrian arab republic': 'syria',
  iran: 'iran',
  'iran islamic republic of': 'iran',
  bolivia: 'bolivia',
  'bolivia plurinational state of': 'bolivia',
  venezuela: 'venezuela',
  'venezuela bolivarian republic of': 'venezuela',
  tanzania: 'tanzania',
  'tanzania united republic of': 'tanzania',
  moldova: 'moldova',
  'moldova republic of': 'moldova',
  'ivory coast': 'cote d ivoire',
  "cote d ivoire": 'cote d ivoire',
  'cape verde': 'cabo verde',
  'cabo verde': 'cabo verde',
  swaziland: 'eswatini',
  eswatini: 'eswatini',
  macedonia: 'north macedonia',
  'north macedonia': 'north macedonia',
  'macedonia the former yugoslav republic of': 'north macedonia',
  brunei: 'brunei',
  'brunei darussalam': 'brunei',
};

export function normalizePlace(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Canonical country label for alias-aware matching. */
export function normalizeCountryName(value) {
  const normalized = normalizePlace(value);
  if (!normalized) return '';
  return COUNTRY_NAME_ALIASES[normalized] || normalized;
}

/**
 * Primary place token for matching — usually the city (text before the first
 * comma). Lets "Paris, France" match "Paris, Île-de-France, France".
 */
export function placeHead(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const head = raw.split(',')[0];
  return normalizePlace(head);
}

/**
 * Best-effort city name from an airport / Places label.
 * Handles "Istanbul Airport (IST), Istanbul, Türkiye" → "Istanbul".
 */
export function cityFromAirportOrPlaceLabel(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  const parts = raw
    .split(/[,;|]/)
    .map((part) => part.trim())
    .filter(Boolean);

  // "Airport (CODE), City, Country" → City (parts[1])
  // "Airport (CODE), District, City, Country" → City (second-to-last)
  if (parts.length >= 4) {
    return parts[parts.length - 2];
  }
  if (parts.length === 3) {
    return parts[1];
  }

  // "City, Country" → City
  if (parts.length === 2) {
    const first = parts[0].replace(/\([^)]*\)/g, '').trim();
    if (!/\bairport\b/i.test(first)) return first;
  }

  // Single segment: strip IATA + "airport" noise, keep remaining words.
  const cleaned = raw
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(international|intl|airport|aeroport|aéroport)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || parts[0] || raw;
}

/**
 * True when two place labels refer to the same destination.
 * Uses exact equality, containment, country aliases, or matching city heads.
 */
export function placesMatch(a, b) {
  const left = normalizePlace(a);
  const right = normalizePlace(b);
  if (!left || !right) return false;
  if (left === right) return true;

  const leftCountry = normalizeCountryName(a);
  const rightCountry = normalizeCountryName(b);
  if (leftCountry && rightCountry && leftCountry === rightCountry) return true;

  if (left.includes(right) || right.includes(left)) return true;

  const leftHead = placeHead(a);
  const rightHead = placeHead(b);
  if (!leftHead || !rightHead) return false;
  if (leftHead === rightHead) return true;

  // Avoid ultra-short heads ("san", "st") causing false positives via containment.
  if (leftHead.length < 4 || rightHead.length < 4) return false;
  return leftHead.includes(rightHead) || rightHead.includes(leftHead);
}

function codesMatch(a, b) {
  const left = String(a ?? '').trim().toUpperCase();
  const right = String(b ?? '').trim().toUpperCase();
  if (!left || !right) return false;
  // Unresolved placeholder from the client — never treat as a real match key.
  if (left === 'XX' || right === 'XX') return false;
  return left === right;
}

function isCountryToCountry(row) {
  const type =
    row?.delivery_type || row?.deliveryType || row?.trip_type || row?.tripType;
  return type === 'country_to_country';
}

function travelMethodOf(row) {
  return String(row?.travel_method || row?.travelMethod || '')
    .trim()
    .toLowerCase();
}

/**
 * Land traveler: explicit method, city endpoints without airport, or city-to-city.
 */
export function isLandTravelerTrip(trip) {
  const method = travelMethodOf(trip);
  if (method === 'land') return true;
  if (method === 'air') return false;

  const toCity = String(trip?.to_city || trip?.toCity || '').trim();
  const destAirport = String(
    trip?.destination_airport || trip?.destinationAirport || ''
  ).trim();
  if (toCity && !destAirport) return true;

  const type = trip?.trip_type || trip?.tripType;
  return type === 'city_to_city';
}

/**
 * Selected destination label + optional ISO code for a delivery row.
 * City-to-city → to_city / to_code (code = country ISO, not used for city equality)
 * Country-to-country → destination_country / destination_country_code (if present)
 */
export function deliveryDestination(delivery) {
  if (isCountryToCountry(delivery)) {
    return {
      label: delivery.destination_country || delivery.destinationCountry || '',
      code:
        delivery.destination_country_code ||
        delivery.destinationCountryCode ||
        delivery.to_code ||
        delivery.toCode ||
        '',
    };
  }
  return {
    label: delivery.to_city || delivery.toCity || '',
    code: delivery.to_code || delivery.toCode || '',
  };
}

/**
 * Selected destination label + optional ISO code for a trip row.
 */
export function tripDestination(trip) {
  if (isCountryToCountry(trip)) {
    return {
      label: trip.destination_country || trip.destinationCountry || '',
      code:
        trip.destination_country_code ||
        trip.destinationCountryCode ||
        trip.to_code ||
        trip.toCode ||
        '',
    };
  }
  return {
    label: trip.to_city || trip.toCity || trip.destination || '',
    code: trip.to_code || trip.toCode || '',
  };
}

export function senderDestinationAirportCity(delivery) {
  // Prefer explicit airport-city (stored in to_city / destinationCity) over
  // re-parsing Google Places airport labels, which often put a district in
  // the second comma segment (e.g. "…, Tayakadin, Istanbul, Türkiye").
  const explicit =
    delivery.to_city ||
    delivery.toCity ||
    delivery.destination_city ||
    delivery.destinationCity ||
    '';
  if (String(explicit).trim()) {
    return (
      cityFromAirportOrPlaceLabel(explicit) ||
      placeHead(explicit) ||
      String(explicit).trim()
    );
  }
  const airport =
    delivery.destination_airport || delivery.destinationAirport || '';
  return cityFromAirportOrPlaceLabel(airport);
}

function travelerDestinationCity(trip) {
  const toCity = trip.to_city || trip.toCity || '';
  if (toCity) return toCity;
  const airport =
    trip.destination_airport || trip.destinationAirport || '';
  return cityFromAirportOrPlaceLabel(airport) || tripDestination(trip).label;
}

/**
 * Hard filter: traveler To must match sender To (city or country as applicable).
 *
 * Country-to-country sender deliveries match:
 * - air travelers on the same destination country / airport corridor
 * - land travelers whose To city is the city of the sender's destination airport
 */
export function destinationsMatch(delivery, trip) {
  const senderTo = deliveryDestination(delivery);
  const travelerTo = tripDestination(trip);

  // Country parcel + land traveler → airport city ↔ traveler To city.
  if (isCountryToCountry(delivery) && isLandTravelerTrip(trip)) {
    const senderCity = senderDestinationAirportCity(delivery);
    const travelerCity = travelerDestinationCity(trip);
    if (senderCity && travelerCity && placesMatch(senderCity, travelerCity)) {
      return true;
    }
    return false;
  }

  // Shared destination country ISO (country parcel ↔ air country trip).
  if (codesMatch(senderTo.code, travelerTo.code)) {
    if (isCountryToCountry(delivery) || isCountryToCountry(trip)) {
      return true;
    }
  }

  if (isCountryToCountry(delivery) || isCountryToCountry(trip)) {
    // "Czechia" ↔ "Czech Republic", or country name contained in "Prague, Czechia".
    if (placesMatch(senderTo.label, travelerTo.label)) return true;
    const senderCountry = normalizeCountryName(senderTo.label);
    const travelerLabel = normalizePlace(travelerTo.label);
    if (
      senderCountry &&
      travelerLabel &&
      travelerLabel.includes(senderCountry)
    ) {
      return true;
    }
    const travelerCountry = normalizeCountryName(travelerTo.label);
    const senderLabel = normalizePlace(senderTo.label);
    if (
      travelerCountry &&
      senderLabel &&
      senderLabel.includes(travelerCountry)
    ) {
      return true;
    }
    return false;
  }

  // City-to-city: match on city labels only. Country ISO in to_code is not a city id.
  return placesMatch(senderTo.label, travelerTo.label);
}
