"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useScroll, useTransform } from "motion/react";
import { SplitHeading } from "../motion";
import { spring } from "@/lib/client/motion";
import { forward, generateModel, parameterCount, connectionCount } from "@neuron/engine";
import { Specimen3D } from "../Specimen3D";
import { short } from "../ui";
import { HERO_CONFIG, seededInput } from "@/lib/client/specimens";

/** Real computation on a loop: a seeded input every few seconds, propagated through the hero specimen. */
export function HomeHero() {
  const model = useMemo(() => generateModel(HERO_CONFIG), []);
  const [run, setRun] = useState<{ n: number; acts: number[][]; output: number[]; ms: number } | null>(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    let n = run?.n ?? 0;
    const go = () => {
      n++;
      const t0 = performance.now();
      const tr = forward(model, seededInput(`hero-${n}`, model.config.inputDim));
      setRun({ n, acts: tr.a.map((v) => Array.from(v)), output: tr.output, ms: performance.now() - t0 });
    };
    const first = setTimeout(go, 1400);
    const t = setInterval(go, 4200);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [model, paused]); // eslint-disable-line react-hooks/exhaustive-deps

  const argmax = run ? run.output.indexOf(Math.max(...run.output)) : -1;
  // scroll-linked exit: the copy lifts and fades, the specimen recedes, as the next section arrives
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const copyY = useTransform(scrollYProgress, [0, 1], [0, -90]);
  const copyO = useTransform(scrollYProgress, [0, 0.6], [1, 0]);
  const sceneO = useTransform(scrollYProgress, [0, 1], [1, 0.25]);
  const sceneS = useTransform(scrollYProgress, [0, 1], [1, 1.06]);
  return (
    <section ref={ref} className="relative min-h-[100svh] overflow-hidden" aria-labelledby="hero-h">
      <motion.div className="absolute inset-0" style={{ opacity: sceneO, scale: sceneS }}>
      <Specimen3D model={model} activations={run?.acts} className="absolute inset-0" bloom={1} framing={1.0} offsetX={0.17} offsetY={0.06}
        ariaLabel={`Specimen ${model.id}: a ${model.config.architecture} network with ${connectionCount(model)} connections, rotating while it runs live inference`} />
      </motion.div>
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,var(--bg)_0%,color-mix(in_srgb,var(--bg)_70%,transparent)_28%,transparent_55%)]" aria-hidden />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-[linear-gradient(0deg,var(--bg),transparent)]" aria-hidden />

      <div className="pointer-events-none relative mx-auto flex min-h-[100svh] max-w-[1440px] flex-col justify-end px-5 pb-14 pt-28 sm:px-8 lg:pb-20">
        <motion.div className="pointer-events-auto max-w-[640px]" style={{ y: copyY, opacity: copyO }}>
          <SplitHeading id="hero-h" text="Intelligence is a network." className="display text-[clamp(52px,8.2vw,124px)]" delay={0.15} />
          <p className="rise mt-6 max-w-[46ch] text-[17px] leading-[1.55] text-muted [animation-delay:.55s]">
            Create neurons. Build networks. Run experiments. Watch computation become visible.
          </p>
          <p className="rise mt-3 max-w-[46ch] text-[13px] text-faint [animation-delay:.65s]">A real generated network, running live in your browser. Seeded, not trained.</p>
          <div className="rise mt-9 flex flex-wrap items-center gap-5 [animation-delay:.75s]">
            <Link href="/lab" className="act-primary no-underline">Enter the lab</Link>
            <Link href="/networks" className="act">Explore networks</Link>
          </div>
        </motion.div>
      </div>

      <motion.aside aria-label="Live inference" style={{ opacity: copyO }} className="glass-chip rise absolute bottom-16 right-5 hidden w-[560px] grid-cols-[170px_1fr] gap-6 p-5 [animation-delay:1s] sm:right-8 lg:bottom-20 lg:grid">
        <div className="border-r border-line pr-5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="whitespace-nowrap text-[12.5px] text-muted">Live inference</span>
            <button className="act text-[12px]" onClick={() => setPaused((p) => !p)}>{paused ? "Resume" : "Pause"}</button>
          </div>
          <div className="mt-2 h-10 overflow-hidden font-serif-d text-[40px] leading-none tnum">
            <motion.div key={run?.n ?? 0} initial={{ y: "100%", opacity: 0 }} animate={{ y: "0%", opacity: 1 }} transition={spring.ui} data-testid="hero-run">#{String(run?.n ?? 0).padStart(4, "0")}</motion.div>
          </div>
          <div className="mt-2 tnum text-[11.5px] text-muted">{run ? `${run.ms.toFixed(2)} ms` : "warming up"}</div>
        </div>
        <div className="min-w-0">
          <ul className="grid grid-cols-2 gap-x-5 gap-y-2" aria-label="Softmax output">
            {(run?.output ?? Array(model.config.outputDim).fill(0)).map((v, i) => (
              <li key={i} className="grid grid-cols-[20px_1fr_48px] items-center gap-2 text-[12px]">
                <span className={`tnum ${i === argmax ? "text-accent-2" : "text-muted"}`}>y{i}</span>
                <span className="h-[3px] overflow-hidden rounded-full bg-fg/10">
                  <motion.span className="block h-full origin-left rounded-full bg-[linear-gradient(90deg,var(--accent),var(--accent-2))]" initial={false} animate={{ scaleX: v }} transition={spring.data} />
                </span>
                <span className={`tnum text-right ${i === argmax ? "text-fg" : "text-muted"}`}>{v.toFixed(3)}</span>
              </li>
            ))}
          </ul>
          <div className="hairline-glow my-3" />
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted">
            <span>Shape <span className="tnum text-fg">{[model.config.inputDim, ...model.config.hidden, model.config.outputDim].join("·")}</span></span>
            <span>{parameterCount(model).toLocaleString()} parameters</span>
            <span title={model.artifactHash}>Artifact <span className="tnum text-fg">{short(model.artifactHash, 5)}</span></span>
          </p>
        </div>
      </motion.aside>
    </section>
  );
}
