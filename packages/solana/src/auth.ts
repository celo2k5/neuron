import bs58 from "bs58";
import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";

/**
 * Domain-separated sign-in challenge (Sign-In-With-Solana style text).
 * The server issues the nonce + timestamps and stores the nonce; the client signs the exact text.
 */
export interface Challenge {
  domain: string;
  address: string;
  statement: string;
  uri: string;
  cluster: string;
  intent: "sign-in" | "vote" | "register-neuron" | "update-neuron";
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  /** extra payload hash for action intents */
  payloadHash?: string;
}

export function challengeMessage(c: Challenge): string {
  return [
    `${c.domain} wants you to sign in with your Solana account:`,
    c.address,
    "",
    c.statement,
    "",
    `URI: ${c.uri}`,
    `Chain: solana:${c.cluster}`,
    `Intent: ${c.intent}`,
    ...(c.payloadHash ? [`Payload: ${c.payloadHash}`] : []),
    `Nonce: ${c.nonce}`,
    `Issued At: ${c.issuedAt}`,
    `Expiration Time: ${c.expiresAt}`,
  ].join("\n");
}

export function parseChallenge(msg: string): Challenge | null {
  const lines = msg.split("\n");
  const m = /^(.+) wants you to sign in with your Solana account:$/.exec(lines[0] ?? "");
  if (!m) return null;
  const f = (k: string) => lines.find((l) => l.startsWith(`${k}: `))?.slice(k.length + 2);
  const chain = f("Chain");
  const c: Challenge = {
    domain: m[1], address: lines[1], statement: lines[3], uri: f("URI") ?? "", cluster: chain?.replace(/^solana:/, "") ?? "",
    intent: f("Intent") as Challenge["intent"], nonce: f("Nonce") ?? "", issuedAt: f("Issued At") ?? "", expiresAt: f("Expiration Time") ?? "",
    payloadHash: f("Payload"),
  };
  return challengeMessage(c) === msg ? c : null;
}

export function verifySignature(message: string, signatureB58: string, address: string): boolean {
  try {
    const sig = bs58.decode(signatureB58);
    const pk = new PublicKey(address).toBytes();
    if (sig.length !== 64) return false;
    return nacl.sign.detached.verify(new TextEncoder().encode(message), sig, pk);
  } catch {
    return false;
  }
}
