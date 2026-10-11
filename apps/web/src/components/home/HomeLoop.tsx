"use client";
import Link from "next/link";
import { useRef } from "react";
import { motion, useScroll, useSpring } from "motion/react";
import { Reveal } from "../ui";
import { SplitHeading } from "../motion";

const STEPS: [string, string, string][] = [
  ["Connect your wallet", "Sign a one-time challenge bound to this site. No funds move.", "/lab"],
  ["Generate a network", "A seed and a configuration become exact topology and weights.", "/generator"],
  ["Register a neuron", "Add your own node to the shared community network.", "/community"],
  ["Submit an input", "Type a vector, derive one from a seed, or pick a dataset sample.", "/lab"],
  ["Watch it compute", "Signals travel real edges, layer by layer, as the engine runs.", "/lab"],
  ["Train it", "Backpropagation with SGD or Adam, with immutable checkpoints.", "/lab"],
  ["Commit the result", "Hash the run and record it on Solana. Anyone can check it.", "/ledger"],
];

export function HomeLoop() {
  const list = useRef<HTMLOListElement>(null);
  const { scrollYProgress } = useScroll({ target: list, offset: ["start 75%", "end 55%"] });
  const draw = useSpring(scrollYProgress, { stiffness: 120, damping: 30 });
  return (
    <section className="mx-auto max-w-[1440px] px-5 py-28 sm:px-8 lg:py-36" aria-labelledby="loop-h">
      <div className="grid gap-14 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <SplitHeading as="h2" id="loop-h" text="From a wallet to a verified result." className="display text-[clamp(38px,4.4vw,64px)]" />
          <p className="mt-5 max-w-[42ch] text-[16px] text-muted">Seven steps, in order. Each one is a working part of the instrument.</p>
        </div>
        <ol ref={list} className="relative">
          <span className="absolute bottom-6 left-[19px] top-6 w-px bg-[linear-gradient(180deg,transparent,var(--line)_10%,var(--line)_90%,transparent)]" aria-hidden />
          <motion.span style={{ scaleY: draw }} className="absolute bottom-6 left-[19px] top-6 w-px origin-top bg-[linear-gradient(180deg,var(--accent-2),var(--accent))] shadow-[0_0_12px_var(--glow)]" aria-hidden />
          {STEPS.map(([t, d, href], i) => (
            <li key={t}>
              <Reveal delay={i * 50}>
                <Link href={href} className="group relative grid grid-cols-[40px_1fr] items-baseline gap-6 rounded-2xl px-0 py-6 no-underline">
                  <span className="relative z-10 flex h-10 w-10 items-center justify-center rounded-full border border-line bg-bg font-serif-d text-[17px] text-muted transition-colors duration-300 group-hover:border-accent group-hover:text-fg">{i + 1}</span>
                  <span className="border-b border-line pb-6 transition-colors group-hover:border-fg/20">
                    <span className="block text-[22px] font-serif-d tracking-[-0.01em] transition-colors group-hover:text-accent-2">{t}</span>
                    <span className="mt-1.5 block max-w-[52ch] text-[15px] text-muted">{d}</span>
                  </span>
                </Link>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
