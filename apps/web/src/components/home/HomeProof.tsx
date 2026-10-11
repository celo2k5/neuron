"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { Reveal, Empty, ago } from "../ui";

interface Stats { models: number; trained_versions: number; experiments: number; verified: number; community_neurons: number; network_version: number }
interface Act { id: string; topic: string; ref_id: string; created_at: string }

const TOPIC: Record<string, string> = {
  "model.created": "Model generated", "experiment.queued": "Experiment queued", "experiment.completed": "Experiment completed", "experiment.failed": "Experiment failed",
  "training.queued": "Training queued", "training.running": "Training started", "training.progress": "Training progress", "training.checkpoint": "Checkpoint saved",
  "training.completed": "Training completed", "training.cancelled": "Training cancelled", "training.paused": "Training paused", "training.failed": "Training failed",
  "network.version": "Network version created", "payment.confirmed": "Payment verified", "payment.failed": "Payment rejected", "registry.indexed": "Commitment indexed",
  "auth.signed_in": "Wallet signed in", "governance.vote": "Vote cast", "governance.closed": "Vote closed", "governance.executed": "Proposal executed",
};

export function HomeProof() {
  const stats = useQuery({ queryKey: ["stats"], queryFn: () => api<Stats>("/api/stats"), refetchInterval: 30_000 });
  const act = useQuery({ queryKey: ["activity"], queryFn: () => api<{ items: Act[] }>("/api/activity?limit=10"), refetchInterval: 20_000 });
  const s = stats.data;
  const cells: [string, number | undefined, string][] = [
    ["Public models", s?.models, "/networks"], ["Trained versions", s?.trained_versions, "/networks?trained=yes"], ["Experiments run", s?.experiments, "/experiments"],
    ["Verified on Solana", s?.verified, "/ledger"], ["Community neurons", s?.community_neurons, "/community"], ["Network version", s?.network_version, "/community"],
  ];
  return (
    <section className="border-t border-line" aria-labelledby="proof-h">
      <div className="mx-auto grid max-w-[1440px] gap-16 px-5 py-28 sm:px-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:py-36">
        <div>
          <h2 id="proof-h" className="display text-[clamp(38px,4.4vw,64px)]">Hashes, not promises.</h2>
          <p className="mt-5 max-w-[44ch] text-[16px] text-muted">Every experiment pins an immutable model version and hashes its input and output. Commit that hash to Solana and anyone can recompute it.</p>
          <p className="mt-4 max-w-[44ch] text-[16px] text-muted">A matching record proves what was recorded and when. It does not prove the arithmetic; reproducing the run does that.</p>
          <Link href="/about#verification" className="act mt-7 inline-block">Read the trust model</Link>
        </div>
        <div className="grid gap-12">
          <Reveal>
            <dl className="grid grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-3">
              {cells.map(([k, v, href]) => (
                <Link key={k} href={href} className="group block no-underline">
                  <dd className="font-serif-d text-[56px] font-light leading-none tracking-[-0.03em] tabular-nums transition-colors group-hover:text-accent-2">{v === undefined ? "–" : v.toLocaleString()}</dd>
                  <dt className="mt-3 text-[13px] text-muted">{k}</dt>
                </Link>
              ))}
            </dl>
          </Reveal>
          <Reveal>
            <div className="panel p-6">
              <div className="flex items-baseline justify-between"><h3 className="text-[14px] font-medium">Server events</h3><span className="text-[12px] text-faint">live from the event log</span></div>
              {act.data?.items.length ? (
                <ul className="mt-4 divide-y divide-line">
                  {act.data.items.map((a) => (
                    <li key={a.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 py-2.5 text-[13px]">
                      <span className="truncate">{TOPIC[a.topic] ?? a.topic} <span className="tnum text-[12px] text-faint">{a.ref_id.slice(0, 14)}</span></span>
                      <span className="text-[12px] text-faint">{ago(a.created_at)}</span>
                    </li>
                  ))}
                </ul>
              ) : <div className="mt-4"><Empty title={act.isLoading ? "Loading events" : "No events yet"}>Events appear as people generate models, run experiments and commit results.</Empty></div>}
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
