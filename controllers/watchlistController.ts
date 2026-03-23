import { Request, Response } from 'express';
import { getProductOrFetch } from '../services/productService';
import logger from '../lib/logger';
import supabase, { requireData, throwIfError } from '../providers/supabase';
import crypto from 'crypto';

export const listWatchlist = async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  const items =
    throwIfError<any[]>(
      await supabase
        .from('WatchlistItem')
        .select('*')
        .eq('organizationId', req.user.organizationId)
    ) || [];

  const asins = items.map((i: any) => i.productId);
  const products =
    asins.length > 0
      ? throwIfError<any[]>(await supabase.from('Product').select('*').in('asin', asins)) || []
      : [];
  const productMap = new Map<string, any>();
  products.forEach((p: any) => productMap.set(p.asin, p));

  const withProducts = items.map((item: any) => ({
    ...item,
    product: productMap.get(item.productId) || null
  }));

  return res.json(withProducts);
};

export const addToWatchlist = async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const { asin, targetPrice, targetRoi, notes } = req.body;
  if (!asin || typeof asin !== 'string') {
    return res.status(400).json({ error: 'ASIN is required' });
  }

  try {
    const product = await getProductOrFetch(asin);
    const existing = throwIfError<any>(
      await supabase
        .from('WatchlistItem')
        .select('id')
        .eq('organizationId', req.user.organizationId)
        .eq('productId', asin)
        .maybeSingle()
    );

    const id = existing?.id || crypto.randomUUID();
    const item = requireData<any>(
      await supabase
        .from('WatchlistItem')
        .upsert(
          {
            id,
            productId: asin,
            userId: req.user.userId,
            organizationId: req.user.organizationId,
            targetPrice: targetPrice ?? null,
            targetRoi: targetRoi ?? null,
            notes: notes || null
          },
          { onConflict: 'organizationId,productId' }
        )
        .select()
        .single()
    );

    return res.status(201).json({ asin, product, watchlistItem: { id: item.id, targetPrice: item.targetPrice, targetRoi: item.targetRoi, notes: item.notes } });
  } catch (err) {
    logger.warn('Failed to add to watchlist', { error: err });
    return res.status(400).json({ error: 'Could not add to watchlist' });
  }
};

export const removeFromWatchlist = async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const { idOrAsin } = req.params;

  await supabase
    .from('WatchlistItem')
    .delete()
    .eq('organizationId', req.user.organizationId)
    .or(`id.eq.${idOrAsin},productId.eq.${idOrAsin}`);
  return res.status(204).send();
};
