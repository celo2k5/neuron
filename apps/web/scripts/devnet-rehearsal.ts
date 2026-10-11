/**
 * Headless end-to-end rehearsal against a running app configured for devnet (infra/.devnet/app.env).
 * Plays the user with infra/.devnet/user.json: SIWS sign-in → buy credits with test $NEURON →
 * run a persisted experiment → commit its hashes on devnet → verify against the chain.
 * Every step goes through the public HTTP API, exactly as the browser does.
 *   APP_URL=http://localhost:3000 npx tsx scripts/devnet-rehearsal.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { Connection, Keypair, Transaction } from "@solana/web3.js";

const app = process.env.APP_URL ?? "http://localhost:3000";
const dir = process.env.DEVNET_DIR ?? path.resolve(process.cwd(), "../../infra/.devnet");
const env = Object.fromEntries(readFileSync(path.join(dir, "app.env"), "utf8").trim().split("\n").map((l) => l.split(/=(.*)/s).slice(0, 2)));
if (env.SOLANA_CLUSTER !== "devnet") throw new Error("app.env is not a devnet config");
const user = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path.join(dir, "user.json"), "utf8"))));
const conn = new Connection(env.SOLANA_RPC, "confirmed");
const wallet = user.publicKey.toBase58();
const tx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
let cookie = "";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api<T>(p: string, init: { method?: string; json?: unknown } = {}): Promise<T> {
  const r = await fetch(app + p, { method: init.method ?? (init.json ? "POST" : "GET"), headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: init.json ? JSON.stringify(init.json) : undefined });
  const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${init.method ?? "GET"} ${p} → ${r.status} ${JSON.stringify(j)}`);
  return j as T;
}
async function signAndSend(b64: string) {
  const t = Transaction.from(Buffer.from(b64, "base64"));
  t.partialSign(user);
  const sig = await conn.sendRawTransaction(t.serialize(), { skipPreflight: false });
  await conn.confirmTransaction(sig, "finalized");
  return sig;
}
async function until<T>(what: string, f: () => Promise<T | null>, ms = 120_000) {
  const t0 = Date.now();
  for (;;) { const v = await f(); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`timed out: ${what}`); await sleep(3000); }
}
const step = (n: string) => console.log(`\n▸ ${n}`);

step(`sign in as ${wallet}`);
const ch = await api<{ message: string }>("/api/auth/challenge", { json: { intent: "sign-in", wallet } });
const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(ch.message), user.secretKey));
await api("/api/auth/session", { json: { message: ch.message, signature } });
console.log("  session ok");

step("buy 3 credits with test $NEURON");
const intent = await api<{ intent: { id: string }; transaction: string; display: { amount: string; symbol: string } }>("/api/payments", { json: { credits: 3 } });
console.log(`  intent ${intent.intent.id}: pay ${intent.display.amount} ${intent.display.symbol}`);
const paySig = await signAndSend(intent.transaction);
console.log(`  sent ${tx(paySig)}`);
await api(`/api/payments/${intent.intent.id}`, { json: { signature: paySig } });
await until("payment confirmation", async () => {
  const r = await api<{ intent: { status: string; failure_reason?: string } }>(`/api/payments/${intent.intent.id}`);
  if (r.intent.status === "failed") throw new Error(`payment failed: ${r.intent.failure_reason}`);
  return r.intent.status === "confirmed" ? r : null;
});
const s = await api<{ credits: { available: number } }>("/api/auth/session");
console.log(`  confirmed; available credits: ${s.credits.available}`);

step("run a persisted experiment");
const models = await api<{ items: { id: string; config: { inputDim: number } }[] }>("/api/models?limit=1");
const m = models.items[0];
const input = Array.from({ length: m.config.inputDim }, (_, i) => (i % 2 ? -0.5 : 0.5));
const exp = await api<{ id: string }>("/api/experiments", { json: { modelId: m.id, input, inputSource: "manual" } });
const done = await until("experiment", async () => {
  const r = await api<{ experiment: { status: string; result_hash: string } }>(`/api/experiments/${exp.id}`);
  if (r.experiment.status === "failed") throw new Error("experiment failed");
  return r.experiment.status === "completed" ? r.experiment : null;
});
console.log(`  ${exp.id} completed, result ${done.result_hash.slice(0, 16)}…`);

step("commit the experiment's hashes on devnet");
const prep = await api<{ transaction: string }>(`/api/commitments/${exp.id}`, { method: "POST" });
const commitSig = await signAndSend(prep.transaction);
console.log(`  sent ${tx(commitSig)}`);
await api(`/api/commitments/${exp.id}`, { method: "PUT", json: { signature: commitSig } });

step("verify against the chain");
const v = await until("verification", async () => {
  const r = await api<{ state: string; localHashesMatch?: boolean; pda?: string }>(`/api/commitments/${exp.id}`);
  return r.state === "verified" ? r : null;
}, 60_000);
console.log(`  state ${v.state}; stored hashes recompute: ${v.localHashesMatch}; pda ${v.pda}`);
console.log(`\nrehearsal passed · experiment ${app}/experiments/${exp.id}`);
