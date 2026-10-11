"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { Reveal, Scramble, Empty, ago } from "../ui";

interface Stats { models: number; trained_versions: number; experiments: number; verified: number; community_neurons: number; network_version: number }
interface Act { id: string; topic: string; ref_id: string; created_at: string }

export function HomeProof() {
  const stats = useQuery({ queryKey: ["stats"], queryFn: () => api<Stats>("/api/stats"), refetchInterval: 30_000 });
  const act = useQuery({ queryKey: ["activity"], queryFn: () => api<{ items: Act[] }>("/api/activity?limit=14"), refetchInterval: 20_000 });
  const s = stats.data;
  const cells: [string, number | undefined, string][] = [
    ["public models", s?.models, "/networks"], ["trained versions", s?.trained_versions, "/networks?trained=yes"], ["experiments run", s?.experiments, "/experiments"],
    ["verified on-chain", s?.verified, "/ledger"], ["community neurons", s?.community_neurons, "/community"], ["network version", s?.network_version, "/community"],
  ];
  return (
    <section className="mx-auto max-w-[1600px] px-4 py-16" aria-labelledby="proof-h">
      <div className="grid gap-10 lg:grid-cols-[330px_1fr]">
        <div>
          <div className="label">§ 03 · the record</div>
          <Scramble as="h2" text="HASHES, NOT PROMISES" className="display mt-3 block text-[34px]" />
          <p className="mt-3 max-w-[38ch] text-muted">Every experiment pins an immutable model version and hashes its input and output. Commit that hash to Solana and anyone can recompute it. A matching commitment proves what was recorded and when. It does not prove the arithmetic was right; reproduce the run for that.</p>
          <Link href="/about#verification" className="act mt-4 inline-block">read the trust model</Link>
        </div>
        <div className="grid gap-8">
          <Reveal>
            <dl className="grid grid-cols-2 border-l border-t hair sm:grid-cols-3">
              {cells.map(([k, v, href]) => (
                <Link key={k} href={href} className="group border-b border-r hair p-4 no-underline">
                  <dt className="label">{k}</dt>
                  <dd className="display mt-2 text-[40px] tnum group-hover:text-accent">{v === undefined ? "··" : v.toLocaleString()}</dd>
                </Link>
              ))}
            </dl>
          </Reveal>
          <Reveal>
            <div className="label mb-2">latest server events</div>
            {act.data?.items.length ? (
              <ul className="divide-y divide-line border-y hair">
                {act.data.items.map((a) => (
                  <li key={a.id} className="grid grid-cols-[70px_minmax(0,1fr)_auto] gap-3 py-1.5 text-[11px]">
                    <span className="tnum text-faint">#{a.id}</span>
                    <span className="truncate"><span className="text-accent-2">{a.topic}</span> <span className="text-muted">{a.ref_id}</span></span>
                    <span className="text-faint">{ago(a.created_at)}</span>
                  </li>
                ))}
              </ul>
            ) : <Empty title={act.isLoading ? "loading events" : "no events yet"}>Events appear here as people generate models, run experiments and commit results. Nothing is simulated.</Empty>}
          </Reveal>
        </div>
      </div>
    </section>
  );
}
