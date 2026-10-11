/**
 * Devnet bootstrap for the launch rehearsal (idempotent). Everything is paid by the deployer
 * keypair (no faucet calls): initialise the registry, create a TEST $NEURON mint (6 decimals,
 * no freeze authority), create the treasury token account, and give a rehearsal user a little
 * SOL for fees plus test tokens. Refuses any RPC that is not devnet.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, sendAndConfirmTransaction, Transaction } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { ixInitialize, registryPda } from "@neuron/solana";

const rpc = process.env.SOLANA_RPC ?? "";
if (!/devnet/.test(rpc)) { console.error(`refusing: ${rpc || "(unset)"} is not a devnet RPC`); process.exit(1); }
const dir = process.env.DEVNET_DIR!;
const programId = new PublicKey(process.env.REGISTRY_PROGRAM_ID!);
const conn = new Connection(rpc, "confirmed");
const load = (n: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path.join(dir, `${n}.json`), "utf8"))));
const deployer = load("deployer"), treasury = load("treasury"), user = load("user");

if (!(await conn.getAccountInfo(registryPda(programId)))) {
  await sendAndConfirmTransaction(conn, new Transaction().add(ixInitialize(programId, deployer.publicKey)), [deployer], { commitment: "confirmed" });
  console.log("registry initialised (authority = deployer)");
}
const mintFile = path.join(dir, "mint.txt");
let mint: PublicKey;
if (existsSync(mintFile) && (await conn.getAccountInfo(new PublicKey(readFileSync(mintFile, "utf8").trim())))) mint = new PublicKey(readFileSync(mintFile, "utf8").trim());
else {
  mint = await createMint(conn, deployer, deployer.publicKey, null, 6, undefined, { commitment: "confirmed" });
  writeFileSync(mintFile, mint.toBase58());
  console.log(`created TEST $NEURON mint ${mint.toBase58()} (devnet)`);
}
await getOrCreateAssociatedTokenAccount(conn, deployer, mint, treasury.publicKey, false, "confirmed");
if ((await conn.getBalance(user.publicKey)) < 0.03 * LAMPORTS_PER_SOL) {
  await sendAndConfirmTransaction(conn, new Transaction().add(SystemProgram.transfer({ fromPubkey: deployer.publicKey, toPubkey: user.publicKey, lamports: 0.06 * LAMPORTS_PER_SOL })), [deployer], { commitment: "confirmed" });
  console.log("funded rehearsal user with 0.06 SOL for fees");
}
const ata = await getOrCreateAssociatedTokenAccount(conn, deployer, mint, user.publicKey, false, "confirmed");
if (ata.amount < 10_000_000n) { await mintTo(conn, deployer, mint, ata.address, deployer, 100_000_000n, [], { commitment: "confirmed" }); console.log("minted 100 test $NEURON to the rehearsal user"); }

const env = [
  `SOLANA_CLUSTER=devnet`, `SOLANA_RPC=${rpc}`, `SOLANA_FINALITY=finalized`,
  `REGISTRY_PROGRAM_ID=${programId.toBase58()}`, `NEURON_MINT=${mint.toBase58()}`, `TREASURY_OWNER=${treasury.publicKey.toBase58()}`,
  `DEV_MINT_AUTHORITY_KEYPAIR=`,
].join("\n") + "\n";
writeFileSync(path.join(dir, "app.env"), env);
console.log(env + `rehearsal user ${user.publicKey.toBase58()}`);
