"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { configIssues, exportModel, forward, generateModel, randomConfig, connectionCount, parameterCount, VISUAL_FORMS, type Model, type VisualForm } from "@neuron/engine";
import { GraphCanvas } from "./GraphCanvas";
import { ConfigForm, defaultDraft, resolveDraft, type Draft } from "./lab/ConfigForm";
import { ErrorBox, Hash, Panel, Scramble } from "./ui";
import { api } from "@/lib/client/api";
import { seededInput } from "@/lib/client/specimens";

function draftFromSeed(seed: string, form?: VisualForm): Draft {
  const c = randomConfig(seed);
  return { ...defaultDraft(seed), name: c.name, seed, architecture: c.architecture, inputDim: c.inputDim, outputDim: c.outputDim, layers: c.hidden.length, widthMode: "manual", widths: c.hidden.join(","),
    actMode: "seeded", outputActivation: c.outputActivation, density: c.architecture === "sparse" ? c.density : 0.5, init: c.init, form: form ?? "CONSTELLATION" };
}

function Histogram({ model }: { model: Model }) {
  const ws = model.layers.flatMap((L) => Array.from(L.W).filter((_, k) => !L.mask || L.mask[k]));
  const B = 28, mx = Math.max(1e-9, ...ws.map(Math.abs));
  const bins = new Array(B).fill(0);
  ws.forEach((w) => bins[Math.min(B - 1, Math.floor(((w + mx) / (2 * mx)) * B))]++);
  const top = Math.max(...bins);
  const mean = ws.reduce((s, w) => s + w, 0) / ws.length, sd = Math.sqrt(ws.reduce((s, w) => s + (w - mean) ** 2, 0) / ws.length);
  return (
    <div>
      <div className="flex h-[70px] items-end gap-px" role="img" aria-label={`Weight distribution of ${ws.length} weights, mean ${mean.toFixed(3)}, sd ${sd.toFixed(3)}`}>
        {bins.map((b, i) => <div key={i} className="flex-1 transition-[height] duration-500" style={{ height: `${(b / top) * 100}%`, background: i < B / 2 ? "var(--neg)" : "var(--pos)", opacity: 0.8 }} />)}
      </div>
      <div className="mt-1 flex justify-between text-[11.5px] text-muted tnum"><span>−{mx.toFixed(2)}</span><span>μ {mean.toFixed(3)} · σ {sd.toFixed(3)}</span><span>+{mx.toFixed(2)}</span></div>
    </div>
  );
}

export function Generator() {
  const sp = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => sp.get("seed") ? draftFromSeed(sp.get("seed")!, (sp.get("form") as VisualForm) ?? undefined) : defaultDraft("gen-0001"));
  const cfg = useMemo(() => resolveDraft(draft), [draft]);
  const issues = useMemo(() => configIssues(cfg), [cfg]);
  const model = useMemo(() => (issues.length ? null : generateModel(cfg)), [cfg, issues]);
  const prev = useRef<Model | null>(null);
  const [diff, setDiff] = useState<number | null>(null);
  const [acts, setActs] = useState<number[][] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!model) return;
    const p = prev.current;
    if (p && p.configHash !== model.configHash) {
      const a = p.layers.flatMap((l) => Array.from(l.W)), b = model.layers.flatMap((l) => Array.from(l.W));
      const n = Math.min(a.length, b.length);
      let same = 0; for (let i = 0; i < n; i++) if (a[i] === b[i]) same++;
      setDiff(1 - same / Math.max(a.length, b.length));
    }
    prev.current = model;
    setActs(forward(model, seededInput(model.config.seed, model.config.inputDim)).a.map((v) => Array.from(v)));
  }, [model]);

  const save = async (open: boolean) => {
    setErr(null); setBusy(true);
    try {
      const r = await api<{ id: string; created: boolean }>("/api/models", { method: "POST", json: { config: cfg, presentation: { form: draft.form, palette: draft.palette } } });
      await qc.invalidateQueries({ queryKey: ["models"] });
      router.push(open ? `/lab?model=${r.id}` : `/networks/${r.id}`);
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const exportJson = () => {
    if (!model) return;
    const blob = new Blob([JSON.stringify(exportModel(model), null, 1)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${model.id}-v1.json`; a.click(); URL.revokeObjectURL(a.href);
  };
  const importJson = async (f: File) => {
    setErr(null);
    try {
      const artifact = JSON.parse(await f.text());
      const r = await api<{ id: string }>("/api/models/import", { method: "POST", json: { artifact } });
      router.push(`/networks/${r.id}`);
    } catch (e) { setErr(e instanceof SyntaxError ? { message: "That file is not valid JSON." } : e); }
  };

  return (
    <div className="mx-auto max-w-[1600px] px-5 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-6 pb-8 pt-14">
        <div>
          <Scramble as="h1" text="Seed in. Structure out." className="display mt-2 block text-[clamp(44px,5.2vw,76px)]" />
          <p className="mt-2 max-w-[70ch] text-muted">The same seed, configuration and engine version always reproduce the same topology, weights and hash. Change any input and you get a different model, not a recoloured one.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button className="act" onClick={() => setDraft(draftFromSeed(Math.random().toString(36).slice(2, 10), draft.form))}>surprise me</button>
          <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
          <button className="act" onClick={() => fileRef.current?.click()}>Import JSON</button>
          <button className="act" disabled={!model} onClick={exportJson}>Export JSON</button>
          <button className="act-ghost" disabled={!model || busy} onClick={() => save(false)}>save</button>
          <button className="act-primary" disabled={!model || busy} onClick={() => save(true)} data-testid="save-and-open">save & open in lab</button>
        </div>
      </div>
      <ErrorBox error={err} />
      <div className="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)_300px]">
        <div className="panel p-5"><ConfigForm draft={draft} onChange={setDraft} /></div>
        <div className="panel relative min-h-[560px] overflow-hidden">
          {model ? <GraphCanvas model={model} form={draft.form} palette={draft.palette} activations={acts} className="absolute inset-0" /> : <div className="flex h-full items-center justify-center p-6 text-bad">{issues[0]}</div>}
          <div className="absolute bottom-3 left-3 z-10 flex flex-wrap gap-1">
            {VISUAL_FORMS.map((f) => <button key={f} className="act-ghost" aria-pressed={draft.form === f} onClick={() => setDraft({ ...draft, form: f })}>{f.toLowerCase()}</button>)}
          </div>
        </div>
        <div className="flex flex-col gap-5">
          {model && (
            <>
              <Panel title="identity">
                <dl className="kv text-[12.5px]" data-testid="generator-hashes">
                  <dt>model id</dt><dd>{model.id}</dd>
                  <dt>config hash</dt><dd><Hash value={model.configHash} /></dd>
                  <dt>artifact</dt><dd><Hash value={model.artifactHash} /></dd>
                  <dt>neurons</dt><dd>{model.config.inputDim + model.config.hidden.reduce((a, b) => a + b, 0) + model.config.outputDim}</dd>
                  <dt>connections</dt><dd>{connectionCount(model)}</dd>
                  <dt>parameters</dt><dd>{parameterCount(model)}</dd>
                  <dt>Δ weights</dt><dd>{diff === null ? "—" : `${(diff * 100).toFixed(1)}% differ from previous`}</dd>
                </dl>
              </Panel>
              <Panel title="weight distribution"><Histogram model={model} /></Panel>
              <Panel title="layers">
                <table className="w-full text-[12.5px] tnum">
                  <thead><tr className="text-left text-muted"><th className="font-normal">L</th><th className="font-normal">shape</th><th className="font-normal">fn</th><th className="font-normal text-right">kept</th></tr></thead>
                  <tbody>{model.layers.map((L, i) => (
                    <tr key={i} className="border-t border-line"><td>{i + 1}</td><td>{L.inDim}→{L.outDim}{L.residualFrom !== undefined ? ` +L${L.residualFrom}` : ""}</td><td>{L.activation}</td><td className="text-right">{L.mask ? `${Math.round((Array.from(L.mask).reduce((a, b) => a + b, 0) / L.mask.length) * 100)}%` : "100%"}</td></tr>
                  ))}</tbody>
                </table>
              </Panel>
              <p className="text-[12px] text-faint">Generated, not trained. Outputs of an untrained model reflect its random initialisation only.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
