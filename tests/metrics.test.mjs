import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
process.env.NODE_ENV = "test";
process.env.REDIS_URL = "redis://localhost:6379";
delete process.env.DATABASE_URL;
let tick,
  busy = false,
  calls = [],
  order = [],
  attempted = [];
const inject = (path, exports) => {
  const id = require.resolve(path);
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
inject("node-cron", {
  __esModule: true,
  default: {
    validate: () => true,
    schedule: (_cron, callback) => {
      tick = callback;
      return {};
    },
  },
});
const redis = { set: async () => (busy ? null : "OK"), eval: async () => 1 };
inject("../dist/providers/redis.js", { ensureRedis: async () => redis });
inject("../dist/services/productService.js", {
  getProductOrFetch: async (asin, force) => {
    calls.push({ asin, force });
    if (asin === "B08N5WRWNW") throw Error("upstream unavailable");
  },
});
const db = {
  from(table) {
    let operation = "read",
      id;
    const q = {
      select: () => q,
      order: (column) => {
        order.push(column);
        return q;
      },
      limit: () => q,
      update: (payload) => {
        operation = "update";
        return q;
      },
      delete: () => {
        operation = "delete";
        return q;
      },
      lt: () => q,
      eq: (_column, value) => {
        id = value;
        return q;
      },
      then: (resolve, reject) => {
        if (operation === "update") attempted.push(id);
        return Promise.resolve({
          data:
            table === "Product" && operation === "read"
              ? [{ asin: "B08N5WRWNW" }, { asin: "B07FZ8S74R" }]
              : null,
          error: null,
        }).then(resolve, reject);
      },
    };
    return q;
  },
};
inject("../dist/providers/supabase.js", {
  __esModule: true,
  default: db,
  throwIfError: ({ data, error }) => {
    if (error) throw error;
    return data;
  },
});
const { startMetricsSync } = require("../dist/jobs/metricsSync.js");
test("Supabase sync needs no DATABASE_URL, rotates failed attempts and honors shared lock", async () => {
  startMetricsSync();
  await tick();
  assert.deepEqual(order.slice(0, 2), ["syncAttemptedAt", "asin"]);
  assert.deepEqual(attempted, ["B08N5WRWNW", "B07FZ8S74R"]);
  assert.deepEqual(calls, [
    { asin: "B08N5WRWNW", force: true },
    { asin: "B07FZ8S74R", force: true },
  ]);
  busy = true;
  await tick();
  assert.equal(calls.length, 2, "other worker owns lock");
});
