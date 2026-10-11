import { afterAll, describe, expect, it } from "vitest";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { Keypair } from "@solana/web3.js";
import { challengeMessage, parseChallenge } from "@neuron/solana";
import { generateModel, runExperiment, type ModelConfig } from "@neuron/engine";
import { pool, tx, one, q } from "@/lib/server/db";
import { issueChallenge, signIn, consumeChallenge } from "@/lib/server/auth";
import { balance, purchase, reserve, settle, grant } from "@/lib/server/credits";
import { claim, complete, enqueue, fail, requeueStale } from "@/lib/server/jobs";
import { createModel, loadVersion, listModels } from "@/lib/server/models";
import { createExperiment, executeExperiment, getExperiment, recomputeHashes } from "@/lib/server/experiments";
import { ensureNetwork, networkState, registerNeuron, updateNeuron, neuronPayloadHash } from "@/lib/server/community";
import { putArtifact, getArtifact } from "@/lib/server/artifacts";
import { startTraining } from "@/lib/server/training";

const kp = () => Keypair.generate();
const sign = (k: Keypair, msg: string) => bs58.encode(nacl.sign.detached(new TextEncoder().encode(msg), k.secretKey));
async function session(k: Keypair) {
  const ch = await issueChallenge(k.publicKey.toBase58(), "sign-in");
  const s = await signIn(ch.message, sign(k, ch.message), "test");
  const sid = (await one<{ id: string }>("select id from sessions where user_id = $1 order by created_at desc limit 1", [s.userId]))!.id;
  return { sessionId: sid, userId: s.userId, wallet: s.wallet };
}
const cfg: ModelConfig = { name: "it", seed: "it-1", architecture: "feedforward", inputDim: 2, outputDim: 2, hidden: [5], activations: ["tanh"], outputActivation: "softmax", density: 1, init: "xavier" };

afterAll(async () => { await pool().end(); });

describe("wallet auth", () => {
  it("signs in once; the same signed challenge cannot be replayed", async () => {
    const k = kp();
    const ch = await issueChallenge(k.publicKey.toBase58(), "sign-in");
    const sig = sign(k, ch.message);
    const s = await signIn(ch.message, sig, "ua");
    expect(s.wallet).toBe(k.publicKey.toBase58());
    await expect(signIn(ch.message, sig, "ua")).rejects.toThrow(/already used|expired/);
  });
  it("rejects wrong signer, other domain, other cluster and tampered text", async () => {
    const k = kp(), other = kp();
    const ch = await issueChallenge(k.publicKey.toBase58(), "sign-in");
    await expect(signIn(ch.message, sign(other, ch.message), null)).rejects.toThrow(/Signature/);
    const c = parseChallenge(ch.message)!;
    const foreign = challengeMessage({ ...c, domain: "evil.example" });
    await expect(signIn(foreign, sign(k, foreign), null)).rejects.toThrow(/domain/);
    const devnet = challengeMessage({ ...c, cluster: "devnet" });
    await expect(signIn(devnet, sign(k, devnet), null)).rejects.toThrow(/cluster/);
    const forged = challengeMessage({ ...c, nonce: "ffffffffffffffffffffffffffffffff" });
    await expect(signIn(forged, sign(k, forged), null)).rejects.toThrow(/already used|expired/);
  });
  it("rejects expired challenges and intent mismatches", async () => {
    const k = kp();
    const ch = await issueChallenge(k.publicKey.toBase58(), "sign-in");
    await q("update auth_challenges set expires_at = now() - interval '1 second' where nonce = $1", [ch.nonce]);
    await expect(signIn(ch.message, sign(k, ch.message), null)).rejects.toThrow(/expired/);
    const v = await issueChallenge(k.publicKey.toBase58(), "vote", "ab".repeat(32));
    await expect(tx((db) => consumeChallenge(db, v.message, sign(k, v.message), "sign-in"))).rejects.toThrow(/intent/);
  });
});

describe("credit ledger", () => {
  it("purchases are idempotent per intent; reservations cannot overdraw; settle releases the remainder", async () => {
    const s = await session(kp());
    await tx((db) => purchase(db, s.userId, 10, "pi_x"));
    await tx((db) => purchase(db, s.userId, 10, "pi_x")); // retry of the same intent
    expect((await balance(pool(), s.userId)).available).toBe(10);
    await expect(tx((db) => reserve(db, s.userId, 11, "training", "t1"))).rejects.toThrow(/needs 11 credits/);
    await tx((db) => reserve(db, s.userId, 6, "training", "t2"));
    await tx((db) => settle(db, s.userId, 6, 2, "training", "t2"));
    await tx((db) => settle(db, s.userId, 6, 2, "training", "t2")); // duplicate settle is a no-op
    expect(await balance(pool(), s.userId)).toEqual({ available: 8, reserved: 0, consumed: 2, refunded: 0 });
  });
  it("one on-chain signature can credit only one intent (unique constraint)", async () => {
    const s = await session(kp());
    const mk = (id: string, ref: string) => q(`insert into payment_intents (id, user_id, purpose, credits, mint, decimals, token_program, amount, recipient_owner, sender, reference, expires_at)
      values ($1,$2,'credits',5,'m',6,'p',5000000,'r',$3,$4, now() + interval '1 hour')`, [id, s.userId, s.wallet, ref]);
    await mk("pi_a", "refA"); await mk("pi_b", "refB");
    await q("insert into token_payments (signature, intent_id, slot, amount, mint, payer) values ('SIG1','pi_a',1,5000000,'m','x')");
    await expect(q("insert into token_payments (signature, intent_id, slot, amount, mint, payer) values ('SIG1','pi_b',1,5000000,'m','x')")).rejects.toThrow(/duplicate key/);
  });
});

describe("job queue", () => {
  it("is idempotent by key, never double-claims, retries with backoff then dead-letters, and recovers stale jobs", async () => {
    const a = await enqueue(pool(), "experiment", { n: 1 }, { idempotencyKey: "k1", maxAttempts: 2 });
    const b = await enqueue(pool(), "experiment", { n: 1 }, { idempotencyKey: "k1" });
    expect(b).toBe(a);
    await enqueue(pool(), "experiment", { n: 2 }, { idempotencyKey: "k2" });
    const [c1, c2] = await Promise.all([claim(pool(), "w1", ["experiment"]), claim(pool(), "w2", ["experiment"])]);
    expect(c1 && c2 && c1.id !== c2.id).toBe(true);
    const j = [c1!, c2!].find((x) => x.id === a)!;
    expect(await fail(pool(), j.id, "boom", true)).toBe(false);
    const row = await one<{ status: string; run_after: string }>("select status, run_after from jobs where id = $1", [a]);
    expect(row!.status).toBe("queued");
    expect(Date.parse(row!.run_after)).toBeGreaterThan(Date.now());
    await q("update jobs set run_after = now() where id = $1", [a]);
    const again = await claim(pool(), "w1", ["experiment"]);
    expect(again!.id).toBe(a);
    expect(await fail(pool(), a, "boom", true)).toBe(true);
    expect((await one<{ status: string }>("select status from jobs where id = $1", [a]))!.status).toBe("dead");
    const other = [c1!, c2!].find((x) => x.id !== a)!;
    await q("update jobs set heartbeat_at = now() - interval '5 minutes' where id = $1", [other.id]);
    expect((await requeueStale(pool(), 60)).map((r) => r.id)).toContain(other.id);
    await complete(pool(), other.id, { ok: true });
  });
});

describe("models, artifacts and experiments", () => {
  it("content-addressed artifacts are idempotent and refuse path escapes", async () => {
    const h1 = await putArtifact(pool(), "dataset", { a: 1 });
    const h2 = await putArtifact(pool(), "dataset", { a: 1 });
    expect(h2).toBe(h1);
    expect(await getArtifact(pool(), h1)).toEqual({ a: 1 });
    await q("update artifacts set storage_key = '../../etc/passwd' where hash = $1", [h1]);
    await expect(getArtifact(pool(), h1)).rejects.toThrow(/escapes/);
  });
  it("same config ⇒ same model id; stored artifact round-trips with hashes; listing paginates", async () => {
    const r1 = await tx((db) => createModel(db, cfg, undefined, null));
    const r2 = await tx((db) => createModel(db, { ...cfg }, undefined, null));
    expect(r2).toEqual({ id: r1.id, created: false });
    const { model } = await loadVersion(pool(), r1.id);
    expect(model.artifactHash).toBe(generateModel(cfg).artifactHash);
    for (let i = 0; i < 5; i++) await tx((db) => createModel(db, { ...cfg, seed: `p-${i}` }, undefined, null));
    const p1 = await listModels(pool(), { sort: "newest", limit: 3 });
    const p2 = await listModels(pool(), { sort: "newest", limit: 3, cursor: p1.nextCursor! });
    expect(p1.items).toHaveLength(3);
    expect(p2.items.map((m) => m.id)).not.toContain(p1.items[0].id);
  });
  it("executes a queued experiment to the engine's exact result and recomputes its hashes", async () => {
    const s = await session(kp());
    const { id: modelId } = await tx((db) => createModel(db, cfg, undefined, s.userId));
    const e = await tx((db) => createExperiment(db, { modelId, input: [0.5, -0.25], inputSource: "manual", ownerId: s.userId }));
    await tx((db) => executeExperiment(db, e.id, e.cost));
    const row = await getExperiment(pool(), e.id);
    const ref = runExperiment(generateModel(cfg), [0.5, -0.25]);
    expect(row.status).toBe("completed");
    expect(row.output).toEqual(ref.output);
    expect(row.result_hash).toBe(ref.resultHash);
    const h = await recomputeHashes(pool(), row);
    expect(h!.resultHash).toBe(row.result_hash);
    // executing again is a no-op
    expect(await tx((db) => executeExperiment(db, e.id, 0))).toEqual({ skipped: true });
  });
  it("charges a credit only beyond the free daily tier", async () => {
    const s = await session(kp());
    const { id: modelId } = await tx((db) => createModel(db, cfg, undefined, s.userId));
    const run = () => tx((db) => createExperiment(db, { modelId, input: [0, 0], inputSource: "manual", ownerId: s.userId }));
    expect((await run()).cost).toBe(0);
    expect((await run()).cost).toBe(0);
    await expect(run()).rejects.toThrow(/credits/); // FREE_EXPERIMENTS_PER_DAY=2 and no credits
    await tx((db) => grant(db, s.userId, 1, "test", "g1"));
    expect((await run()).cost).toBe(1);
    expect((await balance(pool(), s.userId)).reserved).toBe(1);
  });
  it("rejects training jobs whose dataset does not fit the model", async () => {
    const s = await session(kp());
    const { id: modelId } = await tx((db) => createModel(db, { ...cfg, inputDim: 3, seed: "t3" }, undefined, s.userId));
    await expect(tx((db) => startTraining(db, s.userId, { modelId, dataset: "xor", samples: 100, optimizer: "adam", learningRate: 0.01, epochs: 10, batchSize: 8, valFraction: 0.2 }))).rejects.toThrow(/input/);
  });
});

describe("community network", () => {
  it("registers with a signed, payload-bound challenge, versions monotonically, and blocks cross-user edits", async () => {
    await ensureNetwork(pool());
    const ka = kp(), kb = kp();
    const a = await session(ka), b = await session(kb);
    await tx((db) => grant(db, a.userId, 10, "test", "ga"));
    const n = { layer: 1 as const, bias: 0.2, seed: "alice-1", scale: 1 };
    const ch = await issueChallenge(a.wallet, "register-neuron", neuronPayloadHash("register", n));
    const v0 = (await networkState(pool())).current;
    // signature for one payload cannot register a different neuron
    await expect(registerNeuron(a, { ...n, bias: 1.9 }, { message: ch.message, signature: sign(ka, ch.message) })).rejects.toThrow(/payload/);
    const ch2 = await issueChallenge(a.wallet, "register-neuron", neuronPayloadHash("register", n));
    const r = await registerNeuron(a, n, { message: ch2.message, signature: sign(ka, ch2.message) });
    expect(r.version).toBe(v0 + 1);
    expect((await balance(pool(), a.userId)).consumed).toBe(5);
    await expect(registerNeuron(a, n, { message: ch2.message, signature: sign(ka, ch2.message) })).rejects.toThrow(/already used|expired/);
    const upd = { ...n, bias: -0.4 };
    const chb = await issueChallenge(b.wallet, "update-neuron", neuronPayloadHash("update", { ...upd, id: r.id }));
    await expect(updateNeuron(b, r.id, upd, { message: chb.message, signature: sign(kb, chb.message) })).rejects.toThrow(/only change neurons your wallet registered/);
    const st = await networkState(pool());
    expect(st.neurons.find((x) => x.id === r.id)!.bias).toBe(0.2);
    const vs = st.versions.map((v) => (v as { version: number }).version);
    expect(vs).toEqual([...vs].sort((x, y) => y - x));
  });
  it("activity event ids are a monotonic cursor", async () => {
    const rows = await q<{ id: string }>("select id from activity_events order by id");
    const ids = rows.map((r) => BigInt(r.id));
    for (let i = 1; i < ids.length; i++) expect(ids[i] > ids[i - 1]).toBe(true);
    expect(ids.length).toBeGreaterThan(3);
  });
});
