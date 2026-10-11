"use client";
import { useEffect, useState } from "react";
import { generateModel, parameterCount, connectionCount, neuronCount, ENGINE_VERSION } from "@neuron/engine";
import { HERO_CONFIG } from "@/lib/client/specimens";

/**
 * First-visit boot sequence. Everything it prints is computed live: it generates the
 * hero specimen with the real engine and streams its actual artifact hash.
 */
export function BootLoader() {
  const [state, setState] = useState<"boot" | "out" | "done">("done");
  const [lines, setLines] = useState<string[]>([]);
  const [hash, setHash] = useState("");
  const [shown, setShown] = useState(0);
  useEffect(() => {
    let seen = false;
    try { seen = sessionStorage.getItem("neuron.booted") === "1"; sessionStorage.setItem("neuron.booted", "1"); } catch { /* ignore */ }
    if (seen || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setState("boot");
    const t0 = performance.now();
    const m = generateModel(HERO_CONFIG);
    const ms = (performance.now() - t0).toFixed(1);
    const dims = [m.config.inputDim, ...m.config.hidden, m.config.outputDim];
    const out = [
      `${ENGINE_VERSION}`,
      `seed "${HERO_CONFIG.seed}" → prng neuron-prng/1`,
      ...m.layers.map((L, i) => `L${i + 1}  ${String(L.inDim).padStart(2)}→${String(L.outDim).padEnd(2)}  ${L.activation.padEnd(10)} ${L.mask ? "sparse" : "dense"}`),
      `${neuronCount(m)} neurons · ${connectionCount(m)} edges · ${parameterCount(m)} params · ${ms} ms`,
      `topology ${dims.join("·")}`,
    ];
    out.forEach((l, i) => setTimeout(() => setLines((x) => [...x, l]), 70 * i));
    setTimeout(() => setHash(m.artifactHash), 70 * out.length);
    const end = setTimeout(() => setState("out"), 70 * out.length + 700);
    const gone = setTimeout(() => setState("done"), 70 * out.length + 1350);
    const skip = () => setState("out");
    window.addEventListener("keydown", skip, { once: true });
    return () => { clearTimeout(end); clearTimeout(gone); window.removeEventListener("keydown", skip); };
  }, []);
  useEffect(() => {
    if (!hash) return;
    const t = setInterval(() => setShown((s) => (s >= 64 ? (clearInterval(t), 64) : s + 4)), 18);
    return () => clearInterval(t);
  }, [hash]);
  useEffect(() => { if (state === "out") { const t = setTimeout(() => setState("done"), 650); return () => clearTimeout(t); } }, [state]);
  if (state === "done") return null;
  return (
    <div aria-hidden onClick={() => setState("out")}
      className={`fixed inset-0 z-[100] flex items-center justify-center bg-bg transition-[clip-path,opacity] duration-[650ms] ease-[cubic-bezier(.7,0,.2,1)] ${state === "out" ? "[clip-path:inset(0_0_100%_0)]" : "[clip-path:inset(0_0_0_0)]"}`}>
      <div className="w-[min(560px,calc(100vw-32px))]">
        <div className="display text-[56px] tracking-[0.08em] text-fg sm:text-[84px]">NEURON</div>
        <div className="mt-1 h-px w-full bg-line"><div className="h-px bg-accent transition-[width] duration-300" style={{ width: `${Math.min(100, (lines.length / 9) * 100)}%` }} /></div>
        <pre className="mt-4 min-h-[180px] text-[11px] leading-[1.7] text-muted">{lines.map((l, i) => <div key={i} className={i === lines.length - 1 ? "text-fg" : ""}>{"› "}{l}</div>)}</pre>
        <div className="tnum mt-2 break-all text-[11px] text-accent-2">{hash ? <>artifact <span className="text-fg">{hash.slice(0, shown)}</span><span className="text-faint">{hash.slice(shown).replace(/./g, "·")}</span></> : " "}</div>
        <div className="label mt-6">click or press any key to skip</div>
      </div>
    </div>
  );
}
