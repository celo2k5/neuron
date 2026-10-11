"use client";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { DEV_WALLET, useNeuronWallet, useSession, useSignIn, useConfig } from "@/lib/client/wallet";
import { short } from "./ui";

export function WalletButton() {
  const w = useNeuronWallet();
  const { data: s } = useSession();
  const { data: cfg } = useConfig();
  const signIn = useSignIn();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const on = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", on);
    return () => document.removeEventListener("mousedown", on);
  }, []);
  const signedIn = s?.session && s.session.wallet === w.address;
  const run = async (fn: () => Promise<unknown>) => {
    setErr(null); setBusy(true);
    try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="relative" ref={ref}>
      <button className={signedIn ? "act-ghost tnum" : "act-primary"} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog" data-testid="wallet-button">
        {signedIn ? <><span className="dot text-good mr-1.5" />{short(w.address!)}</> : w.address ? "sign in" : <>connect<span className="hidden sm:inline"> wallet</span></>}
      </button>
      {open && (
        <div role="dialog" aria-label="Wallet" className="panel absolute right-0 top-[calc(100%+8px)] z-50 w-[320px] max-w-[calc(100vw-32px)] bg-bg p-3 shadow-[0_20px_60px_-20px_rgba(0,0,0,.6)]">
          {!w.address ? (
            <>
              <div className="label mb-2">choose a wallet</div>
              <ul className="flex flex-col gap-1">
                {w.available.length === 0 && <li className="text-muted">No Solana wallet detected in this browser. Install Phantom, Solflare or Backpack{cfg?.cluster === "localnet" ? "" : ""}.</li>}
                {w.available.map((a) => (
                  <li key={a.name}>
                    <button className="flex w-full items-center gap-2 border hair px-2 py-1.5 text-left hover:border-accent disabled:opacity-40" disabled={!a.ready || busy}
                      onClick={() => run(() => w.connect(a.name))} data-testid={a.name === DEV_WALLET ? "dev-wallet" : undefined}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- wallet icons are data: URIs from the wallet itself */}
                      {a.icon ? <img src={a.icon} alt="" width={16} height={16} /> : <span className="pill text-warn">dev</span>}
                      <span>{a.name}</span>
                      {!a.ready && <span className="ml-auto text-faint">not installed</span>}
                    </button>
                  </li>
                ))}
              </ul>
              {cfg?.cluster === "localnet" && <p className="mt-2 text-[10px] text-muted">The dev wallet is a burner key stored in this browser. It exists only on localnet for testing.</p>}
            </>
          ) : (
            <>
              <div className="flex items-baseline justify-between"><span className="label">{w.label}</span><span className="tnum text-muted">{short(w.address, 6)}</span></div>
              <div className="mt-2 break-all text-[10px] text-faint">{w.address}</div>
              {signedIn ? (
                <dl className="kv mt-3">
                  <dt>credits</dt><dd data-testid="credits-available">{s?.credits?.available ?? 0} available</dd>
                  <dt>reserved</dt><dd>{s?.credits?.reserved ?? 0}</dd>
                  <dt>cluster</dt><dd>{s?.session?.cluster}</dd>
                </dl>
              ) : (
                <div className="mt-3">
                  <p className="text-muted">Sign a one-time challenge to start a session. It costs nothing and moves no funds.</p>
                  <button className="act-primary mt-2" disabled={busy} onClick={() => run(signIn)} data-testid="sign-in">{busy ? "waiting for signature…" : "sign challenge"}</button>
                </div>
              )}
              {w.kind === "dev" && <DevTools address={w.address} />}
              <div className="mt-3 flex gap-4 border-t hair pt-2">
                {signedIn && <button className="act" onClick={() => run(async () => { await api("/api/auth/session", { method: "DELETE" }); await qc.invalidateQueries(); })}>sign out</button>}
                <button className="act" onClick={() => run(w.disconnect)}>disconnect</button>
              </div>
            </>
          )}
          {err && <p role="alert" className="mt-2 text-bad">{err}</p>}
        </div>
      )}
    </div>
  );
}

function DevTools({ address }: { address: string }) {
  const w = useNeuronWallet();
  const [msg, setMsg] = useState<string | null>(null);
  const [sol, setSol] = useState<number | null>(null);
  const refresh = async () => { if (w.connection) setSol((await w.connection.getBalance(new (await import("@solana/web3.js")).PublicKey(address))) / 1e9); };
  useEffect(() => { refresh().catch(() => {}); }, [address]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="mt-3 border-t hair pt-2">
      <div className="label">localnet tools</div>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <span className="tnum">{sol === null ? "…" : `${sol.toFixed(3)} SOL`}</span>
        <button className="act" onClick={async () => {
          try { const pk = new (await import("@solana/web3.js")).PublicKey(address); const sig = await w.connection!.requestAirdrop(pk, 2e9); await w.connection!.confirmTransaction(sig, "confirmed"); await refresh(); setMsg("airdropped 2 SOL"); }
          catch (e) { setMsg((e as Error).message); }
        }}>airdrop 2 sol</button>
        <button className="act" onClick={async () => {
          try { const r = await api<{ amount: string }>("/api/dev/faucet", { method: "POST", json: { wallet: address } }); setMsg(`minted ${r.amount} test $NEURON`); }
          catch (e) { setMsg((e as Error).message); }
        }}>mint test $NEURON</button>
      </div>
      {msg && <p className="mt-1 text-[10px] text-muted">{msg}</p>}
    </div>
  );
}
