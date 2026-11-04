// Shared import transaction; used by the CLI and real PostgreSQL regression tests.
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
const id = (s) => {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(s)) throw Error("Invalid column");
  return '"' + s + '"';
};

async function importLegacy(db, data) {
  if (data.format !== "amzpulse-legacy-v1")
    throw Error("Unsupported export format");
  for (const table of tables)
    if (!Array.isArray(data.tables?.[table]))
      throw Error(`Missing table: ${table}`);
  try {
    await db.query("BEGIN");
    await db.query(
      'LOCK TABLE "User", "Organization" IN ACCESS EXCLUSIVE MODE',
    );
    const check = await db.query(
      'SELECT (SELECT count(*) FROM "User")+(SELECT count(*) FROM "Organization") AS n',
    );
    if (Number(check.rows[0].n))
      throw Error("Import target must be empty; use an isolated branch");
    await db.query("SELECT set_config('amzpulse.import','on',true)");
    for (const table of tables)
      for (const original of data.tables[table]) {
        const row = { ...original };
        if (table === "User") {
          row.name = row.name || row.email;
          row.emailVerified = false;
        }
        const keys = Object.keys(row);
        if (!keys.length) throw Error("Invalid empty row");
        await db.query(
          `INSERT INTO ${id(table)} (${keys.map(id).join(",")}) VALUES (${keys.map((_, i) => "$" + (i + 1)).join(",")})`,
          keys.map((k) => row[k]),
        );
      }
    await db.query(
      `INSERT INTO "AuthAccount"(id,"accountId","providerId","userId",password,"createdAt","updatedAt") SELECT gen_random_uuid()::text,id,'credential',id,"passwordHash","createdAt",now() FROM "User" WHERE "passwordHash" ~ '^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$'`,
    );
    const unmatched = await db.query(
      'SELECT count(*)::int AS n FROM "User" u WHERE NOT EXISTS (SELECT 1 FROM "Membership" m WHERE m."userId"=u.id)',
    );
    if (unmatched.rows[0].n)
      throw Error("Imported users without memberships; import rolled back");
    await db.query("COMMIT");
    console.log(
      "Legacy import committed; IDs, tenant membership and application records retained. Existing sessions and reset links must be renewed.",
    );
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  }
}
module.exports = { importLegacy };
