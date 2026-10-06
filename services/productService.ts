import crypto from "crypto";
import { cacheGetJSON, cacheSetJSON } from "./cacheService";
import { config } from "../config";
import { getExternalProduct } from "./externalProductClient";
import supabase, { throwIfError } from "../providers/supabase";
import { normalizeAsin } from "../lib/validation";
export const canonicalProduct = (raw: any, asin: string) => ({
  ...raw,
  asin,
  id: asin,
  title: raw.title || raw.name || `Amazon product ${asin}`,
  name: raw.name || raw.title || `Amazon product ${asin}`,
  estSales: raw.estSales ?? raw.estimatedSales ?? null,
  estimatedSales: raw.estimatedSales ?? raw.estSales ?? null,
  riskDataAvailable: raw.riskDataAvailable === true,
  feesAvailable:
    raw.feesAvailable === true ||
    [raw.referralFee, raw.fbaFee, raw.storageFee].every(
      (v) => typeof v === "number" && Number.isFinite(v),
    ),
  priceHistory: Array.isArray(raw.priceHistory) ? raw.priceHistory : [],
  bsrHistory: Array.isArray(raw.bsrHistory) ? raw.bsrHistory : [],
  isHazmat: raw.riskDataAvailable === true ? raw.isHazmat : null,
  isIpRisk: raw.riskDataAvailable === true ? raw.isIpRisk : null,
  isOversized: raw.riskDataAvailable === true ? raw.isOversized : null,
});
export const getProductOrFetch = async (value: string, force = false) => {
  const asin = normalizeAsin(value),
    key = `product:v2:${asin}`;
  const cached = await cacheGetJSON<any>(key);
  if (cached && !force) return cached;
  const stored: any = throwIfError(
    await supabase
      .from("Product")
      .select("canonicalData,updatedAt")
      .eq("asin", asin)
      .maybeSingle(),
  );
  if (
    !force &&
    stored?.canonicalData &&
    stored.canonicalData.dataSource !== "rainforest-bestsellers" &&
    Date.now() - new Date(stored.updatedAt).getTime() < config.dbFreshMs
  ) {
    await cacheSetJSON(key, stored.canonicalData);
    return stored.canonicalData;
  }
  const live = canonicalProduct(await getExternalProduct(asin), asin);
  // Canonical payload preserves unknowns, source coverage and provider history across every cache path.
  throwIfError(
    await supabase
      .from("Product")
      .upsert(
        {
          asin,
          title: live.title,
          image: live.image || "",
          category: live.category || "Amazon",
          currentPrice: live.price ?? 0,
          currentBsr: live.bsr ?? 0,
          estSales: live.estSales ?? 0,
          sellers: live.sellers ?? 0,
          referralFee: live.referralFee ?? 0,
          fbaFee: live.fbaFee ?? 0,
          canonicalData: live,
          updatedAt: new Date().toISOString(),
        },
        { onConflict: "asin" },
      ),
  );
  if (
    typeof live.price === "number" &&
    live.price > 0 &&
    typeof live.bsr === "number" &&
    live.bsr > 0
  )
    throwIfError(
      await supabase
        .from("ProductMetric")
        .insert({
          id: crypto.randomUUID(),
          productId: asin,
          price: live.price,
          bsr: live.bsr,
        }),
    );
  await cacheSetJSON(key, live);
  return live;
};
export const getHistory = async (asin: string) => {
  const p = await getProductOrFetch(asin);
  return { priceHistory: p.priceHistory, bsrHistory: p.bsrHistory };
};
export const processBatch = async (asins: string[]) => {
  const results: any[] = [];
  const deadline = Date.now() + 120000;
  for (let i = 0; i < asins.length; i += 5)
    results.push(
      ...(await Promise.all(
        asins.slice(i, i + 5).map(async (asin) => {
          try {
            if (Date.now() > deadline)
              throw new Error("Batch deadline reached");
            return { ok: true, asin, product: await getProductOrFetch(asin) };
          } catch {
            return {
              ok: false,
              asin,
              error: "Product lookup failed. Try again later.",
            };
          }
        }),
      )),
    );
  return results;
};
export const getFeaturedProducts = async () => {
  if (!config.featuredAsins.length) return [];
  const rows: any[] =
    throwIfError(
      await supabase
        .from("Product")
        .select("canonicalData")
        .in("asin", config.featuredAsins),
    ) || [];
  return rows.map((r) => r.canonicalData).filter(Boolean); // public preload never invokes a billed provider
};

export const saveDiscoveryProducts = async (raw: any[]) => {
  const results = raw
    .filter((p) => p && /^[A-Z0-9]{10}$/.test(p.asin))
    .map((p) => canonicalProduct(p, p.asin));
  if (results.length)
    throwIfError(
      await supabase.from("Product").upsert(
        results.map((p) => ({
          asin: p.asin,
          title: p.title,
          image: p.image || "",
          category: p.category || "Amazon",
          currentPrice: p.price ?? 0,
          currentBsr: p.bsr ?? 0,
          estSales: p.estSales ?? 0,
          sellers: p.sellers ?? 0,
          referralFee: p.referralFee ?? 0,
          fbaFee: p.fbaFee ?? 0,
          canonicalData: p,
          updatedAt: new Date().toISOString(),
        })),
        { onConflict: "asin", ignoreDuplicates: true },
      ),
    );
  return results;
};
