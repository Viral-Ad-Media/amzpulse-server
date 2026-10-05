import { fetchProductFromProvider } from "../providers";
import { config } from "../config";
let active = 0;
const slots: number[] = [];
export const getExternalProduct = async (asin: string): Promise<any> => {
  const now = Date.now();
  while (slots.length && now - slots[0] >= 60000) slots.shift();
  if (active >= 5 || slots.length >= config.provider.rateLimitPerMinute)
    throw new Error("Provider busy. Retry later.");
  active++;
  slots.push(now);
  try {
    return await fetchProductFromProvider(asin);
  } finally {
    active--;
  }
};
