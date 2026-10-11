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

  useEffect(() => {
    const cv = document.createElement("canvas");
    cv.className = "absolute inset-0 h-full w-full outline-none";
    cv.setAttribute("role", "img");
    holder.current!.prepend(cv);
    r.current = new GraphRenderer(cv, readThemeColors(), {
      interactive, labels, edgeBudget,
      onHover: (h, p) => setTip(h && p ? { h, ...p } : null),
      onSelect: (h) => onSelectRef.current?.(h),
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
  const label = ariaLabel ?? (model && G ? `${model.config.name}: ${model.config.architecture} network, ${G.nodes.length} neurons, ${G.edges.length} connections, ${form.toLowerCase()} view. Use arrow keys to move between neurons, plus and minus to zoom, 0 to fit.` : "network");

  return (
    <div ref={holder} className={`${/\babsolute\b/.test(className) ? "" : "relative "}overflow-hidden ${className}`} aria-label={label}>
      {toolbar && interactive && (
        <div className="absolute right-2 top-2 z-10 flex gap-1">
          {[["+", () => r.current?.zoom(1.25), "zoom in"], ["−", () => r.current?.zoom(0.8), "zoom out"], ["fit", () => r.current?.fit(), "fit to view"]].map(([t, f, l]) => (
            <button key={t as string} aria-label={l as string} onClick={f as () => void} className="act-ghost !px-2 !py-0.5 bg-bg/70">{t as string}</button>
          ))}
        </div>
      )}
      {tip && model && G && <Tooltip model={model} hit={tip.h} x={tip.x} y={tip.y} acts={actsRef.current} />}
    </div>
  );
});

function Tooltip({ model, hit, x, y, acts }: { model: Model; hit: Hit; x: number; y: number; acts: number[][] | null }) {
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
    <div className="pointer-events-none absolute z-20 w-[230px] border hair bg-bg/95 p-2 text-[10.5px]" style={{ left: Math.min(x + 14, 9999), top: y + 14, transform: x > 600 ? "translateX(-110%)" : undefined }}>
      {body}
    </div>
  );
}
