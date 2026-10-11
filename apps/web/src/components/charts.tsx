"use client";
import { useEffect, useRef } from "react";
import { forward, type Dataset, type Model } from "@neuron/engine";
import { readThemeColors, useTheme } from "@/lib/client/theme";

/** Loss curves on a log axis; marks and labels share one scale. */
export function LossChart({ series, height = 150, baseline }: { series: { name: string; values: number[]; color: string; dash?: boolean }[]; height?: number; baseline?: number | null }) {
  const W = 520, H = height, pl = 44, pr = 10, pt = 8, pb = 22;
  const all = series.flatMap((s) => s.values).concat(baseline ? [baseline] : []).filter((v) => v > 0 && Number.isFinite(v));
  const n = Math.max(2, ...series.map((s) => s.values.length));
  if (!all.length) return <div className="flex items-center justify-center border border-dashed hair text-muted" style={{ height }}>no epochs yet</div>;
  const lo = Math.log10(Math.min(...all)) - 0.05, hi = Math.log10(Math.max(...all)) + 0.05;
  const x = (i: number) => pl + (i / (n - 1)) * (W - pl - pr);
  const y = (v: number) => pt + (1 - (Math.log10(Math.max(v, 1e-12)) - lo) / Math.max(1e-9, hi - lo)) * (H - pt - pb);
  const ticks: number[] = [];
  for (let e = Math.floor(lo); e <= Math.ceil(hi); e++) for (const m of [1, 2, 5]) { const v = m * 10 ** e; if (Math.log10(v) >= lo && Math.log10(v) <= hi) ticks.push(v); }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }} role="img" aria-label={`Loss chart, ${series.map((s) => `${s.name} last ${s.values.at(-1)?.toPrecision(4)}`).join(", ")}`}>
      {ticks.map((t) => <g key={t}><line x1={pl} x2={W - pr} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} /><text x={pl - 6} y={y(t) + 3} textAnchor="end" fontSize={9} fill="var(--muted)">{t < 0.01 ? t.toExponential(0) : t}</text></g>)}
      <text x={pl} y={H - 6} fontSize={9} fill="var(--muted)">epoch 1</text>
      <text x={W - pr} y={H - 6} fontSize={9} fill="var(--muted)" textAnchor="end">{n}</text>
      {baseline && <line x1={pl} x2={W - pr} y1={y(baseline)} y2={y(baseline)} stroke="var(--warn)" strokeDasharray="3 3" strokeWidth={1}><title>before training</title></line>}
      {series.map((s) => s.values.length > 0 && (
        <g key={s.name}>
          <polyline fill="none" stroke={s.color} strokeWidth={1.4} strokeDasharray={s.dash ? "4 3" : undefined} points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} />
          <circle cx={x(s.values.length - 1)} cy={y(s.values.at(-1)!)} r={2.5} fill={s.color} />
        </g>
      ))}
    </svg>
  );
}

/** Decision surface of a 2-input model, computed by real forward passes over a grid. */
export function DecisionMap({ model, dataset, size = 220 }: { model: Model | null; dataset: Dataset | null; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const theme = useTheme();
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !model || !dataset || model.config.inputDim !== 2) return;
    const c = readThemeColors();
    const N = 56, dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = size * dpr; cv.height = size * dpr;
    const ctx = cv.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const span = 1.4, cell = size / N;
    const rgb = (h: string) => { const n = parseInt(h.replace("#", "").padEnd(6, "0").slice(0, 6), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
    const A = rgb(c.accent), B = rgb(c.neg), bg = rgb(c.bg);
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const xv = -span + (2 * span * (i + 0.5)) / N, yv = span - (2 * span * (j + 0.5)) / N;
      const o = forward(model, [xv, yv]).output;
      const p = o.length > 1 ? o[1] / (o[0] + o[1] || 1) : Math.max(0, Math.min(1, o[0]));
      const k = Math.abs(p - 0.5) * 2 * 0.55;
      const col = p > 0.5 ? B : A;
      ctx.fillStyle = `rgb(${bg.map((b, t) => Math.round(b + (col[t] - b) * k)).join(",")})`;
      ctx.fillRect(i * cell, j * cell, cell + 0.5, cell + 0.5);
    }
    const toPx = (v: number) => ((v + span) / (2 * span)) * size;
    dataset.X.forEach((x, k) => {
      const cls = dataset.Y[k][1] > 0.5 ? 1 : 0;
      ctx.beginPath(); ctx.arc(toPx(x[0]), size - toPx(x[1]), 2, 0, Math.PI * 2);
      ctx.fillStyle = cls ? c.neg : c.accent; ctx.fill();
      ctx.lineWidth = 0.6; ctx.strokeStyle = c.bg; ctx.stroke();
    });
  }, [model, dataset, size, theme]);
  if (!model || !dataset) return null;
  if (model.config.inputDim !== 2) return <p className="text-muted">Decision map needs a 2-input model.</p>;
  return <canvas ref={ref} style={{ width: size, height: size, maxWidth: "100%" }} className="border hair" aria-label="Decision surface computed from the model over a grid, with training points" role="img" />;
}
