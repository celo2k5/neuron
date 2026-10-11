import { handler, body } from "@/lib/server/http";
import { createModel, getModelRow } from "@/lib/server/models";
import { requireSession } from "@/lib/server/auth";
import { tx, pool } from "@/lib/server/db";
import { notFound } from "@/lib/server/http";
import { ModelConfigSchema } from "@/lib/schemas";
import type { ModelConfig } from "@neuron/engine";
export const dynamic = "force-dynamic";
/** Fork = clone the configuration with edits; the result is a new deterministic model. */
export const POST = handler<{ id: string }>(async ({ req, params }) => {
  const s = await requireSession(req);
  const src = await getModelRow(pool(), params.id);
  if (!src) throw notFound();
  const edits = await body(req, ModelConfigSchema.partial().strict());
  const config = ModelConfigSchema.parse({ ...src.config, ...edits }) as ModelConfig;
  return tx((db) => createModel(db, config, src.presentation, s.userId, src.id));
});
