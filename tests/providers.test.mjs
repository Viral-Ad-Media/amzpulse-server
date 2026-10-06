import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mapProductToProduct,
  fetchProducts,
} from "../product-api/providers/keepa.mjs";
import {
  withProviderDeadline,
  fetchWithRetry,
} from "../product-api/providers/shared.mjs";
import { fetchAmazonProducts } from "../product-api/amazonProvider.mjs";

test("Keepa preserves unknown latest prices and distinct timestamps", () => {
  const csv = [];
  csv[1] = [10, 2500, 20, -1];
  csv[0] = [5, 3000];
  csv[3] = [15, 100, 25, -1];
  const p = mapProductToProduct({ asin: "B08N5WRWNW", csv });
  assert.equal(p.price, null);
  assert.equal(p.bsr, null);
  assert.equal(p.currency, "USD");
  assert.equal(p.referralFee, null);
  assert.equal(p.riskDataAvailable, false);
  assert.equal(p.priceHistory.length, 1);
  assert.equal(p.bsrHistory.length, 1);
  assert.notEqual(p.priceHistory[0].date, p.bsrHistory[0].date);
});
test("unsupported marketplace and missing provider fail clearly", async () => {
  await assert.rejects(
    fetchProducts(["B08N5WRWNW"], { KEEPA_API_KEY: "test", KEEPA_DOMAIN: "4" }),
    /US marketplace/,
  );
  await assert.rejects(
    fetchAmazonProducts(["B08N5WRWNW"], {}),
    /No product data provider/,
  );
});
test("provider deadline aborts fetch without spending retries", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, { signal }) =>
    new Promise((_resolve, reject) => {
      calls++;
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      });
    });
  const timer = setTimeout(() => {}, 100);
  try {
    await assert.rejects(
      withProviderDeadline(() => fetchWithRetry("https://example.com"), 20),
    );
    assert.equal(calls, 1);
  } finally {
    clearTimeout(timer);
    globalThis.fetch = original;
  }
});
