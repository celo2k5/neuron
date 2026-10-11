import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { challengeMessage, parseChallenge, verifySignature, type Challenge } from "@neuron/solana";
import { sha256Hex } from "@neuron/engine";
import { env } from "./env";
import { one, q, tx, emit, type Db } from "./db";
import { bad, unauthorized } from "./http";

export const SESSION_COOKIE = "neuron_session";
const CHALLENGE_TTL_MS = 5 * 60_000;

export function assertWallet(w: string): string {
  try { return new PublicKey(w).toBase58(); } catch { throw bad("Not a valid Solana address."); }
}

/** Issue a single-use, domain-separated challenge. */
export async function issueChallenge(wallet: string, intent: Challenge["intent"], payloadHash?: string, db?: Db) {
  const e = env();
  const now = new Date();
  const c: Challenge = {
    domain: e.APP_DOMAIN,
    address: assertWallet(wallet),
    statement: intent === "sign-in" ? "Sign in to NEURON. This request costs nothing and does not move funds." : `Authorize NEURON action: ${intent}. No funds move.`,
    uri: e.APP_URL,
    cluster: e.SOLANA_CLUSTER,
    intent,
    nonce: randomBytes(16).toString("hex"),
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS).toISOString(),
    payloadHash,
  };
  const message = challengeMessage(c);
  await q("insert into auth_challenges (nonce, wallet, intent, message, payload_hash, expires_at) values ($1,$2,$3,$4,$5,$6)",
    [c.nonce, c.address, intent, message, payloadHash ?? null, c.expiresAt], db);
  return { message, nonce: c.nonce, expiresAt: c.expiresAt };
}

/**
 * Verify a signed challenge and consume its nonce atomically (replay-safe).
 * Checks: exact server-issued text, domain, cluster, intent, expiry, ed25519 signature, single use.
 */
export async function consumeChallenge(db: Db, message: string, signature: string, expectedIntent: Challenge["intent"], expectedPayload?: string) {
  const e = env();
  const c = parseChallenge(message);
  if (!c) throw bad("Malformed challenge.");
  if (c.domain !== e.APP_DOMAIN || c.uri !== e.APP_URL) throw bad("Challenge was issued for a different domain.");
  if (c.cluster !== e.SOLANA_CLUSTER) throw bad("Challenge was issued for a different cluster.");
  if (c.intent !== expectedIntent) throw bad("Challenge intent does not match this action.");
  if ((expectedPayload ?? null) !== (c.payloadHash ?? null)) throw bad("Challenge payload does not match this request.");
  if (!verifySignature(message, signature, c.address)) throw unauthorized("Signature does not match the wallet.");
  const row = await one<{ nonce: string }>(
    `update auth_challenges set consumed_at = now()
      where nonce = $1 and wallet = $2 and message = $3 and consumed_at is null and expires_at > now()
      returning nonce`, [c.nonce, c.address, message], db);
  if (!row) throw unauthorized("Challenge expired or was already used. Request a new one.");
  return c;
}

export async function signIn(message: string, signature: string, userAgent: string | null) {
  return tx(async (db) => {
    const c = await consumeChallenge(db, message, signature, "sign-in");
    const user = (await one<{ id: string }>(
      `insert into users (wallet) values ($1) on conflict (wallet) do update set last_seen_at = now() returning id`, [c.address], db))!;
    await db.query("insert into credit_accounts (user_id) values ($1) on conflict do nothing", [user.id]);
    const token = randomBytes(32).toString("base64url");
    const expires = new Date(Date.now() + env().SESSION_TTL_HOURS * 3600_000);
    await db.query("insert into sessions (user_id, token_hash, cluster, expires_at, user_agent) values ($1,$2,$3,$4,$5)",
      [user.id, sha256Hex(token), env().SOLANA_CLUSTER, expires, userAgent?.slice(0, 200) ?? null]);
    await emit(db, "auth.signed_in", user.id, {}, user.id);
    return { token, expires, userId: user.id, wallet: c.address };
  });
}

export interface Session { sessionId: string; userId: string; wallet: string }

export async function currentSession(req?: NextRequest): Promise<Session | null> {
  const token = req ? req.cookies.get(SESSION_COOKIE)?.value : (await cookies()).get(SESSION_COOKIE)?.value;
  const bearer = req?.headers.get("authorization")?.replace(/^Bearer /, "");
  const t = token ?? bearer;
  if (!t) return null;
  const row = await one<{ id: string; user_id: string; wallet: string }>(
    `select s.id, s.user_id, u.wallet from sessions s join users u on u.id = s.user_id
      where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now() and s.cluster = $2`, [sha256Hex(t), env().SOLANA_CLUSTER]);
  return row ? { sessionId: row.id, userId: row.user_id, wallet: row.wallet } : null;
}

export async function requireSession(req: NextRequest): Promise<Session> {
  const s = await currentSession(req);
  if (!s) throw unauthorized();
  return s;
}

export async function revokeSession(sessionId: string) {
  await q("update sessions set revoked_at = now() where id = $1", [sessionId]);
}
