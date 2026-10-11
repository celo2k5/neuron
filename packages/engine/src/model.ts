import { canonical, hashCanonical } from "./canonical";
import { createRng, PRNG_VERSION, type Rng } from "./prng";
import {
  ACTIVATIONS, ENGINE_VERSION, LIMITS, MODEL_SCHEMA,
  type Activation, type Architecture, type Layer, type Model, type ModelConfig, type WeightInit,
} from "./types";
import { assertConfig, ValidationError } from "./validate";

/** Sparse activation lists can't carry `undefined`; keep config canonical-safe */
function cleanConfig(c: ModelConfig): ModelConfig {
  return {
    name: c.name, seed: c.seed, architecture: c.architecture,
    inputDim: c.inputDim, outputDim: c.outputDim,
    hidden: [...c.hidden], activations: [...c.activations],
    outputActivation: c.outputActivation, density: c.density, init: c.init,
  };
}

export function configHashOf(c: ModelConfig): string {
  return hashCanonical({ engine: ENGINE_VERSION, prng: PRNG_VERSION, config: cleanConfig(c) });
}

function initStd(init: WeightInit, fanIn: number, fanOut: number): number {
  switch (init) {
    case "xavier": return Math.sqrt(2 / (fanIn + fanOut));
    case "he": return Math.sqrt(2 / fanIn);
    case "normal": return 0.5;
    case "uniform": return Math.sqrt(6 / (fanIn + fanOut)); // used as limit
  }
}

function buildLayer(rng: Rng, c: ModelConfig, li: number, inDim: number, outDim: number, activation: Layer["activation"]): Layer {
  const W = new Float64Array(outDim * inDim);
  const b = new Float64Array(outDim);
  let mask: Uint8Array | undefined;
  if (c.architecture === "sparse") {
    const mr = rng.fork(`mask/${li}`);
    mask = new Uint8Array(outDim * inDim);
    for (let k = 0; k < mask.length; k++) mask[k] = mr.next() < c.density ? 1 : 0;
    // every output keeps ≥1 incoming, every input keeps ≥1 outgoing
    for (let o = 0; o < outDim; o++) {
      let any = 0;
      for (let i = 0; i < inDim; i++) any |= mask[o * inDim + i];
      if (!any) mask[o * inDim + mr.int(0, inDim - 1)] = 1;
    }
    for (let i = 0; i < inDim; i++) {
      let any = 0;
      for (let o = 0; o < outDim; o++) any |= mask[o * inDim + i];
      if (!any) mask[mr.int(0, outDim - 1) * inDim + i] = 1;
    }
  }
  const wr = rng.fork(`weights/${li}`);
  const effIn = mask ? Math.max(1, Math.round(inDim * c.density)) : inDim;
  const std = initStd(c.init, effIn, outDim);
  for (let k = 0; k < W.length; k++) {
    const v = c.init === "uniform" ? (wr.next() * 2 - 1) * std : wr.normal() * std;
    W[k] = mask && !mask[k] ? 0 : v;
  }
  const br = rng.fork(`bias/${li}`);
  for (let o = 0; o < outDim; o++) b[o] = br.normal() * 0.05;
  return { inDim, outDim, activation, W, b, mask };
}

/** Generate a model. Identical config + ENGINE_VERSION ⇒ identical parameters and hashes. */
export function generateModel(config: ModelConfig): Model {
  assertConfig(config);
  const c = cleanConfig(config);
  const configHash = configHashOf(c);
  const rng = createRng(`model|${canonical(c)}`);
  const dims = [c.inputDim, ...c.hidden, c.outputDim];
  const layers: Layer[] = [];
  for (let l = 1; l < dims.length; l++) {
    const isOut = l === dims.length - 1;
    const layer = buildLayer(rng, c, l, dims[l - 1], dims[l], isOut ? c.outputActivation : c.activations[l - 1]);
    if (c.architecture === "residual" && !isOut && l >= 3 && (l - 1) % 2 === 0 && dims[l - 2] === dims[l]) {
      layer.residualFrom = l - 2;
    }
    layers.push(layer);
  }
  const model: Model = {
    schema: MODEL_SCHEMA, engine: ENGINE_VERSION, config: c, layers,
    configHash, artifactHash: "", id: "M-" + configHash.slice(0, 12), version: 1, trained: false,
  };
  model.artifactHash = artifactHashOf(model);
  return model;
}

export function parameterCount(m: Model): number {
  let n = 0;
  for (const L of m.layers) {
    n += L.outDim;
    if (L.mask) for (let k = 0; k < L.mask.length; k++) n += L.mask[k];
    else n += L.W.length;
  }
  return n;
}

export function neuronCount(m: Model): number {
  return m.config.inputDim + m.layers.reduce((s, L) => s + L.outDim, 0);
}

export function connectionCount(m: Model): number {
  let n = 0;
  for (const L of m.layers) {
    if (L.mask) for (let k = 0; k < L.mask.length; k++) n += L.mask[k];
    else n += L.W.length;
    if (L.residualFrom !== undefined) n += L.outDim;
  }
  return n;
}

/** Deterministic neuron id: layer index (0 = input) and position. */
export function neuronId(m: Model, layer: number, index: number): string {
  return `${m.id}:${layer}.${index}`;
}

function paramsPayload(m: Model) {
  return m.layers.map((L) => ({
    in: L.inDim, out: L.outDim, act: L.activation, W: L.W, b: L.b,
    mask: L.mask ? Array.from(L.mask).join("") : undefined,
    res: L.residualFrom,
  }));
}

export function artifactHashOf(m: Model): string {
  return hashCanonical({ schema: MODEL_SCHEMA, engine: m.engine, configHash: m.configHash, layers: paramsPayload(m) });
}

/** Declarative export format (no executable content). */
export interface ModelArtifact {
  schema: typeof MODEL_SCHEMA;
  engine: string;
  config: ModelConfig;
  configHash: string;
  artifactHash: string;
  version: number;
  trained: boolean;
  parentArtifactHash?: string;
  layers: { in: number; out: number; act: string; W: number[]; b: number[]; mask?: string; res?: number }[];
}

export function exportModel(m: Model): ModelArtifact {
  return {
    schema: MODEL_SCHEMA, engine: m.engine, config: m.config, configHash: m.configHash,
    artifactHash: m.artifactHash, version: m.version, trained: m.trained, parentArtifactHash: m.parentArtifactHash,
    layers: paramsPayload(m).map((p) => ({ ...p, W: Array.from(p.W), b: Array.from(p.b) })),
  };
}

/** Import and fully validate an artifact; recomputes and checks both hashes. */
export function importModel(a: ModelArtifact): Model {
  const fail = (msg: string) => { throw new ValidationError([msg]); };
  if (!a || a.schema !== MODEL_SCHEMA) fail("unknown model schema");
  if (a.engine !== ENGINE_VERSION) fail(`artifact engine ${a.engine} is not ${ENGINE_VERSION}`);
  assertConfig(a.config);
  if (configHashOf(a.config) !== a.configHash) fail("config hash mismatch");
  const dims = [a.config.inputDim, ...a.config.hidden, a.config.outputDim];
  if (!Array.isArray(a.layers) || a.layers.length !== dims.length - 1) fail("layer count mismatch");
  const layers: Layer[] = a.layers.map((p, i) => {
    const inDim = dims[i], outDim = dims[i + 1];
    const expectedAct = i === dims.length - 2 ? a.config.outputActivation : a.config.activations[i];
    if (p.in !== inDim || p.out !== outDim) fail(`layer ${i + 1} dimensions mismatch`);
    if (p.act !== expectedAct) fail(`layer ${i + 1} activation mismatch`);
    if (!Array.isArray(p.W) || p.W.length !== inDim * outDim) fail(`layer ${i + 1} W size`);
    if (!Array.isArray(p.b) || p.b.length !== outDim) fail(`layer ${i + 1} b size`);
    for (const x of [...p.W, ...p.b]) if (typeof x !== "number" || !Number.isFinite(x) || Math.abs(x) > 1e6) fail(`layer ${i + 1} has invalid parameter`);
    let mask: Uint8Array | undefined;
    if (a.config.architecture === "sparse") {
      if (typeof p.mask !== "string" || p.mask.length !== inDim * outDim || /[^01]/.test(p.mask)) fail(`layer ${i + 1} mask invalid`);
      mask = Uint8Array.from(p.mask!, (ch) => (ch === "1" ? 1 : 0));
      p.W.forEach((w, k) => { if (!mask![k] && w !== 0) fail(`layer ${i + 1} masked weight must be 0`); });
    } else if (p.mask !== undefined) fail("mask only allowed on sparse models");
    if (p.res !== undefined && (a.config.architecture !== "residual" || p.res !== i - 1 || dims[p.res] !== outDim)) fail(`layer ${i + 1} invalid residual`);
    return { inDim, outDim, activation: expectedAct, W: Float64Array.from(p.W), b: Float64Array.from(p.b), mask, residualFrom: p.res };
  });
  const m: Model = {
    schema: MODEL_SCHEMA, engine: a.engine, config: a.config, layers, configHash: a.configHash,
    artifactHash: "", id: "M-" + a.configHash.slice(0, 12), version: a.version ?? 1, trained: !!a.trained,
    parentArtifactHash: a.parentArtifactHash,
  };
  m.artifactHash = artifactHashOf(m);
  if (m.artifactHash !== a.artifactHash) fail("artifact hash mismatch");
  return m;
}

export function cloneModel(m: Model): Model {
  return {
    ...m, config: cleanConfig(m.config),
    layers: m.layers.map((L) => ({ ...L, W: new Float64Array(L.W), b: new Float64Array(L.b), mask: L.mask ? new Uint8Array(L.mask) : undefined })),
  };
}

/** Seeded helpers the UI uses to turn "auto" choices into explicit, hashable config. */
export function suggestWidths(seed: string, layers: number, min: number, max: number): number[] {
  const r = createRng(`widths|${seed}|${layers}|${min}|${max}`);
  const shape = r.pick(["taper", "bulge", "flat", "hourglass"] as const);
  return Array.from({ length: layers }, (_, i) => {
    const t = layers === 1 ? 0.5 : i / (layers - 1);
    const base = shape === "taper" ? 1 - t : shape === "bulge" ? 1 - Math.abs(t - 0.5) * 2 : shape === "hourglass" ? Math.abs(t - 0.5) * 2 : 0.6;
    const w = Math.round(min + (max - min) * (0.25 + 0.75 * base) * (0.8 + 0.4 * r.next()));
    return Math.max(min, Math.min(max, w));
  });
}

export function suggestActivations(seed: string, layers: number): Activation[] {
  const r = createRng(`acts|${seed}|${layers}`);
  return Array.from({ length: layers }, () => r.pick(ACTIVATIONS.filter((a) => a !== "linear")));
}

export function randomConfig(seed: string, overrides: Partial<ModelConfig> = {}): ModelConfig {
  const r = createRng(`config|${seed}`);
  const architecture: Architecture = overrides.architecture ?? r.pick(["feedforward", "sparse", "residual"] as const);
  const n = architecture === "residual" ? r.int(3, 5) : r.int(1, 4);
  let hidden = suggestWidths(seed, n, 3, 16);
  if (architecture === "residual") hidden = hidden.map(() => hidden[0]);
  const inputDim = overrides.inputDim ?? r.int(2, 6);
  const outputDim = overrides.outputDim ?? r.int(1, 4);
  const cfg: ModelConfig = {
    name: overrides.name ?? `specimen-${seed}`.slice(0, 48),
    seed,
    architecture,
    inputDim,
    outputDim,
    hidden: overrides.hidden ?? hidden,
    activations: overrides.activations ?? suggestActivations(seed, overrides.hidden?.length ?? hidden.length),
    outputActivation: overrides.outputActivation ?? (outputDim >= 2 && r.next() < 0.5 ? "softmax" : r.pick(["sigmoid", "tanh", "linear"] as const)),
    density: architecture === "sparse" ? (overrides.density ?? Math.round((0.25 + r.next() * 0.5) * 100) / 100) : 1,
    init: overrides.init ?? r.pick(["xavier", "he", "uniform", "normal"] as const),
  };
  return cfg;
}

export { LIMITS };
