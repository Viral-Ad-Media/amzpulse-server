import { Request, Response } from "express";
import * as products from "../services/productService";
import { normalizeAsin } from "../lib/validation";
import { reserveUsage, settleUsage } from "../services/billingService";
import { productApi, aiApi } from "../services/providerBridge";
export const getFeaturedProducts = async (_req: Request, res: Response) =>
  res.json(await products.getFeaturedProducts());
const metered = async (
  req: Request,
  res: Response,
  count: number,
  kind: "asin" | "ai",
  work: () => Promise<any>,
  success: (result: any) => number,
  batch = false,
) => {
  if (!req.user) return res.sendStatus(401);
  let id: string;
  try {
    id = await reserveUsage(req.user.organizationId, count, kind, batch);
  } catch (err: any) {
    if (err.code === "P0001")
      return res.status(402).json({ error: err.message });
    throw err;
  }
  let result: any;
  try {
    result = await work();
  } catch (err) {
    await settleUsage(id, 0);
    throw err;
  }
  await settleUsage(id, success(result));
  return res.json(result);
};
export const getProductDetails = async (req: Request, res: Response) => {
  let asin: string;
  try {
    asin = normalizeAsin(req.params.asin);
  } catch {
    return res.status(400).json({ error: "Invalid ASIN" });
  }
  return metered(
    req,
    res,
    1,
    "asin",
    () => products.getProductOrFetch(asin),
    () => 1,
  );
};
export const getProductHistory = async (req: Request, res: Response) => {
  let asin: string;
  try {
    asin = normalizeAsin(req.params.asin);
  } catch {
    return res.status(400).json({ error: "Invalid ASIN" });
  }
  return metered(
    req,
    res,
    1,
    "asin",
    () => products.getHistory(asin),
    () => 1,
  );
};
export const analyzeBatch = async (req: Request, res: Response) =>
  metered(
    req,
    res,
    res.locals.sanitizedAsins.length,
    "asin",
    () => products.processBatch(res.locals.sanitizedAsins),
    (r) => r.filter((x: any) => x.ok).length,
    true,
  );
export const analyzeProduct = async (req: Request, res: Response) => {
  let asin: string;
  try {
    asin = normalizeAsin(req.body?.product?.asin);
  } catch {
    return res.status(400).json({ error: "Provide a valid product ASIN" });
  }
  const stats = req.body?.userStats;
  if (
    stats &&
    !["buyCost", "profit", "roi"].every(
      (k) =>
        typeof stats[k] === "number" &&
        Number.isFinite(stats[k]) &&
        Math.abs(stats[k]) < 1e9,
    )
  )
    return res.status(400).json({ error: "Invalid calculator values" });
  return metered(
    req,
    res,
    1,
    "ai",
    async () => {
      // Do not let the caller fabricate risk/market information in an AI prompt.
      const product = await products.getProductOrFetch(asin);
      const api = await aiApi();
      return api.analyzeProduct(product, stats);
    },
    () => 1,
  );
};
const rail =
  (name: "getTrendingProducts" | "getBestSellerProducts") =>
  async (req: Request, res: Response) =>
    metered(
      req,
      res,
      12,
      "asin",
      async () => {
        const api = await productApi();
        return products.saveDiscoveryProducts(
          await api[name]({
            ...process.env,
            TRENDING_LIMIT: "12",
            BESTSELLERS_LIMIT: "12",
          }),
        );
      },
      (r) => Math.min(12, r.length),
    );
export const getTrendingProducts = rail("getTrendingProducts");
export const getBestSellerProducts = rail("getBestSellerProducts");
