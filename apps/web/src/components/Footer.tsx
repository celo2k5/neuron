"use client";
import Link from "next/link";
import { THEMES, setTheme, useTheme } from "@/lib/client/theme";
import { useConfig } from "@/lib/client/wallet";
import { NAV } from "./Header";

const SWATCH: Record<string, string[]> = {
  obsidian: ["#080B12", "#4D8DFF", "#8BE9FF"], bio: ["#06110D", "#4FE3B0", "#3CC9D6"], plasma: ["#0E0616", "#FF6F61", "#FF4FD8"],
  solar: ["#F5F1E8", "#D9480F", "#141210"], mono: ["#000000", "#FFFFFF", "#8C8C8C"], abyss: ["#040A19", "#19D3C5", "#67E8F9"],
};

export function ThemeSwitcher() {
  const t = useTheme();
  return (
    <div role="radiogroup" aria-label="Theme" className="flex flex-wrap gap-2">
      {THEMES.map((th) => (
        <button key={th.id} role="radio" aria-checked={t === th.id} onClick={() => setTheme(th.id)} title={`${th.name} — ${th.note}`}
          className={`group flex items-center gap-2 border px-2 py-1 text-[10px] tracking-[0.12em] transition-colors ${t === th.id ? "border-accent text-fg" : "hair text-muted hover:text-fg"}`}>
          <span className="flex">{SWATCH[th.id].map((c, i) => <span key={i} className="h-3 w-2" style={{ background: c, boxShadow: "inset 0 0 0 1px rgba(127,127,127,.25)" }} />)}</span>
          {th.name}
        </button>
      ))}
    </div>
  );
}

export function Footer() {
  const { data: cfg } = useConfig();
  return (
    <footer className="mt-20 border-t hair">
      <div className="mx-auto grid max-w-[1600px] gap-8 px-4 py-8 md:grid-cols-[1.2fr_1fr_1fr]">
        <div>
          <div className="display text-[28px] tracking-[0.06em]">NEURON</div>
          <p className="mt-2 max-w-[44ch] text-muted">One token. Infinite connections. Generated models are computational structures, not trained intelligence, until a training run says otherwise.</p>
          <div className="mt-4"><div className="label mb-2">theme</div><ThemeSwitcher /></div>
        </div>
        <nav aria-label="Footer"><div className="label mb-2">index</div>
          <ul className="grid grid-cols-2 gap-1">{NAV.map((n) => <li key={n.href}><Link href={n.href}>{n.label.toLowerCase()}</Link></li>)}<li><Link href="/ops">ops</Link></li></ul>
        </nav>
        <div><div className="label mb-2">instrument</div>
          <dl className="kv">
            <dt>engine</dt><dd>{cfg?.engine ?? "…"}</dd>
            <dt>cluster</dt><dd>{cfg?.cluster ?? "…"}</dd>
            <dt>program</dt><dd className="break-all">{cfg?.programId ?? <span className="text-warn">not configured</span>}</dd>
            <dt>mint</dt><dd className="break-all">{cfg?.mint ?? <span className="text-warn">not configured</span>}</dd>
          </dl>
        </div>
      </div>
    </footer>
  );
}
