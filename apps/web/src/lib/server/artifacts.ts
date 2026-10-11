import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { canonical, sha256Hex } from "@neuron/engine";
import { env } from "./env";
import { one, type Db } from "./db";

/**
 * Content-addressed, immutable artifact store. The default adapter writes to the
 * filesystem (ARTIFACT_DIR); the key is the SHA-256 of the canonical bytes, so a
 * write is idempotent and a read is self-verifying. Swap `fsAdapter` for S3/GCS in production.
 */
interface Adapter { put(key: string, bytes: Buffer): Promise<void>; get(key: string): Promise<Buffer> }

const fsAdapter: Adapter = {
  async put(key, bytes) {
    const p = path.resolve(env().ARTIFACT_DIR, key);
    await mkdir(path.dirname(p), { recursive: true });
    const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, bytes, { flag: "wx" });
    await rename(tmp, p);
  },
  async get(key) {
    const root = path.resolve(env().ARTIFACT_DIR);
    const p = path.resolve(root, key);
    if (!p.startsWith(root + path.sep)) throw new Error("artifact key escapes the store");
    return readFile(p);
  },
};

export type ArtifactKind = "model" | "checkpoint" | "activations" | "network_snapshot" | "dataset";

/** Store a JSON value; returns the content hash. The hash is over the canonical encoding. */
export async function putArtifact(db: Db, kind: ArtifactKind, value: unknown, hashOverride?: string): Promise<string> {
  const text = canonical(value);
  const hash = hashOverride ?? sha256Hex(text);
  const existing = await one("select hash from artifacts where hash = $1", [hash], db);
  if (existing) return hash;
  const key = `${hash.slice(0, 2)}/${hash}.json`;
  await fsAdapter.put(key, Buffer.from(text)).catch((e: NodeJS.ErrnoException) => { if (e.code !== "EEXIST") throw e; });
  await db.query("insert into artifacts (hash, kind, size_bytes, storage_key) values ($1,$2,$3,$4) on conflict (hash) do nothing", [hash, kind, Buffer.byteLength(text), key]);
  return hash;
}

export async function getArtifact<T = unknown>(db: Db, hash: string): Promise<T> {
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error("bad artifact hash");
  const row = await one<{ storage_key: string }>("select storage_key from artifacts where hash = $1", [hash], db);
  if (!row) throw new Error(`artifact ${hash} not found`);
  const buf = await fsAdapter.get(row.storage_key);
  return JSON.parse(buf.toString()) as T;
}
