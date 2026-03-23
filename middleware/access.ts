import { Request, Response, NextFunction } from 'express';
import { requireOwnerOrAdmin, consumeBatchUsage } from '../services/billingService';

export const requireAuthUser = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  return next();
};

export const requireRole = (roles: string[]) => (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (!roles.includes(req.user.role || '')) return res.status(403).json({ error: 'Forbidden' });
  return next();
};

export const enforceBatchAccess = async (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (!requireOwnerOrAdmin(req.user.role)) return res.status(403).json({ error: 'Batch access requires owner/admin role' });

  const { asins } = req.body;
  if (!Array.isArray(asins)) return res.status(400).json({ error: 'Invalid ASIN list' });
  const sanitized = asins.map(String).map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z0-9]{10}$/.test(s));
  if (sanitized.length === 0) return res.status(400).json({ error: 'No valid ASINs provided' });

  try {
    await consumeBatchUsage(req.user.organizationId, sanitized.length);
    (res.locals as any).sanitizedAsins = sanitized;
    return next();
  } catch (err) {
    return res.status(402).json({ error: (err as Error).message });
  }
};
