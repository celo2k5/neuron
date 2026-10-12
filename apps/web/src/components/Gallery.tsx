"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useInfiniteQuery } from "@tanstack/react-query";
import { forward, generateModel, type Model, type VisualForm } from "@neuron/engine";
import { api } from "@/lib/client/api";
import { useModelArtifact, type ModelRow } from "@/lib/client/hooks";
import { useSession } from "@/lib/client/wallet";
import { seededInput } from "@/lib/client/specimens";
import { GraphCanvas } from "./GraphCanvas";
import { LiftCard } from "./motion";
import { AnimatePresence, motion } from "motion/react";
import { spring, exit } from "@/lib/client/motion";
import { Empty, ErrorBox, Hash, Reveal, Skeleton, ago, count, fmt, short, PageHeader } from "./ui";

export function Gallery() {
  const sp = useSearchParams();
  const session = useSession();
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [arch, setArch] = useState("");
  const [trained, setTrained] = useState(sp.get("trained") ?? "");
  const [mine, setMine] = useState(false);
  const [sort, setSort] = useState("newest");
  const [compare, setCompare] = useState<ModelRow[]>([]);
  useEffect(() => { const t = setTimeout(() => setDq(q), 250); return () => clearTimeout(t); }, [q]);
  const params = useMemo(() => {
    const p = new URLSearchParams({ sort, limit: "12" });
    if (dq) p.set("q", dq); if (arch) p.set("architecture", arch); if (trained) p.set("trained", trained);
    if (mine && session.data?.session) p.set("owner", session.data.session.wallet);
    return p;
  }, [dq, arch, trained, mine, sort, session.data]);
  const list = useInfiniteQuery({
    queryKey: ["models", params.toString()],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api<{ items: ModelRow[]; nextCursor: string | null }>(`/api/models?${params}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`),
    getNextPageParam: (l) => l.nextCursor,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const toggle = (m: ModelRow) => setCompare((c) => (c.find((x) => x.id === m.id) ? c.filter((x) => x.id !== m.id) : [...c, m].slice(-2)));

  return (
    <div className="mx-auto max-w-[1440px] px-5 pb-10 sm:px-8">
      <PageHeader title="The public gallery." actions={<Link href="/generator" className="act-primary no-underline">Generate a model</Link>}>
        Every saved network, drawn live from its own artifact. Hover a card to run it once; tick two to compare them side by side.
      </PageHeader>
      <div className="panel sticky z-20 mt-8 flex flex-wrap items-end gap-3 !bg-bg/80 p-3 backdrop-blur-xl" style={{ top: "calc(env(safe-area-inset-top, 0px) + 76px)" }} role="search">
        <label className="flex min-w-[200px] flex-1 flex-col gap-1"><span className="label !text-[11px]">search name, seed or id</span><input className="field" type="search" name="q" autoComplete="off" spellCheck={false} value={q} onChange={(e) => setQ(e.target.value)} placeholder="specimen, genesis-010…" /></label>
        <label className="flex flex-col gap-1"><span className="label !text-[11px]">architecture</span>
          <select className="field" value={arch} onChange={(e) => setArch(e.target.value)}><option value="">all</option><option>feedforward</option><option>sparse</option><option>residual</option></select></label>
        <label className="flex flex-col gap-1"><span className="label !text-[11px]">training</span>
          <select className="field" value={trained} onChange={(e) => setTrained(e.target.value)}><option value="">any</option><option value="yes">trained</option><option value="no">untrained</option></select></label>
        <label className="flex flex-col gap-1"><span className="label !text-[11px]">sort</span>
          <select className="field" value={sort} onChange={(e) => setSort(e.target.value)}><option value="newest">newest</option><option value="oldest">oldest</option><option value="params">most parameters</option><option value="neurons">most neurons</option></select></label>
        <label className="flex items-center gap-2 pb-1.5 text-[12.5px]"><input type="checkbox" checked={mine} disabled={!session.data?.session} onChange={(e) => setMine(e.target.checked)} /> mine only</label>
      </div>
      {list.error && <ErrorBox error={list.error} />}
      <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4" data-testid="gallery">
        {list.isLoading && Array.from({ length: 8 }, (_, i) => <div key={i} className="panel p-3"><Skeleton h={180} /><div className="mt-2"><Skeleton h={10} w="60%" /></div></div>)}
        {items.map((m, i) => <Card key={m.id} m={m} i={i} selected={!!compare.find((c) => c.id === m.id)} onCompare={() => toggle(m)} />)}
      </div>
      {!list.isLoading && items.length === 0 && <Empty title="no models match">Try clearing filters, or generate the first one.</Empty>}
      <div className="mt-4 flex items-center justify-between text-[12.5px] text-muted">
        <span className="tnum">{items.length} shown{list.hasNextPage ? " · more available" : ""}</span>
        {list.hasNextPage && <button className="act" disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>{list.isFetchingNextPage ? "loading…" : "load next page"}</button>}
      </div>
      <AnimatePresence>{compare.length > 0 && <Compare models={compare} onClose={() => setCompare([])} />}</AnimatePresence>
    </div>
  );
}

function Card({ m, i, selected, onCompare }: { m: ModelRow; i: number; selected: boolean; onCompare: () => void }) {
  // thumbnails come from the real graph: v1 regenerated from config, or the latest trained artifact
  const v1 = useMemo(() => generateModel(m.config), [m.config]);
  const latest = useModelArtifact(m.trained ? m.id : null, m.trained ? m.latest_version : null);
  const model = latest.data ?? v1;
  const [acts, setActs] = useState<number[][] | null>(null);
  return (
    <Reveal delay={(i % 4) * 60}>
      <LiftCard className={selected ? "ring-1 ring-accent" : ""} onMouseEnter={() => setActs(forward(model, seededInput(m.seed, m.config.inputDim)).a.map((v) => Array.from(v)))} onFocus={() => setActs((a) => a ?? forward(model, seededInput(m.seed, m.config.inputDim)).a.map((v) => Array.from(v)))}>
        <Link href={`/networks/${m.id}`} className="block no-underline" aria-label={`${m.name}, ${m.architecture}`}>
          <GraphCanvas model={model} form={m.presentation.form as VisualForm} palette={m.presentation.palette} activations={acts} interactive={false} labels={false} className="h-[220px]" edgeBudget={600} />
        </Link>
        <div className="border-t border-line px-4 py-3.5">
          <div className="flex items-start justify-between gap-2">
            <Link href={`/networks/${m.id}`} className="truncate font-serif-d text-[19px] no-underline">{m.name}</Link>
            {m.trained ? <span className="pill text-good">trained</span> : <span className="pill text-faint">untrained</span>}
          </div>
          <div className="mt-1 tnum text-[11.5px] text-muted">{m.architecture} · {[m.config.inputDim, ...m.config.hidden, m.config.outputDim].join("·")} · {count(m.param_count)} params</div>
          <div className="mt-1 flex items-center justify-between text-[11.5px] text-faint">
            <span>{m.owner_wallet ? short(m.owner_wallet) : "anon"} · {ago(m.created_at)} · v{m.latest_version}</span>
            <label className="flex items-center gap-1 text-muted"><input type="checkbox" checked={selected} onChange={onCompare} aria-label={`Compare ${m.name}`} /> Compare</label>
          </div>
        </div>
      </LiftCard>
    </Reveal>
  );
}

function Compare({ models, onClose }: { models: ModelRow[]; onClose: () => void }) {
  const ms: Model[] = models.map((m) => generateModel(m.config));
  const sameDim = ms.length === 2 && ms[0].config.inputDim === ms[1].config.inputDim;
  const input = sameDim ? seededInput("compare", ms[0].config.inputDim) : null;
  const rows: [string, (m: ModelRow, x: Model) => React.ReactNode][] = [
    ["id", (m) => m.id], ["architecture", (m) => m.architecture], ["shape", (m) => [m.config.inputDim, ...m.config.hidden, m.config.outputDim].join("·")],
    ["activations", (m) => `${m.config.activations.join(",")} → ${m.config.outputActivation}`], ["init", (m) => m.config.init], ["density", (m) => m.config.density],
    ["neurons", (m) => m.neuron_count], ["edges", (m) => m.edge_count], ["params", (m) => m.param_count], ["versions", (m) => m.latest_version],
    ["config hash", (m) => <Hash value={m.config_hash} />], ["v1 output", (_m, x) => (input ? `[${forward(x, input).output.map((v) => fmt(v, 3)).join(", ")}]` : "inputs differ")],
  ];
  return (
    <motion.div initial={{ y: "100%" }} animate={{ y: 0, transition: spring.soft }} exit={{ y: "100%", transition: exit }} className="fixed inset-x-0 bottom-0 z-30 max-h-[60svh] overflow-y-auto overscroll-contain border-t border-accent/40 bg-bg/90 p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] backdrop-blur-xl shadow-[0_-20px_60px_-30px_rgba(0,0,0,.7)]" role="region" aria-label="Model comparison">
      <div className="mx-auto max-w-[1100px]">
        <div className="flex items-center justify-between"><span className="label">compare {models.length === 1 ? "· pick one more" : ""}</span><button className="act" onClick={onClose}>Close</button></div>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-[12.5px] tnum">
            <tbody>{rows.map(([k, f]) => (
              <tr key={k} className="border-t border-line"><th className="w-[120px] py-1 pr-3 text-left font-normal text-muted">{k}</th>
                {models.map((m, i) => { const v = f(m, ms[i]); const diff = models.length === 2 && String(f(models[0], ms[0])) !== String(f(models[1], ms[1])); return <td key={m.id} className={`py-1 pr-3 ${diff && typeof v !== "object" ? "text-accent-2" : ""}`}>{v}</td>; })}</tr>
            ))}</tbody>
          </table>
        </div>
        {input && <p className="mt-1 text-[11.5px] text-faint">Both run on the same seeded input {`[${input.map((v) => v.toFixed(2)).join(", ")}]`}.</p>}
      </div>
    </motion.div>
  );
}
