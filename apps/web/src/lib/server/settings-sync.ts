import pg from "pg";
import { q } from "./db";
import { env, overlay, parseEnv } from "./env";
import { log } from "./log";

// ---------- sync ----------
const g = globalThis as unknown as { __settingsSync?: { loaded: Promise<void>; last: string | null } };

export async function loadSettings() {
  const rows = await q<{ key: string; value: string; updated_at: string }>("select key, value, updated_at::text from app_settings");
  const o = overlay();
  const next = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  if (JSON.stringify(next) !== JSON.stringify(o.values)) {
    try { parseEnv(next); o.values = next; o.version++; }
    catch (e) { log.error("settings_rejected", { error: (e as Error).message }); } // keep the last good config
  }
  if (g.__settingsSync) g.__settingsSync.last = rows.reduce<string | null>((m, r) => (!m || r.updated_at > m ? r.updated_at : m), null);
}

/** Load once, then follow changes: LISTEN for instant updates, poll every 5 s in case a notification is missed. */
export function ensureSettings() {
  if (!g.__settingsSync) {
    g.__settingsSync = { loaded: loadSettings().catch((e) => log.warn("settings_load_failed", { error: (e as Error).message })), last: null };
    if (!process.env.VITEST) (async () => {
      try {
        const e = env();
        const c = new pg.Client({ connectionString: e.DATABASE_URL, ...(e.DB_SCHEMA ? { options: `-c search_path=${e.DB_SCHEMA}` } : {}) });
        await c.connect();
        c.on("notification", () => { loadSettings().catch(() => {}); });
        c.on("error", () => {});
        await c.query("listen neuron_settings");
      } catch (e) { log.warn("settings_listen_failed", { error: (e as Error).message }); }
    })();
    setInterval(() => { loadSettings().catch(() => {}); }, 5000).unref?.();
  }
  return g.__settingsSync.loaded;
}

