import { amazonPaapiProvider } from './amazonPaapiProvider';
import { config } from '../config';
import { getProductData as getMockProduct } from './mockProvider';
import { realProvider } from './realProvider';
import { ExternalProductData, ProductProvider } from './types';
import logger from '../lib/logger';

const mockProvider: ProductProvider = {
  fetchProduct: (asin: string) => getMockProduct(asin)
};

const selectProvider = (): { kind: 'amazon' | 'generic' | 'mock'; provider: ProductProvider } | null => {
  if (config.amazon.enabled) {
    return { kind: 'amazon', provider: amazonPaapiProvider };
  }
  if (config.provider.baseUrl) {
    return { kind: 'generic', provider: realProvider };
  }
  if (config.allowMockData) {
    return { kind: 'mock', provider: mockProvider };
  }
  return null;
};

export const fetchProductFromProvider = async (asin: string): Promise<ExternalProductData> => {
  const selected = selectProvider();
  if (!selected) {
    throw new Error('No real product provider configured. Set Amazon PA-API credentials or PROVIDER_BASE_URL.');
  }
  try {
    return await selected.provider.fetchProduct(asin);
  } catch (err) {
    if (!config.allowMockData || selected.kind === 'mock') {
      throw err;
    }
    logger.warn('Primary provider failed, falling back to mock provider', { error: err, provider: selected.kind });
    return mockProvider.fetchProduct(asin);
  }
};
