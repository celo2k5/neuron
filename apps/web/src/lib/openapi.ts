import { zodToJsonSchema } from "zod-to-json-schema";
import { z } from "zod";
import { CreateExperimentSchema, CreateModelSchema, ModelConfigSchema, NeuronSchema, PresentationSchema, SignedActionSchema, TrainingSchema } from "./schemas";

/** OpenAPI 3.1 document generated from the same Zod schemas the handlers validate with. */
const js = (s: z.ZodTypeAny) => zodToJsonSchema(s, { target: "openApi3", $refStrategy: "none" });
const Error = { type: "object", properties: { error: { type: "object", properties: { code: { type: "string" }, message: { type: "string" }, details: {}, requestId: { type: "string" } }, required: ["code", "message", "requestId"] } } };
const op = (summary: string, opts: { body?: z.ZodTypeAny; auth?: boolean; query?: string[] } = {}) => ({
  summary,
  ...(opts.auth ? { security: [{ session: [] }] } : {}),
  ...(opts.query ? { parameters: opts.query.map((n) => ({ name: n, in: "query", required: false, schema: { type: "string" } })) } : {}),
  ...(opts.body ? { requestBody: { required: true, content: { "application/json": { schema: js(opts.body) } } } } : {}),
  responses: { 200: { description: "OK" }, default: { description: "Error envelope", content: { "application/json": { schema: Error } } } },
});

export function openapi() {
  return {
    openapi: "3.1.0",
    info: { title: "NEURON API", version: "1.0.0", description: "All errors use { error: { code, message, details, requestId } }. List endpoints use opaque cursors." },
    components: { securitySchemes: { session: { type: "apiKey", in: "cookie", name: "neuron_session" } }, schemas: { ModelConfig: js(ModelConfigSchema), Presentation: js(PresentationSchema) } },
    paths: {
      "/api/health": { get: op("Liveness") },
      "/api/ready": { get: op("Readiness: database + RPC") },
      "/api/config": { get: op("Public configuration, limits and integration blockers") },
      "/api/metrics": { get: op("Operational metrics and alerts") },
      "/api/auth/challenge": { post: op("Issue a single-use, domain-bound challenge (sign-in or action-bound)", { body: z.object({ intent: z.enum(["sign-in", "register-neuron", "update-neuron", "vote"]), wallet: z.string() }).passthrough() }) },
      "/api/auth/session": { get: op("Current session"), post: op("Create a session from a signed challenge", { body: SignedActionSchema }), delete: op("Revoke this session", { auth: true }) },
      "/api/models": { get: op("List public models", { query: ["q", "architecture", "owner", "trained", "sort", "limit", "cursor"] }), post: op("Generate and persist a model", { body: CreateModelSchema }) },
      "/api/models/{id}": { get: op("Model detail, versions, experiments, training"), patch: op("Save preferred presentation (owner)", { auth: true, body: PresentationSchema }) },
      "/api/models/{id}/versions/{version}": { get: op("Immutable declarative model artifact") },
      "/api/models/{id}/fork": { post: op("Fork configuration", { auth: true, body: ModelConfigSchema.partial() }) },
      "/api/models/import": { post: op("Import a reproducible (untrained) artifact", { auth: true }) },
      "/api/experiments": { get: op("List experiments", { query: ["modelId", "owner", "status", "limit", "before"] }), post: op("Queue an experiment", { body: CreateExperimentSchema }) },
      "/api/experiments/{id}": { get: op("Experiment status and result") },
      "/api/experiments/{id}/reproduce": { post: op("Re-run the pinned version on the same input") },
      "/api/training": { get: op("List training jobs"), post: op("Start a training job", { auth: true, body: TrainingSchema }) },
      "/api/training/{id}": { get: op("Training status, metrics, checkpoints") },
      "/api/training/{id}/{action}": { post: op("pause | cancel | resume", { auth: true }) },
      "/api/community": { get: op("Community network state (optionally ?version=)", { query: ["version"] }) },
      "/api/community/neurons": { post: op("Register a neuron", { auth: true, body: z.object({ neuron: NeuronSchema, signed: SignedActionSchema }) }) },
      "/api/community/neurons/{id}": { patch: op("Update your neuron", { auth: true, body: z.object({ neuron: NeuronSchema, signed: SignedActionSchema }) }), delete: op("Retire your neuron", { auth: true }) },
      "/api/token": { get: op("Mint info and a wallet's balance", { query: ["wallet"] }) },
      "/api/credits": { get: op("Credit balance and ledger", { auth: true }) },
      "/api/payments": { get: op("Your payment intents", { auth: true }), post: op("Create a payment intent", { auth: true, body: z.object({ credits: z.number().int() }) }) },
      "/api/payments/{id}": { get: op("Intent status", { auth: true }), post: op("Submit the transaction signature", { auth: true, body: z.object({ signature: z.string() }) }) },
      "/api/commitments/{experimentId}": { get: op("Verify against chain (public)"), post: op("Prepare unsigned commit tx", { auth: true }), put: op("Submit commit signature", { auth: true, body: z.object({ signature: z.string() }) }) },
      "/api/ledger": { get: op("Commitments, payments, network versions") },
      "/api/governance": { get: op("Rules and proposals"), post: op("Create a proposal", { auth: true }) },
      "/api/governance/{id}/vote": { post: op("Signed vote", { auth: true }) },
      "/api/events": { get: op("Server-sent events; resume with Last-Event-ID") },
      "/api/activity": { get: op("Recent activity events", { query: ["after", "topic", "limit"] }) },
    },
  };
}
