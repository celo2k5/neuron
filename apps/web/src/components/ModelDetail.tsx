"use client";
import Link from "next/link";
import { Segmented } from "./motion";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { forward, VISUAL_FORMS, type VisualForm } from "@neuron/engine";
import { useModelArtifact, useModelDetail } from "@/lib/client/hooks";
import { useSession } from "@/lib/client/wallet";
import { api } from "@/lib/client/api";
import { seededInput } from "@/lib/client/specimens";
import { GraphCanvas } from "./GraphCanvas";
import { Specimen3D } from "./Specimen3D";
import { NetworkFacts } from "./lab/Inspector";
import { Empty, ErrorBox, Hash, Panel, Spinner, StatusPill, ago, fmt } from "./ui";

export function ModelDetail({ id }: { id: string }) {
  const d = useModelDetail(id);
  const session = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const [ver, setVer] = useState<number | null>(null);
  const v = ver ?? d.data?.model.latest_version ?? null;
  const art = useModelArtifact(id, v);
  const [form, setForm] = useState<VisualForm | null>(null);
  const [v3, setV3] = useState(true);
  const [cmp, setCmp] = useState<[number, number] | null>(null);
  const [forkSeed, setForkSeed] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const m = d.data?.model;
  const isOwner = !!m?.owner_wallet && m.owner_wallet === session.data?.session?.wallet;
  const shownForm = form ?? (m?.presentation.form as VisualForm) ?? "CONSTELLATION";
  const acts = useMemo(() => (art.data ? forward(art.data, seededInput(art.data.config.seed, art.data.config.inputDim)).a.map((x) => Array.from(x)) : null), [art.data]);

  const [forking, setForking] = useState(false);
  if (d.isLoading) return <div className="p-8"><Spinner label="loading model" /></div>;
  if (d.error || !m) return <div className="mx-auto max-w-[900px] p-8"><ErrorBox error={d.error ?? { message: "Model not found." }} /></div>;

  const fork = async () => {
    if (forking) return;
    setErr(null); setForking(true);
    try { const r = await api<{ id: string }>(`/api/models/${id}/fork`, { method: "POST", json: { seed: forkSeed || `${m.seed}-fork`, name: `${m.name}-fork`.slice(0, 48) } }); router.push(`/networks/${r.id}`); }
    catch (e) { setErr(e); setForking(false); }
  };
  const savePresentation = async () => {
    setErr(null);
    try { await api(`/api/models/${id}`, { method: "PATCH", json: { form: shownForm, palette: m.presentation.palette } }); qc.invalidateQueries({ queryKey: ["model", id] }); }
    catch (e) { setErr(e); }
  };

  return (
    <div className="mx-auto max-w-[1440px] px-5 pt-14 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="label"><Link href="/networks">networks</Link> / {m.id}</div>
          <h1 className="display mt-2 text-[40px]">{m.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-[12.5px] text-muted">
            <span>{m.architecture}</span><span className="tnum">{[m.config.inputDim, ...m.config.hidden, m.config.outputDim].join("·")}</span>
            {m.trained ? <span className="pill text-good">trained versions</span> : <span className="pill text-faint">generated · untrained</span>}
            {m.forked_from && <span>forked from <Link href={`/networks/${m.forked_from}`}>{m.forked_from}</Link></span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link href={`/lab?model=${m.id}&v=${v}`} className="act-primary no-underline">Open v{v} in lab</Link>
          <a href={`/api/models/${m.id}/versions/${v}`} target="_blank" rel="noreferrer">Export v{v} JSON</a>
        </div>
      </div>
      <ErrorBox error={err} />
      <div className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="panel relative min-h-[500px] overflow-hidden">
          {art.data && v3 ? <Specimen3D model={art.data} activations={acts} className="absolute inset-0" zoom framing={0.95} /> : art.data ? <GraphCanvas model={art.data} form={shownForm} palette={m.presentation.palette} activations={acts} className="absolute inset-0" /> : <div className="p-6"><Spinner label="verifying artifact" /></div>}
          <div className="absolute bottom-3 left-3 z-10 flex flex-wrap items-center gap-1">
            <Segmented label="View" value={v3 ? "3D" : shownForm} onChange={(v) => { if (v === "3D") setV3(true); else { setV3(false); setForm(v as VisualForm); } }} className="glass-chip !bg-bg/60"
              options={[{ value: "3D", label: "3D" }, ...VISUAL_FORMS.map((f) => ({ value: f as string, label: f.toLowerCase() }))]} />
            {isOwner && form && form !== m.presentation.form && <button className="act ml-2" onClick={savePresentation}>save as preferred view</button>}
          </div>
        </div>
        <div className="panel p-5">{art.data && <NetworkFacts model={art.data} meta={{ row: m, persisted: true, lastExperiment: m.last_experiment_at, verification: m.verified_count ? `${m.verified_count} verified` : null }} />}</div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel title="versions" meta="immutable · content-addressed">
          <table className="w-full text-[12.5px] tnum">
            <thead><tr className="text-left text-muted"><th className="font-normal">v</th><th className="font-normal">kind</th><th className="font-normal">artifact</th><th className="font-normal">val loss</th><th className="font-normal">created</th><th /></tr></thead>
            <tbody>{d.data!.versions.map((x) => (
              <tr key={x.id} className={`border-t border-line ${x.version === v ? "text-accent" : ""}`}>
                <td>v{x.version}</td><td>{x.trained ? "checkpoint" : "generated"}</td><td><Hash value={x.artifact_hash} n={5} /></td>
                <td>{x.metrics?.valLoss !== undefined ? fmt(x.metrics.valLoss, 4) : "—"}</td><td>{ago(x.created_at)}</td>
                <td className="text-right"><button className="act" aria-label={`View version ${x.version}`} onClick={() => setVer(x.version)}>View</button></td>
              </tr>
            ))}</tbody>
          </table>
          {d.data!.versions.length > 1 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px]">
              <span className="label">compare</span>
              <button className="act" onClick={() => setCmp([1, d.data!.model.latest_version])}>v1 ↔ v{d.data!.model.latest_version}</button>
            </div>
          )}
          {cmp && <VersionCompare id={id} a={cmp[0]} b={cmp[1]} />}
        </Panel>
        <Panel title="fork configuration">
          <p className="text-muted">Forking copies this configuration with a new seed. The fork is a new, independent deterministic model; trained weights are not copied.</p>
          <div className="mt-2 flex gap-2"><input className="field" name="fork-seed" autoComplete="off" spellCheck={false} placeholder={`${m.seed}-fork…`} value={forkSeed} onChange={(e) => setForkSeed(e.target.value)} aria-label="Fork seed" />
            <button className="act-ghost" disabled={!session.data?.session || forking} aria-busy={forking} onClick={fork}>{forking ? "Forking…" : "Fork"}</button></div>
          {!session.data?.session && <p className="mt-1 text-[12px] text-faint">Sign in with a wallet to fork.</p>}
        </Panel>
        <Panel title="training jobs">
          {d.data!.training.length === 0 ? <Empty title="never trained">Open in the lab and use the training tab.</Empty> : (
            <ul className="divide-y divide-line text-[12.5px]">{d.data!.training.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 py-1.5"><span>{t.dataset} · {t.options.optimizer} · {t.options.epochs} ep</span><span className="tnum text-muted">{t.epoch} done</span><StatusPill status={t.status} /></li>
            ))}</ul>
          )}
        </Panel>
        <Panel title="latest experiments">
          {d.data!.experiments.length === 0 ? <Empty title="no saved experiments" /> : (
            <ul className="divide-y divide-line text-[12.5px]">{d.data!.experiments.map((e) => (
              <li key={e.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 py-1.5"><Link href={`/experiments/${e.id}`} className="tnum">{e.id.slice(0, 8)} · v{e.version} · {e.input_source}</Link><Hash value={e.result_hash} n={4} /><StatusPill status={e.commitment_status ?? e.status} /></li>
            ))}</ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

function VersionCompare({ id, a, b }: { id: string; a: number; b: number }) {
  const A = useModelArtifact(id, a), B = useModelArtifact(id, b);
  if (!A.data || !B.data) return <Spinner label="loading versions" />;
  const wa = A.data.layers.flatMap((l) => Array.from(l.W)), wb = B.data.layers.flatMap((l) => Array.from(l.W));
  let d2 = 0, changed = 0; wa.forEach((w, i) => { const d = wb[i] - w; d2 += d * d; if (d !== 0) changed++; });
  const x = seededInput("version-compare", A.data.config.inputDim);
  const oa = forward(A.data, x).output, ob = forward(B.data, x).output;
  return (
    <dl className="kv mt-3 border-t border-line pt-2 text-[12.5px]">
      <dt>‖ΔW‖₂</dt><dd className="tnum">{fmt(Math.sqrt(d2), 5)}</dd>
      <dt>changed</dt><dd className="tnum">{changed} / {wa.length} weights</dd>
      <dt>v{a} out</dt><dd className="tnum">[{oa.map((v) => fmt(v, 4)).join(", ")}]</dd>
      <dt>v{b} out</dt><dd className="tnum">[{ob.map((v) => fmt(v, 4)).join(", ")}]</dd>
      <dt>lineage</dt><dd className="break-all text-muted">v{b} parent <Hash value={B.data.parentArtifactHash ?? null} n={5} /></dd>
    </dl>
  );
}
