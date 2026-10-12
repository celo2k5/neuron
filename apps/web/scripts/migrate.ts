/** Applies db/migrations/*.sql in order, once each, inside a transaction. */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { fileURLToPath } from "node:url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");
const schema = process.env.DB_SCHEMA;
if (schema && !/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error("DB_SCHEMA must be a plain lowercase identifier");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
// sharing a database with other apps: everything NEURON creates lives in its own schema
if (schema) { await client.query(`create schema if not exists ${schema}`); await client.query(`set search_path to ${schema}`); }
await client.query("create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())");
const done = new Set((await client.query<{ version: string }>("select version from schema_migrations")).rows.map((r) => r.version));
for (const f of (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort()) {
  if (done.has(f)) continue;
  const sql = (await readFile(path.join(dir, f), "utf8")).replace(/create table schema_migrations[^;]+;/i, "");
  await client.query("begin");
  try {
    await client.query(sql);
    await client.query("insert into schema_migrations (version) values ($1)", [f]);
    await client.query("commit");
    console.log(`applied ${f}`);
  } catch (e) {
    await client.query("rollback");
    console.error(`failed ${f}: ${(e as Error).message}`);
    process.exit(1);
  }
}
await client.end();
console.log("migrations up to date");
