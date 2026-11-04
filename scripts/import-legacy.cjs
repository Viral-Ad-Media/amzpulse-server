const fs = require("fs");
const { Client } = require("pg");
const { importLegacy } = require("./legacy-transfer.cjs");
require("dotenv").config();
(async () => {
  const file = process.argv[2];
  if (!file) throw Error("A private legacy export path is required");
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const connectionString = process.env.DATABASE_URL_UNPOOLED;
  if (
    !connectionString ||
    new URL(connectionString).hostname.includes("-pooler")
  )
    throw Error("Direct DATABASE_URL_UNPOOLED required");
  const db = new Client({ connectionString, connectionTimeoutMillis: 10000 });
  await db.connect();
  try {
    await importLegacy(db, data);
  } finally {
    await db.end();
  }
})().catch((e) => {
  console.error("Import failed:", e.code || e.name);
  process.exitCode = 1;
});
