import Redis from 'ioredis';
import { config } from '../config';
import logger from '../lib/logger';

let client: Redis | null = null;
let ready = false;

const connectRedis = async () => {
  if (!config.redisUrl) {
    return;
  }

  try {
    client = new Redis(config.redisUrl, { lazyConnect: true });
    client.on('error', (err) => {
      logger.warn('Redis client error', { error: err });
    });
    await client.connect();
    ready = true;
    logger.info('Redis connected');
  } catch (err) {
    ready = false;
    client = null;
    logger.warn('Redis connection failed, falling back to in-memory cache', { error: err });
  }
};

connectRedis();

export const getRedisClient = () => (ready ? client : null);
export const isRedisReady = () => ready;

