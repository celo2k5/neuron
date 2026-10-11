"use client";
import Link from "next/link";
import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import type { ExperimentRow } from "@/lib/client/hooks";
import { useSession } from "@/lib/client/wallet";
import { Empty, ErrorBox, Hash, Scramble, Skeleton, StatusPill, ago, fmt, short } from "@/components/ui";

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
    <div className="mx-auto max-w-[1440px] px-5 pt-14 sm:px-8">
      <Scramble as="h1" text="Experiment record" className="display mt-2 block text-[clamp(44px,5.2vw,76px)]" />
      <p className="mt-2 max-w-[70ch] text-muted">Every saved run pins one immutable model version. Statuses come from the job queue: queued, running, completed or failed.</p>
      <div className="mt-6 flex flex-wrap items-end gap-3 border-y border-line py-2">
        <label className="flex flex-col gap-1"><span className="label !text-[11px]">status</span>
          <select className="field" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">all</option><option>queued</option><option>running</option><option>completed</option><option>failed</option></select></label>
        <label className="flex items-center gap-2 pb-1.5 text-[12.5px]"><input type="checkbox" disabled={!session.data?.session} checked={mine} onChange={(e) => setMine(e.target.checked)} /> mine only</label>
      </div>
      {list.error && <ErrorBox error={list.error} />}
      <div className="overflow-x-auto">
        <table className="mt-2 w-full min-w-[820px] text-[12.5px] tnum" data-testid="experiments-table">
          <thead><tr className="text-left text-muted">{["experiment", "model", "input", "output", "result hash", "elapsed", "owner", "when", "status"].map((h) => <th key={h} className="py-1 pr-3 font-normal">{h}</th>)}</tr></thead>
          <tbody>
            {list.isLoading && Array.from({ length: 6 }, (_, i) => <tr key={i}><td colSpan={9} className="py-1"><Skeleton h={14} /></td></tr>)}
            {items.map((e) => (
              <tr key={e.id} className="border-t border-line hover:bg-surface/40">
                <td className="py-1.5 pr-3"><Link href={`/experiments/${e.id}`}>{e.id.slice(0, 8)}</Link>{e.reproduced_from && <span className="ml-1 text-faint">repro</span>}</td>
                <td className="pr-3"><Link href={`/networks/${e.model_id}`}>{e.model_id}</Link> v{e.version}</td>
                <td className="pr-3 text-muted">{e.input_source} · {e.input.length}d</td>
                <td className="pr-3">{e.output ? `[${e.output.slice(0, 3).map((v) => fmt(v, 3)).join(", ")}${e.output.length > 3 ? "…" : ""}]` : "—"}</td>
                <td className="pr-3"><Hash value={e.result_hash} n={5} /></td>
                <td className="pr-3">{e.elapsed_ms !== null ? `${fmt(e.elapsed_ms, 2)} ms` : "—"}</td>
                <td className="pr-3 text-muted">{e.owner_wallet ? short(e.owner_wallet) : "anon"}</td>
                <td className="pr-3 text-muted">{ago(e.created_at)}</td>
                <td><StatusPill status={e.commitment_status === "verified" ? "verified" : e.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!list.isLoading && items.length === 0 && <Empty title="no experiments yet">Run one in the lab with “save to the experiment record” ticked.</Empty>}
      {list.hasNextPage && <button className="act mt-3" onClick={() => list.fetchNextPage()}>older</button>}
    </div>
  );
}
