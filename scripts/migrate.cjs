const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
require("dotenv").config();
const { Client } = require("pg");
async function migrate() {
  const connectionString =
    process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!connectionString) throw Error("DATABASE_URL_UNPOOLED is required");
  if (new URL(connectionString).hostname.includes("-pooler"))
    throw Error("Use the direct DATABASE_URL_UNPOOLED for migrations");
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 10000,
    statement_timeout: 120000,
  });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock(43710582)");
    await client.query(
      'CREATE TABLE IF NOT EXISTS public."SchemaMigration" (name text PRIMARY KEY, checksum text NOT NULL, "appliedAt" timestamptz NOT NULL DEFAULT now())',
    );
    for (const name of fs
      .readdirSync(path.join(__dirname, "../migrations"))
      .filter((n) => n.endsWith(".sql"))
      .sort()) {
      const sql = fs.readFileSync(
        path.join(__dirname, "../migrations", name),
        "utf8",
      );
      const checksum = crypto.createHash("sha256").update(sql).digest("hex");
      const { rows } = await client.query(
        'SELECT checksum FROM public."SchemaMigration" WHERE name=$1',
        [name],
      );
      if (rows.length) {
        if (rows[0].checksum !== checksum)
          throw Error(`Migration checksum changed: ${name}`);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO public."SchemaMigration"(name,checksum) VALUES($1,$2)',
          [name, checksum],
        );
        await client.query("COMMIT");
        console.log(`Applied ${name}`);
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(43710582)").catch(() => {});
    await client.end();
  }
}
migrate().catch((e) => {
  console.error(
    "Migration failed:",
    e.code || e.name,
    e.message.replace(/postgres(?:ql)?:\/\/\S+/g, "[redacted]"),
  );
  process.exitCode = 1;
});
