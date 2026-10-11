import { handler, body, query } from "@/lib/server/http";
import { z } from "zod";
import { startTraining, listTraining } from "@/lib/server/training";
import { requireSession } from "@/lib/server/auth";
import { tx, pool } from "@/lib/server/db";
import { rateLimit } from "@/lib/server/ratelimit";
import { TrainingSchema } from "@/lib/schemas";
import type { DatasetId } from "@neuron/engine";
export const dynamic = "force-dynamic";
export const GET = handler(async ({ req }) => {
  const f = query(req, z.object({ modelId: z.string().max(40).optional(), limit: z.coerce.number().int().min(1).max(50).default(20) }));
  return { items: await listTraining(pool(), f) };
});
export const POST = handler(async ({ req }) => {
  const s = await requireSession(req);
  await rateLimit(`train:${s.userId}`, 10, 3600);
  const b = await body(req, TrainingSchema);
  return tx((db) => startTraining(db, s.userId, { ...b, dataset: b.dataset as DatasetId }));
});
