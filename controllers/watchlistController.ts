import { Request, Response } from "express";
import logger from "../lib/logger";
import supabase, { requireData, throwIfError } from "../providers/supabase";
import { canonicalProduct } from "../services/productService";
import { normalizeAsin } from "../lib/validation";
import crypto from "crypto";

export const listWatchlist = async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });

  const items =
    throwIfError<any[]>(
      await supabase
        .from("WatchlistItem")
        .select("*")
        .eq("organizationId", req.user.organizationId),
    ) || [];

  const asins = items.map((i: any) => i.productId);
  const products =
    asins.length > 0
      ? throwIfError<any[]>(
          await supabase.from("Product").select("*").in("asin", asins),
        ) || []
      : [];
  const productMap = new Map<string, any>();
  products.forEach((p: any) => productMap.set(p.asin, p));

  const withProducts = items.map((item: any) => ({
    ...item,
    product:
      productMap.get(item.productId)?.canonicalData ||
      canonicalProduct(
        {
          name: productMap.get(item.productId)?.title,
          brand: productMap.get(item.productId)?.brand,
          image: productMap.get(item.productId)?.image,
          category: productMap.get(item.productId)?.category,
          price: null,
          bsr: null,
          referralFee: null,
          fbaFee: null,
          storageFee: null,
          dataSource: "legacy-cache",
        },
        item.productId,
      ),
  }));

  return res.json(withProducts);
};

export const addToWatchlist = async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  const { targetPrice, targetRoi, notes } = req.body;
  if (
    [targetPrice, targetRoi].some(
      (v) =>
        v != null &&
        (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 10000000),
    ) ||
    (notes != null && (typeof notes !== "string" || notes.length > 10000))
  )
    return res.status(400).json({ error: "Invalid watchlist values" });
  let asin: string;
  try {
    asin = normalizeAsin(req.body.asin);
  } catch {
    return res.status(400).json({ error: "Invalid ASIN" });
  }
  if (!asin || typeof asin !== "string") {
    return res.status(400).json({ error: "ASIN is required" });
  }

  try {
    const row: any = throwIfError(
      await supabase
        .from("Product")
        .select("canonicalData")
        .eq("asin", asin)
        .maybeSingle(),
    );
    if (!row?.canonicalData)
      return res
        .status(400)
        .json({ error: "Look up this product before saving it" });
    const product = row.canonicalData;
    const existing = throwIfError<any>(
      await supabase
        .from("WatchlistItem")
        .select("id")
        .eq("organizationId", req.user.organizationId)
        .eq("productId", asin)
        .maybeSingle(),
    );

    const id = existing?.id || crypto.randomUUID();
    const item = requireData<any>(
      await supabase
        .from("WatchlistItem")
        .upsert(
          {
            id,
            productId: asin,
            userId: req.user.userId,
            organizationId: req.user.organizationId,
            targetPrice: targetPrice ?? null,
            targetRoi: targetRoi ?? null,
            notes: notes || null,
          },
          { onConflict: "organizationId,productId" },
        )
        .select()
        .single(),
    );

    return res
      .status(201)
      .json({
        asin,
        product,
        watchlistItem: {
          id: item.id,
          targetPrice: item.targetPrice,
          targetRoi: item.targetRoi,
          notes: item.notes,
        },
      });
  } catch (err) {
    logger.warn("Failed to add to watchlist", { error: err });
    return res.status(400).json({ error: "Could not add to watchlist" });
  }
};

export const removeFromWatchlist = async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  const { idOrAsin } = req.params;

  throwIfError(
    await supabase
      .from("WatchlistItem")
      .delete()
      .eq("organizationId", req.user.organizationId)
      .eq(
        /^[A-Z0-9]{10}$/i.test(idOrAsin) ? "productId" : "id",
        idOrAsin.toUpperCase().match(/^[A-Z0-9]{10}$/)
          ? idOrAsin.toUpperCase()
          : idOrAsin,
      ),
  );
  return res.status(204).send();
};
