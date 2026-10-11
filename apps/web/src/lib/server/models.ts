import {
  connectionCount, exportModel, generateModel, importModel, neuronCount, parameterCount, ENGINE_VERSION,
  type Model, type ModelArtifact, type ModelConfig, type Presentation,
} from "@neuron/engine";
import { one, q, emit, type Db } from "./db";
import { putArtifact, getArtifact } from "./artifacts";
import { cursor, notFound } from "./http";

export interface ModelRow {
  id: string; owner_id: string | null; owner_wallet: string | null; name: string; seed: string; architecture: string;
  config: ModelConfig; config_hash: string; presentation: Presentation; forked_from: string | null;
  neuron_count: number; edge_count: number; param_count: number; created_at: string;
  latest_version: number; latest_artifact_hash: string; trained: boolean;
  last_experiment_at?: string | null; verified_count?: number;
}

const SELECT = `
  select m.*, u.wallet as owner_wallet,
         v.version as latest_version, v.artifact_hash as latest_artifact_hash, v.trained,
         (select max(e.created_at) from experiments e where e.model_id = m.id) as last_experiment_at,
         (select count(*)::int from commitments c join experiments e on e.id = c.experiment_id where e.model_id = m.id and c.status = 'verified') as verified_count
    from models m
    left join users u on u.id = m.owner_id
    join lateral (select version, artifact_hash, trained from model_versions where model_id = m.id order by version desc limit 1) v on true`;

/** Persist a generated model. Same config ⇒ same id; returns the existing row in that case. */
export async function createModel(db: Db, config: ModelConfig, presentation: Presentation | undefined, ownerId: string | null, forkedFrom?: string) {
  const model = generateModel(config);
  const existing = await one<{ id: string }>("select id from models where config_hash = $1", [model.configHash], db);
  if (existing) return { id: existing.id, created: false };
  if (forkedFrom && !(await one("select 1 from models where id = $1", [forkedFrom], db))) throw notFound("Fork source not found.");
  const hash = await putArtifact(db, "model", exportModel(model), model.artifactHash);
  await db.query(
    `insert into models (id, owner_id, name, seed, architecture, config, config_hash, presentation, forked_from, neuron_count, edge_count, param_count)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [model.id, ownerId, config.name, config.seed, config.architecture, model.config, model.configHash,
      presentation ?? { form: "CONSTELLATION", palette: "theme" }, forkedFrom ?? null,
      neuronCount(model), connectionCount(model), parameterCount(model)]);
  await db.query("insert into model_versions (model_id, version, artifact_hash, trained, engine) values ($1,1,$2,false,$3)", [model.id, hash, ENGINE_VERSION]);
  await emit(db, "model.created", model.id, { name: config.name }, ownerId);
  return { id: model.id, created: true };
}

export async function getModelRow(db: Db, id: string) {
  return one<ModelRow>(`${SELECT} where m.id = $1`, [id], db);
}

export async function listVersions(db: Db, id: string) {
  return q<{ id: string; version: number; artifact_hash: string; parent_artifact_hash: string | null; trained: boolean; metrics: unknown; training_job_id: string | null; created_at: string; engine: string }>(
    "select id, version, artifact_hash, parent_artifact_hash, trained, metrics, training_job_id, created_at, engine from model_versions where model_id = $1 order by version desc", [id], db);
}

export async function loadVersion(db: Db, modelId: string, version?: number): Promise<{ model: Model; versionId: string }> {
  const v = await one<{ id: string; version: number; artifact_hash: string }>(
    version ? "select id, version, artifact_hash from model_versions where model_id = $1 and version = $2"
      : "select id, version, artifact_hash from model_versions where model_id = $1 order by version desc limit 1",
    version ? [modelId, version] : [modelId], db);
  if (!v) throw notFound("Model version not found.");
  const art = await getArtifact<ModelArtifact>(db, v.artifact_hash);
  const model = importModel(art); // re-validates schema and both hashes
  return { model, versionId: v.id };
}

export interface ListFilters { q?: string; architecture?: string; owner?: string; trained?: "yes" | "no"; sort: "newest" | "oldest" | "params" | "neurons"; limit: number; cursor?: string }

export async function listModels(db: Db, f: ListFilters) {
  const where: string[] = ["m.visibility = 'public'"];
  const p: unknown[] = [];
  const add = (sql: string, v: unknown) => { p.push(v); where.push(sql.replace("?", `$${p.length}`)); };
  if (f.q) add("(m.name ilike ? or m.seed ilike ? or m.id ilike ?)".replace(/\?/g, () => `$${p.length + 1}`), `%${f.q.replace(/[%_]/g, "\\$&")}%`);
  if (f.architecture) add("m.architecture = ?", f.architecture);
  if (f.owner) add("u.wallet = ?", f.owner);
  if (f.trained) add("v.trained = ?", f.trained === "yes");
  const col = { newest: "m.created_at", oldest: "m.created_at", params: "m.param_count", neurons: "m.neuron_count" }[f.sort];
  const dir = f.sort === "oldest" ? "asc" : "desc";
  const c = cursor.decode(f.cursor);
  if (c) {
    p.push(c[0], c[1]);
    const cast = col === "m.created_at" ? "::timestamptz" : "::int";
    where.push(`(${col}, m.id) ${dir === "desc" ? "<" : ">"} ($${p.length - 1}${cast}, $${p.length})`);
  }
  p.push(f.limit + 1);
  const rows = await q<ModelRow>(`${SELECT} where ${where.join(" and ")} order by ${col} ${dir}, m.id ${dir} limit $${p.length}`, p, db);
  const more = rows.length > f.limit;
  const items = rows.slice(0, f.limit);
  const last = items[items.length - 1];
  const val = (r: ModelRow) => (f.sort === "params" ? r.param_count : f.sort === "neurons" ? r.neuron_count : r.created_at);
  return { items, nextCursor: more && last ? cursor.encode(val(last), last.id) : null };
}

export async function setPresentation(db: Db, id: string, ownerId: string, presentation: Presentation) {
  const r = await db.query("update models set presentation = $3 where id = $1 and owner_id = $2", [id, ownerId, presentation]);
  return r.rowCount === 1;
}
