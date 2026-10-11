import { handler, body } from "@/lib/server/http";
import { z } from "zod";
import { importModel, generateModel, type ModelArtifact } from "@neuron/engine";
import { createModel } from "@/lib/server/models";
import { requireSession } from "@/lib/server/auth";
import { tx } from "@/lib/server/db";
import { bad } from "@/lib/server/http";
export const dynamic = "force-dynamic";
/**
 * Import a declarative artifact. Only untrained artifacts that regenerate bit-for-bit from their
 * config are accepted as new models; anything else is rejected (no arbitrary weight uploads).
 */
export const POST = handler(async ({ req }) => {
  const s = await requireSession(req);
  const a = await body(req, z.object({ artifact: z.record(z.unknown()) }));
  const m = importModel(a.artifact as unknown as ModelArtifact);
  if (generateModel(m.config).artifactHash !== m.artifactHash) throw bad("Artifact weights do not match its seed + config. Only reproducible (untrained) artifacts can be imported.");
  return tx((db) => createModel(db, m.config, undefined, s.userId));
});
