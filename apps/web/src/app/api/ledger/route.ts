import { handler, query } from "@/lib/server/http";
import { z } from "zod";
import { ledger, registryKeys, verifyChain } from "@/lib/server/commitments";
import { pool, q } from "@/lib/server/db";
export const dynamic = "force-dynamic";
export const GET = handler(async ({ req }) => {
  const p = query(req, z.object({ limit: z.coerce.number().int().min(1).max(50).default(20), before: z.coerce.number().int().min(1).optional() }));
  const db = pool();
  const [l, chain, keys, network] = await Promise.all([
    ledger(db, p.limit, p.before), verifyChain(db), registryKeys(db),
    q("select version, snapshot_hash, neuron_count, change, created_at from network_versions order by created_at desc limit 10"),
  ]);
  return { ...l, chain, keys, network };
});
