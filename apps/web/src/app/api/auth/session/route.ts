import { handler, body } from "@/lib/server/http";
import { NextResponse } from "next/server";
import { currentSession, revokeSession, signIn, SESSION_COOKIE, requireSession } from "@/lib/server/auth";
import { SignedActionSchema } from "@/lib/schemas";
import { rateLimit, clientKey } from "@/lib/server/ratelimit";
import { balance } from "@/lib/server/credits";
import { pool } from "@/lib/server/db";
import { env } from "@/lib/server/env";
export const dynamic = "force-dynamic";
export const GET = handler(async ({ req }) => {
  const s = await currentSession(req);
  if (!s) return { session: null };
  return { session: { wallet: s.wallet, userId: s.userId, cluster: env().SOLANA_CLUSTER }, credits: await balance(pool(), s.userId) };
});
export const POST = handler(async ({ req }) => {
  await rateLimit(`signin:${clientKey(req)}`, 10, 60);
  const b = await body(req, SignedActionSchema);
  const r = await signIn(b.message, b.signature, req.headers.get("user-agent"));
  const res = NextResponse.json({ session: { wallet: r.wallet, userId: r.userId }, expiresAt: r.expires });
  res.cookies.set(SESSION_COOKIE, r.token, { httpOnly: true, sameSite: "strict", secure: env().APP_URL.startsWith("https"), path: "/", expires: r.expires });
  return res;
});
export const DELETE = handler(async ({ req }) => {
  const s = await requireSession(req);
  await revokeSession(s.sessionId);
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
});
