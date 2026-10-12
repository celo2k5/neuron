"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ACTIVATIONS } from "@neuron/engine";
import { api } from "@/lib/client/api";
import { useSession, useSignedAction } from "@/lib/client/wallet";
import { Empty, ErrorBox, NumberField, Panel, StatusPill, ago, count, short, PageHeader } from "@/components/ui";

interface Proposal { id: string; kind: string; title: string; body: string; change: Record<string, unknown> | null; status: string; quorum: string; approval_bps: number; starts_at: string; ends_at: string; execute_after: string | null; author_wallet: string; tally: { for: string; against: string; abstain: string; total: string; voters: number } }
interface Gov { rules: { weighting: "wallet" | "token"; proposalThresholdBase: string; quorumBase: string; approvalBps: number; votingPeriodSec: number; executionDelaySec: number; snapshotRule: string }; items: Proposal[] }

export default function GovernancePage() {
  const q = useQuery({ queryKey: ["governance"], queryFn: () => api<Gov>("/api/governance") });
  const r = q.data?.rules;
  const byWallet = r?.weighting !== "token";
  return (
    <div className="mx-auto max-w-[1440px] px-5 pb-10 sm:px-8">
      <PageHeader title="Rules before votes.">Any signed-in wallet can make an advisory proposal or a bounded policy change to the community network, and vote with a signed message. Votes are counted on the server; nothing outside the whitelisted network parameters can be executed.</PageHeader>
      <div className="mt-6 grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel title="explicit rules">
            {r && (
              <dl className="kv text-[12.5px]" data-testid="gov-rules">
                <dt>weight</dt><dd>{r.snapshotRule}</dd>
                <dt>threshold</dt><dd className="tnum">{byWallet ? "any signed-in wallet (up to 2 open proposals)" : `${count(Number(r.proposalThresholdBase))} base units to propose`}</dd>
                <dt>quorum</dt><dd className="tnum">{byWallet ? `${count(Number(r.quorumBase))} voting wallets` : `${count(Number(r.quorumBase))} base units total`}</dd>
                <dt>approval</dt><dd className="tnum">{r.approvalBps / 100}% of for+against</dd>
                <dt>voting</dt><dd className="tnum">{(r.votingPeriodSec / 3600).toFixed(1)} h</dd>
                <dt>delay</dt><dd className="tnum">{(r.executionDelaySec / 3600).toFixed(1)} h before execution</dd>
                <dt>delegation</dt><dd>none (one wallet, one signed vote)</dd>
                <dt>executable</dt><dd>max neurons per layer (8–48); a hidden layer&apos;s activation</dd>
                <dt>never</dt><dd>funds, credits, other users&apos; parameters</dd>
              </dl>
            )}
            <p className="mt-2 text-[12px] text-faint">{byWallet ? "Each vote is a single-use message signed by your wallet and bound to the proposal and choice, so it can't be replayed or altered." : "Known limitation: weight is the balance at vote time, not a historical snapshot."}</p>
          </Panel>
          <NewProposal />
        </div>
        <Panel className="self-start" title="proposals">
          {q.error && <ErrorBox error={q.error} />}
          {!q.data?.items.length ? <Empty title="no proposals yet" /> : q.data.items.map((p) => <ProposalRow key={p.id} p={p} />)}
        </Panel>
      </div>
    </div>
  );
}

function ProposalRow({ p }: { p: Proposal }) {
  const sign = useSignedAction();
  const session = useSession();
  const qc = useQueryClient();
  const [err, setErr] = useState<unknown>(null);
  const t = p.tally; const fa = BigInt(t.for) + BigInt(t.against);
  const pct = fa > 0n ? Number((BigInt(t.for) * 10000n) / fa) / 100 : 0;
  const [voting, setVoting] = useState<string | null>(null);
  const vote = async (choice: "for" | "against" | "abstain") => {
    if (voting) return;
    setErr(null); setVoting(choice);
    try { const signed = await sign({ intent: "vote", proposalId: p.id, choice }); await api(`/api/governance/${p.id}/vote`, { method: "POST", json: { choice, signed } }); qc.invalidateQueries({ queryKey: ["governance"] }); }
    catch (e) { setErr(e); } finally { setVoting(null); }
  };
  return (
    <article className="border-t border-line py-3 first:border-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-2"><StatusPill status={p.status} /><span className="pill text-muted">{p.kind}</span><h3 className="text-[13px]">{p.title}</h3></div>
      <p className="mt-1 whitespace-pre-wrap text-muted">{p.body}</p>
      {p.change && <pre className="mt-1 overflow-x-auto text-[12px] text-accent-2">{JSON.stringify(p.change)}</pre>}
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line" role="meter" aria-label="Share of votes for" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><div className="h-1.5 origin-left rounded-full bg-good" style={{ transform: `scaleX(${pct / 100})` }} /></div>
      <div className="mt-1 flex flex-wrap gap-4 text-[12px] tnum text-muted"><span>for {count(Number(t.for))}</span><span>against {count(Number(t.against))}</span><span>abstain {count(Number(t.abstain))}</span><span>{t.voters} voters</span><span>quorum {count(Number(t.total))}/{count(Number(p.quorum))}</span><span>by {short(p.author_wallet)}</span><span>{Date.parse(p.ends_at) > Date.now() ? "ends" : "ended"} {ago(p.ends_at)}</span></div>
      {p.status === "active" && session.data?.session && <div className="mt-2 flex gap-3">{(["for", "against", "abstain"] as const).map((c) => <button key={c} className="act" disabled={!!voting} aria-busy={voting === c} onClick={() => vote(c)}>{voting === c ? "Waiting for signature…" : `Sign vote: ${c}`}</button>)}</div>}
      <ErrorBox error={err} />
    </article>
  );
}

function NewProposal() {
  const session = useSession();
  const qc = useQueryClient();
  const [kind, setKind] = useState<"advisory" | "policy">("advisory");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [ct, setCt] = useState<"set_max_per_layer" | "set_layer_activation">("set_max_per_layer");
  const [val, setVal] = useState(32);
  const [layer, setLayer] = useState<1 | 2>(1);
  const [act, setAct] = useState("tanh");
  const [err, setErr] = useState<unknown>(null);
  const [sending, setSending] = useState(false);
  if (!session.data?.session) return <Panel title="new proposal"><p className="text-muted">Sign in to propose.</p></Panel>;
  const submit = async () => {
    if (sending) return;
    setErr(null); setSending(true);
    try {
      const change = kind === "policy" ? (ct === "set_max_per_layer" ? { type: ct, value: val } : { type: ct, layer, activation: act }) : undefined;
      await api("/api/governance", { method: "POST", json: { kind, title, body, change } });
      setTitle(""); setBody(""); qc.invalidateQueries({ queryKey: ["governance"] });
    } catch (e) { setErr(e); } finally { setSending(false); }
  };
  return (
    <Panel title="new proposal">
      <div className="flex flex-col gap-2">
        <div className="flex gap-1">{(["advisory", "policy"] as const).map((k) => <button key={k} className="act-ghost" aria-pressed={kind === k} onClick={() => setKind(k)}>{k}</button>)}</div>
        <label className="flex flex-col gap-1"><span className="label">Title</span><input className="field" name="title" autoComplete="off" placeholder="Raise the per-layer cap to 40…" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} aria-describedby="title-hint" /></label>
        <label className="flex flex-col gap-1"><span className="label">What and why</span><textarea className="field min-h-[80px]" name="body" placeholder="What changes, and why it helps the network…" value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} /></label>
        {kind === "policy" && (
          <div className="flex flex-wrap gap-2">
            <select className="field !w-auto" value={ct} onChange={(e) => setCt(e.target.value as typeof ct)} aria-label="Change type"><option value="set_max_per_layer">max neurons per layer</option><option value="set_layer_activation">layer activation</option></select>
            {ct === "set_max_per_layer" ? <NumberField className="field tnum !w-[90px]" name="value" min={8} max={48} value={val} onCommit={setVal} aria-label="Value" /> : (
              <><select className="field !w-auto" value={layer} onChange={(e) => setLayer(Number(e.target.value) as 1 | 2)} aria-label="Layer"><option value={1}>L1</option><option value={2}>L2</option></select>
                <select className="field !w-auto" value={act} onChange={(e) => setAct(e.target.value)} aria-label="Activation">{ACTIVATIONS.map((a) => <option key={a}>{a}</option>)}</select></>
            )}
          </div>
        )}
        <p id="title-hint" className="text-[12px] text-muted">{title.trim().length < 4 ? "The title needs at least 4 characters." : `${title.length}/120`}</p>
        <button className="act-primary" disabled={title.trim().length < 4 || sending} aria-busy={sending} onClick={submit}>{sending ? "Submitting…" : "Submit proposal"}</button>
        <ErrorBox error={err} />
      </div>
    </Panel>
  );
}
