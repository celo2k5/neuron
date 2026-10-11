"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { ErrorBox, Panel, Spinner, fmt } from "@/components/ui";

interface Metrics {
  cluster: string; queue: { kind: string; status: string; n: number }[]; experimentLatencyMs: { p50: number | null; p95: number | null; n: number } | null;
  failures: { experiments: number; training: number; dead: number }; payments: { pending: number; submitted: number; stale: number }; computeMsLastHour: number;
  rpc: { ok: boolean; slot?: number; latencyMs: number; error?: string }; indexer: { lastSlot: string | null; updatedAt: string | null; lagSlots: number | null }; commitmentsPending: number; sseConnections: number; alerts: string[];
}

export default function Ops() {
  const q = useQuery({ queryKey: ["metrics"], queryFn: () => api<Metrics>("/api/metrics"), refetchInterval: 5000 });
  const m = q.data;
  return (
    <div className="mx-auto max-w-[1200px] px-5 pt-14 sm:px-8">
      <h1 className="display mt-2 text-[clamp(44px,5.2vw,76px)]">Instrument health.</h1>
      {q.error && <ErrorBox error={q.error} />}
      {!m ? <Spinner /> : (
        <div className="mt-6 grid gap-6 md:grid-cols-2" data-testid="ops">
          <Panel title="alerts">{m.alerts.length ? <ul className="text-bad">{m.alerts.map((a) => <li key={a}>▲ {a}</li>)}</ul> : <p className="text-good">No thresholds breached.</p>}</Panel>
          <Panel title="queue"><table className="w-full text-[12.5px] tnum"><tbody>{m.queue.map((r) => <tr key={r.kind + r.status} className="border-t border-line first:border-0"><td>{r.kind}</td><td>{r.status}</td><td className="text-right">{r.n}</td></tr>)}</tbody></table></Panel>
          <Panel title="latency & compute"><dl className="kv text-[12.5px]"><dt>exp p50</dt><dd>{fmt(m.experimentLatencyMs?.p50, 3)} ms</dd><dt>exp p95</dt><dd>{fmt(m.experimentLatencyMs?.p95, 3)} ms</dd><dt>runs/h</dt><dd>{m.experimentLatencyMs?.n ?? 0}</dd><dt>train cpu/h</dt><dd>{fmt(m.computeMsLastHour / 1000, 1)} s</dd></dl></Panel>
          <Panel title="failures (1h)"><dl className="kv text-[12.5px]"><dt>experiments</dt><dd>{m.failures.experiments}</dd><dt>training</dt><dd>{m.failures.training}</dd><dt>dead jobs</dt><dd>{m.failures.dead}</dd></dl></Panel>
          <Panel title="chain"><dl className="kv text-[12.5px]"><dt>cluster</dt><dd>{m.cluster}</dd><dt>rpc</dt><dd className={m.rpc.ok ? "text-good" : "text-bad"}>{m.rpc.ok ? `slot ${m.rpc.slot} · ${m.rpc.latencyMs} ms` : m.rpc.error}</dd><dt>indexer slot</dt><dd>{m.indexer.lastSlot ?? "—"}</dd><dt>indexer lag</dt><dd>{m.indexer.lagSlots ?? "—"} slots</dd><dt>pending commits</dt><dd>{m.commitmentsPending}</dd></dl></Panel>
          <Panel title="payments & realtime"><dl className="kv text-[12.5px]"><dt>pending</dt><dd>{m.payments.pending}</dd><dt>submitted</dt><dd>{m.payments.submitted}</dd><dt>stale &gt;10m</dt><dd>{m.payments.stale}</dd><dt>sse streams</dt><dd>{m.sseConnections}</dd></dl></Panel>
        </div>
      )}
    </div>
  );
}
