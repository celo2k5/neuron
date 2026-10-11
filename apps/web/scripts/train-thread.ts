/** Isolated training thread: no DB, no network. Receives a validated artifact, returns metrics + checkpoints. */
import { parentPort, workerData } from "node:worker_threads";
import { exportModel, importModel, makeDataset, Trainer, type DatasetId, type ModelArtifact, type TrainOptions } from "@neuron/engine";

const { artifact, dataset, samples, options, checkpointEvery } = workerData as {
  artifact: ModelArtifact; dataset: DatasetId; samples: number; options: TrainOptions; checkpointEvery: number;
};
let stop = false;
parentPort!.on("message", (m) => { if (m === "stop") stop = true; });

const t0 = Date.now();
let peak = 0;
try {
  const model = importModel(artifact);
  const trainer = new Trainer(model, makeDataset(dataset, samples, "neuron"), options);
  parentPort!.postMessage({ type: "baseline", baseline: trainer.baseline });
  const tick = () => {
    const end = Date.now() + 40;
    while (!trainer.done && !stop && Date.now() < end) {
      const m = trainer.step();
      parentPort!.postMessage({ type: "epoch", m });
      peak = Math.max(peak, process.memoryUsage().heapUsed / 1048576);
      if (trainer.epoch % checkpointEvery === 0 || trainer.done) {
        parentPort!.postMessage({ type: "checkpoint", epoch: trainer.epoch, metrics: m, artifact: exportModel(trainer.checkpoint()) });
      }
    }
    if (trainer.done || stop) {
      const last = trainer.history[trainer.history.length - 1];
      if (stop && last && trainer.epoch % checkpointEvery !== 0) {
        parentPort!.postMessage({ type: "checkpoint", epoch: trainer.epoch, metrics: last, artifact: exportModel(trainer.checkpoint()) });
      }
      parentPort!.postMessage({ type: "done", epochs: trainer.epoch, stopped: stop, peakHeapMb: Math.round(peak), ms: Date.now() - t0 });
    } else setImmediate(tick); // yield so "stop" messages are received
  };
  tick();
} catch (e) {
  parentPort!.postMessage({ type: "error", message: e instanceof Error ? e.message : String(e) });
}
