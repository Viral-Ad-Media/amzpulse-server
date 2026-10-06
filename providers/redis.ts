import Redis from "ioredis";
import { config } from "../config";
let client: Redis | null = null;
export const getRedisClient = () => {
  if (!client && config.redisUrl) {
    client = new Redis(config.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 5000,
      commandTimeout: 5000,
    });
    client.on("error", () => {});
  }
  return client;
};
export const ensureRedis = async () => {
  const c = getRedisClient();
  if (!c) return null;
  if (c.status === "wait") await c.connect();
  else if (c.status !== "ready")
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Redis unavailable"));
      }, 5000);
      const cleanup = () => {
        clearTimeout(timer);
        c.off("ready", ready);
        c.off("error", fail);
      };
      const ready = () => {
        cleanup();
        resolve();
      };
      const fail = (error: Error) => {
        cleanup();
        reject(error);
      };
      c.once("ready", ready);
      c.once("error", fail);
    });
  return c;
};
export const isRedisReady = () => getRedisClient()?.status === "ready";
