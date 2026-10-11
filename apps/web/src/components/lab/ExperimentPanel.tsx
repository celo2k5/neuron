"use client";
import { useEffect, useMemo, useState } from "react";
import { Segmented } from "../motion";
import Link from "next/link";
import { DATASETS, makeDataset, runExperiment, configIssues, type ExperimentRecord, type Model } from "@neuron/engine";
import { api } from "@/lib/client/api";
import { useExperiment } from "@/lib/client/hooks";
import { useSession } from "@/lib/client/wallet";
import { seededInput } from "@/lib/client/specimens";
import { ErrorBox, Hash, StatusPill, VectorBars, fmt } from "../ui";

type Source = "manual" | "seeded" | "dataset";

export interface RunResult { local: ExperimentRecord; savedId?: string }

export function ExperimentPanel({ model, persistedModelId, onRun }: { model: Model; persistedModelId: string | null; onRun: (r: RunResult) => void }) {
  const dim = model.config.inputDim;
  const [source, setSource] = useState<Source>("seeded");
  const [manual, setManual] = useState(() => Array.from({ length: dim }, (_, i) => (i % 2 ? "-0.5" : "0.5")).join(", "));
  const [seed, setSeed] = useState("x-0001");
  const compatible = useMemo(() => DATASETS.filter((d) => d.inputDim === dim), [dim]);
  const [ds, setDs] = useState<string>(compatible[0]?.id ?? "");
  const [sample, setSample] = useState(0);
  const [save, setSave] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const session = useSession();
  useEffect(() => { setManual(Array.from({ length: dim }, (_, i) => (i % 2 ? "-0.5" : "0.5")).join(", ")); setDs(DATASETS.find((d) => d.inputDim === dim)?.id ?? ""); }, [dim]);

  const parsed = useMemo((): { v?: number[]; error?: string } => {
    if (source === "seeded") return { v: seededInput(seed, dim) };
    if (source === "dataset") {
      if (!ds) return { error: `No preset dataset has ${dim} inputs.` };
      const d = makeDataset(ds as never, 240, "neuron");
      return { v: d.X[Math.max(0, Math.min(d.X.length - 1, sample))] };
    }
    const parts = manual.split(/[\s,;]+/).filter(Boolean);
    const v = parts.map(Number);
    if (parts.length !== dim) return { error: `Enter exactly ${dim} numbers (you entered ${parts.length}).` };
    const bad = v.findIndex((x) => !Number.isFinite(x));
    if (bad >= 0) return { error: `Value ${bad + 1} ("${parts[bad]}") is not a number.` };
    if (v.some((x) => Math.abs(x) > 1e6)) return { error: "Values must be within ±1,000,000." };
    return { v };
  }, [source, manual, seed, ds, sample, dim]);

  const canSave = !!persistedModelId && configIssues(model.config).length === 0;
  const run = async () => {
    setErr(null);
    if (!parsed.v) return;
    try {
      const local = runExperiment(model, parsed.v);
      let id: string | undefined;
      if (save && canSave) {
        const r = await api<{ id: string }>("/api/experiments", { method: "POST", json: { modelId: persistedModelId, version: model.version, input: parsed.v, inputSource: source, inputSeed: source === "seeded" ? seed : source === "dataset" ? `${ds}#${sample}` : undefined } });
        id = r.id; setSavedId(r.id);
      }
      onRun({ local, savedId: id });
    } catch (e) { setErr(e); }
  };

  return (
    <div className="flex flex-col gap-2" data-testid="experiment-panel">
      <div>
        <Segmented label="Input source" value={source} onChange={setSource} options={(["seeded", "manual", "dataset"] as Source[]).map((s) => ({ value: s, label: s }))} />
      </div>
      {source === "manual" && <textarea aria-label={`Input vector, ${dim} numbers`} className="field tnum min-h-[52px]" value={manual} onChange={(e) => setManual(e.target.value)} data-testid="manual-input" />}
      {source === "seeded" && <input aria-label="Input seed" className="field tnum" value={seed} onChange={(e) => setSeed(e.target.value || "0")} />}
      {source === "dataset" && (
        <div className="grid grid-cols-[1fr_80px] gap-1">
          <select aria-label="Dataset" className="field" value={ds} onChange={(e) => setDs(e.target.value)} disabled={!compatible.length}>
            {compatible.length ? compatible.map((d) => <option key={d.id} value={d.id}>{d.title}</option>) : <option>none for {dim}-d input</option>}
          </select>
          <input aria-label="Sample index" className="field tnum" type="number" min={0} max={239} value={sample} onChange={(e) => setSample(Number(e.target.value) || 0)} />
        </div>
      )}
      {parsed.v && <VectorBars values={parsed.v} height={20} color="var(--accent-2)" />}
      {parsed.error && <p role="alert" className="text-bad text-[12.5px]">{parsed.error}</p>}
      <label className="flex items-center gap-2 text-[12.5px] text-muted">
        <input type="checkbox" checked={save && canSave} disabled={!canSave} onChange={(e) => setSave(e.target.checked)} data-testid="save-experiment" />
        save to the experiment record {!persistedModelId ? "(save the model first)" : session.data?.session ? "" : "(anonymous; limited)"}
      </label>
      <button className="act-primary" disabled={!parsed.v} onClick={run} data-testid="run-experiment">execute ▸</button>
      <ErrorBox error={err} />
      {savedId && <SavedRun id={savedId} />}
    </div>
  );
}

function SavedRun({ id }: { id: string }) {
  const { data: e } = useExperiment(id);
  return (
    <div className="border border-line p-2 text-[12.5px]" data-testid="saved-run">
      <div className="flex items-center justify-between"><span className="label">server run</span>{e && <StatusPill status={e.status} />}</div>
      {e?.status === "completed" && <dl className="kv mt-1"><dt>result</dt><dd><Hash value={e.result_hash} /></dd><dt>elapsed</dt><dd>{fmt(e.elapsed_ms, 3)} ms</dd></dl>}
      {e?.error && <p className="text-bad">{e.error}</p>}
      <Link href={`/experiments/${id}`} className="mt-1 inline-block">open experiment →</Link>
    </div>
  );
}

export function ResultView({ r }: { r: ExperimentRecord }) {
  const argmax = r.output.indexOf(Math.max(...r.output));
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]" data-testid="result-view">
      <div className="flex flex-col gap-2">
        <div><div className="label mb-1">input · {r.input.length}</div><div className="tnum break-all text-[12.5px]">[{r.input.map((v) => fmt(v, 4)).join(", ")}]</div></div>
        <div>
          <div className="label mb-1">output · {r.output.length}</div>
          <ul className="tnum text-[12.5px]" data-testid="output-values">{r.output.map((v, i) => <li key={i} className={`flex justify-between ${i === argmax && r.output.length > 1 ? "text-accent" : ""}`}><span>y{i}</span><span>{v}</span></li>)}</ul>
        </div>
        <dl className="kv text-[12.5px]">
          <dt>duration</dt><dd>{fmt(r.elapsedMs, 3)} ms (this browser)</dd>
          <dt>model</dt><dd>{r.modelId} v{r.modelVersion}</dd>
          <dt>engine</dt><dd>{r.engine}</dd>
          <dt>config</dt><dd><Hash value={r.configHash} /></dd>
          <dt>artifact</dt><dd><Hash value={r.artifactHash} /></dd>
          <dt>result</dt><dd><Hash value={r.resultHash} /></dd>
          <dt>time</dt><dd>{new Date().toISOString().slice(11, 19)}Z</dd>
        </dl>
      </div>
      <div>
        <div className="label mb-1">intermediate activations</div>
        <div className="flex flex-col gap-1.5">
          {r.activations.map((a, l) => (
            <div key={l} className="grid grid-cols-[28px_minmax(0,1fr)_92px] items-center gap-2 text-[11.5px]">
              <span className="text-faint tnum">L{l}</span>
              <VectorBars values={a} height={16} color={l === 0 ? "var(--accent-2)" : "var(--accent)"} />
              <span className="tnum text-muted">μ {fmt(a.reduce((s, x) => s + x, 0) / a.length, 3)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
