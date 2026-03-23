import { Request, Response } from 'express';
import { getProductOrFetch } from '../services/productService';
import logger from '../lib/logger';
import supabase, { throwIfError } from '../providers/supabase';
import crypto from 'crypto';

export const listSourcingNotes = async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const notes =
    throwIfError<any[]>(
      await supabase
        .from('SourcingNote')
        .select('*')
        .eq('organizationId', req.user.organizationId)
    ) || [];

  const asins = notes.map((n: any) => n.productId);
  const products =
    asins.length > 0
      ? throwIfError<any[]>(await supabase.from('Product').select('*').in('asin', asins)) || []
      : [];
  const productMap = new Map<string, any>();
  products.forEach((p: any) => productMap.set(p.asin, p));

  return res.json(
    notes.map((note: any) => ({
      ...note,
      product: productMap.get(note.productId) || null
    }))
  );
};

export const addSourcingNote = async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const { asin, supplierUrl, costPrice, minOrderQty } = req.body;
  if (!asin || typeof asin !== 'string') {
    return res.status(400).json({ error: 'ASIN is required' });
  }

  try {
    await getProductOrFetch(asin);
    const note = throwIfError<any>(
      await supabase
        .from('SourcingNote')
        .insert({
          id: crypto.randomUUID(),
          productId: asin,
          userId: req.user.userId,
          organizationId: req.user.organizationId,
          supplierUrl,
          costPrice: costPrice ?? 0,
          minOrderQty: minOrderQty ?? null
        })
        .select()
        .single()
    );
    return res.status(201).json(note);
  } catch (err) {
    logger.warn('Failed to add sourcing note', { error: err });
    return res.status(400).json({ error: 'Could not add sourcing note' });
  }
};

export const deleteSourcingNote = async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const { id } = req.params;
  await supabase.from('SourcingNote').delete().eq('organizationId', req.user.organizationId).eq('id', id);
  return res.status(204).send();
};
