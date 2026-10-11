import { handler, body, query } from "@/lib/server/http";
import { z } from "zod";
import { createModel, listModels } from "@/lib/server/models";
import { currentSession } from "@/lib/server/auth";
import { tx, pool } from "@/lib/server/db";
import { rateLimit, clientKey } from "@/lib/server/ratelimit";
import { CreateModelSchema } from "@/lib/schemas";
import type { ModelConfig, Presentation } from "@neuron/engine";
export const dynamic = "force-dynamic";
export const GET = handler(async ({ req }) => {
  const f = query(req, z.object({
    q: z.string().max(60).optional(), architecture: z.enum(["feedforward", "sparse", "residual"]).optional(), owner: z.string().max(60).optional(),
    trained: z.enum(["yes", "no"]).optional(), sort: z.enum(["newest", "oldest", "params", "neurons"]).default("newest"),
    limit: z.coerce.number().int().min(1).max(48).default(12), cursor: z.string().max(200).optional(),
  }));
  return listModels(pool(), f);
});
export const POST = handler(async ({ req }) => {
  const s = await currentSession(req);
  await rateLimit(`model:${clientKey(req, s?.userId)}`, 20, 60);
  const b = await body(req, CreateModelSchema);
  return tx((db) => createModel(db, b.config as ModelConfig, b.presentation as Presentation | undefined, s?.userId ?? null, b.forkedFrom));
});
