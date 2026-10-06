import { Request, Response } from "express";
import logger from "../lib/logger";
import supabase, { throwIfError } from "../providers/supabase";
import { normalizeAsin } from "../lib/validation";
import crypto from "crypto";

export const listSourcingNotes = async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  const notes =
    throwIfError<any[]>(
      await supabase
        .from("SourcingNote")
        .select("*")
        .eq("organizationId", req.user.organizationId),
    ) || [];

  const asins = notes.map((n: any) => n.productId);
  const products =
    asins.length > 0
      ? throwIfError<any[]>(
          await supabase.from("Product").select("*").in("asin", asins),
        ) || []
      : [];
  const productMap = new Map<string, any>();
  products.forEach((p: any) => productMap.set(p.asin, p));

  return res.json(
    notes.map((note: any) => ({
      ...note,
      product: productMap.get(note.productId)?.canonicalData || null,
    })),
  );
};

export const addSourcingNote = async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  const { supplierUrl, costPrice, minOrderQty } = req.body;
  if (supplierUrl != null) {
    try {
      const url = new URL(supplierUrl);
      if (
        typeof supplierUrl !== "string" ||
        supplierUrl.length > 2048 ||
        !["https:", "http:"].includes(url.protocol)
      )
        throw new Error();
    } catch {
      return res.status(400).json({ error: "Invalid supplier URL" });
    }
  }
  let asin: string;
  try {
    asin = normalizeAsin(req.body.asin);
  } catch {
    return res.status(400).json({ error: "Invalid ASIN" });
  }
  if (
    typeof costPrice !== "number" ||
    !Number.isFinite(costPrice) ||
    costPrice < 0 ||
    (minOrderQty !== undefined &&
      (!Number.isInteger(minOrderQty) || minOrderQty < 1))
  )
    return res.status(400).json({ error: "Invalid sourcing values" });
  if (!asin || typeof asin !== "string") {
    return res.status(400).json({ error: "ASIN is required" });
  }

  try {
    const row: any = throwIfError(
      await supabase
        .from("Product")
        .select("asin")
        .eq("asin", asin)
        .maybeSingle(),
    );
    if (!row)
      return res
        .status(400)
        .json({ error: "Look up this product before saving it" });
    const note = throwIfError<any>(
      await supabase
        .from("SourcingNote")
        .insert({
          id: crypto.randomUUID(),
          productId: asin,
          userId: req.user.userId,
          organizationId: req.user.organizationId,
          supplierUrl,
          costPrice: costPrice ?? 0,
          minOrderQty: minOrderQty ?? null,
        })
        .select()
        .single(),
    );
    return res.status(201).json(note);
  } catch (err) {
    logger.warn("Failed to add sourcing note", { error: err });
    return res.status(400).json({ error: "Could not add sourcing note" });
  }
};

export const deleteSourcingNote = async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  const { id } = req.params;
  throwIfError(
    await supabase
      .from("SourcingNote")
      .delete()
      .eq("organizationId", req.user.organizationId)
      .eq("id", id),
  );
  return res.status(204).send();
};
