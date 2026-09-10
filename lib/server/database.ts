import { AsyncLocalStorage } from "node:async_hooks";
import { DatabaseSync } from "node:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import { HttpError } from "./errors";
import { supabaseCertificate } from "./supabase-ca";

type Row = Record<string, unknown>;
export interface Database {
  readonly ready: Promise<void>;
  readonly sqlite?: DatabaseSync;
  readonly rowOrder: string;
  all(sql: string, ...values: string[]): Promise<Row[]>;
  get(sql: string, ...values: string[]): Promise<Row | undefined>;
  run(sql: string, ...values: string[]): Promise<void>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export class SqliteDatabase implements Database {
  readonly sqlite: DatabaseSync;
  readonly ready = Promise.resolve();
  readonly rowOrder = "rowid";
  private readonly scope = new AsyncLocalStorage<boolean>();
  private queue = Promise.resolve();

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.sqlite = new DatabaseSync(path);
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.sqlite.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS brands (id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, brand_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS activity (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS credentials (brand_id TEXT NOT NULL, provider TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (brand_id, provider));
      CREATE TABLE IF NOT EXISTS idempotency (key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  }

  private async exclusive<T>(fn: () => T | Promise<T>): Promise<T> {
    if (this.scope.getStore()) return fn();
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await this.scope.run(true, fn); }
    finally { release(); }
  }
  all(sql: string, ...values: string[]) { return this.exclusive(() => this.sqlite.prepare(sql).all(...values)); }
  get(sql: string, ...values: string[]) { return this.exclusive(() => this.sqlite.prepare(sql).get(...values)); }
  async run(sql: string, ...values: string[]) { await this.exclusive(() => { this.sqlite.prepare(sql).run(...values); }); }
  transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.exclusive(async () => {
      this.sqlite.exec("BEGIN IMMEDIATE");
      try { const result = await fn(); this.sqlite.exec("COMMIT"); return result; }
      catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
    });
  }
  async close() { await this.exclusive(() => this.sqlite.close()); }
}

export function postgresConfig(connectionString: string, certificate = process.env.DATABASE_CA_CERT): PoolConfig {
  try {
    const url = new URL(connectionString);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.username || !url.password || url.pathname.length < 2 || /^\[YOUR[-_ ]PASSWORD\]$/i.test(decodeURIComponent(url.password))) throw new Error();
    // URL SSL options must never override certificate and hostname verification.
    for (const [key, value] of url.searchParams) {
      if (key !== "sslmode" || !["require", "verify-full"].includes(value)) throw new Error();
    }
    url.search = "";
    const supabaseHost = url.hostname.endsWith(".pooler.supabase.com") || /^db\.[a-z0-9]+\.supabase\.co$/.test(url.hostname);
    const ca = certificate?.replace(/\\n/g, "\n") || (supabaseHost ? supabaseCertificate : undefined);
    return {
      connectionString: url.toString(),
      ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
      max: 2,
      connectionTimeoutMillis: 15000,
      idleTimeoutMillis: 10000,
      allowExitOnIdle: true,
      statement_timeout: 15000,
      query_timeout: 20000,
    };
  } catch { throw new HttpError(503, "Database connection settings are invalid. Check the private environment settings."); }
}

export class PostgresDatabase implements Database {
  readonly rowOrder = "sequence";
  readonly ready: Promise<void>;
  private readonly scope = new AsyncLocalStorage<PoolClient>();

  constructor(readonly pool: Pool) {
    // Do not log driver errors: messages can contain connection details.
    pool.on("error", () => {});
    this.ready = this.checkSchema();
  }
  private async checkSchema() {
    try {
      const result = await this.pool.query("SELECT value FROM limitless.metadata WHERE key = 'schema_version'");
      if (result.rows[0]?.value !== "1") throw new Error();
    } catch { throw new HttpError(503, "Database unavailable or not initialized. Verify the connection and run the database migration."); }
  }
  private sql(sql: string) {
    let index = 0;
    return sql.replace(/\?/g, () => `$${++index}`).replace(/\b(FROM|INTO|UPDATE) (brands|orders|activity|credentials|idempotency|metadata)\b/g, "$1 limitless.$2");
  }
  async all(sql: string, ...values: string[]): Promise<Row[]> {
    await this.ready;
    const client = this.scope.getStore() ?? this.pool;
    return (await client.query(this.sql(sql), values)).rows;
  }
  async get(sql: string, ...values: string[]) { return (await this.all(sql, ...values))[0]; }
  async run(sql: string, ...values: string[]) { await this.all(sql, ...values); }
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    await this.ready;
    if (this.scope.getStore()) throw new Error("Nested database transactions are not supported.");
    const client = await this.pool.connect();
    let failed = false;
    try {
      await client.query("BEGIN");
      // Serialize this single-owner app's JSON updates and idempotency claims across instances.
      await client.query("SELECT pg_advisory_xact_lock(1852796517, 1)");
      const result = await this.scope.run(client, fn);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { failed = true; }
      throw error;
    } finally { client.release(failed); }
  }
  async close() { await this.pool.end(); }
}
