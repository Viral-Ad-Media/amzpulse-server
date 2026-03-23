export interface ExternalProductData {
  asin: string;
  title: string;
  brand: string;
  category: string;
  subCategory?: string;
  price: number;
  bsr: number;
  estSales: number;
  sellers: number;
  referralFee: number;
  fbaFee: number;
  storageFee?: number;
  weight?: string;
  dimensions?: string;
  isHazmat?: boolean;
  isIpRisk?: boolean;
  isOversized?: boolean;
  priceHistory: { date: string; price: number }[];
  bsrHistory: { date: string; rank: number }[];
  image?: string;
  rating?: number;
  reviews?: number;
  trend?: number;
  description?: string;
  seasonalityTags?: string[];
  analysis?: any;
}

export interface ProductProvider {
  fetchProduct: (asin: string) => Promise<ExternalProductData>;
}

