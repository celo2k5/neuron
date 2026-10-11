import { handler, query } from "@/lib/server/http";
import { z } from "zod";
import { networkState } from "@/lib/server/community";
import { pool } from "@/lib/server/db";
export const dynamic = "force-dynamic";
export const GET = handler(async ({ req }) => {
  const p = query(req, z.object({ version: z.coerce.number().int().min(1).optional() }));
  return networkState(pool(), p.version);
});
