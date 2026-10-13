import { z } from "zod";
import { handler, body } from "@/lib/server/http";
import { currentSession } from "@/lib/server/auth";
import { goLive, requireAdmin } from "@/lib/server/settings";
export const dynamic = "force-dynamic";
/** switch to mainnet-beta: refused unless every required launch check passes */
export const POST = handler(async ({ req }) => {
  const s = requireAdmin(await currentSession(req));
  const b = await body(req, z.object({ confirm: z.string().max(40) }));
  return goLive(s, b.confirm);
});
