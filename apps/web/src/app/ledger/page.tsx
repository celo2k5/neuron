"use client";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { useConfig } from "@/lib/client/wallet";
import { explorerTx } from "@/components/ExperimentDetail";
import { Empty, ErrorBox, Hash, Panel, Spinner, StatusPill, ago, short, PageHeader } from "@/components/ui";

interface Ledger {
  items: { experiment_id: string; owner_wallet: string; pda: string; signature: string | null; slot: string | null; status: string; cluster: string; model_id: string; result_hash: string; created_at: string }[];
  payments: { signature: string; slot: string; amount: string; mint: string; verified_at: string }[];
  network: { version: number; snapshot_hash: string; neuron_count: number; change: { type: string }; created_at: string }[];
}

export default function LedgerPage() {
  const { data: cfg } = useConfig();
  const q = useQuery({ queryKey: ["ledger"], queryFn: () => api<Ledger>("/api/ledger?limit=30") });
  const [id, setId] = useState("");
  const v = useQuery({ queryKey: ["verify-tool", id], enabled: /^[0-9a-f-]{36}$/i.test(id), queryFn: () => api<{ state: string; note: string; localHashesMatch?: boolean; chain?: { slot: string } | null }>(`/api/commitments/${id}`) });
  return (
    <div className="mx-auto max-w-[1440px] px-5 pb-10 sm:px-8">
      <PageHeader title="What was recorded, and where.">Commitments are read back from the NEURON registry program ({cfg?.programId ? short(cfg.programId, 6) : "not configured"}) on {cfg?.cluster}. Transaction links appear only for signatures that exist on chain. Verification compares hashes; it is not a proof that the computation was correct.</PageHeader>
      {q.error && <ErrorBox error={q.error} />}
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Panel title="experiment commitments" meta={q.data ? `${q.data.items.length} shown` : ""}>
          {q.isLoading ? <Spinner /> : !q.data?.items.length ? <Empty title="no commitments yet">Commit a completed experiment from its page.</Empty> : (
            <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-[12.5px] tnum" data-testid="ledger-table">
              <thead><tr className="text-left text-muted">{["experiment", "model", "result", "owner", "slot", "tx", "status"].map((h) => <th key={h} className="pr-3 font-normal">{h}</th>)}</tr></thead>
              <tbody>{q.data.items.map((c) => (
                <tr key={c.experiment_id} className="border-t border-line">
                  <td className="py-1.5 pr-3"><Link href={`/experiments/${c.experiment_id}`}>{c.experiment_id.slice(0, 8)}</Link></td>
                  <td className="pr-3"><Link href={`/networks/${c.model_id}`}>{c.model_id}</Link></td>
                  <td className="pr-3"><Hash value={c.result_hash} n={5} /></td>
                  <td className="pr-3">{short(c.owner_wallet)}</td>
                  <td className="pr-3">{c.slot ?? "—"}</td>
                  <td className="pr-3">{c.signature ? <a href={explorerTx(c.signature, c.cluster, cfg?.rpc ?? "")} target="_blank" rel="noreferrer">{short(c.signature, 5)}</a> : "—"}</td>
                  <td><StatusPill status={c.status} /></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Panel>
        <div className="flex min-w-0 flex-col gap-6">
          <Panel title="verify any experiment">
            <input className="field tnum" name="experiment-id" autoComplete="off" spellCheck={false} placeholder="60a1f955-90d5-4494-…" value={id} onChange={(e) => setId(e.target.value.trim().toLowerCase())} aria-label="Experiment id" aria-describedby="eid-hint" />
            <p id="eid-hint" className="text-[12px] text-muted" aria-live="polite">{id && !/^[0-9a-f-]{36}$/.test(id) ? "Paste the full 36-character experiment id." : ""}</p>
            {v.isFetching && <div className="mt-2"><Spinner label="reading chain" /></div>}
            {v.error && <div className="mt-2"><ErrorBox error={v.error} /></div>}
            {v.data && <div className="mt-2 text-[12.5px]"><StatusPill status={v.data.state} /> {v.data.chain && <span className="tnum text-muted">slot {v.data.chain.slot}</span>}<p className="mt-1 text-muted">{v.data.note}</p></div>}
          </Panel>
          <Panel title="verified token payments">
            {!q.data?.payments.length ? <p className="text-muted">None yet.</p> : (
              <ul className="text-[12.5px] tnum">{q.data.payments.map((p) => (
                <li key={p.signature} className="flex justify-between border-t border-line py-1 first:border-0"><a href={explorerTx(p.signature, cfg?.cluster ?? "", cfg?.rpc ?? "")} target="_blank" rel="noreferrer">{short(p.signature, 5)}</a><span>{p.amount} base</span><span className="text-faint">{ago(p.verified_at)}</span></li>
              ))}</ul>
            )}
          </Panel>
          <Panel title="community network versions">
            <ul className="text-[12.5px] tnum">{q.data?.network.map((n) => (
              <li key={n.version} className="flex justify-between border-t border-line py-1 first:border-0"><Link href="/community">v{n.version} · {n.change.type}</Link><Hash value={n.snapshot_hash} n={4} /><span className="text-faint">{ago(n.created_at)}</span></li>
            ))}</ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
