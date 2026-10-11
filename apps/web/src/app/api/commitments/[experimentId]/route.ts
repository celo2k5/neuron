import { handler, body } from "@/lib/server/http";
import { z } from "zod";
import { prepareCommit, submitCommit, verifyExperiment } from "@/lib/server/commitments";
import { requireSession } from "@/lib/server/auth";
import { rateLimit, clientKey } from "@/lib/server/ratelimit";
export const dynamic = "force-dynamic";
/** public verification */
export const GET = handler<{ experimentId: string }>(async ({ req, params }) => {
  await rateLimit(`verify:${clientKey(req)}`, 60, 60);
  return verifyExperiment(params.experimentId);
});
/** prepare an unsigned commit transaction for the owner's wallet */
export const POST = handler<{ experimentId: string }>(async ({ req, params }) => prepareCommit(await requireSession(req), params.experimentId));
/** report the signature after the wallet sent it */
export const PUT = handler<{ experimentId: string }>(async ({ req, params }) => {
  const s = await requireSession(req);
  const b = await body(req, z.object({ signature: z.string().max(100) }));
  return submitCommit(s, params.experimentId, b.signature);
});
