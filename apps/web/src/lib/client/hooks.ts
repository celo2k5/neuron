"use client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { importModel, type Model, type ModelArtifact, type ModelConfig, type Presentation } from "@neuron/engine";
import { api } from "./api";

export interface ModelRow {
  id: string; owner_wallet: string | null; name: string; seed: string; architecture: string; config: ModelConfig; config_hash: string;
  presentation: Presentation; forked_from: string | null; neuron_count: number; edge_count: number; param_count: number; created_at: string;
  latest_version: number; latest_artifact_hash: string; trained: boolean; last_experiment_at: string | null; verified_count: number;
}
export interface VersionRow { id: string; version: number; artifact_hash: string; parent_artifact_hash: string | null; trained: boolean; metrics: Record<string, number> | null; training_job_id: string | null; created_at: string; engine: string }
export interface ExperimentRow {
  id: string; owner_wallet: string | null; model_id: string; version: number; artifact_hash: string; status: string; input_source: string; input: number[]; input_seed: string | null;
  output: number[] | null; activation_summary: { layer: number; min: number; max: number; mean: number; values?: number[] }[] | null; result_hash: string | null; metadata_hash: string | null;
  activations_hash: string | null; engine: string | null; elapsed_ms: number | null; error: string | null; job_id: string | null; reproduced_from: string | null;
  repro: { match: string; maxAbsDiff: number; maxRelDiff: number; sameHash: boolean; originalResultHash: string } | null; created_at: string; completed_at: string | null;
  commitment_status: string | null; commitment_signature: string | null;
}
export interface TrainingRow {
  id: string; model_id: string; dataset: string; options: { optimizer: string; learningRate: number; epochs: number; batchSize: number; valFraction: number; samples: number; momentum?: number };
  status: string; epoch: number; history: { epoch: number; trainLoss: number; valLoss: number; trainAcc?: number; valAcc?: number; ms: number }[];
  baseline: { trainLoss: number; valLoss: number; trainAcc: number; valAcc: number } | null; credits_reserved: number; error: string | null; resource: { peakHeapMb: number; ms: number } | null;
  created_at: string; updated_at: string; base_version: number; checkpoints: { id: string; epoch: number; metrics: Record<string, number>; artifact_hash: string; version: number; created_at: string }[];
}

export function useModelDetail(id: string | null) {
  return useQuery({
    queryKey: ["model", id], enabled: !!id,
    queryFn: () => api<{ model: ModelRow; versions: VersionRow[]; experiments: ExperimentRow[]; training: TrainingRow[] }>(`/api/models/${id}`),
  });
}

/** The exact persisted artifact, re-validated client-side (hashes recomputed) before it is drawn or run. */
export function useModelArtifact(id: string | null, version: number | null | undefined) {
  return useQuery({
    queryKey: ["artifact", id, version], enabled: !!id && !!version, staleTime: Infinity,
    // keep showing the previous version while the next one loads, so panels (and running jobs) don't unmount
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<Model> => importModel(await api<ModelArtifact>(`/api/models/${id}/versions/${version}`)),
  });
}

export function useExperiment(id: string | null) {
  return useQuery({
    queryKey: ["experiment", id], enabled: !!id,
    queryFn: () => api<{ experiment: ExperimentRow }>(`/api/experiments/${id}`).then((r) => r.experiment),
    refetchInterval: (q) => (q.state.data && ["queued", "running"].includes(q.state.data.status) ? 700 : false),
  });
}

export function useTraining(id: string | null) {
  return useQuery({
    queryKey: ["training", id], enabled: !!id,
    queryFn: () => api<{ training: TrainingRow }>(`/api/training/${id}`).then((r) => r.training),
    refetchInterval: (q) => (q.state.data && ["queued", "running"].includes(q.state.data.status) ? 1500 : false),
  });
}
