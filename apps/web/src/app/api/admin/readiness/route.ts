import { z } from "zod";
import { handler, query } from "@/lib/server/http";
import { requireAdminReq } from "@/lib/server/admin-auth";
import { readiness } from "@/lib/server/settings";
export const dynamic = "force-dynamic";
/** live launch checks against the chain and the server */
export const GET = handler(async ({ req }) => {
  await requireAdminReq(req);
  const p = query(req, z.object({ target: z.enum(["mainnet-beta", "current"]).default("mainnet-beta") }));
  return readiness(p.target);
});
