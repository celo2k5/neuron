import { createRng, type Model, type VisualForm } from "@neuron/engine";

/**
 * Presentation layer. Reads a model's graph; never mutates parameters.
 * Every layout is a deterministic function of (model.configHash, form).
 */
export const WORLD = { w: 1000, h: 640 };

export interface GraphNode { g: number; layer: number; index: number; degIn: number; degOut: number }
export interface GraphEdge { e: number; s: number; t: number; w: number; kind: "weight" | "skip"; layer: number; k: number }
export interface Graph { nodes: GraphNode[]; edges: GraphEdge[]; layerStart: number[]; layerSize: number[]; maxAbsW: number }

const cache = new WeakMap<Model, Graph>();

export function graphOf(m: Model): Graph {
  const hit = cache.get(m);
  if (hit) return hit;
  const sizes = [m.config.inputDim, ...m.layers.map((L) => L.outDim)];
  const layerStart: number[] = [];
  const nodes: GraphNode[] = [];
  sizes.forEach((n, l) => { layerStart.push(nodes.length); for (let i = 0; i < n; i++) nodes.push({ g: nodes.length, layer: l, index: i, degIn: 0, degOut: 0 }); });
  const edges: GraphEdge[] = [];
  let maxAbsW = 1e-9;
  m.layers.forEach((L, li) => {
    const l = li + 1;
    for (let o = 0; o < L.outDim; o++) for (let i = 0; i < L.inDim; i++) {
      const k = o * L.inDim + i;
      if (L.mask && !L.mask[k]) continue;
      const s = layerStart[l - 1] + i, t = layerStart[l] + o;
      edges.push({ e: edges.length, s, t, w: L.W[k], kind: "weight", layer: l, k });
      nodes[s].degOut++; nodes[t].degIn++;
      maxAbsW = Math.max(maxAbsW, Math.abs(L.W[k]));
    }
    if (L.residualFrom !== undefined) for (let o = 0; o < L.outDim; o++) {
      const s = layerStart[L.residualFrom] + o, t = layerStart[l] + o;
      edges.push({ e: edges.length, s, t, w: 1, kind: "skip", layer: l, k: -1 });
      nodes[s].degOut++; nodes[t].degIn++;
    }
  });
  const g = { nodes, edges, layerStart, layerSize: sizes, maxAbsW };
  cache.set(m, g);
  return g;
}

/** Edge weights change during training; refresh them on the cached graph without relayout. */
export function refreshWeights(m: Model): Graph {
  const g = graphOf(m);
  let mx = 1e-9;
  for (const e of g.edges) if (e.kind === "weight") { e.w = m.layers[e.layer - 1].W[e.k]; mx = Math.max(mx, Math.abs(e.w)); }
  g.maxAbsW = mx;
  return g;
}

export type EdgeGeometry = "line" | "curve" | "ortho" | "arc" | "bundle";
export interface Layout { form: VisualForm; x: Float32Array; y: Float32Array; r: Float32Array; geometry: EdgeGeometry; cx: number; cy: number }

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

export function layout(m: Model, form: VisualForm): Layout {
  const G = graphOf(m);
  const n = G.nodes.length, L = G.layerSize.length;
  const x = new Float32Array(n), y = new Float32Array(n), r = new Float32Array(n);
  const rng = createRng(`layout|${m.configHash}|${form}`);
  const { w: W, h: H } = WORLD;
  const mx = 90, colGap = (W - 2 * mx) / Math.max(1, L - 1);
  const minimal = (g: GraphNode) => {
    const size = G.layerSize[g.layer];
    const gap = Math.min(46, (H - 120) / Math.max(1, size));
    return [mx + g.layer * colGap, H / 2 + (g.index - (size - 1) / 2) * gap] as const;
  };
  let geometry: EdgeGeometry = "line";
  for (const g of G.nodes) {
    const deg = g.degIn + g.degOut;
    r[g.g] = 3 + Math.min(6, Math.sqrt(deg) * 0.9);
    switch (form) {
      case "MINIMAL": { const [a, b] = minimal(g); x[g.g] = a; y[g.g] = b; r[g.g] = 5; geometry = "line"; break; }
      case "CONSTELLATION": {
        const [a, b] = minimal(g);
        const size = G.layerSize[g.layer];
        x[g.g] = a + (rng.next() - 0.5) * colGap * 0.55;
        y[g.g] = b * 0.7 + H * 0.15 + (rng.next() - 0.5) * Math.min(120, (H / size) * 1.4);
        r[g.g] = 1.6 + rng.next() * 2.4 + Math.min(4, deg * 0.18);
        geometry = "line"; break;
      }
      case "CORTEX": {
        const size = G.layerSize[g.layer];
        const t = L === 1 ? 0.5 : g.layer / (L - 1);
        const ccx = mx + 40 + t * (W - 2 * mx - 80);
        const ccy = H / 2 + Math.sin(t * Math.PI * 1.3 + rng.fork("c").next() * 2) * 120;
        const R = 18 + Math.sqrt(size) * 19;
        const ang = g.index * GOLDEN + g.layer;
        const rad = R * Math.sqrt((g.index + 0.5) / size);
        x[g.g] = ccx + Math.cos(ang) * rad + (rng.next() - 0.5) * 8;
        y[g.g] = ccy + Math.sin(ang) * rad * 1.15 + (rng.next() - 0.5) * 8;
        r[g.g] = 2.5 + Math.min(5, deg * 0.2);
        geometry = "curve"; break;
      }
      case "CIRCUIT": {
        const size = G.layerSize[g.layer];
        const step = 24;
        const gap = Math.max(1, Math.floor(Math.min(46, (H - 120) / Math.max(1, size)) / step)) * step;
        x[g.g] = Math.round((mx + g.layer * colGap) / step) * step;
        y[g.g] = Math.round((H / 2 + (g.index - (size - 1) / 2) * gap) / step) * step;
        r[g.g] = 4;
        geometry = "ortho"; break;
      }
      case "FRACTAL": {
        const size = G.layerSize[g.layer];
        const R = 40 + g.layer * (Math.min(W, H) * 0.42 - 40) / Math.max(1, L - 1);
        const a0 = g.layer * GOLDEN * 2;
        const ang = a0 + (Math.PI * 2 * (g.index + 0.5)) / size;
        const lobes = 3 + (g.layer % 3);
        const rr = R * (1 + 0.12 * Math.sin(ang * lobes + g.layer));
        x[g.g] = W / 2 + Math.cos(ang) * rr * 1.25;
        y[g.g] = H / 2 + Math.sin(ang) * rr;
        r[g.g] = 2 + Math.min(5, deg * 0.16) * (1 - g.layer / (L + 1)) + 1;
        geometry = "bundle"; break;
      }
      case "SYNAPSE": {
        const [a, b] = minimal(g);
        x[g.g] = a;
        y[g.g] = b + Math.sin(g.layer * 1.7 + g.index * 0.35) * 26;
        r[g.g] = 3.5 + Math.min(5, deg * 0.2);
        geometry = "curve"; break;
      }
    }
  }
  if (form === "CIRCUIT") geometry = "ortho";
  return { form, x, y, r, geometry, cx: W / 2, cy: H / 2 };
}

/** deterministic palette from a model seed (presentation only) */
export interface SeedPalette { hue: number; pos: string; neg: string; node: string; glow: string; skip: string }
export function paletteFromSeed(configHash: string): SeedPalette {
  const hue = parseInt(configHash.slice(0, 4), 16) % 360;
  const sat = 60 + (parseInt(configHash.slice(4, 6), 16) % 30);
  return {
    hue,
    pos: `hsl(${hue} ${sat}% 64%)`,
    neg: `hsl(${(hue + 165) % 360} ${sat - 10}% 62%)`,
    node: `hsl(${hue} 30% 86%)`,
    glow: `hsl(${(hue + 25) % 360} 95% 72%)`,
    skip: `hsl(${(hue + 60) % 360} 70% 70%)`,
  };
}

/** Map an activation into [0,1] intensity relative to its layer, signed separately. */
export function intensity(a: number, layerMaxAbs: number): number {
  if (!Number.isFinite(a) || layerMaxAbs <= 0) return 0;
  return Math.min(1, Math.abs(a) / layerMaxAbs);
}

/**
 * Propagation schedule: layer l lights at l·stepMs. Edge pulses travel from their
 * source layer's time to their target layer's time, so animation order equals the
 * computational order (topological by layer).
 */
export function schedule(G: Graph, stepMs: number) {
  return {
    nodeAt: (g: number) => G.nodes[g].layer * stepMs,
    edgeSpan: (e: GraphEdge) => [G.nodes[e.s].layer * stepMs, G.nodes[e.t].layer * stepMs] as const,
    total: (G.layerSize.length - 1) * stepMs + stepMs,
  };
}
