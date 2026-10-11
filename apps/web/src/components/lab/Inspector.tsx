"use client";
import { connectionCount, neuronCount, parameterCount, ENGINE_VERSION, type Model } from "@neuron/engine";
import { graphOf } from "@neuron/viz";
import type { Hit } from "@/graph/renderer";
import { Hash, fmt, short, ago } from "../ui";
import type { ModelRow } from "@/lib/client/hooks";

export interface InspectorMeta { row?: ModelRow | null; lastExperiment?: string | null; verification?: string | null; persisted?: boolean }

export function NetworkFacts({ model, meta }: { model: Model; meta?: InspectorMeta }) {
  const acts = [...new Set(model.layers.map((l) => l.activation))];
  return (
    <dl className="kv text-[11px]" data-testid="network-facts">
      <dt>network id</dt><dd>{model.id}</dd>
      <dt>owner</dt><dd>{meta?.row?.owner_wallet ? short(meta.row.owner_wallet, 5) : meta?.persisted ? "anonymous" : "unsaved (local)"}</dd>
      <dt>created</dt><dd>{meta?.row ? new Date(meta.row.created_at).toISOString().replace("T", " ").slice(0, 19) + "Z" : "—"}</dd>
      <dt>architecture</dt><dd>{model.config.architecture}{model.config.architecture === "sparse" ? ` · d=${model.config.density}` : ""}</dd>
      <dt>layers</dt><dd>{model.layers.length + 1} ({[model.config.inputDim, ...model.config.hidden, model.config.outputDim].join("·")})</dd>
      <dt>neurons</dt><dd className="tnum">{neuronCount(model)}</dd>
      <dt>connections</dt><dd className="tnum">{connectionCount(model)}</dd>
      <dt>parameters</dt><dd className="tnum">{parameterCount(model)}</dd>
      <dt>activations</dt><dd>{acts.join(", ")}</dd>
      <dt>init</dt><dd>{model.config.init}</dd>
      <dt>seed</dt><dd className="break-all">{model.config.seed}</dd>
      <dt>engine</dt><dd>{model.engine ?? ENGINE_VERSION}</dd>
      <dt>config hash</dt><dd><Hash value={model.configHash} /></dd>
      <dt>artifact</dt><dd><Hash value={model.artifactHash} /></dd>
      <dt>version</dt><dd>v{model.version} {model.trained ? <span className="pill text-good">trained checkpoint</span> : <span className="text-faint">untrained · generated</span>}</dd>
      <dt>last run</dt><dd>{meta?.lastExperiment ? ago(meta.lastExperiment) : "—"}</dd>
      <dt>verification</dt><dd>{meta?.verification ?? <span className="text-faint">not committed</span>}</dd>
    </dl>
  );
}

export function SelectionDetail({ model, hit, acts, history }: { model: Model; hit: Hit; acts: number[][] | null; history: number[][][] }) {
  const G = graphOf(model);
  if (!hit) return <p className="text-muted">Click a neuron or an edge in the graph (or focus the graph and use the arrow keys) to inspect it.</p>;
  if (hit.type === "edge") {
    const e = G.edges[hit.e]; const s = G.nodes[e.s], t = G.nodes[e.t];
    const a = acts?.[s.layer]?.[s.index];
    return (
      <dl className="kv text-[11px]" data-testid="edge-detail">
        <dt>edge</dt><dd>#{e.e} · {e.kind === "skip" ? "identity skip (w = 1, fixed)" : "learnable weight"}</dd>
        <dt>from</dt><dd>{model.id}:{s.layer}.{s.index}</dd>
        <dt>to</dt><dd>{model.id}:{t.layer}.{t.index}</dd>
        <dt>weight</dt><dd className={e.w >= 0 ? "text-pos" : "text-neg"}>{e.w}</dd>
        <dt>|w| rank</dt><dd>{(G.edges.filter((x) => Math.abs(x.w) > Math.abs(e.w)).length + 1)} / {G.edges.length}</dd>
        {a !== undefined && <><dt>a(source)</dt><dd>{fmt(a, 6)}</dd><dt>w · a</dt><dd>{fmt(e.w * a, 6)}</dd></>}
      </dl>
    );
  }
  const n = G.nodes[hit.g];
  const L = n.layer > 0 ? model.layers[n.layer - 1] : null;
  const incoming = G.edges.filter((e) => e.t === n.g).sort((a, b) => Math.abs(b.w) - Math.abs(a.w));
  const outgoing = G.edges.filter((e) => e.s === n.g).sort((a, b) => Math.abs(b.w) - Math.abs(a.w));
  const recent = history.map((h) => h[n.layer]?.[n.index]).filter((v) => v !== undefined) as number[];
  const lab = (g: number) => `${G.nodes[g].layer}.${G.nodes[g].index}`;
  return (
    <div className="flex flex-col gap-3 text-[11px]" data-testid="neuron-detail">
      <dl className="kv">
        <dt>neuron</dt><dd>{model.id}:{n.layer}.{n.index}</dd>
        <dt>owner</dt><dd className="text-muted">model owner</dd>
        <dt>layer</dt><dd>{n.layer === 0 ? "0 · input" : n.layer === G.layerSize.length - 1 ? `${n.layer} · output` : `${n.layer} · hidden`}</dd>
        <dt>function</dt><dd>{L?.activation ?? "identity (input)"}</dd>
        <dt>bias</dt><dd>{L ? L.b[n.index] : "—"}</dd>
        <dt>residual</dt><dd>{L?.residualFrom !== undefined ? `+ a[L${L.residualFrom}].${n.index}` : "—"}</dd>
        <dt>activation</dt><dd className="text-accent-2">{acts ? fmt(acts[n.layer]?.[n.index], 8) : "not run yet"}</dd>
      </dl>
      <div>
        <div className="label mb-1">recent activations (newest first)</div>
        <div className="tnum flex flex-wrap gap-x-3 text-muted">{recent.length ? recent.slice(0, 8).map((v, i) => <span key={i}>{fmt(v, 4)}</span>) : "—"}</div>
      </div>
      <EdgeList title={`incoming · ${incoming.length}`} edges={incoming.slice(0, 8).map((e) => [lab(e.s), e.w, e.kind])} more={incoming.length - 8} />
      <EdgeList title={`outgoing · ${outgoing.length}`} edges={outgoing.slice(0, 8).map((e) => [lab(e.t), e.w, e.kind])} more={outgoing.length - 8} />
    </div>
  );
}

function EdgeList({ title, edges, more }: { title: string; edges: [string, number, string][]; more: number }) {
  return (
    <div>
      <div className="label mb-1">{title}</div>
      {edges.length === 0 ? <div className="text-faint">none</div> : (
        <ul className="tnum">
          {edges.map(([n, w, k], i) => <li key={i} className="flex justify-between"><span className="text-muted">{k === "skip" ? "skip " : ""}{n}</span><span className={w >= 0 ? "text-pos" : "text-neg"}>{w.toFixed(5)}</span></li>)}
          {more > 0 && <li className="text-faint">+{more} more</li>}
        </ul>
      )}
    </div>
  );
}
