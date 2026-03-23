import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { getRedisClient, isRedisReady } from '../providers/redis';
import { config } from '../config';
import logger from '../lib/logger';

export interface RateLimiterOptions {
  windowMs?: number;
  max?: number;
  prefix?: string;
}

/**
 * Create an express-rate-limit middleware backed by Redis when available,
 * with a safe in-memory fallback to keep the API bootable without Redis.
 */
export const createRateLimiter = (opts: RateLimiterOptions = {}) => {
  const windowMs = opts.windowMs ?? config.rateLimit.windowMs;
  const max = opts.max ?? config.rateLimit.max;
  const prefix = opts.prefix ?? config.rateLimit.prefix;

  const redisClient = getRedisClient();
  const useRedis = isRedisReady() && !!redisClient;

  if (!useRedis) {
    logger.warn('Rate limiter using in-memory store (Redis not connected)');
  }

  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    store: useRedis
      ? new RedisStore({
          sendCommand: (...args: any[]) => (redisClient as any).call(...args),
          prefix
        })
      : undefined,
    handler: (req, res) => {
      res.status(429).json({ error: 'Too many requests, please try again later.' });
    }
  });
};

export default createRateLimiter;

