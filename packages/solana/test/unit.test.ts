import { describe, expect, it } from "vitest";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { Keypair } from "@solana/web3.js";
import { challengeMessage, decodeCommitment, experimentIdBytes, fromBaseUnits, parseChallenge, toBaseUnits, verifySignature, type Challenge } from "../src";

describe("auth challenges", () => {
  const kp = Keypair.generate();
  const c: Challenge = {
    domain: "neuron.local", address: kp.publicKey.toBase58(), statement: "Sign in to NEURON.", uri: "http://neuron.local", cluster: "localnet",
    intent: "sign-in", nonce: "n0nce1234567", issuedAt: "2026-10-11T00:00:00.000Z", expiresAt: "2026-10-11T00:10:00.000Z",
  };
  it("round-trips and verifies ed25519 signatures", () => {
    const msg = challengeMessage(c);
    expect(parseChallenge(msg)).toEqual({ ...c, payloadHash: undefined });
    const sig = bs58.encode(nacl.sign.detached(new TextEncoder().encode(msg), kp.secretKey));
    expect(verifySignature(msg, sig, c.address)).toBe(true);
    expect(verifySignature(msg.replace("localnet", "mainnet"), sig, c.address)).toBe(false);
    expect(verifySignature(msg, sig, Keypair.generate().publicKey.toBase58())).toBe(false);
    expect(verifySignature(msg, "garbage", c.address)).toBe(false);
  });
  it("rejects tampered or non-canonical messages", () => {
    expect(parseChallenge(challengeMessage(c) + "\nExtra: 1")).toBeNull();
    expect(parseChallenge("hello")).toBeNull();
  });
});

describe("token amounts", () => {
  it("converts exactly with integers", () => {
    expect(toBaseUnits("12.5", 6)).toBe(12500000n);
    expect(toBaseUnits("0.000001", 6)).toBe(1n);
    expect(() => toBaseUnits("0.0000001", 6)).toThrow();
    expect(() => toBaseUnits("-1", 6)).toThrow();
    expect(fromBaseUnits(12500000n, 6)).toBe("12.5");
    expect(fromBaseUnits("100", 0)).toBe("100");
    expect(toBaseUnits("18446744073709551615", 0)).toBe(18446744073709551615n);
  });
});

describe("registry encoding", () => {
  it("experiment ids are 32 bytes and domain-separated", () => {
    expect(experimentIdBytes("a")).toHaveLength(32);
    expect(Buffer.from(experimentIdBytes("a")).toString("hex")).not.toBe(Buffer.from(experimentIdBytes("b")).toString("hex"));
  });
  it("refuses to decode foreign accounts", () => {
    expect(() => decodeCommitment(new Uint8Array(300))).toThrow(/not a Commitment/);
  });
});
