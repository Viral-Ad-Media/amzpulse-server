import { HttpError } from "../http.mjs";
import {
  blankProduct,
  fetchWithRetry,
  toNumber,
  valueFromEnv,
} from "./shared.mjs";

// https://www.rainforestapi.com/docs/product-data-api/reference/product-request
// Field mapping verified 2026-07-23 against a live `type=product` response.
const RAINFOREST_BASE = "https://api.rainforestapi.com/request";
const MAX_CONCURRENT_REQUESTS = 5;

export const isConfigured = (env = process.env) =>
  Boolean(valueFromEnv(env, ["RAINFOREST_API_KEY"]));

const firstValue = (...values) => {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "")
      return value;
  }
  return "";
};

const mapResultToProduct = (product, asin) => {
  const categories = Array.isArray(product?.categories)
    ? product.categories
    : [];
  const bestsellersRanks = Array.isArray(product?.bestsellers_rank)
    ? product.bestsellers_rank
    : [];
  // The last entry is the most specific node (pairs with subCategory below, which also
  // takes the last category entry) rather than the broadest department-level rank.
  const bestsellersRank = bestsellersRanks[bestsellersRanks.length - 1] || null;
  const buybox = product?.buybox_winner;
  const price = toNumber(
    buybox?.price?.value ??
      product?.price?.value ??
      buybox?.price ??
      product?.price,
  );
  const image = firstValue(
    product?.main_image?.link,
    product?.images?.[0]?.link,
    product?.image,
  );
  const fulfillment = buybox?.fulfillment;
  const fulfillmentChannel = fulfillment?.is_fulfilled_by_amazon
    ? "FBA"
    : firstValue(
        fulfillment?.amazon_seller?.name,
        fulfillment?.third_party_seller?.name,
      );

  return {
    ...blankProduct(asin),
    name: firstValue(product?.title, product?.name) || `Amazon product ${asin}`,
    brand: firstValue(product?.brand, "Unknown"),
    category: firstValue(categories[0]?.name, categories[0], "Amazon"),
    subCategory: firstValue(
      categories[categories.length - 1]?.name,
      categories[categories.length - 1],
    ),
    price,
    priceDisplay: firstValue(
      buybox?.price?.raw,
      product?.price?.raw,
      price > 0 ? `$${price.toFixed(2)}` : "",
    ),
    currency: firstValue(
      buybox?.price?.currency,
      product?.price?.currency,
      "USD",
    ),
    image,
    rating: toNumber(product?.rating),
    reviews: toNumber(product?.ratings_total),
    description: firstValue(
      product?.description,
      Array.isArray(product?.feature_bullets)
        ? product.feature_bullets.join(" ")
        : "",
    ),
    weight: firstValue(product?.weight),
    dimensions: firstValue(product?.dimensions),
    // Rainforest's `type=product` response has no offer/seller-count field for a
    // single-offer (Amazon-only) listing; a real seller count needs a separate
    // `type=offers` request. Left at 0 rather than guessing a field name.
    sellers: 0,
    bsr: toNumber(bestsellersRank?.rank),
    availability: firstValue(buybox?.availability?.raw),
    fulfillmentChannel,
    detailUrl: firstValue(product?.link, `https://www.amazon.com/dp/${asin}`),
    dataSource: "rainforest",
    lastSyncedAt: new Date().toISOString(),
  };
};

const fetchOne = async (asin, apiKey, amazonDomain) => {
  const url = `${RAINFOREST_BASE}?api_key=${encodeURIComponent(apiKey)}&type=product&amazon_domain=${encodeURIComponent(amazonDomain)}&asin=${encodeURIComponent(asin)}`;
  const response = await fetchWithRetry(url);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload?.request_info?.success === false) {
    throw new HttpError(
      response.status || 502,
      payload?.request_info?.message || "Rainforest API request failed.",
    );
  }

  return payload?.product ? mapResultToProduct(payload.product, asin) : null;
};

const DEFAULT_BESTSELLERS_LIMIT = 12;

// `type=bestsellers` shape verified live 2026-07-23. Ranked items carry enough for a
// dashboard card (title/image/price/rating/rank) without a further per-ASIN lookup;
// opening a card still goes through fetchProducts for full detail.
const mapBestsellerToProduct = (item) => {
  const asin = item?.asin || "";
  const price = toNumber(item?.price?.value);

  return {
    ...blankProduct(asin),
    name: firstValue(item?.title) || `Amazon product ${asin}`,
    category: firstValue(
      item?.parent_category?.name,
      item?.current_category?.name,
      "Amazon",
    ),
    subCategory: firstValue(item?.current_category?.name),
    price,
    priceDisplay: firstValue(
      item?.price?.raw,
      price > 0 ? `$${price.toFixed(2)}` : "",
    ),
    currency: firstValue(item?.price?.currency, "USD"),
    image: firstValue(item?.image),
    rating: toNumber(item?.rating),
    reviews: toNumber(item?.ratings_total),
    bsr: toNumber(item?.rank ?? item?.position),
    detailUrl: firstValue(
      item?.link,
      asin ? `https://www.amazon.com/dp/${asin}` : "",
    ),
    dataSource: "rainforest-bestsellers",
    lastSyncedAt: new Date().toISOString(),
  };
};

// NOTE: `url` must be a full Amazon bestsellers-page URL, and it defines the Amazon
// domain itself — Rainforest rejects the request if `amazon_domain` is also passed.
export const fetchBestsellers = async (
  categoryUrl,
  { limit = DEFAULT_BESTSELLERS_LIMIT } = {},
  env = process.env,
) => {
  const apiKey = valueFromEnv(env, ["RAINFOREST_API_KEY"]);
  if (!apiKey) {
    throw new HttpError(
      503,
      "Rainforest API is not configured. Set RAINFOREST_API_KEY on the server.",
    );
  }
  if (!categoryUrl) {
    throw new HttpError(400, "A bestsellers category URL is required.");
  }

  const category = new URL(categoryUrl);
  if (
    category.protocol !== "https:" ||
    !["amazon.com", "www.amazon.com"].includes(category.hostname)
  )
    throw new HttpError(400, "A US Amazon HTTPS category URL is required.");
  const url = `${RAINFOREST_BASE}?api_key=${encodeURIComponent(apiKey)}&type=bestsellers&url=${encodeURIComponent(categoryUrl)}`;
  const response = await fetchWithRetry(url);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload?.request_info?.success === false) {
    throw new HttpError(
      response.status || 502,
      payload?.request_info?.message ||
        "Rainforest bestsellers request failed.",
    );
  }

  const items = Array.isArray(payload?.bestsellers) ? payload.bestsellers : [];
  return items
    .slice(0, limit)
    .map(mapBestsellerToProduct)
    .filter((product) => product.asin);
};

export const fetchProducts = async (asins, env = process.env) => {
  const apiKey = valueFromEnv(env, ["RAINFOREST_API_KEY"]);
  if (!apiKey) {
    throw new HttpError(
      503,
      "Rainforest API is not configured. Set RAINFOREST_API_KEY on the server.",
    );
  }

  const amazonDomain =
    valueFromEnv(env, ["RAINFOREST_AMAZON_DOMAIN"]) || "amazon.com";
  if (amazonDomain !== "amazon.com")
    throw new HttpError(400, "AmzPulse currently supports the US marketplace.");
  const products = [];
  let lastError = null;

  // Rainforest's product endpoint is one ASIN per request; cap concurrency instead of
  // firing every request at once.
  for (let index = 0; index < asins.length; index += MAX_CONCURRENT_REQUESTS) {
    const batch = asins.slice(index, index + MAX_CONCURRENT_REQUESTS);
    const results = await Promise.all(
      batch.map(async (asin) => {
        try {
          return await fetchOne(asin, apiKey, amazonDomain);
        } catch (error) {
          lastError = error;
          return null;
        }
      }),
    );
    products.push(...results.filter(Boolean));
  }

  // A systemic failure (bad key, quota exhausted) looks identical to "nothing found"
  // per-ASIN; if every request failed, surface the reason instead of hiding it.
  if (products.length === 0 && lastError) {
    throw lastError;
  }

  return products;
};
