import path from "path";
import { pathToFileURL } from "url";
import { config } from "../config";
import { pool } from "../providers/database";
const nativeImport = new Function("url", "return import(url)") as (
  url: string,
) => Promise<any>;
let auth: Promise<any> | undefined;
export const identity = () =>
  (auth ||= nativeImport(
    pathToFileURL(path.join(__dirname, "../auth-runtime/index.mjs")).href,
  ).then((module) => module.createAuth(pool, config)));
export const identityHeaders = (authorization?: string) =>
  new Headers(authorization ? { authorization } : {});
