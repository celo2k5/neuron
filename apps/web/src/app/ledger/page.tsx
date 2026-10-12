"use client";
import Link from "next/link";
import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import type { Verify } from "@/components/ExperimentDetail";
import { Empty, ErrorBox, Hash, Panel, Spinner, StatusPill, ago, count, short, PageHeader } from "@/components/ui";

interface Ledger {
  items: { seq: string; experiment_id: string; owner_wallet: string; model_id: string; result_hash: string; entry_hash: string; prev_hash: string; key_id: string; created_at: string }[];
  next: number | null;
  chain: { length: number; head: string | null; intact: boolean; firstBadSeq: number | null };
  keys: { id: string; public_key: string; created_at: string }[];
  network: { version: number; snapshot_hash: string; neuron_count: number; change: { type: string }; created_at: string }[];
}

export default function LedgerPage() {
  const q = useInfiniteQuery({
    queryKey: ["ledger"], initialPageParam: 0 as number,
    queryFn: ({ pageParam }) => api<Ledger>(`/api/ledger?limit=30${pageParam ? `&before=${pageParam}` : ""}`),
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const first = q.data?.pages[0];
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const [id, setId] = useState("");
  const valid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
  const v = useQuery({ queryKey: ["verify-tool", id], enabled: valid, queryFn: () => api<Verify>(`/api/commitments/${id}`) });
  return (
    <div className="mx-auto max-w-[1440px] px-5 pb-10 sm:px-8">
      <PageHeader title="What was recorded, and when.">
        Every recorded experiment is an entry in an append-only log. Each entry carries the hash of the one before it and is signed by the registry key, so changing any past entry breaks every link after it. Verification compares hashes; it does not prove the computation was correct.
      </PageHeader>
      {q.error && <ErrorBox error={q.error} />}
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Panel className="self-start" title="registry entries" meta={first ? `${count(first.chain.length)} total` : ""}>
          {q.isLoading ? <Spinner /> : !items.length ? <Empty title="nothing recorded yet">Record a completed experiment from its page.</Empty> : (
            <>
              <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-[12.5px] tnum" data-testid="ledger-table">
                <thead><tr className="text-left text-muted">{["#", "experiment", "model", "result", "entry", "owner", "recorded"].map((h) => <th key={h} className="pr-3 font-normal">{h}</th>)}</tr></thead>
                <tbody>{items.map((c) => (
                  <tr key={c.seq} className="border-t border-line">
                    <td className="py-1.5 pr-3 text-muted">{c.seq}</td>
                    <td className="pr-3"><Link href={`/experiments/${c.experiment_id}`} className="mono">{c.experiment_id.slice(0, 8)}</Link></td>
                    <td className="pr-3"><Link href={`/networks/${c.model_id}`}>{c.model_id}</Link></td>
                    <td className="pr-3"><Hash value={c.result_hash} n={5} /></td>
                    <td className="pr-3"><Hash value={c.entry_hash} n={5} /></td>
                    <td className="pr-3">{short(c.owner_wallet)}</td>
                    <td className="text-faint">{ago(c.created_at)}</td>
                  </tr>
                ))}</tbody>
              </table></div>
              {q.hasNextPage && <button className="act-ghost mt-3" disabled={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>{q.isFetchingNextPage ? "Loading…" : "Load older entries"}</button>}
            </>
          )}
        </Panel>
        <div className="flex min-w-0 flex-col gap-6">
          <Panel title="chain integrity">
            {!first ? <Spinner /> : (
              <div data-testid="chain-integrity">
                <div className="flex items-center gap-2"><StatusPill status={first.chain.intact ? "verified" : "mismatch"} /><span className="text-muted">{first.chain.intact ? (first.chain.length === 1 ? "the entry checks out" : first.chain.length ? `all ${count(first.chain.length)} entries check out` : "empty, nothing to check yet") : `broken at entry #${first.chain.firstBadSeq}`}</span></div>
                <dl className="kv mt-3 text-[12.5px]">
                  <dt>head</dt><dd><Hash value={first.chain.head} /></dd>
                  {first.keys.map((k) => <div key={k.id} className="contents"><dt>key {k.id}</dt><dd><Hash value={k.public_key} /></dd></div>)}
                </dl>
                <p className="mt-2 text-[12px] text-faint">Checked on every load: each entry&apos;s hash, its ed25519 signature, and its link to the previous entry.</p>
              </div>
            )}
          </Panel>
          <Panel title="verify any experiment">
            <input className="field mono" name="experiment-id" autoComplete="off" spellCheck={false} placeholder="60a1f955-90d5-4494-…" value={id} onChange={(e) => setId(e.target.value.trim().toLowerCase())} aria-label="Experiment id" aria-describedby="eid-hint" />
            <p id="eid-hint" className="text-[12px] text-muted" aria-live="polite">{id && !valid ? "Paste the full 36-character experiment id." : ""}</p>
            {v.isFetching && <div className="mt-2"><Spinner label="checking registry" /></div>}
            {v.error && <div className="mt-2"><ErrorBox error={v.error} /></div>}
            {v.data && <div className="mt-2 text-[12.5px]"><StatusPill status={v.data.state} /> {v.data.record && <span className="tnum text-muted">entry #{v.data.record.seq}</span>}<p className="mt-1 text-muted">{v.data.note}</p></div>}
          </Panel>
          <Panel title="community network versions">
            <ul className="text-[12.5px] tnum">{first?.network.map((n) => (
              <li key={n.version} className="flex justify-between border-t border-line py-1 first:border-0"><Link href="/community">v{n.version} · {n.change.type}</Link><Hash value={n.snapshot_hash} n={4} /><span className="text-faint">{ago(n.created_at)}</span></li>
            ))}</ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
