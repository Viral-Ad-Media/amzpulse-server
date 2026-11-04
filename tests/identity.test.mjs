import test from "node:test";
import assert from "node:assert/strict";
import { embeddedPostgres } from "./helpers/postgres.mjs";
import { createAuth } from "../dist/auth-runtime/index.mjs";
import legacy from "../dist/lib/password.js";
const config = {
  authUrl: "http://localhost:3001",
  authSecret: "test-secret-persistent-longer-than-thirty-two",
  frontendOrigins: ["http://localhost:5173"],
  frontendUrl: "http://localhost:5173",
};
test("Better Auth signup, sessions, password recovery and legacy credentials on PostgreSQL", async (t) => {
  const { db, pool } = await embeddedPostgres();
  const auth = createAuth(pool, config);
  let session, user, resetToken;
  const headers = (token) => new Headers({ authorization: `Bearer ${token}` });
  const originalFetch = globalThis.fetch;
  process.env.RESEND_API_KEY = "test";
  process.env.PASSWORD_RESET_FROM = "test@example.com";
  globalThis.fetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    const link = body.text.match(/https?:\/\/\S+/)[0];
    resetToken = new URLSearchParams(new URL(link).hash.split("?")[1]).get(
      "token",
    );
    return new Response("{}", { status: 200 });
  };
  try {
    await t.test(
      "signup atomically provisions one owner workspace",
      async () => {
        session = await auth.api.signUpEmail({
          body: {
            email: "seller@example.com",
            password: "Strong-password-123!",
            name: "Seller",
          },
        });
        user = session.user;
        assert.ok(session.token);
        assert.equal(user.email, "seller@example.com");
        const rows = (
          await db.query(
            'SELECT m.role FROM "Membership" m JOIN "Organization" o ON o.id=m."organizationId" WHERE m."userId"=$1',
            [user.id],
          )
        ).rows;
        assert.deepEqual(rows, [{ role: "owner" }]);
        await assert.rejects(
          auth.api.signUpEmail({
            body: {
              email: "seller@example.com",
              password: "Strong-password-123!",
              name: "Duplicate",
            },
          }),
        );
        assert.equal(
          (await db.query('SELECT count(*)::int AS n FROM "Organization"'))
            .rows[0].n,
          1,
        );
      },
    );
    await t.test(
      "sessions restore, reject forged tokens, and revoke on sign-out",
      async () => {
        assert.equal(
          (await auth.api.getSession({ headers: headers(session.token) })).user
            .id,
          user.id,
        );
        assert.equal(
          await auth.api.getSession({
            headers: headers(
              "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJsZWdhY3kifQ.invalid",
            ),
          }),
          null,
        );
        await auth.api.signOut({ headers: headers(session.token) });
        assert.equal(
          await auth.api.getSession({ headers: headers(session.token) }),
          null,
        );
        session = await auth.api.signInEmail({
          body: {
            email: "seller@example.com",
            password: "Strong-password-123!",
          },
        });
        await assert.rejects(
          auth.api.signInEmail({
            body: { email: "seller@example.com", password: "wrong-password" },
          }),
        );
      },
    );
    await t.test(
      "reset tokens are consumed once and revoke all sessions and API keys",
      async () => {
        const org = (
          await db.query(
            'SELECT "organizationId" FROM "Membership" WHERE "userId"=$1',
            [user.id],
          )
        ).rows[0].organizationId;
        await db.query(
          'INSERT INTO "ApiKey"("keyHash","userId","organizationId") VALUES($1,$2,$3)',
          ["hash", user.id, org],
        );
        const response = await auth.api.requestPasswordReset({
          body: {
            email: user.email,
            redirectTo: "http://localhost:5173/#/reset-password",
          },
        });
        assert.equal(response.token, undefined);
        assert.ok(resetToken);
        await auth.api.resetPassword({
          body: { token: resetToken, newPassword: "Replacement-password-123!" },
        });
        assert.equal(
          await auth.api.getSession({ headers: headers(session.token) }),
          null,
        );
        assert.equal(
          (
            await db.query('SELECT revoked FROM "ApiKey" WHERE "userId"=$1', [
              user.id,
            ])
          ).rows[0].revoked,
          true,
        );
        await assert.rejects(
          auth.api.resetPassword({
            body: { token: resetToken, newPassword: "Another-password-123!" },
          }),
        );
        await assert.rejects(
          auth.api.signInEmail({
            body: { email: user.email, password: "Strong-password-123!" },
          }),
        );
        assert.ok(
          (
            await auth.api.signInEmail({
              body: {
                email: user.email,
                password: "Replacement-password-123!",
              },
            })
          ).token,
        );
      },
    );
    await t.test(
      "imported scrypt credentials retain account IDs without trusting malformed hashes",
      async () => {
        const hash = await legacy.hashPassword("Legacy-password-123!");
        const imported = (
          await db.query("SELECT register_account($1,$2,$3) AS result", [
            "legacy@example.com",
            "Legacy",
            hash,
          ])
        ).rows[0].result.user;
        await db.query(
          'INSERT INTO "AuthAccount"(id,"accountId","providerId","userId",password,"updatedAt") VALUES(gen_random_uuid()::text,$1,\'credential\',$1,$2,now())',
          [imported.id, hash],
        );
        const login = await auth.api.signInEmail({
          body: { email: imported.email, password: "Legacy-password-123!" },
        });
        assert.equal(login.user.id, imported.id);
        for (const hash of ["scrypt:nothex:nothex", "scrypt:aa:bb"])
          assert.equal(await legacy.verifyPassword("anything", hash), false);
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
    await pool.end();
  }
});
