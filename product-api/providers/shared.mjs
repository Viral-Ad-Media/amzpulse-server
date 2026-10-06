import { AsyncLocalStorage } from "node:async_hooks";
const deadlines = new AsyncLocalStorage();
export const withProviderDeadline = (work, milliseconds = 30000) =>
  deadlines.run(
    AbortSignal.any([
      AbortSignal.timeout(milliseconds),
      ...(deadlines.getStore() ? [deadlines.getStore()] : []),
    ]),
    work,
  );
export const ASIN_PATTERN = /^[A-Z0-9]{10}$/;

// Retries only transient network-level failures (DNS blips, connection resets — the
// kind of thing that fails one moment and succeeds the next) with exponential backoff.
// An actual HTTP error response (4xx/5xx) is returned as-is, not retried, since the
// caller already handles those; only a thrown fetch() (network layer never completed)
// is worth retrying here.
export const fetchWithRetry = async (
  url,
  options = {},
  { retries = 2, baseDelayMs = 300 } = {},
) => {
  let lastError;
  const signal = AbortSignal.any([
    AbortSignal.timeout(12000),
    ...(options.signal ? [options.signal] : []),
    ...(deadlines.getStore() ? [deadlines.getStore()] : []),
  ]);
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetch(url, { ...options, signal });
    } catch (error) {
      lastError = error;
      if (signal.aborted) throw error;
      if (attempt < retries) {
        await new Promise((resolve) =>
          setTimeout(resolve, baseDelayMs * 2 ** attempt),
        );
      }
    }
  }
  throw lastError;
};

export const valueFromEnv = (env, keys) => {
  for (const key of keys) {
    const value = env?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
};

export const toNumber = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

export const chunkArray = (items, size) => {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

// Baseline shape every provider maps into. Providers only override the fields they can
// actually supply; the rest stay honest zero/empty values (the client already renders
// those as "N/A" / "Not provided" rather than faking data).
export const blankProduct = (asin) => ({
  id: asin,
  asin,
  name: `Amazon product ${asin}`,
  brand: "Unknown",
  category: "Amazon",
  subCategory: undefined,
  price: 0,
  priceDisplay: "",
  currency: "",
  image: "",
  rating: 0,
  reviews: 0,
  trend: 0,
  description: "",
  priceHistory: [],
  bsrHistory: [],
  bsr: 0,
  estimatedSales: 0,
  isEstimatedSales: false,
  referralFee: null,
  fbaFee: null,
  storageFee: null,
  feesAvailable: false,
  weight: "",
  dimensions: "",
  sellers: 0,
  isHazmat: null,
  isIpRisk: null,
  isOversized: null,
  riskDataAvailable: false,
  seasonalityTags: [],
  availability: "",
  fulfillmentChannel: "",
  detailUrl: `https://www.amazon.com/dp/${asin}`,
  dataSource: "",
  lastSyncedAt: new Date().toISOString(),
});
