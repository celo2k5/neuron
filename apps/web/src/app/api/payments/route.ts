import { handler, body } from "@/lib/server/http";
import { z } from "zod";
import { createIntent, listIntents } from "@/lib/server/payments";
import { requireSession } from "@/lib/server/auth";
import { rateLimit } from "@/lib/server/ratelimit";
export const dynamic = "force-dynamic";
export const GET = handler(async ({ req }) => ({ items: await listIntents((await requireSession(req)).userId) }));
export const POST = handler(async ({ req }) => {
  const s = await requireSession(req);
  await rateLimit(`pay:${s.userId}`, 10, 600);
  const b = await body(req, z.object({ credits: z.number().int().min(1).max(10000) }));
  return createIntent(s, b.credits);
});
