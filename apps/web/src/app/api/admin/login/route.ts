import { NextResponse } from "next/server";
import { z } from "zod";
import { handler, body, unauthorized } from "@/lib/server/http";
import { ADMIN_COOKIE, checkPassword, issueToken } from "@/lib/server/admin-auth";
import { rateLimit, clientKey } from "@/lib/server/ratelimit";
import { log } from "@/lib/server/log";
export const dynamic = "force-dynamic";
/** password login for /admin; 10 attempts per IP per 15 minutes */
export const POST = handler(async ({ req }) => {
  await rateLimit(`admin-login:${clientKey(req)}`, 10, 900);
  const b = await body(req, z.object({ password: z.string().max(200) }));
  if (!checkPassword(b.password)) { log.warn("admin_login_failed", { ip: clientKey(req) }); throw unauthorized("Wrong password."); }
  const { token, maxAge } = issueToken();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, token, { httpOnly: true, sameSite: "strict", secure: req.nextUrl.protocol === "https:", path: "/", maxAge });
  return res;
});
export const DELETE = handler(async () => {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, "", { httpOnly: true, sameSite: "strict", path: "/", maxAge: 0 });
  return res;
});
