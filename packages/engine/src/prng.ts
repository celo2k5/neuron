import { sha256Bytes } from "./canonical";

/**
 * Versioned PRNG: "neuron-prng/1" = sfc32 seeded from SHA-256(label).
 * Only integer ops and exact float division are used, so streams are
 * bit-identical on every conforming JS engine.
 */
export const PRNG_VERSION = "neuron-prng/1";

export interface Rng {
  /** uniform in [0, 1), 32-bit resolution, exact */
  next(): number;
  /** integer in [lo, hi] inclusive */
  int(lo: number, hi: number): number;
  /** approx N(0,1) via Irwin–Hall (sum of 12 uniforms − 6): uses only + and −, so exact */
  normal(): number;
  pick<T>(arr: readonly T[]): T;
  fork(label: string): Rng;
  readonly label: string;
}

export function createRng(label: string): Rng {
  const b = sha256Bytes(`${PRNG_VERSION}|${label}`);
  const u = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  let a = u(0), bb = u(4), c = u(8), d = u(12);
  const raw = () => {
    a >>>= 0; bb >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + bb) | 0;
    a = bb ^ (bb >>> 9);
    bb = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return t >>> 0;
  };
  for (let i = 0; i < 15; i++) raw();
  const rng: Rng = {
    label,
    next: () => raw() / 4294967296,
    int: (lo, hi) => lo + Math.floor((raw() / 4294967296) * (hi - lo + 1)),
    normal: () => {
      let s = 0;
      for (let i = 0; i < 12; i++) s += raw() / 4294967296;
      return s - 6;
    },
    pick: (arr) => arr[Math.floor((raw() / 4294967296) * arr.length)],
    fork: (l) => createRng(`${label}/${l}`),
  };
  return rng;
}
