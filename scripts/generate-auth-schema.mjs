import { getMigrations } from "better-auth/db/migration";
import { createAuth } from "../dist/auth-runtime/index.mjs";
import { embeddedPostgres } from "../tests/helpers/postgres.mjs";
import { writeFile } from "node:fs/promises";
const { pool } = await embeddedPostgres(3);
const auth = createAuth(pool, {
  authUrl: "http://localhost:3001",
  authSecret: "local-schema-generation-secret-longer-than-32",
  frontendOrigins: ["http://localhost:5173"],
  frontendUrl: "http://localhost:5173",
});
try {
  const migrations = await getMigrations(auth.options);
  const sql = await migrations.compileMigrations();
  await writeFile(
    new URL("../migrations/004_better_auth.sql", import.meta.url),
    sql + "\n",
  );
  console.log("Generated Better Auth migration");
} finally {
  await pool.end();
}
