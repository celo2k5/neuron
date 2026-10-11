"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { configIssues, generateModel, VISUAL_FORMS, type ExperimentRecord, type Model, type VisualForm } from "@neuron/engine";
import { GraphCanvas, type GraphHandle } from "../GraphCanvas";
import { Specimen3D, type Specimen3DHandle } from "../Specimen3D";
import type { Hit } from "@/graph/renderer";
import { ConfigForm, defaultDraft, resolveDraft, type Draft } from "./ConfigForm";
import { NetworkFacts, SelectionDetail } from "./Inspector";
import { ExperimentPanel, ResultView } from "./ExperimentPanel";
import { TrainingPanel } from "./TrainingPanel";
import { Panel, ErrorBox, Spinner, VectorBars, fmt } from "../ui";
import { api } from "@/lib/client/api";
import { useModelArtifact, useModelDetail } from "@/lib/client/hooks";

export function Lab() {
  const sp = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const modelId = sp.get("model");
  const vParam = sp.get("v");
  const detail = useModelDetail(modelId);
  const version = vParam ? Number(vParam) : detail.data?.model.latest_version;
  const artifact = useModelArtifact(modelId, version);

  const [draft, setDraft] = useState<Draft>(() => defaultDraft());
  const [form, setForm] = useState<VisualForm>("CONSTELLATION");
  const [palette, setPalette] = useState<"theme" | "seed">("theme");
  const localModel = useMemo(() => { const c = resolveDraft(draft); return configIssues(c).length ? null : generateModel(c); }, [draft]);
  const base: Model | null = modelId ? artifact.data ?? null : localModel;
  const [preview, setPreview] = useState<Model | null>(null);
  const model = preview ?? base;
  const [last, setLast] = useState<ExperimentRecord | null>(null);
  const [history, setHistory] = useState<number[][][]>([]);
  const [hit, setHit] = useState<Hit>(null);
  const [tab, setTab] = useState<"result" | "training">("result");
  const [saveErr, setSaveErr] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const graph = useRef<GraphHandle>(null);
  const g3 = useRef<Specimen3DHandle>(null);
  const [view3d, setView3d] = useState(false);

  useEffect(() => { setLast(null); setHistory([]); setHit(null); setPreview(null); }, [base?.artifactHash]);
  // pin the version in the URL so new checkpoints arriving mid-session never swap the model under the user
  useEffect(() => {
    if (modelId && !vParam && detail.data) router.replace(`/lab?model=${modelId}&v=${detail.data.model.latest_version}`);
  }, [modelId, vParam, detail.data, router]);
  useEffect(() => { if (detail.data?.model.presentation) { setForm(detail.data.model.presentation.form); setPalette(detail.data.model.presentation.palette); } }, [detail.data?.model.presentation]);

  const saveModel = async () => {
    setSaveErr(null); setSaving(true);
    try {
      const cfg = resolveDraft(draft);
      const r = await api<{ id: string }>("/api/models", { method: "POST", json: { config: cfg, presentation: { form, palette } } });
      await qc.invalidateQueries({ queryKey: ["models"] });
      router.replace(`/lab?model=${r.id}`);
    } catch (e) { setSaveErr(e); } finally { setSaving(false); }
  };
  const loadVersion = (v: number) => { setPreview(null); router.replace(`/lab?model=${modelId}&v=${v}`); };
  const adapt = (d: { inputDim: number; outputDim: number; outputActivation: "softmax" | "linear" }) => {
    if (modelId) router.replace("/lab");
    setDraft((x) => ({ ...x, ...d }));
  };

  return (
    <div className="mx-auto grid max-w-[1600px] gap-5 px-5 py-6 sm:px-8 lg:grid-cols-[320px_minmax(0,1fr)_330px]" data-testid="lab">
      {/* LEFT — configuration + input */}
      <div className="panel flex min-w-0 flex-col gap-5 self-start p-5">
        <div>
          <h1 className="font-serif-d text-[28px] leading-tight">{modelId ? "Saved model" : "New model"}</h1>
          {modelId ? (
            <div className="mt-3 text-[13px]">
              {detail.isLoading || artifact.isLoading ? <Spinner label="loading persisted artifact" /> : detail.error || artifact.error ? <ErrorBox error={detail.error ?? artifact.error} /> : (
                <>
                  <div className="font-serif-d text-[22px]">{detail.data?.model.name}</div>
                  <div className="tnum text-muted">{modelId} · v{version} of {detail.data?.model.latest_version} · {base?.trained ? "trained" : "untrained"}</div>
                  <div className="mt-1 flex flex-wrap gap-x-2">
                    {detail.data?.versions.map((v) => <button key={v.version} className={`act ${v.version === version ? "!text-accent" : ""}`} onClick={() => loadVersion(v.version)}>v{v.version}{v.trained ? "·t" : ""}</button>)}
                  </div>
                  <div className="mt-2 flex gap-3"><Link href={`/networks/${modelId}`}>Detail page</Link><Link href="/lab">New local model</Link></div>
                  <p className="mt-2 text-faint">The graph is drawn from the persisted artifact after its hashes were recomputed in this browser.</p>
                </>
              )}
            </div>
          ) : (
            <div className="mt-2">
              <ConfigForm draft={draft} onChange={setDraft} compact />
              <div className="mt-3 flex items-center gap-3">
                <button className="act-primary" disabled={!localModel || saving} onClick={saveModel} data-testid="save-model">{saving ? "Saving…" : "Save model"}</button>
                <Link href="/generator" className="act">Full generator</Link>
              </div>
              <ErrorBox error={saveErr} />
            </div>
          )}
        </div>
        {model && (
          <div className="border-t border-line pt-5">
            <h2 className="mb-3 text-[14px] font-medium">Experiment input</h2>
            <ExperimentPanel model={base ?? model} persistedModelId={modelId} onRun={(r) => { setLast(r.local); setHistory((h) => [r.local.activations, ...h].slice(0, 16)); setTab("result"); }} />
          </div>
        )}
      </div>

      {/* CENTER — instrument */}
      <div className="panel flex min-w-0 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-3">
          <button className="act-ghost" aria-pressed={view3d} onClick={() => setView3d(true)} data-testid="view-3d">3D</button>
          {VISUAL_FORMS.map((f) => <button key={f} className="act-ghost" aria-pressed={!view3d && f === form} onClick={() => { setView3d(false); setForm(f); }}>{f.toLowerCase()}</button>)}
          <span className="mx-2 h-4 w-px bg-line" />
          {!view3d && (["theme", "seed"] as const).map((p) => <button key={p} className="act-ghost" aria-pressed={p === palette} onClick={() => setPalette(p)}>{p} palette</button>)}
          {preview && <span className="pill ml-auto text-warn">Preview weights, not saved</span>}
          {last && <button className="act ml-auto" onClick={() => (view3d ? g3.current?.play(last.activations) : graph.current?.play(last.activations))}>Replay</button>}
        </div>
        <div className="relative h-[58vh] min-h-[440px] lg:h-[66vh]">
          {model && view3d ? <Specimen3D ref={g3} model={model} activations={last?.activations} className="absolute inset-0" autoRotate zoom framing={1.05} bloom={0.9} /> : model ? <GraphCanvas ref={graph} model={model} form={form} palette={palette} activations={last?.activations} onSelect={setHit} className="absolute inset-0" /> :
            <div className="flex h-full items-center justify-center text-muted">{modelId ? <Spinner label="loading" /> : "Fix the configuration on the left to generate a model."}</div>}
        </div>
        <div className="border-t border-line">
          <div className="flex gap-1.5 border-b border-line px-4 py-3">
            {(["result", "training"] as const).map((t) => <button key={t} className="act-ghost" aria-pressed={tab === t} onClick={() => setTab(t)}>{t === "result" ? "Experiment result" : "Training"}</button>)}
          </div>
          <div className="p-5">
            {tab === "result" ? (last ? <ResultView r={last} /> : <p className="text-muted">Run an experiment to see its input, output, every intermediate activation and hashes here. The animation above replays the same numbers.</p>)
              : model && <TrainingPanel model={base ?? model} persistedModelId={modelId} onPreviewWeights={setPreview} onLoadVersion={loadVersion} onAdapt={adapt} />}
          </div>
        </div>
      </div>

      {/* RIGHT — readouts + inspector */}
      <aside className="flex min-w-0 flex-col gap-5" aria-label="Inspector">
        <div className="panel p-5">
          <h2 className="text-[13px] text-muted">Latest run</h2>
          {last ? (
            <div className="mt-3 flex flex-col gap-3 text-[12.5px]">
              <div className="flex items-baseline justify-between"><span className="font-serif-d text-[40px] leading-none tnum">{fmt(last.elapsedMs, 2)}<span className="text-[12px] text-muted"> ms</span></span><span className="text-muted">{history.length} run{history.length === 1 ? "" : "s"}</span></div>
              <VectorBars values={last.output} height={24} />
              <div className="tnum text-muted">argmax y{last.output.indexOf(Math.max(...last.output))} · Σ {fmt(last.output.reduce((s, v) => s + v, 0), 4)}</div>
            </div>
          ) : <p className="mt-3 text-[13px] text-muted">Execute an input to see timing and output here.</p>}
        </div>
        <Panel title={hit ? (hit.type === "node" ? "Neuron" : "Connection") : "Selection"} meta={hit && <button className="act" onClick={() => { setHit(null); graph.current?.select(null); }}>Clear</button>}>
          {model && <SelectionDetail model={model} hit={hit} acts={last?.activations ?? null} history={history} />}
        </Panel>
        <Panel title="Network">
          {model && <NetworkFacts model={model} meta={{ row: detail.data?.model, persisted: !!modelId, lastExperiment: detail.data?.model.last_experiment_at, verification: detail.data?.model.verified_count ? `${detail.data.model.verified_count} verified commitment(s)` : null }} />}
        </Panel>
      </aside>
    </div>
  );
}
