import { sha256 } from "@noble/hashes/sha256";
import { hexToBytes, utf8ToBytes } from "@noble/hashes/utils";
import { PublicKey, SystemProgram, TransactionInstruction, type Connection } from "@solana/web3.js";

/** Anchor discriminators: first 8 bytes of sha256("global:<ix>") / sha256("account:<Name>") */
const disc = (s: string) => sha256(utf8ToBytes(s)).slice(0, 8);
export const IX = { initialize: disc("global:initialize"), setPaused: disc("global:set_paused"), commit: disc("global:commit_experiment") };
export const ACC = { registry: disc("account:Registry"), commitment: disc("account:Commitment") };
export const EVENT_COMMITTED = disc("event:ExperimentCommitted");

export function registryPda(programId: PublicKey) {
  return PublicKey.findProgramAddressSync([utf8ToBytes("registry")], programId)[0];
}
export function commitmentPda(programId: PublicKey, experimentId: Uint8Array) {
  if (experimentId.length !== 32) throw new Error("experiment id must be 32 bytes");
  return PublicKey.findProgramAddressSync([utf8ToBytes("commitment"), experimentId], programId)[0];
}

/** The 32-byte on-chain id for an off-chain experiment UUID (domain-separated). */
export function experimentIdBytes(experimentUuid: string): Uint8Array {
  return sha256(utf8ToBytes(`neuron:experiment:v1|${experimentUuid}`));
}

export const hex32 = (h: string) => {
  if (!/^[0-9a-f]{64}$/.test(h)) throw new Error("expected 64 hex chars");
  return hexToBytes(h);
};

const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

export function ixInitialize(programId: PublicKey, authority: PublicKey) {
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: registryPda(programId), isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(IX.initialize),
  });
}

export function ixSetPaused(programId: PublicKey, authority: PublicKey, paused: boolean) {
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: registryPda(programId), isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data: Buffer.from(cat(IX.setPaused, new Uint8Array([paused ? 1 : 0]))),
  });
}

export interface CommitArgs { experimentId: Uint8Array; resultHash: Uint8Array; artifactHash: Uint8Array; metadataHash: Uint8Array }

export function ixCommit(programId: PublicKey, owner: PublicKey, a: CommitArgs, overrides: { registry?: PublicKey; commitment?: PublicKey } = {}) {
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: overrides.registry ?? registryPda(programId), isSigner: false, isWritable: true },
      { pubkey: overrides.commitment ?? commitmentPda(programId, a.experimentId), isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(cat(IX.commit, a.experimentId, a.resultHash, a.artifactHash, a.metadataHash)),
  });
}

export interface CommitmentAccount {
  owner: string; experimentId: string; resultHash: string; artifactHash: string; metadataHash: string; slot: bigint; unixTimestamp: bigint;
}
const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export function decodeCommitment(data: Uint8Array): CommitmentAccount {
  if (data.length < 8 + 32 * 5 + 16 + 1) throw new Error("account too small for Commitment");
  if (toHex(data.slice(0, 8)) !== toHex(ACC.commitment)) throw new Error("not a Commitment account");
  let o = 8;
  const take = (n: number) => { const s = data.slice(o, o + n); o += n; return s; };
  const owner = new PublicKey(take(32)).toBase58();
  const experimentId = toHex(take(32)), resultHash = toHex(take(32)), artifactHash = toHex(take(32)), metadataHash = toHex(take(32));
  const dv = new DataView(data.buffer, data.byteOffset);
  const slot = dv.getBigUint64(o, true); o += 8;
  const unixTimestamp = dv.getBigInt64(o, true);
  return { owner, experimentId, resultHash, artifactHash, metadataHash, slot, unixTimestamp };
}

export function decodeRegistry(data: Uint8Array) {
  if (toHex(data.slice(0, 8)) !== toHex(ACC.registry)) throw new Error("not a Registry account");
  const dv = new DataView(data.buffer, data.byteOffset);
  return { authority: new PublicKey(data.slice(8, 40)).toBase58(), commitments: dv.getBigUint64(40, true), paused: data[48] === 1 };
}

export async function fetchCommitment(conn: Connection, programId: PublicKey, experimentUuid: string) {
  const pda = commitmentPda(programId, experimentIdBytes(experimentUuid));
  const info = await conn.getAccountInfo(pda, "confirmed");
  if (!info) return null;
  if (!info.owner.equals(programId)) throw new Error("commitment PDA is owned by another program");
  return { pda: pda.toBase58(), ...decodeCommitment(info.data) };
}

export type VerifyState = "verified" | "mismatch" | "not_found";
/** Verification = the on-chain record matches the recomputed hashes. It is not a proof of correct computation. */
export async function verifyCommitment(conn: Connection, programId: PublicKey, experimentUuid: string, expected: { resultHash: string; artifactHash: string; metadataHash: string; owner?: string }) {
  const c = await fetchCommitment(conn, programId, experimentUuid);
  if (!c) return { state: "not_found" as VerifyState, commitment: null };
  const ok = c.resultHash === expected.resultHash && c.artifactHash === expected.artifactHash && c.metadataHash === expected.metadataHash && (!expected.owner || c.owner === expected.owner);
  return { state: (ok ? "verified" : "mismatch") as VerifyState, commitment: c };
}
