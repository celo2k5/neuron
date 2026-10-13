import { z } from "zod";
import { handler, body } from "@/lib/server/http";
import { requireAdminReq } from "@/lib/server/admin-auth";
import { goLive } from "@/lib/server/settings";
export const dynamic = "force-dynamic";
/** switch to mainnet-beta: refused unless every required launch check passes */
export const POST = handler(async ({ req }) => {
  const s = await requireAdminReq(req);
  const b = await body(req, z.object({ confirm: z.string().max(40) }));
  return goLive(s, b.confirm);
});
