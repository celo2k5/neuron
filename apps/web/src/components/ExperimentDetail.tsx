"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { VisualForm } from "@neuron/engine";
import { api } from "@/lib/client/api";
import { useExperiment, useModelArtifact, useModelDetail } from "@/lib/client/hooks";
import { useSession } from "@/lib/client/wallet";
import { GraphCanvas } from "./GraphCanvas";
import { ErrorBox, Hash, Panel, Spinner, StatusPill, VectorBars, fmt, short, When, PageHeader } from "./ui";

export interface Verify {
  state: string; localHashesMatch?: boolean; note: string; hashes?: { resultHash: string; metadataHash: string; artifactHash: string };
  checks?: { hashesMatch: boolean; entryHashOk: boolean; signatureOk: boolean; chainLinkOk: boolean };
  record?: { seq: number; entryHash: string; prevHash: string; keyId: string; publicKey: string | null; signature: string; owner: string; resultHash: string; recordedAt: string };
}

export function explorerTx(sig: string, cluster: string, rpc: string) {
  const c = cluster === "localnet" ? `?cluster=custom&customUrl=${encodeURIComponent(rpc)}` : cluster === "devnet" ? "?cluster=devnet" : "";
  return `https://explorer.solana.com/tx/${sig}${c}`;
}

const Check = ({ ok, children }: { ok: boolean | undefined; children: React.ReactNode }) => (
  <li className={`flex items-center gap-2 ${ok ? "text-fg" : "text-bad"}`}>
    <span aria-hidden className={`grid h-4 w-4 place-items-center rounded-full text-[10px] ${ok ? "bg-good/20 text-good" : "bg-bad/20"}`}>{ok ? "✓" : "!"}</span>{children}<span className="sr-only">{ok ? "passes" : "fails"}</span>
  </li>
);

export function ExperimentDetail({ id }: { id: string }) {
  const { data: e, error, isLoading } = useExperiment(id);
  const model = useModelDetail(e?.model_id ?? null);
  const art = useModelArtifact(e?.model_id ?? null, e?.version);
  const session = useSession();
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
      const v = await api<Verify>(`/api/commitments/${id}`, { method: "POST" });
      qc.setQueryData(["verify", id], v);
      await Promise.all([qc.invalidateQueries({ queryKey: ["verify", id] }), qc.invalidateQueries({ queryKey: ["experiment", id] })]);
    } catch (x) { setErr(x); } finally { setBusy(null); }
  };

  return (
    <div className="mx-auto max-w-[1440px] px-5 pb-10 sm:px-8">
      <PageHeader title={`EXP·${id.slice(0, 8).toUpperCase()}`} mono
        crumbs={<><Link href="/experiments" className="no-underline hover:text-fg">Experiments</Link><span aria-hidden>/</span><span className="mono">{id.slice(0, 8)}</span></>}
        actions={<><StatusPill status={e.status} />{e.status === "completed" && <button className="act-ghost" disabled={!!busy} onClick={reproduce} data-testid="reproduce">{busy === "repro" ? "Queuing…" : "Reproduce"}</button>}</>} />
      <ErrorBox error={err} />
      {/* pipeline: a stepper, state shown by mark as well as colour */}
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-2" aria-label="Pipeline">
        {["Select version", "Validate input", "Execute", "Record activations", "Compute output", "Persist", "Render"].map((s, i, all) => {
          const failed = e.status === "failed" && i === 2;
          const done = !failed && (e.status === "completed" || ((e.status === "running" || e.status === "failed") && i < 2));
          return (
            <li key={s} className="flex items-center gap-1">
              <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12.5px] ${failed ? "border-bad/40 text-bad" : done ? "border-fg/[0.12] bg-fg/[0.04] text-fg" : "border-line text-faint"}`}>
                <span aria-hidden className={`grid h-4 w-4 place-items-center rounded-full text-[10px] ${failed ? "bg-bad/20" : done ? "bg-good/20 text-good" : "bg-fg/[0.06]"}`}>
                  {failed ? "!" : done ? <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 5.2 4.2 7.3 8 2.8" /></svg> : i + 1}
                </span>
                {s}<span className="sr-only">{failed ? ", failed" : done ? ", done" : ", pending"}</span>
              </span>
              {i < all.length - 1 && <span aria-hidden className={`h-px w-4 ${done ? "bg-fg/25" : "bg-line"}`} />}
            </li>
          );
        })}
      </ol>
      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
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
          <Panel title="registry record" meta={verify.data?.record ? `entry #${verify.data.record.seq} · key ${verify.data.record.keyId}` : "signed · hash-chained"} className="lg:col-span-2">
            {verify.isLoading ? <Spinner label="checking registry" /> : verify.error ? <ErrorBox error={verify.error} /> : verify.data && (
              <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" data-testid="verification">
                <div>
                  <div className="flex items-center gap-2"><StatusPill status={verify.data.state} />{verify.data.localHashesMatch !== undefined && <span className={verify.data.localHashesMatch ? "text-good" : "text-bad"}>{verify.data.localHashesMatch ? "stored hashes recompute" : "stored hashes do NOT recompute"}</span>}</div>
                  {verify.data.checks && (
                    <ul className="mt-3 space-y-1.5 text-[12.5px]" aria-label="Checks">
                      <Check ok={verify.data.checks.hashesMatch}>Recorded hashes equal the recomputed ones</Check>
                      <Check ok={verify.data.checks.entryHashOk}>Entry hash recomputes</Check>
                      <Check ok={verify.data.checks.signatureOk}>Registry signature is valid</Check>
                      <Check ok={verify.data.checks.chainLinkOk}>Linked to the previous entry</Check>
                    </ul>
                  )}
                  <p className="mt-3 text-muted">{verify.data.note}</p>
                  {verify.data.state === "not_committed" && (
                    isOwner ? <button className="act-primary mt-3" disabled={!!busy} aria-busy={busy === "commit"} onClick={commit} data-testid="commit">{busy === "commit" ? "Recording…" : "Record in registry"}</button>
                      : <p className="mt-2 text-faint">{session.data?.session ? "Only the experiment owner can record it." : "Sign in as the owner to record it."}</p>
                  )}
                  <button className="act mt-3 block" disabled={verify.isFetching} onClick={() => verify.refetch()}>{verify.isFetching ? "Re-verifying…" : "Re-verify"}</button>
                </div>
                <dl className="kv text-[12.5px]">
                  <dt>entry</dt><dd className="tnum">{verify.data.record ? `#${verify.data.record.seq}` : "—"}</dd>
                  <dt>recorded</dt><dd>{verify.data.record ? <When iso={verify.data.record.recordedAt} /> : "—"}</dd>
                  <dt>owner</dt><dd>{verify.data.record ? short(verify.data.record.owner, 6) : "—"}</dd>
                  <dt>entry hash</dt><dd><Hash value={verify.data.record?.entryHash} /></dd>
                  <dt>previous</dt><dd><Hash value={verify.data.record?.prevHash} /></dd>
                  <dt>result</dt><dd><Hash value={verify.data.record?.resultHash} /></dd>
                  <dt>signer key</dt><dd><Hash value={verify.data.record?.publicKey} /></dd>
                </dl>
              </div>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}
