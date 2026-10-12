"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Segmented } from "../motion";
import { spring, exit } from "@/lib/client/motion";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { configIssues, connectionCount, generateModel, neuronCount, VISUAL_FORMS, type ExperimentRecord, type Model, type VisualForm } from "@neuron/engine";
import { GraphCanvas, type GraphHandle } from "../GraphCanvas";
import { Specimen3D, type Specimen3DHandle } from "../Specimen3D";
import type { Hit } from "@/graph/renderer";
import { ConfigForm, defaultDraft, resolveDraft, type Draft } from "./ConfigForm";
import { NetworkFacts, SelectionDetail } from "./Inspector";
import { ExperimentPanel, ResultView } from "./ExperimentPanel";
import { TrainingPanel } from "./TrainingPanel";
import { Panel, ErrorBox, Spinner, VectorBars, count, fmt } from "../ui";
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

  const [side, setSide] = useState<"run" | "selection" | "network">("network");
  useEffect(() => { if (hit) setSide("selection"); }, [hit]);
  useEffect(() => { if (last) setSide("run"); }, [last]);
  const shape = model ? [model.config.inputDim, ...model.config.hidden, model.config.outputDim].join("·") : "";

  return (
    <div className="mx-auto max-w-[1680px] px-5 pb-10 sm:px-8" data-testid="lab">
      {/* workspace bar: what is loaded, and what you can do with it */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line py-5">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="font-serif-d truncate text-[30px] leading-none tracking-[-0.02em]">{modelId ? detail.data?.model.name ?? "Loading…" : "New model"}</h1>
          <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
            {modelId ? <><span className="tnum">{modelId}</span><span aria-hidden>·</span><span>v{version} of {detail.data?.model.latest_version ?? "…"}</span>
              {base && (base.trained ? <span className="pill text-good">Trained</span> : <span className="pill text-muted">Untrained</span>)}</>
              : <span>Local draft · not saved</span>}
            {model && <><span aria-hidden>·</span><span className="tnum">{shape}</span></>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {modelId ? <>
            <Link href={`/networks/${modelId}`} className="act-ghost no-underline">Details</Link>
            <Link href="/lab" className="act-ghost no-underline">New model</Link>
          </> : <>
            <Link href="/generator" className="act-ghost no-underline">Full generator</Link>
            <button className="act-primary" disabled={!localModel || saving} onClick={saveModel} data-testid="save-model">{saving ? "Saving…" : "Save model"}</button>
          </>}
        </div>
      </div>
      <ErrorBox error={saveErr} />

      <div className="mt-5 grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)] 2xl:grid-cols-[300px_minmax(0,1fr)_340px]">
        {/* LEFT RAIL — configuration / versions, then input */}
        <div className="flex min-w-0 flex-col gap-5 lg:sticky lg:top-[84px] lg:self-start">
          {modelId ? (
            <Panel title="Versions" meta={detail.data ? `${detail.data.versions.length}` : undefined}>
              {detail.isLoading || artifact.isLoading ? <Spinner label="loading persisted artifact" /> : detail.error || artifact.error ? <ErrorBox error={detail.error ?? artifact.error} /> : (
                <>
                  <ul className="-mx-2 flex flex-col">
                    {detail.data?.versions.map((v) => (
                      <li key={v.version}>
                        <button onClick={() => loadVersion(v.version)} aria-current={v.version === version ? "true" : undefined}
                          className={`flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left text-[13px] transition-colors ${v.version === version ? "bg-fg/[0.07] text-fg" : "text-muted hover:bg-fg/[0.04] hover:text-fg"}`}>
                          <span className="tnum">v{v.version}</span>
                          <span className="flex-1 text-[12.5px]">{v.trained ? "Checkpoint" : "Generated"}</span>
                          <span className="tnum text-[12px] text-faint">{v.metrics?.valLoss !== undefined ? fmt(v.metrics.valLoss, 4) : ""}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-[12px] leading-relaxed text-faint">Drawn from the persisted artifact after its hashes were recomputed in this browser.</p>
                </>
              )}
            </Panel>
          ) : (
            <Panel title="Configuration">
              <ConfigForm draft={draft} onChange={setDraft} compact />
            </Panel>
          )}
          {model && (
            <Panel title="Experiment input">
              <ExperimentPanel model={base ?? model} persistedModelId={modelId} onRun={(r) => { setLast(r.local); setHistory((h) => [r.local.activations, ...h].slice(0, 16)); setTab("result"); }} />
            </Panel>
          )}
        </div>

        {/* CENTER — the instrument (first on phones) */}
        <div className="order-first flex min-w-0 flex-col gap-5 lg:order-none">
          <div className="panel relative overflow-hidden">
            <div className="relative h-[62vh] min-h-[480px] lg:h-[calc(100vh-250px)] lg:max-h-[860px]">
              {model && view3d ? <Specimen3D ref={g3} model={model} activations={last?.activations} className="absolute inset-0" autoRotate zoom framing={1.05} bloom={0.9} /> : model ? <GraphCanvas ref={graph} model={model} form={form} palette={palette} activations={last?.activations} onSelect={setHit} className="absolute inset-0" /> :
                <div className="flex h-full items-center justify-center text-muted">{modelId ? <Spinner label="loading" /> : "Fix the configuration on the left to generate a model."}</div>}
              {/* floating view controls */}
              <div className="glass-chip absolute left-3 top-3 z-10 max-w-[calc(100%-120px)] p-1">
                <Segmented size="sm" label="View" value={view3d ? "3D" : form} className="!border-0 !bg-transparent !p-0 !shadow-none" onChange={(v) => { if (v === "3D") setView3d(true); else { setView3d(false); setForm(v as VisualForm); } }}
                  options={[{ value: "3D", label: "3D", testId: "view-3d" }, ...VISUAL_FORMS.map((f) => ({ value: f as string, label: f.toLowerCase() }))]} />
              </div>
              <div className="absolute bottom-3 left-3 z-10 flex flex-wrap items-center gap-2">
                {model && <span className="glass-chip tnum px-3 py-1.5 text-[12px] text-muted">{count(neuronCount(model))} neurons · {count(connectionCount(model))} connections</span>}
                {preview && <span className="pill bg-bg/80 text-warn">Preview weights, not saved</span>}
              </div>
              <div className="absolute bottom-3 right-3 z-10 flex items-center gap-2">
                {!view3d && <div className="glass-chip p-1"><Segmented size="sm" label="Palette" value={palette} onChange={setPalette} className="!border-0 !bg-transparent !p-0 !shadow-none" options={[{ value: "theme", label: "Theme" }, { value: "seed", label: "Seed" }]} /></div>}
                {last && <button className="act-ghost sm" onClick={() => (view3d ? g3.current?.play(last.activations) : graph.current?.play(last.activations))}>Replay</button>}
              </div>
            </div>
          </div>
          <div className="panel overflow-hidden">
            <div className="panel-h">
              <Segmented label="Panel" value={tab} onChange={setTab} options={[{ value: "result", label: "Experiment result" }, { value: "training", label: "Training" }]} />
            </div>
            <AnimatePresence mode="wait" initial={false}>
            <motion.div key={tab} className="p-5" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6, transition: exit }} transition={spring.soft}>
              {tab === "result" ? (last ? <ResultView r={last} /> : <p className="text-muted">Run an experiment to see its input, output, every intermediate activation and hashes here. The animation above replays the same numbers.</p>)
                : model && <TrainingPanel model={base ?? model} persistedModelId={modelId} onPreviewWeights={setPreview} onLoadVersion={loadVersion} onAdapt={adapt} />}
            </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* RIGHT — inspector, one tab at a time */}
        <aside className="panel min-w-0 self-start lg:col-start-2 2xl:sticky 2xl:top-[84px] 2xl:col-start-auto" aria-label="Inspector">
          <div className="panel-h">
            <Segmented size="sm" label="Inspector" value={side} onChange={setSide} options={[{ value: "run", label: "Run" }, { value: "selection", label: "Selection" }, { value: "network", label: "Network" }]} />
            {hit && side === "selection" && <button className="act text-[12px]" onClick={() => { setHit(null); graph.current?.select(null); }}>Clear</button>}
          </div>
          <div className="p-[18px]">
            <div hidden={side !== "run"}>
              {last ? (
                <div className="flex flex-col gap-4 text-[12.5px]">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="stat"><span className="v">{fmt(last.elapsedMs, 2)}<span className="ml-1 font-sans text-[12px] text-muted">ms</span></span><span className="k">This browser</span></div>
                    <div className="stat"><span className="v">{history.length}</span><span className="k">Run{history.length === 1 ? "" : "s"} this session</span></div>
                  </div>
                  <div><div className="mb-2 text-[12px] text-muted">Output</div><VectorBars values={last.output} height={28} /></div>
                  <div className="tnum text-muted">argmax y{last.output.indexOf(Math.max(...last.output))} · Σ {fmt(last.output.reduce((s, v) => s + v, 0), 4)}</div>
                </div>
              ) : <p className="text-[13px] text-muted">Execute an input to see timing and output here.</p>}
            </div>
            <div hidden={side !== "selection"}>
              {model && <SelectionDetail model={model} hit={hit} acts={last?.activations ?? null} history={history} />}
            </div>
            <div hidden={side !== "network"}>
              {model && <NetworkFacts model={model} meta={{ row: detail.data?.model, persisted: !!modelId, lastExperiment: detail.data?.model.last_experiment_at, verification: detail.data?.model.verified_count ? `${detail.data.model.verified_count} verified commitment(s)` : null }} />}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
