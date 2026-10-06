import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();

export interface AppConfig {
  nodeEnv: string;
  port: number;
  redisUrl?: string;
  cacheTtlSeconds: number;
  dbFreshMs: number;
  provider: {
    baseUrl?: string;
    apiKey?: string;
    rateLimitPerMinute: number;
  };
  rateLimit: {
    windowMs: number;
    max: number;
    prefix: string;
  };
  jwtSecret: string;
  stripeSecretKey?: string;
  stripeWebhookSecret?: string;
  stripePricePro?: string;
  frontendUrl: string;
  frontendUrls: string[];
  frontendOrigins: string[];
  passwordResetTtlMinutes: number;
  featuredAsins: string[];
  enableMetricsSync: boolean;
  metrics: {
    cron: string;
    batchSize: number;
    concurrency: number;
  };
  supabase: {
    url?: string;
    serviceKey?: string;
  };
}

const toNumber = (val: string | undefined, fallback: number) => {
  const parsed = Number(val);
  if (val === undefined || val === "") return fallback;
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throw new Error("Numeric configuration must be a positive integer");
  return parsed;
};

const toBool = (val: string | undefined, fallback = false) => {
  if (val === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(val.toLowerCase());
};

const splitCsv = (value: string | undefined, fallback: string) =>
  (value || fallback)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

const normalizeUrl = (value: string) => {
  try {
    const url = new URL(value);
    const path = url.pathname.replace(/\/$/, "");
    return `${url.origin}${path === "/" ? "" : path}`;
  } catch {
    return value.replace(/\/$/, "");
  }
};

const toOrigin = (value: string) => {
  try {
    return new URL(value).origin;
  } catch {
    return value.replace(/\/$/, "");
  }
};

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): AppConfig => {
  const nodeEnv = env.NODE_ENV || "development";
  const port = toNumber(env.PORT, 3001);

  const redisUrl = env.REDIS_URL;
  const cacheTtlSeconds = toNumber(env.CACHE_TTL_SECONDS, 120);
  const dbFreshMs = toNumber(env.DB_FRESH_MS, 1000 * 60 * 5);

  if (
    nodeEnv === "production" &&
    (!(env.JWT_SECRET || env.SECRET) ||
      (env.JWT_SECRET || env.SECRET || "").length < 32 ||
      /replace.me/i.test(env.JWT_SECRET || env.SECRET || ""))
  )
    throw new Error(
      "Production requires a persistent random JWT_SECRET of at least 32 characters",
    );
  const jwtSecret =
    env.JWT_SECRET || env.SECRET || crypto.randomBytes(32).toString("hex");
  if (!env.JWT_SECRET && !env.SECRET) {
    console.warn(
      "[config] JWT_SECRET not provided. Generated a temporary secret for this runtime.",
    );
  }

  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
  const supabaseServiceKey =
    env.SUPABASE_SERVICE_ROLE_KEY ||
    env.SUPABASE_SERVICE_KEY ||
    env.SUPABASE_SECRET_KEY;
  const featuredAsins = splitCsv(env.FEATURED_ASINS, "")
    .map((asin) => asin.toUpperCase())
    .filter((asin) => /^[A-Z0-9]{10}$/.test(asin));
  if (nodeEnv === "production" && !env.FRONTEND_URL)
    throw new Error("Production requires FRONTEND_URL");
  const frontendUrls = splitCsv(env.FRONTEND_URL, "http://localhost:5173").map(
    normalizeUrl,
  );
  for (const entry of frontendUrls) {
    const url = new URL(entry);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      (nodeEnv === "production" && url.protocol !== "https:")
    )
      throw new Error("FRONTEND_URL must use HTTPS in production");
  }
  const frontendOrigins = frontendUrls.map(toOrigin);
  const frontendUrl = frontendUrls[0] || "http://localhost:5173";

  return {
    nodeEnv,
    port,
    redisUrl,
    cacheTtlSeconds,
    dbFreshMs,
    provider: {
      baseUrl: env.PROVIDER_BASE_URL,
      apiKey: env.PROVIDER_API_KEY,
      rateLimitPerMinute: toNumber(env.PROVIDER_RATE_LIMIT_PER_MIN, 60),
    },
    rateLimit: {
      windowMs: toNumber(env.RATE_LIMIT_WINDOW_MS, 60_000),
      max: toNumber(env.RATE_LIMIT_MAX, 100),
      prefix: env.RATE_LIMIT_PREFIX || "rl:",
    },
    jwtSecret,
    stripeSecretKey: env.STRIPE_SECRET_KEY,
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET,
    stripePricePro: env.STRIPE_PRICE_PRO,
    frontendUrl,
    frontendUrls,
    frontendOrigins,
    passwordResetTtlMinutes: toNumber(env.PASSWORD_RESET_TTL_MINUTES, 60),
    featuredAsins,
    enableMetricsSync: toBool(env.ENABLE_METRICS_SYNC, false),
    metrics: {
      cron: env.SYNC_CRON || "*/15 * * * *",
      batchSize: toNumber(env.SYNC_BATCH_SIZE, 10),
      concurrency: toNumber(env.SYNC_CONCURRENCY, 3),
    },
    supabase: {
      url: supabaseUrl,
      serviceKey: supabaseServiceKey,
    },
  };
};

export const config = loadConfig();
