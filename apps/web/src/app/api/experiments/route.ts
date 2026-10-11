import { handler, body, query } from "@/lib/server/http";
import { z } from "zod";
import { createExperiment, listExperiments } from "@/lib/server/experiments";
import { currentSession } from "@/lib/server/auth";
import { tx, pool } from "@/lib/server/db";
import { rateLimit, clientKey } from "@/lib/server/ratelimit";
import { CreateExperimentSchema } from "@/lib/schemas";
export const dynamic = "force-dynamic";
export const GET = handler(async ({ req }) => {
  const f = query(req, z.object({ modelId: z.string().max(40).optional(), owner: z.string().max(60).optional(), status: z.enum(["queued", "running", "completed", "failed"]).optional(), limit: z.coerce.number().int().min(1).max(50).default(20), before: z.string().datetime().optional() }));
  return listExperiments(pool(), f);
});
export const POST = handler(async ({ req }) => {
  const s = await currentSession(req);
  // anonymous visitors get a small free allowance by IP; wallets get a daily free tier, then credits
  await rateLimit(`exp:${clientKey(req, s?.userId)}`, s ? 60 : 10, s ? 60 : 3600);
  const b = await body(req, CreateExperimentSchema);
  return tx((db) => createExperiment(db, { ...b, ownerId: s?.userId ?? null }));
});
