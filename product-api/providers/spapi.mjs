import { HttpError } from "../http.mjs";
import {
  fetchWithRetry,
  blankProduct,
  toNumber,
  valueFromEnv,
} from "./shared.mjs";

// Amazon Selling Partner API for authorized seller applications.
// Requires a real seller account with an SP-API app registered and authorized (LWA
// client id/secret + a refresh token generated for that authorization).
// Docs: https://developer-docs.amazon.com/sp-api
//   - LWA token exchange: https://developer-docs.amazon.com/sp-api/docs/connecting-to-the-selling-partner-api
//   - Catalog Items API:  https://developer-docs.amazon.com/sp-api/docs/catalog-items-api-v2022-04-01-reference
//   - Product Pricing API: https://developer-docs.amazon.com/sp-api/docs/product-pricing-api-v0-reference
const LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token";
const CATALOG_API_VERSION = "2022-04-01";
const DEFAULT_MARKETPLACE_ID = "ATVPDKIKX0DER"; // amazon.com (US)

const REGION_HOSTS = {
  na: "sellingpartnerapi-na.amazon.com",
  eu: "sellingpartnerapi-eu.amazon.com",
  fe: "sellingpartnerapi-fe.amazon.com",
};

const readConfig = (env) => {
  const clientId = valueFromEnv(env, ["SPAPI_CLIENT_ID"]);
  const clientSecret = valueFromEnv(env, ["SPAPI_CLIENT_SECRET"]);
  const refreshToken = valueFromEnv(env, ["SPAPI_REFRESH_TOKEN"]);
  if (!clientId || !clientSecret || !refreshToken) return null;

  const region = (valueFromEnv(env, ["SPAPI_REGION"]) || "na").toLowerCase();
  return {
    clientId,
    clientSecret,
    refreshToken,
    marketplaceId:
      valueFromEnv(env, ["SPAPI_MARKETPLACE_ID"]) || DEFAULT_MARKETPLACE_ID,
    host:
      valueFromEnv(env, ["SPAPI_ENDPOINT"]) ||
      REGION_HOSTS[region] ||
      REGION_HOSTS.na,
  };
};

export const isConfigured = (env = process.env) => Boolean(readConfig(env));

// LWA access tokens live for ~1hr; cache in-process so every product lookup doesn't
// spend a request on a fresh token (module-scoped by design - only ever one seller
// account per deployment).
let cachedToken = null;
let cachedTokenExpiresAt = 0;

const getAccessToken = async (config) => {
  if (cachedToken && Date.now() < cachedTokenExpiresAt) return cachedToken;

  const response = await fetchWithRetry(LWA_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: config.refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.access_token) {
    throw new HttpError(
      response.status || 502,
      payload?.error_description || "SP-API login (LWA) failed.",
    );
  }

  cachedToken = payload.access_token;
  // Refresh a little early rather than exactly on expiry.
  cachedTokenExpiresAt =
    Date.now() +
    Math.max(0, (toNumber(payload.expires_in) || 3600) - 60) * 1000;
  return cachedToken;
};

const spApiFetch = async (config, accessToken, path) => {
  const response = await fetchWithRetry(`https://${config.host}${path}`, {
    headers: { "x-amz-access-token": accessToken, accept: "application/json" },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new HttpError(
      response.status,
      payload?.errors?.[0]?.message || "SP-API request failed.",
    );
  }
  return payload;
};

const fetchCatalogItem = (config, accessToken, asin) =>
  spApiFetch(
    config,
    accessToken,
    `/catalog/${CATALOG_API_VERSION}/items/${encodeURIComponent(asin)}?marketplaceIds=${encodeURIComponent(config.marketplaceId)}&includedData=images,salesRanks,summaries`,
  );

const fetchOffers = (config, accessToken, asin) =>
  spApiFetch(
    config,
    accessToken,
    `/products/pricing/v0/items/${encodeURIComponent(asin)}/offers?MarketplaceId=${encodeURIComponent(config.marketplaceId)}&ItemCondition=New`,
  ).catch(() => null); // pricing can legitimately 404/permission-fail per ASIN; catalog data still stands alone

const firstDefined = (...values) =>
  values.find(
    (value) => value !== undefined && value !== null && value !== "",
  ) ?? "";

const mapToProduct = (asin, catalogItem, offersPayload) => {
  const summary = catalogItem?.summaries?.[0] || {};
  const image =
    catalogItem?.images?.[0]?.images?.find((img) => img.variant === "MAIN") ||
    catalogItem?.images?.[0]?.images?.[0];
  const classificationRank =
    catalogItem?.salesRanks?.[0]?.classificationRanks?.[0];
  const displayGroupRank = catalogItem?.salesRanks?.[0]?.displayGroupRanks?.[0];

  const offers = offersPayload?.payload;
  const buyBoxPrice =
    offers?.Summary?.BuyBoxPrices?.[0]?.LandedPrice ??
    offers?.Summary?.LowestPrices?.[0]?.LandedPrice;
  const winningOffer = Array.isArray(offers?.Offers)
    ? offers.Offers.find((offer) => offer?.IsBuyBoxWinner)
    : null;
  const priceAmount = toNumber(
    buyBoxPrice?.Amount ?? winningOffer?.ListingPrice?.Amount,
  );

  return {
    ...blankProduct(asin),
    name: summary.itemName || `Amazon product ${asin}`,
    brand: summary.brand || "Unknown",
    category: displayGroupRank?.title || classificationRank?.title || "Amazon",
    price: priceAmount,
    priceDisplay: priceAmount > 0 ? `$${priceAmount.toFixed(2)}` : "",
    currency: firstDefined(
      buyBoxPrice?.CurrencyCode,
      winningOffer?.ListingPrice?.CurrencyCode,
      "USD",
    ),
    image: image?.link || "",
    sellers: Array.isArray(offers?.Offers) ? offers.Offers.length : 0,
    bsr: toNumber(displayGroupRank?.rank ?? classificationRank?.rank),
    fulfillmentChannel: winningOffer?.IsFulfilledByAmazon ? "FBA" : "",
    detailUrl: `https://www.amazon.com/dp/${asin}`,
    dataSource: "amazon-spapi",
    lastSyncedAt: new Date().toISOString(),
  };
};

export const fetchProducts = async (asins, env = process.env) => {
  const config = readConfig(env);
  if (!config) {
    throw new HttpError(
      503,
      "Amazon SP-API is not configured. Set SPAPI_CLIENT_ID, SPAPI_CLIENT_SECRET, and SPAPI_REFRESH_TOKEN on the server.",
    );
  }

  if (config.marketplaceId !== DEFAULT_MARKETPLACE_ID)
    throw new HttpError(400, "AmzPulse currently supports the US marketplace.");
  const accessToken = await getAccessToken(config);
  const products = [];

  // SP-API is strictly rate-limited per operation, so ASINs are fetched sequentially
  // rather than in parallel.
  for (const asin of asins) {
    try {
      const [catalogItem, offersPayload] = await Promise.all([
        fetchCatalogItem(config, accessToken, asin),
        fetchOffers(config, accessToken, asin),
      ]);
      products.push(mapToProduct(asin, catalogItem, offersPayload));
    } catch {
      // Skip ASINs SP-API couldn't resolve (not found, restricted, etc.); the orchestrator
      // will try the next configured provider for anything missing.
    }
  }

  return products;
};
