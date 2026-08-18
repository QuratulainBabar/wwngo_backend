import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: true });
dotenv.config({ override: false });

const required = ['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'JWT_RESET_SECRET'];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

export const env = {
  port: Number(process.env.PORT) || 3000,
  /** Bind address — use 0.0.0.0 so phones on the LAN can reach the API. */
  host: cleanEnv(process.env.HOST) || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  isDev: (process.env.NODE_ENV || 'development') !== 'production',
  databaseUrl: process.env.DATABASE_URL,
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    resetSecret: process.env.JWT_RESET_SECRET,
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    resetExpiresIn: process.env.JWT_RESET_EXPIRES_IN || '15m',
  },
  otp: {
    expiresMinutes: Number(process.env.OTP_EXPIRES_MINUTES) || 5,
    /** Fixed at 6 — must match Flutter OtpCodeField length. */
    length: 6,
    maxSendsPerWindow: Number(process.env.OTP_MAX_SENDS) || 3,
    sendWindowMinutes: Number(process.env.OTP_SEND_WINDOW_MINUTES) || 15,
  },
  smtp: {
    host: cleanEnv(process.env.SMTP_HOST) || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT) || 587,
    user: cleanEnv(process.env.SMTP_USER || process.env.GMAIL_USER),
    pass: cleanEnv(process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD),
    from:
      cleanEnv(process.env.SMTP_FROM) ||
      cleanEnv(process.env.SMTP_USER || process.env.GMAIL_USER) ||
      'WWNGO <noreply@wwngo.app>',
    /**
     * Antivirus / corporate proxies often inject a self-signed cert into the
     * SMTP TLS chain. Default: skip verify in development; enforce in production
     * unless SMTP_TLS_REJECT_UNAUTHORIZED=false.
     */
    tlsRejectUnauthorized: (() => {
      const raw = cleanEnv(process.env.SMTP_TLS_REJECT_UNAUTHORIZED);
      if (raw === 'true') return true;
      if (raw === 'false') return false;
      return (process.env.NODE_ENV || 'development') === 'production';
    })(),
  },
  security: {
    maxFailedLogins: Number(process.env.MAX_FAILED_LOGINS) || 5,
    lockoutMinutes: Number(process.env.LOCKOUT_MINUTES) || 15,
  },
  sumsub: {
    // Prefer canonical names; accept legacy SUMSUB_TOKEN / SUMSUB_SECRET aliases.
    appToken: cleanEnv(process.env.SUMSUB_APP_TOKEN || process.env.SUMSUB_TOKEN),
    secretKey: cleanEnv(process.env.SUMSUB_SECRET_KEY || process.env.SUMSUB_SECRET),
    /** Must match a verification level name configured in the Sumsub dashboard (Sandbox). */
    levelName: cleanEnv(process.env.SUMSUB_LEVEL_NAME) || 'basic-kyc-level',
    /**
     * Sandbox and production share the same API host; sandbox is selected by
     * App Tokens that start with `sbx:`.
     */
    baseUrl: (cleanEnv(process.env.SUMSUB_BASE_URL) || 'https://api.sumsub.com').replace(
      /\/$/,
      ''
    ),
    tokenTtlSecs: Number(process.env.SUMSUB_TOKEN_TTL_SECS) || 600,
    webhookSecret:
      cleanEnv(process.env.SUMSUB_WEBHOOK_SECRET) ||
      cleanEnv(process.env.SUMSUB_SECRET_KEY || process.env.SUMSUB_SECRET),
    get sandbox() {
      return this.appToken.startsWith('sbx:');
    },
  },
  stripe: {
    secretKey: cleanEnv(process.env.STRIPE_SECRET_KEY),
    webhookSecret: cleanEnv(process.env.STRIPE_WEBHOOK_SECRET),
    publishableKey: cleanEnv(process.env.STRIPE_PUBLISHABLE_KEY),
  },
  twilio: {
    accountSid: cleanEnv(process.env.TWILIO_ACCOUNT_SID),
    authToken: cleanEnv(process.env.TWILIO_AUTH_TOKEN),
    fromNumber: cleanEnv(process.env.TWILIO_FROM),
    whatsappFrom: cleanEnv(process.env.TWILIO_WHATSAPP_FROM),
  },
  appPublicUrl: cleanEnv(process.env.APP_PUBLIC_URL) || 'http://localhost:3000',
  s3: {
    bucket: cleanEnv(process.env.AWS_S3_BUCKET),
    region: cleanEnv(process.env.AWS_REGION || process.env.AWS_S3_REGION),
    accessKeyId: cleanEnv(process.env.AWS_ACCESS_KEY_ID),
    secretAccessKey: cleanEnv(process.env.AWS_SECRET_ACCESS_KEY),
    publicBaseUrl: cleanEnv(process.env.AWS_S3_PUBLIC_BASE_URL),
  },
  redisUrl: cleanEnv(process.env.REDIS_URL),
  fcm: {
    serverKey: cleanEnv(process.env.FCM_SERVER_KEY),
  },
  corsOrigins: process.env.CORS_ORIGINS?.split(',').map((o) => o.trim()) || ['*'],
  /** Google Maps / Places API key (server-side proxy for Flutter). */
  googleMapsApiKey: cleanEnv(process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY),
};

function cleanEnv(value) {
  return String(value || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim();
}

/**
 * Optional launch-market allowlist via `ALLOWED_COUNTRY_CODES=FR,US,PK`.
 * Empty / unset = any ISO-3166 alpha-2 (matches `users.country_code` CHECK).
 */
const rawAllowedCountries = cleanEnv(process.env.ALLOWED_COUNTRY_CODES);
export const ALLOWED_COUNTRY_CODES = rawAllowedCountries
  ? rawAllowedCountries
      .split(',')
      .map((code) => code.trim().toUpperCase())
      .filter(Boolean)
  : null;

export function normalizeCountryCode(code) {
  return String(code || '').trim().toUpperCase();
}

export function isAllowedCountryCode(code) {
  const iso = normalizeCountryCode(code);
  if (!/^[A-Z]{2}$/.test(iso)) return false;
  if (!ALLOWED_COUNTRY_CODES || ALLOWED_COUNTRY_CODES.length === 0) return true;
  return ALLOWED_COUNTRY_CODES.includes(iso);
}
