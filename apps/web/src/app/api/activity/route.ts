import { handler, query } from "@/lib/server/http";
import { z } from "zod";
import { q } from "@/lib/server/db";
export const dynamic = "force-dynamic";
export const GET = handler(async ({ req }) => {
  const p = query(req, z.object({ after: z.coerce.number().int().min(0).optional(), topic: z.string().max(40).optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }));
  const rows = await q("select id, topic, ref_id, data, created_at from activity_events where ($1::bigint is null or id > $1) and ($2::text is null or topic like $2 || '%') order by id desc limit $3", [p.after ?? null, p.topic ?? null, p.limit]);
  return { items: rows };
});
