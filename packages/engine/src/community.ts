import { hashCanonical } from "./canonical";
import { createRng } from "./prng";
import { artifactHashOf, generateModel } from "./model";
import type { Activation, Model, ModelConfig } from "./types";
import { ValidationError } from "./validate";

/**
 * The shared community network is a feed-forward model compiled from registered neurons.
 *
 *   input (4, protocol) → hidden layer 1 (registered) → hidden layer 2 (registered) → output (2, protocol)
 *
 * Graph rules (enforced here and server-side):
 *  - neurons may only join hidden layers 1 or 2; edges always point to the next layer (acyclic by construction)
 *  - each neuron's INCOMING weights are derived from that neuron's own seed, so owners control only their own parameters
 *  - output-layer weights are derived from the protocol seed
 *  - layer activation is a network policy (set by governance), not a per-neuron choice
 */
export interface CommunityPolicy {
  inputDim: number;
  outputDim: number;
  layerActivations: [Activation, Activation];
  maxPerLayer: number;
  weightScaleMax: number;
  protocolSeed: string;
}
export const DEFAULT_POLICY: CommunityPolicy = {
  inputDim: 4, outputDim: 2, layerActivations: ["tanh", "relu"], maxPerLayer: 48, weightScaleMax: 2, protocolSeed: "neuron-genesis",
};

export interface CommunityNeuron {
  id: string;
  owner: string;
  layer: 1 | 2;
  bias: number;
  seed: string;
  /** multiplier on derived incoming weights */
  scale: number;
  createdAt: string;
}

export function neuronIssues(n: Pick<CommunityNeuron, "layer" | "bias" | "seed" | "scale">, policy = DEFAULT_POLICY): string[] {
  const e: string[] = [];
  if (n.layer !== 1 && n.layer !== 2) e.push("layer must be 1 or 2");
  if (typeof n.bias !== "number" || !Number.isFinite(n.bias) || Math.abs(n.bias) > 2) e.push("bias must be a number in [−2, 2]");
  if (typeof n.seed !== "string" || n.seed.length < 1 || n.seed.length > 64) e.push("seed must be 1–64 characters");
  if (typeof n.scale !== "number" || !(n.scale > 0 && n.scale <= policy.weightScaleMax)) e.push(`scale must be in (0, ${policy.weightScaleMax}]`);
  return e;
}

/** Genesis neurons keep both hidden layers non-empty so the network is always executable. */
export function genesisNeurons(policy = DEFAULT_POLICY): CommunityNeuron[] {
  return [1, 1, 2, 2].map((layer, i) => ({
    id: `genesis-${i}`, owner: "protocol", layer: layer as 1 | 2, bias: 0, seed: `${policy.protocolSeed}/${i}`, scale: 1, createdAt: "1970-01-01T00:00:00.000Z",
  }));
}

export function compileCommunity(neurons: CommunityNeuron[], policy = DEFAULT_POLICY): { model: Model; order: CommunityNeuron[][]; snapshotHash: string } {
  for (const n of neurons) {
    const iss = neuronIssues(n, policy);
    if (iss.length) throw new ValidationError([`neuron ${n.id}: ${iss.join(", ")}`]);
  }
  const byId = [...neurons].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const l1 = byId.filter((n) => n.layer === 1), l2 = byId.filter((n) => n.layer === 2);
  if (!l1.length || !l2.length) throw new ValidationError(["each hidden layer needs at least one neuron"]);
  if (l1.length > policy.maxPerLayer || l2.length > policy.maxPerLayer) throw new ValidationError([`layer cap ${policy.maxPerLayer} exceeded`]);
  const config: ModelConfig = {
    name: "community", seed: policy.protocolSeed, architecture: "feedforward",
    inputDim: policy.inputDim, outputDim: policy.outputDim, hidden: [l1.length, l2.length],
    activations: [...policy.layerActivations], outputActivation: "softmax", density: 1, init: "xavier",
  };
  const model = generateModel(config);
  const srcIds = [Array.from({ length: policy.inputDim }, (_, i) => `in-${i}`), l1.map((n) => n.id), l2.map((n) => n.id)];
  const fill = (li: number, targets: { seed: string; scale: number; bias: number }[]) => {
    const L = model.layers[li];
    const std = Math.sqrt(2 / (L.inDim + L.outDim));
    targets.forEach((t, o) => {
      srcIds[li].forEach((sid, i) => { L.W[o * L.inDim + i] = createRng(`community|${t.seed}|${sid}`).normal() * std * t.scale; });
      L.b[o] = t.bias;
    });
  };
  fill(0, l1);
  fill(1, l2);
  fill(2, Array.from({ length: policy.outputDim }, (_, i) => ({ seed: `${policy.protocolSeed}/out-${i}`, scale: 1, bias: 0 })));
  model.artifactHash = artifactHashOf(model);
  const snapshotHash = hashCanonical({ policy, neurons: byId, artifactHash: model.artifactHash });
  return { model, order: [srcIds[0].map((id) => ({ id } as CommunityNeuron)), l1, l2], snapshotHash };
}
