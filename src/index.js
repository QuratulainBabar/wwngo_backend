import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import os from 'os';
import { env } from './config/env.js';
import { pool } from './db/pool.js';
import authRoutes from './routes/auth.routes.js';
import kycRoutes from './routes/kyc.routes.js';
import deliveryRoutes from './routes/delivery.routes.js';
import placesRoutes from './routes/places.routes.js';
import webhookRoutes from './routes/webhook.routes.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { UPLOADS_ROOT } from './services/delivery.service.js';

const app = express();

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(cors({
  origin: env.corsOrigins.includes('*') ? true : env.corsOrigins,
  credentials: true,
}));

// Sumsub webhooks need the raw body for HMAC signature verification.
app.use(
  '/api/v1/webhooks',
  express.raw({ type: ['application/json', 'application/*+json', '*/*'], limit: '2mb' }),
  webhookRoutes
);

app.use(express.json({ limit: '1mb' }));
app.use('/uploads', express.static(UPLOADS_ROOT));

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ success: true, data: { status: 'ok', database: 'connected' } });
  } catch {
    res.status(503).json({ success: false, error: { message: 'Database unavailable' } });
  }
});

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/kyc', kycRoutes);
app.use('/api/v1/deliveries', deliveryRoutes);
app.use('/api/v1/places', placesRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

function lanIpv4Addresses() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const entries of Object.values(nets)) {
    for (const net of entries || []) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  return ips;
}

async function startServer() {
  try {
    await pool.query('SELECT 1');
    console.log('PostgreSQL connected successfully.');
  } catch (err) {
    console.error('Failed to connect to PostgreSQL:', err.message);
    process.exit(1);
  }

  if (!env.sumsub.appToken || !env.sumsub.secretKey) {
    console.warn('Sumsub KYC: SUMSUB_APP_TOKEN / SUMSUB_SECRET_KEY not set — KYC token endpoint will return 503.');
  } else {
    const mode = env.sumsub.sandbox ? 'sandbox' : 'production';
    console.log(`Sumsub KYC configured (${mode}, level: ${env.sumsub.levelName}).`);
    if (!env.sumsub.sandbox) {
      console.warn('Sumsub App Token does not start with "sbx:" — you are not in sandbox mode.');
    }
  }

  if (!env.googleMapsApiKey) {
    console.warn('Google Maps: GOOGLE_MAPS_API_KEY not set — /api/v1/places will return 503.');
  } else {
    console.log('Google Maps Places proxy enabled.');
  }

  app.listen(env.port, env.host, () => {
    console.log(`WWNGO API listening on http://${env.host}:${env.port}`);
    console.log(`  Local:   http://localhost:${env.port}`);
    for (const ip of lanIpv4Addresses()) {
      console.log(`  Network: http://${ip}:${env.port}`);
    }
  });
}

startServer();
