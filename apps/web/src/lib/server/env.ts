import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url(),
  ARTIFACT_DIR: z.string().default(".artifacts"),
  /** fs = files under ARTIFACT_DIR; db = bytes in Postgres (hosts without a persistent disk) */
  ARTIFACT_STORE: z.enum(["fs", "db"]).default("fs"),
  /** optional Postgres schema, to share one database with other apps without touching their tables */
  DB_SCHEMA: z.string().regex(/^[a-z_][a-z0-9_]*$/).optional(),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  APP_DOMAIN: z.string().default("localhost:3000"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  SOLANA_CLUSTER: z.enum(["localnet", "devnet", "mainnet-beta"]).default("localnet"),
  SOLANA_RPC: z.string().url().default("http://127.0.0.1:8899"),
  SOLANA_FINALITY: z.enum(["confirmed", "finalized"]).default("finalized"),
  REGISTRY_PROGRAM_ID: z.string().optional(),
  NEURON_MINT: z.string().optional(),
  TREASURY_OWNER: z.string().optional(),
  CREDIT_PRICE_BASE_UNITS: z.string().regex(/^\d+$/).default("1000000"),
  FREE_EXPERIMENTS_PER_DAY: z.coerce.number().int().min(0).default(25),
  FREE_TRAINING_PER_DAY: z.coerce.number().int().min(0).default(3),
  FREE_TRAINING_MAX_EPOCHS: z.coerce.number().int().min(1).default(300),
  REGISTRATION_CREDITS: z.coerce.number().int().min(0).default(5),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).default(24),
});

export type Env = z.infer<typeof schema>;
let cached: Env | null = null;
export function env(): Env {
  if (!cached) {
    const blank = (v?: string) => (v === "" ? undefined : v);
    const raw = Object.fromEntries(Object.entries(process.env).map(([k, v]) => [k, blank(v)]));
    const parsed = schema.safeParse(raw);
    if (!parsed.success) throw new Error("Invalid server environment: " + parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    if (parsed.data.SOLANA_CLUSTER === "mainnet-beta" && process.env.ALLOW_MAINNET !== "yes") {
      throw new Error("mainnet-beta configuration is preparatory only; set ALLOW_MAINNET=yes after an explicit go-live decision");
    }
    cached = parsed.data;
  }
  return cached;
}

/** What the UI needs to know about integrations — including what is NOT configured. */
export function publicConfig() {
  const e = env();
  return {
    cluster: e.SOLANA_CLUSTER,
    rpc: e.SOLANA_RPC,
    programId: e.REGISTRY_PROGRAM_ID ?? null,
    mint: e.NEURON_MINT ?? null,
    treasury: e.TREASURY_OWNER ?? null,
    creditPriceBaseUnits: e.CREDIT_PRICE_BASE_UNITS,
    freeExperimentsPerDay: e.FREE_EXPERIMENTS_PER_DAY,
    freeTrainingPerDay: e.FREE_TRAINING_PER_DAY,
    freeTrainingMaxEpochs: e.FREE_TRAINING_MAX_EPOCHS,
    registrationCredits: e.REGISTRATION_CREDITS,
    blockers: [
      !e.REGISTRY_PROGRAM_ID && "REGISTRY_PROGRAM_ID is not set — on-chain commitments are disabled",
      !e.NEURON_MINT && "NEURON_MINT is not set — token balances and credit purchases are disabled",
      !e.TREASURY_OWNER && "TREASURY_OWNER is not set — credit purchases are disabled",
    ].filter(Boolean) as string[],
  };
}
