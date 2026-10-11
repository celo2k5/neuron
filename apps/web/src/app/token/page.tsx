"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { useConfig, useNeuronWallet, useSession } from "@/lib/client/wallet";
import { explorerTx } from "@/components/ExperimentDetail";
import { Empty, ErrorBox, Panel, Scramble, Spinner, StatusPill, ago, short } from "@/components/ui";

interface Token { cluster: string; mint: string; decimals: number; tokenProgram: string; balance: { amount: string; uiAmount: string; ata: string } | null }
interface Intent { id: string; credits: number; amount: string; status: string; signature: string | null; failure_reason: string | null; created_at: string; expires_at: string }

const ui = (base: string, d: number) => { const b = BigInt(base), k = 10n ** BigInt(d); const f = (b % k).toString().padStart(d, "0").replace(/0+$/, ""); return `${b / k}${f ? "." + f : ""}`; };

export default function TokenPage() {
  const { data: cfg } = useConfig();
  const w = useNeuronWallet();
  const session = useSession();
  const qc = useQueryClient();
  const tok = useQuery({ queryKey: ["token", w.address], enabled: !!cfg?.mint, queryFn: () => api<Token>(`/api/token${w.address ? `?wallet=${w.address}` : ""}`) });
  const credits = useQuery({ queryKey: ["credits"], enabled: !!session.data?.session, queryFn: () => api<{ balance: { available: number; reserved: number; consumed: number; refunded: number }; events: { kind: string; amount: number; ref_type: string; ref_id: string; created_at: string }[] }>("/api/credits") });
  const intents = useQuery({ queryKey: ["payments"], enabled: !!session.data?.session, queryFn: () => api<{ items: Intent[] }>("/api/payments"), refetchInterval: (q) => (q.state.data?.items.some((i) => i.status === "submitted") ? 2000 : false) });
  const [n, setN] = useState(10);
  const [review, setReview] = useState<{ id: string; transaction: string; display: { amount: string; symbol: string; cluster: string }; credits: number; intent: { recipientOwner: string; mint: string; expiresAt: string } } | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const d = tok.data?.decimals ?? 6;
  const price = cfg ? ui(cfg.creditPriceBaseUnits, d) : "…";

  const createIntent = async () => {
    setErr(null); setBusy(true);
    try { const r = await api<{ intent: { id: string; recipientOwner: string; mint: string; expiresAt: string }; transaction: string; display: { amount: string; symbol: string; cluster: string }; credits: number }>("/api/payments", { method: "POST", json: { credits: n } }); setReview({ ...r, id: r.intent.id }); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const pay = async () => {
    if (!review) return;
    setErr(null); setBusy(true);
    try {
      const sig = await w.sendTransaction(review.transaction);
      await api(`/api/payments/${review.id}`, { method: "POST", json: { signature: sig } });
      setReview(null);
      await Promise.all([qc.invalidateQueries({ queryKey: ["payments"] }), qc.invalidateQueries({ queryKey: ["token"] })]);
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-[1440px] px-5 pt-14 sm:px-8">
      <Scramble as="h1" text="One token." className="display mt-2 block text-[clamp(44px,5.2vw,76px)]" />
      <p className="mt-2 max-w-[78ch] text-muted">Browsing and a daily allowance of experiments are free. $NEURON buys credits for persisted experiments beyond the free tier, training jobs and neuron registration. Holding tokens does not make any model more intelligent.</p>
      {cfg?.blockers.length ? <div className="mt-4 border border-warn/60 p-3 text-warn"><div className="label !text-warn">integration not configured</div><ul className="mt-1">{cfg.blockers.map((b) => <li key={b}>— {b}</li>)}</ul></div> : null}
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Panel title="mint (read from chain)">
          {!cfg?.mint ? <p className="text-muted">No mint configured.</p> : tok.isLoading ? <Spinner /> : tok.error ? <ErrorBox error={tok.error} /> : tok.data && (
            <dl className="kv text-[12.5px]" data-testid="token-info">
              <dt>cluster</dt><dd>{tok.data.cluster}{tok.data.cluster !== "mainnet-beta" && <span className="text-warn"> · test token</span>}</dd>
              <dt>mint</dt><dd className="break-all">{tok.data.mint}</dd>
              <dt>decimals</dt><dd>{tok.data.decimals}</dd>
              <dt>program</dt><dd className="break-all">{short(tok.data.tokenProgram, 6)}</dd>
              <dt>your balance</dt><dd className="tnum" data-testid="token-balance">{tok.data.balance ? `${tok.data.balance.uiAmount} $NEURON` : "connect a wallet"}</dd>
            </dl>
          )}
        </Panel>
        <Panel title="credits">
          {!session.data?.session ? <p className="text-muted">Sign in to see credits.</p> : credits.data && (
            <dl className="grid grid-cols-2 gap-3">
              {(["available", "reserved", "consumed", "refunded"] as const).map((k) => <div key={k}><dt className="label">{k}</dt><dd className="display text-[32px] tnum">{credits.data.balance[k]}</dd></div>)}
            </dl>
          )}
          <p className="mt-2 text-[12px] text-muted">Free daily: {cfg?.freeExperimentsPerDay} saved experiments, {cfg?.freeTrainingPerDay} training jobs ≤ {cfg?.freeTrainingMaxEpochs} epochs. Registration: {cfg?.registrationCredits} credits.</p>
        </Panel>
        <Panel title="buy credits" meta={`1 credit = ${price} $NEURON`}>
          {!session.data?.session ? <p className="text-muted">Sign in first.</p> : !review ? (
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2"><span className="label">credits</span><input className="field tnum !w-[100px]" type="number" min={1} max={10000} value={n} onChange={(e) => setN(Math.max(1, Math.min(10000, Number(e.target.value) || 1)))} /></label>
              <div className="tnum text-muted">total {cfg && tok.data ? ui((BigInt(cfg.creditPriceBaseUnits) * BigInt(n)).toString(), d) : "…"} $NEURON</div>
              <button className="act-primary" disabled={busy || !!cfg?.blockers.length} onClick={createIntent} data-testid="create-intent">review payment</button>
            </div>
          ) : (
            <div className="border border-accent/60 p-2 text-[12.5px]" role="alertdialog" aria-label="Review payment" data-testid="payment-review">
              <dl className="kv">
                <dt>you pay</dt><dd className="text-accent">{review.display.amount} {review.display.symbol}</dd>
                <dt>you get</dt><dd>{review.credits} credits</dd>
                <dt>to</dt><dd className="break-all">{short(review.intent.recipientOwner, 6)} (treasury)</dd>
                <dt>mint</dt><dd>{short(review.intent.mint, 6)}</dd>
                <dt>cluster</dt><dd>{review.display.cluster}</dd>
                <dt>expires</dt><dd>{new Date(review.intent.expiresAt).toLocaleTimeString()}</dd>
              </dl>
              <p className="mt-2 text-muted">Your wallet will show the exact transfer. Credits are issued only after the server independently verifies the confirmed transaction.</p>
              <div className="mt-2 flex gap-3"><button className="act-primary" disabled={busy} onClick={pay} data-testid="approve-payment">{busy ? "waiting for wallet…" : "approve in wallet"}</button><button className="act" onClick={() => setReview(null)}>cancel</button></div>
            </div>
          )}
          <ErrorBox error={err} />
        </Panel>
      </div>
      <Panel title="what $NEURON pays for" className="mt-6">
        <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-[12.5px] tnum" data-testid="utility-table">
          <thead><tr className="text-left text-muted"><th className="pr-3 font-normal">action</th><th className="pr-3 font-normal">free tier</th><th className="pr-3 font-normal">beyond it</th><th className="font-normal">settled</th></tr></thead>
          <tbody>
            <tr className="border-t border-line"><td className="py-1.5 pr-3">browse, inspect, run in browser</td><td className="pr-3">unlimited</td><td className="pr-3">—</td><td>never charged</td></tr>
            <tr className="border-t border-line"><td className="py-1.5 pr-3">saved experiment</td><td className="pr-3">{cfg?.freeExperimentsPerDay}/day per wallet</td><td className="pr-3">1 credit</td><td>reserved at queue, consumed on completion, released on failure</td></tr>
            <tr className="border-t border-line"><td className="py-1.5 pr-3">training job</td><td className="pr-3">{cfg?.freeTrainingPerDay}/day, ≤ {cfg?.freeTrainingMaxEpochs} epochs</td><td className="pr-3">⌈epochs × samples × params ÷ 2,000,000⌉ credits</td><td>pro-rata on cancel; unused credits released</td></tr>
            <tr className="border-t border-line"><td className="py-1.5 pr-3">community neuron registration</td><td className="pr-3">—</td><td className="pr-3">{cfg?.registrationCredits} credits</td><td>consumed when the network version is created</td></tr>
            <tr className="border-t border-line"><td className="py-1.5 pr-3">governance proposal / vote</td><td className="pr-3">—</td><td className="pr-3">needs a $NEURON balance; nothing is spent</td><td>weight = balance at vote</td></tr>
            <tr className="border-t border-line text-faint"><td className="py-1.5 pr-3">premium model storage</td><td className="pr-3" colSpan={3}>not built: every saved model and checkpoint is currently stored at no charge</td></tr>
          </tbody>
        </table></div>
      </Panel>
      {session.data?.session && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Panel title="payment intents">
            {!intents.data?.items.length ? <Empty title="no payments" /> : (
              <table className="w-full text-[12.5px] tnum" data-testid="intents">
                <tbody>{intents.data.items.map((i) => (
                  <tr key={i.id} className="border-t border-line first:border-0"><td className="py-1 pr-3">{i.id.slice(0, 12)}</td><td className="pr-3">{i.credits} cr</td><td className="pr-3">{ui(i.amount, d)}</td>
                    <td className="pr-3">{i.signature ? <a href={explorerTx(i.signature, cfg?.cluster ?? "", cfg?.rpc ?? "")} target="_blank" rel="noreferrer">{short(i.signature, 4)}</a> : "—"}</td>
                    <td><StatusPill status={i.status} />{i.failure_reason && <span className="ml-1 text-bad">{i.failure_reason}</span>}</td></tr>
                ))}</tbody>
              </table>
            )}
          </Panel>
          <Panel title="credit ledger">
            {!credits.data?.events.length ? <Empty title="no movements" /> : (
              <ul className="text-[12.5px] tnum">{credits.data.events.map((e, i) => (
                <li key={i} className="grid grid-cols-[80px_60px_1fr_auto] gap-2 border-t border-line py-1 first:border-0"><span>{e.kind}</span><span className={e.kind === "purchase" || e.kind === "release" ? "text-good" : ""}>{e.amount}</span><span className="truncate text-muted">{e.ref_type} {e.ref_id.slice(0, 10)}</span><span className="text-faint">{ago(e.created_at)}</span></li>
              ))}</ul>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}
