"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { compileCommunity, forward, ACTIVATIONS, type CommunityNeuron, type CommunityPolicy } from "@neuron/engine";
import { api } from "@/lib/client/api";
import { useConfig, useSession, useSignedAction } from "@/lib/client/wallet";
import { seededInput } from "@/lib/client/specimens";
import { Specimen3D } from "./Specimen3D";
import { Empty, ErrorBox, Hash, Panel, Scramble, Spinner, StatusPill, VectorBars, ago, fmt, short } from "./ui";

interface State {
  name: string; policy: CommunityPolicy; current: number; neurons: CommunityNeuron[];
  version: { id: string; version: number; snapshot_hash: string; artifact_hash: string; model_id: string; neuron_count: number; change: { type: string; neuronId?: string; by?: string; modelVersion: number }; created_at: string };
  versions: { version: number; snapshot_hash: string; neuron_count: number; change: { type: string; neuronId?: string; by?: string }; created_at: string }[];
}

export function Community() {
  const [ver, setVer] = useState<number | null>(null);
  const q = useQuery({ queryKey: ["community", ver], queryFn: () => api<State>(`/api/community${ver ? `?version=${ver}` : ""}`) });
  const session = useSession();
  const me = session.data?.session?.wallet;
  const compiled = useMemo(() => (q.data ? compileCommunity(q.data.neurons, q.data.policy) : null), [q.data]);
  const [seed, setSeed] = useState("community-1");
  const [acts, setActs] = useState<number[][] | null>(null);
  const run = () => compiled && setActs(forward(compiled.model, seededInput(seed, compiled.model.config.inputDim)).a.map((v) => Array.from(v)));
  const mine = q.data?.neurons.filter((n) => n.owner === me) ?? [];
  const s = q.data;

  return (
    <div className="mx-auto max-w-[1440px] px-5 pt-14 sm:px-8">
      <Scramble as="h1" text="One network, many owners." className="display mt-2 block text-[clamp(44px,5.2vw,76px)]" />
      <p className="mt-2 max-w-[78ch] text-muted">Wallets register neurons into one shared feed-forward network. Each neuron owns its incoming weights (derived from its seed) and its bias, so nobody can change anyone else&apos;s parameters. Every approved change creates a new immutable version; experiments stay pinned to the version they ran on. More neurons make a bigger network, not a smarter one: growth here is not measured performance.</p>
      {q.error && <ErrorBox error={q.error} />}
      {!s ? <div className="mt-6"><Spinner label="compiling network" /></div> : (
        <>
          <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="panel relative min-h-[480px] overflow-hidden">
              {compiled && <Specimen3D model={compiled.model} activations={acts} className="absolute inset-0" framing={0.7} ariaLabel="Three-dimensional view of the community network" />}
              <div className="glass-chip absolute bottom-4 left-4 z-10 flex items-center gap-2 p-2">
                <input aria-label="Input seed" name="input-seed" autoComplete="off" spellCheck={false} className="field !w-[140px] tnum" value={seed} onChange={(e) => setSeed(e.target.value)} />
                <button className="act-ghost" onClick={run} data-testid="community-run">Run v{s.version.version}</button>
              </div>
            </div>
            <div className="panel flex flex-col gap-4 p-5 text-[13px]">
              <dl className="kv" data-testid="community-facts">
                <dt>version</dt><dd>v{s.version.version} {s.version.version === s.current ? <span className="text-good">current</span> : <button className="act" onClick={() => setVer(null)}>go to current v{s.current}</button>}</dd>
                <dt>snapshot</dt><dd><Hash value={s.version.snapshot_hash} /></dd>
                <dt>model</dt><dd><Link href={`/networks/${s.version.model_id}`}>{s.version.model_id}</Link> v{s.version.change.modelVersion}</dd>
                <dt>neurons</dt><dd className="tnum">{s.neurons.length} ({s.neurons.filter((n) => n.layer === 1).length} + {s.neurons.filter((n) => n.layer === 2).length} hidden)</dd>
                <dt>shape</dt><dd className="tnum">{compiled && [compiled.model.config.inputDim, ...compiled.model.config.hidden, compiled.model.config.outputDim].join("·")}</dd>
                <dt>change</dt><dd>{s.version.change.type}{s.version.change.neuronId ? ` · ${s.version.change.neuronId}` : ""}</dd>
              </dl>
              {acts && <div><div className="label mb-1">output (softmax)</div><VectorBars values={acts[acts.length - 1]} /></div>}
              <div>
                <div className="label mb-1">graph rules</div>
                <ul className="text-muted">
                  <li>— input {s.policy.inputDim} → L1 ({s.policy.layerActivations[0]}) → L2 ({s.policy.layerActivations[1]}) → output {s.policy.outputDim} softmax</li>
                  <li>— edges only point to the next layer: acyclic by construction</li>
                  <li>— max {s.policy.maxPerLayer} neurons per layer, 8 per wallet</li>
                  <li>— bias ∈ [−2, 2], weight scale ∈ (0, {s.policy.weightScaleMax}]</li>
                  <li>— layer functions change only through <Link href="/governance">governance</Link></li>
                </ul>
              </div>
            </div>
          </div>
          <div className="mt-6 grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-6">
              <Register />
              {mine.length > 0 && <Panel title={`your neurons · ${mine.length}`}>{mine.map((n) => <MyNeuron key={n.id} n={n} />)}</Panel>}
            </div>
            <div className="flex min-w-0 flex-col gap-6">
              <Panel title="version timeline" meta={`${s.versions.length} versions`}>
                <ol className="flex flex-col" data-testid="versions">
                  {s.versions.map((v) => (
                    <li key={v.version} className="grid grid-cols-[48px_minmax(0,1fr)_auto] items-baseline gap-3 border-t border-line py-1.5 text-[12.5px] first:border-t-0">
                      <button className={`act tnum ${v.version === s.version.version ? "!text-accent" : ""}`} onClick={() => setVer(v.version)}>v{v.version}</button>
                      <span className="truncate">{v.change.type}{v.change.neuronId ? ` ${v.change.neuronId}` : ""}{v.change.by ? <span className="text-muted"> by {short(v.change.by)}</span> : null} · {v.neuron_count} neurons</span>
                      <span className="text-faint">{ago(v.created_at)}</span>
                    </li>
                  ))}
                </ol>
              </Panel>
              <Panel title="registered neurons">
                {s.neurons.length === 0 ? <Empty title="empty" /> : (
                  <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-[12.5px] tnum">
                    <thead><tr className="text-left text-muted">{["id", "owner", "layer", "bias", "scale", "seed", "since"].map((h) => <th key={h} className="pr-3 font-normal">{h}</th>)}</tr></thead>
                    <tbody>{s.neurons.map((n) => (
                      <tr key={n.id} className={`border-t border-line ${n.owner === me ? "text-accent-2" : ""}`}>
                        <td className="py-1 pr-3">{n.id}</td><td className="pr-3">{n.owner === "protocol" ? "genesis" : short(n.owner)}</td><td className="pr-3">L{n.layer}</td>
                        <td className="pr-3">{fmt(n.bias, 3)}</td><td className="pr-3">{fmt(n.scale, 2)}</td><td className="max-w-[160px] truncate pr-3">{n.seed}</td><td className="text-faint">{n.owner === "protocol" ? "genesis" : ago(n.createdAt)}</td>
                      </tr>
                    ))}</tbody>
                  </table></div>
                )}
              </Panel>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function NeuronFields({ v, set }: { v: { layer: 1 | 2; bias: number; seed: string; scale: number }; set: (x: typeof v) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="flex flex-col gap-1"><span className="label !text-[11px]">layer</span>
        <select className="field" value={v.layer} onChange={(e) => set({ ...v, layer: Number(e.target.value) as 1 | 2 })}><option value={1}>L1 hidden</option><option value={2}>L2 hidden</option></select></label>
      <label className="flex flex-col gap-1"><span className="label !text-[11px]">bias [−2, 2]</span>
        <input className="field tnum" name="bias" inputMode="decimal" type="number" step={0.05} min={-2} max={2} value={v.bias} onChange={(e) => set({ ...v, bias: Number(e.target.value) })} /></label>
      <label className="flex flex-col gap-1"><span className="label !text-[11px]">weight seed</span>
        <input className="field tnum" name="weight-seed" autoComplete="off" spellCheck={false} maxLength={64} value={v.seed} onChange={(e) => set({ ...v, seed: e.target.value })} /></label>
      <label className="flex flex-col gap-1"><span className="label !text-[11px]">scale (0, 2]</span>
        <input className="field tnum" name="scale" inputMode="decimal" type="number" step={0.05} min={0.05} max={2} value={v.scale} onChange={(e) => set({ ...v, scale: Number(e.target.value) })} /></label>
    </div>
  );
}

function Register() {
  const session = useSession();
  const { data: cfg } = useConfig();
  const sign = useSignedAction();
  const qc = useQueryClient();
  const [v, setV] = useState<{ layer: 1 | 2; bias: number; seed: string; scale: number }>({ layer: 1, bias: 0, seed: `n-${Date.now().toString(36)}`, scale: 1 });
  const [err, setErr] = useState<unknown>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setErr(null); setOk(null); setBusy(true); setConfirm(false);
    try {
      const signed = await sign({ intent: "register-neuron", neuron: v });
      const r = await api<{ id: string; version: number; cost: number }>("/api/community/neurons", { method: "POST", json: { neuron: v, signed } });
      setOk(`Registered ${r.id} — network is now v${r.version}. ${r.cost} credits used.`);
      qc.invalidateQueries({ queryKey: ["community"] }); qc.invalidateQueries({ queryKey: ["session"] });
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  void ACTIVATIONS;
  return (
    <Panel title="register a neuron" meta={cfg ? `${cfg.registrationCredits} credits` : ""}>
      {!session.data?.session ? <p className="text-muted">Connect a wallet and sign in to register. Browsing and running the network need no wallet.</p> : (
        <div className="flex flex-col gap-3" data-testid="register-neuron">
          <NeuronFields v={v} set={setV} />
          {!confirm ? <button className="act-primary" disabled={busy} onClick={() => setConfirm(true)}>register…</button> : (
            <div className="rounded-xl border border-accent/60 p-3 text-[12.5px]" role="group" aria-label="Confirm registration">
              Registration consumes <b>{cfg?.registrationCredits} credits</b> and asks your wallet to sign a message binding exactly these parameters. No tokens move in this step.
              <div className="mt-2 flex gap-3"><button autoFocus className="act-primary" disabled={busy} onClick={submit} data-testid="confirm-register">Sign &amp; register</button><button className="act" onClick={() => setConfirm(false)}>Back</button></div>
            </div>
          )}
          {busy && <Spinner label="Waiting for signature" />}
          {ok && <p className="text-good" role="status">{ok}</p>}
          <ErrorBox error={err} />
        </div>
      )}
    </Panel>
  );
}

function MyNeuron({ n }: { n: CommunityNeuron }) {
  const sign = useSignedAction();
  const qc = useQueryClient();
  const [v, setV] = useState({ layer: n.layer, bias: n.bias, seed: n.seed, scale: n.scale });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState<"save" | "retire" | null>(null);
  const [confirmRetire, setConfirmRetire] = useState(false);
  const save = async () => {
    if (busy) return;
    setErr(null); setBusy("save");
    try {
      const signed = await sign({ intent: "update-neuron", neuron: v, neuronId: n.id });
      await api(`/api/community/neurons/${n.id}`, { method: "PATCH", json: { neuron: v, signed } });
      qc.invalidateQueries({ queryKey: ["community"] });
    } catch (e) { setErr(e); } finally { setBusy(null); }
  };
  const retire = async () => {
    if (busy) return;
    setErr(null); setBusy("retire"); setConfirmRetire(false);
    try { await api(`/api/community/neurons/${n.id}`, { method: "DELETE" }); qc.invalidateQueries({ queryKey: ["community"] }); } catch (e) { setErr(e); } finally { setBusy(null); }
  };
  return (
    <div className="mb-3 border-b border-line pb-3 last:mb-0 last:border-0 last:pb-0">
      <div className="mb-2 flex items-center justify-between"><span className="tnum">{n.id}</span><StatusPill status="active" /></div>
      <NeuronFields v={v} set={(x) => setV({ ...x, layer: n.layer })} />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button className="act" disabled={!!busy} aria-busy={busy === "save"} onClick={save}>{busy === "save" ? "Waiting for signature…" : "Sign & update"}</button>
        {confirmRetire
          ? <span className="inline-flex flex-wrap items-center gap-3" role="group" aria-label={`Confirm retiring ${n.id}`}><span className="text-warn">Retire {n.id}? The network gets a new version without it.</span><button autoFocus className="act text-bad" onClick={retire}>Retire neuron</button><button className="act" onClick={() => setConfirmRetire(false)}>Keep it</button></span>
          : <button className="act" disabled={!!busy} onClick={() => setConfirmRetire(true)}>{busy === "retire" ? "Retiring…" : "Retire"}</button>}
      </div>
      <ErrorBox error={err} />
    </div>
  );
}
