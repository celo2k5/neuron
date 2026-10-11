import { handler, body } from "@/lib/server/http";
import { z } from "zod";
import { issueChallenge } from "@/lib/server/auth";
import { rateLimit, clientKey } from "@/lib/server/ratelimit";
import { neuronPayloadHash } from "@/lib/server/community";
import { votePayloadHash } from "@/lib/server/governance";
import { NeuronSchema } from "@/lib/schemas";
export const dynamic = "force-dynamic";
const S = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("sign-in"), wallet: z.string().max(60) }),
  z.object({ intent: z.literal("register-neuron"), wallet: z.string().max(60), neuron: NeuronSchema }),
  z.object({ intent: z.literal("update-neuron"), wallet: z.string().max(60), neuron: NeuronSchema, neuronId: z.string().max(40) }),
  z.object({ intent: z.literal("vote"), wallet: z.string().max(60), proposalId: z.string().uuid(), choice: z.enum(["for", "against", "abstain"]) }),
]);
/** The server computes the payload hash from the action itself, so the signature binds exactly that action. */
export const POST = handler(async ({ req }) => {
  const b = await body(req, S);
  await rateLimit(`challenge:${clientKey(req)}`, 30, 60);
  const payload = b.intent === "register-neuron" ? neuronPayloadHash("register", b.neuron)
    : b.intent === "update-neuron" ? neuronPayloadHash("update", { ...b.neuron, id: b.neuronId })
    : b.intent === "vote" ? votePayloadHash(b.proposalId, b.choice) : undefined;
  return issueChallenge(b.wallet, b.intent, payload);
});
