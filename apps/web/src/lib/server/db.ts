import pg from "pg";
import { env } from "./env";

pg.types.setTypeParser(20, (v) => v); // int8 → string (cursors, slots); we parse explicitly where needed
pg.types.setTypeParser(1700, (v) => v); // numeric → string (exact token amounts)

const g = globalThis as unknown as { __neuronPool?: pg.Pool };
export function pool(): pg.Pool {
  if (!g.__neuronPool) {
    g.__neuronPool = new pg.Pool({ connectionString: env().DATABASE_URL, max: 10, statement_timeout: 15_000 });
  }
  return g.__neuronPool;
}

export type Db = pg.Pool | pg.PoolClient;

export async function q<T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = [], db: Db = pool()) {
  return (await db.query<T>(sql, params)).rows;
}
export async function one<T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = [], db: Db = pool()) {
  return (await db.query<T>(sql, params)).rows[0] ?? null;
}

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool().connect();
  try {
    await c.query("begin");
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export async function emit(db: Db, topic: string, refId: string, data: Record<string, unknown> = {}, userId: string | null = null) {
  await db.query("insert into activity_events (topic, ref_id, user_id, data) values ($1,$2,$3,$4)", [topic, refId, userId, data]);
}
