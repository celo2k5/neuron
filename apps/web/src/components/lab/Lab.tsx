"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { configIssues, generateModel, VISUAL_FORMS, type ExperimentRecord, type Model, type VisualForm } from "@neuron/engine";
import { GraphCanvas, type GraphHandle } from "../GraphCanvas";
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
    <div className="mx-auto grid max-w-[1600px] gap-px bg-line lg:grid-cols-[320px_minmax(0,1fr)_330px]" data-testid="lab">
      {/* LEFT — configuration + input */}
      <div className="flex min-w-0 flex-col gap-4 bg-bg p-4">
        <div>
          <div className="label">§ lab · source</div>
          {modelId ? (
            <div className="mt-2 text-[11px]">
              {detail.isLoading || artifact.isLoading ? <Spinner label="loading persisted artifact" /> : detail.error || artifact.error ? <ErrorBox error={detail.error ?? artifact.error} /> : (
                <>
                  <div className="display text-[22px]">{detail.data?.model.name}</div>
                  <div className="tnum text-muted">{modelId} · v{version} of {detail.data?.model.latest_version} · {base?.trained ? "trained" : "untrained"}</div>
                  <div className="mt-1 flex flex-wrap gap-x-2">
                    {detail.data?.versions.map((v) => <button key={v.version} className={`act ${v.version === version ? "!text-accent" : ""}`} onClick={() => loadVersion(v.version)}>v{v.version}{v.trained ? "·t" : ""}</button>)}
                  </div>
                  <div className="mt-2 flex gap-3"><Link href={`/networks/${modelId}`}>detail page</Link><Link href="/lab">new local model</Link></div>
                  <p className="mt-2 text-faint">The graph is drawn from the persisted artifact after its hashes were recomputed in this browser.</p>
                </>
              )}
            </div>
          ) : (
            <div className="mt-2">
              <ConfigForm draft={draft} onChange={setDraft} compact />
              <div className="mt-3 flex items-center gap-3">
                <button className="act-primary" disabled={!localModel || saving} onClick={saveModel} data-testid="save-model">{saving ? "saving…" : "save model"}</button>
                <Link href="/generator" className="act">full generator</Link>
              </div>
              <ErrorBox error={saveErr} />
            </div>
          )}
        </div>
        {model && (
          <div className="border-t hair pt-3">
            <div className="label mb-2">§ experiment input</div>
            <ExperimentPanel model={base ?? model} persistedModelId={modelId} onRun={(r) => { setLast(r.local); setHistory((h) => [r.local.activations, ...h].slice(0, 16)); setTab("result"); }} />
          </div>
        )}
      </div>

      {/* CENTER — instrument */}
      <div className="flex min-w-0 flex-col bg-bg">
        <div className="flex flex-wrap items-center gap-1 border-b hair px-3 py-2">
          {VISUAL_FORMS.map((f) => <button key={f} className="act-ghost !px-2 !py-0.5" aria-pressed={f === form} onClick={() => setForm(f)}>{f.toLowerCase()}</button>)}
          <span className="mx-2 h-4 w-px bg-line" />
          {(["theme", "seed"] as const).map((p) => <button key={p} className="act-ghost !px-2 !py-0.5" aria-pressed={p === palette} onClick={() => setPalette(p)}>{p} palette</button>)}
          {preview && <span className="pill ml-auto text-warn">preview weights · not saved</span>}
          {last && <button className="act ml-auto" onClick={() => graph.current?.play(last.activations)}>replay ▸</button>}
        </div>
        <div className="relative h-[56vh] min-h-[420px] lg:h-[64vh]">
          {model ? <GraphCanvas ref={graph} model={model} form={form} palette={palette} activations={last?.activations} onSelect={setHit} className="absolute inset-0" /> :
            <div className="flex h-full items-center justify-center text-muted">{modelId ? <Spinner label="loading" /> : "Fix the configuration on the left to generate a model."}</div>}
        </div>
        <div className="border-t hair">
          <div className="flex gap-4 border-b hair px-3 py-1.5">
            {(["result", "training"] as const).map((t) => <button key={t} className={`act ${tab === t ? "!text-accent !decoration-accent" : ""}`} onClick={() => setTab(t)}>{t === "result" ? "experiment result" : "training"}</button>)}
          </div>
          <div className="p-3">
            {tab === "result" ? (last ? <ResultView r={last} /> : <p className="text-muted">Run an experiment to see its input, output, every intermediate activation and hashes here. The animation above replays the same numbers.</p>)
              : model && <TrainingPanel model={base ?? model} persistedModelId={modelId} onPreviewWeights={setPreview} onLoadVersion={loadVersion} onAdapt={adapt} />}
          </div>
        </div>
      </div>

      {/* RIGHT — readouts + inspector */}
      <aside className="flex min-w-0 flex-col gap-4 bg-bg p-4" aria-label="Inspector">
        <div>
          <div className="label">§ readout</div>
          {last ? (
            <div className="mt-2 flex flex-col gap-2 text-[11px]">
              <div className="flex items-baseline justify-between"><span className="display text-[28px] tnum">{fmt(last.elapsedMs, 2)}<span className="text-[12px] text-muted"> ms</span></span><span className="text-muted">{history.length} run{history.length === 1 ? "" : "s"}</span></div>
              <VectorBars values={last.output} height={24} />
              <div className="tnum text-muted">argmax y{last.output.indexOf(Math.max(...last.output))} · Σ {fmt(last.output.reduce((s, v) => s + v, 0), 4)}</div>
            </div>
          ) : <p className="mt-2 text-muted">No run yet.</p>}
        </div>
        <Panel title={hit ? (hit.type === "node" ? "neuron inspector" : "edge inspector") : "selection"} meta={hit && <button className="act" onClick={() => { setHit(null); graph.current?.select(null); }}>clear</button>}>
          {model && <SelectionDetail model={model} hit={hit} acts={last?.activations ?? null} history={history} />}
        </Panel>
        <Panel title="network inspector">
          {model && <NetworkFacts model={model} meta={{ row: detail.data?.model, persisted: !!modelId, lastExperiment: detail.data?.model.last_experiment_at, verification: detail.data?.model.verified_count ? `${detail.data.model.verified_count} verified commitment(s)` : null }} />}
        </Panel>
      </aside>
    </div>
  );
}
