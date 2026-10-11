import { handler, query } from "@/lib/server/http";
import { z } from "zod";
import { walletBalance, neuronMint } from "@/lib/server/chain";
import { assertWallet } from "@/lib/server/auth";
import { env } from "@/lib/server/env";
export const dynamic = "force-dynamic";
/** Reads the configured mint and a wallet's real balance from the configured cluster. */
export const GET = handler(async ({ req }) => {
  const p = query(req, z.object({ wallet: z.string().max(60).optional() }));
  const mint = await neuronMint();
  return { cluster: env().SOLANA_CLUSTER, mint: mint.mint, decimals: mint.decimals, tokenProgram: mint.programId, balance: p.wallet ? await walletBalance(assertWallet(p.wallet)) : null };
});
