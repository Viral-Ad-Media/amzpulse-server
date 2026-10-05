import { HttpError } from "../http.mjs";
import {
  fetchWithRetry,
  blankProduct,
  chunkArray,
  valueFromEnv,
} from "./shared.mjs";

// https://keepa.com/#!discuss/t/product-object/116 / https://keepaapi.readthedocs.io
const KEEPA_BASE = "https://api.keepa.com";
const MAX_ASINS_PER_REQUEST = 100;
// Keepa timestamps are minutes since Keepa's own epoch (2011-01-01). Add this offset to
// get unix minutes, then multiply by 60000 for a JS Date.
const KEEPA_MINUTES_EPOCH_OFFSET = 21564000;

const CSV_INDEX = {
  AMAZON_PRICE: 0,
  NEW_PRICE: 1,
  SALES_RANK: 3,
  RATING: 16,
  REVIEW_COUNT: 17,
};

export const isConfigured = (env = process.env) =>
  Boolean(valueFromEnv(env, ["KEEPA_API_KEY"]));

const keepaMinutesToIsoDate = (keepaMinutes) =>
  new Date((keepaMinutes + KEEPA_MINUTES_EPOCH_OFFSET) * 60000).toISOString();

// Keepa csv series are flat [time, value, time, value, ...] pairs; -1 means "no data".
const parseSeries = (csvSeries, valueScale = 1) => {
  if (!Array.isArray(csvSeries)) return [];
  const points = [];
  for (let index = 0; index < csvSeries.length; index += 2) {
    const time = csvSeries[index];
    const raw = csvSeries[index + 1];
    if (raw === undefined) continue;
    points.push({
      date: keepaMinutesToIsoDate(time),
      value: raw < 0 ? null : raw / valueScale,
    });
  }
  return points;
};

export const mapProductToProduct = (item, domain = "1") => {
  const asin = item?.asin || "";
  const csv = Array.isArray(item?.csv) ? item.csv : [];

  const amazonPriceSeries = parseSeries(csv[CSV_INDEX.AMAZON_PRICE], 100);
  const newPriceSeries = parseSeries(csv[CSV_INDEX.NEW_PRICE], 100);
  const priceSeries = newPriceSeries.length
    ? newPriceSeries
    : amazonPriceSeries;
  const rankSeries = parseSeries(csv[CSV_INDEX.SALES_RANK], 1);
  const ratingSeries = parseSeries(csv[CSV_INDEX.RATING], 10);
  const reviewSeries = parseSeries(csv[CSV_INDEX.REVIEW_COUNT], 1);

  const currentPrice = priceSeries.length
    ? priceSeries[priceSeries.length - 1].value
    : 0;
  const currentRank = rankSeries.length
    ? rankSeries[rankSeries.length - 1].value
    : 0;
  const currentRating = ratingSeries.length
    ? ratingSeries[ratingSeries.length - 1].value
    : 0;
  const currentReviews = reviewSeries.length
    ? reviewSeries[reviewSeries.length - 1].value
    : 0;

  const categoryTree = Array.isArray(item?.categoryTree)
    ? item.categoryTree
    : [];
  const firstImage = String(item?.imagesCSV || "").split(",")[0];

  return {
    ...blankProduct(asin),
    name: item?.title || `Amazon product ${asin}`,
    brand: item?.brand || item?.manufacturer || "Unknown",
    category: categoryTree[0]?.name || "Amazon",
    subCategory: categoryTree[categoryTree.length - 1]?.name,
    price: currentPrice,
    priceDisplay:
      currentPrice > 0
        ? `${currentPrice.toFixed(2)} ${{ 1: "USD", 2: "GBP", 3: "EUR", 4: "JPY", 5: "CAD", 6: "EUR", 8: "EUR", 9: "EUR", 10: "INR", 11: "MXN" }[domain] || ""}`
        : "",
    currency:
      {
        1: "USD",
        2: "GBP",
        3: "EUR",
        4: "JPY",
        5: "CAD",
        6: "EUR",
        8: "EUR",
        9: "EUR",
        10: "INR",
        11: "MXN",
      }[domain] || "",
    image: firstImage
      ? `https://m.media-amazon.com/images/I/${firstImage}`
      : "",
    rating: currentRating,
    reviews: currentReviews,
    priceHistory: priceSeries
      .filter((p) => p.value !== null)
      .map((point) => ({ date: point.date, price: point.value })),
    bsrHistory: rankSeries
      .filter((p) => p.value !== null)
      .map((point) => ({ date: point.date, rank: point.value })),
    bsr: currentRank,
    detailUrl: `https://www.amazon.com/dp/${asin}`,
    dataSource: "keepa",
    lastSyncedAt: new Date().toISOString(),
  };
};

export const fetchProducts = async (asins, env = process.env) => {
  const apiKey = valueFromEnv(env, ["KEEPA_API_KEY"]);
  if (!apiKey) {
    throw new HttpError(
      503,
      "Keepa is not configured. Set KEEPA_API_KEY on the server.",
    );
  }

  const domain = valueFromEnv(env, ["KEEPA_DOMAIN"]) || "1";
  if (domain !== "1")
    throw new HttpError(
      400,
      "AmzPulse currently supports the US marketplace (KEEPA_DOMAIN=1).",
    ); // 1 = amazon.com
  const products = [];

  for (const asinChunk of chunkArray(asins, MAX_ASINS_PER_REQUEST)) {
    const url = `${KEEPA_BASE}/product?key=${encodeURIComponent(apiKey)}&domain=${encodeURIComponent(domain)}&asin=${asinChunk.join(",")}&stats=1&history=1`;
    const response = await fetchWithRetry(url);
    const payload = await response.json().catch(() => ({}));

    if (!response.ok || payload?.error) {
      throw new HttpError(
        response.status || 502,
        payload?.error?.message || "Keepa request failed.",
      );
    }

    const items = Array.isArray(payload?.products) ? payload.products : [];
    products.push(
      ...items
        .map((item) => mapProductToProduct(item, domain))
        .filter((product) => product.asin),
    );
  }

  return products;
};
