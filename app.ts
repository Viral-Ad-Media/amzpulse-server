import express from 'express';
import cors, { CorsOptions } from 'cors';
import { productRoutes, batchRoutes, watchlistRoutes, authRoutes, sourcingRoutes, billingRoutes } from './routes';
import dotenv from 'dotenv';
import morgan from 'morgan';
import createRateLimiter from './middleware/rateLimiter';
import startMetricsSync from './jobs/metricsSync';
import { config } from './config';
import logger from './lib/logger';
import * as billingController from './controllers/billingController';

dotenv.config();

const app = express();
const PORT = config.port;

const allowedOrigins = config.frontendOrigins;
const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // allow server-to-server and curl
    if (allowedOrigins.length === 0 || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

// Middleware
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
// Stripe webhook needs raw body before JSON parsing
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), billingController.webhook);
app.use(express.json());
app.use(morgan(config.nodeEnv === 'production' ? 'combined' : 'dev'));

// Global rate limiter (configurable via env)
app.use(createRateLimiter());

// Routes with optional per-route override limits
app.use('/api/auth', authRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/products', productRoutes);
// Example: stricter limiter for batch analysis to prevent abuse
app.use('/api/batch', createRateLimiter({ max: Number(process.env.RATE_LIMIT_BATCH_MAX) || config.rateLimit.max }), batchRoutes);
app.use('/api/watchlist', watchlistRoutes);
app.use('/api/sourcing', sourcingRoutes);

// Health Check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', version: '2.0.0' });
});

// Centralized error handler
app.use((err: any, req: any, res: any, next: any) => {
  logger.error('Unhandled error', { error: err });
  res.status(500).json({ error: 'Internal Server Error' });
});

// Start Server with graceful shutdown and start background job
if (config.nodeEnv !== 'test') {
  const server = app.listen(PORT, () => {
    logger.info(`Server running on http://localhost:${PORT}`);
    logger.info(`AmzPulse Backend v2.0 initialized.`);
    if (config.enableMetricsSync) {
      try {
        startMetricsSync();
      } catch (e) {
        logger.warn('Failed to start metrics sync job', { error: e });
      }
    } else {
      logger.info('Metrics sync job disabled (ENABLE_METRICS_SYNC=false)');
    }
  });

  const shutdown = () => {
    logger.info('Shutting down server...');
    server.close(() => {
      logger.info('Server closed. Exiting.');
      process.exit(0);
    });
    // force exit after timeout
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

export default app;
