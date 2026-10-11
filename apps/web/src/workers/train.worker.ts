/// <reference lib="webworker" />
/** In-browser training preview. Same engine as the server worker; results are NOT persisted. */
import { exportModel, importModel, makeDataset, Trainer, type DatasetId, type ModelArtifact, type TrainOptions } from "@neuron/engine";

let stop = false;
self.onmessage = (ev: MessageEvent) => {
  const m = ev.data as { type: "start"; artifact: ModelArtifact; dataset: DatasetId; samples: number; options: TrainOptions } | { type: "stop" };
  if (m.type === "stop") { stop = true; return; }
  stop = false;
  try {
    const trainer = new Trainer(importModel(m.artifact), makeDataset(m.dataset, m.samples, "neuron"), m.options);
    self.postMessage({ type: "baseline", baseline: trainer.baseline });
    let lastSnap = 0;
    const tick = () => {
      const end = performance.now() + 24;
      while (!trainer.done && !stop && performance.now() < end) {
        const e = trainer.step();
        self.postMessage({ type: "epoch", m: e });
      }
      if (performance.now() - lastSnap > 90 || trainer.done || stop) {
        lastSnap = performance.now();
        self.postMessage({ type: "weights", artifact: exportModel(trainer.checkpoint()) });
      }
      if (trainer.done || stop) self.postMessage({ type: "done", epochs: trainer.epoch, stopped: stop });
      else setTimeout(tick, 0);
    };
    tick();
  } catch (e) {
    self.postMessage({ type: "error", message: (e as Error).message });
  }
};
