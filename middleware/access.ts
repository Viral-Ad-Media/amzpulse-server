import { validateBatch } from "../lib/validation";
import { Request, Response, NextFunction } from "express";
import { requireOwnerOrAdmin } from "../services/billingService";

export const requireAuthUser = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  return next();
};

export const requireRole =
  (roles: string[]) => (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    if (!roles.includes(req.user.role || ""))
      return res.status(403).json({ error: "Forbidden" });
    return next();
  };

export const enforceBatchAccess = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  if (!requireOwnerOrAdmin(req.user.role))
    return res
      .status(403)
      .json({ error: "Batch access requires owner/admin role" });

  try {
    res.locals.sanitizedAsins = validateBatch(req.body?.asins);
    return next();
  } catch (err) {
    return res.status(400).json({ error: (err as Error).message });
  }
};
