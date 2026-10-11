"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { forward, generateModel, connectionCount } from "@neuron/engine";
import { GraphCanvas } from "../GraphCanvas";
import { Reveal, Scramble, short } from "../ui";
import { SPECIMENS, seededInput } from "@/lib/client/specimens";

export function HomeSpecimens() {
  const models = useMemo(() => SPECIMENS.map((s) => ({ ...s, model: generateModel(s.config) })), []);
  return (
    <section className="border-y hair bg-surface-2/40" aria-labelledby="spec-h">
      <div className="mx-auto max-w-[1600px] px-4 py-16">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="label">§ 02 · six forms</div>
            <Scramble as="h2" text="SIX GEOMETRIES. SIX DIFFERENT MODELS." className="display mt-3 block text-[34px]" />
            <p className="mt-3 max-w-[60ch] text-muted">Each specimen below is a different seed, so it has a different architecture and different weights. The form is only how its graph is drawn; switching it never changes the hash. Hover to run a seeded input.</p>
          </div>
          <Link href="/networks" className="act">open the gallery →</Link>
        </div>
        <div className="mt-8 grid grid-cols-1 gap-px bg-line sm:grid-cols-2 lg:grid-cols-3">
          {models.map((s, i) => <Specimen key={s.form} i={i} {...s} />)}
        </div>
      </div>
    </section>
  );
}

function Specimen({ form, config, model, i }: { form: (typeof SPECIMENS)[number]["form"]; config: (typeof SPECIMENS)[number]["config"]; model: ReturnType<typeof generateModel>; i: number }) {
  const [acts, setActs] = useState<number[][] | null>(null);
  const [n, setN] = useState(0);
  const play = () => { const k = n + 1; setN(k); setActs(forward(model, seededInput(`${config.seed}-${k}`, config.inputDim)).a.map((v) => Array.from(v))); };
  return (
    <Reveal delay={i * 80} className="bg-bg">
      <article className="group" onMouseEnter={play} onFocus={play}>
        <GraphCanvas model={model} form={form} activations={acts} interactive={false} labels={false} className="h-[240px]" ariaLabel={`${config.name}, ${form.toLowerCase()} form`} />
        <div className="grid grid-cols-[1fr_auto] gap-x-4 border-t hair px-3 py-2">
          <div className="text-[11px] uppercase tracking-[0.14em]">{form}</div>
          <Link href={`/generator?seed=${encodeURIComponent(config.seed)}&form=${form}`} className="text-[10px] text-muted">fork in generator</Link>
          <div className="tnum text-[10px] text-muted">{config.architecture} · {[config.inputDim, ...config.hidden, config.outputDim].join("·")} · {connectionCount(model)} edges</div>
          <div className="tnum text-[10px] text-faint" title={model.artifactHash}>{short(model.artifactHash, 5)}</div>
        </div>
      </article>
    </Reveal>
  );
}
