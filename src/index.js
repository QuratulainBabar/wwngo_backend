import http from 'http';
import { createRequire } from 'module';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import os from 'os';
import { trustSystemCertificates } from './config/tls.js';
import { env } from './config/env.js';
import { pool } from './db/pool.js';
import authRoutes from './routes/auth.routes.js';
import kycRoutes from './routes/kyc.routes.js';
import deliveryRoutes from './routes/delivery.routes.js';
import tripRoutes from './routes/trip.routes.js';
import placesRoutes from './routes/places.routes.js';
import walletRoutes from './routes/wallet.routes.js';
import reviewRoutes from './routes/review.routes.js';
import trustMetricsRoutes from './routes/trust_metrics.routes.js';
import notificationRoutes from './routes/notification.routes.js';
import chatRoutes from './routes/chat.routes.js';
import webhookRoutes from './routes/webhook.routes.js';
import adminRoutes from './routes/admin.routes.js';
import nfcRoutes from './routes/nfc.routes.js';
import meetupRoutes from './routes/meetup.routes.js';
import trackingRoutes from './routes/tracking.routes.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { UPLOADS_ROOT } from './services/delivery.service.js';
import { initSocketServer } from './services/socket_hub.js';
import { startTimerWorker } from './services/timer.service.js';
import * as stripeService from './services/stripe.service.js';
import { connectReturnPage } from './routes/connect_return.js';

trustSystemCertificates();

const app = express();

// Log any request slower than this so real bottlenecks are visible in prod.
const SLOW_REQUEST_MS = Number(process.env.SLOW_REQUEST_MS) || 500;
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    if (ms >= SLOW_REQUEST_MS) {
      console.warn(
        `[slow] ${req.method} ${req.originalUrl} ${ms.toFixed(0)}ms ${res.statusCode}`
      );
    }
  });
  next();
});

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  // LAN HTTP is used in development; do not force browsers onto HTTPS.
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      upgradeInsecureRequests: null,
    },
  },
}));

// gzip responses. Loaded gracefully so a not-yet-installed dependency degrades
// to "uncompressed" instead of crashing the server on boot.
try {
  const require = createRequire(import.meta.url);
  const compression = require('compression');
  app.use(compression());
} catch {
  console.warn('[perf] compression not installed — run `npm install` to enable gzip');
}

app.use(cors({
  origin: env.corsOrigins.includes('*') ? true : env.corsOrigins,
  credentials: true,
}));

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
app.use('/api/v1/trips', tripRoutes);
app.use('/api/v1/places', placesRoutes);
app.use('/api/v1/wallet', walletRoutes);
app.use('/api/v1/reviews', reviewRoutes);
app.use('/api/v1/trust-metrics', trustMetricsRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/chats', chatRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/nfc', nfcRoutes);
app.use('/api/v1/meetup', meetupRoutes);
app.use('/api/v1/tracking', trackingRoutes);

app.get('/connect/return', connectReturnPage);
app.get('/wallet', (req, res, next) => {
  if (req.query.connect != null || req.query.status != null) {
    return connectReturnPage(req, res);
  }
  next();
});

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

  const httpServer = http.createServer(app);
  initSocketServer(httpServer);
  startTimerWorker();

  if (stripeService.isConfigured()) {
    console.log('Stripe payments enabled.');
  } else {
    console.warn('Stripe: STRIPE_SECRET_KEY not set — wallet top-up uses ledger mock.');
  }

  const { isFcmConfigured } = await import('./services/fcm.service.js');
  if (isFcmConfigured()) {
    console.log('Firebase push notifications enabled.');
  } else {
    console.warn('FCM: set FCM_SERVICE_ACCOUNT_PATH in .env for push delivery.');
  }

  httpServer.listen(env.port, env.host, () => {
    console.log(`WWNGO API listening on http://${env.host}:${env.port}`);
    console.log(`  Local:   http://localhost:${env.port}`);
    console.log(`  Socket:  ws://${env.host}:${env.port}/socket.io`);
    for (const ip of lanIpv4Addresses()) {
      console.log(`  Network: http://${ip}:${env.port}`);
    }
  });
}

startServer();
