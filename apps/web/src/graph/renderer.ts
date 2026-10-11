/**
 * Canvas renderer for NEURON graphs. Lives outside React: components hand it a model, a
 * visual form and activation traces; it owns its own animation loop.
 *
 * Correspondence rules (tested in viz package):
 *  - one drawn edge per existing connection; masked connections are never drawn
 *  - edge colour sign = weight sign; width/alpha ∝ |w| / max|w|
 *  - during a trace, layer l lights at l·stepMs and pulses travel only along real edges,
 *    with pulse strength ∝ |w · a_source| — the actual contribution to the target's weighted sum
 */
import type { Model, VisualForm } from "@neuron/engine";
import { graphOf, layout, paletteFromSeed, refreshWeights, type Graph, type GraphEdge, type Layout } from "@neuron/viz";
import type { ThemeColors } from "@/lib/client/theme";

export type Hit = { type: "node"; g: number } | { type: "edge"; e: number } | null;
export interface RendererOptions {
  interactive?: boolean;
  labels?: boolean;
  ambient?: boolean;
  /** draw at most this many edges (LOD); strongest first */
  edgeBudget?: number;
  padding?: number;
  stepMs?: number;
  onHover?: (h: Hit, screen: { x: number; y: number } | null) => void;
  onSelect?: (h: Hit) => void;
}

type Path = { k: "line"; p: number[] } | { k: "quad"; p: number[] } | { k: "cubic"; p: number[] } | { k: "poly"; p: number[] };

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const hash01 = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

function withAlpha(color: string, a: number) {
  if (color.startsWith("#")) {
    const h = color.length === 4 ? color.replace(/#(.)(.)(.)/, "#$1$1$2$2$3$3") : color;
    const n = parseInt(h.slice(1, 7), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  if (color.startsWith("hsl(")) return color.replace(/\)$/, ` / ${a})`);
  if (color.startsWith("rgba(")) return color.replace(/,[^,]*\)$/, `,${a})`);
  if (color.startsWith("rgb(")) return color.replace("rgb(", "rgba(").replace(/\)$/, `,${a})`);
  return color;
}

export class GraphRenderer {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private w = 0;
  private h = 0;
  private model: Model | null = null;
  private G: Graph | null = null;
  private L: Layout | null = null;
  private from: { x: Float32Array; y: Float32Array } | null = null;
  private morphStart = 0;
  private px = new Float32Array(0);
  private py = new Float32Array(0);
  private paths: Path[] = [];
  private order: number[] = [];
  private view = { s: 1, tx: 0, ty: 0 };
  private colors: ThemeColors;
  private paletteMode: "theme" | "seed" = "theme";
  private trace: number[][] | null = null;
  private traceAt = 0;
  private layerMax: number[] = [];
  private hover: Hit = null;
  private selected: Hit = null;
  private raf = 0;
  private dirty = true;
  private ro: ResizeObserver;
  private opts: Required<Omit<RendererOptions, "onHover" | "onSelect">> & Pick<RendererOptions, "onHover" | "onSelect">;
  private pointers = new Map<number, { x: number; y: number }>();
  private dragging = false;
  private moved = 0;
  private lastPinch = 0;
  private userMoved = false;
  private visible = true;
  private io: IntersectionObserver | null = null;
  reducedMotion = false;

  constructor(private canvas: HTMLCanvasElement, colors: ThemeColors, opts: RendererOptions = {}) {
    this.ctx = canvas.getContext("2d")!;
    this.colors = colors;
    this.opts = { interactive: true, labels: true, ambient: true, edgeBudget: 2400, padding: 36, stepMs: 380, ...opts };
    this.reducedMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    if (typeof IntersectionObserver !== "undefined") {
      this.io = new IntersectionObserver((es) => { this.visible = es[0]?.isIntersecting ?? true; if (this.visible) this.kick(); });
      this.io.observe(canvas);
    }
    if (this.opts.interactive) this.bind();
    this.resize();
    this.kick();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.io?.disconnect();
    this.visible = false; // listeners die with the canvas element, which the owner removes
  }

  // ---------------------------------------------------------------- data
  setModel(m: Model, form: VisualForm) {
    const same = this.model?.artifactHash === m.artifactHash && this.L?.form === form;
    if (same) return;
    const sameGraph = this.model && this.model.configHash === m.configHash;
    const prev = sameGraph && this.L ? { x: Float32Array.from(this.px), y: Float32Array.from(this.py) } : null;
    this.model = m;
    this.G = graphOf(m);
    if (sameGraph) refreshWeights(m);
    this.L = layout(m, form);
    this.buildPaths(this.L.x, this.L.y);
    this.order = this.G.edges.map((e) => e.e).sort((a, b) => Math.abs(this.G!.edges[b].w) - Math.abs(this.G!.edges[a].w));
    this.from = prev && !this.reducedMotion ? prev : null;
    this.morphStart = performance.now();
    if (!this.from) { this.px = Float32Array.from(this.L.x); this.py = Float32Array.from(this.L.y); }
    if (!sameGraph) { this.trace = null; this.selected = null; this.hover = null; this.userMoved = false; }
    if (!this.userMoved) this.fit();
    this.kick();
  }

  /** after training updates weights in place */
  updateWeights(m: Model) {
    if (!this.model || m.configHash !== this.model.configHash) return this.setModel(m, this.L?.form ?? "MINIMAL");
    this.model = m;
    refreshWeights(m);
    this.order.sort((a, b) => Math.abs(this.G!.edges[b].w) - Math.abs(this.G!.edges[a].w));
    this.kick();
  }

  setColors(c: ThemeColors) { this.colors = c; this.kick(); }
  setPaletteMode(mode: "theme" | "seed") { this.paletteMode = mode; this.kick(); }

  /** play a computed activation trace (activations per layer, input first) */
  play(activations: number[][]) {
    this.trace = activations;
    this.layerMax = activations.map((v) => Math.max(1e-9, ...v.map(Math.abs)));
    this.traceAt = performance.now();
    this.kick();
  }
  clearTrace() { this.trace = null; this.kick(); }
  get traceDurationMs() { return this.G ? this.G.layerSize.length * this.opts.stepMs : 0; }

  select(h: Hit) { this.selected = h; this.kick(); }

  // ---------------------------------------------------------------- view
  fit() {
    if (!this.L || !this.w) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < this.L.x.length; i++) { x0 = Math.min(x0, this.L.x[i]); x1 = Math.max(x1, this.L.x[i]); y0 = Math.min(y0, this.L.y[i]); y1 = Math.max(y1, this.L.y[i]); }
    const pad = this.opts.padding + (this.opts.labels ? 14 : 0);
    const s = Math.min((this.w - pad * 2) / Math.max(40, x1 - x0), (this.h - pad * 2) / Math.max(40, y1 - y0), 3);
    this.view = { s, tx: this.w / 2 - ((x0 + x1) / 2) * s, ty: this.h / 2 - ((y0 + y1) / 2) * s };
    this.userMoved = false;
    this.kick();
  }
  zoom(f: number, cx = this.w / 2, cy = this.h / 2) {
    const s = clamp(this.view.s * f, 0.15, 12);
    const k = s / this.view.s;
    this.view = { s, tx: cx - (cx - this.view.tx) * k, ty: cy - (cy - this.view.ty) * k };
    this.userMoved = true;
    this.kick();
  }
  pan(dx: number, dy: number) { this.view.tx += dx; this.view.ty += dy; this.userMoved = true; this.kick(); }

  /** keyboard navigation between neurons */
  step(dir: "up" | "down" | "left" | "right") {
    if (!this.G) return;
    const cur = this.selected?.type === "node" ? this.G.nodes[this.selected.g] : this.G.nodes[0];
    let layer = cur.layer, index = cur.index;
    if (this.selected?.type === "node") {
      if (dir === "up") index--; if (dir === "down") index++;
      if (dir === "left") layer--; if (dir === "right") layer++;
    }
    layer = clamp(layer, 0, this.G.layerSize.length - 1);
    if (layer !== cur.layer) index = Math.round((index / Math.max(1, this.G.layerSize[cur.layer] - 1)) * (this.G.layerSize[layer] - 1)) || 0;
    index = clamp(index, 0, this.G.layerSize[layer] - 1);
    const g = this.G.layerStart[layer] + index;
    this.selected = { type: "node", g };
    this.opts.onSelect?.(this.selected);
    this.kick();
  }

  screenOf(g: number) { return { x: this.px[g] * this.view.s + this.view.tx, y: this.py[g] * this.view.s + this.view.ty }; }

  // ---------------------------------------------------------------- internals
  private resize() {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = r.width; this.h = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    if (!this.userMoved) this.fit();
    this.kick();
  }

  private buildPaths(x: ArrayLike<number>, y: ArrayLike<number>) {
    if (!this.G || !this.L) return;
    const geo = this.L.geometry, cx = this.L.cx, cy = this.L.cy;
    this.paths = this.G.edges.map((e) => {
      const sx = x[e.s], sy = y[e.s], tx = x[e.t], ty = y[e.t];
      if (e.kind === "skip") {
        const mx = (sx + tx) / 2, my = (sy + ty) / 2, len = Math.hypot(tx - sx, ty - sy);
        return { k: "quad", p: [sx, sy, mx, my - len * 0.35 - 20, tx, ty] };
      }
      switch (geo) {
        case "curve": { const dx = (tx - sx) * 0.5; return { k: "cubic", p: [sx, sy, sx + dx, sy, tx - dx, ty, tx, ty] }; }
        case "ortho": {
          const mx = Math.round((sx + (tx - sx) * (0.3 + 0.4 * hash01(e.e))) / 6) * 6;
          return { k: "poly", p: [sx, sy, mx, sy, mx, ty, tx, ty] };
        }
        case "bundle": {
          const mx = (sx + tx) / 2, my = (sy + ty) / 2;
          return { k: "quad", p: [sx, sy, mx + (cx - mx) * 0.55, my + (cy - my) * 0.55, tx, ty] };
        }
        default: return { k: "line", p: [sx, sy, tx, ty] };
      }
    });
  }

  private pointAt(path: Path, t: number): [number, number] {
    const p = path.p;
    if (path.k === "line") return [p[0] + (p[2] - p[0]) * t, p[1] + (p[3] - p[1]) * t];
    if (path.k === "quad") { const u = 1 - t; return [u * u * p[0] + 2 * u * t * p[2] + t * t * p[4], u * u * p[1] + 2 * u * t * p[3] + t * t * p[5]]; }
    if (path.k === "cubic") { const u = 1 - t; const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t; return [a * p[0] + b * p[2] + c * p[4] + d * p[6], a * p[1] + b * p[3] + c * p[5] + d * p[7]]; }
    // poly: equal-length param over 3 segments
    const segs = [[p[0], p[1], p[2], p[3]], [p[2], p[3], p[4], p[5]], [p[4], p[5], p[6], p[7]]];
    const lens = segs.map((s) => Math.hypot(s[2] - s[0], s[3] - s[1]));
    let d = t * lens.reduce((a, b) => a + b, 0);
    for (let i = 0; i < 3; i++) { if (d <= lens[i] || i === 2) { const f = lens[i] ? d / lens[i] : 0; const s = segs[i]; return [s[0] + (s[2] - s[0]) * f, s[1] + (s[3] - s[1]) * f]; } d -= lens[i]; }
    return [p[6], p[7]];
  }

  private trace2d(path: Path) {
    const c = this.ctx, p = path.p;
    c.moveTo(p[0], p[1]);
    if (path.k === "line") c.lineTo(p[2], p[3]);
    else if (path.k === "quad") c.quadraticCurveTo(p[2], p[3], p[4], p[5]);
    else if (path.k === "cubic") c.bezierCurveTo(p[2], p[3], p[4], p[5], p[6], p[7]);
    else { c.lineTo(p[2], p[3]); c.lineTo(p[4], p[5]); c.lineTo(p[6], p[7]); }
  }

  private kick() {
    this.dirty = true;
    if (!this.raf) this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private frame(now: number) {
    this.raf = 0;
    // off-screen canvases still paint their resting frame once, but don't keep animating
    if (!this.visible) { if (this.dirty) { this.dirty = false; this.draw(now); } return; }
    const animating = this.draw(now);
    if (animating || this.dirty) { this.dirty = false; this.raf = requestAnimationFrame((t) => this.frame(t)); }
  }

  private colorPos() { return this.paletteMode === "seed" && this.model ? paletteFromSeed(this.model.configHash).pos : this.colors.pos; }
  private colorNeg() { return this.paletteMode === "seed" && this.model ? paletteFromSeed(this.model.configHash).neg : this.colors.neg; }
  private colorGlow() { return this.paletteMode === "seed" && this.model ? paletteFromSeed(this.model.configHash).glow : this.colors.accent2; }

  /** returns true while something is animating */
  private draw(now: number): boolean {
    const c = this.ctx, G = this.G, L = this.L;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);
    if (!G || !L) return false;
    let animating = false;

    // morph between visual forms
    if (this.from) {
      const t = clamp((now - this.morphStart) / 750, 0, 1), k = ease(t);
      for (let i = 0; i < this.px.length; i++) { this.px[i] = this.from.x[i] + (L.x[i] - this.from.x[i]) * k; this.py[i] = this.from.y[i] + (L.y[i] - this.from.y[i]) * k; }
      this.buildPaths(this.px, this.py);
      if (t >= 1) { this.from = null; this.buildPaths(L.x, L.y); } else animating = true;
    }

    const { s, tx, ty } = this.view;
    c.setTransform(this.dpr * s, 0, 0, this.dpr * s, this.dpr * tx, this.dpr * ty);
    const lw = 1 / s;
    const tElapsed = this.trace ? now - this.traceAt : Infinity;
    const step = this.reducedMotion ? 1 : this.opts.stepMs;
    const traceDone = tElapsed > G.layerSize.length * step + 600;
    if (this.trace && !traceDone) animating = true;

    // viewport culling bounds in world coords
    const vx0 = -tx / s - 40, vy0 = -ty / s - 40, vx1 = (this.w - tx) / s + 40, vy1 = (this.h - ty) / s + 40;
    const budget = s > 1.6 ? Infinity : this.opts.edgeBudget;
    const maxW = G.maxAbsW;
    const pos = this.colorPos(), neg = this.colorNeg();

    // edges: batched into sign × magnitude buckets
    const buckets: number[][] = Array.from({ length: 8 }, () => []);
    let drawn = 0;
    for (const ei of this.order) {
      if (drawn >= budget) break;
      const e = G.edges[ei];
      const ax = this.px[e.s], ay = this.py[e.s], bx = this.px[e.t], by = this.py[e.t];
      if (Math.max(ax, bx) < vx0 || Math.min(ax, bx) > vx1 || Math.max(ay, by) < vy0 - 200 || Math.min(ay, by) > vy1 + 200) continue;
      const mag = Math.min(0.999, Math.abs(e.w) / maxW);
      buckets[(e.w >= 0 ? 0 : 4) + Math.floor(mag * 4)].push(ei);
      drawn++;
    }
    const dense = G.edges.length > 600;
    for (let b = 0; b < 8; b++) {
      if (!buckets[b].length) continue;
      const m = (b % 4) / 3;
      c.beginPath();
      for (const ei of buckets[b]) this.trace2d(this.paths[ei]);
      c.strokeStyle = withAlpha(b < 4 ? pos : neg, (dense ? 0.05 : 0.09) + m * (dense ? 0.22 : 0.4) * (this.trace && !traceDone ? 0.6 : 1));
      c.lineWidth = lw * (0.5 + m * 1.6);
      if (b >= 4 && this.colors.pos === this.colors.neg) c.setLineDash([3 * lw, 3 * lw]);
      c.stroke();
      c.setLineDash([]);
    }

    // highlight edges of hovered / selected node or edge
    const focus = this.hover ?? this.selected;
    if (focus) {
      c.beginPath();
      if (focus.type === "node") { for (const e of G.edges) if (e.s === focus.g || e.t === focus.g) this.trace2d(this.paths[e.e]); }
      else this.trace2d(this.paths[focus.e]);
      c.strokeStyle = withAlpha(this.colors.fg, 0.75);
      c.lineWidth = lw * 1.4;
      c.stroke();
    }

    // activation pulses along real edges, strength ∝ |w · a_src|
    if (this.trace && tElapsed < G.layerSize.length * step + 400) {
      const flows: { e: GraphEdge; f: number }[] = [];
      let fmax = 1e-12;
      for (const e of G.edges) {
        const a = this.trace[G.nodes[e.s].layer]?.[G.nodes[e.s].index] ?? 0;
        const f = Math.abs(e.w * a);
        if (f > 0) { flows.push({ e, f }); fmax = Math.max(fmax, f); }
      }
      flows.sort((x, y) => y.f - x.f);
      const lim = Math.min(flows.length, 900);
      const glow = this.colorGlow();
      for (let i = 0; i < lim; i++) {
        const { e, f } = flows[i];
        const t0 = G.nodes[e.s].layer * step, t1 = G.nodes[e.t].layer * step;
        const u = (tElapsed - t0) / (t1 - t0);
        if (u < 0 || u > 1) continue;
        const k = f / fmax;
        if (k < 0.04) continue;
        // bright segment of the edge being traversed
        const [x, y] = this.pointAt(this.paths[e.e], u);
        const [x2, y2] = this.pointAt(this.paths[e.e], Math.max(0, u - 0.12));
        c.beginPath(); c.moveTo(x2, y2); c.lineTo(x, y);
        c.strokeStyle = withAlpha(e.w >= 0 ? pos : neg, 0.25 + 0.7 * k);
        c.lineWidth = lw * (0.8 + 2.4 * k);
        c.stroke();
        c.beginPath(); c.arc(x, y, (1.2 + 2.6 * k) * lw * Math.sqrt(s), 0, Math.PI * 2);
        c.fillStyle = withAlpha(glow, 0.5 + 0.5 * k);
        c.fill();
      }
    }

    // nodes
    const ambientT = now / 1000;
    for (const n of G.nodes) {
      const x = this.px[n.g], y = this.py[n.g];
      if (x < vx0 || x > vx1 || y < vy0 || y > vy1) continue;
      let r = L.r[n.g];
      const isIn = n.layer === 0, isOut = n.layer === G.layerSize.length - 1;
      let act = 0, lit = false;
      if (this.trace) {
        const at = n.layer * step;
        lit = tElapsed >= at;
        if (lit) act = Math.min(1, Math.abs(this.trace[n.layer]?.[n.index] ?? 0) / this.layerMax[n.layer]);
      }
      if (this.opts.ambient && !this.reducedMotion && L.form === "CONSTELLATION") { r *= 0.85 + 0.3 * (0.5 + 0.5 * Math.sin(ambientT * 1.3 + n.g * 1.7)); animating = true; }
      const base = isIn ? this.colors.accent2 : isOut ? this.colors.accent : this.colors.node;
      if (lit && act > 0.02) {
        const fade = traceDone ? 0.55 : 1;
        c.beginPath(); c.arc(x, y, r * (1.5 + act * 1.9), 0, Math.PI * 2);
        c.fillStyle = withAlpha(this.colorGlow(), 0.1 + 0.25 * act * fade); c.fill();
      }
      c.beginPath();
      if (L.form === "CIRCUIT") c.rect(x - r, y - r, r * 2, r * 2); else c.arc(x, y, r * (1 + act * 0.5), 0, Math.PI * 2);
      c.fillStyle = withAlpha(base, this.trace ? (lit ? 0.35 + 0.65 * act : 0.25) : 0.9);
      c.fill();
      if (isOut || isIn) { c.lineWidth = lw; c.strokeStyle = withAlpha(base, 0.9); c.stroke(); }
      const sel = (this.selected?.type === "node" && this.selected.g === n.g) || (this.hover?.type === "node" && this.hover.g === n.g);
      if (sel) { c.beginPath(); c.arc(x, y, r + 5 * lw * Math.max(1, 1 / s), 0, Math.PI * 2); c.lineWidth = lw * 1.2; c.strokeStyle = this.colors.fg; c.stroke(); }
    }

    // labels in screen space
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.opts.labels && this.model) {
      c.font = `10px ${getComputedStyle(this.canvas).fontFamily}`;
      c.textAlign = "center";
      c.fillStyle = this.colors.muted;
      const acts = [null, ...this.model.layers.map((l) => l.activation)];
      for (let l = 0; l < G.layerSize.length; l++) {
        let mx = 0, my = -Infinity; const n = G.layerSize[l];
        for (let i = 0; i < n; i++) { const g = G.layerStart[l] + i; mx += this.px[g]; my = Math.max(my, this.py[g]); }
        const sx = (mx / n) * s + tx, sy = my * s + ty + 18;
        if (sx < -50 || sx > this.w + 50 || L.form === "FRACTAL") continue;
        c.fillText(`L${l} · ${l === 0 ? "in" : acts[l]} · ${n}`, sx, Math.min(this.h - 6, sy));
      }
      if (this.trace && tElapsed >= (G.layerSize.length - 1) * step) {
        const lo = G.layerSize.length - 1;
        c.textAlign = "left";
        c.fillStyle = this.colors.fg;
        for (let i = 0; i < G.layerSize[lo]; i++) {
          const g = G.layerStart[lo] + i, p = this.screenOf(g);
          const v = this.trace[lo][i];
          if (G.layerSize[lo] <= 16) c.fillText(v.toFixed(4), p.x + 10, p.y + 3);
        }
      }
    }
    return animating;
  }

  // ---------------------------------------------------------------- input
  hitTest(sx: number, sy: number): Hit {
    if (!this.G || !this.L) return null;
    const { s, tx, ty } = this.view;
    const wx = (sx - tx) / s, wy = (sy - ty) / s;
    let best = -1, bd = Infinity;
    for (const n of this.G.nodes) {
      const d = Math.hypot(this.px[n.g] - wx, this.py[n.g] - wy) * s;
      if (d < Math.max(10, this.L.r[n.g] * s + 4) && d < bd) { bd = d; best = n.g; }
    }
    if (best >= 0) return { type: "node", g: best };
    let be = -1; bd = 6;
    const budget = s > 1.6 ? this.order.length : Math.min(this.order.length, this.opts.edgeBudget);
    for (let i = 0; i < budget; i++) {
      const ei = this.order[i], path = this.paths[ei];
      let px0 = path.p[0], py0 = path.p[1];
      for (let k = 1; k <= 10; k++) {
        const [x1, y1] = this.pointAt(path, k / 10);
        const d = segDist(wx, wy, px0, py0, x1, y1) * s;
        if (d < bd) { bd = d; be = ei; }
        px0 = x1; py0 = y1;
      }
    }
    return be >= 0 ? { type: "edge", e: be } : null;
  }

  private bind() {
    const cv = this.canvas;
    cv.style.touchAction = "none";
    const pos = (e: PointerEvent | WheelEvent) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    cv.addEventListener("wheel", (e) => { e.preventDefault(); const p = pos(e); this.zoom(Math.exp(-e.deltaY * 0.0015), p.x, p.y); }, { passive: false });
    cv.addEventListener("pointerdown", (e) => { cv.setPointerCapture(e.pointerId); this.pointers.set(e.pointerId, pos(e)); this.dragging = true; this.moved = 0; });
    cv.addEventListener("pointermove", (e) => {
      const p = pos(e);
      if (this.pointers.has(e.pointerId)) {
        const prev = this.pointers.get(e.pointerId)!;
        this.pointers.set(e.pointerId, p);
        if (this.pointers.size === 2) {
          const [a, b] = [...this.pointers.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (this.lastPinch) this.zoom(d / this.lastPinch, (a.x + b.x) / 2, (a.y + b.y) / 2);
          this.lastPinch = d;
        } else if (this.dragging) { this.pan(p.x - prev.x, p.y - prev.y); this.moved += Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y); }
        return;
      }
      const h = this.hitTest(p.x, p.y);
      if (JSON.stringify(h) !== JSON.stringify(this.hover)) { this.hover = h; this.kick(); cv.style.cursor = h ? "pointer" : "grab"; }
      this.opts.onHover?.(h, h ? p : null);
    });
    const up = (e: PointerEvent) => {
      const p = pos(e);
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.lastPinch = 0;
      if (this.dragging && this.moved < 5 && this.pointers.size === 0) {
        const h = this.hitTest(p.x, p.y);
        this.selected = h;
        this.opts.onSelect?.(h);
        this.kick();
      }
      if (this.pointers.size === 0) this.dragging = false;
    };
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);
    cv.addEventListener("pointerleave", () => { if (this.hover) { this.hover = null; this.opts.onHover?.(null, null); this.kick(); } });
    cv.addEventListener("dblclick", () => this.fit());
    cv.tabIndex = 0;
    cv.addEventListener("keydown", (e) => {
      const k = e.key;
      if (k === "+" || k === "=") this.zoom(1.25);
      else if (k === "-" || k === "_") this.zoom(0.8);
      else if (k === "0") this.fit();
      else if (k === "ArrowUp") this.step("up");
      else if (k === "ArrowDown") this.step("down");
      else if (k === "ArrowLeft") this.step("left");
      else if (k === "ArrowRight") this.step("right");
      else if (k === "Escape") { this.selected = null; this.opts.onSelect?.(null); this.kick(); }
      else return;
      e.preventDefault();
    });
  }
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
  const t = l ? clamp(((px - ax) * dx + (py - ay) * dy) / l, 0, 1) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
