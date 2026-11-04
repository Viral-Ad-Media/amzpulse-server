const fs = require("fs");
const { Client } = require("pg");
require("dotenv").config();
const tables = [
  "Organization",
  "User",
  "Membership",
  "Product",
  "ApiKey",
  "OrganizationUsage",
  "ProductMetric",
  "WatchlistItem",
  "SourcingNote",
  "UsageReservation",
];
(async () => {
  const file = process.argv[2];
  if (!file || !process.env.SOURCE_DATABASE_URL)
    throw Error("SOURCE_DATABASE_URL and a private output path are required");
  const db = new Client({
    connectionString: process.env.SOURCE_DATABASE_URL,
    connectionTimeoutMillis: 10000,
  });
  await db.connect();
  try {
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result = { format: "amzpulse-legacy-v1", tables: {} };
    for (const name of tables)
      result.tables[name] = (await db.query(`SELECT * FROM "${name}"`)).rows;
    await db.query("COMMIT");
    fs.writeFileSync(file, JSON.stringify(result), { mode: 0o600, flag: "wx" });
    console.log("Private legacy export saved. Do not commit or upload it.");
  } finally {
    await db.end();
  }
})().catch((e) => {
  console.error("Export failed:", e.code || e.name);
  process.exitCode = 1;
});
