import path from "path";
import { pathToFileURL } from "url";
// Preserve native import in the CommonJS build; provider adapters are server-only ESM.
const nativeImport = new Function("url", "return import(url)") as (
  url: string,
) => Promise<any>;
export const productApi = () =>
  nativeImport(
    pathToFileURL(path.join(__dirname, "../product-api/amazonProvider.mjs"))
      .href,
  );
export const aiApi = () =>
  nativeImport(
    pathToFileURL(path.join(__dirname, "../product-api/geminiProvider.mjs"))
      .href,
  );
