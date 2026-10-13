import { handler } from "@/lib/server/http";
import { adminState, registryKeyInfo } from "@/lib/server/settings";
import { adminActor, passwordConfigured } from "@/lib/server/admin-auth";
export const dynamic = "force-dynamic";
/** who you are to /admin, and the full settings state if you are an admin */
export const GET = handler(async ({ req }) => {
  const a = await adminActor(req);
  if (!a) return { admin: false, passwordConfigured: passwordConfigured() };
  return { admin: true, wallet: a.wallet, passwordConfigured: passwordConfigured(), ...(await adminState()), registryKey: await registryKeyInfo() };
});
