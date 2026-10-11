import { handler, body } from "@/lib/server/http";
import { z } from "zod";
import { castVote } from "@/lib/server/governance";
import { requireSession } from "@/lib/server/auth";
import { SignedActionSchema } from "@/lib/schemas";
export const dynamic = "force-dynamic";
export const POST = handler<{ id: string }>(async ({ req, params }) => {
  const s = await requireSession(req);
  const b = await body(req, z.object({ choice: z.enum(["for", "against", "abstain"]), signed: SignedActionSchema }));
  return castVote(s, params.id, b.choice, b.signed);
});
