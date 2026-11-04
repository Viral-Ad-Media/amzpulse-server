import test from "node:test";
import assert from "node:assert/strict";
import transfer from "../scripts/legacy-transfer.cjs";
import { embeddedPostgres } from "./helpers/postgres.mjs";
import { createAuth } from "../dist/auth-runtime/index.mjs";
import legacy from "../dist/lib/password.js";
test("legacy import keeps IDs, billing and membership without creating duplicate workspaces", async () => {
  const { db, pool } = await embeddedPostgres();
  try {
    const data = {
      format: "amzpulse-legacy-v1",
      tables: {
        Organization: [
          {
            id: "legacy-org",
            name: "Existing",
            plan: "pro",
            stripeCustomerId: "cus_existing",
            stripeSubscriptionId: "sub_existing",
            planRenewsAt: "2030-01-01",
          },
        ],
        User: [
          {
            id: "legacy-user",
            email: "existing@example.com",
            name: null,
            passwordHash: await legacy.hashPassword("Existing123!"),
          },
        ],
        Membership: [
          {
            id: "legacy-member",
            userId: "legacy-user",
            organizationId: "legacy-org",
            role: "owner",
          },
        ],
        Product: [],
        ApiKey: [],
        OrganizationUsage: [
          {
            id: "legacy-usage",
            organizationId: "legacy-org",
            month: "2026-11",
            asinsAnalyzed: 123,
            aiCalls: 5,
          },
        ],
        ProductMetric: [],
        WatchlistItem: [],
        SourcingNote: [],
        UsageReservation: [],
      },
    };
    const broken = structuredClone(data);
    broken.tables.Membership = [];
    await assert.rejects(
      transfer.importLegacy(pool, broken),
      /without memberships/,
    );
    assert.equal(
      (await db.query('SELECT count(*)::int AS n FROM "User"')).rows[0].n,
      0,
    );
    await transfer.importLegacy(pool, data);
    assert.equal(
      (await db.query('SELECT count(*)::int AS n FROM "Organization"')).rows[0]
        .n,
      1,
    );
    const org = (await db.query('SELECT * FROM "Organization"')).rows[0];
    assert.equal(org.id, "legacy-org");
    assert.equal(org.stripeCustomerId, "cus_existing");
    assert.equal(org.plan, "pro");
    assert.equal(
      (await db.query('SELECT "asinsAnalyzed" FROM "OrganizationUsage"'))
        .rows[0].asinsAnalyzed,
      123,
    );
    const auth = createAuth(pool, {
      authUrl: "http://localhost:3001",
      authSecret: "import-test-secret-longer-than-thirty-two-characters",
      frontendOrigins: ["http://localhost:5173"],
      frontendUrl: "http://localhost:5173",
    });
    const signed = await auth.api.signInEmail({
      body: { email: "existing@example.com", password: "Existing123!" },
    });
    assert.equal(signed.user.id, "legacy-user");
    assert.ok(signed.token);
    await assert.rejects(transfer.importLegacy(pool, data), /must be empty/);
  } finally {
    await pool.end();
  }
});
