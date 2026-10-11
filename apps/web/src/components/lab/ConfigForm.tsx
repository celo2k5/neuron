"use client";
import { useEffect, useMemo, useState } from "react";
import {
  ACTIVATIONS, ARCHITECTURES, INITS, LIMITS, VISUAL_FORMS, configIssues, suggestActivations, suggestWidths,
  type Activation, type Architecture, type ModelConfig, type OutputActivation, type VisualForm, type WeightInit,
} from "@neuron/engine";

export interface Draft {
  name: string; seed: string; architecture: Architecture; inputDim: number; outputDim: number; layers: number;
  widthMode: "seeded" | "manual"; widths: string; minW: number; maxW: number;
  actMode: "seeded" | "uniform"; act: Activation; outputActivation: OutputActivation; density: number; init: WeightInit;
  form: VisualForm; palette: "theme" | "seed";
}

export const defaultDraft = (seed = "lab-0001"): Draft => ({
  name: `model-${seed}`.slice(0, 48), seed, architecture: "feedforward", inputDim: 2, outputDim: 2, layers: 2, widthMode: "seeded", widths: "8,6",
  minW: 4, maxW: 12, actMode: "seeded", act: "tanh", outputActivation: "softmax", density: 0.5, init: "xavier", form: "CONSTELLATION", palette: "theme",
});

/** Turn the form state into an explicit, hashable config (seeded choices are resolved here, deterministically). */
export function resolveDraft(d: Draft): ModelConfig {
  let hidden = d.widthMode === "manual"
    ? d.widths.split(/[,\s·x]+/).filter(Boolean).map((v) => Number(v))
    : suggestWidths(d.seed, d.layers, Math.min(d.minW, d.maxW), Math.max(d.minW, d.maxW));
  if (d.architecture === "residual" && d.widthMode === "seeded") hidden = hidden.map(() => hidden[0]);
  const activations = d.actMode === "seeded" ? suggestActivations(d.seed, hidden.length) : hidden.map(() => d.act);
  return {
    name: d.name.trim() || "untitled", seed: d.seed, architecture: d.architecture, inputDim: d.inputDim, outputDim: d.outputDim,
    hidden, activations, outputActivation: d.outputActivation, density: d.architecture === "sparse" ? d.density : 1, init: d.init,
  };
}

export const randomSeed = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, "0")).join("");

function Mini({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return <div className="flex min-w-0 flex-col gap-1"><label htmlFor={htmlFor} className="label !text-[9.5px]">{label}</label>{children}</div>;
}

function Row({ label, htmlFor, children, hint }: { label: string; htmlFor?: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-2">
      <label htmlFor={htmlFor} className="label !text-[9.5px]" title={hint}>{label}</label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function ConfigForm({ draft, onChange, compact = false }: { draft: Draft; onChange: (d: Draft) => void; compact?: boolean }) {
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => onChange({ ...draft, [k]: v });
  const cfg = useMemo(() => resolveDraft(draft), [draft]);
  const issues = useMemo(() => configIssues(cfg), [cfg]);
  const [local, setLocal] = useState(draft.widths);
  useEffect(() => setLocal(draft.widths), [draft.widths]);
  const num = (k: "inputDim" | "outputDim" | "layers" | "minW" | "maxW", max: number) => (
    <input id={`f-${k}`} className="field tnum" type="number" min={1} max={max} value={draft[k]} onChange={(e) => set(k, Math.max(1, Math.min(max, Number(e.target.value) || 1)))} />
  );
  return (
    <div className="flex flex-col gap-2" data-testid="config-form">
      <Row label="name" htmlFor="f-name"><input id="f-name" className="field" maxLength={48} value={draft.name} onChange={(e) => set("name", e.target.value)} /></Row>
      <Row label="seed" htmlFor="f-seed">
        <div className="flex gap-1">
          <input id="f-seed" className="field tnum" maxLength={64} value={draft.seed} onChange={(e) => set("seed", e.target.value || "0")} data-testid="seed-input" />
          <button type="button" className="act-ghost !px-2" title="New random seed" aria-label="New random seed" onClick={() => set("seed", randomSeed())}>⟳</button>
        </div>
      </Row>
      <Row label="architecture" htmlFor="f-arch">
        <select id="f-arch" className="field" value={draft.architecture} onChange={(e) => {
          const a = e.target.value as Architecture;
          onChange({ ...draft, architecture: a, layers: a === "residual" ? Math.max(3, draft.layers) : draft.layers });
        }}>
          {ARCHITECTURES.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </Row>
      <div className="grid grid-cols-2 gap-2">
        <Mini label="inputs" htmlFor="f-inputDim">{num("inputDim", LIMITS.maxInputDim)}</Mini>
        <Mini label="outputs" htmlFor="f-outputDim">{num("outputDim", LIMITS.maxWidth)}</Mini>
      </div>
      <Row label="widths">
        <div className="flex gap-1" role="radiogroup" aria-label="Width mode">
          {(["seeded", "manual"] as const).map((m) => <button key={m} type="button" className="act-ghost !px-2 !py-0.5" aria-pressed={draft.widthMode === m} onClick={() => set("widthMode", m)}>{m}</button>)}
        </div>
      </Row>
      {draft.widthMode === "seeded" ? (
        <div className="grid grid-cols-3 gap-2">
          <Mini label="hidden layers" htmlFor="f-layers">{num("layers", LIMITS.maxLayers - 1)}</Mini>
          <Mini label="min width" htmlFor="f-minW">{num("minW", LIMITS.maxWidth)}</Mini>
          <Mini label="max width" htmlFor="f-maxW">{num("maxW", LIMITS.maxWidth)}</Mini>
        </div>
      ) : (
        <Row label="hidden" htmlFor="f-widths" hint="comma-separated widths, e.g. 8,8,6">
          <input id="f-widths" className="field tnum" value={local} onChange={(e) => setLocal(e.target.value)} onBlur={() => set("widths", local)} onKeyDown={(e) => e.key === "Enter" && set("widths", local)} />
        </Row>
      )}
      <Row label="activations">
        <div className="flex gap-1">
          {(["seeded", "uniform"] as const).map((m) => <button key={m} type="button" className="act-ghost !px-2 !py-0.5" aria-pressed={draft.actMode === m} onClick={() => set("actMode", m)}>{m}</button>)}
          {draft.actMode === "uniform" && (
            <select aria-label="Hidden activation" className="field !w-auto" value={draft.act} onChange={(e) => set("act", e.target.value as Activation)}>
              {ACTIVATIONS.map((a) => <option key={a}>{a}</option>)}
            </select>
          )}
        </div>
      </Row>
      <Row label="output fn" htmlFor="f-out">
        <select id="f-out" className="field" value={draft.outputActivation} onChange={(e) => set("outputActivation", e.target.value as OutputActivation)}>
          {[...ACTIVATIONS, "softmax"].map((a) => <option key={a}>{a}</option>)}
        </select>
      </Row>
      {draft.architecture === "sparse" && (
        <Row label={`density ${draft.density.toFixed(2)}`} htmlFor="f-density">
          <input id="f-density" className="field" type="range" min={0.05} max={1} step={0.01} value={draft.density} onChange={(e) => set("density", Number(e.target.value))} />
        </Row>
      )}
      <Row label="init" htmlFor="f-init">
        <select id="f-init" className="field" value={draft.init} onChange={(e) => set("init", e.target.value as WeightInit)}>{INITS.map((i) => <option key={i}>{i}</option>)}</select>
      </Row>
      {!compact && (
        <>
          <Row label="form" htmlFor="f-form">
            <select id="f-form" className="field" value={draft.form} onChange={(e) => set("form", e.target.value as VisualForm)}>{VISUAL_FORMS.map((f) => <option key={f}>{f}</option>)}</select>
          </Row>
          <Row label="palette">
            <div className="flex gap-1">{(["theme", "seed"] as const).map((m) => <button key={m} type="button" className="act-ghost !px-2 !py-0.5" aria-pressed={draft.palette === m} onClick={() => set("palette", m)}>{m}</button>)}</div>
          </Row>
        </>
      )}
      <div className="mt-1 border-t hair pt-2 text-[10.5px]">
        <div className="tnum text-muted">resolved · {[cfg.inputDim, ...cfg.hidden, cfg.outputDim].join("·")} · {cfg.activations.join(", ")} → {cfg.outputActivation}</div>
        {issues.length > 0 && <ul role="alert" className="mt-1 text-bad">{issues.map((i) => <li key={i}>— {i}</li>)}</ul>}
      </div>
    </div>
  );
}
