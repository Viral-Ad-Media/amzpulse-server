import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createRequire } from "node:module";
import { embeddedPostgres } from "./helpers/postgres.mjs";
const require = createRequire(import.meta.url);
process.env.NODE_ENV = "test";
delete process.env.REDIS_URL;
process.env.BETTER_AUTH_SECRET =
  "http-test-secret-longer-than-thirty-two-characters";
process.env.BETTER_AUTH_URL = "http://localhost:3001";
const { pool } = require("../dist/providers/database.js");
const app = require("../dist/app.js").default;
test("real HTTP signup/login/me/logout and tenant authorization use Better Auth plus PostgreSQL", async () => {
  const { pool: embedded } = await embeddedPostgres();
  pool.query = embedded.query;
  pool.connect = embedded.connect;
  try {
    const signed = await request(app)
      .post("/api/auth/register")
      .send({
        email: "http@example.com",
        name: "HTTP",
        password: "Strong-password-123!",
      });
    assert.equal(signed.status, 201);
    assert.ok(signed.body.token);
    assert.equal(signed.body.role, "owner");
    assert.ok(signed.body.organizationId);
    const token = signed.body.token;
    const profile = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);
    assert.equal(profile.status, 200);
    assert.equal(profile.body.user.id, signed.body.user.id);
    assert.equal(profile.body.organizationId, signed.body.organizationId);
    const logout = await request(app)
      .post("/api/auth/logout")
      .set("Authorization", `Bearer ${token}`);
    assert.equal(logout.status, 204);
    assert.equal(
      (
        await request(app)
          .get("/api/auth/me")
          .set("Authorization", `Bearer ${token}`)
      ).status,
      401,
    );
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "http@example.com", password: "Strong-password-123!" });
    assert.equal(login.status, 200);
    const headers = { Authorization: `Bearer ${login.body.token}` };
    assert.equal(
      (await request(app).get("/api/watchlist").set(headers)).status,
      200,
    );
    await embedded.query('DELETE FROM "Membership" WHERE "userId"=$1', [
      signed.body.user.id,
    ]);
    assert.equal(
      (await request(app).get("/api/watchlist").set(headers)).status,
      401,
    );
  } finally {
    await embedded.end();
    await pool.end();
  }
});
