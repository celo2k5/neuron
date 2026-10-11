import { Keypair, PublicKey } from "@solana/web3.js";
import { buildPaymentTransaction, fromBaseUnits, inspectPayment, type PaymentIntent } from "@neuron/solana";
import { one, q, tx, emit, type Db } from "./db";
import { env } from "./env";
import { connection, neuronMint } from "./chain";
import { enqueue } from "./jobs";
import { purchase } from "./credits";
import { bad, conflict, forbidden, notFound, unavailable } from "./http";
import type { Session } from "./auth";

const INTENT_TTL_MS = 15 * 60_000;

interface IntentRow {
  id: string; user_id: string; purpose: string; credits: number; mint: string; decimals: number; token_program: string;
  amount: string; recipient_owner: string; sender: string; reference: string; status: string; signature: string | null;
  failure_reason: string | null; expires_at: string; created_at: string;
}
const toIntent = (r: IntentRow): PaymentIntent => ({
  id: r.id, purpose: r.purpose, mint: r.mint, decimals: r.decimals, tokenProgram: r.token_program, amount: r.amount,
  recipientOwner: r.recipient_owner, sender: r.sender, reference: r.reference, expiresAt: new Date(r.expires_at).toISOString(),
});

export async function createIntent(s: Session, credits: number) {
  if (!Number.isInteger(credits) || credits < 1 || credits > 10_000) throw bad("Credits must be a whole number from 1 to 10,000.");
  const e = env();
  if (!e.TREASURY_OWNER) throw unavailable("Treasury is not configured (TREASURY_OWNER); purchases are disabled.");
  const m = await neuronMint();
  const amount = (BigInt(e.CREDIT_PRICE_BASE_UNITS) * BigInt(credits)).toString();
  const id = "pi_" + crypto.randomUUID().replace(/-/g, "");
  const reference = Keypair.generate().publicKey.toBase58();
  const expiresAt = new Date(Date.now() + INTENT_TTL_MS).toISOString();
  const intent: PaymentIntent = { id, purpose: "credits", mint: m.mint, decimals: m.decimals, tokenProgram: m.programId, amount, recipientOwner: e.TREASURY_OWNER, sender: s.wallet, reference, expiresAt };
  await q(`insert into payment_intents (id, user_id, purpose, credits, mint, decimals, token_program, amount, recipient_owner, sender, reference, expires_at)
           values ($1,$2,'credits',$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [id, s.userId, credits, m.mint, m.decimals, m.programId, amount, e.TREASURY_OWNER, s.wallet, reference, expiresAt]);
  const { blockhash, lastValidBlockHeight } = await connection().getLatestBlockhash("confirmed");
  const txn = buildPaymentTransaction(intent, blockhash);
  return {
    intent, credits, display: { amount: fromBaseUnits(amount, m.decimals), symbol: "$NEURON", cluster: e.SOLANA_CLUSTER },
    transaction: txn.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"), lastValidBlockHeight,
  };
}

/** Client reports a signature. It is only a lookup key; credits are issued by `reconcileIntent` after independent inspection. */
export async function submitSignature(s: Session, intentId: string, signature: string) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(signature)) throw bad("Not a transaction signature.");
  return tx(async (db) => {
    const r = await one<IntentRow>("select * from payment_intents where id = $1 for update", [intentId], db);
    if (!r) throw notFound("Payment intent not found.");
    if (r.user_id !== s.userId) throw forbidden("This intent belongs to another wallet.");
    if (r.status === "confirmed") return { status: "confirmed" };
    if (r.signature && r.signature !== signature) throw conflict("A different signature was already submitted for this intent.");
    await db.query("update payment_intents set signature = $2, status = 'submitted', updated_at = now() where id = $1", [intentId, signature]);
    await enqueue(db, "reconcile_payment", { intentId }, { idempotencyKey: `reconcile:${intentId}:${signature}`, maxAttempts: 12 });
    return { status: "submitted" };
  });
}

/**
 * Worker: verify on chain and issue credits exactly once.
 * Returns {retry:true} while the tx is not yet at the configured finality.
 */
export async function reconcileIntent(db: Db, intentId: string): Promise<{ status: string; retry?: boolean; reason?: string }> {
  const r = await one<IntentRow>("select * from payment_intents where id = $1", [intentId], db);
  if (!r) return { status: "missing" };
  if (r.status === "confirmed" || r.status === "failed") return { status: r.status };
  const conn = connection();
  let sig = r.signature;
  if (!sig) {
    const found = await conn.getSignaturesForAddress(new PublicKey(r.reference), { limit: 5 }, "confirmed");
    sig = found.find((f) => !f.err)?.signature ?? null;
    if (!sig) {
      if (Date.now() > Date.parse(r.expires_at)) {
        await db.query("update payment_intents set status = 'expired', updated_at = now() where id = $1 and status = 'pending'", [intentId]);
        return { status: "expired" };
      }
      return { status: "pending", retry: true };
    }
  }
  const check = await inspectPayment(conn, sig, toIntent(r), env().SOLANA_FINALITY);
  if (!check.ok) {
    if (check.retryable) return { status: "submitted", retry: true, reason: check.reason };
    await db.query("update payment_intents set status = 'failed', failure_reason = $2, signature = coalesce(signature, $3), updated_at = now() where id = $1", [intentId, check.reason, sig]);
    await emit(db, "payment.failed", intentId, { reason: check.reason }, r.user_id);
    return { status: "failed", reason: check.reason };
  }
  return tx(async (c) => {
    const locked = await one<IntentRow>("select * from payment_intents where id = $1 for update", [intentId], c);
    if (locked!.status === "confirmed") return { status: "confirmed" };
    // unique(signature) and unique(intent_id) make double-credit impossible even under concurrent reconcilers
    await c.query("insert into token_payments (signature, intent_id, slot, amount, mint, payer) values ($1,$2,$3,$4,$5,$6)", [sig, intentId, check.slot, r.amount, r.mint, check.payer]);
    await c.query("update payment_intents set status = 'confirmed', signature = $2, updated_at = now() where id = $1", [intentId, sig]);
    await purchase(c, r.user_id, r.credits, intentId);
    await emit(c, "payment.confirmed", intentId, { credits: r.credits, signature: sig }, r.user_id);
    return { status: "confirmed" };
  });
}

export async function listIntents(userId: string) {
  return q<IntentRow>("select * from payment_intents where user_id = $1 order by created_at desc limit 20", [userId]);
}
export async function getIntent(userId: string, id: string) {
  const r = await one<IntentRow>("select * from payment_intents where id = $1 and user_id = $2", [id, userId]);
  if (!r) throw notFound();
  return r;
}
