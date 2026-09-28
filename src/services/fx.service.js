import { AppError } from '../utils/errors.js';
import {
  getStripe,
  isConfigured,
  isSupportedCurrency,
  SUPPORTED_CURRENCIES,
} from './stripe.service.js';

/** Preview API version required for FX Quotes (`POST /v1/fx_quotes`). */
const FX_QUOTES_API_VERSION = '2025-03-31.preview';

/** Minor-unit decimals for app-supported currencies (Stripe minor units). */
const CURRENCY_DECIMALS = {
  usd: 2,
  eur: 2,
  gbp: 2,
  cad: 2,
  aud: 2,
  aed: 2,
  sar: 2,
  qar: 2,
  kwd: 3,
  bhd: 3,
  omr: 3,
  inr: 2,
  cny: 2,
  try: 2,
};

export function listSupportedCurrencies() {
  return [...SUPPORTED_CURRENCIES].map((c) => c.toUpperCase());
}

function requireSupportedCurrency(currency, fieldName) {
  const code = String(currency || '').trim().toLowerCase();
  if (!isSupportedCurrency(code)) {
    throw new AppError(
      `${fieldName} must be a supported currency (${listSupportedCurrencies().join(', ')})`,
      400,
      'UNSUPPORTED_CURRENCY',
      { field: fieldName, currency }
    );
  }
  return code;
}

function minorFactor(currency) {
  const decimals = CURRENCY_DECIMALS[currency] ?? 2;
  return 10 ** decimals;
}

/**
 * Create a live Stripe FX Quote (lock_duration=none).
 * Uses secret key from backend env via getStripe() — never exposed to clients.
 *
 * @param {{ fromCurrency: string, toCurrency: string }} params
 */
export async function createFxQuote({ fromCurrency, toCurrency }) {
  const from = requireSupportedCurrency(fromCurrency, 'fromCurrency');
  const to = requireSupportedCurrency(toCurrency, 'toCurrency');

  if (from === to) {
    return {
      id: null,
      object: 'fx_quote',
      lock_duration: 'none',
      lock_status: 'active',
      to_currency: to,
      rates: {
        [from]: {
          exchange_rate: 1,
          rate_details: { base_rate: 1, fx_fee_rate: 0 },
        },
      },
      mock: !isConfigured(),
    };
  }

  const stripe = await getStripe();
  if (!stripe) {
    throw new AppError(
      'Currency conversion is unavailable (Stripe is not configured)',
      503,
      'STRIPE_NOT_CONFIGURED'
    );
  }

  try {
    return await stripe.rawRequest(
      'POST',
      '/v1/fx_quotes',
      {
        to_currency: to,
        from_currencies: [from],
        lock_duration: 'none',
      },
      { apiVersion: FX_QUOTES_API_VERSION }
    );
  } catch (err) {
    const message =
      err?.raw?.message ||
      err?.message ||
      'Failed to fetch exchange rate from Stripe';
    throw new AppError(message, err?.statusCode || 502, 'FX_QUOTE_FAILED', {
      stripeCode: err?.code || err?.raw?.code || null,
    });
  }
}

/**
 * Convert an amount using a live Stripe FX Quote.
 *
 * Rate semantics (Stripe): `exchange_rate` is units of `to_currency` per 1 unit
 * of `from_currency` (major units). Minor units are scaled per currency decimals.
 *
 * @param {{
 *   fromCurrency: string,
 *   toCurrency: string,
 *   amountCents: number,
 *   useBaseRate?: boolean,
 * }} params
 */
export async function convertAmount({
  fromCurrency,
  toCurrency,
  amountCents,
  useBaseRate = false,
}) {
  const from = requireSupportedCurrency(fromCurrency, 'fromCurrency');
  const to = requireSupportedCurrency(toCurrency, 'toCurrency');
  const cents = Number(amountCents);

  if (!Number.isFinite(cents) || !Number.isInteger(cents) || cents < 0) {
    throw new AppError(
      'amountCents must be a non-negative integer (minor units)',
      400,
      'VALIDATION_ERROR'
    );
  }

  if (from === to) {
    return {
      quoteId: null,
      fromCurrency: from.toUpperCase(),
      toCurrency: to.toUpperCase(),
      amountCents: cents,
      convertedAmountCents: cents,
      exchangeRate: 1,
      baseRate: 1,
      fxFeeRate: 0,
      lockDuration: 'none',
      lockStatus: 'active',
      created: Math.floor(Date.now() / 1000),
    };
  }

  const quote = await createFxQuote({ fromCurrency: from, toCurrency: to });
  const rateEntry = quote?.rates?.[from];
  if (!rateEntry) {
    throw new AppError(
      `Stripe FX Quote did not include a rate for ${from.toUpperCase()} → ${to.toUpperCase()}`,
      502,
      'FX_RATE_MISSING'
    );
  }

  const exchangeRate = Number(rateEntry.exchange_rate);
  const baseRate = Number(rateEntry.rate_details?.base_rate ?? exchangeRate);
  const fxFeeRate = Number(rateEntry.rate_details?.fx_fee_rate ?? 0);
  const rate = useBaseRate ? baseRate : exchangeRate;

  if (!Number.isFinite(rate) || rate <= 0) {
    throw new AppError('Invalid exchange rate from Stripe', 502, 'FX_RATE_INVALID');
  }

  const fromMajor = cents / minorFactor(from);
  const toMajor = fromMajor * rate;
  const convertedAmountCents = Math.round(toMajor * minorFactor(to));

  return {
    quoteId: quote.id || null,
    fromCurrency: from.toUpperCase(),
    toCurrency: to.toUpperCase(),
    amountCents: cents,
    convertedAmountCents,
    exchangeRate,
    baseRate,
    fxFeeRate,
    lockDuration: quote.lock_duration || 'none',
    lockStatus: quote.lock_status || 'active',
    lockExpiresAt: quote.lock_expires_at || null,
    created: quote.created || Math.floor(Date.now() / 1000),
  };
}
