"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

export const short = (s: string, n = 4) => (s.length > n * 2 + 1 ? `${s.slice(0, n)}…${s.slice(-n)}` : s);
export const fmt = (v: number | null | undefined, d = 4) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(2) : v.toFixed(d));
export const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  return s < 60 ? `${Math.floor(s)}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`;
};

export function Panel({ title, meta, children, className = "", id }: { title: ReactNode; meta?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section className={`panel min-w-0 ${className}`} id={id}>
      <div className="panel-h"><h2 className="label">{title}</h2>{meta && <div className="text-[12px] text-muted">{meta}</div>}</div>
      <div className="p-[18px] pt-3.5">{children}</div>
    </section>
  );
}

/** Long hash: shows a short form, full value is selectable + copyable */
export function Hash({ value, n = 8, label }: { value?: string | null; n?: number; label?: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="text-faint">—</span>;
  return (
    <button type="button" className="tnum text-left hover:text-accent-2" title={value} aria-label={`${label ?? "hash"} ${value}, copy`}
      onClick={() => navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }).catch(() => {})}>
      {copied ? "copied" : short(value, n)}
    </button>
  );
}

export function StatusPill({ status }: { status: string }) {
  const cls: Record<string, string> = {
    completed: "text-good", verified: "text-good", confirmed: "text-accent-2", running: "text-accent", queued: "text-muted", pending: "text-muted",
    submitted: "text-accent", paused: "text-warn", failed: "text-bad", mismatch: "text-bad", cancelled: "text-muted", expired: "text-muted",
    not_committed: "text-faint", not_found: "text-warn", passed: "text-good", rejected: "text-bad", executed: "text-accent-2", active: "text-accent", dead: "text-bad",
  };
  return <span className={`pill ${cls[status] ?? "text-muted"}`}>{status === "running" || status === "submitted" ? <span className="dot dot-live" /> : null}{(status.charAt(0).toUpperCase() + status.slice(1)).replace(/_/g, " ")}</span>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line px-6 py-10 text-center">
      <div className="font-serif-d text-[20px] first-letter:uppercase">{title}</div>
      {children && <div className="mx-auto mt-2 max-w-[52ch] text-[13.5px] text-muted">{children}</div>}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as { message?: string; code?: string; requestId?: string };
  return (
    <div role="alert" className="rounded-xl border border-bad/40 bg-bad/5 px-4 py-2.5 text-[13px] text-bad">
      {e.message ?? String(error)}
      {e.requestId && <span className="ml-2 text-[11.5px] text-muted">req {short(e.requestId, 4)}</span>}
    </div>
  );
}

export function Skeleton({ h = 12, w = "100%" }: { h?: number; w?: number | string }) {
  return <div className="skeleton" style={{ height: h, width: w }} aria-hidden />;
}

/** horizontal bar strip of a vector — signed values around a centre line */
export function VectorBars({ values, height = 28, color = "var(--accent)", neg = "var(--neg)" }: { values: number[]; height?: number; color?: string; neg?: string }) {
  const max = Math.max(1e-9, ...values.map(Math.abs));
  return (
    <div className="flex items-center gap-px" style={{ height }} role="img" aria-label={`vector of ${values.length}: ${values.slice(0, 8).map((v) => v.toFixed(3)).join(", ")}${values.length > 8 ? "…" : ""}`}>
      {values.map((v, i) => (
        <div key={i} className="relative h-full flex-1" style={{ minWidth: 2 }} title={`[${i}] ${v}`}>
          <div className="absolute left-0 right-0 bg-line" style={{ top: "50%", height: 1 }} />
          <div className="absolute left-0 right-0 transition-all duration-500" style={{
            background: v >= 0 ? color : neg, opacity: 0.85,
            top: v >= 0 ? `${50 - (Math.abs(v) / max) * 50}%` : "50%", height: `${(Math.abs(v) / max) * 50}%`,
          }} />
        </div>
      ))}
    </div>
  );
}

/** page/section heading with a soft rise on first view (name kept for call-site compatibility) */
export function Scramble({ text, className = "", as: As = "span" }: { text: string; className?: string; as?: "span" | "h1" | "h2" | "h3" }) {
  return <As className={`rise ${className}`}>{text}</As>;
}

/** reveal-on-scroll wrapper: content stays readable before JS / at rest */
export function Reveal({ children, delay = 0, kind = "rise", className = "" }: { children: ReactNode; delay?: number; kind?: "rise" | "wipe"; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"idle" | "pending" | "shown">("idle");
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight * 0.9) return; // already in view at load: leave it static
    setState("pending");
    const io = new IntersectionObserver((es) => { if (es[0].isIntersecting) { setTimeout(() => setState("shown"), delay); io.disconnect(); } }, { rootMargin: "0px 0px -8% 0px" });
    io.observe(el);
    const fallback = setTimeout(() => setState("shown"), 4000);
    return () => { io.disconnect(); clearTimeout(fallback); };
  }, [delay]);
  return <div ref={ref} className={className} data-reveal={state === "idle" ? undefined : state} data-reveal-kind={kind}>{children}</div>;
}

export function Spinner({ label = "working" }: { label?: string }) {
  const [i, setI] = useState(0);
  useEffect(() => { const t = setInterval(() => setI((x) => (x + 1) % 4), 160); return () => clearInterval(t); }, []);
  return <span className="inline-flex items-center gap-2 text-[13px] text-muted" role="status"><span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-line border-t-accent-2" />{label.charAt(0).toUpperCase() + label.slice(1)}{".".repeat(i % 4)}</span>;
}
