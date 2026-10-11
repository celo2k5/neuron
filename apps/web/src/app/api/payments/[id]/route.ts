import { handler, body } from "@/lib/server/http";
import { z } from "zod";
import { getIntent, submitSignature } from "@/lib/server/payments";
import { requireSession } from "@/lib/server/auth";
export const dynamic = "force-dynamic";
export const GET = handler<{ id: string }>(async ({ req, params }) => ({ intent: await getIntent((await requireSession(req)).userId, params.id) }));
export const POST = handler<{ id: string }>(async ({ req, params }) => {
  const s = await requireSession(req);
  const b = await body(req, z.object({ signature: z.string().max(100) }));
  return submitSignature(s, params.id, b.signature);
});
