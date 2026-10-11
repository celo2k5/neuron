import { handler } from "@/lib/server/http";
import { createExperiment, getExperiment } from "@/lib/server/experiments";
import { currentSession } from "@/lib/server/auth";
import { tx, pool } from "@/lib/server/db";
import { conflict } from "@/lib/server/http";
import { rateLimit, clientKey } from "@/lib/server/ratelimit";
export const dynamic = "force-dynamic";
/** Re-run the same pinned model version on the same input and compare within documented tolerance. */
export const POST = handler<{ id: string }>(async ({ req, params }) => {
  const s = await currentSession(req);
  await rateLimit(`repro:${clientKey(req, s?.userId)}`, 20, 600);
  const e = await getExperiment(pool(), params.id);
  if (e.status !== "completed") throw conflict("Only completed experiments can be reproduced.");
  return tx((db) => createExperiment(db, { modelId: e.model_id, version: e.version, input: e.input, inputSource: e.input_source as "manual", inputSeed: e.input_seed ?? undefined, ownerId: s?.userId ?? null, reproducedFrom: e.id }));
});
