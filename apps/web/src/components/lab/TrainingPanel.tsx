"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { DATASETS, exportModel, importModel, makeDataset, trainingIssues, TRAIN_LIMITS, type DatasetId, type EpochMetrics, type Model, type TrainOptions } from "@neuron/engine";
import { api } from "@/lib/client/api";
import { useTraining } from "@/lib/client/hooks";
import { useConfig, useSession } from "@/lib/client/wallet";
import { LossChart, DecisionMap } from "../charts";
import { ErrorBox, StatusPill, fmt, Hash } from "../ui";

interface Props {
  model: Model;
  persistedModelId: string | null;
  /** live weights during a browser preview (not persisted) */
  onPreviewWeights: (m: Model | null) => void;
  /** user picked a saved checkpoint version */
  onLoadVersion: (v: number) => void;
  onAdapt: (dims: { inputDim: number; outputDim: number; outputActivation: "softmax" | "linear" }) => void;
}

export function TrainingPanel({ model, persistedModelId, onPreviewWeights, onLoadVersion, onAdapt }: Props) {
  const compatible = DATASETS.filter((d) => d.inputDim === model.config.inputDim && d.outputDim === model.config.outputDim);
  const [dataset, setDataset] = useState<DatasetId>((compatible[0]?.id ?? "xor") as DatasetId);
  const [opts, setOpts] = useState<TrainOptions & { samples: number }>({ optimizer: "adam", learningRate: 0.03, epochs: 150, batchSize: 16, valFraction: 0.25, momentum: 0.9, samples: 240 });
  const [mode, setMode] = useState<"preview" | "server">("preview");
  const ds = useMemo(() => makeDataset(dataset, opts.samples, "neuron"), [dataset, opts.samples]);
  const issues = useMemo(() => trainingIssues(model, ds, opts), [model, ds, opts]);
  useEffect(() => { if (!compatible.find((d) => d.id === dataset) && compatible[0]) setDataset(compatible[0].id as DatasetId); }, [compatible, dataset]);

  const set = <K extends keyof typeof opts>(k: K, v: (typeof opts)[K]) => setOpts((o) => ({ ...o, [k]: v }));
  const field = (k: "learningRate" | "epochs" | "batchSize" | "valFraction" | "samples", label: string, step: number, min: number, max: number) => (
    <label className="grid grid-cols-[86px_1fr] items-center gap-2"><span className="label !text-[11.5px]">{label}</span>
      <input className="field tnum" type="number" step={step} min={min} max={max} value={opts[k]} onChange={(e) => set(k, Number(e.target.value))} /></label>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]" data-testid="training-panel">
      <div className="flex flex-col gap-2">
        <label className="grid grid-cols-[86px_1fr] items-center gap-2"><span className="label !text-[11.5px]">dataset</span>
          <select className="field" value={dataset} onChange={(e) => setDataset(e.target.value as DatasetId)}>
            {DATASETS.map((d) => <option key={d.id} value={d.id} disabled={!compatible.find((c) => c.id === d.id)}>{d.title} ({d.inputDim}→{d.outputDim})</option>)}
          </select></label>
        {!compatible.length && (
          <div className="border border-warn/50 p-2 text-[12.5px] text-warn">
            No curated dataset matches {model.config.inputDim}→{model.config.outputDim}.
            <button className="act ml-1" onClick={() => onAdapt({ inputDim: 2, outputDim: 2, outputActivation: "softmax" })}>regenerate as 2→2 softmax</button>
          </div>
        )}
        <p className="text-[12px] text-muted">{DATASETS.find((d) => d.id === dataset)?.note}</p>
        <label className="grid grid-cols-[86px_1fr] items-center gap-2"><span className="label !text-[11.5px]">optimizer</span>
          <select className="field" value={opts.optimizer} onChange={(e) => set("optimizer", e.target.value as "sgd" | "adam")}><option value="adam">adam</option><option value="sgd">sgd + momentum</option></select></label>
        {field("learningRate", "learn rate", 0.001, TRAIN_LIMITS.minLr, TRAIN_LIMITS.maxLr)}
        {field("epochs", "epochs", 10, 1, TRAIN_LIMITS.maxEpochs)}
        {field("batchSize", "batch", 1, 1, TRAIN_LIMITS.maxBatch)}
        {field("valFraction", "val split", 0.05, 0.05, 0.5)}
        {field("samples", "samples", 20, 16, TRAIN_LIMITS.maxDataset)}
        <div className="mt-1 flex gap-1" role="radiogroup" aria-label="Where to train">
          <button className="act-ghost" aria-pressed={mode === "preview"} onClick={() => setMode("preview")}>browser preview</button>
          <button className="act-ghost" aria-pressed={mode === "server"} onClick={() => setMode("server")}>train on neuron</button>
        </div>
        {issues.length > 0 && <ul role="alert" className="text-[12.5px] text-bad">{issues.map((i) => <li key={i}>— {i}</li>)}</ul>}
      </div>
      <div className="min-w-0">
        {mode === "preview"
          ? <Preview model={model} dataset={dataset} opts={opts} ds={ds} disabled={issues.length > 0} onWeights={onPreviewWeights} />
          : <Server model={model} persistedModelId={persistedModelId} dataset={dataset} opts={opts} ds={ds} disabled={issues.length > 0} onLoadVersion={onLoadVersion} />}
      </div>
    </div>
  );
}

function Preview({ model, dataset, opts, ds, disabled, onWeights }: { model: Model; dataset: DatasetId; opts: TrainOptions & { samples: number }; ds: ReturnType<typeof makeDataset>; disabled: boolean; onWeights: (m: Model | null) => void }) {
  const worker = useRef<Worker | null>(null);
  const [hist, setHist] = useState<EpochMetrics[]>([]);
  const [baseline, setBaseline] = useState<{ trainLoss: number; valLoss: number; valAcc: number } | null>(null);
  const [live, setLive] = useState<Model | null>(null);
  const [state, setState] = useState<"idle" | "running" | "done">("idle");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => () => worker.current?.terminate(), []);
  useEffect(() => { setHist([]); setBaseline(null); setLive(null); setState("idle"); onWeights(null); }, [model.artifactHash, dataset]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = () => {
    worker.current?.terminate();
    const w = new Worker(new URL("../../workers/train.worker.ts", import.meta.url), { type: "module" });
    worker.current = w;
    setHist([]); setErr(null); setState("running");
    const buf: EpochMetrics[] = [];
    let flush = 0;
    w.onmessage = (ev) => {
      const m = ev.data;
      if (m.type === "baseline") setBaseline(m.baseline);
      if (m.type === "epoch") { buf.push(m.m); if (performance.now() - flush > 80) { flush = performance.now(); setHist([...buf]); } }
      if (m.type === "weights") { const mm = importModel(m.artifact); setLive(mm); onWeights(mm); }
      if (m.type === "done") { setHist([...buf]); setState("done"); }
      if (m.type === "error") { setErr(m.message); setState("idle"); }
    };
    w.postMessage({ type: "start", artifact: exportModel(model), dataset, samples: opts.samples, options: opts });
  };
  const last = hist.at(-1);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <button className="act-primary" disabled={disabled || state === "running"} onClick={start} data-testid="preview-train">{state === "running" ? "training…" : "train in browser"}</button>
        {state === "running" && <button className="act" onClick={() => worker.current?.postMessage({ type: "stop" })}>stop</button>}
        {live && <button className="act" onClick={() => { setLive(null); onWeights(null); }}>revert graph to saved weights</button>}
        <span className="text-[12px] text-muted">Preview only: runs in a Web Worker on this device and is not saved. Use “train on neuron” for checkpoints.</span>
      </div>
      <Metrics hist={hist} baseline={baseline} epochs={opts.epochs} cls={ds.task === "classification"} />
      <div className="flex flex-wrap gap-4">
        <div><div className="label mb-1">decision surface · {live ? `epoch ${last?.epoch ?? 0}` : "before training"}</div><DecisionMap model={live ?? model} dataset={ds} /></div>
      </div>
      {err && <ErrorBox error={{ message: err }} />}
    </div>
  );
}

function Metrics({ hist, baseline, epochs, cls }: { hist: { epoch: number; trainLoss: number; valLoss: number; trainAcc?: number; valAcc?: number }[]; baseline: { trainLoss: number; valLoss: number; valAcc: number } | null; epochs: number; cls: boolean }) {
  const last = hist.at(-1);
  return (
    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_200px]">
      <LossChart baseline={baseline?.valLoss} series={[{ name: "train", values: hist.map((h) => h.trainLoss), color: "var(--accent)" }, { name: "validation", values: hist.map((h) => h.valLoss), color: "var(--accent-2)", dash: true }]} />
      <dl className="kv text-[12.5px]" data-testid="training-metrics">
        <dt>epoch</dt><dd className="tnum">{last?.epoch ?? 0} / {epochs}</dd>
        <dt>train loss</dt><dd className="tnum">{fmt(last?.trainLoss, 5)}</dd>
        <dt>val loss</dt><dd className="tnum">{fmt(last?.valLoss, 5)}</dd>
        {cls && <><dt>val acc</dt><dd className="tnum">{last?.valAcc !== undefined ? `${(last.valAcc * 100).toFixed(1)}%` : "—"}</dd></>}
        <dt>before</dt><dd className="tnum text-warn">{baseline ? `${fmt(baseline.valLoss, 4)}${cls ? ` · ${(baseline.valAcc * 100).toFixed(1)}%` : ""}` : "—"}</dd>
        <dt>Δ val loss</dt><dd className="tnum">{baseline && last ? `${(((last.valLoss - baseline.valLoss) / baseline.valLoss) * 100).toFixed(1)}%` : "—"}</dd>
      </dl>
      <div className="h-px bg-line md:col-span-2"><div className="h-px bg-accent transition-[width]" style={{ width: `${((last?.epoch ?? 0) / epochs) * 100}%` }} /></div>
    </div>
  );
}

function Server({ model, persistedModelId, dataset, opts, ds, disabled, onLoadVersion }: { model: Model; persistedModelId: string | null; dataset: DatasetId; opts: TrainOptions & { samples: number }; ds: ReturnType<typeof makeDataset>; disabled: boolean; onLoadVersion: (v: number) => void }) {
  const session = useSession();
  const { data: cfg } = useConfig();
  const qc = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [confirm, setConfirm] = useState(false);
  const { data: t } = useTraining(jobId);
  const free = opts.epochs <= (cfg?.freeTrainingMaxEpochs ?? 0);
  if (!persistedModelId) return <p className="text-muted">Save this model first (Generator or “save model” above) so checkpoints can attach to it.</p>;
  if (!session.data?.session) return <p className="text-muted">Connect a wallet and sign in to run persisted training jobs. Public pages and browser previews need no wallet.</p>;
  const start = async () => {
    setErr(null); setConfirm(false);
    try {
      const r = await api<{ id: string; cost: number }>("/api/training", { method: "POST", json: { modelId: persistedModelId, version: model.version, dataset, ...opts } });
      setJobId(r.id); qc.invalidateQueries({ queryKey: ["session"] });
    } catch (e) { setErr(e); }
  };
  const act = async (a: "pause" | "cancel" | "resume") => {
    try {
      const r = await api<{ id?: string }>(`/api/training/${jobId}/${a}`, { method: "POST" });
      if (a === "resume" && r.id) setJobId(r.id);
      qc.invalidateQueries({ queryKey: ["training", jobId] });
    } catch (e) { setErr(e); }
  };
  return (
    <div className="flex flex-col gap-3">
      {!t && (
        <div className="flex flex-wrap items-center gap-3">
          {!confirm ? <button className="act-primary" disabled={disabled} onClick={() => setConfirm(true)} data-testid="server-train">train on neuron…</button> : (
            <div className="border border-accent/60 p-2 text-[12.5px]" role="alertdialog" aria-label="Confirm training job">
              <p>Train <b>{model.id} v{model.version}</b> on <b>{dataset}</b> for {opts.epochs} epochs.</p>
              <p className="text-muted">{free ? `Free tier: up to ${cfg?.freeTrainingPerDay}/day at ≤ ${cfg?.freeTrainingMaxEpochs} epochs. If you have used today's free runs, credits are reserved first and unused credits are released if you cancel.` : "Above the free epoch cap: credits are reserved up front (exact amount shown in the result), and unused credits are released on cancel or failure."}</p>
              <div className="mt-2 flex gap-3"><button className="act-primary" onClick={start} data-testid="confirm-train">confirm</button><button className="act" onClick={() => setConfirm(false)}>back</button></div>
            </div>
          )}
        </div>
      )}
      {t && (
        <>
          <div className="flex flex-wrap items-center gap-3 text-[12.5px]">
            <StatusPill status={t.status} /><span className="tnum text-muted">job {t.id.slice(0, 8)} · {t.credits_reserved} credits reserved</span>
            {t.status === "running" && <><button className="act" onClick={() => act("pause")}>pause</button><button className="act" onClick={() => act("cancel")}>cancel</button></>}
            {t.status === "queued" && <button className="act" onClick={() => act("cancel")}>cancel</button>}
            {t.status === "paused" && <button className="act" onClick={() => act("resume")}>resume from checkpoint</button>}
            {["completed", "cancelled", "failed"].includes(t.status) && <button className="act" onClick={() => setJobId(null)}>new job</button>}
          </div>
          <Metrics hist={t.history} baseline={t.baseline} epochs={t.options.epochs} cls={ds.task === "classification"} />
          {t.error && <ErrorBox error={{ message: t.error }} />}
          {t.resource && <p className="text-[12px] text-muted tnum">isolated worker thread · peak heap {t.resource.peakHeapMb} MB · {fmt(t.resource.ms / 1000, 2)} s wall</p>}
          <div>
            <div className="label mb-1">immutable checkpoints</div>
            {t.checkpoints.length === 0 ? <p className="text-faint">none yet</p> : (
              <table className="w-full text-[12.5px] tnum" data-testid="checkpoints">
                <thead><tr className="text-left text-muted"><th className="font-normal">version</th><th className="font-normal">epoch</th><th className="font-normal">val loss</th><th className="font-normal">val acc</th><th className="font-normal">artifact</th><th /></tr></thead>
                <tbody>{t.checkpoints.map((c) => (
                  <tr key={c.id} className="border-t border-line"><td>v{c.version}</td><td>{c.epoch}</td><td>{fmt(c.metrics.valLoss, 5)}</td><td>{c.metrics.valAcc !== undefined ? `${(c.metrics.valAcc * 100).toFixed(1)}%` : "—"}</td><td><Hash value={c.artifact_hash} n={5} /></td>
                    <td className="text-right"><button className="act" onClick={() => onLoadVersion(c.version)}>load</button></td></tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </>
      )}
      <ErrorBox error={err} />
    </div>
  );
}
