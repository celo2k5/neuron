"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { useConfig } from "@/lib/client/wallet";
import { useStreamStatus } from "@/lib/client/events";
import { AnimatePresence, motion } from "motion/react";
import { spring, exit } from "@/lib/client/motion";
import { WalletButton } from "./WalletButton";
import { Glyph } from "./Glyph";
import { count } from "./ui";

export const NAV = [
  { href: "/lab", label: "Lab" },
  { href: "/networks", label: "Networks" },
  { href: "/generator", label: "Generator" },
  { href: "/experiments", label: "Experiments" },
  { href: "/community", label: "Community" },
  { href: "/ledger", label: "Ledger" },
  { href: "/token", label: "Token" },
  { href: "/governance", label: "Governance" },
  { href: "/about", label: "About" },
];

const CLUSTER_STYLE: Record<string, { label: string; cls: string; note: string }> = {
  localnet: { label: "Localnet", cls: "text-warn", note: "Local validator. Test tokens have no value." },
  devnet: { label: "Devnet", cls: "text-accent-2", note: "Devnet. Test tokens have no value." },
  "mainnet-beta": { label: "Mainnet", cls: "text-good", note: "Mainnet. Real funds." },
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
    <div className="hidden items-center gap-2.5 whitespace-nowrap text-[12px] md:flex" role="group" aria-label="Network status">
      <ClusterPill />
      <span className={`hidden items-center gap-1.5 2xl:flex ${rpcOk ? "text-muted" : "text-bad"}`} title={rpcOk ? `RPC latency ${data?.rpc.latencyMs} ms · event stream ${stream}` : "RPC unreachable"}>
        <span className={`dot ${rpcOk && stream === "live" ? "text-good dot-live" : rpcOk ? "text-warn" : "text-bad"}`} />
        <span className="tnum">{rpcOk ? `slot ${count(data?.rpc.slot)}` : data ? "RPC offline" : "…"}</span>
      </span>
    </div>
  );
}

export function Header() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const menuBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); menuBtn.current?.focus(); } };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [open]);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  const home = path === "/";
  return (
    <header className={`${home ? "fixed inset-x-0" : "sticky"} z-40 transition-[background-color,border-color] duration-500 ${scrolled || !home ? "border-b border-line bg-bg/70 backdrop-blur-xl" : "border-b border-transparent"}`} style={{ top: "env(safe-area-inset-top, 0px)" }}>
      <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-8 px-5 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5 no-underline" aria-label="NEURON home">
          <Glyph size={24} />
          <span className="font-serif-d text-[21px] font-normal tracking-[-0.01em]">Neuron</span>
        </Link>
        <nav aria-label="Primary" className="hidden flex-1 items-center gap-1 xl:flex">
          {NAV.map((n) => {
            const on = path === n.href || path.startsWith(n.href + "/");
            return (
              <Link key={n.href} href={n.href} aria-current={on ? "page" : undefined}
                className={`relative rounded-full px-3 py-1.5 text-[13.5px] no-underline transition-colors duration-200 ${on ? "text-fg" : "text-muted hover:text-fg"}`}>
                {on && <motion.span layoutId="nav-pill" transition={spring.ui} className="absolute inset-0 rounded-full bg-fg/[0.08] ring-1 ring-fg/[0.06]" />}
                <span className="relative">{n.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex min-w-0 items-center gap-4">
          <NetworkStatus />
          <WalletButton />
          <button ref={menuBtn} className="act min-h-11 xl:hidden" aria-expanded={open} aria-controls="mobile-nav" onClick={() => setOpen((o) => !o)}>{open ? "Close" : "Menu"}</button>
        </div>
      </div>
      <AnimatePresence>
      {open && (
        <motion.nav id="mobile-nav" aria-label="Mobile" className="origin-top border-t border-line bg-bg/95 px-5 py-4 backdrop-blur-xl xl:hidden"
          initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0, transition: spring.soft }} exit={{ opacity: 0, y: -6, transition: exit }}>
          <ul className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
            {NAV.map((n, i) => (
              <motion.li key={n.href} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0, transition: { ...spring.soft, delay: i * 0.03 } }}>
                <Link href={n.href} className="flex min-h-11 items-center text-[15px] no-underline">{n.label}</Link>
              </motion.li>
            ))}
          </ul>
          <div className="mt-4"><ClusterPill /></div>
        </motion.nav>
      )}
      </AnimatePresence>
    </header>
  );
}
