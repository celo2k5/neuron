import { z } from "zod";
import { handler, query } from "@/lib/server/http";
import { currentSession } from "@/lib/server/auth";
import { readiness, requireAdmin } from "@/lib/server/settings";
export const dynamic = "force-dynamic";
/** live launch checks against the chain and the server */
export const GET = handler(async ({ req }) => {
  requireAdmin(await currentSession(req));
  const p = query(req, z.object({ target: z.enum(["mainnet-beta", "current"]).default("mainnet-beta") }));
  return readiness(p.target);
});
