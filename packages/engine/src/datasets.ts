import { hashCanonical } from "./canonical";
import { createRng } from "./prng";

export type DatasetId = "xor" | "circles" | "spiral" | "moons" | "sine";
export interface Dataset {
  id: DatasetId;
  title: string;
  task: "classification" | "regression";
  inputDim: number;
  outputDim: number;
  X: number[][];
  Y: number[][];
  hash: string;
}

export const DATASETS: { id: DatasetId; title: string; task: Dataset["task"]; inputDim: number; outputDim: number; note: string }[] = [
  { id: "xor", title: "XOR quadrants", task: "classification", inputDim: 2, outputDim: 2, note: "Not linearly separable; needs a hidden layer." },
  { id: "circles", title: "Concentric circles", task: "classification", inputDim: 2, outputDim: 2, note: "Inner disc vs outer ring." },
  { id: "spiral", title: "Two spirals", task: "classification", inputDim: 2, outputDim: 2, note: "Hard for small nets; interleaved arms." },
  { id: "moons", title: "Two moons", task: "classification", inputDim: 2, outputDim: 2, note: "Curved overlapping half-circles." },
  { id: "sine", title: "Sine regression", task: "regression", inputDim: 1, outputDim: 1, note: "Fit y = sin(πx) on x ∈ [−1, 1]." },
];

export const MAX_DATASET = 1000;

export function makeDataset(id: DatasetId, n = 240, seed = "dataset", noise = 0.05): Dataset {
  const meta = DATASETS.find((d) => d.id === id);
  if (!meta) throw new Error(`unknown dataset ${id}`);
  n = Math.max(8, Math.min(MAX_DATASET, Math.floor(n)));
  const r = createRng(`dataset|${id}|${n}|${seed}|${noise}`);
  const X: number[][] = [], Y: number[][] = [];
  const oh = (c: number) => (c === 0 ? [1, 0] : [0, 1]);
  const jitter = () => r.normal() * noise;
  for (let k = 0; k < n; k++) {
    const c = k % 2;
    switch (id) {
      case "xor": {
        let x = r.next() * 2 - 1, y = r.next() * 2 - 1;
        // pull points away from the axes for a clean margin
        x += Math.sign(x) * 0.1; y += Math.sign(y) * 0.1;
        X.push([x + jitter(), y + jitter()]); Y.push(oh(x * y > 0 ? 0 : 1)); break;
      }
      case "circles": {
        const t = r.next() * Math.PI * 2;
        const rad = c === 0 ? r.next() * 0.45 : 0.7 + r.next() * 0.3;
        X.push([rad * Math.cos(t) + jitter(), rad * Math.sin(t) + jitter()]); Y.push(oh(c)); break;
      }
      case "spiral": {
        const t = (r.next() * 0.9 + 0.1);
        const ang = t * 3 * Math.PI + c * Math.PI;
        X.push([t * Math.cos(ang) + jitter(), t * Math.sin(ang) + jitter()]); Y.push(oh(c)); break;
      }
      case "moons": {
        const t = r.next() * Math.PI;
        const p = c === 0 ? [Math.cos(t), Math.sin(t)] : [1 - Math.cos(t), 0.5 - Math.sin(t)];
        X.push([(p[0] - 0.5) * 0.9 + jitter(), (p[1] - 0.25) * 0.9 + jitter()]); Y.push(oh(c)); break;
      }
      case "sine": {
        const x = r.next() * 2 - 1;
        X.push([x]); Y.push([Math.sin(Math.PI * x) + jitter()]); break;
      }
    }
  }
  return { id, title: meta.title, task: meta.task, inputDim: meta.inputDim, outputDim: meta.outputDim, X, Y, hash: hashCanonical({ X, Y }) };
}

/** deterministic shuffle + split */
export function splitDataset(d: Dataset, valFraction = 0.25, seed = "split") {
  const idx = d.X.map((_, i) => i);
  const r = createRng(`split|${d.hash}|${seed}`);
  for (let i = idx.length - 1; i > 0; i--) { const j = r.int(0, i); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  const nVal = Math.max(1, Math.round(idx.length * Math.min(0.5, Math.max(0.05, valFraction))));
  const take = (ids: number[]) => ({ X: ids.map((i) => d.X[i]), Y: ids.map((i) => d.Y[i]) });
  return { train: take(idx.slice(nVal)), val: take(idx.slice(0, nVal)) };
}
