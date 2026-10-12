import { handler } from "@/lib/server/http";
import { requireSession } from "@/lib/server/auth";
import { balance, claimDaily, claimedToday } from "@/lib/server/credits";
import { emit, pool, q, tx } from "@/lib/server/db";
import { env } from "@/lib/server/env";
export const dynamic = "force-dynamic";
export const GET = handler(async ({ req }) => {
  const s = await requireSession(req);
  const events = await q("select kind, amount, ref_type, ref_id, created_at from credit_events where user_id = $1 order by id desc limit 50", [s.userId]);
  return { balance: await balance(pool(), s.userId), events, claimedToday: await claimedToday(pool(), s.userId), dailyClaim: env().DAILY_CLAIM_CREDITS };
});
/** claim today's free credits */
export const POST = handler(async ({ req }) => {
  const s = await requireSession(req);
  const r = await tx(async (db) => {
    const c = await claimDaily(db, s.userId, env().DAILY_CLAIM_CREDITS);
    if (c.claimed) await emit(db, "credits.claimed", s.userId, { amount: c.amount }, s.userId);
    return c;
  });
  return { ...r, balance: await balance(pool(), s.userId) };
});
