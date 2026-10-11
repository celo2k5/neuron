"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { forward, generateModel, parameterCount, connectionCount, VISUAL_FORMS, type VisualForm } from "@neuron/engine";
import { GraphCanvas } from "../GraphCanvas";
import { VectorBars, fmt, short } from "../ui";
import { HERO_CONFIG, seededInput } from "@/lib/client/specimens";

/** Real computation on loop: a seeded input every few seconds, propagated through the hero specimen. */
export function HomeHero() {
  const model = useMemo(() => generateModel(HERO_CONFIG), []);
  const [form, setForm] = useState<VisualForm>("CONSTELLATION");
  const [run, setRun] = useState<{ n: number; input: number[]; acts: number[][]; output: number[]; ms: number } | null>(null);
  const [paused, setPaused] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    if (paused) return;
    let n = run?.n ?? 0;
    const go = () => {
      n++;
      const input = seededInput(`hero-${n}`, model.config.inputDim);
      const t0 = performance.now();
      const tr = forward(model, input);
      setRun({ n, input, acts: tr.a.map((v) => Array.from(v)), output: tr.output, ms: performance.now() - t0 });
    };
    go();
    const t = setInterval(go, 3600);
    return () => clearInterval(t);
  }, [model, paused]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const on = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  const argmax = run ? run.output.indexOf(Math.max(...run.output)) : -1;
  const par = Math.min(1, scrollY / 700);

  return (
    <section className="relative border-b hair" aria-labelledby="hero-h">
      <div className="pointer-events-none absolute inset-0 opacity-60 [background-image:radial-gradient(var(--line)_1px,transparent_1px)] [background-size:18px_18px]" aria-hidden />
      <div className="relative mx-auto grid max-w-[1600px] gap-0 px-4 lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)_minmax(220px,260px)]">
        {/* left: thesis + entry points */}
        <div className="flex flex-col justify-between gap-8 border-line py-8 lg:border-r lg:pr-6">
          <div>
            <div className="label">§ 00 · specimen {model.id}</div>
            <h1 id="hero-h" className="display mt-4 text-[40px] sm:text-[60px] lg:text-[40px] xl:text-[48px]">
              INTELLIGENCE<br />IS A<br /><span className="text-accent">NETWORK.</span>
            </h1>
            <p className="mt-5 max-w-[34ch] text-[13px] text-muted">Create neurons. Build networks. Run experiments. Watch computation become visible.</p>
            <div className="mt-6 flex flex-wrap items-center gap-4">
              <Link href="/lab" className="act-primary no-underline">enter the lab →</Link>
              <Link href="/networks" className="act">explore networks</Link>
            </div>
          </div>
          <div className="text-[10.5px] text-muted">
            <p>What you see is the actual graph of a generated residual network. Every pulse is a real weighted contribution |w·a| computed by the engine in your browser.</p>
            <p className="mt-2 text-faint">Generated, not trained: these weights came from a seed, so the outputs carry no learned meaning.</p>
          </div>
        </div>

        {/* center: the instrument */}
        <div ref={wrap} className="relative min-h-[460px] lg:min-h-[640px]" style={{ transform: `translateY(${par * 40}px)`, opacity: 1 - par * 0.35 }}>
          <GraphCanvas model={model} form={form} activations={run?.acts} className="absolute inset-0" toolbar ariaLabel={`Hero specimen ${model.id}, ${form.toLowerCase()} view`} />
          <div className="absolute bottom-3 left-3 right-3 z-10 flex flex-wrap items-center gap-1" role="radiogroup" aria-label="Visual form">
            {VISUAL_FORMS.map((f) => (
              <button key={f} role="radio" aria-checked={f === form} className={`act-ghost !py-0.5 bg-bg/70 ${f === form ? "!border-accent !text-accent" : ""}`} onClick={() => setForm(f)}>{f.toLowerCase()}</button>
            ))}
            <button className="act ml-auto" onClick={() => setPaused((p) => !p)}>{paused ? "resume" : "pause"} inference</button>
          </div>
        </div>

        {/* right: readouts */}
        <aside className="flex flex-col gap-5 border-line py-8 text-[11px] lg:border-l lg:pl-5" aria-label="Live readouts">
          <div>
            <div className="label">run</div>
            <div className="display mt-1 text-[44px] tnum">#{String(run?.n ?? 0).padStart(4, "0")}</div>
            <div className="tnum text-muted">{run ? `${fmt(run.ms, 3)} ms · seed hero-${run.n}` : "…"}</div>
          </div>
          <div>
            <div className="label mb-1">input x ∈ ℝ{model.config.inputDim}</div>
            {run && <VectorBars values={run.input} color="var(--accent-2)" />}
          </div>
          <div>
            <div className="label mb-1">layer activations</div>
            <div className="flex flex-col gap-1">
              {run?.acts.slice(1, -1).map((a, i) => (
                <div key={i} className="grid grid-cols-[22px_1fr] items-center gap-2"><span className="text-faint tnum">L{i + 1}</span><VectorBars values={a} height={14} /></div>
              ))}
            </div>
          </div>
          <div>
            <div className="label mb-1">softmax output</div>
            <ul className="tnum">
              {run?.output.map((v, i) => (
                <li key={i} className={`flex justify-between ${i === argmax ? "text-accent" : ""}`}><span>y{i}</span><span>{v.toFixed(5)}</span></li>
              ))}
            </ul>
          </div>
          <dl className="kv mt-auto text-[10.5px]">
            <dt>arch</dt><dd>{model.config.architecture}</dd>
            <dt>shape</dt><dd>{[model.config.inputDim, ...model.config.hidden, model.config.outputDim].join("·")}</dd>
            <dt>params</dt><dd>{parameterCount(model)}</dd>
            <dt>edges</dt><dd>{connectionCount(model)}</dd>
            <dt>artifact</dt><dd title={model.artifactHash}>{short(model.artifactHash, 6)}</dd>
          </dl>
        </aside>
      </div>
    </section>
  );
}
