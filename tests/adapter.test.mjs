import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { embeddedPostgres } from "./helpers/postgres.mjs";
const require = createRequire(import.meta.url);
const {
  default: database,
  pool,
  requireData,
  throwIfError,
} = require("../dist/providers/database.js");
test("parameterized Postgres adapter preserves CRUD, tenant filters, JSON, upserts and quota functions", async () => {
  const { db, pool: embedded } = await embeddedPostgres();
  const original = pool.query;
  pool.query = embedded.query;
  try {
    const result = requireData(
      await database.rpc("register_account", {
        p_email: "sql@example.com",
        p_name: "SQL",
        p_hash: "hash",
      }),
    );
    const org = result.organization.id,
      user = result.user.id;
    const selected = requireData(
      await database.from("User").select("id,email").eq("id", user).single(),
    );
    assert.equal(selected.email, "sql@example.com");
    assert.equal(
      throwIfError(
        await database
          .from("User")
          .select()
          .eq("email", "' OR 1=1 --")
          .maybeSingle(),
      ),
      null,
    );
    assert.equal(
      (await database.from("User").select().eq("email", "' OR 1=1 --").single())
        .error.message,
      "Unexpected database result count",
    );
    const product = {
      asin: "B08N5WRWNW",
      title: "test",
      image: "",
      category: "Amazon",
      currentPrice: 20,
      currentBsr: 10,
      estSales: 0,
      sellers: 1,
      referralFee: 0,
      fbaFee: 0,
      canonicalData: { price: 20, referralFee: null },
    };
    requireData(
      await database
        .from("Product")
        .upsert(product, { onConflict: "asin" })
        .select()
        .single(),
    );
    requireData(
      await database
        .from("Product")
        .upsert({ ...product, title: "updated" }, { onConflict: "asin" }),
    );
    requireData(
      await database
        .from("Product")
        .upsert(
          { ...product, title: "ignored" },
          { onConflict: "asin", ignoreDuplicates: true },
        ),
    );
    const rows = requireData(
      await database
        .from("Product")
        .select("title,canonicalData")
        .in("asin", [product.asin]),
    );
    assert.equal(rows[0].title, "updated");
    assert.equal(rows[0].canonicalData.referralFee, null);
    const item = requireData(
      await database
        .from("WatchlistItem")
        .upsert(
          { productId: product.asin, userId: user, organizationId: org },
          { onConflict: "organizationId,productId" },
        )
        .select()
        .single(),
    );
    throwIfError(
      await database
        .from("WatchlistItem")
        .update({ notes: "parameter value" })
        .eq("id", item.id)
        .eq("organizationId", org),
    );
    throwIfError(
      await database
        .from("WatchlistItem")
        .delete()
        .eq("id", item.id)
        .eq("organizationId", "other-org"),
    );
    assert.equal(
      requireData(
        await database
          .from("WatchlistItem")
          .select()
          .eq("id", item.id)
          .single(),
      ).notes,
      "parameter value",
    );
    requireData(
      await database
        .from("ApiKey")
        .insert({ keyHash: "key", userId: user, organizationId: org }),
    );
    assert.equal(
      requireData(
        await database
          .from("ApiKey")
          .select()
          .eq("keyHash", "key")
          .or(`expiresAt.is.null,expiresAt.gt.${new Date().toISOString()}`),
      ).length,
      1,
    );
    const id = requireData(
      await database.rpc("reserve_usage", {
        p_org: org,
        p_units: 1,
        p_kind: "asin",
        p_id: crypto.randomUUID(),
        p_batch: false,
      }),
    );
    assert.ok(
      requireData(
        await database.rpc("settle_usage", { p_id: id, p_success: 0 }),
      ),
    );
    assert.equal(
      (await database.from("User").delete()).error.message,
      "Unfiltered delete is forbidden",
    );
    assert.throws(() => database.from("User; DROP TABLE User"));
    assert.throws(() => database.from("User").eq('id" OR true --', "x"));
  } finally {
    pool.query = original;
    await embedded.end();
    await pool.end();
  }
});
