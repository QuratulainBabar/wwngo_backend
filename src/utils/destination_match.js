/**

 * Destination (To) matching for sender deliveries ↔ traveler trips.

 * A traveler matches only when their To location matches the sender's To.

 *

 * City-to-city: compare destination city labels (to_city).

 *   to_code is a country ISO — it must NOT be used as a city match key.

 * Country-to-country: compare destination country ISO codes and/or names.

 */



export function normalizePlace(value) {

  return String(value ?? '')

    .toLowerCase()

    .replace(/[^a-z0-9\s]/g, ' ')

    .replace(/\s+/g, ' ')

    .trim();

}



/**

 * True when two place labels refer to the same destination.

 * Uses exact equality or containment (e.g. "Dakar" ↔ "Dakar, Senegal").

 * Does not use loose token overlap — destination must clearly match.

 */

export function placesMatch(a, b) {

  const left = normalizePlace(a);

  const right = normalizePlace(b);

  if (!left || !right) return false;

  if (left === right) return true;

  return left.includes(right) || right.includes(left);

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

  const type = row?.delivery_type || row?.deliveryType || row?.trip_type || row?.tripType;

  return type === 'country_to_country';

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



/**

 * Hard filter: traveler To must match sender To (city or country as applicable).

 */

export function destinationsMatch(delivery, trip) {

  const senderTo = deliveryDestination(delivery);

  const travelerTo = tripDestination(trip);



  if (isCountryToCountry(delivery) || isCountryToCountry(trip)) {

    // Both sides should be country-level; require same delivery/trip type upstream.

    if (codesMatch(senderTo.code, travelerTo.code)) return true;

    return placesMatch(senderTo.label, travelerTo.label);

  }



  // City-to-city: match on city labels only. Country ISO in to_code is not a city id.

  return placesMatch(senderTo.label, travelerTo.label);

}


