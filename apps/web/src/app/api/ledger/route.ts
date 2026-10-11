import { handler, query } from "@/lib/server/http";
import { z } from "zod";
import { ledger } from "@/lib/server/commitments";
import { pool, q } from "@/lib/server/db";
export const dynamic = "force-dynamic";
export const GET = handler(async ({ req }) => {
  const p = query(req, z.object({ limit: z.coerce.number().int().min(1).max(50).default(20), before: z.string().datetime().optional() }));
  const l = await ledger(pool(), p.limit, p.before);
  const payments = await q("select signature, slot, amount, mint, verified_at from token_payments order by verified_at desc limit 10");
  const network = await q("select version, snapshot_hash, neuron_count, change, created_at from network_versions order by created_at desc limit 10");
  return { ...l, payments, network };
});
