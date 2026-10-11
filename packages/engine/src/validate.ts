import { ACTIVATIONS, ARCHITECTURES, INITS, LIMITS, type Limits, type ModelConfig } from "./types";

export class ValidationError extends Error {
  constructor(public issues: string[]) {
    super(issues.join("; "));
    this.name = "ValidationError";
  }
}

export class NumericError extends Error {
  constructor(m: string) {
    super(m);
    this.name = "NumericError";
  }
}

const isInt = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);

export function configIssues(c: ModelConfig, limits: Limits = LIMITS): string[] {
  const e: string[] = [];
  if (typeof c !== "object" || c === null) return ["config must be an object"];
  if (typeof c.name !== "string" || c.name.length < 1 || c.name.length > 48) e.push("name must be 1–48 characters");
  if (typeof c.seed !== "string" || c.seed.length < 1 || c.seed.length > 64) e.push("seed must be 1–64 characters");
  if (!ARCHITECTURES.includes(c.architecture)) e.push(`architecture must be one of ${ARCHITECTURES.join(", ")}`);
  if (!isInt(c.inputDim) || c.inputDim < 1 || c.inputDim > limits.maxInputDim) e.push(`inputDim must be an integer 1–${limits.maxInputDim}`);
  if (!isInt(c.outputDim) || c.outputDim < 1 || c.outputDim > limits.maxWidth) e.push(`outputDim must be an integer 1–${limits.maxWidth}`);
  if (!Array.isArray(c.hidden) || c.hidden.length < 1 || c.hidden.length > limits.maxLayers - 1) {
    e.push(`hidden must list 1–${limits.maxLayers - 1} layer widths`);
  } else {
    c.hidden.forEach((w, i) => {
      if (!isInt(w) || w < 1 || w > limits.maxWidth) e.push(`hidden[${i}] must be an integer 1–${limits.maxWidth}`);
    });
  }
  if (!Array.isArray(c.activations) || c.activations.length !== (c.hidden?.length ?? -1)) {
    e.push("activations must have one entry per hidden layer");
  } else {
    c.activations.forEach((a, i) => { if (!ACTIVATIONS.includes(a)) e.push(`activations[${i}] is not supported`); });
  }
  if (!(ACTIVATIONS as readonly string[]).includes(c.outputActivation) && c.outputActivation !== "softmax") e.push("outputActivation is not supported");
  if (c.outputActivation === "softmax" && c.outputDim < 2) e.push("softmax output needs outputDim ≥ 2");
  if (typeof c.density !== "number" || !(c.density >= 0.05 && c.density <= 1)) e.push("density must be between 0.05 and 1");
  if (c.architecture !== "sparse" && c.density !== 1) e.push("density must be 1 for dense architectures");
  if (!INITS.includes(c.init)) e.push("init is not supported");
  if (c.architecture === "residual" && Array.isArray(c.hidden)) {
    if (c.hidden.length < 3) e.push("residual needs at least 3 hidden layers (skips join layer l-2 to l)");
    if (new Set(c.hidden).size !== 1) e.push("residual identity skips need equal hidden widths");
  }
  if (e.length === 0) {
    const dims = [c.inputDim, ...c.hidden, c.outputDim];
    const neurons = dims.reduce((s, d) => s + d, 0);
    let params = 0;
    for (let i = 1; i < dims.length; i++) params += dims[i - 1] * dims[i] + dims[i];
    if (neurons > limits.maxNeurons) e.push(`model has ${neurons} neurons, limit is ${limits.maxNeurons}`);
    if (params > limits.maxParams) e.push(`model has ${params} potential parameters, limit is ${limits.maxParams}`);
  }
  return e;
}

export function assertConfig(c: ModelConfig, limits: Limits = LIMITS) {
  const issues = configIssues(c, limits);
  if (issues.length) throw new ValidationError(issues);
}

export function assertVector(v: unknown, dim: number, label = "input", maxAbs = LIMITS.maxAbsInput): asserts v is number[] {
  if (!Array.isArray(v) && !ArrayBuffer.isView(v)) throw new ValidationError([`${label} must be an array of numbers`]);
  const arr = v as ArrayLike<number>;
  if (arr.length !== dim) throw new ValidationError([`${label} has ${arr.length} values, model expects ${dim}`]);
  for (let i = 0; i < arr.length; i++) {
    const x = arr[i];
    if (typeof x !== "number" || !Number.isFinite(x)) throw new ValidationError([`${label}[${i}] is not a finite number`]);
    if (Math.abs(x) > maxAbs) throw new ValidationError([`${label}[${i}] exceeds |x| ≤ ${maxAbs}`]);
  }
}
