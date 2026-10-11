import { handler } from "@/lib/server/http";
import { requireSession } from "@/lib/server/auth";
import { balance } from "@/lib/server/credits";
import { pool, q } from "@/lib/server/db";
export const dynamic = "force-dynamic";
export const GET = handler(async ({ req }) => {
  const s = await requireSession(req);
  const events = await q("select kind, amount, ref_type, ref_id, created_at from credit_events where user_id = $1 order by id desc limit 50", [s.userId]);
  return { balance: await balance(pool(), s.userId), events };
});
