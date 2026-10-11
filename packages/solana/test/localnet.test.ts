/**
 * Runs against a real solana-test-validator with the compiled program loaded.
 * Started by programs/neuron_registry/test.sh (sets SOLANA_RPC + REGISTRY_PROGRAM_ID).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { sha256 } from "@noble/hashes/sha256";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, sendAndConfirmTransaction, Transaction } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  buildPaymentTransaction, commitmentPda, decodeRegistry, experimentIdBytes, fetchCommitment, inspectPayment,
  ixCommit, ixInitialize, ixSetPaused, registryPda, verifyCommitment, type PaymentIntent,
} from "../src";

const RPC = process.env.SOLANA_RPC;
const run = RPC ? describe : describe.skip;
const h = (s: string) => sha256(new TextEncoder().encode(s));
const hx = (b: Uint8Array) => Buffer.from(b).toString("hex");

run("neuron_registry on localnet", () => {
  const conn = new Connection(RPC ?? "", "confirmed");
  const programId = new PublicKey(process.env.REGISTRY_PROGRAM_ID ?? "11111111111111111111111111111111");
  const authority = Keypair.generate(), alice = Keypair.generate(), mallory = Keypair.generate();
  const send = (ixs: Parameters<Transaction["add"]>, signers: Keypair[]) =>
    sendAndConfirmTransaction(conn, new Transaction().add(...ixs), signers, { commitment: "confirmed" });
  const fund = async (k: Keypair) => {
    const sig = await conn.requestAirdrop(k.publicKey, 5 * LAMPORTS_PER_SOL);
    await conn.confirmTransaction(sig, "confirmed");
  };
  beforeAll(async () => { await Promise.all([fund(authority), fund(alice), fund(mallory)]); }, 60_000);

  it("initialises exactly once", async () => {
    await send([ixInitialize(programId, authority.publicKey)], [authority]);
    const reg = decodeRegistry((await conn.getAccountInfo(registryPda(programId)))!.data);
    expect(reg.authority).toBe(authority.publicKey.toBase58());
    await expect(send([ixInitialize(programId, mallory.publicKey)], [mallory])).rejects.toThrow();
  });

  const expUuid = "0b3c6c1e-7f0a-4b0e-9d1c-2f1e3c4d5a6b";
  const args = { experimentId: experimentIdBytes(expUuid), resultHash: h("result"), artifactHash: h("artifact"), metadataHash: h("meta") };

  it("commits, decodes and verifies", async () => {
    const sig = await send([ixCommit(programId, alice.publicKey, args)], [alice]);
    expect(sig).toMatch(/^[1-9A-HJ-NP-Za-km-z]{60,90}$/);
    const c = await fetchCommitment(conn, programId, expUuid);
    expect(c!.owner).toBe(alice.publicKey.toBase58());
    expect(c!.resultHash).toBe(hx(args.resultHash));
    expect(c!.slot > 0n).toBe(true);
    const good = await verifyCommitment(conn, programId, expUuid, { resultHash: hx(args.resultHash), artifactHash: hx(args.artifactHash), metadataHash: hx(args.metadataHash), owner: alice.publicKey.toBase58() });
    expect(good.state).toBe("verified");
    const bad = await verifyCommitment(conn, programId, expUuid, { resultHash: hx(h("other")), artifactHash: hx(args.artifactHash), metadataHash: hx(args.metadataHash) });
    expect(bad.state).toBe("mismatch");
    expect((await verifyCommitment(conn, programId, "missing", { resultHash: "", artifactHash: "", metadataHash: "" })).state).toBe("not_found");
    expect(decodeRegistry((await conn.getAccountInfo(registryPda(programId)))!.data).commitments).toBe(1n);
  });

  it("rejects duplicate commits for the same experiment id", async () => {
    await expect(send([ixCommit(programId, mallory.publicKey, { ...args, resultHash: h("forged") })], [mallory])).rejects.toThrow();
    expect((await fetchCommitment(conn, programId, expUuid))!.owner).toBe(alice.publicKey.toBase58());
  });

  it("rejects PDA / account substitution", async () => {
    const other = { ...args, experimentId: experimentIdBytes("another") };
    await expect(send([ixCommit(programId, alice.publicKey, other, { commitment: commitmentPda(programId, experimentIdBytes("third")) })], [alice])).rejects.toThrow();
    await expect(send([ixCommit(programId, alice.publicKey, other, { registry: Keypair.generate().publicKey })], [alice])).rejects.toThrow();
  });

  it("rejects zero hashes and missing owner signature", async () => {
    await expect(send([ixCommit(programId, alice.publicKey, { ...args, experimentId: experimentIdBytes("z"), resultHash: new Uint8Array(32) })], [alice])).rejects.toThrow();
    const ix = ixCommit(programId, alice.publicKey, { ...args, experimentId: experimentIdBytes("nosig") });
    ix.keys[2].isSigner = false;
    await expect(send([ix], [mallory])).rejects.toThrow();
  });

  it("only the authority can pause; paused registry refuses commits", async () => {
    await expect(send([ixSetPaused(programId, mallory.publicKey, true)], [mallory])).rejects.toThrow();
    await send([ixSetPaused(programId, authority.publicKey, true)], [authority]);
    await expect(send([ixCommit(programId, alice.publicKey, { ...args, experimentId: experimentIdBytes("p") })], [alice])).rejects.toThrow();
    await send([ixSetPaused(programId, authority.publicKey, false)], [authority]);
    // fresh experiment id (an identical tx to the rejected one would be deduplicated by the client)
    await send([ixCommit(programId, alice.publicKey, { ...args, experimentId: experimentIdBytes("p2") })], [alice]);
    expect(decodeRegistry((await conn.getAccountInfo(registryPda(programId)))!.data).commitments).toBe(2n);
  });

  it("verifies a real SPL token payment against its intent and rejects mismatches", async () => {
    const treasury = Keypair.generate();
    const mint = await createMint(conn, authority, authority.publicKey, null, 6, undefined, { commitment: "confirmed" });
    const aliceAta = await getOrCreateAssociatedTokenAccount(conn, alice, mint, alice.publicKey, false, "confirmed");
    await getOrCreateAssociatedTokenAccount(conn, alice, mint, treasury.publicKey, false, "confirmed");
    await mintTo(conn, authority, mint, aliceAta.address, authority, 1_000_000_000n, [], { commitment: "confirmed" });
    const intent: PaymentIntent = {
      id: "pi_test_1", purpose: "credits", mint: mint.toBase58(), decimals: 6, tokenProgram: TOKEN_PROGRAM_ID.toBase58(), amount: "2500000",
      recipientOwner: treasury.publicKey.toBase58(), sender: alice.publicKey.toBase58(), reference: Keypair.generate().publicKey.toBase58(),
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    };
    const { blockhash } = await conn.getLatestBlockhash("confirmed");
    const tx = buildPaymentTransaction(intent, blockhash);
    const sig = await sendAndConfirmTransaction(conn, tx, [alice], { commitment: "confirmed" });
    const ok = await inspectPayment(conn, sig, intent, "confirmed");
    expect(ok).toMatchObject({ ok: true });
    expect(await inspectPayment(conn, sig, { ...intent, amount: "2500001" }, "confirmed")).toMatchObject({ ok: false });
    expect(await inspectPayment(conn, sig, { ...intent, id: "pi_other" }, "confirmed")).toMatchObject({ ok: false, reason: expect.stringMatching(/memo|reference/) });
    expect(await inspectPayment(conn, sig, { ...intent, sender: mallory.publicKey.toBase58() }, "confirmed")).toMatchObject({ ok: false });
    expect(await inspectPayment(conn, sig, { ...intent, recipientOwner: mallory.publicKey.toBase58() }, "confirmed")).toMatchObject({ ok: false, reason: "wrong recipient" });
  }, 60_000);
});
