import { config } from "../config";
const number = (value: unknown, fallback: number | null = 0) => {
  const parsed =
    typeof value === "string" && value.trim() ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : fallback;
};
// Operator-configured HTTP adapter. Optional fees and risks remain unavailable.
export const realProvider = {
  async fetchProduct(asin: string): Promise<any> {
    if (!config.provider.baseUrl)
      throw new Error("Provider base URL not configured");
    const response = await fetch(
      `${config.provider.baseUrl.replace(/\/$/, "")}/products/${encodeURIComponent(asin)}`,
      {
        signal: AbortSignal.timeout(12000),
        redirect: "error",
        headers: {
          Accept: "application/json",
          ...(config.provider.apiKey
            ? { Authorization: `Bearer ${config.provider.apiKey}` }
            : {}),
        },
      },
    );
    if (!response.ok)
      throw new Error(`Provider request failed (${response.status})`);
    const data = (await response.json()) as any;
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new Error("Invalid provider response");
    if (data.currency && data.currency !== "USD")
      throw new Error("AmzPulse currently supports USD");
    return {
      ...data,
      asin,
      title: data.title || data.name || asin,
      name: data.name || data.title || asin,
      price: number(data.price ?? data.currentPrice),
      bsr: number(data.bsr ?? data.rank),
      sellers: number(data.sellers ?? data.offerCount),
      estSales: number(data.estSales ?? data.estimatedSales, null),
      referralFee: number(data.referralFee, null),
      fbaFee: number(data.fbaFee, null),
      storageFee: number(data.storageFee, null),
      riskDataAvailable: data.riskDataAvailable === true,
      isEstimatedSales: data.isEstimatedSales === true,
      dataSource: data.dataSource || "configured-provider",
      lastSyncedAt: data.lastSyncedAt || new Date().toISOString(),
    };
  },
};
