"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { forward, generateModel, connectionCount } from "@neuron/engine";
import { GraphCanvas } from "../GraphCanvas";
import { Reveal, short } from "../ui";
import { SPECIMENS, seededInput } from "@/lib/client/specimens";

const FORM_NAME: Record<string, string> = { CONSTELLATION: "Constellation", CORTEX: "Cortex", CIRCUIT: "Circuit", FRACTAL: "Fractal", SYNAPSE: "Synapse", MINIMAL: "Minimal" };

export function HomeSpecimens() {
  const models = useMemo(() => SPECIMENS.map((s) => ({ ...s, model: generateModel(s.config) })), []);
  return (
    <section className="relative border-t border-line" aria-labelledby="spec-h">
      <div className="aurora pointer-events-none absolute inset-0 opacity-70" aria-hidden />
      <div className="relative mx-auto max-w-[1440px] px-5 py-28 sm:px-8 lg:py-36">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <h2 id="spec-h" className="display text-[clamp(38px,4.4vw,64px)]">Six specimens, six geometries.</h2>
            <p className="mt-5 max-w-[56ch] text-[16px] text-muted">Each is a different seed, so each has its own architecture and weights. The geometry only changes how the graph is drawn; it never changes the model&apos;s hash. Hover one to run it.</p>
          </div>
          <Link href="/networks" className="act">Open the gallery</Link>
        </div>
        <div className="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
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
    <Reveal delay={(i % 3) * 90}>
      <article className="panel group overflow-hidden transition-[transform,box-shadow] duration-500 hover:-translate-y-1" onMouseEnter={play} onFocus={play}>
        <GraphCanvas model={model} form={form} activations={acts} interactive={false} labels={false} className="h-[260px]" ariaLabel={`${config.name}, ${FORM_NAME[form]} geometry`} />
        <div className="flex items-end justify-between gap-4 border-t border-line px-5 py-4">
          <div className="min-w-0">
            <div className="font-serif-d text-[22px]">{FORM_NAME[form]}</div>
            <div className="mt-0.5 truncate text-[12.5px] text-muted">{config.architecture} · <span className="tnum">{[config.inputDim, ...config.hidden, config.outputDim].join("·")}</span> · {connectionCount(model)} edges</div>
          </div>
          <Link href={`/generator?seed=${encodeURIComponent(config.seed)}&form=${form}`} className="shrink-0 text-[12.5px] text-muted" title={model.artifactHash}>
            <span className="tnum">{short(model.artifactHash, 4)}</span>
          </Link>
        </div>
      </article>
    </Reveal>
  );
}
