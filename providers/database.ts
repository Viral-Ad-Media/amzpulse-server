import { Pool, types } from "pg";
import { config } from "../config";
// Match JSON responses from the old transport without making money values strings.
types.setTypeParser(1700, Number);
export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  statement_timeout: 12000,
  query_timeout: 15000,
});
pool.on("error", () => {});
const tables = new Set([
  "User",
  "Organization",
  "Membership",
  "ApiKey",
  "OrganizationUsage",
  "PasswordResetToken",
  "Product",
  "ProductMetric",
  "WatchlistItem",
  "SourcingNote",
  "UsageReservation",
]);
const ident = (value: string): string => {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(value))
    throw new Error("Invalid SQL identifier");
  return `"${value}"`;
};
export type Result<T = any> = { data: T | null; error: any };
export const throwIfError = <T = any>(r: Result<T>): T | null => {
  if (r.error) throw r.error;
  return r.data;
};
export const requireData = <T = any>(r: Result<T>): T => {
  const data = throwIfError(r);
  if (data == null) throw new Error("Database query returned no data");
  return data;
};
export class Query implements PromiseLike<Result> {
  private operation = "select";
  private columns = "*";
  private payload: any[] = [];
  private filters: string[] = [];
  private params: any[] = [];
  private ordering: string[] = [];
  private rowLimit?: number;
  private cardinality?: "one" | "maybe";
  private conflict?: string;
  private ignore = false;
  constructor(private table: string) {
    if (!tables.has(table)) throw new Error("Unknown table");
  }
  private value(value: any) {
    this.params.push(value);
    return `$${this.params.length}`;
  }
  select(columns = "*") {
    this.columns =
      columns === "*"
        ? "*"
        : columns
            .split(",")
            .map((c) => ident(c.trim()))
            .join(",");
    return this;
  }
  eq(column: string, value: any) {
    this.filters.push(`${ident(column)} = ${this.value(value)}`);
    return this;
  }
  lt(column: string, value: any) {
    this.filters.push(`${ident(column)} < ${this.value(value)}`);
    return this;
  }
  in(column: string, values: any[]) {
    this.filters.push(`${ident(column)} = ANY(${this.value(values)})`);
    return this;
  }
  // The only disjunction used by the app: API-key expiry. No raw filter syntax is interpolated.
  or(filter: string) {
    const match = /^expiresAt\.is\.null,expiresAt\.gt\.(.+)$/.exec(filter);
    if (!match || !Number.isFinite(Date.parse(match[1])))
      throw new Error("Unsupported SQL filter");
    this.filters.push(
      `("expiresAt" IS NULL OR "expiresAt" > ${this.value(match[1])})`,
    );
    return this;
  }
  order(
    column: string,
    opts: { ascending?: boolean; nullsFirst?: boolean } = {},
  ) {
    this.ordering.push(
      `${ident(column)} ${opts.ascending === false ? "DESC" : "ASC"}${opts.nullsFirst == null ? "" : opts.nullsFirst ? " NULLS FIRST" : " NULLS LAST"}`,
    );
    return this;
  }
  limit(n: number) {
    if (!Number.isSafeInteger(n) || n < 1 || n > 10000)
      throw new Error("Invalid query limit");
    this.rowLimit = n;
    return this;
  }
  single() {
    this.cardinality = "one";
    return this;
  }
  maybeSingle() {
    this.cardinality = "maybe";
    return this;
  }
  insert(payload: any) {
    this.operation = "insert";
    this.payload = Array.isArray(payload) ? payload : [payload];
    return this;
  }
  upsert(
    payload: any,
    opts: { onConflict: string; ignoreDuplicates?: boolean },
  ) {
    this.insert(payload);
    this.conflict = opts.onConflict;
    this.ignore = !!opts.ignoreDuplicates;
    return this;
  }
  update(payload: any) {
    this.operation = "update";
    this.payload = [payload];
    return this;
  }
  delete() {
    this.operation = "delete";
    return this;
  }
  async execute(): Promise<Result> {
    try {
      const table = `public.${ident(this.table)}`;
      const where = this.filters.length
        ? ` WHERE ${this.filters.join(" AND ")}`
        : "";
      let sql: string;
      if (this.operation === "select")
        sql = `SELECT ${this.columns} FROM ${table}${where}${this.ordering.length ? " ORDER BY " + this.ordering.join(",") : ""}${this.rowLimit ? " LIMIT " + this.rowLimit : ""}`;
      else if (this.operation === "delete") {
        if (!where) throw new Error("Unfiltered delete is forbidden");
        sql = `DELETE FROM ${table}${where} RETURNING ${this.columns}`;
      } else if (this.operation === "update") {
        if (!where) throw new Error("Unfiltered update is forbidden");
        const entries = Object.entries(this.payload[0]).filter(
          ([, v]) => v !== undefined,
        );
        sql = `UPDATE ${table} SET ${entries.map(([k, v]) => `${ident(k)}=${this.value(v)}`).join(",")}${where} RETURNING ${this.columns}`;
      } else {
        if (!this.payload.length) return { data: [], error: null };
        const keys = [
          ...new Set(
            this.payload.flatMap((r) =>
              Object.keys(r).filter((k) => r[k] !== undefined),
            ),
          ),
        ];
        const rows = this.payload
          .map(
            (r) =>
              "(" +
              keys
                .map((k) => (r[k] === undefined ? "DEFAULT" : this.value(r[k])))
                .join(",") +
              ")",
          )
          .join(",");
        let conflict = "";
        if (this.conflict) {
          const conflicts = this.conflict.split(",").map((s) => s.trim());
          const updates = keys.filter(
            (k) => !conflicts.includes(k) && k !== "id",
          );
          conflict =
            ` ON CONFLICT (${conflicts.map(ident).join(",")}) ` +
            (this.ignore || !updates.length
              ? "DO NOTHING"
              : `DO UPDATE SET ${updates.map((k) => `${ident(k)}=EXCLUDED.${ident(k)}`).join(",")}`);
        }
        sql = `INSERT INTO ${table} (${keys.map(ident).join(",")}) VALUES ${rows}${conflict} RETURNING ${this.columns}`;
      }
      const { rows } = await pool.query(sql, this.params);
      if (
        this.cardinality &&
        (rows.length > 1 || (this.cardinality === "one" && rows.length !== 1))
      )
        throw new Error("Unexpected database result count");
      return { data: this.cardinality ? rows[0] || null : rows, error: null };
    } catch (error) {
      return { data: null, error };
    }
  }
  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}
const functions = new Set([
  "reserve_usage",
  "settle_usage",
  "apply_subscription",
  "register_account",
  "reset_account_password",
]);
const database = {
  from: (table: string) => new Query(table),
  rpc: async (name: string, args: Record<string, any>): Promise<Result> => {
    try {
      if (!functions.has(name)) throw new Error("Unknown database function");
      const entries = Object.entries(args);
      const { rows } = await pool.query(
        `SELECT public.${ident(name)}(${entries.map(([k], i) => `${ident(k)} => $${i + 1}`).join(",")}) AS result`,
        entries.map(([, v]) => v),
      );
      return { data: rows[0]?.result ?? null, error: null };
    } catch (error) {
      return { data: null, error };
    }
  },
};
export default database;
