/** Geographic overlap checks for meetup vs route labels (mirrors Flutter). */

const COUNTRY_NAMES = {
  FR: 'france',
  GB: 'united kingdom',
  NG: 'nigeria',
  US: 'united states',
  CA: 'canada',
  AE: 'united arab emirates',
  SN: 'senegal',
  DE: 'germany',
  ES: 'spain',
  IT: 'italy',
  NL: 'netherlands',
  BE: 'belgium',
  TR: 'türkiye',
  MA: 'morocco',
  EG: 'egypt',
  ZA: 'south africa',
  IN: 'india',
  PK: 'pakistan',
  KE: 'kenya',
  GH: 'ghana',
};

function tokens(input, countryCode) {
  const tokens = new Set();
  const normalized = String(input ?? '').trim().toLowerCase();
  if (!normalized) return [];

  for (const part of normalized.split(/[,;|]/)) {
    const trimmed = part.trim();
    if (trimmed.length >= 2) tokens.add(trimmed);
    for (const word of trimmed.split(/\s+/)) {
      if (word.length >= 2) tokens.add(word);
    }
  }

  const cc = String(countryCode ?? '').trim().toUpperCase();
  if (cc.length === 2) {
    tokens.add(cc.toLowerCase());
    const countryName = COUNTRY_NAMES[cc];
    if (countryName) tokens.add(countryName);
  }

  return [...tokens];
}

function isSignificantToken(token) {
  if (token.length >= 3) return true;
  return /^[a-z]{2}$/.test(token);
}

/**
 * True when meetup and route labels describe the same area.
 */
export function labelsInSameArea(
  meetupLabel,
  routeLabel,
  { routeCountryCode, meetupCountryCode, sameCountrySufficient = false } = {}
) {
  const label = String(meetupLabel ?? '').trim().toLowerCase();
  const route = String(routeLabel ?? '').trim().toLowerCase();
  if (!label || !route) return false;

  const routeCc = String(routeCountryCode ?? '').trim().toUpperCase();
  const meetupCc = String(meetupCountryCode ?? '').trim().toUpperCase();
  if (
    routeCc.length === 2 &&
    meetupCc.length === 2 &&
    routeCc !== meetupCc
  ) {
    return false;
  }
  if (
    sameCountrySufficient &&
    routeCc.length === 2 &&
    meetupCc.length === 2 &&
    routeCc === meetupCc
  ) {
    return true;
  }

  if (label.includes(route) || route.includes(label)) return true;

  const routeTokens = tokens(route, routeCc);
  const labelTokens = tokens(label, meetupCc);

  for (const token of routeTokens) {
    if (isSignificantToken(token) && label.includes(token)) return true;
  }
  for (const token of labelTokens) {
    if (isSignificantToken(token) && route.includes(token)) return true;
  }

  if (
    routeCc.length === 2 &&
    meetupCc.length === 2 &&
    routeCc === meetupCc
  ) {
    const countryName = COUNTRY_NAMES[routeCc];
    if (countryName && countryName.length >= 3 && label.includes(countryName)) {
      return true;
    }
  }

  if (sameCountrySufficient && routeCc.length === 2) {
    const countryName = COUNTRY_NAMES[routeCc];
    if (countryName && countryName.length >= 3 && label.includes(countryName)) {
      return true;
    }
  }

  return false;
}
