import { readFileSync } from "node:fs";
import { z } from "zod";
import { Keypair, PublicKey } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { handler, body, forbidden, unavailable } from "@/lib/server/http";
import { env } from "@/lib/server/env";
import { connection, neuronMint } from "@/lib/server/chain";
import { assertWallet } from "@/lib/server/auth";
import { rateLimit, clientKey } from "@/lib/server/ratelimit";
import { fromBaseUnits } from "@neuron/solana";
export const dynamic = "force-dynamic";
/** LOCALNET ONLY: mints worthless test $NEURON so the payment flow can be exercised end-to-end. */
export const POST = handler(async ({ req }) => {
  if (env().SOLANA_CLUSTER !== "localnet") throw forbidden("The faucet only exists on localnet.");
  const path = process.env.DEV_MINT_AUTHORITY_KEYPAIR;
  if (!path) throw unavailable("DEV_MINT_AUTHORITY_KEYPAIR is not set (run npm run localnet).");
  await rateLimit(`faucet:${clientKey(req)}`, 5, 600);
  const { wallet } = await body(req, z.object({ wallet: z.string().max(60) }));
  const owner = new PublicKey(assertWallet(wallet));
  const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
  const m = await neuronMint();
  const conn = connection();
  const ata = await getOrCreateAssociatedTokenAccount(conn, authority, new PublicKey(m.mint), owner, false, "confirmed");
  const amount = 1000n * 10n ** BigInt(m.decimals);
  await mintTo(conn, authority, new PublicKey(m.mint), ata.address, authority, amount, [], { commitment: "confirmed" });
  return { amount: fromBaseUnits(amount, m.decimals), ata: ata.address.toBase58() };
});
