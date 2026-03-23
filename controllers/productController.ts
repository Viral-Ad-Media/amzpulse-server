import { Request, Response } from 'express';
import * as productService from '../services/productService';
import logger from '../lib/logger';

const isValidAsin = (asin?: string) => typeof asin === 'string' && /^[A-Z0-9]{10}$/.test(asin.toUpperCase());

export const getProductDetails = async (req: Request, res: Response) => {
  try {
    const { asin } = req.params;
    if (!isValidAsin(asin)) {
      return res.status(400).json({ error: 'Invalid ASIN format' });
    }

    const product = await productService.getProductOrFetch(asin);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    return res.json(product);
  } catch (error) {
    logger.error('Error fetching product', { error });
    return res.status(502).json({ error: 'Failed to fetch product data' });
  }
};

export const getProductHistory = async (req: Request, res: Response) => {
  try {
    const { asin } = req.params;
    if (!isValidAsin(asin)) {
      return res.status(400).json({ error: 'Invalid ASIN format' });
    }

    const history = await productService.getHistory(asin);
    return res.json(history);
  } catch (error) {
    logger.error('Error fetching history', { error });
    return res.status(502).json({ error: 'Failed to fetch history' });
  }
};

export const analyzeBatch = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const { asins } = req.body;
    if (!Array.isArray(asins) || asins.length === 0) {
      return res.status(400).json({ error: 'Invalid payload: asins must be a non-empty array' });
    }
    if (asins.length > 100) {
      return res.status(413).json({ error: 'Too many ASINs in a single request (max 100)' });
    }
    // sanitize/validate ASINs list (access middleware pre-sanitized if available)
    const sanitized = (res.locals as any).sanitizedAsins || asins.map(String).map(s => s.trim().toUpperCase()).filter(s => /^[A-Z0-9]{10}$/.test(s));
    if (sanitized.length === 0) return res.status(400).json({ error: 'No valid ASINs provided' });

    const results = await productService.processBatch(sanitized);
    return res.json(results);
  } catch (error) {
    logger.error('Batch processing error', { error });
    return res.status(502).json({ error: 'Batch processing failed' });
  }
};
