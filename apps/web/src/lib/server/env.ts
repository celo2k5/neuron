import { z } from "zod";

const bool = z.preprocess((v) => (typeof v === "string" ? ["1", "true", "yes", "on"].includes(v.toLowerCase()) : v), z.boolean());
const pubkey = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "must be a base58 Solana address");
const int = (min: number, def: number, max = 1_000_000_000) => z.coerce.number().int().min(min).max(max).default(def);

const schema = z.object({
  // ---- bootstrap: environment only (never editable at runtime) ----
  DATABASE_URL: z.string().url(),
  ARTIFACT_DIR: z.string().default(".artifacts"),
  /** fs = files under ARTIFACT_DIR; db = bytes in Postgres (hosts without a persistent disk) */
  ARTIFACT_STORE: z.enum(["fs", "db"]).default("fs"),
  /** optional Postgres schema, to share one database with other apps without touching their tables */
  DB_SCHEMA: z.string().regex(/^[a-z_][a-z0-9_]*$/).optional(),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).default(24),
  /** optional 32-byte ed25519 seed (hex) for the registry signing key; otherwise one is generated and kept in the database */
  REGISTRY_SIGNING_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/).optional(),
  /** comma-separated wallets allowed into /admin */
  ADMIN_WALLETS: z.string().optional(),
  /** "no" hard-blocks mainnet even if /admin confirms it */
  ALLOW_MAINNET: z.enum(["yes", "no"]).optional(),

  // ---- runtime: editable from /admin, the env value is the default ----
  APP_DOMAIN: z.string().min(1).default("localhost:3000"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  SOLANA_CLUSTER: z.enum(["localnet", "devnet", "mainnet-beta"]).default("localnet"),
  /** server-side RPC (may carry a provider API key; never sent to browsers) */
  SOLANA_RPC: z.string().url().default("http://127.0.0.1:8899"),
  /** RPC that browsers and wallets use; defaults to the cluster's public endpoint */
  SOLANA_PUBLIC_RPC: z.string().url().optional(),
  SOLANA_FINALITY: z.enum(["confirmed", "finalized"]).default("finalized"),
  NEURON_MINT: pubkey.optional(),
  TREASURY_OWNER: pubkey.optional(),
  CREDIT_PRICE_BASE_UNITS: z.string().regex(/^\d+$/).default("1000000"),
  PAUSE_PAYMENTS: bool.default(false),
  FREE_EXPERIMENTS_PER_DAY: int(0, 25),
  FREE_TRAINING_PER_DAY: int(0, 3),
  FREE_TRAINING_MAX_EPOCHS: int(1, 300),
  REGISTRATION_CREDITS: int(0, 5),
  /** credits any signed-in wallet can claim once per UTC day */
  DAILY_CLAIM_CREDITS: int(0, 10),
  GOV_PROPOSAL_THRESHOLD: z.string().regex(/^\d+$/).default("100000000"),
  GOV_QUORUM: z.string().regex(/^\d+$/).default("1000000000"),
  GOV_QUORUM_VOTERS: int(1, 3),
  GOV_VOTING_PERIOD_SEC: int(60, 3 * 86400),
  GOV_EXECUTION_DELAY_SEC: int(0, 86400),
  SITE_BANNER: z.string().max(240).optional(),
  /** set by the go-live action in /admin after every launch check passes */
  MAINNET_CONFIRMED: bool.default(false),
  /** launch attestations the owner ticks in /admin (things software cannot check) */
  CHECK_AUDIT: bool.default(false),
  CHECK_MULTISIG: bool.default(false),
  CHECK_LEGAL: bool.default(false),
  CHECK_BACKUPS: bool.default(false),
  CHECK_MONITORING: bool.default(false),
  CHECK_DEVNET_REHEARSAL: bool.default(false),
});

export type Env = z.infer<typeof schema>;
export const ENV_SCHEMA = schema;

/** Runtime overrides from app_settings (see settings.ts); version bumps invalidate the parsed cache. */
const g = globalThis as unknown as { __neuronOverlay?: { values: Record<string, string>; version: number } };
export const overlay = () => (g.__neuronOverlay ??= { values: {}, version: 0 });

export function parseEnv(values: Record<string, string>) {
  const blank = (v?: string) => (v === "" ? undefined : v);
  const raw = Object.fromEntries(Object.entries({ ...process.env, ...values }).map(([k, v]) => [k, blank(v)]));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new Error("Invalid configuration: " + parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const e = parsed.data;
  if (e.SOLANA_CLUSTER === "mainnet-beta") {
    if (e.ALLOW_MAINNET === "no") throw new Error("mainnet-beta is blocked by ALLOW_MAINNET=no in the server environment");
    if (!e.MAINNET_CONFIRMED && e.ALLOW_MAINNET !== "yes") throw new Error("mainnet-beta needs the go-live confirmation in /admin");
  }
  return e;
}

let cached: { env: Env; version: number } | null = null;
export function env(): Env {
  const o = overlay();
  if (!cached || cached.version !== o.version) cached = { env: parseEnv(o.values), version: o.version };
  return cached.env;
}

const PUBLIC_RPC: Record<Env["SOLANA_CLUSTER"], string | null> = {
  localnet: null, devnet: "https://api.devnet.solana.com", "mainnet-beta": "https://api.mainnet-beta.solana.com",
};
export const publicRpc = (e: Env = env()) => e.SOLANA_PUBLIC_RPC ?? PUBLIC_RPC[e.SOLANA_CLUSTER] ?? e.SOLANA_RPC;
export const adminWallets = () => (process.env.ADMIN_WALLETS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/** What the UI needs to know about integrations — including what is NOT configured. Never includes secrets. */
export function publicConfig() {
  const e = env();
  const tokenEnabled = !!(e.NEURON_MINT && e.TREASURY_OWNER);
  return {
    /** everything core (registry, credits, governance) runs on the server; the token is an optional add-on */
    registry: "server" as const,
    cluster: e.SOLANA_CLUSTER,
    rpc: publicRpc(e),
    tokenEnabled,
    paymentsPaused: e.PAUSE_PAYMENTS,
    banner: e.SITE_BANNER ?? null,
    mint: e.NEURON_MINT ?? null,
    treasury: e.TREASURY_OWNER ?? null,
    creditPriceBaseUnits: e.CREDIT_PRICE_BASE_UNITS,
    freeExperimentsPerDay: e.FREE_EXPERIMENTS_PER_DAY,
    freeTrainingPerDay: e.FREE_TRAINING_PER_DAY,
    freeTrainingMaxEpochs: e.FREE_TRAINING_MAX_EPOCHS,
    registrationCredits: e.REGISTRATION_CREDITS,
    dailyClaimCredits: e.DAILY_CLAIM_CREDITS,
    blockers: [
      !!e.NEURON_MINT !== !!e.TREASURY_OWNER && "NEURON_MINT and TREASURY_OWNER must both be set to sell credits for $NEURON",
    ].filter(Boolean) as string[],
  };
}
