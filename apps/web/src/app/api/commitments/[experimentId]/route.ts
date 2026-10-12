import { handler } from "@/lib/server/http";
import { commit, verifyExperiment } from "@/lib/server/commitments";
import { requireSession } from "@/lib/server/auth";
import { rateLimit, clientKey } from "@/lib/server/ratelimit";
export const dynamic = "force-dynamic";
/** public verification against the server registry */
export const GET = handler<{ experimentId: string }>(async ({ req, params }) => {
  await rateLimit(`verify:${clientKey(req)}`, 60, 60);
  return verifyExperiment(params.experimentId);
});
/** record the owner's completed experiment in the signed, hash-chained registry */
export const POST = handler<{ experimentId: string }>(async ({ req, params }) => {
  const s = await requireSession(req);
  await rateLimit(`commit:${s.userId}`, 60, 3600);
  return commit(s, params.experimentId);
});
