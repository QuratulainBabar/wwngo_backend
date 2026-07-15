import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { pool } from './db/pool.js';
import authRoutes from './routes/auth.routes.js';
import kycRoutes from './routes/kyc.routes.js';
import deliveryRoutes from './routes/delivery.routes.js';
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

// TEMPORARILY DISABLED - SUMSUB KYC
// Preserved raw-body middleware:
// app.use(
//   '/api/v1/webhooks',
//   express.raw({ type: ['application/json', 'application/*+json', '*/*'], limit: '2mb' }),
//   webhookRoutes
// );

app.use(express.json({ limit: '1mb' }));
// TEMPORARILY DISABLED - SUMSUB KYC
// No raw-body/signature middleware runs; this compatibility route only returns 204.
app.use('/api/v1/webhooks', webhookRoutes);
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

app.use(notFoundHandler);
app.use(errorHandler);

async function startServer() {
  try {
    await pool.query('SELECT 1');
    console.log('PostgreSQL connected successfully.');
  } catch (err) {
    console.error('Failed to connect to PostgreSQL:', err.message);
    process.exit(1);
  }

  /* TEMPORARILY DISABLED - SUMSUB KYC
  if (!env.sumsub.appToken || !env.sumsub.secretKey) {
    console.warn('Sumsub KYC: SUMSUB_APP_TOKEN / SUMSUB_SECRET_KEY not set — KYC token endpoint will return 503.');
  } else {
    const mode = env.sumsub.sandbox ? 'sandbox' : 'production';
    console.log(`Sumsub KYC configured (${mode}, level: ${env.sumsub.levelName}).`);
    if (!env.sumsub.sandbox) {
      console.warn('Sumsub App Token does not start with "sbx:" — you are not in sandbox mode.');
    }
  }
  */

  app.listen(env.port, () => {
    console.log(`WWNGO API listening on http://localhost:${env.port}`);
  });
}

startServer();
