export const normalizeAsin = (value: unknown) => {
  if (typeof value !== "string" || !/^[A-Z0-9]{10}$/i.test(value.trim()))
    throw new Error("Invalid ASIN");
  return value.trim().toUpperCase();
};
export const validateBatch = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100)
    throw new Error("Provide between 1 and 100 ASINs");
  return [...new Set(value.map(normalizeAsin))];
};
