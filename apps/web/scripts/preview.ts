/**
 * One-command local preview (Windows / macOS / Linux, no Docker, no system Postgres):
 *   npm install && npm run preview      → http://localhost:3000
 *
 * Starts an embedded PostgreSQL in .neuron-preview/, applies migrations, seeds the gallery,
 * then runs the Next dev server and the job worker. Chain features (payments, on-chain
 * commitments) stay visibly "not configured" unless you also run `npm run localnet` and put
 * its env into apps/web/.env.local.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(web, ".neuron-preview", "pg");
const PORT = Number(process.env.PREVIEW_PG_PORT ?? 54329);
const WEB_PORT = process.env.PREVIEW_PORT ?? "3000";
const fresh = !existsSync(path.join(dataDir, "PG_VERSION"));
mkdirSync(path.dirname(dataDir), { recursive: true });

const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: "neuron", password: "neuron", port: PORT, persistent: true,
  initdbFlags: ["--locale=C", "--lc-messages=C", "--encoding=UTF8"], onLog: () => {} });
if (fresh) await pg.initialise();
await pg.start();
if (fresh) await pg.createDatabase("neuron");
const DATABASE_URL = `postgres://neuron:neuron@127.0.0.1:${PORT}/neuron`;

// .env.local (from `npm run localnet`) wins for chain settings; the preview DB always wins for DATABASE_URL
const fileEnv: Record<string, string> = {};
const envFile = path.join(web, ".env.local");
if (existsSync(envFile)) for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) fileEnv[m[1]] = m[2];
}
const env = {
  ...process.env, SOLANA_CLUSTER: "localnet", SOLANA_RPC: "http://127.0.0.1:8899", SOLANA_FINALITY: "confirmed",
  APP_DOMAIN: `localhost:${WEB_PORT}`, APP_URL: `http://localhost:${WEB_PORT}`, ARTIFACT_DIR: path.join(web, ".neuron-preview", "artifacts"),
  NEURON_LOG: "silent", ...fileEnv, DATABASE_URL,
};

const tsx = path.join(web, "..", "..", "node_modules", "tsx", "dist", "cli.mjs");
const nextBin = path.join(web, "..", "..", "node_modules", "next", "dist", "bin", "next");
const run = (args: string[]) => new Promise<void>((res, rej) => {
  const p = spawn(process.execPath, args, { cwd: web, env, stdio: "inherit" });
  p.on("exit", (c) => (c === 0 ? res() : rej(new Error(`${args.join(" ")} exited ${c}`))));
});
await run([tsx, "scripts/migrate.ts"]);
await run([tsx, "scripts/seed.ts"]);

const kids: ChildProcess[] = [
  spawn(process.execPath, [nextBin, "dev", "-p", WEB_PORT], { cwd: web, env, stdio: "inherit" }),
  spawn(process.execPath, [tsx, "scripts/worker.ts"], { cwd: web, env: { ...env, NEURON_LOG: "silent" }, stdio: "inherit" }),
];
console.log(`\n  NEURON preview → http://localhost:${WEB_PORT}   (Ctrl+C to stop)\n`);
let stopping = false;
const stop = async () => {
  if (stopping) return; stopping = true;
  kids.forEach((k) => k.kill());
  await pg.stop().catch(() => {});
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
kids.forEach((k) => k.on("exit", () => { if (!stopping) { console.error("a preview process exited; stopping"); stop(); } }));
