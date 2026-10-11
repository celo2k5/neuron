import { handler } from "@/lib/server/http";
import { q, one } from "@/lib/server/db";
import { rpcHealth, connection } from "@/lib/server/chain";
import { env } from "@/lib/server/env";
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
  const payments = await one<{ pending: number; submitted: number; stale: number }>(
    `select count(*) filter (where status = 'pending')::int as pending, count(*) filter (where status = 'submitted')::int as submitted,
            count(*) filter (where status = 'submitted' and updated_at < now() - interval '10 minutes')::int as stale from payment_intents`);
  const compute = await one<{ ms: number }>("select coalesce(sum((resource->>'ms')::float),0) as ms from training_jobs where updated_at > now() - interval '1 hour'");
  const rpc = await rpcHealth();
  const idx = await one<{ last_slot: string | null; updated_at: string }>("select last_slot, updated_at from indexer_state where id = 'registry'");
  const commitmentsPending = await one<{ n: number }>("select count(*)::int as n from commitments where status in ('pending','confirmed')");
  const indexerLagSlots = rpc.ok && idx?.last_slot ? Number(rpc.slot) - Number(idx.last_slot) : null;
  const alerts: string[] = [];
  const depth = queue.filter((r) => r.status === "queued").reduce((s, r) => s + r.n, 0);
  if (depth > 100) alerts.push(`queue depth ${depth} > 100`);
  if ((failures?.dead ?? 0) > 0) alerts.push(`${failures!.dead} dead-lettered jobs`);
  if ((payments?.stale ?? 0) > 0) alerts.push(`${payments!.stale} payments unreconciled for >10 min`);
  if (!rpc.ok) alerts.push("RPC unreachable");
  else if (rpc.latencyMs > 2000) alerts.push(`RPC latency ${rpc.latencyMs}ms > 2000ms`);
  if (latency?.p95 && latency.p95 > 500) alerts.push(`experiment p95 ${Math.round(latency.p95)}ms > 500ms`);
  void connection;
  return { cluster: env().SOLANA_CLUSTER, queue, experimentLatencyMs: latency, failures, payments, computeMsLastHour: compute?.ms ?? 0, rpc,
    indexer: { lastSlot: idx?.last_slot ?? null, updatedAt: idx?.updated_at ?? null, lagSlots: indexerLagSlots }, commitmentsPending: commitmentsPending?.n ?? 0,
    sseConnections: sseConnections(), alerts };
});
