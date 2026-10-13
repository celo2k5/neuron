import { z } from "zod";
import { handler, body } from "@/lib/server/http";
import { currentSession } from "@/lib/server/auth";
import { leaveMainnet, requireAdmin } from "@/lib/server/settings";
export const dynamic = "force-dynamic";
export const POST = handler(async ({ req }) => {
  const s = requireAdmin(await currentSession(req));
  const b = await body(req, z.object({ cluster: z.enum(["devnet", "localnet"]) }));
  return leaveMainnet(s, b.cluster);
});
