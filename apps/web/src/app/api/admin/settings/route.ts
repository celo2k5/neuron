import { z } from "zod";
import { handler, body } from "@/lib/server/http";
import { currentSession } from "@/lib/server/auth";
import { requireAdmin, updateSetting } from "@/lib/server/settings";
import { rateLimit } from "@/lib/server/ratelimit";
export const dynamic = "force-dynamic";
/** change one setting; takes effect everywhere immediately */
export const PATCH = handler(async ({ req }) => {
  const s = requireAdmin(await currentSession(req));
  await rateLimit(`admin:${s.wallet}`, 240, 3600);
  const b = await body(req, z.object({ key: z.string().max(64), value: z.string().max(2048) }));
  return updateSetting(s, b.key, b.value);
});
