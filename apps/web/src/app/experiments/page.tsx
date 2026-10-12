"use client";
import Link from "next/link";
import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import type { ExperimentRow } from "@/lib/client/hooks";
import { useSession } from "@/lib/client/wallet";
import { Empty, ErrorBox, Hash, Skeleton, StatusPill, ago, fmt, short, PageHeader } from "@/components/ui";

export default function ExperimentsPage() {
  const session = useSession();
  const [status, setStatus] = useState("");
  const [mine, setMine] = useState(false);
  const qs = new URLSearchParams({ limit: "20" });
  if (status) qs.set("status", status);
  if (mine && session.data?.session) qs.set("owner", session.data.session.wallet);
  const list = useInfiniteQuery({
    queryKey: ["experiments", qs.toString()], initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api<{ items: ExperimentRow[]; next: string | null }>(`/api/experiments?${qs}${pageParam ? `&before=${encodeURIComponent(new Date(pageParam).toISOString())}` : ""}`),
    getNextPageParam: (l) => l.next,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="mx-auto max-w-[1440px] px-5 pb-10 sm:px-8">
      <PageHeader title="Experiment record">Every saved run pins one immutable model version. Statuses come from the job queue: queued, running, completed or failed.</PageHeader>
      {list.error && <ErrorBox error={list.error} />}
      <section className="panel overflow-hidden">
        <div className="panel-h flex-wrap gap-3 py-2">
          <h2 className="label">All runs</h2>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-[12.5px] text-muted">Status
              <select className="field !h-8 !w-auto" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option><option value="queued">Queued</option><option value="running">Running</option><option value="completed">Completed</option><option value="failed">Failed</option></select></label>
            <label className="flex items-center gap-2 text-[12.5px] text-muted"><input type="checkbox" disabled={!session.data?.session} checked={mine} onChange={(e) => setMine(e.target.checked)} /> Mine only</label>
          </div>
        </div>
        <div className="overflow-x-auto px-[18px] pt-3">
          <table className="w-full min-w-[880px] text-[13px] tnum" data-testid="experiments-table">
            <thead><tr>{["Experiment", "Model", "Input", "Output", "Result hash", "Elapsed", "Owner", "When", "Status"].map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {list.isLoading && Array.from({ length: 6 }, (_, i) => <tr key={i}><td colSpan={9}><Skeleton h={14} /></td></tr>)}
              {items.map((e) => (
                <tr key={e.id} className="border-t border-line">
                  <td><Link href={`/experiments/${e.id}`} className="mono">{e.id.slice(0, 8)}</Link>{e.reproduced_from && <span className="pill ml-2 text-muted">Repro</span>}</td>
                  <td><Link href={`/networks/${e.model_id}`} className="mono no-underline hover:underline">{e.model_id}</Link> <span className="text-muted">v{e.version}</span></td>
                  <td className="text-muted capitalize">{e.input_source} · {e.input.length}d</td>
                  <td>{e.output ? `[${e.output.slice(0, 3).map((v) => fmt(v, 3)).join(", ")}${e.output.length > 3 ? "…" : ""}]` : "—"}</td>
                  <td><Hash value={e.result_hash} n={5} /></td>
                  <td>{e.elapsed_ms !== null ? `${fmt(e.elapsed_ms, 2)} ms` : "—"}</td>
                  <td className="mono text-muted">{e.owner_wallet ? short(e.owner_wallet) : "anon"}</td>
                  <td className="text-muted">{ago(e.created_at)}</td>
                  <td><StatusPill status={e.commitment_status === "verified" ? "verified" : e.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.hasNextPage && <div className="border-t border-line px-[18px] py-3"><button className="act-ghost sm" disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>{list.isFetchingNextPage ? "Loading…" : "Load older runs"}</button></div>}
      </section>
      {!list.isLoading && items.length === 0 && <Empty title="no experiments yet">Run one in the lab with “save to the experiment record” ticked.</Empty>}
    </div>
  );
}
