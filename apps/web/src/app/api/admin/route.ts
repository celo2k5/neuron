import { handler } from "@/lib/server/http";
import { currentSession } from "@/lib/server/auth";
import { adminState, isAdmin, registryKeyInfo } from "@/lib/server/settings";
export const dynamic = "force-dynamic";
/** who you are to /admin, and the full settings state if you are an admin */
export const GET = handler(async ({ req }) => {
  const s = await currentSession(req);
  const configured = !!(process.env.ADMIN_WALLETS ?? "").trim();
  if (!s || !isAdmin(s.wallet)) return { admin: false, signedIn: !!s, wallet: s?.wallet ?? null, adminsConfigured: configured };
  return { admin: true, signedIn: true, wallet: s.wallet, adminsConfigured: true, ...(await adminState()), registryKey: await registryKeyInfo() };
});
