import { ExternalProductData, ProductProvider } from './types';
import { config } from '../config';

// Generic HTTP provider; expects a JSON response similar to ExternalProductData
export const realProvider: ProductProvider = {
  fetchProduct: async (asin: string): Promise<ExternalProductData> => {
    if (!config.provider.baseUrl) {
      throw new Error('Provider base URL not configured');
    }
    const doFetch: any = (globalThis as any).fetch;
    if (!doFetch) {
      throw new Error('fetch is not available in this runtime');
    }
    const url = `${config.provider.baseUrl.replace(/\/$/, '')}/products/${encodeURIComponent(asin)}`;
    const resp = await doFetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...(config.provider.apiKey ? { Authorization: `Bearer ${config.provider.apiKey}` } : {})
      }
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Provider error: ${resp.status} ${text}`);
    }

    const data = await resp.json();

    // Map minimal fields to ExternalProductData shape with safe fallbacks
    const mapped: ExternalProductData = {
      asin,
      title: data.title || data.name || asin,
      brand: data.brand || data.manufacturer || 'Unknown',
      category: data.category || 'Misc',
      subCategory: data.subCategory,
      price: Number(data.price || data.currentPrice || 0),
      bsr: Number(data.bsr || data.rank || 0),
      estSales: Number(data.estSales || data.estimatedSales || 0),
      sellers: Number(data.sellers || data.offerCount || 0),
      referralFee: Number(data.referralFee || 0),
      fbaFee: Number(data.fbaFee || 0),
      storageFee: Number(data.storageFee || 0),
      weight: data.weight,
      dimensions: data.dimensions,
      isHazmat: Boolean(data.isHazmat),
      isIpRisk: Boolean(data.isIpRisk),
      isOversized: Boolean(data.isOversized),
      rating: Number(data.rating || 0),
      reviews: Number(data.reviews || 0),
      trend: Number(data.trend || 0),
      description: data.description,
      seasonalityTags: data.seasonalityTags || [],
      analysis: data.analysis,
      priceHistory: data.priceHistory || [],
      bsrHistory: data.bsrHistory || [],
      image: data.image
    };

    return mapped;
  }
};
