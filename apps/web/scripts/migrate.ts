/** Applies db/migrations/*.sql in order, once each, inside a transaction. */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const dir = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "db", "migrations");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
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
