import nacl from "tweetnacl";
import { hashCanonical } from "@neuron/engine";
import { one, q, pool, emit, tx, type Db } from "./db";
import { getExperiment, recomputeHashes } from "./experiments";
import { conflict, forbidden } from "./http";
import type { Session } from "./auth";

/**
 * Server-side registry. Every commitment is an entry in an append-only, hash-chained log:
 *   entry_hash = H(version, seq, experiment, owner, result/artifact/metadata hashes, prev_hash, key, recorded_at)
 * and each entry_hash is signed with the server's ed25519 registry key. Rewriting any past entry
 * breaks its own hash, the signature, and every later prev_hash link. Updates and deletes are
 * also refused by a database trigger.
 */
export const REGISTRY_VERSION = "neuron-registry-1";
export const VERIFY_NOTE = "Verified means the signed registry entry matches hashes recomputed from the stored experiment, and the entry is intact in the hash chain. It does not prove the computation itself was correct; re-running the pinned model version checks that.";
const ZERO = "0".repeat(64);
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const unhex = (s: string) => new Uint8Array(Buffer.from(s, "hex"));
const signedMessage = (entryHash: string) => new TextEncoder().encode(`${REGISTRY_VERSION}:${entryHash}`);

interface KeyRow { id: string; public_key: string; secret_seed: string | null }
let active: { id: string; publicKey: string; secretKey: Uint8Array } | null = null;

/** The signing key: REGISTRY_SIGNING_KEY (64 hex chars) when set, otherwise one generated once and kept in the database. */
export async function signingKey(db: Db = pool()) {
  if (active) return active;
  const env = process.env.REGISTRY_SIGNING_KEY?.trim();
  let seed: Uint8Array;
  let row: KeyRow | null;
  if (env) {
    if (!/^[0-9a-f]{64}$/i.test(env)) throw new Error("REGISTRY_SIGNING_KEY must be 64 hex characters (a 32-byte ed25519 seed)");
    seed = unhex(env.toLowerCase());
    const pub = hex(nacl.sign.keyPair.fromSeed(seed).publicKey);
    row = await one<KeyRow>("select id, public_key, secret_seed from registry_keys where public_key = $1", [pub], db);
    if (!row) {
      const n = (await one<{ n: number }>("select count(*)::int as n from registry_keys", [], db))!.n;
      row = await one<KeyRow>("insert into registry_keys (id, public_key) values ($1, $2) on conflict (public_key) do update set public_key = excluded.public_key returning id, public_key, secret_seed", [`k${n + 1}`, pub], db);
    }
  } else {
    row = await one<KeyRow>("select id, public_key, secret_seed from registry_keys where secret_seed is not null order by created_at desc limit 1", [], db);
    if (!row) {
      const s = nacl.randomBytes(32);
      const pub = hex(nacl.sign.keyPair.fromSeed(s).publicKey);
      await db.query("insert into registry_keys (id, public_key, secret_seed) values ('k1', $1, $2) on conflict do nothing", [pub, hex(s)]);
      row = await one<KeyRow>("select id, public_key, secret_seed from registry_keys where secret_seed is not null order by created_at desc limit 1", [], db);
    }
    seed = unhex(row!.secret_seed!);
  }
  active = { id: row!.id, publicKey: row!.public_key, secretKey: nacl.sign.keyPair.fromSeed(seed).secretKey };
  return active;
}

export async function registryKeys(db: Db = pool()) {
  return q<{ id: string; public_key: string; created_at: string }>("select id, public_key, created_at from registry_keys order by created_at", [], db);
}

interface EntryRow {
  seq: string; experiment_id: string; owner_wallet: string; result_hash: string; artifact_hash: string; metadata_hash: string;
  prev_hash: string; entry_hash: string; key_id: string; signature: string; created_at: Date | string;
}
function entryHash(r: Omit<EntryRow, "entry_hash" | "signature">) {
  return hashCanonical({
    v: REGISTRY_VERSION, seq: Number(r.seq), experimentId: r.experiment_id, owner: r.owner_wallet,
    resultHash: r.result_hash, artifactHash: r.artifact_hash, metadataHash: r.metadata_hash,
    prevHash: r.prev_hash, keyId: r.key_id, recordedAt: new Date(r.created_at).toISOString(),
  });
}

/** Record a completed experiment's hashes in the registry. Owner only; idempotent. */
export async function commit(s: Session, experimentId: string) {
  const e = await getExperiment(pool(), experimentId);
  if (e.status !== "completed") throw conflict("Only completed experiments can be recorded.");
  if (e.owner_id !== s.userId) throw forbidden("Only the experiment owner can record it.");
  const h = await recomputeHashes(pool(), e);
  if (!h || h.resultHash !== e.result_hash || h.metadataHash !== e.metadata_hash) throw conflict("Stored experiment hashes do not recompute; refusing to record.");
  const key = await signingKey();
  await tx(async (db) => {
    // one writer at a time keeps seq gap-free and prev_hash correct
    await db.query("select pg_advisory_xact_lock(hashtext('neuron_registry'))");
    if (await one("select 1 from registry_entries where experiment_id = $1", [e.id], db)) return;
    const head = await one<{ seq: string; entry_hash: string }>("select seq::text, entry_hash from registry_entries order by seq desc limit 1", [], db);
    const base = {
      seq: String(Number(head?.seq ?? 0) + 1), experiment_id: e.id, owner_wallet: s.wallet,
      result_hash: h.resultHash, artifact_hash: h.artifactHash, metadata_hash: h.metadataHash,
      prev_hash: head?.entry_hash ?? ZERO, key_id: key.id, created_at: new Date(new Date().toISOString()),
    };
    const eh = entryHash(base);
    const sig = hex(nacl.sign.detached(signedMessage(eh), key.secretKey));
    await db.query(
      `insert into registry_entries (seq, experiment_id, owner_wallet, result_hash, artifact_hash, metadata_hash, prev_hash, entry_hash, key_id, signature, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [base.seq, base.experiment_id, base.owner_wallet, base.result_hash, base.artifact_hash, base.metadata_hash, base.prev_hash, eh, key.id, sig, base.created_at]);
    await emit(db, "registry.recorded", e.id, { seq: Number(base.seq), entryHash: eh }, s.userId);
  });
  return verifyExperiment(experimentId);
}

async function checkEntry(db: Db, r: EntryRow, keys: Map<string, string>) {
  const hashOk = entryHash(r) === r.entry_hash;
  const pub = keys.get(r.key_id);
  const sigOk = !!pub && nacl.sign.detached.verify(signedMessage(r.entry_hash), unhex(r.signature), unhex(pub));
  let linkOk: boolean;
  if (Number(r.seq) === 1) linkOk = r.prev_hash === ZERO;
  else {
    const prev = await one<{ entry_hash: string }>("select entry_hash from registry_entries where seq = $1", [Number(r.seq) - 1], db);
    linkOk = prev?.entry_hash === r.prev_hash;
  }
  return { hashOk, sigOk, linkOk };
}
const keyMap = async (db: Db) => new Map((await registryKeys(db)).map((k) => [k.id, k.public_key]));

/** Public verification: recompute the experiment's hashes, then check its signed, chained registry entry. */
export async function verifyExperiment(experimentId: string) {
  const db = pool();
  const e = await getExperiment(db, experimentId);
  const h = await recomputeHashes(db, e);
  if (!h) return { state: "not_committable", note: VERIFY_NOTE };
  const localOk = h.resultHash === e.result_hash && h.metadataHash === e.metadata_hash;
  const r = await one<EntryRow>("select * from registry_entries where experiment_id = $1", [experimentId], db);
  if (!r) return { state: "not_committed", localHashesMatch: localOk, hashes: h, note: VERIFY_NOTE };
  const keys = await keyMap(db);
  const c = await checkEntry(db, r, keys);
  const matches = r.result_hash === h.resultHash && r.artifact_hash === h.artifactHash && r.metadata_hash === h.metadataHash;
  const state = localOk && matches && c.hashOk && c.sigOk && c.linkOk ? "verified" : "mismatch";
  return {
    state, localHashesMatch: localOk, hashes: h, note: VERIFY_NOTE,
    checks: { hashesMatch: matches, entryHashOk: c.hashOk, signatureOk: c.sigOk, chainLinkOk: c.linkOk },
    record: {
      seq: Number(r.seq), entryHash: r.entry_hash, prevHash: r.prev_hash, keyId: r.key_id, publicKey: keys.get(r.key_id) ?? null,
      signature: r.signature, owner: r.owner_wallet, resultHash: r.result_hash, recordedAt: new Date(r.created_at).toISOString(),
    },
  };
}

/** Walk the whole log and check every link, entry hash and signature. */
export async function verifyChain(db: Db = pool()) {
  const keys = await keyMap(db);
  const rows = await q<EntryRow>("select * from registry_entries order by seq", [], db);
  let prev = ZERO, firstBad: number | null = null;
  rows.forEach((r, i) => {
    if (firstBad !== null) return;
    const pub = keys.get(r.key_id);
    const ok = Number(r.seq) === i + 1 && r.prev_hash === prev && entryHash(r) === r.entry_hash
      && !!pub && nacl.sign.detached.verify(signedMessage(r.entry_hash), unhex(r.signature), unhex(pub));
    if (!ok) firstBad = Number(r.seq);
    prev = r.entry_hash;
  });
  return { length: rows.length, head: rows.at(-1)?.entry_hash ?? null, intact: firstBad === null, firstBadSeq: firstBad };
}

export async function ledger(db: Db, limit: number, beforeSeq?: number) {
  const p: unknown[] = [limit + 1];
  let where = "";
  if (beforeSeq) { p.push(beforeSeq); where = "where r.seq < $2"; }
  const rows = await q<{ seq: string }>(
    `select r.seq::text as seq, r.experiment_id, r.owner_wallet, r.result_hash, r.entry_hash, r.prev_hash, r.key_id, r.created_at, e.model_id
       from registry_entries r join experiments e on e.id = r.experiment_id ${where} order by r.seq desc limit $1`, p, db);
  return { items: rows.slice(0, limit), next: rows.length > limit ? Number(rows[limit - 1].seq) : null };
}
