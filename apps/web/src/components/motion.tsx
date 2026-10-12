"use client";
/**
 * Motion system (Framer Motion). One easing family, one spring, used everywhere:
 *  - EASE: long, soft deceleration for entrances
 *  - SPRING: snappy-but-damped for things that follow the pointer or selection
 * MotionConfig reducedMotion="user" turns transforms off for people who ask for less motion.
 */
import { animate, LayoutGroup, motion, useInView, useMotionValue, useReducedMotion, useTransform, type HTMLMotionProps } from "motion/react";
import { spring } from "@/lib/client/motion";
import { useEffect, useId, useRef, type ReactNode } from "react";

export const EASE = [0.16, 1, 0.3, 1] as const;
export const SPRING = spring.ui;

/** Headline that rises in word by word from behind a mask. */
export function SplitHeading({ text, className = "", as = "h1", id, delay = 0 }: { text: string; className?: string; as?: "h1" | "h2"; id?: string; delay?: number }) {
  const C = motion[as];
  const words = text.split(" ");
  return (
    <C id={id} className={className} aria-label={text} initial="hidden" whileInView="show" viewport={{ once: true }}
      variants={{ show: { transition: { staggerChildren: 0.07, delayChildren: delay } } }}>
      {words.map((w, i) => (
        <span key={i} aria-hidden className="inline-block overflow-hidden pb-[0.08em] align-bottom">
          <motion.span className="inline-block" variants={{ hidden: { y: "105%", rotate: 2 }, show: { y: "0%", rotate: 0, transition: { duration: 1.1, ease: EASE } } }}>
            {w}{i < words.length - 1 ? " " : ""}
          </motion.span>
        </span>
      ))}
    </C>
  );
}

/** Number that counts up the first time it scrolls into view. */
export function CountUp({ value, className = "" }: { value: number | undefined; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-10%" });
  const reduced = useReducedMotion();
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) => Math.round(v).toLocaleString());
  useEffect(() => {
    if (value === undefined || !inView) return;
    if (reduced) { mv.set(value); return; }
    const c = animate(mv, value, { duration: 1.6, ease: EASE });
    return () => c.stop();
  }, [value, inView, reduced, mv]);
  return <motion.span ref={ref} className={className}>{value === undefined ? "–" : text}</motion.span>;
}

/**
 * Segmented control: the selected state is a single pill that glides between options
 * (shared layout animation), so the eye follows what changed.
 */
export function Segmented<T extends string>({ options, value, onChange, label, size = "md", className = "" }: {
  options: { value: T; label: ReactNode; testId?: string }[]; value: T | null; onChange: (v: T) => void; label: string; size?: "sm" | "md"; className?: string;
}) {
  const id = useId();
  return (
    <LayoutGroup id={id}>
      <div role="group" aria-label={label} className={`inline-flex flex-wrap items-center gap-0.5 rounded-[11px] border border-fg/[0.08] bg-bg/50 p-[3px] shadow-[inset_0_1px_2px_rgba(0,0,0,.25)] ${className}`}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button key={o.value} type="button" aria-pressed={on} data-testid={o.testId} onClick={() => onChange(o.value)}
              className={`relative rounded-[8px] font-medium ${size === "sm" ? "h-[26px] px-2.5 text-[12.5px]" : "h-[30px] px-3 text-[13px]"} transition-colors duration-200 first-letter:uppercase ${on ? "text-fg" : "text-muted hover:text-fg"}`}>
              {on && <motion.span layoutId="seg-pill" transition={SPRING} className="absolute inset-0 rounded-[8px] border border-fg/[0.12] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--fg)_13%,var(--surface)),color-mix(in_srgb,var(--fg)_8%,var(--surface)))] shadow-[inset_0_1px_0_color-mix(in_srgb,var(--fg)_10%,transparent),0_1px_3px_rgba(0,0,0,.35)]" />}
              <span className="relative z-10 inline-block first-letter:uppercase">{o.label}</span>
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}

/** Card that lifts on hover with a spring and tracks a soft light under the pointer. */
export function LiftCard({ children, className = "", ...rest }: HTMLMotionProps<"article">) {
  const ref = useRef<HTMLElement>(null);
  const mx = useMotionValue(50), my = useMotionValue(50);
  const bg = useTransform([mx, my], ([x, y]) => `radial-gradient(420px circle at ${x}% ${y}%, color-mix(in srgb, var(--accent-2) 9%, transparent), transparent 60%)`);
  return (
    <motion.article ref={ref} whileHover={{ y: -4 }} transition={SPRING} className={`panel group relative overflow-hidden ${className}`}
      onPointerMove={(e) => { const r = ref.current!.getBoundingClientRect(); mx.set(((e.clientX - r.left) / r.width) * 100); my.set(((e.clientY - r.top) / r.height) * 100); }} {...rest}>
      <motion.span aria-hidden className="pointer-events-none absolute inset-0 z-[1] opacity-0 transition-opacity duration-500 group-hover:opacity-100" style={{ background: bg }} />
      {children as ReactNode}
    </motion.article>
  );
}

export { motion };
