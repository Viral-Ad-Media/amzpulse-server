import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

// Actual migrations in embedded PostgreSQL. UUID generation is built in;
// omit only the unavailable pgcrypto extension declaration.
test("database access, registration/reset transactions, quotas and webhook ordering", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;",
    );
    for (const filename of (
      await readdir(new URL("../supabase/migrations/", import.meta.url))
    ).sort()) {
      const sql = await readFile(
        new URL("../supabase/migrations/" + filename, import.meta.url),
        "utf8",
      );
      await db.exec(
        sql.replace('CREATE EXTENSION IF NOT EXISTS "pgcrypto";', ""),
      );
    }
    const query = async (sql, args = []) => (await db.query(sql, args)).rows;
    const registered = (
      await query("SELECT register_account($1,$2,$3) AS result", [
        "seller@example.com",
        "Seller",
        "hash",
      ])
    )[0].result;
    const org = registered.organization.id,
      user = registered.user.id;
    assert.equal(registered.user.passwordHash, undefined);
    assert.equal(registered.user.tokenVersion, 0);
    await assert.rejects(
      query("SELECT register_account($1,$2,$3)", [
        "seller@example.com",
        "Duplicate",
        "hash",
      ]),
    );
    assert.equal(
      (await query('SELECT count(*)::int AS n FROM "Organization"'))[0].n,
      1,
      "failed signup rolls back organization",
    );
    const tables = await query(
      "SELECT relname,relrowsecurity FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r'",
    );
    assert.equal(tables.length, 11);
    assert.ok(tables.every((t) => t.relrowsecurity));
    for (const role of ["anon", "authenticated"]) {
      for (const table of tables)
        assert.equal(
          (
            await query("SELECT has_table_privilege($1,$2,$3) AS allowed", [
              role,
              'public."' + table.relname + '"',
              "SELECT",
            ])
          )[0].allowed,
          false,
        );
      assert.equal(
        (
          await query(
            "SELECT has_function_privilege($1,'register_account(text,text,text)','EXECUTE') AS allowed",
            [role],
          )
        )[0].allowed,
        false,
      );
    }
    await db.exec("SET ROLE anon");
    await assert.rejects(query('SELECT * FROM "User"'), /permission denied/);
    await assert.rejects(
      query(
        "SELECT register_account('attacker@example.com','attacker','hash')",
      ),
      /permission denied/,
    );
    await db.exec("RESET ROLE; SET ROLE service_role");
    const reserve = (units, kind = "asin", id = randomUUID()) =>
      query("SELECT reserve_usage($1,$2,$3,$4)", [org, units, kind, id]);
    const settle = (id, success) =>
      query("SELECT settle_usage($1,$2) AS settled", [id, success]);
    for (let i = 0; i < 14; i++) {
      const id = randomUUID();
      await reserve(20, "asin", id);
      await settle(id, 20);
    }
    const concurrentIds = [randomUUID(), randomUUID(), randomUUID()];
    const outcomes = await Promise.allSettled(
      concurrentIds.map((id) => reserve(20, "asin", id)),
    );
    assert.equal(
      outcomes.filter((x) => x.status === "fulfilled").length,
      1,
      "competing reservations cannot exceed quota",
    );
    let row = (
      await query(
        'SELECT * FROM "OrganizationUsage" WHERE "organizationId"=$1',
        [org],
      )
    )[0];
    assert.equal(row.asinsAnalyzed, 300);
    const winning =
      concurrentIds[outcomes.findIndex((x) => x.status === "fulfilled")];
    assert.equal((await settle(winning, 5))[0].settled, true);
    assert.equal(
      (await settle(winning, 5))[0].settled,
      false,
      "retry does not double-refund",
    );
    const expired = randomUUID();
    await reserve(10, "asin", expired);
    await query(
      'UPDATE "UsageReservation" SET "expiresAt"=now()-interval \'1 minute\' WHERE id=$1',
      [expired],
    );
    const next = randomUUID();
    await reserve(15, "asin", next);
    row = (
      await query(
        'SELECT * FROM "OrganizationUsage" WHERE "organizationId"=$1',
        [org],
      )
    )[0];
    assert.equal(row.asinsAnalyzed, 300, "recover expired reservations");
    assert.equal(
      (await settle(expired, 10))[0].settled,
      false,
      "late worker cannot charge again",
    );
    await settle(next, 0);
    await assert.rejects(reserve(21), /Batch size/);
    const batchId = randomUUID();
    await query("SELECT reserve_usage($1,1,'asin',$2,true)", [org, batchId]);
    await settle(batchId, 1);
    assert.equal(
      (
        await query(
          'SELECT "batchRuns" FROM "OrganizationUsage" WHERE "organizationId"=$1',
          [org],
        )
      )[0].batchRuns,
      1,
    );
    await query(
      'UPDATE "Organization" SET plan=\'pro\',"planRenewsAt"=NULL WHERE id=$1',
      [org],
    );
    await assert.rejects(reserve(21), /Batch size/);

    for (let i = 0; i < 50; i++) {
      const id = randomUUID();
      await reserve(1, "ai", id);
      await settle(id, 1);
    }
    await assert.rejects(reserve(1, "ai"), /quota/);
    await query(
      'INSERT INTO "ApiKey"("keyHash","userId","organizationId") VALUES($1,$2,$3)',
      ["keyhash", user, org],
    );
    await query(
      'INSERT INTO "PasswordResetToken"("userId","tokenHash","expiresAt") VALUES($1,$2,now()+interval \'1 hour\')',
      [user, "reset-hash"],
    );
    const resets = await Promise.all([
      query("SELECT reset_account_password($1,$2) AS ok", [
        "reset-hash",
        "newhash",
      ]),
      query("SELECT reset_account_password($1,$2) AS ok", [
        "reset-hash",
        "otherhash",
      ]),
    ]);
    assert.equal(resets.flat().filter((r) => r.ok).length, 1);
    assert.equal(
      (await query('SELECT "tokenVersion" FROM "User" WHERE id=$1', [user]))[0]
        .tokenVersion,
      1,
    );
    assert.equal(
      (await query('SELECT revoked FROM "ApiKey"'))[0].revoked,
      true,
    );
    await query(
      'UPDATE "Organization" SET "stripeCustomerId"=\'cus_test\' WHERE id=$1',
      [org],
    );
    const apply = (
      event,
      created,
      sub = "sub_current",
      deleted = false,
      customer = "cus_test",
    ) =>
      query(
        "SELECT apply_subscription($1,$2,$3,$4,now()+interval '1 month',$5,$6,$7) AS applied",
        [org, customer, sub, "pro", created, event, deleted],
      );
    assert.equal((await apply("evt_new", 200))[0].applied, true);
    assert.equal((await apply("evt_new", 200))[0].applied, false);
    assert.equal((await apply("evt_old", 100))[0].applied, false);
    assert.equal(
      (await apply("evt_old_delete", 300, "sub_obsolete", true))[0].applied,
      false,
    );
    await assert.rejects(
      apply("evt_wrong", 400, "sub_current", false, "cus_other"),
      /Customer mismatch/,
    );
  } finally {
    await db.close();
  }
});
