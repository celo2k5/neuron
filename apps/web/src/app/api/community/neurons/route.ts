import { handler, body } from "@/lib/server/http";
import { z } from "zod";
import { registerNeuron } from "@/lib/server/community";
import { requireSession } from "@/lib/server/auth";
import { rateLimit } from "@/lib/server/ratelimit";
import { NeuronSchema, SignedActionSchema } from "@/lib/schemas";
export const dynamic = "force-dynamic";
export const POST = handler(async ({ req }) => {
  const s = await requireSession(req);
  await rateLimit(`neuron:${s.userId}`, 10, 3600);
  const b = await body(req, z.object({ neuron: NeuronSchema, signed: SignedActionSchema }));
  return registerNeuron(s, b.neuron as { layer: 1 | 2; bias: number; seed: string; scale: number }, b.signed);
});
