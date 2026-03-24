import crypto from 'crypto';
import { config } from '../config';
import { ExternalProductData, ProductProvider } from './types';

const SERVICE = 'ProductAdvertisingAPI';
const TARGET = 'com.amazon.paapi5.v1.ProductAdvertisingAPIv1.GetItems';
const RESOURCE_PATH = '/';
const CONTENT_TYPE = 'application/json; charset=utf-8';
const CONTENT_ENCODING = 'amz-1.0';

const RESOURCES = [
  'BrowseNodeInfo.BrowseNodes.SalesRank',
  'BrowseNodeInfo.WebsiteSalesRank',
  'Images.Primary.Large',
  'Images.Primary.Medium',
  'ItemInfo.ByLineInfo',
  'ItemInfo.Classifications',
  'ItemInfo.Features',
  'ItemInfo.ProductInfo',
  'ItemInfo.Title',
  'Offers.Listings.DeliveryInfo.IsAmazonFulfilled',
  'Offers.Listings.IsBuyBoxWinner',
  'Offers.Listings.MerchantInfo',
  'Offers.Listings.Price',
  'Offers.Summaries.OfferCount',
  'Offers.Summaries.LowestPrice',
  'ParentASIN'
];

const hashHex = (value: string) => crypto.createHash('sha256').update(value, 'utf8').digest('hex');

const hmac = (key: Buffer | string, value: string) => crypto.createHmac('sha256', key).update(value, 'utf8').digest();

const toAmzDate = (date: Date) => date.toISOString().replace(/[:-]|\.\d{3}/g, '');

const toDateStamp = (date: Date) => toAmzDate(date).slice(0, 8);

const getString = (value: unknown) => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return '';
};

const getDisplayValue = (value: any): string | undefined => {
  if (!value) return undefined;
  if (typeof value.DisplayValue === 'string') return value.DisplayValue;
  if (value.Value !== undefined && value.Unit) return `${value.Value} ${value.Unit}`;
  if (typeof value === 'string') return value;
  return undefined;
};

const formatDimensions = (dimensions: any): string | undefined => {
  if (!dimensions) return undefined;
  if (typeof dimensions.DisplayValue === 'string') return dimensions.DisplayValue;

  const parts = [dimensions.Length, dimensions.Width, dimensions.Height]
    .map((part) => getDisplayValue(part))
    .filter(Boolean);

  return parts.length > 0 ? parts.join(' x ') : undefined;
};

const parseNumericString = (value?: string) => {
  if (!value) return undefined;
  const match = value.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : undefined;
};

const getCategoryReferralRate = (category: string) => {
  const normalized = category.toLowerCase();
  if (normalized.includes('electronics')) return 0.08;
  if (normalized.includes('video game')) return 0.01;
  if (normalized.includes('grocery') || normalized.includes('beauty')) return 0.08;
  if (normalized.includes('fashion') || normalized.includes('apparel')) return 0.17;
  if (normalized.includes('furniture')) return 0.15;
  return 0.15;
};

const estimateFbaFee = (price: number, weight?: string, isOversized?: boolean) => {
  const parsedWeight = parseNumericString(weight) || 1;
  const base = price < 10 ? 3.06 : price < 20 ? 3.31 : price < 50 ? 4.75 : 6.25;
  const weightComponent = Math.max(0, parsedWeight - 1) * 0.35;
  const sizeComponent = isOversized ? 3.5 : 0;
  return Number((base + weightComponent + sizeComponent).toFixed(2));
};

const inferSeasonality = (title: string, category: string) => {
  const haystack = `${title} ${category}`.toLowerCase();
  if (/(christmas|holiday|gift|toy|ornament)/.test(haystack)) return ['Q4'];
  if (/(school|notebook|backpack|lunch)/.test(haystack)) return ['Back to School'];
  if (/(beach|outdoor|pool|grill|summer)/.test(haystack)) return ['Summer'];
  return ['Evergreen'];
};

const signRequest = (payload: string, amzDate: string, dateStamp: string) => {
  const signedHeaders = 'content-encoding;content-type;host;x-amz-date;x-amz-target';
  const canonicalHeaders =
    `content-encoding:${CONTENT_ENCODING}\n` +
    `content-type:${CONTENT_TYPE}\n` +
    `host:${config.amazon.host}\n` +
    `x-amz-date:${amzDate}\n` +
    `x-amz-target:${TARGET}\n`;

  const canonicalRequest = ['POST', RESOURCE_PATH, '', canonicalHeaders, signedHeaders, hashHex(payload)].join('\n');
  const credentialScope = `${dateStamp}/${config.amazon.region}/${SERVICE}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, hashHex(canonicalRequest)].join('\n');

  const secretKey = config.amazon.secretKey!;
  const kDate = hmac(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmac(kDate, config.amazon.region);
  const kService = hmac(kRegion, SERVICE);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  return `AWS4-HMAC-SHA256 Credential=${config.amazon.accessKey!}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
};

const mapPaapiItem = (item: any, asin: string): ExternalProductData => {
  const listing =
    item?.Offers?.Listings?.find((candidate: any) => candidate?.IsBuyBoxWinner) ||
    item?.Offers?.Listings?.[0] ||
    null;
  const lowestPrice = item?.Offers?.Summaries?.[0]?.LowestPrice;
  const price = Number(listing?.Price?.Amount || lowestPrice?.Amount || 0);
  const title = getString(item?.ItemInfo?.Title?.DisplayValue) || asin;
  const category =
    getString(item?.ItemInfo?.Classifications?.ProductGroup?.DisplayValue) ||
    getString(item?.ItemInfo?.Classifications?.Binding?.DisplayValue) ||
    'Misc';
  const subCategory = getString(item?.ItemInfo?.Classifications?.Binding?.DisplayValue) || undefined;
  const brand =
    getString(item?.ItemInfo?.ByLineInfo?.Brand?.DisplayValue) ||
    getString(item?.ItemInfo?.ByLineInfo?.Manufacturer?.DisplayValue) ||
    'Unknown';
  const features = Array.isArray(item?.ItemInfo?.Features?.DisplayValues) ? item.ItemInfo.Features.DisplayValues : [];
  const weight =
    getDisplayValue(item?.ItemInfo?.ProductInfo?.ItemDimensions?.Weight) ||
    getDisplayValue(item?.ItemInfo?.ProductInfo?.PackageDimensions?.Weight) ||
    undefined;
  const dimensions =
    formatDimensions(item?.ItemInfo?.ProductInfo?.ItemDimensions) ||
    formatDimensions(item?.ItemInfo?.ProductInfo?.PackageDimensions) ||
    undefined;
  const image =
    getString(item?.Images?.Primary?.Large?.URL) ||
    getString(item?.Images?.Primary?.Medium?.URL) ||
    undefined;
  const bsr = Number(item?.BrowseNodeInfo?.WebsiteSalesRank?.SalesRank || item?.BrowseNodeInfo?.BrowseNodes?.[0]?.SalesRank || 0);
  const sellers = Number(item?.Offers?.Summaries?.[0]?.OfferCount || item?.Offers?.Listings?.length || 0);
  const referralFee = Number((price * getCategoryReferralRate(category)).toFixed(2));
  const isOversized = /oversize|oversized/i.test(dimensions || '');
  const fbaFee = estimateFbaFee(price, weight, isOversized);
  const estimatedSales = bsr > 0 ? Math.max(1, Math.round(300000 / bsr)) : 0;

  return {
    asin,
    title,
    brand,
    category,
    subCategory,
    price,
    bsr,
    estSales: estimatedSales,
    sellers,
    referralFee,
    fbaFee,
    storageFee: 0.55,
    weight,
    dimensions,
    isHazmat: false,
    isIpRisk: false,
    isOversized,
    rating: 0,
    reviews: 0,
    trend: 0,
    description: features.join(' ').trim(),
    seasonalityTags: inferSeasonality(title, category),
    analysis: null,
    priceHistory: [],
    bsrHistory: [],
    image
  };
};

export const amazonPaapiProvider: ProductProvider = {
  fetchProduct: async (asin: string): Promise<ExternalProductData> => {
    if (!config.amazon.enabled) {
      throw new Error('Amazon Product Advertising API is not configured');
    }

    const body = JSON.stringify({
      ItemIds: [asin],
      ItemIdType: 'ASIN',
      LanguagesOfPreference: ['en_US'],
      Marketplace: config.amazon.marketplace,
      OfferCount: 1,
      PartnerTag: config.amazon.partnerTag,
      PartnerType: 'Associates',
      Resources: RESOURCES
    });

    const now = new Date();
    const amzDate = toAmzDate(now);
    const dateStamp = toDateStamp(now);
    const authorization = signRequest(body, amzDate, dateStamp);

    const response = await fetch(`https://${config.amazon.host}${RESOURCE_PATH}`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Encoding': CONTENT_ENCODING,
        'Content-Type': CONTENT_TYPE,
        'X-Amz-Date': amzDate,
        'X-Amz-Target': TARGET
      },
      body
    });

    const rawText = await response.text();
    if (!response.ok) {
      throw new Error(`Amazon PA-API error: ${response.status} ${rawText}`.trim());
    }

    const payload = JSON.parse(rawText) as Record<string, any>;
    const errors = Array.isArray(payload.Errors) ? payload.Errors : [];
    if (errors.length > 0) {
      throw new Error(errors.map((error) => error?.Message || error?.Code || 'Amazon API error').join('; '));
    }

    const item = payload?.ItemResults?.Items?.find((candidate: any) => candidate?.ASIN === asin) || payload?.ItemResults?.Items?.[0];
    if (!item) {
      throw new Error('Amazon API returned no matching item');
    }

    return mapPaapiItem(item, asin);
  }
};
