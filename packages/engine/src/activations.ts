import type { Activation } from "./types";

export const act: Record<Activation, (z: number) => number> = {
  relu: (z) => (z > 0 ? z : 0),
  leaky_relu: (z) => (z > 0 ? z : 0.01 * z),
  sigmoid: (z) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z))),
  tanh: (z) => Math.tanh(z),
  linear: (z) => z,
};

/** derivative expressed with both pre-activation z and activation a */
export const dact: Record<Activation, (z: number, a: number) => number> = {
  relu: (z) => (z > 0 ? 1 : 0),
  leaky_relu: (z) => (z > 0 ? 1 : 0.01),
  sigmoid: (_z, a) => a * (1 - a),
  tanh: (_z, a) => 1 - a * a,
  linear: () => 1,
};

/** numerically stable softmax */
export function softmax(z: ArrayLike<number>, out = new Float64Array(z.length)): Float64Array {
  let m = -Infinity;
  for (let i = 0; i < z.length; i++) if (z[i] > m) m = z[i];
  let s = 0;
  for (let i = 0; i < z.length; i++) { out[i] = Math.exp(z[i] - m); s += out[i]; }
  for (let i = 0; i < z.length; i++) out[i] /= s;
  return out;
}
