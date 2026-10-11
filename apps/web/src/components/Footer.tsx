"use client";
import Link from "next/link";
import { THEMES, setTheme, useTheme } from "@/lib/client/theme";
import { useConfig } from "@/lib/client/wallet";
import { NAV } from "./Header";
import { Glyph } from "./Glyph";

const SWATCH: Record<string, [string, string]> = {
  obsidian: ["#080B12", "#4D8DFF"], bio: ["#06110D", "#4FE3B0"], plasma: ["#0E0616", "#FF6F61"],
  solar: ["#F5F1E8", "#D9480F"], mono: ["#000000", "#FFFFFF"], abyss: ["#040A19", "#19D3C5"],
};
const NAME: Record<string, string> = { obsidian: "Obsidian", bio: "Bio", plasma: "Plasma", solar: "Solar", mono: "Mono", abyss: "Abyss" };

export function ThemeSwitcher() {
  const t = useTheme();
  return (
    <div role="radiogroup" aria-label="Theme" className="flex flex-wrap gap-2">
      {THEMES.map((th) => (
        <button key={th.id} role="radio" aria-checked={t === th.id} onClick={() => setTheme(th.id)} title={th.note}
          className={`flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-[12.5px] transition-colors ${t === th.id ? "border-accent/60 bg-accent/10 text-fg" : "border-line text-muted hover:text-fg"}`}>
          <span className="relative h-5 w-5 overflow-hidden rounded-full" style={{ background: SWATCH[th.id][0], boxShadow: "inset 0 0 0 1px rgba(127,127,127,.35)" }}>
            <span className="absolute inset-[5px] rounded-full" style={{ background: SWATCH[th.id][1], boxShadow: `0 0 8px ${SWATCH[th.id][1]}` }} />
          </span>
          {NAME[th.id]}
        </button>
      ))}
    </div>
  );
}

export function Footer() {
  const { data: cfg } = useConfig();
  return (
    <footer className="border-t border-line">
      <div className="mx-auto grid max-w-[1440px] gap-12 px-5 py-16 sm:px-8 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5"><Glyph size={26} /><span className="font-serif-d text-[26px]">Neuron</span></div>
          <p className="mt-4 max-w-[44ch] text-[14px] text-muted">One token. Infinite connections. Generated models are computational structures, not trained intelligence, until a training run says otherwise.</p>
          <div className="mt-8"><div className="mb-3 text-[13px] text-muted">Theme</div><ThemeSwitcher /></div>
        </div>
        <nav aria-label="Footer">
          <div className="mb-3 text-[13px] text-muted">Index</div>
          <ul className="grid grid-cols-2 gap-x-6 gap-y-2 text-[14px]">{NAV.map((n) => <li key={n.href}><Link href={n.href} className="no-underline hover:text-accent-2">{n.label}</Link></li>)}<li><Link href="/ops" className="no-underline hover:text-accent-2">Operations</Link></li></ul>
        </nav>
        <div>
          <div className="mb-3 text-[13px] text-muted">Instrument</div>
          <dl className="kv">
            <dt>Engine</dt><dd className="tnum">{cfg?.engine ?? "…"}</dd>
            <dt>Cluster</dt><dd>{cfg?.cluster ?? "…"}</dd>
            <dt>Program</dt><dd className="tnum break-all">{cfg?.programId ?? <span className="text-warn">Not configured</span>}</dd>
            <dt>Mint</dt><dd className="tnum break-all">{cfg?.mint ?? <span className="text-warn">Not configured</span>}</dd>
          </dl>
        </div>
      </div>
    </footer>
  );
}
