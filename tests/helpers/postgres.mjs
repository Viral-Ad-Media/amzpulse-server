import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
export const embeddedPostgres = async (upTo = Infinity) => {
  const db = new PGlite();
  for (const file of (
    await readdir(new URL("../../migrations/", import.meta.url))
  )
    .sort()
    .filter((n) => n.endsWith(".sql"))
    .slice(0, upTo)) {
    const sql = await readFile(
      new URL("../../migrations/" + file, import.meta.url),
      "utf8",
    );
    await db.exec(
      sql.replace('CREATE EXTENSION IF NOT EXISTS "pgcrypto";', ""),
    );
  }
  const query = async (text, values) => {
    if (typeof text === "object") {
      values = text.values;
      text = text.text;
    }
    const result = await db.query(text, values || []);
    return { ...result, rowCount: result.affectedRows ?? result.rows.length };
  };
  const client = { query, release: () => {} };
  const pool = {
    query,
    connect: async () => client,
    end: async () => db.close(),
    on: () => pool,
  };
  return { db, pool };
};
