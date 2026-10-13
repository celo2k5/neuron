import { z } from "zod";
import { handler, body } from "@/lib/server/http";
import { requireAdminReq } from "@/lib/server/admin-auth";
import { leaveMainnet } from "@/lib/server/settings";
export const dynamic = "force-dynamic";
export const POST = handler(async ({ req }) => {
  const s = await requireAdminReq(req);
  const b = await body(req, z.object({ cluster: z.enum(["devnet", "localnet"]) }));
  return leaveMainnet(s, b.cluster);
});
