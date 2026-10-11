/**
 * Integration tests run against a real Postgres database (TEST_DATABASE_URL, default: a `neuron_test`
 * database on the dev server from infra/dev-postgres.sh). The schema is rebuilt from migrations.
 */
import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";

const url = process.env.TEST_DATABASE_URL ?? "postgres://neuron@127.0.0.1:5433/neuron_test";
const admin = url.replace(/\/[^/]+$/, "/postgres");
const c = new pg.Client({ connectionString: admin });
await c.connect();
const db = new URL(url).pathname.slice(1);
await c.query(`drop database if exists ${db} with (force)`);
await c.query(`create database ${db}`);
await c.end();
execSync("npx tsx scripts/migrate.ts", { env: { ...process.env, DATABASE_URL: url }, stdio: "ignore", cwd: path.resolve(__dirname, "..") });
Object.assign(process.env, {
  DATABASE_URL: url, APP_DOMAIN: "neuron.test", APP_URL: "http://neuron.test", SOLANA_CLUSTER: "localnet",
  SOLANA_RPC: "http://127.0.0.1:1", ARTIFACT_DIR: mkdtempSync(path.join(tmpdir(), "neuron-art-")), NEURON_LOG: "silent",
  REGISTRATION_CREDITS: "5", FREE_EXPERIMENTS_PER_DAY: "2",
});
