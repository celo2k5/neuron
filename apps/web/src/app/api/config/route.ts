import { handler } from "@/lib/server/http";
import { publicConfig } from "@/lib/server/env";
import { ENGINE_VERSION, LIMITS, TRAIN_LIMITS, TOLERANCE } from "@neuron/engine";
export const dynamic = "force-dynamic";
export const GET = handler(async () => ({ ...publicConfig(), engine: ENGINE_VERSION, limits: LIMITS, trainLimits: TRAIN_LIMITS, tolerance: TOLERANCE }));
