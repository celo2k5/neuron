import { handler, body } from "@/lib/server/http";
import { z } from "zod";
import { updateNeuron, retireNeuron } from "@/lib/server/community";
import { requireSession } from "@/lib/server/auth";
import { NeuronSchema, SignedActionSchema } from "@/lib/schemas";
export const dynamic = "force-dynamic";
export const PATCH = handler<{ id: string }>(async ({ req, params }) => {
  const s = await requireSession(req);
  const b = await body(req, z.object({ neuron: NeuronSchema, signed: SignedActionSchema }));
  return updateNeuron(s, params.id, b.neuron as { layer: 1 | 2; bias: number; seed: string; scale: number }, b.signed);
});
export const DELETE = handler<{ id: string }>(async ({ req, params }) => retireNeuron(await requireSession(req), params.id));
