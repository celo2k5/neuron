export const ENGINE_VERSION = "neuron-engine/1.0.0";
export const MODEL_SCHEMA = "neuron.model/1";

export type Activation = "relu" | "sigmoid" | "tanh" | "leaky_relu" | "linear";
export type OutputActivation = Activation | "softmax";
export type Architecture = "feedforward" | "sparse" | "residual";
export type WeightInit = "xavier" | "he" | "uniform" | "normal";
export type VisualForm = "CONSTELLATION" | "CORTEX" | "CIRCUIT" | "FRACTAL" | "SYNAPSE" | "MINIMAL";

export const ACTIVATIONS: readonly Activation[] = ["relu", "sigmoid", "tanh", "leaky_relu", "linear"];
export const ARCHITECTURES: readonly Architecture[] = ["feedforward", "sparse", "residual"];
export const INITS: readonly WeightInit[] = ["xavier", "he", "uniform", "normal"];
export const VISUAL_FORMS: readonly VisualForm[] = ["CONSTELLATION", "CORTEX", "CIRCUIT", "FRACTAL", "SYNAPSE", "MINIMAL"];

/** Computational configuration. Everything here feeds the config hash. Presentation lives elsewhere. */
export interface ModelConfig {
  name: string;
  seed: string;
  architecture: Architecture;
  inputDim: number;
  outputDim: number;
  hidden: number[];
  /** one per hidden layer */
  activations: Activation[];
  outputActivation: OutputActivation;
  /** fraction of possible connections kept (sparse only; 1 for dense) */
  density: number;
  init: WeightInit;
}

export interface Presentation {
  form: VisualForm;
  palette: "seed" | "theme";
}

/** One parameterised layer: dense matrix W (out × in, row-major), bias, optional sparsity mask. */
export interface Layer {
  inDim: number;
  outDim: number;
  activation: OutputActivation;
  W: Float64Array;
  b: Float64Array;
  /** 1 = connection exists. Absent ⇒ dense. Masked weights are always exactly 0. */
  mask?: Uint8Array;
  /** index (into activations list, 0 = input) whose activation is added identity-wise before this layer's activation */
  residualFrom?: number;
}

export interface Model {
  schema: typeof MODEL_SCHEMA;
  engine: string;
  config: ModelConfig;
  layers: Layer[];
  configHash: string;
  artifactHash: string;
  /** model id derived from configHash; stable across training (version changes instead) */
  id: string;
  version: number;
  trained: boolean;
  parentArtifactHash?: string;
}

export interface Limits {
  maxLayers: number;
  maxWidth: number;
  maxNeurons: number;
  maxParams: number;
  maxInputDim: number;
  maxAbsInput: number;
  maxAbsActivation: number;
}

export const LIMITS: Limits = {
  maxLayers: 8,
  maxWidth: 64,
  maxNeurons: 320,
  maxParams: 12000,
  maxInputDim: 64,
  maxAbsInput: 1e6,
  maxAbsActivation: 1e12,
};

/** Relative/absolute tolerance used for reproducibility checks across JS engines/hardware. */
export const TOLERANCE = { rel: 1e-9, abs: 1e-12 };
