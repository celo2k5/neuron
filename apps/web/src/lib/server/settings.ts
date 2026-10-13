import { PublicKey } from "@solana/web3.js";
import { pool, q, tx, emit } from "./db";
import { ensureSettings, loadSettings } from "./settings-sync";
import { env, parseEnv, type Env } from "./env";
import { connection } from "./chain";
import { verifyChain, signingKey } from "./commitments";
import { bad, forbidden, unauthorized } from "./http";
import { log } from "./log";
import type { Session } from "./auth";

/**
 * Runtime settings edited at /admin. A row in app_settings overrides the environment variable of the
 * same name for every process. Writes are validated against the full config schema before they land,
 * NOTIFY tells other processes immediately, and an activity event tells every open browser.
 */
type Kind = "text" | "url" | "secret-url" | "pubkey" | "int" | "bigint" | "bool" | "select" | "check";
export interface SettingDef { key: keyof Env & string; group: string; label: string; help: string; kind: Kind; options?: string[]; unit?: string; required?: boolean; placeholder?: string }

export const DEFS: SettingDef[] = [
  // network
  { key: "SOLANA_CLUSTER", group: "Network", label: "Cluster", kind: "select", options: ["localnet", "devnet"], help: "Mainnet is switched on with the go-live action below, after every check passes. Changing the cluster signs everyone out (sessions are bound to a cluster)." },
  { key: "SOLANA_RPC", group: "Network", label: "Server RPC URL", kind: "secret-url", required: true, placeholder: "https://mainnet.helius-rpc.com/?api-key=…", help: "Used by the server to read the mint, balances and payments. A paid provider (Helius, Triton, QuickNode) for mainnet. Kept server-side; browsers never see it." },
  { key: "SOLANA_PUBLIC_RPC", group: "Network", label: "Public RPC URL", kind: "url", placeholder: "https://api.mainnet-beta.solana.com", help: "What browsers and wallets connect to. Leave empty for the cluster's public endpoint. Use a separate, domain-restricted key if you need one." },
  { key: "SOLANA_FINALITY", group: "Network", label: "Payment finality", kind: "select", options: ["confirmed", "finalized"], help: "Credits are issued only once a payment reaches this commitment. Use finalized on mainnet." },
  // token
  { key: "NEURON_MINT", group: "Token", label: "$NEURON mint address", kind: "pubkey", required: true, placeholder: "the real, existing mint", help: "The mint must already exist on the selected cluster. It is read from the chain; it is never created or replaced by the app." },
  { key: "TREASURY_OWNER", group: "Token", label: "Treasury owner", kind: "pubkey", required: true, placeholder: "multisig vault address", help: "Credit payments go to this owner's $NEURON token account. Use a multisig (for example a Squads vault) on mainnet." },
  { key: "CREDIT_PRICE_BASE_UNITS", group: "Token", label: "Price of 1 credit", kind: "bigint", unit: "base units", help: "In the mint's smallest unit. With 6 decimals, 1000000 = 1 $NEURON." },
  { key: "PAUSE_PAYMENTS", group: "Token", label: "Pause credit purchases", kind: "bool", help: "Kill switch. New payment intents are refused immediately; payments already sent still reconcile." },
  // credits
  { key: "DAILY_CLAIM_CREDITS", group: "Credits & limits", label: "Free daily credits", kind: "int", unit: "credits", help: "Every signed-in wallet can claim this many once per UTC day. 0 turns claims off." },
  { key: "FREE_EXPERIMENTS_PER_DAY", group: "Credits & limits", label: "Free saved experiments", kind: "int", unit: "per wallet per day", help: "Beyond this, each saved experiment costs 1 credit." },
  { key: "FREE_TRAINING_PER_DAY", group: "Credits & limits", label: "Free training jobs", kind: "int", unit: "per wallet per day", help: "Server training jobs without a credit charge." },
  { key: "FREE_TRAINING_MAX_EPOCHS", group: "Credits & limits", label: "Free training epoch cap", kind: "int", unit: "epochs", help: "Free jobs above this length are charged." },
  { key: "REGISTRATION_CREDITS", group: "Credits & limits", label: "Neuron registration cost", kind: "int", unit: "credits", help: "Charged when a wallet registers a neuron in the community network." },
  // governance
  { key: "GOV_QUORUM_VOTERS", group: "Governance", label: "Quorum (wallet voting)", kind: "int", unit: "wallets", help: "Used while no mint is configured: one wallet, one vote." },
  { key: "GOV_PROPOSAL_THRESHOLD", group: "Governance", label: "Proposal threshold (token voting)", kind: "bigint", unit: "base units", help: "Used once a mint is configured: balance needed to propose." },
  { key: "GOV_QUORUM", group: "Governance", label: "Quorum (token voting)", kind: "bigint", unit: "base units", help: "Total voting weight needed for a result to count." },
  { key: "GOV_VOTING_PERIOD_SEC", group: "Governance", label: "Voting period", kind: "int", unit: "seconds", help: "Applies to new proposals." },
  { key: "GOV_EXECUTION_DELAY_SEC", group: "Governance", label: "Execution delay", kind: "int", unit: "seconds", help: "Wait between a policy proposal passing and taking effect." },
  // site
  { key: "APP_DOMAIN", group: "Site", label: "Domain", kind: "text", placeholder: "neuronai.online", help: "Bound into every sign-in message. Must match the domain people visit, or sign-in fails." },
  { key: "APP_URL", group: "Site", label: "Public URL", kind: "url", placeholder: "https://neuronai.online", help: "Bound into sign-in messages and link previews." },
  { key: "SITE_BANNER", group: "Site", label: "Site-wide banner", kind: "text", placeholder: "Scheduled maintenance at 21:00 UTC", help: "Shown at the top of every page for every visitor, instantly. Empty hides it." },
  // attestations
  { key: "CHECK_DEVNET_REHEARSAL", group: "Launch attestations", label: "Full devnet rehearsal passed", kind: "check", help: "Sign-in, buying credits, an experiment and the registry, end to end with a real wallet on devnet." },
  { key: "CHECK_AUDIT", group: "Launch attestations", label: "Payment code reviewed by a third party", kind: "check", help: "apps/web/src/lib/server/payments.ts and packages/solana/src/payments.ts." },
  { key: "CHECK_MULTISIG", group: "Launch attestations", label: "Treasury is a multisig", kind: "check", help: "No single key can move received funds." },
  { key: "CHECK_LEGAL", group: "Launch attestations", label: "Legal review of the token and credits", kind: "check", help: "How the token and credits are sold and described." },
  { key: "CHECK_BACKUPS", group: "Launch attestations", label: "Database backups run and a restore was tested", kind: "check", help: "Including registry_entries and registry_keys." },
  { key: "CHECK_MONITORING", group: "Launch attestations", label: "Monitoring and alerts on /api/metrics", kind: "check", help: "Someone is paged when an alert fires." },
];
const BY_KEY = new Map(DEFS.map((d) => [d.key, d]));
const RUNTIME_ONLY = new Set(["MAINNET_CONFIRMED"]); // written by actions, not the form

// ---------- admin ----------
export function isAdmin(wallet: string | undefined | null) {
  const list = (process.env.ADMIN_WALLETS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return !!wallet && list.includes(wallet);
}
export function requireAdmin(s: Session | null) {
  if (!s) throw unauthorized("Sign in with an admin wallet.");
  if (!isAdmin(s.wallet)) throw forbidden((process.env.ADMIN_WALLETS ?? "").trim() ? "This wallet is not an admin." : "No admin wallets are configured. Set ADMIN_WALLETS in the server environment.");
  return s;
}

const mask = (d: SettingDef, v: string | undefined) => {
  if (!v || d.kind !== "secret-url") return v ?? "";
  try { const u = new URL(v); return `${u.protocol}//${u.host}${u.pathname !== "/" ? u.pathname : ""}${u.search ? "?…" : ""}`; } catch { return "•••"; }
};

export async function adminState() {
  await ensureSettings();
  const e = env();
  const rows = await q<{ key: string; updated_by: string | null; updated_at: string }>("select key, updated_by, updated_at from app_settings");
  const meta = new Map(rows.map((r) => [r.key, r]));
  const audit = await q("select id::text, key, old_value, new_value, wallet, created_at from app_settings_audit order by id desc limit 40");
  return {
    settings: DEFS.map((d) => {
      const v = e[d.key as keyof Env];
      const str = v === undefined || v === null ? "" : String(v);
      return { ...d, value: mask(d, str), secretSet: d.kind === "secret-url" ? !!str : undefined, source: meta.has(d.key) ? "admin" : process.env[d.key] ? "env" : "default",
        updatedBy: meta.get(d.key)?.updated_by ?? null, updatedAt: meta.get(d.key)?.updated_at ?? null };
    }),
    audit: audit.map((a) => { const d = BY_KEY.get(String(a.key) as never); return d?.kind === "secret-url" ? { ...a, old_value: a.old_value ? "•••" : null, new_value: a.new_value ? "•••" : null } : a; }),
    cluster: e.SOLANA_CLUSTER, mainnetConfirmed: e.MAINNET_CONFIRMED,
    bootstrap: { registryKeyFromEnv: !!e.REGISTRY_SIGNING_KEY, artifactStore: e.ARTIFACT_STORE, allowMainnet: e.ALLOW_MAINNET ?? null },
  };
}

async function write(s: Session, changes: Record<string, string | null>) {
  await tx(async (db) => {
    const cur = Object.fromEntries((await q<{ key: string; value: string }>("select key, value from app_settings", [], db)).map((r) => [r.key, r.value]));
    const next = { ...cur };
    for (const [k, v] of Object.entries(changes)) { if (v === null) delete next[k]; else next[k] = v; }
    try { parseEnv(next); } catch (e) { throw bad((e as Error).message.replace(/^Invalid configuration: /, "")); }
    for (const [k, v] of Object.entries(changes)) {
      if ((cur[k] ?? null) === v) continue;
      if (v === null) await db.query("delete from app_settings where key = $1", [k]);
      else await db.query(`insert into app_settings (key, value, updated_by, updated_at) values ($1,$2,$3,now())
                           on conflict (key) do update set value = $2, updated_by = $3, updated_at = now()`, [k, v, s.wallet]);
      await db.query("insert into app_settings_audit (key, old_value, new_value, wallet) values ($1,$2,$3,$4)", [k, cur[k] ?? null, v, s.wallet]);
    }
    await db.query("select pg_notify('neuron_settings', '1')");
    await emit(db, "config.updated", Object.keys(changes).join(","), { keys: Object.keys(changes) }, s.userId);
  });
  await loadSettings();
}

/** One field from the form. Empty string means "back to the environment default". */
export async function updateSetting(s: Session, key: string, raw: string) {
  const d = BY_KEY.get(key as never);
  if (!d || RUNTIME_ONLY.has(key)) throw bad(`${key} is not editable here.`);
  const v = raw.trim();
  if (d.kind === "select" && v && !d.options!.includes(v)) throw bad(`${d.label}: choose ${d.options!.join(" or ")}. Mainnet uses the go-live action.`);
  if (d.kind === "pubkey" && v) { try { new PublicKey(v); } catch { throw bad(`${d.label}: not a valid Solana address.`); } }
  if ((d.kind === "bool" || d.kind === "check") && v && !["true", "false"].includes(v)) throw bad(`${d.label}: true or false.`);
  if (key === "SOLANA_CLUSTER" && env().SOLANA_CLUSTER === "mainnet-beta") throw bad("Leave mainnet with the 'Return to devnet' action.");
  await write(s, { [key]: v === "" ? null : v });
  return adminState();
}

// ---------- launch readiness ----------
const GENESIS: Record<string, string> = {
  "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d": "mainnet-beta", EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG: "devnet", "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY": "testnet",
};
type Check = { id: string; label: string; ok: boolean | null; detail: string; required: boolean };

/** Everything that must be true before mainnet, checked live against the chain where software can check it. */
export async function readiness(target: "mainnet-beta" | "current" = "mainnet-beta") {
  await ensureSettings();
  const e = env();
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);
  // RPC: reachable and actually pointed at mainnet
  let rpcCluster: string | null = null;
  try {
    const t0 = Date.now();
    const gh = await Promise.race([connection().getGenesisHash(), new Promise<never>((_, r) => setTimeout(() => r(new Error("timed out after 6 s")), 6000))]);
    rpcCluster = GENESIS[gh] ?? "unknown";
    add({ id: "rpc", label: "Server RPC reachable", ok: true, detail: `${rpcCluster} · ${Date.now() - t0} ms`, required: true });
  } catch (err) { add({ id: "rpc", label: "Server RPC reachable", ok: false, detail: (err as Error).message.slice(0, 140), required: true }); }
  const wantCluster = target === "current" ? e.SOLANA_CLUSTER : target;
  add({ id: "rpc-cluster", label: `Server RPC is on ${wantCluster}`, ok: rpcCluster ? rpcCluster === wantCluster || (wantCluster === "localnet" && rpcCluster === "unknown") : null,
    detail: rpcCluster ? `genesis says ${rpcCluster}` : "RPC not reachable", required: true });
  if (target === "mainnet-beta") {
    const prpc = e.SOLANA_PUBLIC_RPC ?? "";
    add({ id: "public-rpc", label: "Browsers will not see the server RPC key", ok: !prpc || prpc !== e.SOLANA_RPC || !new URL(e.SOLANA_RPC).search,
      detail: prpc ? "separate public RPC configured" : "browsers use the public mainnet endpoint", required: true });
    add({ id: "finality", label: "Payments wait for finalized", ok: e.SOLANA_FINALITY === "finalized", detail: e.SOLANA_FINALITY, required: true });
  }
  // mint
  if (!e.NEURON_MINT) add({ id: "mint", label: "$NEURON mint set and exists on chain", ok: false, detail: "not set", required: true });
  else if (rpcCluster) {
    try {
      const info = await connection().getParsedAccountInfo(new PublicKey(e.NEURON_MINT));
      const parsed = (info.value?.data as { parsed?: { type?: string; info?: { decimals: number; freezeAuthority: string | null; mintAuthority: string | null; supply: string } } })?.parsed;
      if (!parsed || parsed.type !== "mint") add({ id: "mint", label: "$NEURON mint set and exists on chain", ok: false, detail: "no SPL mint at this address on this cluster", required: true });
      else {
        const i = parsed.info!;
        add({ id: "mint", label: "$NEURON mint set and exists on chain", ok: true, detail: `${i.decimals} decimals · supply ${i.supply}`, required: true });
        add({ id: "freeze", label: "Mint has no freeze authority", ok: i.freezeAuthority === null, detail: i.freezeAuthority ? `freeze authority ${i.freezeAuthority}` : "none", required: true });
        add({ id: "mint-authority", label: "Mint authority is revoked", ok: i.mintAuthority === null, detail: i.mintAuthority ? `still ${i.mintAuthority}: more can be minted` : "revoked (fixed supply)", required: false });
      }
    } catch (err) { add({ id: "mint", label: "$NEURON mint set and exists on chain", ok: false, detail: (err as Error).message.slice(0, 140), required: true }); }
  } else add({ id: "mint", label: "$NEURON mint set and exists on chain", ok: null, detail: "RPC not reachable", required: true });
  add({ id: "treasury", label: "Treasury owner set", ok: !!e.TREASURY_OWNER, detail: e.TREASURY_OWNER ?? "not set", required: true });
  add({ id: "treasury-not-admin", label: "Treasury is not an admin wallet", ok: e.TREASURY_OWNER ? !isAdmin(e.TREASURY_OWNER) : null, detail: "keep the treasury separate from day-to-day keys", required: false });
  // site + server
  let domainOk = false;
  try { domainOk = new URL(e.APP_URL).host === e.APP_DOMAIN && e.APP_URL.startsWith("https://") && !/localhost|127\.0\.0\.1/.test(e.APP_DOMAIN); } catch { /* invalid */ }
  add({ id: "domain", label: "Real HTTPS domain configured", ok: domainOk, detail: `${e.APP_URL} · ${e.APP_DOMAIN}`, required: true });
  add({ id: "registry-key", label: "Registry signing key comes from the environment", ok: !!e.REGISTRY_SIGNING_KEY, detail: e.REGISTRY_SIGNING_KEY ? "REGISTRY_SIGNING_KEY set" : "generated key stored in the database", required: false });
  try { const c = await verifyChain(pool()); add({ id: "registry", label: "Registry chain intact", ok: c.intact, detail: `${c.length} entries`, required: true }); }
  catch (err) { add({ id: "registry", label: "Registry chain intact", ok: false, detail: (err as Error).message, required: true }); }
  add({ id: "allow", label: "Mainnet not blocked by the server environment", ok: e.ALLOW_MAINNET !== "no", detail: e.ALLOW_MAINNET === "no" ? "ALLOW_MAINNET=no" : "allowed", required: true });
  // attestations
  for (const d of DEFS.filter((x) => x.kind === "check")) add({ id: d.key, label: d.label, ok: !!e[d.key as keyof Env], detail: d.help, required: true });
  const blocking = checks.filter((c) => c.required && c.ok !== true);
  return { target, checks, ready: blocking.length === 0, blocking: blocking.map((c) => c.id), checkedAt: new Date().toISOString() };
}

export async function goLive(s: Session, confirm: string) {
  if (confirm !== "GO MAINNET") throw bad("Type GO MAINNET to confirm.");
  if (env().SOLANA_CLUSTER === "mainnet-beta") throw bad("Already on mainnet.");
  const r = await readiness("mainnet-beta");
  if (!r.ready) throw bad(`Not ready: ${r.blocking.join(", ")}.`, r.blocking);
  await write(s, { SOLANA_CLUSTER: "mainnet-beta", MAINNET_CONFIRMED: "true" });
  log.warn("mainnet_enabled", { wallet: s.wallet });
  return adminState();
}

export async function leaveMainnet(s: Session, cluster: "devnet" | "localnet") {
  await write(s, { SOLANA_CLUSTER: cluster, MAINNET_CONFIRMED: null });
  return adminState();
}

/** registry key fingerprint for the admin overview (public key only) */
export async function registryKeyInfo() {
  const k = await signingKey();
  return { keyId: k.id, publicKey: k.publicKey };
}
export { ensureSettings };
