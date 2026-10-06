import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import request from "supertest";
const require = createRequire(import.meta.url);
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-persistent-secret-with-at-least-32-characters";
delete process.env.REDIS_URL;
delete process.env.PROVIDER_BASE_URL;
let missingMember = false,
  version = 0,
  queryError = false,
  quotaError = false;
let rpcCalls = [],
  queries = [];
const product = {
  asin: "B08N5WRWNW",
  id: "B08N5WRWNW",
  name: "Test product",
  price: 20,
  bsr: 10,
  priceHistory: [{ date: "2026-01-01", price: 20 }],
  bsrHistory: [],
  riskDataAvailable: false,
  referralFee: null,
  fbaFee: null,
  storageFee: null,
};
const db = {
  from(table) {
    const record = { table, filters: [], mutation: null };
    queries.push(record);
    const builder = {};
    for (const op of [
      "select",
      "eq",
      "in",
      "or",
      "order",
      "limit",
      "single",
      "maybeSingle",
      "insert",
      "update",
      "upsert",
      "delete",
      "lt",
    ])
      builder[op] = (...args) => {
        if (["eq", "in"].includes(op)) record.filters.push(args);
        if (["insert", "update", "upsert", "delete"].includes(op))
          record.mutation = op;
        return builder;
      };
    builder.then = (resolve, reject) => {
      let data = null;
      if (table === "User")
        data = {
          id: "user1",
          email: "test@example.com",
          tokenVersion: version,
        };
      if (table === "Membership")
        data = missingMember ? null : { role: "owner", organizationId: "org1" };
      if (table === "Organization")
        data = { id: "org1", plan: "free", planRenewsAt: null };
      if (table === "OrganizationUsage")
        data = { asinsAnalyzed: 0, aiCalls: 0 };
      if (table === "Product")
        data = {
          asin: product.asin,
          canonicalData: product,
          updatedAt: new Date().toISOString(),
        };
      if (table === "ApiKey")
        data = { id: "key1", userId: "user1", organizationId: "org1" };
      if (table === "WatchlistItem") data = [];
      return Promise.resolve({
        data,
        error: queryError ? { message: "database unavailable" } : null,
      }).then(resolve, reject);
    };
    return builder;
  },
  async rpc(name, args) {
    rpcCalls.push({ name, args });
    return {
      data: name === "reserve_usage" ? args.p_id : true,
      error: quotaError
        ? { code: "P0001", message: "Monthly quota exceeded" }
        : null,
    };
  },
};
const modulePath = require.resolve("../dist/providers/supabase.js");
require.cache[modulePath] = {
  id: modulePath,
  filename: modulePath,
  loaded: true,
  exports: {
    __esModule: true,
    default: db,
    supabase: db,
    throwIfError: ({ data, error }) => {
      if (error) throw error;
      return data;
    },
    requireData: ({ data, error }) => {
      if (error) throw error;
      if (data == null) throw Error("No data");
      return data;
    },
  },
};
const app = require("../dist/app.js").default;
const { signJwt } = require("../dist/lib/jwt.js");
const {
  subscriptionEntitled,
  effectivePlan,
} = require("../dist/services/billingService.js");
const token = signJwt(
  { sub: "user1", orgId: "org1", version: 0 },
  process.env.JWT_SECRET,
  3600,
);
const authorized = (method, path) =>
  request(app)[method](path).set("Authorization", `Bearer ${token}`);

test("HTTP auth, isolation, metering and async failure handling", async (t) => {
  await t.test(
    "all costly routes require authentication before provider or quota work",
    async () => {
      for (const [method, path, body] of [
        ["get", "/api/products/B08N5WRWNW"],
        ["get", "/api/products/trending"],
        ["get", "/api/products/bestsellers"],
        ["post", "/api/batch/analyze", { asins: ["B08N5WRWNW"] }],
        ["post", "/api/analysis/product", { product }],
      ]) {
        const response = await request(app)[method](path).send(body);
        assert.equal(response.status, 401);
      }
      assert.equal(rpcCalls.length, 0);
      assert.equal(queries.length, 0);
    },
  );
  await t.test("invalid ASINs and batches do not debit usage", async () => {
    for (const body of [
      { asins: [] },
      { asins: ["invalid"] },
      { asins: ["B08N5WRWNW", 123] },
    ])
      assert.equal(
        (await authorized("post", "/api/batch/analyze").send(body)).status,
        400,
      );
    assert.equal(
      (await authorized("get", "/api/products/not-an-asin")).status,
      400,
    );
    assert.equal(rpcCalls.length, 0);
  });
  await t.test("password reset invalidates existing JWTs", async () => {
    version = 1;
    assert.equal((await authorized("get", "/api/auth/me")).status, 401);
    version = 0;
  });
  await t.test("membership removal rejects both JWT and API key", async () => {
    missingMember = true;
    assert.equal((await authorized("get", "/api/auth/me")).status, 401);
    assert.equal(
      (
        await request(app)
          .get("/api/auth/me")
          .set("X-API-Key", "ak_" + "a".repeat(48))
      ).status,
      401,
    );
    missingMember = false;
  });
  await t.test("live role wins over JWT role claim", async () => {
    const other = signJwt(
      { sub: "user1", orgId: "org1", version: 0, role: "member" },
      process.env.JWT_SECRET,
      3600,
    );
    const response = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${other}`);
    assert.equal(response.body.role, "owner");
  });
  await t.test(
    "single lookup and history reserve and settle successful usage",
    async () => {
      rpcCalls = [];
      const response = await authorized("get", "/api/products/B08N5WRWNW");
      assert.equal(response.status, 200);
      assert.equal(response.body.referralFee, null);
      assert.equal(response.body.riskDataAvailable, false);
      assert.deepEqual(
        rpcCalls.map((r) => r.name),
        ["reserve_usage", "settle_usage"],
      );
      assert.equal(rpcCalls[1].args.p_success, 1);
      const history = await authorized(
        "get",
        "/api/products/B08N5WRWNW/history",
      );
      assert.deepEqual(history.body, {
        priceHistory: product.priceHistory,
        bsrHistory: [],
      });
    },
  );
  await t.test(
    "batch duplicates are billed once and results are discriminated",
    async () => {
      rpcCalls = [];
      const response = await authorized("post", "/api/batch/analyze").send({
        asins: ["b08n5wrwnw", "B08N5WRWNW"],
      });
      assert.equal(response.status, 200);
      assert.equal(response.body.length, 1);
      assert.equal(response.body[0].ok, true);
      assert.equal(rpcCalls[0].args.p_units, 1);
    },
  );
  await t.test("quota rejection stops work", async () => {
    quotaError = true;
    rpcCalls = [];
    const response = await authorized("get", "/api/products/B08N5WRWNW");
    assert.equal(response.status, 402);
    assert.equal(rpcCalls.length, 1);
    quotaError = false;
  });
  await t.test(
    "AI unavailable is refunded and does not invent an analysis",
    async () => {
      delete process.env.GEMINI_API_KEY;
      rpcCalls = [];
      const response = await authorized("post", "/api/analysis/product").send({
        product,
      });
      assert.equal(response.status, 500);
      assert.equal(response.body.grade, undefined);
      assert.equal(rpcCalls.at(-1).args.p_success, 0);
    },
  );
  await t.test(
    "watchlist delete keeps tenant filter and no raw PostgREST expression",
    async () => {
      queries = [];
      assert.equal(
        (await authorized("delete", "/api/watchlist/other-tenant-id")).status,
        204,
      );
      const mutation = queries.find(
        (q) => q.table === "WatchlistItem" && q.mutation === "delete",
      );
      assert.deepEqual(mutation.filters, [
        ["organizationId", "org1"],
        ["id", "other-tenant-id"],
      ]);
    },
  );
  await t.test(
    "revoke API key is scoped to both user and organization",
    async () => {
      queries = [];
      assert.equal(
        (await authorized("delete", "/api/auth/api-keys/key2")).status,
        204,
      );
      assert.deepEqual(queries.find((q) => q.table === "ApiKey").filters, [
        ["id", "key2"],
        ["userId", "user1"],
        ["organizationId", "org1"],
      ]);
    },
  );
  await t.test(
    "database exceptions reach Express error handler without process crash",
    async () => {
      queryError = true;
      const response = await authorized("get", "/api/watchlist");
      assert.equal(response.status, 500);
      assert.equal(
        response.body.error,
        "Service unavailable. Try again later.",
      );
      queryError = false;
      assert.equal((await request(app).get("/health")).status, 200);
    },
  );
  await t.test(
    "password recovery never returns reset credentials",
    async () => {
      process.env.RESEND_API_KEY = "test";
      process.env.PASSWORD_RESET_FROM = "test@example.com";
      const original = globalThis.fetch;
      globalThis.fetch = async () => new Response("{}", { status: 200 });
      try {
        const response = await request(app)
          .post("/api/auth/forgot-password")
          .send({ email: "test@example.com" });
        assert.equal(response.status, 200);
        assert.deepEqual(Object.keys(response.body), ["message"]);
      } finally {
        globalThis.fetch = original;
        delete process.env.RESEND_API_KEY;
        delete process.env.PASSWORD_RESET_FROM;
      }
    },
  );
  await t.test("malformed JSON and oversized bodies are rejected", async () => {
    assert.equal(
      (
        await request(app)
          .post("/api/auth/login")
          .set("Content-Type", "application/json")
          .send("{")
      ).status,
      400,
    );
    assert.equal(
      (
        await request(app)
          .post("/api/auth/login")
          .send({ email: "x".repeat(70000) })
      ).status,
      413,
    );
  });
  await t.test(
    "unpaid, expired or wrong-price subscriptions never grant pro",
    () => {
      const good = {
        status: "active",
        items: { data: [{ price: { id: "price_pro" } }] },
        current_period_end: Date.now() / 1000 + 86400,
      };
      assert.equal(subscriptionEntitled(good, "price_pro"), true);
      for (const status of ["incomplete", "past_due", "unpaid", "canceled"])
        assert.equal(
          subscriptionEntitled({ ...good, status }, "price_pro"),
          false,
        );
      assert.equal(subscriptionEntitled(good, "price_other"), false);
      assert.equal(
        subscriptionEntitled({ ...good, current_period_end: 1 }, "price_pro"),
        false,
      );
      assert.equal(effectivePlan({ plan: "pro", planRenewsAt: null }), "free");
    },
  );
});
