import { Connection, PublicKey } from "@solana/web3.js";
import { mintInfo, tokenBalance } from "@neuron/solana";
import { env } from "./env";
import { unavailable } from "./http";

let conn: Connection | null = null;
export function connection() {
  conn ??= new Connection(env().SOLANA_RPC, { commitment: "confirmed" });
  return conn;
}

const mintCache = new Map<string, { decimals: number; programId: string; at: number }>();
export async function neuronMint() {
  const m = env().NEURON_MINT;
  if (!m) throw unavailable("$NEURON mint is not configured (NEURON_MINT). Token features are disabled.");
  const hit = mintCache.get(m);
  if (hit && Date.now() - hit.at < 60_000) return { mint: m, ...hit };
  const info = await mintInfo(connection(), new PublicKey(m)).catch((e: Error) => { throw unavailable(`Could not read the $NEURON mint from ${env().SOLANA_CLUSTER}: ${e.message}`); });
  const v = { decimals: info.decimals, programId: info.programId, at: Date.now() };
  mintCache.set(m, v);
  return { mint: m, ...v };
}

export async function walletBalance(wallet: string) {
  const m = await neuronMint();
  const b = await tokenBalance(connection(), new PublicKey(wallet), new PublicKey(m.mint), new PublicKey(m.programId));
  return { ...b, mint: m.mint, decimals: m.decimals, cluster: env().SOLANA_CLUSTER };
}

/** Optional: only used when a $NEURON mint is configured. Nothing core depends on an RPC. */
export async function rpcHealth() {
  const t0 = Date.now();
  try {
    const slot = await connection().getSlot("confirmed");
    return { ok: true, slot, latencyMs: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: (e as Error).message, latencyMs: Date.now() - t0 };
  }
}
