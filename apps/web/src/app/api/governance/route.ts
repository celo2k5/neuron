import { handler, body } from "@/lib/server/http";
import { z } from "zod";
import { createProposal, listProposals, RULES, PolicyChange } from "@/lib/server/governance";
import { requireSession } from "@/lib/server/auth";
import { pool } from "@/lib/server/db";
import { rateLimit } from "@/lib/server/ratelimit";
export const dynamic = "force-dynamic";
export const GET = handler(async () => ({
  rules: { ...RULES, proposalThresholdBase: RULES.proposalThresholdBase.toString(), quorumBase: RULES.quorumBase.toString() },
  items: await listProposals(pool()),
}));
export const POST = handler(async ({ req }) => {
  const s = await requireSession(req);
  await rateLimit(`proposal:${s.userId}`, 3, 86400);
  const b = await body(req, z.object({ kind: z.enum(["advisory", "policy"]), title: z.string().min(4).max(120), body: z.string().max(4000), change: PolicyChange.optional() }));
  return createProposal(s, b);
});
