"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ACTIVATIONS } from "@neuron/engine";
import { api } from "@/lib/client/api";
import { useConfig, useSession, useSignedAction } from "@/lib/client/wallet";
import { Empty, ErrorBox, Panel, Scramble, StatusPill, ago, short } from "@/components/ui";

interface Proposal { id: string; kind: string; title: string; body: string; change: Record<string, unknown> | null; status: string; quorum: string; approval_bps: number; starts_at: string; ends_at: string; execute_after: string | null; author_wallet: string; tally: { for: string; against: string; abstain: string; total: string; voters: number } }
interface Gov { rules: { proposalThresholdBase: string; quorumBase: string; approvalBps: number; votingPeriodSec: number; executionDelaySec: number; snapshotRule: string }; items: Proposal[] }

export default function GovernancePage() {
  const q = useQuery({ queryKey: ["governance"], queryFn: () => api<Gov>("/api/governance") });
  const { data: cfg } = useConfig();
  const r = q.data?.rules;
  return (
    <div className="mx-auto max-w-[1440px] px-5 pt-14 sm:px-8">
      <Scramble as="h1" text="Rules before votes." className="display mt-2 block text-[clamp(44px,5.2vw,76px)]" />
      <p className="mt-2 max-w-[78ch] text-muted">Token holders can make advisory proposals or bounded policy changes to the community network. No vote can move treasury funds, and no off-chain vote executes anything outside the whitelisted network parameters.</p>
      {!cfg?.mint && <div className="mt-4 border border-warn/60 p-3 text-warn">Governance needs a configured $NEURON mint to read voting weight. It is disabled here.</div>}
      <div className="mt-6 grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel title="explicit rules">
            {r && (
              <dl className="kv text-[12.5px]" data-testid="gov-rules">
                <dt>weight</dt><dd>{r.snapshotRule}</dd>
                <dt>threshold</dt><dd className="tnum">{r.proposalThresholdBase} base units to propose</dd>
                <dt>quorum</dt><dd className="tnum">{r.quorumBase} base units total</dd>
                <dt>approval</dt><dd className="tnum">{r.approvalBps / 100}% of for+against</dd>
                <dt>voting</dt><dd className="tnum">{(r.votingPeriodSec / 3600).toFixed(1)} h</dd>
                <dt>delay</dt><dd className="tnum">{(r.executionDelaySec / 3600).toFixed(1)} h before execution</dd>
                <dt>delegation</dt><dd>none (one wallet, one signed vote)</dd>
                <dt>executable</dt><dd>max neurons per layer (8–48); a hidden layer&apos;s activation</dd>
                <dt>never</dt><dd>treasury transfers, other users&apos; parameters</dd>
              </dl>
            )}
            <p className="mt-2 text-[12px] text-faint">Known limitation: weight is the balance at vote time, not a historical snapshot. A balance-snapshot indexer would close this gap.</p>
          </Panel>
          <NewProposal />
        </div>
        <Panel title="proposals">
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
  const vote = async (choice: "for" | "against" | "abstain") => {
    setErr(null);
    try { const signed = await sign({ intent: "vote", proposalId: p.id, choice }); await api(`/api/governance/${p.id}/vote`, { method: "POST", json: { choice, signed } }); qc.invalidateQueries({ queryKey: ["governance"] }); }
    catch (e) { setErr(e); }
  };
  return (
    <article className="border-t border-line py-3 first:border-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-2"><StatusPill status={p.status} /><span className="pill text-muted">{p.kind}</span><h3 className="text-[13px]">{p.title}</h3></div>
      <p className="mt-1 whitespace-pre-wrap text-muted">{p.body}</p>
      {p.change && <pre className="mt-1 overflow-x-auto text-[12px] text-accent-2">{JSON.stringify(p.change)}</pre>}
      <div className="mt-2 h-1.5 w-full bg-line"><div className="h-1.5 bg-good" style={{ width: `${pct}%` }} /></div>
      <div className="mt-1 flex flex-wrap gap-4 text-[12px] tnum text-muted"><span>for {t.for}</span><span>against {t.against}</span><span>abstain {t.abstain}</span><span>{t.voters} voters</span><span>quorum {t.total}/{p.quorum}</span><span>by {short(p.author_wallet)}</span><span>ends {ago(p.ends_at).replace(" ago", "")}{Date.parse(p.ends_at) > Date.now() ? " from now" : " ago"}</span></div>
      {p.status === "active" && session.data?.session && <div className="mt-2 flex gap-3">{(["for", "against", "abstain"] as const).map((c) => <button key={c} className="act" onClick={() => vote(c)}>sign vote: {c}</button>)}</div>}
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
  if (!session.data?.session) return <Panel title="new proposal"><p className="text-muted">Sign in to propose.</p></Panel>;
  const submit = async () => {
    setErr(null);
    try {
      const change = kind === "policy" ? (ct === "set_max_per_layer" ? { type: ct, value: val } : { type: ct, layer, activation: act }) : undefined;
      await api("/api/governance", { method: "POST", json: { kind, title, body, change } });
      setTitle(""); setBody(""); qc.invalidateQueries({ queryKey: ["governance"] });
    } catch (e) { setErr(e); }
  };
  return (
    <Panel title="new proposal">
      <div className="flex flex-col gap-2">
        <div className="flex gap-1">{(["advisory", "policy"] as const).map((k) => <button key={k} className="act-ghost" aria-pressed={kind === k} onClick={() => setKind(k)}>{k}</button>)}</div>
        <input className="field" placeholder="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} aria-label="Title" />
        <textarea className="field min-h-[80px]" placeholder="what and why" value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} aria-label="Body" />
        {kind === "policy" && (
          <div className="flex flex-wrap gap-2">
            <select className="field !w-auto" value={ct} onChange={(e) => setCt(e.target.value as typeof ct)} aria-label="Change type"><option value="set_max_per_layer">max neurons per layer</option><option value="set_layer_activation">layer activation</option></select>
            {ct === "set_max_per_layer" ? <input className="field tnum !w-[80px]" type="number" min={8} max={48} value={val} onChange={(e) => setVal(Number(e.target.value))} aria-label="Value" /> : (
              <><select className="field !w-auto" value={layer} onChange={(e) => setLayer(Number(e.target.value) as 1 | 2)} aria-label="Layer"><option value={1}>L1</option><option value={2}>L2</option></select>
                <select className="field !w-auto" value={act} onChange={(e) => setAct(e.target.value)} aria-label="Activation">{ACTIVATIONS.map((a) => <option key={a}>{a}</option>)}</select></>
            )}
          </div>
        )}
        <button className="act-primary" disabled={title.length < 4} onClick={submit}>submit proposal</button>
        <ErrorBox error={err} />
      </div>
    </Panel>
  );
}
