import { handler, body } from "@/lib/server/http";
import { getModelRow, listVersions, setPresentation } from "@/lib/server/models";
import { listExperiments } from "@/lib/server/experiments";
import { listTraining } from "@/lib/server/training";
import { pool } from "@/lib/server/db";
import { notFound, forbidden } from "@/lib/server/http";
import { requireSession } from "@/lib/server/auth";
import { PresentationSchema } from "@/lib/schemas";
import type { Presentation } from "@neuron/engine";
export const dynamic = "force-dynamic";
export const GET = handler<{ id: string }>(async ({ params }) => {
  const m = await getModelRow(pool(), params.id);
  if (!m) throw notFound("Model not found.");
  const [versions, experiments, training] = await Promise.all([listVersions(pool(), m.id), listExperiments(pool(), { modelId: m.id, limit: 10 }), listTraining(pool(), { modelId: m.id, limit: 10 })]);
  return { model: m, versions, experiments: experiments.items, training };
});
export const PATCH = handler<{ id: string }>(async ({ req, params }) => {
  const s = await requireSession(req);
  const p = await body(req, PresentationSchema);
  if (!(await setPresentation(pool(), params.id, s.userId, p as Presentation))) throw forbidden("Only the model owner can change its saved presentation.");
  return { ok: true };
});
