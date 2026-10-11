import { randomConfig, type ModelConfig, type VisualForm } from "@neuron/engine";

/** The homepage hero specimen. Deterministic: same everywhere, same hash forever (for this engine version). */
export const HERO_CONFIG: ModelConfig = {
  name: "genesis-specimen", seed: "genesis-0001", architecture: "residual", inputDim: 6, outputDim: 4,
  hidden: [14, 14, 14, 14, 14], activations: ["tanh", "relu", "tanh", "leaky_relu", "tanh"], outputActivation: "softmax", density: 1, init: "xavier",
};

/** six seeded specimens, one per visual form, generated client-side from real configs */
export const SPECIMENS: { form: VisualForm; config: ModelConfig }[] = (["CONSTELLATION", "CORTEX", "CIRCUIT", "FRACTAL", "SYNAPSE", "MINIMAL"] as VisualForm[]).map((form, i) => ({
  form,
  config: randomConfig(`specimen-${String(i + 1).padStart(3, "0")}`, { name: `specimen-${String(i + 1).padStart(3, "0")}` }),
}));

/** seeded input vector in [-1, 1] — reproducible from (seed, dim) */
import { createRng } from "@neuron/engine";
export function seededInput(seed: string, dim: number): number[] {
  const r = createRng(`input|${seed}|${dim}`);
  return Array.from({ length: dim }, () => Math.round((r.next() * 2 - 1) * 1e6) / 1e6);
}
