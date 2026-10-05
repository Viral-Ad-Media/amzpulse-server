import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { ensureRedis } from "../providers/redis";
import { config } from "../config";
export interface RateLimiterOptions {
  windowMs?: number;
  max?: number;
  prefix?: string;
}
export const createRateLimiter = (opts: RateLimiterOptions = {}) =>
  rateLimit({
    windowMs: opts.windowMs ?? config.rateLimit.windowMs,
    max: opts.max ?? config.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
    store: config.redisUrl
      ? new RedisStore({
          prefix: opts.prefix ?? `${config.rateLimit.prefix}global:`,
          sendCommand: async (...args: string[]) => {
            const client = await ensureRedis();
            if (!client) throw new Error("Redis not configured");
            return client.call(...(args as [string, ...string[]])) as any;
          },
        })
      : undefined,
    handler: (_req, res) =>
      res.status(429).json({ error: "Too many requests. Try again later." }),
  });
export default createRateLimiter;
