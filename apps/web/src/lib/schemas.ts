import { z } from "zod";
import { ACTIVATIONS, ARCHITECTURES, INITS, VISUAL_FORMS, LIMITS, DATASETS, TRAIN_LIMITS } from "@neuron/engine";

const act = z.enum(ACTIVATIONS as unknown as [string, ...string[]]);

export const ModelConfigSchema = z.object({
  name: z.string().trim().min(1).max(48),
  seed: z.string().min(1).max(64),
  architecture: z.enum(ARCHITECTURES as unknown as [string, ...string[]]),
  inputDim: z.number().int().min(1).max(LIMITS.maxInputDim),
  outputDim: z.number().int().min(1).max(LIMITS.maxWidth),
  hidden: z.array(z.number().int().min(1).max(LIMITS.maxWidth)).min(1).max(LIMITS.maxLayers - 1),
  activations: z.array(act).min(1).max(LIMITS.maxLayers - 1),
  outputActivation: z.union([act, z.literal("softmax")]),
  density: z.number().min(0.05).max(1),
  init: z.enum(INITS as unknown as [string, ...string[]]),
}).strict();

export const PresentationSchema = z.object({
  form: z.enum(VISUAL_FORMS as unknown as [string, ...string[]]),
  palette: z.enum(["seed", "theme"]),
}).strict();

export const CreateModelSchema = z.object({ config: ModelConfigSchema, presentation: PresentationSchema.optional(), forkedFrom: z.string().max(40).optional() }).strict();

const vec = z.array(z.number().finite().gte(-LIMITS.maxAbsInput).lte(LIMITS.maxAbsInput)).min(1).max(LIMITS.maxInputDim);
export const CreateExperimentSchema = z.object({
  modelId: z.string().max(40),
  version: z.number().int().min(1).optional(),
  input: vec,
  inputSource: z.enum(["manual", "seeded", "dataset"]),
  inputSeed: z.string().max(64).optional(),
}).strict();

export const TrainingSchema = z.object({
  modelId: z.string().max(40),
  version: z.number().int().min(1).optional(),
  dataset: z.enum(DATASETS.map((d) => d.id) as [string, ...string[]]),
  samples: z.number().int().min(16).max(TRAIN_LIMITS.maxDataset).default(240),
  optimizer: z.enum(["sgd", "adam"]),
  learningRate: z.number().min(TRAIN_LIMITS.minLr).max(TRAIN_LIMITS.maxLr),
  epochs: z.number().int().min(1).max(TRAIN_LIMITS.maxEpochs),
  batchSize: z.number().int().min(1).max(TRAIN_LIMITS.maxBatch),
  valFraction: z.number().min(0.05).max(0.5),
  momentum: z.number().min(0).max(0.99).optional(),
}).strict();

export const NeuronSchema = z.object({
  layer: z.union([z.literal(1), z.literal(2)]),
  bias: z.number().finite().min(-2).max(2),
  seed: z.string().min(1).max(64),
  scale: z.number().gt(0).max(2),
}).strict();

export const SignedActionSchema = z.object({ message: z.string().max(2000), signature: z.string().max(120) });
