import { config } from '../config';
import { getProductData as getMockProduct } from './mockProvider';
import { realProvider } from './realProvider';
import { ExternalProductData, ProductProvider } from './types';
import logger from '../lib/logger';

const mockProvider: ProductProvider = {
  fetchProduct: (asin: string) => getMockProduct(asin)
};

const selectProvider = (): ProductProvider => {
  if (config.provider.baseUrl) {
    return realProvider;
  }
  return mockProvider;
};

export const fetchProductFromProvider = async (asin: string): Promise<ExternalProductData> => {
  const provider = selectProvider();
  try {
    return await provider.fetchProduct(asin);
  } catch (err) {
    logger.warn('Primary provider failed, falling back to mock provider', { error: err });
    return await mockProvider.fetchProduct(asin);
  }
};

