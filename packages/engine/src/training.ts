import { dact } from "./activations";
import { createRng, type Rng } from "./prng";
import { forward } from "./inference";
import { artifactHashOf, cloneModel } from "./model";
import type { Model } from "./types";
import { assertVector, ValidationError } from "./validate";
import { MAX_DATASET, splitDataset, type Dataset } from "./datasets";

export type Optimizer = "sgd" | "adam";
export interface TrainOptions {
  optimizer: Optimizer;
  learningRate: number;
  epochs: number;
  batchSize: number;
  valFraction: number;
  /** SGD momentum (0 = plain SGD) */
  momentum?: number;
  seed?: string;
}
export const TRAIN_LIMITS = { maxEpochs: 2000, maxBatch: 256, maxLr: 1, minLr: 1e-5, maxDataset: MAX_DATASET };

export interface EpochMetrics {
  epoch: number;
  trainLoss: number;
  valLoss: number;
  trainAcc?: number;
  valAcc?: number;
  ms: number;
}

export type LossKind = "cross_entropy" | "mse";
export function lossKind(m: Model): LossKind {
  return m.config.outputActivation === "softmax" ? "cross_entropy" : "mse";
}

export function trainingIssues(m: Model, d: Dataset, o: TrainOptions): string[] {
  const e: string[] = [];
  if (m.config.inputDim !== d.inputDim) e.push(`model input ${m.config.inputDim} ≠ dataset input ${d.inputDim}`);
  if (m.config.outputDim !== d.outputDim) e.push(`model output ${m.config.outputDim} ≠ dataset output ${d.outputDim}`);
  if (d.task === "classification" && m.config.outputActivation !== "softmax" && m.config.outputActivation !== "sigmoid") e.push("classification needs a softmax or sigmoid output");
  if (d.X.length > TRAIN_LIMITS.maxDataset) e.push(`dataset over ${TRAIN_LIMITS.maxDataset} samples`);
  if (!Number.isInteger(o.epochs) || o.epochs < 1 || o.epochs > TRAIN_LIMITS.maxEpochs) e.push(`epochs must be 1–${TRAIN_LIMITS.maxEpochs}`);
  if (!Number.isInteger(o.batchSize) || o.batchSize < 1 || o.batchSize > TRAIN_LIMITS.maxBatch) e.push(`batch size must be 1–${TRAIN_LIMITS.maxBatch}`);
  if (!(o.learningRate >= TRAIN_LIMITS.minLr && o.learningRate <= TRAIN_LIMITS.maxLr)) e.push(`learning rate must be ${TRAIN_LIMITS.minLr}–${TRAIN_LIMITS.maxLr}`);
  if (o.optimizer !== "sgd" && o.optimizer !== "adam") e.push("optimizer must be sgd or adam");
  return e;
}

export interface Gradients { gW: Float64Array[]; gb: Float64Array[] }

export function zeroGrads(m: Model): Gradients {
  return { gW: m.layers.map((L) => new Float64Array(L.W.length)), gb: m.layers.map((L) => new Float64Array(L.outDim)) };
}

/** Loss for one sample and accumulation of its gradient into g (backprop through layers + identity skips). */
export function backprop(m: Model, x: number[], y: number[], g: Gradients | null): { loss: number; correct: boolean } {
  const tr = forward(m, x);
  const Lc = m.layers.length;
  const out = tr.a[Lc];
  const kind = lossKind(m);
  let loss = 0;
  const dA: Float64Array[] = tr.a.map((v) => new Float64Array(v.length));
  let dZlast: Float64Array;
  if (kind === "cross_entropy") {
    dZlast = new Float64Array(out.length);
    for (let i = 0; i < out.length; i++) { loss -= y[i] * Math.log(Math.max(out[i], 1e-15)); dZlast[i] = out[i] - y[i]; }
  } else {
    const n = out.length;
    for (let i = 0; i < n; i++) { const d = out[i] - y[i]; loss += (d * d) / n; dA[Lc][i] = (2 * d) / n; }
    dZlast = new Float64Array(0);
  }
  let correct = false;
  if (out.length > 1) {
    let pi = 0, yi = 0;
    for (let i = 1; i < out.length; i++) { if (out[i] > out[pi]) pi = i; if (y[i] > y[yi]) yi = i; }
    correct = pi === yi;
  } else correct = Math.abs(out[0] - y[0]) < 0.1;
  if (!g) return { loss, correct };
  for (let l = Lc; l >= 1; l--) {
    const L = m.layers[l - 1];
    let dZ: Float64Array;
    if (l === Lc && kind === "cross_entropy") dZ = dZlast;
    else {
      if (L.activation === "softmax") throw new ValidationError(["softmax is only supported on the output layer with cross-entropy"]);
      const f = dact[L.activation];
      dZ = new Float64Array(L.outDim);
      for (let o = 0; o < L.outDim; o++) dZ[o] = dA[l][o] * f(tr.z[l][o], tr.a[l][o]);
    }
    const aPrev = tr.a[l - 1];
    const gW = g.gW[l - 1], gb = g.gb[l - 1];
    for (let o = 0; o < L.outDim; o++) {
      const d = dZ[o];
      gb[o] += d;
      const row = o * L.inDim;
      for (let i = 0; i < L.inDim; i++) {
        if (L.mask && !L.mask[row + i]) continue;
        gW[row + i] += d * aPrev[i];
        dA[l - 1][i] += L.W[row + i] * d;
      }
    }
    if (L.residualFrom !== undefined) for (let o = 0; o < L.outDim; o++) dA[L.residualFrom][o] += dZ[o];
  }
  return { loss, correct };
}

export function evaluate(m: Model, X: number[][], Y: number[][]) {
  let loss = 0, correct = 0;
  for (let i = 0; i < X.length; i++) { const r = backprop(m, X[i], Y[i], null); loss += r.loss; if (r.correct) correct++; }
  return { loss: loss / Math.max(1, X.length), acc: correct / Math.max(1, X.length) };
}

export interface TrainerState {
  epoch: number;
  history: EpochMetrics[];
  model: Model;
}

export class Trainer {
  readonly model: Model;
  readonly options: TrainOptions;
  readonly dataset: Dataset;
  readonly split: ReturnType<typeof splitDataset>;
  epoch = 0;
  history: EpochMetrics[] = [];
  private mW: Float64Array[]; private vW: Float64Array[]; private mb: Float64Array[]; private vb: Float64Array[];
  private t = 0;
  private rng: Rng;
  readonly baseline: { valLoss: number; valAcc: number; trainLoss: number; trainAcc: number };

  constructor(model: Model, dataset: Dataset, options: TrainOptions) {
    const issues = trainingIssues(model, dataset, options);
    if (issues.length) throw new ValidationError(issues);
    dataset.X.forEach((x, i) => { assertVector(x, dataset.inputDim, `X[${i}]`); assertVector(dataset.Y[i], dataset.outputDim, `Y[${i}]`); });
    this.model = cloneModel(model);
    this.options = { momentum: 0, seed: "train", ...options };
    this.dataset = dataset;
    this.split = splitDataset(dataset, options.valFraction, this.options.seed);
    const z = () => this.model.layers.map((L) => new Float64Array(L.W.length));
    const zb = () => this.model.layers.map((L) => new Float64Array(L.outDim));
    this.mW = z(); this.vW = z(); this.mb = zb(); this.vb = zb();
    this.rng = createRng(`trainer|${model.artifactHash}|${dataset.hash}|${this.options.seed}`);
    const tr = evaluate(this.model, this.split.train.X, this.split.train.Y);
    const va = evaluate(this.model, this.split.val.X, this.split.val.Y);
    this.baseline = { trainLoss: tr.loss, trainAcc: tr.acc, valLoss: va.loss, valAcc: va.acc };
  }

  get done() { return this.epoch >= this.options.epochs; }

  /** Run one epoch of mini-batch updates; returns its metrics. */
  step(): EpochMetrics {
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const { X, Y } = this.split.train;
    const order = X.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { const j = this.rng.int(0, i); [order[i], order[j]] = [order[j], order[i]]; }
    const bs = this.options.batchSize;
    let lossSum = 0, correct = 0;
    for (let s = 0; s < order.length; s += bs) {
      const g = zeroGrads(this.model);
      const batch = order.slice(s, s + bs);
      for (const i of batch) { const r = backprop(this.model, X[i], Y[i], g); lossSum += r.loss; if (r.correct) correct++; }
      this.apply(g, batch.length);
    }
    this.epoch++;
    const va = evaluate(this.model, this.split.val.X, this.split.val.Y);
    const cls = this.dataset.task === "classification";
    const m: EpochMetrics = {
      epoch: this.epoch,
      trainLoss: lossSum / X.length,
      valLoss: va.loss,
      trainAcc: cls ? correct / X.length : undefined,
      valAcc: cls ? va.acc : undefined,
      ms: (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0,
    };
    this.history.push(m);
    return m;
  }

  private apply(g: Gradients, n: number) {
    const { optimizer, learningRate: lr, momentum = 0 } = this.options;
    this.t++;
    const b1 = 0.9, b2 = 0.999, eps = 1e-8;
    const bc1 = 1 - Math.pow(b1, this.t), bc2 = 1 - Math.pow(b2, this.t);
    const upd = (p: Float64Array, gr: Float64Array, m1: Float64Array, v1: Float64Array, mask?: Uint8Array) => {
      for (let k = 0; k < p.length; k++) {
        if (mask && !mask[k]) continue;
        const gk = gr[k] / n;
        if (optimizer === "adam") {
          m1[k] = b1 * m1[k] + (1 - b1) * gk;
          v1[k] = b2 * v1[k] + (1 - b2) * gk * gk;
          p[k] -= (lr * (m1[k] / bc1)) / (Math.sqrt(v1[k] / bc2) + eps);
        } else {
          m1[k] = momentum * m1[k] + gk;
          p[k] -= lr * m1[k];
        }
        if (!Number.isFinite(p[k])) throw new ValidationError(["training diverged (non-finite weight); lower the learning rate"]);
      }
    };
    this.model.layers.forEach((L, i) => {
      upd(L.W, g.gW[i], this.mW[i], this.vW[i], L.mask);
      upd(L.b, g.gb[i], this.mb[i], this.vb[i]);
    });
  }

  /** Immutable checkpoint: a new model version whose artifact hash commits to the trained parameters. */
  checkpoint(): Model {
    const m = cloneModel(this.model);
    m.trained = this.epoch > 0;
    m.version = this.model.version + 1;
    m.parentArtifactHash = this.model.artifactHash;
    m.artifactHash = artifactHashOf(m);
    return m;
  }
}
