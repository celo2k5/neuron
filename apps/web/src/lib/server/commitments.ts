import { PublicKey, Transaction, type ParsedInstruction, type PartiallyDecodedInstruction } from "@solana/web3.js";
import bs58 from "bs58";
import { commitmentPda, experimentIdBytes, hex32, IX, ixCommit, verifyCommitment } from "@neuron/solana";
import { one, q, pool, emit, type Db } from "./db";
import { env } from "./env";
import { connection, programId } from "./chain";
import { getExperiment, recomputeHashes } from "./experiments";
import { bad, conflict, forbidden } from "./http";
import type { Session } from "./auth";

export const VERIFY_NOTE = "Verified means the on-chain commitment matches hashes recomputed from the stored experiment. It does not prove the off-chain computation was correct.";

/** Build an unsigned commit transaction the wallet will sign; the commitment owner is the wallet. */
export async function prepareCommit(s: Session, experimentId: string) {
  const pid = programId();
  const e = await getExperiment(pool(), experimentId);
  if (e.status !== "completed") throw conflict("Only completed experiments can be committed.");
  if (e.owner_id !== s.userId) throw forbidden("Only the experiment owner can commit it.");
  const h = await recomputeHashes(pool(), e);
  if (!h || h.resultHash !== e.result_hash || h.metadataHash !== e.metadata_hash) throw conflict("Stored experiment hashes do not recompute; refusing to commit.");
  const idBytes = experimentIdBytes(e.id);
  const pda = commitmentPda(pid, idBytes);
  const ix = ixCommit(pid, new PublicKey(s.wallet), { experimentId: idBytes, resultHash: hex32(h.resultHash), artifactHash: hex32(h.artifactHash), metadataHash: hex32(h.metadataHash) });
  const { blockhash, lastValidBlockHeight } = await connection().getLatestBlockhash("confirmed");
  const t = new Transaction({ feePayer: new PublicKey(s.wallet), recentBlockhash: blockhash }).add(ix);
  await q(`insert into commitments (experiment_id, owner_wallet, program_id, pda, cluster) values ($1,$2,$3,$4,$5)
           on conflict (experiment_id) do nothing`, [e.id, s.wallet, pid.toBase58(), pda.toBase58(), env().SOLANA_CLUSTER]);
  return {
    programId: pid.toBase58(), pda: pda.toBase58(), cluster: env().SOLANA_CLUSTER, hashes: h,
    transaction: t.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"), lastValidBlockHeight,
  };
}

/** Check a submitted signature really contains our program's commit instruction for this PDA, then verify state. */
export async function submitCommit(s: Session, experimentId: string, signature: string) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(signature)) throw bad("Not a transaction signature.");
  const c = await one<{ owner_wallet: string; pda: string; status: string }>("select owner_wallet, pda, status from commitments where experiment_id = $1", [experimentId]);
  if (!c) throw bad("Prepare the commitment first.");
  if (c.owner_wallet !== s.wallet) throw forbidden("Commitment belongs to another wallet.");
  const found = await findCommitIx(signature, c.pda);
  if (!found) throw bad("That transaction does not contain a NEURON commit for this experiment (or is not confirmed yet).");
  await q("update commitments set signature = $2, ix_index = $3, slot = $4, status = 'confirmed' where experiment_id = $1", [experimentId, signature, found.ixIndex, found.slot]);
  return verifyExperiment(experimentId);
}

async function findCommitIx(signature: string, pda: string) {
  const t = await connection().getParsedTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  if (!t || t.meta?.err) return null;
  const pid = programId();
  const ixs = t.transaction.message.instructions as (ParsedInstruction | PartiallyDecodedInstruction)[];
  for (let i = 0; i < ixs.length; i++) {
    const ix = ixs[i];
    if (!("data" in ix) || !ix.programId.equals(pid)) continue;
    const data = bs58.decode(ix.data);
    if (Buffer.from(data.slice(0, 8)).equals(Buffer.from(IX.commit)) && ix.accounts[1]?.toBase58() === pda) return { ixIndex: i, slot: t.slot };
  }
  return null;
}

/** Public verification: recompute hashes from stored data, then compare with the on-chain account. */
export async function verifyExperiment(experimentId: string) {
  const db = pool();
  const e = await getExperiment(db, experimentId);
  const h = await recomputeHashes(db, e);
  if (!h) return { state: "not_committable", note: VERIFY_NOTE };
  const localOk = h.resultHash === e.result_hash && h.metadataHash === e.metadata_hash;
  const c = await one<{ owner_wallet: string; signature: string | null; pda: string; program_id: string; cluster: string; slot: string | null }>(
    "select owner_wallet, signature, pda, program_id, cluster, slot from commitments where experiment_id = $1", [experimentId]);
  if (!c) return { state: "not_committed", localHashesMatch: localOk, hashes: h, note: VERIFY_NOTE };
  const v = await verifyCommitment(connection(), new PublicKey(c.program_id), e.id, { ...h, owner: c.owner_wallet });
  const state = !localOk ? "mismatch" : v.state;
  await q("update commitments set status = $2, checked_at = now(), slot = coalesce(slot, $3) where experiment_id = $1",
    [experimentId, state === "verified" ? "verified" : state === "mismatch" ? "mismatch" : c.signature ? "confirmed" : "pending", v.commitment ? v.commitment.slot.toString() : null]);
  return {
    state, localHashesMatch: localOk, hashes: h, note: VERIFY_NOTE,
    chain: v.commitment ? { ...v.commitment, slot: v.commitment.slot.toString(), unixTimestamp: v.commitment.unixTimestamp.toString() } : null,
    signature: c.signature, programId: c.program_id, cluster: c.cluster, pda: c.pda,
  };
}

/**
 * Indexer: scan the program's signatures newer than the stored cursor, match commit instructions
 * to known commitments by PDA, record signature/slot, and verify. Unknown commits are counted only.
 */
export async function indexRegistry(db: Db) {
  const pid = programId();
  const st = await one<{ last_signature: string | null }>("select last_signature from indexer_state where id = 'registry'", [], db);
  let sigs;
  try {
    sigs = await connection().getSignaturesForAddress(pid, { until: st?.last_signature ?? undefined, limit: 200 }, "confirmed");
  } catch (e) {
    // the cursor signature fell out of the RPC's history (ledger pruned / validator reset): rescan the recent window.
    // Safe because every update below is keyed by PDA and only fills missing fields.
    if (!/not found/i.test((e as Error).message)) throw e;
    sigs = await connection().getSignaturesForAddress(pid, { limit: 200 }, "confirmed");
  }
  let matched = 0, unknown = 0, failed = 0;
  for (const s of [...sigs].reverse()) {
    if (s.err) { failed++; continue; }
    const t = await connection().getParsedTransaction(s.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (!t || t.meta?.err) continue;
    const ixs = t.transaction.message.instructions as (ParsedInstruction | PartiallyDecodedInstruction)[];
    for (let i = 0; i < ixs.length; i++) {
      const ix = ixs[i];
      if (!("data" in ix) || !ix.programId.equals(pid)) continue;
      const data = bs58.decode(ix.data);
      if (!Buffer.from(data.slice(0, 8)).equals(Buffer.from(IX.commit))) continue;
      const pda = ix.accounts[1]?.toBase58();
      const row = await one<{ experiment_id: string }>(
        `update commitments set signature = coalesce(signature, $2), ix_index = coalesce(ix_index, $3), slot = coalesce(slot, $4),
            status = case when status = 'pending' then 'confirmed' else status end
          where pda = $1 returning experiment_id`, [pda, s.signature, i, t.slot], db);
      if (row) { matched++; await verifyExperiment(row.experiment_id).catch(() => {}); } else unknown++;
    }
  }
  if (sigs.length) {
    await db.query(`insert into indexer_state (id, last_signature, last_slot) values ('registry',$1,$2)
                    on conflict (id) do update set last_signature = $1, last_slot = $2, updated_at = now()`, [sigs[0].signature, sigs[0].slot]);
  }
  if (matched) await emit(db, "registry.indexed", "registry", { matched, unknown });
  return { scanned: sigs.length, matched, unknown, failed };
}

export async function ledger(db: Db, limit: number, before?: string) {
  const p: unknown[] = [limit + 1];
  let where = "";
  if (before) { p.push(before); where = "where c.created_at < $2::timestamptz"; }
  const rows = await q(`select c.*, e.model_id, e.result_hash, e.created_at as experiment_created_at from commitments c join experiments e on e.id = c.experiment_id ${where} order by c.created_at desc limit $1`, p, db);
  return { items: rows.slice(0, limit), next: rows.length > limit ? (rows[limit - 1] as { created_at: string }).created_at : null };
}

