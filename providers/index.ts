import { productApi } from "../services/providerBridge";
import { config } from "../config";
import { realProvider } from "./realProvider";
export const fetchProductFromProvider = async (asin: string): Promise<any> => {
  if (config.provider.baseUrl) return realProvider.fetchProduct(asin);
  const api = await productApi();
  const products = await api.withProviderDeadline(() =>
    api.fetchAmazonProducts([asin]),
  );
  if (!products[0]) throw new Error("Product unavailable");
  return products[0];
};
