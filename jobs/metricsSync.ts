import cron from "node-cron";
import crypto from "crypto";
import supabase, { throwIfError } from "../providers/supabase";
import { getProductOrFetch } from "../services/productService";
import { ensureRedis } from "../providers/redis";
import { config } from "../config";
import logger from "../lib/logger";
export const startMetricsSync = () => {
  if (!config.redisUrl)
    throw new Error(
      "Metrics sync requires REDIS_URL for its distributed job lock",
    );
  if (!cron.validate(config.metrics.cron)) throw new Error("Invalid SYNC_CRON");
  let running = false;
  return cron.schedule(config.metrics.cron, async () => {
    if (running) return;
    running = true;
    const deadline = Date.now() + 150000;
    const key = "amzpulse:metrics-sync",
      owner = crypto.randomUUID();
    let locked = false;
    try {
      const redis = await ensureRedis();
      if (!redis) return;
      locked = (await redis.set(key, owner, "PX", 300000, "NX")) === "OK";
      if (!locked) return;
      const rows: any[] =
        throwIfError(
          await supabase
            .from("Product")
            .select("asin")
            .order("syncAttemptedAt", { ascending: true, nullsFirst: true })
            .order("asin")
            .limit(Math.min(100, config.metrics.batchSize)),
        ) || [];
      for (
        let i = 0;
        i < rows.length;
        i += Math.min(5, config.metrics.concurrency)
      ) {
        if (Date.now() > deadline) break;
        await Promise.all(
          rows
            .slice(i, i + Math.min(5, config.metrics.concurrency))
            .map(async (row) => {
              try {
                throwIfError(
                  await supabase
                    .from("Product")
                    .update({ syncAttemptedAt: new Date().toISOString() })
                    .eq("asin", row.asin),
                );
                await getProductOrFetch(row.asin, true);
              } catch (error) {
                logger.warn("Metrics refresh failed", { asin: row.asin });
              }
            }),
        );
      }
      throwIfError(
        await supabase
          .from("ProductMetric")
          .delete()
          .lt("timestamp", new Date(Date.now() - 180 * 86400000).toISOString()),
      );
      throwIfError(
        await supabase
          .from("PasswordResetToken")
          .delete()
          .lt("expiresAt", new Date().toISOString()),
      );
      throwIfError(
        await supabase
          .from("UsageReservation")
          .delete()
          .lt("settledAt", new Date(Date.now() - 7 * 86400000).toISOString()),
      );
    } catch (error) {
      logger.error("Metrics sync failed", { error });
    } finally {
      try {
        if (locked) {
          const redis = await ensureRedis();
          await redis?.eval(
            "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",
            1,
            key,
            owner,
          );
        }
      } catch (error) {
        logger.warn("Metrics lock release failed", { error });
      } finally {
        running = false;
      }
    }
  });
};
export default startMetricsSync;
