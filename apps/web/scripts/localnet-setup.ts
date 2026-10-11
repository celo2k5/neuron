/**
 * Localnet bootstrap (idempotent): initialise the registry, create a TEST $NEURON mint
 * (6 decimals) and a treasury, and write the resulting addresses to infra/.localnet/env.
 * Refuses to run against anything except a local RPC.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, sendAndConfirmTransaction, Transaction } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { ixInitialize, registryPda } from "@neuron/solana";

const rpc = process.env.SOLANA_RPC ?? "http://127.0.0.1:8899";
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(rpc)) { console.error(`refusing: ${rpc} is not a local RPC`); process.exit(1); }
const programId = new PublicKey(process.env.REGISTRY_PROGRAM_ID!);
const dir = path.resolve(process.cwd(), process.env.LOCALNET_DIR ?? "../../infra/.localnet");
mkdirSync(dir, { recursive: true });
const conn = new Connection(rpc, "confirmed");

const key = (name: string) => {
  const p = path.join(dir, `${name}.json`);
  if (existsSync(p)) return { kp: Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8")))), path: p };
  const kp = Keypair.generate();
  writeFileSync(p, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  return { kp, path: p };
};
const authority = key("registry-authority"), mintAuth = key("mint-authority"), treasury = key("treasury");
for (const k of [authority.kp, mintAuth.kp]) {
  if ((await conn.getBalance(k.publicKey)) < LAMPORTS_PER_SOL) await conn.confirmTransaction(await conn.requestAirdrop(k.publicKey, 10 * LAMPORTS_PER_SOL), "confirmed");
}
if (!(await conn.getAccountInfo(registryPda(programId)))) {
  await sendAndConfirmTransaction(conn, new Transaction().add(ixInitialize(programId, authority.kp.publicKey)), [authority.kp], { commitment: "confirmed" });
  console.log("registry initialised");
}
const mintFile = path.join(dir, "mint.txt");
let mint: PublicKey;
if (existsSync(mintFile) && (await conn.getAccountInfo(new PublicKey(readFileSync(mintFile, "utf8").trim())))) mint = new PublicKey(readFileSync(mintFile, "utf8").trim());
else {
  mint = await createMint(conn, mintAuth.kp, mintAuth.kp.publicKey, null, 6, undefined, { commitment: "confirmed" });
  writeFileSync(mintFile, mint.toBase58());
  console.log(`created TEST $NEURON mint ${mint.toBase58()}`);
}
await getOrCreateAssociatedTokenAccount(conn, mintAuth.kp, mint, treasury.kp.publicKey, false, "confirmed");
const env = [
  `SOLANA_CLUSTER=localnet`, `SOLANA_RPC=${rpc}`, `SOLANA_FINALITY=confirmed`,
  `REGISTRY_PROGRAM_ID=${programId.toBase58()}`, `NEURON_MINT=${mint.toBase58()}`, `TREASURY_OWNER=${treasury.kp.publicKey.toBase58()}`,
  `DEV_MINT_AUTHORITY_KEYPAIR=${mintAuth.path}`,
].join("\n") + "\n";
writeFileSync(path.join(dir, "env"), env);
console.log(env);
