import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { currentSession, type Session } from "./auth";
import { isAdmin } from "./settings";
import { forbidden, unauthorized } from "./http";

/**
 * Password access to /admin. The password lives only in ADMIN_PASSWORD (server environment).
 * A successful login sets an httpOnly cookie: "<expiry>.<hmac>", keyed by the password itself,
 * so changing ADMIN_PASSWORD signs every admin out. Admin wallets (ADMIN_WALLETS) still work too.
 */
export const ADMIN_COOKIE = "neuron_admin";
const TTL_MS = 12 * 3600_000;
const secret = () => process.env.ADMIN_PASSWORD ?? "";
const mac = (exp: string) => createHmac("sha256", `neuron-admin|${secret()}`).update(exp).digest("hex");
const eq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

export const passwordConfigured = () => secret().length > 0;
export function checkPassword(pw: string) { return passwordConfigured() && eq(createHmac("sha256", "pw").update(pw).digest("hex"), createHmac("sha256", "pw").update(secret()).digest("hex")); }
export function issueToken() { const exp = String(Date.now() + TTL_MS); return { token: `${exp}.${mac(exp)}`, maxAge: TTL_MS / 1000 }; }
export function validToken(t: string | undefined) {
  if (!t || !passwordConfigured()) return false;
  const [exp, sig] = t.split(".");
  return !!exp && !!sig && Number(exp) > Date.now() && eq(sig, mac(exp));
}

/** The admin acting on this request: a password session, or a signed-in admin wallet. */
export async function adminActor(req: NextRequest): Promise<Session | null> {
  if (validToken(req.cookies.get(ADMIN_COOKIE)?.value)) {
    const s = await currentSession(req);
    return { sessionId: "admin-password", userId: s?.userId ?? (null as unknown as string), wallet: s?.wallet ?? "password" };
  }
  const s = await currentSession(req);
  return s && isAdmin(s.wallet) ? s : null;
}
export async function requireAdminReq(req: NextRequest) {
  const a = await adminActor(req);
  if (!a) throw passwordConfigured() ? unauthorized("Enter the admin password.") : forbidden("Admin is not configured. Set ADMIN_PASSWORD in the server environment.");
  return a;
}
