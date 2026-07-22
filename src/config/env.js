import dotenv from 'dotenv';

dotenv.config({ override: true });

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
    length: Number(process.env.OTP_LENGTH) || 6,
    maxSendsPerWindow: Number(process.env.OTP_MAX_SENDS) || 3,
    sendWindowMinutes: Number(process.env.OTP_SEND_WINDOW_MINUTES) || 15,
    /** Fixed demo OTP for email verification (no real email sent). */
    demoCode: process.env.DEMO_OTP_CODE || '123456',
  },
  security: {
    maxFailedLogins: Number(process.env.MAX_FAILED_LOGINS) || 5,
    lockoutMinutes: Number(process.env.LOCKOUT_MINUTES) || 15,
  },
  corsOrigins: process.env.CORS_ORIGINS?.split(',').map((o) => o.trim()) || ['*'],
  /** Google Maps / Places API key (server-side proxy for Flutter). */
  googleMapsApiKey: cleanEnv(process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY),
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
};

function cleanEnv(value) {
  return String(value || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim();
}

export const ALLOWED_COUNTRY_CODES = ['FR', 'US', 'GB', 'NG', 'AE', 'CA'];
