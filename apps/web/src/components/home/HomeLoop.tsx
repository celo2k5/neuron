import Link from "next/link";
import { Reveal, Scramble } from "../ui";

const STEPS = [
  ["connect wallet", "Sign a domain-bound challenge. No funds move.", "/lab"],
  ["create neuron", "Register a neuron into the shared network.", "/community"],
  ["generate network", "Seed + config → deterministic topology and weights.", "/generator"],
  ["configure connections", "Density, initialisation, residual skips.", "/generator"],
  ["submit input", "Manual, seeded or dataset vectors, validated.", "/lab"],
  ["execute", "Matrix–vector products, layer by layer.", "/lab"],
  ["visualise", "Pulses follow real edges in topological order.", "/lab"],
  ["save result", "Activations stored content-addressed; result hashed.", "/experiments"],
  ["verify", "Commit hashes to Solana; anyone can re-check.", "/ledger"],
];

export function HomeLoop() {
  return (
    <section className="mx-auto max-w-[1600px] px-4 py-16" aria-labelledby="loop-h">
      <div className="grid gap-6 lg:grid-cols-[330px_1fr]">
        <div>
          <div className="label">§ 01 · the loop</div>
          <Scramble as="h2" text="FROM WALLET TO VERIFIED RESULT" className="display mt-3 block text-[34px]" />
          <p className="mt-3 max-w-[36ch] text-muted">Nine steps, in order. Each one is a working part of the instrument, not a slide.</p>
        </div>
        <ol className="grid grid-cols-1 border-l border-t hair sm:grid-cols-3" id="loop-h">
          {STEPS.map(([t, d, href], i) => (
            <li key={t} className="border-b border-r hair">
              <Reveal delay={i * 60} kind="wipe">
                <Link href={href} className="group block h-full p-4 no-underline">
                  <div className="flex items-baseline justify-between">
                    <span className="display text-[30px] text-faint transition-colors group-hover:text-accent tnum">{String(i + 1).padStart(2, "0")}</span>
                    <span className="text-faint transition-transform group-hover:translate-x-1">→</span>
                  </div>
                  <div className="mt-3 text-[11px] uppercase tracking-[0.14em]">{t}</div>
                  <p className="mt-1 text-muted">{d}</p>
                </Link>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
