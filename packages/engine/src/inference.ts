import { act, softmax } from "./activations";
import { hashCanonical } from "./canonical";
import { ENGINE_VERSION, LIMITS, TOLERANCE, type Layer, type Model } from "./types";
import { assertVector, NumericError } from "./validate";

/** y = W·x + b  (W is out×in row-major). Masked entries are stored as exact zeros. */
export function matVec(W: ArrayLike<number>, x: ArrayLike<number>, b: ArrayLike<number> | null, outDim: number, inDim: number, y = new Float64Array(outDim)): Float64Array {
  if (W.length !== outDim * inDim) throw new NumericError(`matVec: W has ${W.length} entries, expected ${outDim * inDim}`);
  if (x.length !== inDim) throw new NumericError(`matVec: x has ${x.length} entries, expected ${inDim}`);
  for (let o = 0; o < outDim; o++) {
    let s = b ? b[o] : 0;
    const row = o * inDim;
    for (let i = 0; i < inDim; i++) s += W[row + i] * x[i];
    y[o] = s;
  }
  return y;
}

export interface ForwardTrace {
  /** activations per layer, index 0 = input */
  a: Float64Array[];
  /** pre-activations per parameterised layer, z[l] belongs to a[l]; z[0] is empty */
  z: Float64Array[];
  output: number[];
}

function check(v: Float64Array, where: string) {
  for (let i = 0; i < v.length; i++) {
    const x = v[i];
    if (!Number.isFinite(x)) throw new NumericError(`non-finite value at ${where}[${i}]`);
    if (Math.abs(x) > LIMITS.maxAbsActivation) throw new NumericError(`magnitude bound exceeded at ${where}[${i}]`);
  }
}

export function forward(model: Model, input: ArrayLike<number>): ForwardTrace {
  assertVector(input as number[], model.config.inputDim, "input");
  const a: Float64Array[] = [Float64Array.from(input)];
  const z: Float64Array[] = [new Float64Array(0)];
  model.layers.forEach((L: Layer, li) => {
    const l = li + 1;
    const zl = matVec(L.W, a[l - 1], L.b, L.outDim, L.inDim);
    if (L.residualFrom !== undefined) {
      const skip = a[L.residualFrom];
      for (let o = 0; o < L.outDim; o++) zl[o] += skip[o];
    }
    check(zl, `z[${l}]`);
    let al: Float64Array;
    if (L.activation === "softmax") al = softmax(zl);
    else { const f = act[L.activation]; al = zl.map(f); }
    check(al, `a[${l}]`);
    z.push(zl);
    a.push(al);
  });
  return { a, z, output: Array.from(a[a.length - 1]) };
}

export interface ExperimentRecord {
  engine: string;
  modelId: string;
  modelVersion: number;
  configHash: string;
  artifactHash: string;
  input: number[];
  output: number[];
  /** per-layer activations (input layer first) */
  activations: number[][];
  elapsedMs: number;
  resultHash: string;
}

/** The fields committed by the result hash (elapsed time is excluded — it is not reproducible). */
export function resultHashOf(r: Pick<ExperimentRecord, "engine" | "artifactHash" | "configHash" | "input" | "output">): string {
  return hashCanonical({ engine: r.engine, artifactHash: r.artifactHash, configHash: r.configHash, input: r.input, output: r.output });
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export function runExperiment(model: Model, input: number[]): ExperimentRecord {
  const t0 = now();
  const tr = forward(model, input);
  const elapsedMs = now() - t0;
  const rec = {
    engine: ENGINE_VERSION, modelId: model.id, modelVersion: model.version, configHash: model.configHash,
    artifactHash: model.artifactHash, input: Array.from(input), output: tr.output,
    activations: tr.a.map((v) => Array.from(v)), elapsedMs,
  };
  return { ...rec, resultHash: resultHashOf(rec) };
}

export interface ReproResult {
  match: "exact" | "within_tolerance" | "mismatch";
  maxAbsDiff: number;
  maxRelDiff: number;
  rerunOutput: number[];
}

export function compareOutputs(expected: number[], actual: number[], tol = TOLERANCE): ReproResult {
  if (expected.length !== actual.length) return { match: "mismatch", maxAbsDiff: Infinity, maxRelDiff: Infinity, rerunOutput: actual };
  let maxAbs = 0, maxRel = 0, exact = true, ok = true;
  for (let i = 0; i < expected.length; i++) {
    const d = Math.abs(expected[i] - actual[i]);
    if (d !== 0) exact = false;
    const rel = d / Math.max(Math.abs(expected[i]), 1e-300);
    maxAbs = Math.max(maxAbs, d);
    maxRel = Math.max(maxRel, d === 0 ? 0 : rel);
    if (d > tol.abs && rel > tol.rel) ok = false;
  }
  return { match: exact ? "exact" : ok ? "within_tolerance" : "mismatch", maxAbsDiff: maxAbs, maxRelDiff: maxRel, rerunOutput: actual };
}

export function reproduce(model: Model, rec: Pick<ExperimentRecord, "input" | "output" | "artifactHash">): ReproResult {
  if (model.artifactHash !== rec.artifactHash) throw new NumericError("model version differs from the experiment's pinned artifact");
  return compareOutputs(rec.output, forward(model, rec.input).output);
}
