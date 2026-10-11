/** Seeds the public gallery with deterministic genesis specimens (real generated models, owner = none). Idempotent. */
import { randomConfig, VISUAL_FORMS, type Presentation } from "@neuron/engine";
import { pool, tx } from "../src/lib/server/db";
import { createModel } from "../src/lib/server/models";
import { ensureNetwork } from "../src/lib/server/community";

const N = Number(process.env.SEED_COUNT ?? 12);
await ensureNetwork(pool());
for (let i = 1; i <= N; i++) {
  const seed = `genesis-${String(i).padStart(3, "0")}`;
  const cfg = randomConfig(seed, { name: seed });
  const presentation: Presentation = { form: VISUAL_FORMS[i % VISUAL_FORMS.length], palette: i % 3 === 0 ? "seed" : "theme" };
  const r = await tx((db) => createModel(db, cfg, presentation, null));
  console.log(`${r.created ? "created" : "exists "} ${r.id} ${cfg.architecture} ${[cfg.inputDim, ...cfg.hidden, cfg.outputDim].join("·")}`);
}
await pool().end();
