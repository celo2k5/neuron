import { describe, expect, it } from "vitest";
import {
  ACTIVATIONS, act, backprop, canonical, compareOutputs, connectionCount, createRng, evaluate, exportModel,
  forward, generateModel, hashCanonical, importModel, makeDataset, matVec, parameterCount, randomConfig,
  reproduce, runExperiment, softmax, Trainer, zeroGrads, configIssues, ValidationError,
  type Model, type ModelConfig,
} from "../src";

const base: ModelConfig = {
  name: "test", seed: "alpha", architecture: "feedforward", inputDim: 3, outputDim: 2,
  hidden: [5, 4], activations: ["relu", "tanh"], outputActivation: "softmax", density: 1, init: "xavier",
};

/** independent reference forward using nested arrays and the textbook formulas */
function referenceForward(m: Model, x: number[]): number[] {
  const acts: number[][] = [x];
  m.layers.forEach((L, li) => {
    const prev = acts[li];
    const z: number[] = [];
    for (let o = 0; o < L.outDim; o++) {
      let s = L.b[o];
      for (let i = 0; i < L.inDim; i++) s += L.W[o * L.inDim + i] * prev[i];
      if (L.residualFrom !== undefined) s += acts[L.residualFrom][o];
      z.push(s);
    }
    if (L.activation === "softmax") {
      const mx = Math.max(...z); const e = z.map((v) => Math.exp(v - mx)); const t = e.reduce((a, b) => a + b, 0);
      acts.push(e.map((v) => v / t));
    } else acts.push(z.map((v) => act[L.activation as keyof typeof act](v)));
  });
  return acts[acts.length - 1];
}

describe("canonical encoding", () => {
  it("sorts keys, normalises -0, rejects non-finite", () => {
    expect(canonical({ b: 1, a: [1, -0, 2.5], c: { z: true, y: null } })).toBe('{"a":[1,0,2.5],"b":1,"c":{"y":null,"z":true}}');
    expect(() => canonical({ x: NaN })).toThrow();
    expect(() => canonical([Infinity])).toThrow();
    expect(canonical(new Float64Array([0.1, 3]))).toBe("[0.1,3]");
  });
  it("hash is stable", () => {
    expect(hashCanonical({ a: 1 })).toBe(hashCanonical({ a: 1 }));
    expect(hashCanonical({ a: 1 })).not.toBe(hashCanonical({ a: 2 }));
  });
});

describe("prng", () => {
  it("is deterministic per label and differs across labels", () => {
    const a = createRng("x"), b = createRng("x"), c = createRng("y");
    const sa = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(sa);
    expect(Array.from({ length: 5 }, () => c.next())).not.toEqual(sa);
    sa.forEach((v) => { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); });
  });
  it("normal() has ~zero mean, ~unit variance", () => {
    const r = createRng("n"); let s = 0, s2 = 0; const n = 20000;
    for (let i = 0; i < n; i++) { const v = r.normal(); s += v; s2 += v * v; }
    expect(Math.abs(s / n)).toBeLessThan(0.03);
    expect(Math.abs(s2 / n - 1)).toBeLessThan(0.05);
  });
});

describe("generator", () => {
  it("same seed + config ⇒ identical model hash and parameters", () => {
    const a = generateModel(base), b = generateModel({ ...base });
    expect(a.artifactHash).toBe(b.artifactHash);
    expect(a.configHash).toBe(b.configHash);
    expect(Array.from(a.layers[0].W)).toEqual(Array.from(b.layers[0].W));
  });
  it("different seed ⇒ different parameters and hashes", () => {
    const a = generateModel(base), b = generateModel({ ...base, seed: "beta" });
    expect(a.artifactHash).not.toBe(b.artifactHash);
    expect(Array.from(a.layers[0].W)).not.toEqual(Array.from(b.layers[0].W));
  });
  it("random configs from different seeds differ in topology", () => {
    const shapes = new Set(["s1", "s2", "s3", "s4", "s5", "s6"].map((s) => {
      const c = randomConfig(s); return `${c.architecture}|${c.inputDim}|${c.hidden.join(",")}|${c.outputDim}`;
    }));
    expect(shapes.size).toBeGreaterThanOrEqual(5);
  });
  it("sparse masks respect density, keep every neuron connected, and are seed-reproducible", () => {
    const cfg: ModelConfig = { ...base, architecture: "sparse", density: 0.3, hidden: [16, 16] };
    const m = generateModel(cfg);
    const L = m.layers[1];
    const kept = Array.from(L.mask!).reduce((s, v) => s + v, 0) / L.mask!.length;
    expect(kept).toBeGreaterThan(0.18); expect(kept).toBeLessThan(0.45);
    for (let o = 0; o < L.outDim; o++) expect(L.mask!.slice(o * L.inDim, (o + 1) * L.inDim).some(Boolean)).toBe(true);
    L.W.forEach((w, k) => { if (!L.mask![k]) expect(w).toBe(0); });
    expect(generateModel(cfg).artifactHash).toBe(m.artifactHash);
    expect(parameterCount(m)).toBeLessThan(generateModel({ ...cfg, architecture: "feedforward", density: 1 }).layers.reduce((s, l) => s + l.W.length + l.outDim, 0));
  });
  it("residual adds identity skips only between equal-width layers", () => {
    const m = generateModel({ ...base, architecture: "residual", hidden: [6, 6, 6, 6, 6], activations: ["relu", "relu", "tanh", "relu", "tanh"] });
    expect(m.layers.map((l) => l.residualFrom)).toEqual([undefined, undefined, 1, undefined, 3, undefined]);
    expect(connectionCount(m)).toBe(3 * 6 + 6 * 6 * 4 + 6 * 2 + 12);
    expect(configIssues({ ...base, architecture: "residual", hidden: [4, 5, 4], activations: ["relu", "relu", "relu"] }).join()).toMatch(/equal hidden widths/);
  });
  it("enforces size limits", () => {
    expect(() => generateModel({ ...base, hidden: [64, 64, 64, 64, 64], activations: Array(5).fill("relu") })).toThrow(ValidationError);
    expect(() => generateModel({ ...base, hidden: [65], activations: ["relu"] })).toThrow(ValidationError);
    expect(() => generateModel({ ...base, density: 0.5 })).toThrow(/density/);
  });
});

describe("inference", () => {
  it("matVec matches hand computation", () => {
    expect(Array.from(matVec([1, 2, 3, 4, 5, 6], [1, 0, -1], [0.5, -0.5], 2, 3))).toEqual([-1.5, -2.5]);
    expect(() => matVec([1, 2], [1], null, 2, 2)).toThrow();
  });
  it("reproduces a hand-computed fixture exactly", () => {
    const m = generateModel({ ...base, inputDim: 2, outputDim: 1, hidden: [2], activations: ["relu"], outputActivation: "linear" });
    m.layers[0].W.set([1, -1, 0.5, 0.5]); m.layers[0].b.set([0, -0.25]);
    m.layers[1].W.set([2, -3]); m.layers[1].b.set([0.1]);
    const t = forward(m, [1, 2]);
    expect(Array.from(t.z[1])).toEqual([-1, 1.25]);
    expect(Array.from(t.a[1])).toEqual([0, 1.25]);
    expect(t.output[0]).toBeCloseTo(-3.65, 14);
  });
  it("activations and softmax match reference values", () => {
    expect(act.sigmoid(0)).toBe(0.5);
    expect(act.sigmoid(-800)).toBeGreaterThanOrEqual(0);
    expect(act.sigmoid(2)).toBeCloseTo(0.8807970779778823, 15);
    expect(act.tanh(0.5)).toBeCloseTo(0.46211715726000974, 15);
    expect(act.leaky_relu(-2)).toBe(-0.02);
    const s = Array.from(softmax([1, 2, 3]));
    [0.09003057317038046, 0.24472847105479764, 0.6652409557748219].forEach((v, i) => expect(s[i]).toBeCloseTo(v, 15));
    expect(Array.from(softmax([1000, 1000]))).toEqual([0.5, 0.5]);
  });
  it("matches the independent reference on every architecture and activation", () => {
    const r = createRng("ref");
    for (const arch of ["feedforward", "sparse", "residual"] as const) for (const a of ACTIVATIONS) {
      const hidden = arch === "residual" ? [5, 5, 5] : [6, 4];
      const m = generateModel({ ...base, seed: `${arch}-${a}`, architecture: arch, hidden, activations: hidden.map(() => a), density: arch === "sparse" ? 0.4 : 1 });
      const x = [r.next() * 2 - 1, r.next() * 2 - 1, r.next() * 2 - 1];
      const out = forward(m, x).output, ref = referenceForward(m, x);
      out.forEach((v, i) => expect(Math.abs(v - ref[i])).toBeLessThan(1e-12));
    }
  });
  it("rejects bad inputs", () => {
    const m = generateModel(base);
    expect(() => forward(m, [1, 2])).toThrow(/expects 3/);
    expect(() => forward(m, [1, NaN, 2])).toThrow(/finite/);
    expect(() => forward(m, [1, 2e7, 2])).toThrow(/exceeds/);
  });
  it("experiment result hash is reproducible and reproduce() matches", () => {
    const m = generateModel(base);
    const a = runExperiment(m, [0.1, 0.2, 0.3]), b = runExperiment(m, [0.1, 0.2, 0.3]);
    expect(a.resultHash).toBe(b.resultHash);
    expect(reproduce(m, a).match).toBe("exact");
    expect(compareOutputs([1, 2], [1, 2 + 1e-14]).match).toBe("within_tolerance");
    expect(compareOutputs([1, 2], [1, 2.1]).match).toBe("mismatch");
    expect(runExperiment(m, [0.1, 0.2, 0.31]).resultHash).not.toBe(a.resultHash);
  });
});

describe("serialization", () => {
  it("exports and imports with hash verification", () => {
    const m = generateModel({ ...base, architecture: "sparse", density: 0.5 });
    const json = JSON.parse(JSON.stringify(exportModel(m)));
    const back = importModel(json);
    expect(back.artifactHash).toBe(m.artifactHash);
    expect(forward(back, [1, 2, 3]).output).toEqual(forward(m, [1, 2, 3]).output);
    json.layers[0].W[0] += 1e-9;
    expect(() => importModel(json)).toThrow(/hash mismatch|masked/);
  });
  it("rejects malformed artifacts", () => {
    const j = JSON.parse(JSON.stringify(exportModel(generateModel(base))));
    expect(() => importModel({ ...j, schema: "evil" })).toThrow();
    expect(() => importModel({ ...j, layers: j.layers.slice(1) })).toThrow();
    const k = JSON.parse(JSON.stringify(j)); k.layers[0].W = ["1"]; expect(() => importModel(k)).toThrow();
  });
});

describe("backprop", () => {
  it("analytic gradients match central finite differences", () => {
    const cases: ModelConfig[] = [
      { ...base, hidden: [4, 3], activations: ["tanh", "sigmoid"] },
      { ...base, outputActivation: "linear", hidden: [4], activations: ["leaky_relu"] },
      { ...base, architecture: "sparse", density: 0.5, hidden: [5, 4], activations: ["tanh", "tanh"], outputActivation: "sigmoid" },
      { ...base, architecture: "residual", hidden: [4, 4, 4], activations: ["tanh", "sigmoid", "tanh"] },
    ];
    for (const cfg of cases) {
      const m = generateModel(cfg);
      const x = [0.3, -0.7, 0.5], y = [0, 1];
      const g = zeroGrads(m); backprop(m, x, y, g);
      const h = 1e-6;
      m.layers.forEach((L, li) => {
        for (const k of [0, 1, L.W.length - 1]) {
          if (L.mask && !L.mask[k]) { expect(g.gW[li][k]).toBe(0); continue; }
          const w = L.W[k];
          L.W[k] = w + h; const lp = backprop(m, x, y, null).loss;
          L.W[k] = w - h; const lm = backprop(m, x, y, null).loss;
          L.W[k] = w;
          expect(Math.abs((lp - lm) / (2 * h) - g.gW[li][k])).toBeLessThan(1e-6);
        }
        const bb = L.b[0];
        L.b[0] = bb + h; const lp = backprop(m, x, y, null).loss;
        L.b[0] = bb - h; const lm = backprop(m, x, y, null).loss;
        L.b[0] = bb;
        expect(Math.abs((lp - lm) / (2 * h) - g.gb[li][0])).toBeLessThan(1e-6);
      });
    }
  });
});

describe("training", () => {
  it("Adam learns XOR, changes weights and creates a new checkpoint", () => {
    const m = generateModel({ ...base, inputDim: 2, hidden: [8], activations: ["tanh"] });
    const d = makeDataset("xor", 200, "t");
    const tr = new Trainer(m, d, { optimizer: "adam", learningRate: 0.05, epochs: 120, batchSize: 16, valFraction: 0.25 });
    while (!tr.done) tr.step();
    const last = tr.history[tr.history.length - 1];
    expect(last.trainLoss).toBeLessThan(tr.baseline.trainLoss * 0.5);
    expect(last.valAcc!).toBeGreaterThan(0.9);
    const ck = tr.checkpoint();
    expect(ck.trained).toBe(true);
    expect(ck.version).toBe(2);
    expect(ck.parentArtifactHash).toBe(m.artifactHash);
    expect(ck.artifactHash).not.toBe(m.artifactHash);
    expect(m.trained).toBe(false); // original untouched
    expect(evaluate(ck, tr.split.val.X, tr.split.val.Y).acc).toBeCloseTo(last.valAcc!, 10);
  });
  it("SGD reduces loss on sine regression, deterministically", () => {
    const cfg: ModelConfig = { ...base, inputDim: 1, outputDim: 1, hidden: [10], activations: ["tanh"], outputActivation: "linear" };
    const run = () => {
      const tr = new Trainer(generateModel(cfg), makeDataset("sine", 160, "s"), { optimizer: "sgd", learningRate: 0.1, momentum: 0.9, epochs: 60, batchSize: 8, valFraction: 0.2 });
      while (!tr.done) tr.step();
      return tr;
    };
    const a = run(), b = run();
    expect(a.history.at(-1)!.valLoss).toBeLessThan(a.baseline.valLoss * 0.3);
    expect(a.checkpoint().artifactHash).toBe(b.checkpoint().artifactHash);
  });
  it("rejects mismatched datasets and unbounded jobs", () => {
    const m = generateModel(base);
    expect(() => new Trainer(m, makeDataset("xor"), { optimizer: "adam", learningRate: 0.01, epochs: 10, batchSize: 8, valFraction: 0.2 })).toThrow(/input/);
    const m2 = generateModel({ ...base, inputDim: 2 });
    expect(() => new Trainer(m2, makeDataset("xor"), { optimizer: "adam", learningRate: 0.01, epochs: 99999, batchSize: 8, valFraction: 0.2 })).toThrow(/epochs/);
  });
});
