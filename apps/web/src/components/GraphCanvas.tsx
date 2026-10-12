"use client";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Model, VisualForm } from "@neuron/engine";
import { graphOf } from "@neuron/viz";
import { GraphRenderer, type Hit } from "@/graph/renderer";
import { readThemeColors, useTheme } from "@/lib/client/theme";
import { fmt } from "./ui";

export interface GraphHandle { play(a: number[][]): void; fit(): void; zoom(f: number): void; select(h: Hit): void; duration(): number }

interface Props {
  model: Model | null;
  form: VisualForm;
  palette?: "theme" | "seed";
  activations?: number[][] | null;
  interactive?: boolean;
  labels?: boolean;
  className?: string;
  toolbar?: boolean;
  ariaLabel?: string;
  onSelect?: (h: Hit) => void;
  edgeBudget?: number;
}

export const GraphCanvas = forwardRef<GraphHandle, Props>(function GraphCanvas(
  { model, form, palette = "theme", activations, interactive = true, labels = true, className = "", toolbar = true, ariaLabel, onSelect, edgeBudget }, ref,
) {
  const holder = useRef<HTMLDivElement>(null);
  const r = useRef<GraphRenderer | null>(null);
  const theme = useTheme();
  const [tip, setTip] = useState<{ h: Hit; x: number; y: number } | null>(null);
  const actsRef = useRef<number[][] | null>(null);
  actsRef.current = activations ?? null;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const cvRef = useRef<HTMLCanvasElement | null>(null);
  const modelRef = useRef(model);
  modelRef.current = model;
  // what keyboard selection landed on, for screen readers (the canvas itself is silent)
  const [said, setSaid] = useState("");

  useEffect(() => {
    const cv = document.createElement("canvas");
    cv.className = "absolute inset-0 h-full w-full";
    cv.setAttribute("role", "img");
    cvRef.current = cv;
    holder.current!.prepend(cv);
    r.current = new GraphRenderer(cv, readThemeColors(), {
      interactive, labels, edgeBudget,
      onHover: (h, p) => setTip(h && p ? { h, ...p } : null),
      onSelect: (h) => { onSelectRef.current?.(h); setSaid(describe(modelRef.current, h)); },
    });
    return () => { r.current?.destroy(); r.current = null; cv.remove(); };
  }, [interactive, labels, edgeBudget]);

  useEffect(() => { if (model) r.current?.setModel(model, form); }, [model, form]);
  useEffect(() => { r.current?.setPaletteMode(palette); }, [palette]);
  useEffect(() => { requestAnimationFrame(() => r.current?.setColors(readThemeColors())); }, [theme]);
  useEffect(() => { if (activations && model) r.current?.play(activations); }, [activations, model]);

  useImperativeHandle(ref, () => ({
    play: (a) => r.current?.play(a),
    fit: () => r.current?.fit(),
    zoom: (f) => r.current?.zoom(f),
    select: (h) => r.current?.select(h),
    duration: () => r.current?.traceDurationMs ?? 0,
  }), []);

  const G = model ? graphOf(model) : null;
  const label = ariaLabel ?? (model && G ? `${model.config.name}: ${model.config.architecture} network, ${G.nodes.length} neurons, ${G.edges.length} connections, ${form.toLowerCase()} view.${interactive ? " Use arrow keys to move between neurons, plus and minus to zoom, 0 to fit." : ""}` : "Network");
  useEffect(() => { cvRef.current?.setAttribute("aria-label", label); }, [label]);

  return (
    <div ref={holder} className={`${/\babsolute\b/.test(className) ? "" : "relative "}overflow-hidden ${className}`}>
      {interactive && <p className="sr-only" aria-live="polite">{said}</p>}
      {toolbar && interactive && (
        <div className="glass-chip absolute right-3 top-3 z-10 flex gap-0.5 p-1">
          {[["+", () => r.current?.zoom(1.25), "Zoom in"], ["−", () => r.current?.zoom(0.8), "Zoom out"], ["Fit", () => r.current?.fit(), "Fit to view"]].map(([t, f, l]) => (
            <button key={t as string} aria-label={l as string} title={l as string} onClick={f as () => void} className="act !m-0 h-[26px] min-w-[26px] text-center !px-2 text-[13px] leading-[18px]">{t as string}</button>
          ))}
        </div>
      )}
      {tip && model && G && <Tooltip model={model} hit={tip.h} x={tip.x} y={tip.y} acts={actsRef.current} flip={tip.x > (holder.current?.clientWidth ?? 0) - 260} />}
    </div>
  );
});

function describe(model: Model | null, hit: Hit): string {
  if (!model || !hit) return "";
  const G = graphOf(model);
  if (hit.type === "node") {
    const n = G.nodes[hit.g];
    const where = n.layer === 0 ? "input" : n.layer === G.layerSize.length - 1 ? "output" : `hidden layer ${n.layer}`;
    return `Neuron ${n.layer}.${n.index}, ${where}, ${n.degIn} in, ${n.degOut} out`;
  }
  const e = G.edges[hit.e], s = G.nodes[e.s], t = G.nodes[e.t];
  return `Connection ${s.layer}.${s.index} to ${t.layer}.${t.index}, weight ${fmt(e.w, 4)}`;
}

function Tooltip({ model, hit, x, y, acts, flip }: { model: Model; hit: Hit; x: number; y: number; acts: number[][] | null; flip: boolean }) {
  const G = graphOf(model);
  if (!hit) return null;
  let body: React.ReactNode;
  if (hit.type === "node") {
    const n = G.nodes[hit.g];
    const L = n.layer > 0 ? model.layers[n.layer - 1] : null;
    body = (
      <dl className="kv">
        <dt>neuron</dt><dd>{model.id}:{n.layer}.{n.index}</dd>
        <dt>layer</dt><dd>{n.layer === 0 ? "input" : n.layer === G.layerSize.length - 1 ? "output" : `hidden ${n.layer}`}</dd>
        <dt>function</dt><dd>{L ? L.activation : "identity"}</dd>
        <dt>bias</dt><dd>{L ? fmt(L.b[n.index], 5) : "—"}</dd>
        <dt>in / out</dt><dd>{n.degIn} / {n.degOut}</dd>
        <dt>activation</dt><dd>{acts ? fmt(acts[n.layer]?.[n.index], 6) : "not run"}</dd>
      </dl>
    );
  } else {
    const e = G.edges[hit.e];
    const s = G.nodes[e.s], t = G.nodes[e.t];
    body = (
      <dl className="kv">
        <dt>edge</dt><dd>{e.kind === "skip" ? "identity skip" : "weight"}</dd>
        <dt>from</dt><dd>{s.layer}.{s.index}</dd>
        <dt>to</dt><dd>{t.layer}.{t.index}</dd>
        <dt>w</dt><dd className={e.w >= 0 ? "text-pos" : "text-neg"}>{fmt(e.w, 6)}</dd>
        {acts && <><dt>w · a</dt><dd>{fmt(e.w * (acts[s.layer]?.[s.index] ?? 0), 6)}</dd></>}
      </dl>
    );
  }
  return (
    <div className="pointer-events-none absolute z-20 w-[230px] rounded-xl border border-line bg-bg/95 p-2.5 text-[12px] shadow-[0_12px_32px_-12px_rgba(0,0,0,.6)]" style={{ left: Math.min(x + 14, 9999), top: y + 14, transform: flip ? "translateX(calc(-100% - 28px))" : undefined }}>
      {body}
    </div>
  );
}
