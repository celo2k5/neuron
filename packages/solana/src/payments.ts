import {
  createTransferCheckedInstruction, getAssociatedTokenAddressSync, getMint, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey, Transaction, TransactionInstruction, type Connection, type Finality, type ParsedInstruction, type PartiallyDecodedInstruction } from "@solana/web3.js";

export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

export interface PaymentIntent {
  id: string;
  purpose: string;
  mint: string;
  decimals: number;
  tokenProgram: string;
  /** exact integer amount in base units */
  amount: string;
  recipientOwner: string;
  sender: string;
  /** unique reference key attached read-only to the transfer, used to find & bind the tx */
  reference: string;
  expiresAt: string;
}

export const memoFor = (intentId: string) => `neuron:pay:${intentId}`;

export async function mintInfo(conn: Connection, mint: PublicKey) {
  const acc = await conn.getAccountInfo(mint, "confirmed");
  if (!acc) throw new Error(`mint ${mint.toBase58()} not found on this cluster`);
  const programId = acc.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  const m = await getMint(conn, mint, "confirmed", programId);
  return { decimals: m.decimals, supply: m.supply.toString(), programId: programId.toBase58() };
}

export async function tokenBalance(conn: Connection, owner: PublicKey, mint: PublicKey, programId: PublicKey) {
  const ata = getAssociatedTokenAddressSync(mint, owner, true, programId);
  const info = await conn.getTokenAccountBalance(ata, "confirmed").catch(() => null);
  return { ata: ata.toBase58(), amount: info?.value.amount ?? "0", uiAmount: info?.value.uiAmountString ?? "0", decimals: info?.value.decimals };
}

export function buildPaymentTransaction(intent: PaymentIntent, recentBlockhash: string): Transaction {
  const mint = new PublicKey(intent.mint), sender = new PublicKey(intent.sender), recip = new PublicKey(intent.recipientOwner);
  const programId = new PublicKey(intent.tokenProgram);
  const from = getAssociatedTokenAddressSync(mint, sender, true, programId);
  const to = getAssociatedTokenAddressSync(mint, recip, true, programId);
  const transfer = createTransferCheckedInstruction(from, mint, to, sender, BigInt(intent.amount), intent.decimals, [], programId);
  transfer.keys.push({ pubkey: new PublicKey(intent.reference), isSigner: false, isWritable: false });
  const memo = new TransactionInstruction({ programId: MEMO_PROGRAM_ID, keys: [], data: Buffer.from(memoFor(intent.id), "utf8") });
  const tx = new Transaction({ feePayer: sender, recentBlockhash }).add(transfer, memo);
  return tx;
}

export type PaymentCheck = { ok: true; slot: number; payer: string } | { ok: false; reason: string; retryable: boolean };

/**
 * Independently inspect a transaction for an intent. Every field is checked against the
 * server-side intent; the client-supplied signature is only a lookup key.
 */
export async function inspectPayment(conn: Connection, signature: string, intent: PaymentIntent, finality: Finality = "finalized"): Promise<PaymentCheck> {
  const tx = await conn.getParsedTransaction(signature, { commitment: finality, maxSupportedTransactionVersion: 0 });
  if (!tx) return { ok: false, reason: `transaction not found at ${finality} commitment yet`, retryable: true };
  if (!tx.meta) return { ok: false, reason: "transaction has no metadata", retryable: true };
  if (tx.meta.err) return { ok: false, reason: `transaction failed on chain: ${JSON.stringify(tx.meta.err)}`, retryable: false };
  if (tx.blockTime && tx.blockTime * 1000 > Date.parse(intent.expiresAt)) return { ok: false, reason: "transaction landed after the intent expired", retryable: false };
  const keys = tx.transaction.message.accountKeys.map((k) => k.pubkey.toBase58());
  if (!keys.includes(intent.reference)) return { ok: false, reason: "reference key missing", retryable: false };
  const mint = new PublicKey(intent.mint), programId = new PublicKey(intent.tokenProgram);
  const toAta = getAssociatedTokenAddressSync(mint, new PublicKey(intent.recipientOwner), true, programId).toBase58();
  const ixs = tx.transaction.message.instructions as (ParsedInstruction | PartiallyDecodedInstruction)[];
  const transfers = ixs.filter((ix): ix is ParsedInstruction => "parsed" in ix && (ix.program === "spl-token") && ix.parsed?.type === "transferChecked");
  if (transfers.length !== 1) return { ok: false, reason: `expected exactly one transferChecked, found ${transfers.length}`, retryable: false };
  const info = transfers[0].parsed.info as { mint: string; destination: string; authority?: string; multisigAuthority?: string; tokenAmount: { amount: string; decimals: number } };
  if (info.mint !== intent.mint) return { ok: false, reason: "wrong mint", retryable: false };
  if (info.destination !== toAta) return { ok: false, reason: "wrong recipient", retryable: false };
  if ((info.authority ?? info.multisigAuthority) !== intent.sender) return { ok: false, reason: "sender does not match intent", retryable: false };
  if (info.tokenAmount.amount !== intent.amount || info.tokenAmount.decimals !== intent.decimals) return { ok: false, reason: "amount does not match intent exactly", retryable: false };
  const memos = ixs.filter((ix): ix is ParsedInstruction => "parsed" in ix && ix.programId.equals(MEMO_PROGRAM_ID));
  if (!memos.some((m) => m.parsed === memoFor(intent.id))) return { ok: false, reason: "memo does not reference this intent", retryable: false };
  // cross-check with balance deltas recorded by the runtime
  const pre = tx.meta.preTokenBalances?.find((b) => keys[b.accountIndex] === toAta)?.uiTokenAmount.amount ?? "0";
  const post = tx.meta.postTokenBalances?.find((b) => keys[b.accountIndex] === toAta)?.uiTokenAmount.amount;
  if (post === undefined || BigInt(post) - BigInt(pre) !== BigInt(intent.amount)) return { ok: false, reason: "recipient balance delta does not equal amount", retryable: false };
  return { ok: true, slot: tx.slot, payer: intent.sender };
}

/** Exact integer conversion; never floats. "12.5" with 6 decimals → 12500000n */
export function toBaseUnits(ui: string, decimals: number): bigint {
  if (!/^\d+(\.\d+)?$/.test(ui)) throw new Error("amount must be a positive decimal string");
  const [w, f = ""] = ui.split(".");
  if (f.length > decimals) throw new Error(`more than ${decimals} decimal places`);
  return BigInt(w) * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0");
}
export function fromBaseUnits(base: bigint | string, decimals: number): string {
  const b = BigInt(base);
  const d = 10n ** BigInt(decimals);
  const frac = (b % d).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${b / d}${frac ? "." + frac : ""}`;
}
