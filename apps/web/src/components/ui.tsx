"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { spring } from "@/lib/client/motion";

export const short = (s: string, n = 4) => (s.length > n * 2 + 1 ? `${s.slice(0, n)}…${s.slice(-n)}` : s);
export const fmt = (v: number | null | undefined, d = 4) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(2) : v.toFixed(d));
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "narrow" });
/** relative time in either direction ("3 min. ago", "in 2 days"), localised */
export const ago = (iso: string) => {
  const s = (Date.parse(iso) - Date.now()) / 1000, a = Math.abs(s);
  return a < 60 ? rtf.format(Math.round(s), "second") : a < 3600 ? rtf.format(Math.round(s / 60), "minute") : a < 86400 ? rtf.format(Math.round(s / 3600), "hour") : rtf.format(Math.round(s / 86400), "day");
};
const nf = new Intl.NumberFormat();
/** whole counts with locale grouping (1,152) */
export const count = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : nf.format(n));
const dtf = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
/** a timestamp people read; the exact ISO value stays on the <time> element */
export function When({ iso }: { iso?: string | null }) {
  if (!iso) return <span className="text-faint">—</span>;
  return <time dateTime={iso} title={iso}>{dtf.format(new Date(iso))}</time>;
}

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
    <>
      <button type="button" className="tnum text-left hover:text-accent-2" title={value} aria-label={`Copy ${label ?? "hash"} ${value}`}
        onClick={() => navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }).catch(() => {})}>
        {copied ? "Copied" : short(value, n)}
      </button>
      <span className="sr-only" aria-live="polite">{copied ? "Copied to clipboard" : ""}</span>
    </>
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
          <div className="absolute left-0 right-0 transition-[top,height] duration-500" style={{
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

/**
 * Reveal on scroll (spring). Content already on screen at mount is left static, so the first
 * frame is complete; content below the fold rises in once, with a small per-item stagger.
 */
export function Reveal({ children, delay = 0, className = "" }: { children: ReactNode; delay?: number; kind?: "rise" | "wipe"; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const [below, setBelow] = useState(false);
  useEffect(() => { const r = ref.current?.getBoundingClientRect(); if (r && r.top > window.innerHeight * 0.92) setBelow(true); }, []);
  const animateIn = below && !reduce;
  return (
    <motion.div ref={ref} className={className}
      initial={false}
      animate={animateIn ? undefined : { opacity: 1, y: 0 }}
      whileInView={animateIn ? { opacity: 1, y: 0, filter: "blur(0px)", transition: { ...spring.soft, delay: delay / 1000 } } : undefined}
      style={animateIn ? { opacity: 0.25, y: 22, filter: "blur(6px)" } : undefined}
      viewport={{ once: true, margin: "0px 0px -8% 0px" }}>
      {children}
    </motion.div>
  );
}

export function Spinner({ label = "working" }: { label?: string }) {
  return <span className="inline-flex items-center gap-2 text-[13px] text-muted" role="status"><span aria-hidden className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-line border-t-accent-2" />{label.charAt(0).toUpperCase() + label.slice(1).replace(/\.*$/, "")}…</span>;
}

/**
 * Number input that lets people clear and retype: the text is local while editing, a valid
 * in-range value is committed as they type, and anything else is clamped on blur or Enter.
 */
export function NumberField({ value, min, max, step, onCommit, className = "field tnum", ...rest }: {
  value: number; min: number; max: number; step?: number; onCommit: (v: number) => void; className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "min" | "max" | "step" | "type">) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const settle = () => { const n = Number(text); const v = Number.isFinite(n) && text.trim() !== "" ? Math.max(min, Math.min(max, n)) : value; setText(String(v)); if (v !== value) onCommit(v); };
  return (
    <input {...rest} className={className} type="number" inputMode={step && step < 1 ? "decimal" : "numeric"} min={min} max={max} step={step} value={text} autoComplete="off"
      onChange={(e) => { setText(e.target.value); const n = Number(e.target.value); if (e.target.value.trim() !== "" && Number.isFinite(n) && n >= min && n <= max) onCommit(n); }}
      onBlur={settle} onKeyDown={(e) => { if (e.key === "Enter") settle(); rest.onKeyDown?.(e); }} />
  );
}

/** circular-arrows glyph for "new random seed" (drawn, not a unicode stand-in) */
export function ReseedIcon() {
  return (
    <svg aria-hidden width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13.5 6.5A5.5 5.5 0 0 0 3.2 4.6M2.5 9.5a5.5 5.5 0 0 0 10.3 1.9" /><path d="M3 2v2.8h2.8M13 14v-2.8h-2.8" />
    </svg>
  );
}
