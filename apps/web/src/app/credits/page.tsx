"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { useConfig, useNeuronWallet, useSession } from "@/lib/client/wallet";
import { explorerTx } from "@/components/ExperimentDetail";
import { Empty, ErrorBox, NumberField, Panel, StatusPill, When, ago, count, short, PageHeader } from "@/components/ui";

interface Credits {
  balance: { available: number; reserved: number; consumed: number; refunded: number };
  events: { kind: string; amount: number; ref_type: string; ref_id: string; created_at: string }[];
  claimedToday: boolean; dailyClaim: number;
}
interface Token { cluster: string; mint: string; decimals: number; tokenProgram: string; balance: { amount: string; uiAmount: string; ata: string } | null }
interface Intent { id: string; credits: number; amount: string; status: string; signature: string | null; failure_reason: string | null; created_at: string; expires_at: string }

const grouped = new Intl.NumberFormat();
/** exact base-unit amount → display amount; integer part grouped (12,500.25), no float rounding */
const ui = (base: string, d: number) => { const b = BigInt(base), k = 10n ** BigInt(d); const f = (b % k).toString().padStart(d, "0").replace(/0+$/, ""); return `${grouped.format(b / k)}${f ? "." + f : ""}`; };
const nextUtcMidnight = () => { const d = new Date(); d.setUTCHours(24, 0, 0, 0); return d.toISOString(); };
const IN = ["claim", "grant", "purchase", "release", "refund"];

export default function CreditsPage() {
  const { data: cfg } = useConfig();
  const session = useSession();
  const qc = useQueryClient();
  const signedIn = !!session.data?.session;
  const credits = useQuery({ queryKey: ["credits"], enabled: signedIn, queryFn: () => api<Credits>("/api/credits") });
  const [err, setErr] = useState<unknown>(null);
  const [claiming, setClaiming] = useState(false);
  const [justClaimed, setJustClaimed] = useState<number | null>(null);

  const claim = async () => {
    setErr(null); setClaiming(true);
    try {
      const r = await api<{ claimed: boolean; amount: number }>("/api/credits", { method: "POST" });
      if (r.claimed) setJustClaimed(r.amount);
      await Promise.all([qc.invalidateQueries({ queryKey: ["credits"] }), qc.invalidateQueries({ queryKey: ["session"] })]);
    } catch (e) { setErr(e); } finally { setClaiming(false); }
  };

  const b = credits.data?.balance;
  return (
    <div className="mx-auto max-w-[1440px] px-5 pb-10 sm:px-8">
      <PageHeader title="Credits.">
        Browsing, inspecting and running models in your browser are always free. Saved experiments past the daily free tier, training jobs and community neuron registration use credits. Every signed-in wallet can claim {cfg?.dailyClaimCredits ?? "…"} free credits a day.
      </PageHeader>
      {cfg?.blockers.length ? <div className="mt-4 rounded-xl border border-warn/50 p-3 text-warn">{cfg.blockers.map((x) => <p key={x}>{x}</p>)}</div> : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Panel title="balance">
          {!signedIn ? <p className="text-muted">Connect a wallet and sign in to see your credits. Signing in costs nothing and moves no funds.</p> : (
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4" data-testid="credit-balance">
              {(["available", "reserved", "consumed", "refunded"] as const).map((k) => (
                <div key={k}><dt className="label capitalize">{k}</dt><dd className={`display mt-1 text-[34px] tnum ${k === "available" ? "" : "text-muted"}`} data-testid={`balance-${k}`}>{b ? count(b[k]) : "…"}</dd></div>
              ))}
            </dl>
          )}
          <p className="mt-4 text-[12.5px] text-muted">Free every day, before any credits are used: {cfg?.freeExperimentsPerDay} saved experiments and {cfg?.freeTrainingPerDay} training jobs of up to {cfg?.freeTrainingMaxEpochs} epochs.</p>
        </Panel>

        <Panel title="daily credits" meta={cfg ? `${cfg.dailyClaimCredits} per UTC day` : ""}>
          {!signedIn ? <p className="text-muted">Sign in to claim.</p> : credits.data?.claimedToday ? (
            <div data-testid="claimed">
              <div className="flex items-center gap-2"><StatusPill status="claimed" /><span>{justClaimed ? `+${justClaimed} credits added` : "Claimed today"}</span></div>
              <p className="mt-2 text-[12.5px] text-muted">Next claim opens <When iso={nextUtcMidnight()} />.</p>
            </div>
          ) : (
            <div className="flex flex-col items-start gap-3">
              <p className="text-muted">Claim today&apos;s {cfg?.dailyClaimCredits} credits. They are added to your balance immediately and don&apos;t expire.</p>
              <button className="act-primary" disabled={claiming || !credits.data} aria-busy={claiming} onClick={claim} data-testid="claim-credits">{claiming ? "Claiming…" : `Claim ${cfg?.dailyClaimCredits ?? ""} credits`}</button>
            </div>
          )}
          <ErrorBox error={err} />
        </Panel>
      </div>

      {cfg?.tokenEnabled && signedIn && <TokenPurchase />}

      <Panel title="what credits pay for" className="mt-6">
        <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-[12.5px] tnum" data-testid="utility-table">
          <thead><tr className="text-left text-muted"><th className="pr-3 font-normal">Action</th><th className="pr-3 font-normal">Free tier</th><th className="pr-3 font-normal">Beyond it</th><th className="font-normal">Settled</th></tr></thead>
          <tbody>
            <tr className="border-t border-line"><td className="py-2 pr-3">Browse, inspect, run in browser</td><td className="pr-3">Unlimited</td><td className="pr-3">—</td><td>Never charged</td></tr>
            <tr className="border-t border-line"><td className="py-2 pr-3">Saved experiment</td><td className="pr-3">{cfg?.freeExperimentsPerDay}/day per wallet</td><td className="pr-3">1 credit</td><td>Reserved when queued, consumed on completion, released on failure</td></tr>
            <tr className="border-t border-line"><td className="py-2 pr-3">Training job</td><td className="pr-3">{cfg?.freeTrainingPerDay}/day, ≤ {cfg?.freeTrainingMaxEpochs} epochs</td><td className="pr-3">⌈epochs × samples × params ÷ 2,000,000⌉</td><td>Pro-rata on cancel; unused credits released</td></tr>
            <tr className="border-t border-line"><td className="py-2 pr-3">Community neuron registration</td><td className="pr-3">—</td><td className="pr-3">{cfg?.registrationCredits} credits</td><td>Consumed when the network version is created</td></tr>
            <tr className="border-t border-line"><td className="py-2 pr-3">Recording in the registry</td><td className="pr-3">Always free</td><td className="pr-3">—</td><td>—</td></tr>
            <tr className="border-t border-line"><td className="py-2 pr-3">Governance proposal or vote</td><td className="pr-3">Always free</td><td className="pr-3">—</td><td>One signed vote per wallet</td></tr>
          </tbody>
        </table></div>
      </Panel>

      {signedIn && (
        <Panel title="credit history" className="mt-6">
          {!credits.data?.events.length ? <Empty title="no movements yet">Claim today&apos;s credits to start.</Empty> : (
            <ul className="text-[12.5px] tnum" data-testid="credit-history">{credits.data.events.map((e, i) => (
              <li key={i} className="grid grid-cols-[90px_64px_1fr_auto] gap-3 border-t border-line py-1.5 first:border-0">
                <span className="capitalize">{e.kind}</span><span className={IN.includes(e.kind) ? "text-good" : "text-muted"}>{IN.includes(e.kind) ? "+" : "−"}{e.amount}</span>
                <span className="truncate text-muted">{e.ref_type === "daily" ? "daily claim" : `${e.ref_type} ${e.ref_id.slice(0, 10)}`}</span><span className="text-faint">{ago(e.created_at)}</span>
              </li>
            ))}</ul>
          )}
        </Panel>
      )}
    </div>
  );
}

/** Optional: only shown when a $NEURON mint and treasury are configured on the server. */
function TokenPurchase() {
  const { data: cfg } = useConfig();
  const w = useNeuronWallet();
  const qc = useQueryClient();
  const tok = useQuery({ queryKey: ["token", w.address], queryFn: () => api<Token>(`/api/token${w.address ? `?wallet=${w.address}` : ""}`) });
  const intents = useQuery({ queryKey: ["payments"], queryFn: () => api<{ items: Intent[] }>("/api/payments"), refetchInterval: (q) => (q.state.data?.items.some((i) => i.status === "submitted") ? 2000 : false) });
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
    <div className="mt-6 grid gap-6 lg:grid-cols-2">
      <Panel title="buy credits with $NEURON" meta={`1 credit = ${price} $NEURON`}>
        <p className="mb-3 text-[12.5px] text-muted">Balance: <span className="tnum text-fg">{tok.data?.balance ? `${tok.data.balance.uiAmount} $NEURON` : "connect a wallet"}</span></p>
        {!review ? (
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2"><span className="label">Credits</span><NumberField name="credits" className="field tnum !w-[110px]" min={1} max={10000} value={n} onCommit={setN} /></label>
            <div className="tnum text-muted">Total {cfg && tok.data ? ui((BigInt(cfg.creditPriceBaseUnits) * BigInt(n)).toString(), d) : "…"} $NEURON</div>
            <button className="act-primary self-start" disabled={busy} aria-busy={busy} onClick={createIntent} data-testid="create-intent">{busy ? "Preparing…" : "Review payment"}</button>
          </div>
        ) : (
          <div className="rounded-xl border border-accent/60 p-3 text-[12.5px]" role="group" aria-label="Review payment" data-testid="payment-review">
            <dl className="kv">
              <dt>you pay</dt><dd className="text-accent">{review.display.amount} {review.display.symbol}</dd>
              <dt>you get</dt><dd>{review.credits} credits</dd>
              <dt>to</dt><dd className="break-all">{short(review.intent.recipientOwner, 6)} (treasury)</dd>
              <dt>expires</dt><dd><When iso={review.intent.expiresAt} /></dd>
            </dl>
            <div className="mt-3 flex gap-3"><button autoFocus className="act-primary" disabled={busy} aria-busy={busy} onClick={pay} data-testid="approve-payment">{busy ? "Waiting for wallet…" : "Approve in wallet"}</button><button className="act" disabled={busy} onClick={() => setReview(null)}>Cancel</button></div>
          </div>
        )}
        <ErrorBox error={err} />
      </Panel>
      <Panel title="payments">
        {!intents.data?.items.length ? <Empty title="no payments" /> : (
          <table className="w-full text-[12.5px] tnum" data-testid="intents"><tbody>{intents.data.items.map((i) => (
            <tr key={i.id} className="border-t border-line first:border-0"><td className="py-1 pr-3">{i.credits} cr</td><td className="pr-3">{ui(i.amount, d)}</td>
              <td className="pr-3">{i.signature ? <a href={explorerTx(i.signature, cfg?.cluster ?? "", cfg?.rpc ?? "")} target="_blank" rel="noreferrer">{short(i.signature, 4)}</a> : "—"}</td>
              <td><StatusPill status={i.status} />{i.failure_reason && <span className="ml-1 text-bad">{i.failure_reason}</span>}</td></tr>
          ))}</tbody></table>
        )}
      </Panel>
    </div>
  );
}
