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
    const pad = Math.max(24, Math.min(this.opts.padding + 20, Math.min(this.w, this.h) * 0.09));
    const padB = pad + (this.opts.labels ? 30 : 0);
    const s = Math.min((this.w - pad * 2) / Math.max(40, x1 - x0), (this.h - pad - padB) / Math.max(40, y1 - y0), 4);
    this.view = { s, tx: this.w / 2 - ((x0 + x1) / 2) * s, ty: (this.h - padB + pad) / 2 - ((y0 + y1) / 2) * s };
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

  private trace2d(path: Path, c: CanvasRenderingContext2D = this.ctx) {
    const p = path.p;
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

  /** node radius in SCREEN pixels: legible at any zoom, smaller as networks get denser */
  private nodeR(g: number) {
    const n = this.G!.nodes.length;
    const lo = n < 40 ? 5 : n < 120 ? 4 : n < 400 ? 2.8 : 2.1;
    const hi = n < 40 ? 11 : n < 120 ? 9 : 6.5;
    return clamp(this.L!.r[g] * this.view.s * 1.25, lo, hi) * (0.9 + 0.2 * Math.min(1, this.view.s));
  }

  private gridPattern: CanvasPattern | null = null;
  private gridFor = "";
  private grid() {
    const key = `${this.colors.fg}|${this.dpr}`;
    if (this.gridPattern && this.gridFor === key) return this.gridPattern;
    const t = document.createElement("canvas"), S = Math.round(24 * this.dpr);
    t.width = t.height = S;
    const g = t.getContext("2d")!;
    g.fillStyle = withAlpha(this.colors.fg, 0.07);
    g.beginPath(); g.arc(S / 2, S / 2, 0.75 * this.dpr, 0, Math.PI * 2); g.fill();
    this.gridPattern = this.ctx.createPattern(t, "repeat");
    this.gridFor = key;
    return this.gridPattern;
  }

  private edgeCache: HTMLCanvasElement | null = null;
  private edgeKey = "";
  private cacheCtx() {
    if (!this.edgeCache) this.edgeCache = document.createElement("canvas");
    if (this.edgeCache.width !== this.canvas.width || this.edgeCache.height !== this.canvas.height) { this.edgeCache.width = this.canvas.width; this.edgeCache.height = this.canvas.height; }
    return this.edgeCache.getContext("2d")!;
  }

  private drawEdges(c: CanvasRenderingContext2D, s: number, vx0: number, vy0: number, vx1: number, vy1: number, budget: number, maxW: number, pos: string, neg: string, base: number, span: number, wBase: number, dim: number) {
    const G = this.G!, lw = 1 / s;
    const visible: number[] = [];
    for (const ei of this.order) {
      if (visible.length >= budget) break;
      const e = G.edges[ei];
      const ax = this.px[e.s], ay = this.py[e.s], bx = this.px[e.t], by = this.py[e.t];
      if (Math.max(ax, bx) < vx0 || Math.min(ax, bx) > vx1 || Math.max(ay, by) < vy0 - 200 || Math.min(ay, by) > vy1 + 200) continue;
      visible.push(ei);
    }
    if (visible.length <= 700) {
      // per-edge: a gradient that fades into each end, width and alpha by |w|
      for (let i = visible.length - 1; i >= 0; i--) {
        const ei = visible[i], e = G.edges[ei], path = this.paths[ei];
        const m = Math.min(1, Math.abs(e.w) / maxW);
        const col = e.w >= 0 ? pos : neg;
        const a = (base + span * m * m) * dim;
        const p = path.p, ex = p[p.length - 2], ey = p[p.length - 1];
        const gr = c.createLinearGradient(p[0], p[1], ex, ey);
        gr.addColorStop(0, withAlpha(col, a * 0.35)); gr.addColorStop(0.5, withAlpha(col, a)); gr.addColorStop(1, withAlpha(col, a * 0.35));
        c.beginPath(); this.trace2d(path, c);
        c.strokeStyle = gr; c.lineWidth = lw * (wBase + m * 1.9); c.lineCap = "round";
        if (e.w < 0 && this.colors.pos === this.colors.neg) c.setLineDash([3 * lw, 3 * lw]);
        c.stroke(); c.setLineDash([]);
      }
    } else {
      const buckets: number[][] = Array.from({ length: 8 }, () => []);
      for (const ei of visible) { const e = G.edges[ei]; const mag = Math.min(0.999, Math.abs(e.w) / maxW); buckets[(e.w >= 0 ? 0 : 4) + Math.floor(mag * 4)].push(ei); }
      for (let b = 0; b < 8; b++) {
        if (!buckets[b].length) continue;
        const m = (b % 4) / 3;
        c.beginPath();
        for (const ei of buckets[b]) this.trace2d(this.paths[ei], c);
        c.strokeStyle = withAlpha(b < 4 ? pos : neg, (base + span * m * m) * dim);
        c.lineWidth = lw * (wBase + m * 1.3);
        if (b >= 4 && this.colors.pos === this.colors.neg) c.setLineDash([3 * lw, 3 * lw]);
        c.stroke(); c.setLineDash([]);
      }
    }

  }

  /** returns true while something is animating */
  private draw(now: number): boolean {
    const c = this.ctx, G = this.G, L = this.L;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!G || !L) return false;
    let animating = false;

    // backdrop: a fine dot grid that pans with the graph
    const pat = this.grid();
    if (pat) {
      c.save();
      const ox = ((this.view.tx % 24) + 24) % 24, oy = ((this.view.ty % 24) + 24) % 24;
      c.translate(ox * this.dpr, oy * this.dpr);
      c.fillStyle = pat; c.fillRect(-ox * this.dpr, -oy * this.dpr, this.canvas.width, this.canvas.height);
      c.restore();
    }

    // morph between visual forms
    if (this.from) {
      const t = clamp((now - this.morphStart) / 750, 0, 1), k = ease(t);
      for (let i = 0; i < this.px.length; i++) { this.px[i] = this.from.x[i] + (L.x[i] - this.from.x[i]) * k; this.py[i] = this.from.y[i] + (L.y[i] - this.from.y[i]) * k; }
      this.buildPaths(this.px, this.py);
      if (t >= 1) { this.from = null; this.buildPaths(L.x, L.y); } else animating = true;
    }

    const { s, tx, ty } = this.view;
    c.setTransform(this.dpr * s, 0, 0, this.dpr * s, this.dpr * tx, this.dpr * ty);
    const lw = 1 / s; // one screen pixel in world units
    const tElapsed = this.trace ? now - this.traceAt : Infinity;
    const step = this.reducedMotion ? 1 : this.opts.stepMs;
    const traceDone = tElapsed > G.layerSize.length * step + 600;
    const tracing = !!this.trace && !traceDone;
    if (tracing) animating = true;

    const vx0 = -tx / s - 40, vy0 = -ty / s - 40, vx1 = (this.w - tx) / s + 40, vy1 = (this.h - ty) / s + 40;
    const budget = s > 1.6 ? Infinity : this.opts.edgeBudget;
    const maxW = G.maxAbsW;
    const pos = this.colorPos(), neg = this.colorNeg();
    const E = G.edges.length;
    // sparse networks get confident edges; dense ones stay a fine mesh
    const base = clamp(0.42 - E / 2600, 0.045, 0.34);
    const span = clamp(0.55 - E / 3000, 0.16, 0.5);
    const wBase = E < 300 ? 0.9 : E < 1200 ? 0.6 : 0.45;
    const dim = tracing ? 0.55 : 1;

    // the edge layer only changes with the view, the model, the palette or the theme: cache it
    const cacheable = !this.from && !tracing;
    const key = `${s.toFixed(5)}|${tx.toFixed(2)}|${ty.toFixed(2)}|${this.model?.artifactHash}|${L.form}|${this.paletteMode}|${pos}|${neg}|${this.canvas.width}x${this.canvas.height}`;
    if (cacheable && this.edgeCache && this.edgeKey === key) {
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.drawImage(this.edgeCache, 0, 0);
      c.setTransform(this.dpr * s, 0, 0, this.dpr * s, this.dpr * tx, this.dpr * ty);
    } else {
    const target = cacheable ? this.cacheCtx() : c;
    if (cacheable) { target.setTransform(1, 0, 0, 1, 0, 0); target.clearRect(0, 0, this.canvas.width, this.canvas.height); target.setTransform(this.dpr * s, 0, 0, this.dpr * s, this.dpr * tx, this.dpr * ty); }
    this.drawEdges(target, s, vx0, vy0, vx1, vy1, budget, maxW, pos, neg, base, span, wBase, dim);
    if (cacheable) {
      this.edgeKey = key;
      c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(this.edgeCache!, 0, 0);
      c.setTransform(this.dpr * s, 0, 0, this.dpr * s, this.dpr * tx, this.dpr * ty);
    }
    }

    // focus: edges of hovered / selected node or edge
    const focus = this.hover ?? this.selected;
    if (focus) {
      c.beginPath();
      if (focus.type === "node") { for (const e of G.edges) if (e.s === focus.g || e.t === focus.g) this.trace2d(this.paths[e.e]); }
      else this.trace2d(this.paths[focus.e]);
      c.strokeStyle = withAlpha(this.colors.fg, 0.8);
      c.lineWidth = lw * 1.6;
      c.stroke();
    }

    // activation pulses along real edges, strength ∝ |w · a_src|
    const glow = this.colorGlow();
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
      c.globalCompositeOperation = "lighter";
      for (let i = 0; i < lim; i++) {
        const { e, f } = flows[i];
        const t0 = G.nodes[e.s].layer * step, t1 = G.nodes[e.t].layer * step;
        const u = (tElapsed - t0) / (t1 - t0);
        if (u < 0 || u > 1) continue;
        const k = f / fmax;
        if (k < 0.04) continue;
        const [x, y] = this.pointAt(this.paths[e.e], u);
        const [x2, y2] = this.pointAt(this.paths[e.e], Math.max(0, u - 0.18));
        const tr = c.createLinearGradient(x2, y2, x, y);
        tr.addColorStop(0, withAlpha(e.w >= 0 ? pos : neg, 0)); tr.addColorStop(1, withAlpha(glow, 0.35 + 0.6 * k));
        c.beginPath(); c.moveTo(x2, y2); c.lineTo(x, y);
        c.strokeStyle = tr; c.lineWidth = lw * (1 + 2.6 * k); c.lineCap = "round";
        c.stroke();
        const hr = (2 + 4 * k) * lw;
        const hg = c.createRadialGradient(x, y, 0, x, y, hr * 2.4);
        hg.addColorStop(0, withAlpha(glow, 0.9)); hg.addColorStop(1, withAlpha(glow, 0));
        c.fillStyle = hg; c.beginPath(); c.arc(x, y, hr * 2.4, 0, Math.PI * 2); c.fill();
      }
      c.globalCompositeOperation = "source-over";
    }

    // nodes, in screen space so they stay crisp and legible at every zoom
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const ambientT = now / 1000;
    const light = isLight(this.colors.bg);
    for (const n of G.nodes) {
      const wx = this.px[n.g], wy = this.py[n.g];
      if (wx < vx0 || wx > vx1 || wy < vy0 || wy > vy1) continue;
      const x = wx * s + tx, y = wy * s + ty;
      let r = this.nodeR(n.g);
      const isIn = n.layer === 0, isOut = n.layer === G.layerSize.length - 1;
      let act = 0, lit = false;
      if (this.trace) {
        lit = tElapsed >= n.layer * step;
        if (lit) act = Math.min(1, Math.abs(this.trace[n.layer]?.[n.index] ?? 0) / this.layerMax[n.layer]);
      }
      if (this.opts.ambient && !this.reducedMotion && L.form === "CONSTELLATION") { r *= 0.92 + 0.16 * (0.5 + 0.5 * Math.sin(ambientT * 1.3 + n.g * 1.7)); animating = true; }
      // tint by depth: ice at the input, cobalt at the output, kept bright toward the node colour
      const depthT = n.layer / Math.max(1, G.layerSize.length - 1);
      const col = isIn ? this.colors.accent2 : isOut ? this.colors.accent : mix(mix(this.colors.accent2, this.colors.accent, depthT), this.colors.node, light ? 0.15 : 0.45);
      const hot = lit && act > 0.02;
      // halo
      const hR = r * (2.6 + act * 3.4);
      const hA = this.trace ? (lit ? 0.08 + 0.42 * act * (traceDone ? 0.6 : 1) : 0.03) : (isIn || isOut ? 0.2 : 0.1);
      const halo = c.createRadialGradient(x, y, r * 0.4, x, y, hR);
      halo.addColorStop(0, withAlpha(hot ? glow : col, hA * (light ? 0.7 : 1)));
      halo.addColorStop(1, withAlpha(hot ? glow : col, 0));
      c.fillStyle = halo; c.beginPath(); c.arc(x, y, hR, 0, Math.PI * 2); c.fill();
      // body: lit core over a darker rim
      const rr = r * (1 + act * 0.35);
      const dimNode = this.trace && !lit ? 0.35 : 1;
      c.beginPath();
      if (L.form === "CIRCUIT") roundRect(c, x - rr, y - rr, rr * 2, rr * 2, rr * 0.35); else c.arc(x, y, rr, 0, Math.PI * 2);
      const body = c.createRadialGradient(x - rr * 0.35, y - rr * 0.35, rr * 0.1, x, y, rr);
      body.addColorStop(0, withAlpha(light ? col : mix(col, "#ffffff", 0.55), dimNode));
      body.addColorStop(0.55, withAlpha(col, 0.95 * dimNode));
      body.addColorStop(1, withAlpha(light ? mix(col, "#000000", 0.25) : mix(col, this.colors.bg, 0.45), 0.95 * dimNode));
      c.fillStyle = body; c.fill();
      c.lineWidth = 1; c.strokeStyle = withAlpha(light ? "#000000" : "#ffffff", light ? 0.12 : 0.18 * dimNode); c.stroke();
      if (hot) { c.beginPath(); c.arc(x, y, rr * 0.42, 0, Math.PI * 2); c.fillStyle = withAlpha(light ? glow : "#ffffff", 0.55 + 0.45 * act); c.fill(); }
      if (isOut || isIn) { c.beginPath(); c.arc(x, y, rr + 4, 0, Math.PI * 2); c.lineWidth = 1; c.strokeStyle = withAlpha(col, 0.5); c.stroke(); }
      const sel = (this.selected?.type === "node" && this.selected.g === n.g) || (this.hover?.type === "node" && this.hover.g === n.g);
      if (sel) { c.beginPath(); c.arc(x, y, rr + 7, 0, Math.PI * 2); c.lineWidth = 1.5; c.strokeStyle = this.colors.fg; c.stroke(); }
    }

    // layer labels: small pills under each column
    if (this.opts.labels && this.model && L.form !== "FRACTAL") {
      const mono = (getComputedStyle(document.documentElement).getPropertyValue("--font-geist-mono") || "ui-monospace") + ", ui-monospace, monospace";
      c.font = `500 10.5px ${mono}`;
      c.textAlign = "center"; c.textBaseline = "middle";
      const acts = [null, ...this.model.layers.map((l) => l.activation)];
      for (let l = 0; l < G.layerSize.length; l++) {
        let mx = 0, my = -Infinity; const n = G.layerSize[l];
        for (let i = 0; i < n; i++) { const g = G.layerStart[l] + i; mx += this.px[g]; my = Math.max(my, this.py[g]); }
        const sx = (mx / n) * s + tx, sy = Math.min(this.h - 16, my * s + ty + 26);
        if (sx < -60 || sx > this.w + 60) continue;
        const text = `${l === 0 ? "in" : l === G.layerSize.length - 1 ? "out" : "L" + l} · ${l === 0 ? "" : acts[l] + " · "}${n}`;
        const tw = c.measureText(text).width + 14;
        c.beginPath(); roundRect(c, sx - tw / 2, sy - 9, tw, 18, 9);
        c.fillStyle = withAlpha(this.colors.bg, 0.82); c.fill();
        c.lineWidth = 1; c.strokeStyle = withAlpha(this.colors.fg, 0.1); c.stroke();
        c.fillStyle = this.colors.muted; c.fillText(text, sx, sy + 0.5);
      }
      if (this.trace && tElapsed >= (G.layerSize.length - 1) * step) {
        const lo = G.layerSize.length - 1;
        c.textAlign = "left";
        for (let i = 0; i < G.layerSize[lo] && G.layerSize[lo] <= 16; i++) {
          const g = G.layerStart[lo] + i, p = this.screenOf(g);
          const v = this.trace[lo][i], txt = v.toFixed(4), w = c.measureText(txt).width + 12;
          c.beginPath(); roundRect(c, p.x + 14, p.y - 9, w, 18, 5);
          c.fillStyle = withAlpha(this.colors.bg, 0.85); c.fill();
          c.strokeStyle = withAlpha(this.colors.accent, 0.45); c.stroke();
          c.fillStyle = this.colors.fg; c.fillText(txt, p.x + 20, p.y + 0.5);
        }
      }
      c.textBaseline = "alphabetic";
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
      if (d < Math.max(10, this.nodeR(n.g) + 4) && d < bd) { bd = d; best = n.g; }
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
    // vertical swipes keep scrolling the page; horizontal drags pan the graph, two fingers zoom it
    cv.style.touchAction = "pan-y";
    const pos = (e: PointerEvent | WheelEvent) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    // a plain wheel scrolls the page; ctrl/⌘ + wheel (and trackpad pinch, which reports ctrlKey) zooms
    cv.addEventListener("wheel", (e) => { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); const p = pos(e); this.zoom(Math.exp(-e.deltaY * 0.0015), p.x, p.y); }, { passive: false });
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

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const k = Math.min(r, w / 2, h / 2);
  c.moveTo(x + k, y); c.arcTo(x + w, y, x + w, y + h, k); c.arcTo(x + w, y + h, x, y + h, k); c.arcTo(x, y + h, x, y, k); c.arcTo(x, y, x + w, y, k); c.closePath();
}
function rgbOf(color: string): [number, number, number] {
  const m = withAlpha(color, 1).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return m ? [+m[1], +m[2], +m[3]] : [128, 128, 128];
}
function mix(a: string, b: string, t: number) {
  const A = rgbOf(a), B = rgbOf(b);
  return `rgb(${Math.round(A[0] + (B[0] - A[0]) * t)},${Math.round(A[1] + (B[1] - A[1]) * t)},${Math.round(A[2] + (B[2] - A[2]) * t)})`;
}
function isLight(bg: string) { const [r, g, b] = rgbOf(bg); return 0.2126 * r + 0.7152 * g + 0.0722 * b > 140; }

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
  const t = l ? clamp(((px - ax) * dx + (py - ay) * dy) / l, 0, 1) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
