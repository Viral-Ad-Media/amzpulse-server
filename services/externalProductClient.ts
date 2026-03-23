import { fetchProductFromProvider } from '../providers';
import { ExternalProductData } from '../providers/types';
import { config } from '../config';

const WINDOW_MS = 60_000;
let requestTimestamps: number[] = [];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const acquireSlot = async () => {
  while (true) {
    const now = Date.now();
    requestTimestamps = requestTimestamps.filter((t) => now - t < WINDOW_MS);
    const limit = Math.max(1, config.provider.rateLimitPerMinute);
    if (requestTimestamps.length < limit) {
      requestTimestamps.push(now);
      return;
    }
    await sleep(200);
  }
};

const fetchWithRetry = async (asin: string, attempts = 3): Promise<ExternalProductData> => {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      await acquireSlot();
      return await fetchProductFromProvider(asin);
    } catch (err) {
      lastErr = err;
      await sleep(200 * (i + 1));
    }
  }
  throw lastErr;
};

export const getExternalProduct = (asin: string) => fetchWithRetry(asin);
