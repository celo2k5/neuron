"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { useConfig } from "@/lib/client/wallet";
import { useStreamStatus } from "@/lib/client/events";
import { WalletButton } from "./WalletButton";
import { Glyph } from "./Glyph";

export const NAV = [
  { href: "/lab", label: "LAB" },
  { href: "/networks", label: "NETWORKS" },
  { href: "/generator", label: "GENERATOR" },
  { href: "/experiments", label: "EXPERIMENTS" },
  { href: "/community", label: "COMMUNITY" },
  { href: "/ledger", label: "LEDGER" },
  { href: "/token", label: "TOKEN" },
  { href: "/governance", label: "GOVERNANCE" },
  { href: "/about", label: "ABOUT" },
];

const CLUSTER_STYLE: Record<string, { label: string; cls: string; note: string }> = {
  localnet: { label: "LOCALNET", cls: "text-warn", note: "local validator · test tokens have no value" },
  devnet: { label: "DEVNET", cls: "text-accent-2", note: "devnet · test tokens have no value" },
  "mainnet-beta": { label: "MAINNET", cls: "text-good", note: "mainnet · real funds" },
};

export function ClusterPill() {
  const { data: cfg } = useConfig();
  const c = CLUSTER_STYLE[cfg?.cluster ?? ""] ?? { label: "…", cls: "text-muted", note: "" };
  return <span className={`pill ${c.cls}`} title={c.note}>{c.label}</span>;
}

function NetworkStatus() {
  const stream = useStreamStatus();
  const { data } = useQuery({ queryKey: ["ready"], queryFn: () => api<{ ok: boolean; rpc: { ok: boolean; slot?: number; latencyMs: number } }>("/api/ready"), refetchInterval: 15_000 });
  const rpcOk = data?.rpc.ok;
  return (
    <div className="hidden items-center gap-3 whitespace-nowrap 2xl:flex" aria-label="Network status">
      <span className={`flex items-center gap-1.5 tnum ${rpcOk ? "text-fg" : "text-bad"}`} title={rpcOk ? `RPC latency ${data?.rpc.latencyMs} ms` : "RPC unreachable"}>
        <span className={`dot ${rpcOk ? "text-good dot-live" : "text-bad"}`} />
        {rpcOk ? `slot ${data?.rpc.slot?.toLocaleString()}` : data ? "rpc down" : "rpc …"}
      </span>
      <span className={`label ${stream === "live" ? "text-good" : "text-muted"}`} title="Server event stream">{stream === "live" ? "live" : stream}</span>
    </div>
  );
}

export function Header() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState(0);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    const on = () => { const h = document.documentElement; setProgress(h.scrollTop / Math.max(1, h.scrollHeight - h.clientHeight)); };
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, [path]);
  const { data: cfg } = useConfig();
  return (
    <header className="sticky z-40 border-b hair bg-bg/90 backdrop-blur-[2px]" style={{ top: "env(safe-area-inset-top, 0px)" }}>
      {cfg && cfg.cluster !== "mainnet-beta" && (
        <div className="truncate border-b hair px-4 py-0.5 text-center label !text-[9px]">
          <span className={CLUSTER_STYLE[cfg.cluster]?.cls}>{CLUSTER_STYLE[cfg.cluster]?.label}</span> · {CLUSTER_STYLE[cfg.cluster]?.note}
        </div>
      )}
      <div className="mx-auto flex h-12 max-w-[1600px] items-center gap-3 px-4 sm:gap-6">
        <Link href="/" className="group flex items-center gap-2.5 no-underline" aria-label="NEURON home">
          <Glyph />
          <span className="leading-none">
            <span className="display block text-[22px] tracking-[0.06em]">NEURON</span>
            <span className="hidden whitespace-nowrap text-[9px] text-muted sm:block">collective neural computation on solana</span>
          </span>
        </Link>
        <nav aria-label="Primary" className="hidden flex-1 items-center gap-3.5 xl:flex">
          {NAV.map((n, i) => {
            const on = path === n.href || path.startsWith(n.href + "/");
            return (
              <Link key={n.href} href={n.href} aria-current={on ? "page" : undefined}
                className={`relative py-1 text-[10.5px] tracking-[0.14em] no-underline transition-colors ${on ? "text-fg" : "text-muted hover:text-fg"}`}>
                <span className="mr-1 text-[9px] text-faint tnum">{String(i + 1).padStart(2, "0")}</span>{n.label}
                <span className={`absolute -bottom-[13px] left-0 h-px bg-accent transition-all duration-500 ${on ? "w-full" : "w-0"}`} />
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex min-w-0 items-center gap-3 sm:gap-4">
          <NetworkStatus />
          <WalletButton />
          <button className="act xl:hidden" aria-expanded={open} aria-controls="mobile-nav" onClick={() => setOpen((o) => !o)}>{open ? "close" : "menu"}</button>
        </div>
      </div>
      <div className="h-px bg-accent transition-[width] duration-150" style={{ width: `${progress * 100}%` }} aria-hidden />
      {open && (
        <nav id="mobile-nav" aria-label="Mobile" className="border-t hair bg-bg px-4 py-3 xl:hidden">
          <ul className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
            {NAV.map((n, i) => (
              <li key={n.href}><Link href={n.href} className="no-underline"><span className="mr-1 text-faint">{String(i + 1).padStart(2, "0")}</span>{n.label}</Link></li>
            ))}
          </ul>
          <div className="mt-3 lg:hidden"><ClusterPill /></div>
        </nav>
      )}
    </header>
  );
}
