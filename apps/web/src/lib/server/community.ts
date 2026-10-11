import { randomBytes } from "node:crypto";
import {
  compileCommunity, DEFAULT_POLICY, exportModel, genesisNeurons, hashCanonical, neuronIssues, ENGINE_VERSION,
  type CommunityNeuron, type CommunityPolicy,
} from "@neuron/engine";
import { one, q, tx, emit, type Db } from "./db";
import { getArtifact, putArtifact } from "./artifacts";
import { reserve, settle } from "./credits";
import { env } from "./env";
import { bad, conflict, forbidden, notFound } from "./http";
import { consumeChallenge, type Session } from "./auth";

export const NETWORK_ID = "community";

/** canonical payload a wallet signs to register/update a neuron */
export const neuronPayloadHash = (action: string, n: { layer: number; bias: number; seed: string; scale: number; id?: string }) =>
  hashCanonical({ action, id: n.id ?? null, layer: n.layer, bias: n.bias, seed: n.seed, scale: n.scale });

export async function ensureNetwork(db: Db) {
  const n = await one<{ id: string }>("select id from networks where id = $1", [NETWORK_ID], db);
  if (n) return;
  await tx(async (c) => {
    const again = await one("select 1 from networks where id = $1 for update", [NETWORK_ID], c);
    if (again) return;
    await c.query("insert into networks (id, name, policy, current_version) values ($1,'Community network',$2,0) on conflict do nothing", [NETWORK_ID, DEFAULT_POLICY]);
    for (const g of genesisNeurons()) {
      await c.query("insert into neurons (id, network_id, owner_wallet, layer, bias, seed, scale, created_at) values ($1,$2,'protocol',$3,$4,$5,$6,$7) on conflict do nothing",
        [g.id, NETWORK_ID, g.layer, g.bias, g.seed, g.scale, g.createdAt]);
    }
    await newVersion(c, { type: "genesis" }, null);
  });
}

async function activeNeurons(db: Db): Promise<CommunityNeuron[]> {
  const rows = await q<{ id: string; owner_wallet: string; layer: 1 | 2; bias: number; seed: string; scale: number; created_at: string }>(
    "select id, owner_wallet, layer, bias, seed, scale, created_at from neurons where network_id = $1 and status = 'active'", [NETWORK_ID], db);
  return rows.map((r) => ({ id: r.id, owner: r.owner_wallet, layer: r.layer, bias: r.bias, seed: r.seed, scale: r.scale, createdAt: new Date(r.created_at).toISOString() }));
}

/** Compile the current neuron set into an immutable version. Caller holds the network row lock. */
async function newVersion(db: Db, change: Record<string, unknown>, userId: string | null) {
  const net = (await one<{ policy: CommunityPolicy; current_version: number }>("select policy, current_version from networks where id = $1 for update", [NETWORK_ID], db))!;
  const neurons = await activeNeurons(db);
  const { model, snapshotHash } = compileCommunity(neurons, net.policy);
  const version = net.current_version + 1;
  const hash = await putArtifact(db, "network_snapshot", { model: exportModel(model), neurons, policy: net.policy, snapshotHash, version }, snapshotHash);
  // store the compiled model so experiments can pin it like any other model version
  const exists = await one("select 1 from models where id = $1", [model.id], db);
  if (!exists) {
    await putArtifact(db, "model", exportModel(model), model.artifactHash);
    await db.query(
      `insert into models (id, name, seed, architecture, config, config_hash, visibility, neuron_count, edge_count, param_count, presentation)
       values ($1,$2,$3,'feedforward',$4,$5,'unlisted',$6,$7,$8,'{"form":"CORTEX","palette":"theme"}')`,
      [model.id, `community-${model.config.hidden.join("x")}`, model.config.seed, model.config, model.configHash,
        model.config.inputDim + model.config.hidden.reduce((a, b) => a + b, 0) + model.config.outputDim,
        model.layers.reduce((s, L) => s + L.W.length, 0), model.layers.reduce((s, L) => s + L.W.length + L.outDim, 0)]);
  }
  let mv = await one<{ id: string; version: number }>("select id, version from model_versions where model_id = $1 and artifact_hash = $2", [model.id, model.artifactHash], db);
  if (!mv) {
    await putArtifact(db, "model", exportModel(model), model.artifactHash);
    mv = await one<{ id: string; version: number }>(
      `insert into model_versions (model_id, version, artifact_hash, trained, engine)
       values ($1, (select coalesce(max(version),0)+1 from model_versions where model_id = $1), $2, false, $3) returning id, version`,
      [model.id, model.artifactHash, ENGINE_VERSION], db);
  }
  const nv = (await one<{ id: string }>(
    `insert into network_versions (network_id, version, snapshot_hash, artifact_hash, model_id, neuron_count, change)
     values ($1,$2,$3,$4,$5,$6,$7) returning id`, [NETWORK_ID, version, snapshotHash, hash, model.id, neurons.length, { ...change, modelVersion: mv!.version }], db))!;
  await db.query("update networks set current_version = $2 where id = $1", [NETWORK_ID, version]);
  await emit(db, "network.version", NETWORK_ID, { version, change }, userId);
  return { versionId: nv.id, version, modelId: model.id, modelVersion: mv!.version };
}

export async function registerNeuron(s: Session, n: { layer: 1 | 2; bias: number; seed: string; scale: number }, signed: { message: string; signature: string }) {
  const iss = neuronIssues(n);
  if (iss.length) throw bad(iss.join("; "));
  return tx(async (db) => {
    await consumeChallenge(db, signed.message, signed.signature, "register-neuron", neuronPayloadHash("register", n));
    const net = (await one<{ policy: CommunityPolicy }>("select policy from networks where id = $1 for update", [NETWORK_ID], db))!;
    const count = await one<{ n: number }>("select count(*)::int as n from neurons where network_id = $1 and status = 'active' and layer = $2", [NETWORK_ID, n.layer], db);
    if ((count?.n ?? 0) >= net.policy.maxPerLayer) throw conflict(`Layer ${n.layer} is full (${net.policy.maxPerLayer} neurons). Try the other layer or wait for a governance change.`);
    const mine = await one<{ n: number }>("select count(*)::int as n from neurons where owner_id = $1 and status = 'active'", [s.userId], db);
    if ((mine?.n ?? 0) >= 8) throw conflict("A wallet can hold at most 8 active neurons.");
    const id = "nrn_" + randomBytes(6).toString("hex");
    const cost = env().REGISTRATION_CREDITS;
    if (cost) { await reserve(db, s.userId, cost, "neuron", id); await settle(db, s.userId, cost, cost, "neuron", id); }
    await db.query("insert into neurons (id, network_id, owner_id, owner_wallet, layer, bias, seed, scale, registration_signature) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [id, NETWORK_ID, s.userId, s.wallet, n.layer, n.bias, n.seed, n.scale, signed.signature]);
    const v = await newVersion(db, { type: "register", neuronId: id, by: s.wallet }, s.userId);
    return { id, cost, ...v };
  });
}

export async function updateNeuron(s: Session, id: string, n: { layer: 1 | 2; bias: number; seed: string; scale: number }, signed: { message: string; signature: string }) {
  const iss = neuronIssues(n);
  if (iss.length) throw bad(iss.join("; "));
  return tx(async (db) => {
    await consumeChallenge(db, signed.message, signed.signature, "update-neuron", neuronPayloadHash("update", { ...n, id }));
    await one("select 1 from networks where id = $1 for update", [NETWORK_ID], db);
    const cur = await one<{ owner_id: string | null; layer: number; status: string }>("select owner_id, layer, status from neurons where id = $1 for update", [id], db);
    if (!cur || cur.status !== "active") throw notFound("Neuron not found.");
    if (cur.owner_id !== s.userId) throw forbidden("You can only change neurons your wallet registered.");
    if (cur.layer !== n.layer) throw bad("A neuron cannot change layers; retire it and register a new one.");
    await db.query("update neurons set bias = $2, seed = $3, scale = $4, updated_at = now() where id = $1", [id, n.bias, n.seed, n.scale]);
    return newVersion(db, { type: "update", neuronId: id, by: s.wallet }, s.userId);
  });
}

export async function retireNeuron(s: Session, id: string) {
  return tx(async (db) => {
    await one("select 1 from networks where id = $1 for update", [NETWORK_ID], db);
    const cur = await one<{ owner_id: string | null; layer: number; status: string }>("select owner_id, layer, status from neurons where id = $1 for update", [id], db);
    if (!cur || cur.status !== "active") throw notFound("Neuron not found.");
    if (cur.owner_id !== s.userId) throw forbidden("You can only retire your own neurons.");
    const left = await one<{ n: number }>("select count(*)::int as n from neurons where network_id = $1 and status = 'active' and layer = $2", [NETWORK_ID, cur.layer], db);
    if ((left?.n ?? 0) <= 1) throw conflict("Each layer must keep at least one neuron.");
    await db.query("update neurons set status = 'retired', updated_at = now() where id = $1", [id]);
    return newVersion(db, { type: "retire", neuronId: id, by: s.wallet }, s.userId);
  });
}

export async function applyPolicy(db: Db, patch: Partial<CommunityPolicy>, reason: Record<string, unknown>) {
  const net = (await one<{ policy: CommunityPolicy }>("select policy from networks where id = $1 for update", [NETWORK_ID], db))!;
  await db.query("update networks set policy = $2 where id = $1", [NETWORK_ID, { ...net.policy, ...patch }]);
  return newVersion(db, { type: "policy", patch, ...reason }, null);
}

export async function networkState(db: Db, version?: number) {
  await ensureNetwork(db);
  const net = (await one<{ policy: CommunityPolicy; current_version: number; name: string }>("select name, policy, current_version from networks where id = $1", [NETWORK_ID], db))!;
  const v = await one<{ id: string; version: number; snapshot_hash: string; artifact_hash: string; model_id: string; neuron_count: number; change: Record<string, unknown>; created_at: string }>(
    "select * from network_versions where network_id = $1 and version = $2", [NETWORK_ID, version ?? net.current_version], db);
  if (!v) throw notFound("Network version not found.");
  const snap = await getArtifact<{ neurons: CommunityNeuron[] }>(db, v.artifact_hash);
  const versions = await q("select version, snapshot_hash, neuron_count, change, created_at from network_versions where network_id = $1 order by version desc limit 50", [NETWORK_ID], db);
  return { name: net.name, policy: net.policy, current: net.current_version, version: v, neurons: snap.neurons, versions };
}
