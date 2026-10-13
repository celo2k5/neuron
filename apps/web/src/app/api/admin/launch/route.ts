import { z } from "zod";
import { handler, body } from "@/lib/server/http";
import { requireAdminReq } from "@/lib/server/admin-auth";
import { quickLaunch } from "@/lib/server/settings";
export const dynamic = "force-dynamic";
/** one-step mainnet launch: RPC, mint, treasury, price → validated on chain → live */
export const POST = handler(async ({ req }) => {
  const s = await requireAdminReq(req);
  const b = await body(req, z.object({ rpc: z.string().max(2048), mint: z.string().max(60), treasury: z.string().max(60), price: z.string().max(40) }));
  return quickLaunch(s, b);
});
