"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { VisualForm } from "@neuron/engine";
import { api } from "@/lib/client/api";
import { useExperiment, useModelArtifact, useModelDetail } from "@/lib/client/hooks";
import { useConfig, useNeuronWallet, useSession } from "@/lib/client/wallet";
import { GraphCanvas } from "./GraphCanvas";
import { ErrorBox, Hash, Panel, Spinner, StatusPill, VectorBars, fmt, short, When } from "./ui";

interface Verify {
  state: string; localHashesMatch?: boolean; note: string; hashes?: { resultHash: string; metadataHash: string; artifactHash: string };
  chain?: { owner: string; resultHash: string; slot: string; unixTimestamp: string; pda: string } | null; signature?: string | null; programId?: string; cluster?: string; pda?: string;
}

export function explorerTx(sig: string, cluster: string, rpc: string) {
  const c = cluster === "localnet" ? `?cluster=custom&customUrl=${encodeURIComponent(rpc)}` : cluster === "devnet" ? "?cluster=devnet" : "";
  return `https://explorer.solana.com/tx/${sig}${c}`;
}

export function ExperimentDetail({ id }: { id: string }) {
  const { data: e, error, isLoading } = useExperiment(id);
  const model = useModelDetail(e?.model_id ?? null);
  const art = useModelArtifact(e?.model_id ?? null, e?.version);
  const session = useSession();
  const { data: cfg } = useConfig();
  const wallet = useNeuronWallet();
  const qc = useQueryClient();
  const router = useRouter();
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const verify = useQuery({ queryKey: ["verify", id], enabled: e?.status === "completed", queryFn: () => api<Verify>(`/api/commitments/${id}`) });
  const acts = useMemo(() => (e?.activation_summary?.every((l) => l.values) ? e.activation_summary.map((l) => l.values!) : null), [e]);

  if (isLoading) return <div className="p-8"><Spinner label="loading experiment" /></div>;
  if (error || !e) return <div className="mx-auto max-w-[900px] p-8"><ErrorBox error={error ?? { message: "Not found" }} /></div>;
  const isOwner = e.owner_wallet && e.owner_wallet === session.data?.session?.wallet;

  const reproduce = async () => {
    setErr(null); setBusy("repro");
    try { const r = await api<{ id: string }>(`/api/experiments/${id}/reproduce`, { method: "POST" }); router.push(`/experiments/${r.id}`); }
    catch (x) { setErr(x); } finally { setBusy(null); }
  };
  const commit = async () => {
    setErr(null); setBusy("commit");
    try {
      if (wallet.address !== session.data?.session?.wallet) throw new Error("Connect the wallet that owns this experiment.");
      const p = await api<{ transaction: string }>(`/api/commitments/${id}`, { method: "POST" });
      const sig = await wallet.sendTransaction(p.transaction);
      await wallet.connection!.confirmTransaction(sig, "confirmed");
      await api(`/api/commitments/${id}`, { method: "PUT", json: { signature: sig } });
      await Promise.all([qc.invalidateQueries({ queryKey: ["verify", id] }), qc.invalidateQueries({ queryKey: ["experiment", id] })]);
    } catch (x) { setErr(x); } finally { setBusy(null); }
  };

  return (
    <div className="mx-auto max-w-[1440px] px-5 pt-14 sm:px-8">
      <div className="label"><Link href="/experiments">experiments</Link> / {id.slice(0, 8)}</div>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <h1 className="display text-[40px] tnum">EXP·{id.slice(0, 8).toUpperCase()}</h1>
        <div className="flex items-center gap-3"><StatusPill status={e.status} />{e.status === "completed" && <button className="act-ghost" disabled={!!busy} onClick={reproduce} data-testid="reproduce">{busy === "repro" ? "queuing…" : "reproduce"}</button>}</div>
      </div>
      <ErrorBox error={err} />
      <ol className="mt-4 flex flex-wrap gap-0 border border-line text-[12px]" aria-label="Pipeline">
        {["select version", "validate input", "execute", "record activations", "compute output", "persist", "render"].map((s, i) => {
          const done = e.status === "completed" || (e.status === "running" && i < 2) || (e.status === "failed" && i < 2);
          return <li key={s} className={`flex-1 border-r border-line px-2 py-1.5 last:border-r-0 ${done ? "text-fg" : "text-faint"} ${e.status === "failed" && i === 2 ? "text-bad" : ""}`}><span className="tnum text-faint">{i + 1}</span> {s}<span className="sr-only">{e.status === "failed" && i === 2 ? ", failed" : done ? ", done" : ", pending"}</span></li>;
        })}
      </ol>
      <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="panel relative min-h-[440px] overflow-hidden">
          {art.data ? <GraphCanvas model={art.data} form={(model.data?.model.presentation.form as VisualForm) ?? "MINIMAL"} activations={acts} className="absolute inset-0" /> : <div className="p-6"><Spinner label="loading pinned artifact" /></div>}
          {!acts && e.status === "completed" && <p className="absolute bottom-2 left-3 text-[11.5px] text-faint">Layers wider than 64 store summaries only; the animation is disabled for this run.</p>}
        </div>
        <div className="panel flex flex-col gap-4 p-5 text-[13px]">
          <dl className="kv" data-testid="experiment-provenance">
            <dt>model</dt><dd><Link href={`/networks/${e.model_id}`}>{e.model_id}</Link> v{e.version}</dd>
            <dt>artifact</dt><dd><Hash value={e.artifact_hash} /></dd>
            <dt>engine</dt><dd>{e.engine ?? "—"}</dd>
            <dt>input</dt><dd>{e.input_source}{e.input_seed ? ` · ${e.input_seed}` : ""}</dd>
            <dt>owner</dt><dd>{e.owner_wallet ? short(e.owner_wallet, 6) : "anonymous"}</dd>
            <dt>job</dt><dd className="tnum">{e.job_id?.slice(0, 8) ?? "—"}</dd>
            <dt>created</dt><dd><When iso={e.created_at} /></dd>
            <dt>completed</dt><dd><When iso={e.completed_at} /></dd>
            <dt>elapsed</dt><dd>{e.elapsed_ms !== null ? `${fmt(e.elapsed_ms, 3)} ms (server)` : "—"}</dd>
            <dt>result</dt><dd><Hash value={e.result_hash} /></dd>
            <dt>metadata</dt><dd><Hash value={e.metadata_hash} /></dd>
            <dt>activations</dt><dd><Hash value={e.activations_hash} /></dd>
          </dl>
          {e.error && <ErrorBox error={{ message: e.error }} />}
          {e.repro && (
            <div className={`border p-2 ${e.repro.match === "mismatch" ? "border-bad text-bad" : "border-good/60"}`} data-testid="repro-result">
              <div className="label">reproduction of <Link href={`/experiments/${e.reproduced_from}`}>{e.reproduced_from?.slice(0, 8)}</Link></div>
              <div className="mt-1">{e.repro.match === "exact" ? "Bit-identical output." : e.repro.match === "within_tolerance" ? "Matches within tolerance." : "Outputs differ beyond tolerance."} max |Δ| {e.repro.maxAbsDiff.toExponential(2)} · same hash: {String(e.repro.sameHash)}</div>
            </div>
          )}
        </div>
      </div>

      {e.status === "completed" && e.output && (
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Panel title="input → output">
            <div className="label mb-1">input</div><VectorBars values={e.input} color="var(--accent-2)" />
            <div className="tnum mt-1 break-all text-muted">[{e.input.join(", ")}]</div>
            <div className="label mb-1 mt-3">output</div><VectorBars values={e.output} />
            <ul className="tnum mt-1" data-testid="server-output">{e.output.map((v, i) => <li key={i} className="flex justify-between"><span>y{i}</span><span>{v}</span></li>)}</ul>
          </Panel>
          <Panel title="activation summary per layer">
            <table className="w-full text-[12.5px] tnum"><thead><tr className="text-left text-muted"><th className="font-normal">layer</th><th className="font-normal">min</th><th className="font-normal">mean</th><th className="font-normal">max</th><th className="w-[40%] font-normal" /></tr></thead>
              <tbody>{e.activation_summary?.map((l) => (
                <tr key={l.layer} className="border-t border-line"><td>L{l.layer}</td><td>{fmt(l.min, 4)}</td><td>{fmt(l.mean, 4)}</td><td>{fmt(l.max, 4)}</td><td>{l.values && <VectorBars values={l.values} height={14} />}</td></tr>
              ))}</tbody></table>
          </Panel>
          <Panel title="on-chain commitment" meta={cfg?.programId ? `program ${short(cfg.programId, 5)}` : "not configured"} className="lg:col-span-2">
            {verify.isLoading ? <Spinner label="checking chain" /> : verify.error ? <ErrorBox error={verify.error} /> : verify.data && (
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" data-testid="verification">
                <div>
                  <div className="flex items-center gap-2"><StatusPill status={verify.data.state} />{verify.data.localHashesMatch !== undefined && <span className={verify.data.localHashesMatch ? "text-good" : "text-bad"}>{verify.data.localHashesMatch ? "stored hashes recompute ✓" : "stored hashes do NOT recompute"}</span>}</div>
                  <p className="mt-2 text-muted">{verify.data.note}</p>
                  {verify.data.state === "not_committed" && (
                    isOwner ? <button className="act-primary mt-3" disabled={!!busy || !cfg?.programId} onClick={commit} data-testid="commit">{busy === "commit" ? "waiting for wallet…" : "commit hashes to solana"}</button>
                      : <p className="mt-2 text-faint">Only the experiment owner can commit it.</p>
                  )}
                  <button className="act mt-3 block" disabled={verify.isFetching} onClick={() => verify.refetch()}>{verify.isFetching ? "Re-verifying…" : "Re-verify against chain"}</button>
                </div>
                <dl className="kv text-[12.5px]">
                  <dt>cluster</dt><dd>{verify.data.cluster ?? cfg?.cluster}</dd>
                  <dt>pda</dt><dd className="break-all">{verify.data.pda ?? "—"}</dd>
                  <dt>signature</dt><dd className="break-all">{verify.data.signature ? <a href={explorerTx(verify.data.signature, verify.data.cluster ?? "", cfg?.rpc ?? "")} target="_blank" rel="noreferrer">{short(verify.data.signature, 10)}</a> : "—"}</dd>
                  <dt>chain slot</dt><dd className="tnum">{verify.data.chain?.slot ?? "—"}</dd>
                  <dt>chain owner</dt><dd>{verify.data.chain ? short(verify.data.chain.owner, 6) : "—"}</dd>
                  <dt>chain result</dt><dd><Hash value={verify.data.chain?.resultHash} /></dd>
                </dl>
              </div>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}
