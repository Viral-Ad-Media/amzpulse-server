import express from "express";
import cors, { CorsOptions } from "cors";
import {
  productRoutes,
  batchRoutes,
  watchlistRoutes,
  authRoutes,
  sourcingRoutes,
  billingRoutes,
  analysisRoutes,
} from "./routes";
import dotenv from "dotenv";
import morgan from "morgan";
import createRateLimiter from "./middleware/rateLimiter";
import startMetricsSync from "./jobs/metricsSync";
import { config } from "./config";
import logger from "./lib/logger";
import { asyncHandler } from "./lib/asyncHandler";
import { ensureRedis } from "./providers/redis";
import * as billingController from "./controllers/billingController";

dotenv.config();

const app = express();
const PORT = config.port;
if (config.nodeEnv === "production" && !config.redisUrl)
  throw new Error("Production requires REDIS_URL for distributed limits");
const proxyHops = Number(process.env.TRUST_PROXY_HOPS || 0);
if (!Number.isInteger(proxyHops) || proxyHops < 0 || proxyHops > 5)
  throw new Error("Invalid TRUST_PROXY_HOPS");
app.set("trust proxy", proxyHops);
app.disable("x-powered-by");

const allowedOrigins = config.frontendOrigins;
if (
  config.nodeEnv === "production" &&
  (!allowedOrigins.length || allowedOrigins.includes("*"))
)
  throw new Error("Production requires explicit FRONTEND_ORIGINS");
const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // allow server-to-server and curl
    if (
      allowedOrigins.length === 0 ||
      allowedOrigins.includes("*") ||
      allowedOrigins.includes(origin)
    ) {
      return callback(null, true);
    }
    return callback(new Error("Not allowed by CORS"));
  },
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "X-API-Key",
  ],
};

// Middleware
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
// Stripe webhook needs raw body before JSON parsing
app.post(
  "/api/billing/webhook",
  express.raw({ type: "application/json" }),
  asyncHandler(billingController.webhook),
);
app.use(express.json({ limit: "64kb" }));
app.use(morgan(config.nodeEnv === "production" ? "combined" : "dev"));

// Global rate limiter (configurable via env)
app.use(createRateLimiter());

// Routes with optional per-route override limits
app.use(
  "/api/auth",
  createRateLimiter({ max: 20, prefix: `${config.rateLimit.prefix}auth:` }),
  authRoutes,
);
app.use("/api/analysis", analysisRoutes);
app.use("/api/billing", billingRoutes);
app.use("/api/products", productRoutes);
const batchMax = Number(process.env.RATE_LIMIT_BATCH_MAX ?? 10);
if (!Number.isSafeInteger(batchMax) || batchMax < 1)
  throw new Error("Invalid RATE_LIMIT_BATCH_MAX");
// Stricter batch limit
app.use(
  "/api/batch",
  createRateLimiter({
    max: batchMax,
    prefix: `${config.rateLimit.prefix}batch:`,
  }),
  batchRoutes,
);
app.use("/api/watchlist", watchlistRoutes);
app.use("/api/sourcing", sourcingRoutes);

// Health Check
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", version: "2.0.0" });
});

// Centralized error handler
app.use((err: any, req: any, res: any, next: any) => {
  logger.error("Unhandled error", { error: err });
  const status =
    err.type === "entity.too.large"
      ? 413
      : err instanceof SyntaxError
        ? 400
        : 500;
  res
    .status(status)
    .json({
      error:
        status === 500
          ? "Service unavailable. Try again later."
          : status === 413
            ? "Request too large"
            : "Invalid JSON",
    });
});

// Start Server with graceful shutdown and start background job
if (config.nodeEnv !== "test") {
  ensureRedis()
    .then(() => {
      if (config.enableMetricsSync) {
        startMetricsSync();
      } else {
        logger.info("Metrics sync job disabled (ENABLE_METRICS_SYNC=false)");
      }

      const server = app.listen(PORT, () => {
        logger.info(`Server running on http://localhost:${PORT}`);
        logger.info(`AmzPulse Backend v2.0 initialized.`);
      });

      const shutdown = () => {
        logger.info("Shutting down server...");
        server.close(() => {
          logger.info("Server closed. Exiting.");
          process.exit(0);
        });
        // force exit after timeout
        setTimeout(() => process.exit(1), 10_000).unref();
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    })
    .catch((error) => {
      logger.error("Startup failed", { error });
      process.exit(1);
    });
}

export default app;
