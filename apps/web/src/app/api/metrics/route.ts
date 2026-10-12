import { handler } from "@/lib/server/http";
import { q, one, pool } from "@/lib/server/db";
import { verifyChain } from "@/lib/server/commitments";
import { sseConnections } from "@/lib/server/sse";
export const dynamic = "force-dynamic";
/** Operational metrics with alert thresholds (see docs/RUNBOOK.md). */
export const GET = handler(async () => {
  const queue = await q<{ kind: string; status: string; n: number }>("select kind, status, count(*)::int as n from jobs group by kind, status");
  const latency = await one<{ p50: number; p95: number; n: number }>(
    "select percentile_cont(0.5) within group (order by elapsed_ms) as p50, percentile_cont(0.95) within group (order by elapsed_ms) as p95, count(*)::int as n from experiments where completed_at > now() - interval '1 hour' and status = 'completed'");
  const failures = await one<{ experiments: number; training: number; dead: number }>(
    `select (select count(*)::int from experiments where status = 'failed' and created_at > now() - interval '1 hour') as experiments,
            (select count(*)::int from training_jobs where status = 'failed' and created_at > now() - interval '1 hour') as training,
            (select count(*)::int from jobs where status = 'dead') as dead`);
  const compute = await one<{ ms: number }>("select coalesce(sum((resource->>'ms')::float),0) as ms from training_jobs where updated_at > now() - interval '1 hour'");
  const registry = await verifyChain(pool());
  const claims = await one<{ n: number }>("select count(*)::int as n from credit_events where kind = 'claim' and created_at > now() - interval '24 hours'");
  const alerts: string[] = [];
  const depth = queue.filter((r) => r.status === "queued").reduce((s, r) => s + r.n, 0);
  if (depth > 100) alerts.push(`queue depth ${depth} > 100`);
  if ((failures?.dead ?? 0) > 0) alerts.push(`${failures!.dead} dead-lettered jobs`);
  if (!registry.intact) alerts.push(`registry chain broken at entry ${registry.firstBadSeq}`);
  if (latency?.p95 && latency.p95 > 500) alerts.push(`experiment p95 ${Math.round(latency.p95)}ms > 500ms`);
  return { queue, experimentLatencyMs: latency, failures, computeMsLastHour: compute?.ms ?? 0, registry, claimsLast24h: claims?.n ?? 0,
    sseConnections: sseConnections(), alerts };
});
