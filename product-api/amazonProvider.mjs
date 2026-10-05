import { HttpError, readJsonBody, sendError, sendJson } from "./http.mjs";
import { ASIN_PATTERN, valueFromEnv } from "./providers/shared.mjs";
import * as spapiProvider from "./providers/spapi.mjs";
import * as keepaProvider from "./providers/keepa.mjs";
import * as rainforestProvider from "./providers/rainforest.mjs";

export { HttpError, readJsonBody, sendError, sendJson };
export { withProviderDeadline } from "./providers/shared.mjs";

const MAX_BATCH_ITEMS = 100;

// Providers are tried in this order; each one only runs if its own env vars are set.
// For any ASIN a provider doesn't return, the next configured provider is tried for just
// that ASIN, so a partial provider outage doesn't
// take down the whole lookup.
const PROVIDERS = {
  spapi: spapiProvider,
  keepa: keepaProvider,
  rainforest: rainforestProvider,
};

const resolveProviderOrder = (env) => {
  const configuredOrder = valueFromEnv(env, ["PRODUCT_DATA_PROVIDERS"]);
  const order = configuredOrder
    ? configuredOrder.split(",").map((name) => name.trim().toLowerCase())
    : Object.keys(PROVIDERS);
  return order.filter((name) => PROVIDERS[name]);
};

export const normalizeAsins = (values) => {
  const raw = Array.isArray(values)
    ? values
    : String(values || "").split(/[\s,]+/);
  const normalized = raw
    .map((value) =>
      String(value || "")
        .trim()
        .toUpperCase(),
    )
    .filter(Boolean);
  return [...new Set(normalized)];
};

const validateAsins = (asins, maxItems = MAX_BATCH_ITEMS) => {
  if (asins.length === 0) {
    throw new HttpError(400, "Provide at least one ASIN.");
  }
  if (asins.length > maxItems) {
    throw new HttpError(
      413,
      `Too many ASINs. The maximum batch size is ${maxItems}.`,
    );
  }

  const invalid = asins.filter((asin) => !ASIN_PATTERN.test(asin));
  if (invalid.length > 0) {
    throw new HttpError(
      400,
      `Invalid ASIN format: ${invalid.slice(0, 5).join(", ")}`,
    );
  }
};

export const fetchAmazonProducts = async (values, env = process.env) => {
  const asins = normalizeAsins(values);
  validateAsins(asins);

  const providerOrder = resolveProviderOrder(env);
  const configuredProviders = providerOrder.filter((name) =>
    PROVIDERS[name].isConfigured(env),
  );

  if (configuredProviders.length === 0) {
    throw new HttpError(
      503,
      "No product data provider is configured. Set credentials for at least one of: " +
        "SPAPI_CLIENT_ID/SPAPI_CLIENT_SECRET/SPAPI_REFRESH_TOKEN (Amazon SP-API), KEEPA_API_KEY (Keepa), " +
        "RAINFOREST_API_KEY (Rainforest).",
    );
  }

  const found = new Map();
  let remaining = asins;
  const errors = [];

  for (const name of configuredProviders) {
    if (remaining.length === 0) break;

    try {
      const products = await PROVIDERS[name].fetchProducts(remaining, env);
      for (const product of products) {
        if (!found.has(product.asin)) found.set(product.asin, product);
      }
      remaining = remaining.filter((asin) => !found.has(asin));
    } catch (error) {
      // A provider being unconfigured/down shouldn't fail the whole lookup while other
      // providers can still cover these ASINs; only surface it if nothing succeeds.
      errors.push(`${name}: ${error?.message || "request failed"}`);
    }
  }

  if (found.size === 0) {
    throw new HttpError(
      502,
      errors.length > 0
        ? `All product data providers failed. ${errors.join(" | ")}`
        : "No products available.",
    );
  }

  // Preserve the caller's requested ASIN order.
  return asins.map((asin) => found.get(asin)).filter(Boolean);
};

export const getFeaturedAsins = (env = process.env) =>
  normalizeAsins(
    valueFromEnv(env, ["FEATURED_ASINS", "AMAZON_FEATURED_ASINS"]),
  );

// Amazon's site-wide /gp/bestsellers is a category-index page, not an actual ranked
// list — Rainforest parses it "successfully" but returns zero items. A real
// Best-Sellers-<Department>/zgbs/<slug> category page is required instead (verified
// live for Electronics). Amazon's genuinely volatile "Movers & Shakers" list needs a
// numeric browse-node id per category that wasn't reachable to verify live, so both
// rails below use the steadier zgbs Best Sellers endpoint against two different
// default categories rather than guess at an unverified node id.
const DEFAULT_RAIL_LIMIT = 12;
const DEFAULT_TRENDING_CATEGORY_URL =
  "https://www.amazon.com/Best-Sellers-Electronics/zgbs/electronics";
const DEFAULT_BESTSELLERS_CATEGORY_URL =
  "https://www.amazon.com/Best-Sellers-Toys-Games/zgbs/toys-and-games";

// Bestsellers discovery is Rainforest-specific for now — it's the only configured
// provider with a ranked-category endpoint (Keepa has an equivalent but isn't wired up
// here yet), so this doesn't go through the multi-provider fallback chain
// fetchAmazonProducts uses for per-ASIN lookups.
const getBestsellersRail = async (
  env,
  { label, categoryEnvKey, defaultUrl, limitEnvKey },
) => {
  if (!rainforestProvider.isConfigured(env)) {
    throw new HttpError(
      503,
      `${label} require the Rainforest provider. Set RAINFOREST_API_KEY on the server (Keepa's equivalent bestsellers endpoint isn't wired up yet).`,
    );
  }

  const categoryUrl = valueFromEnv(env, [categoryEnvKey]) || defaultUrl;
  const limit = Number(valueFromEnv(env, [limitEnvKey])) || DEFAULT_RAIL_LIMIT;

  return rainforestProvider.fetchBestsellers(categoryUrl, { limit }, env);
};

export const getTrendingProducts = (env = process.env) =>
  getBestsellersRail(env, {
    label: "Trending products",
    categoryEnvKey: "TRENDING_CATEGORY_URL",
    defaultUrl: DEFAULT_TRENDING_CATEGORY_URL,
    limitEnvKey: "TRENDING_LIMIT",
  });

export const getBestSellerProducts = (env = process.env) =>
  getBestsellersRail(env, {
    label: "Best-seller products",
    categoryEnvKey: "BESTSELLERS_CATEGORY_URL",
    defaultUrl: DEFAULT_BESTSELLERS_CATEGORY_URL,
    limitEnvKey: "BESTSELLERS_LIMIT",
  });
