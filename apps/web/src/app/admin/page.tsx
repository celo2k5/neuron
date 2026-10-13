"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { useStreamStatus } from "@/lib/client/events";
import { ErrorBox, Panel, Spinner, StatusPill, ago, short, PageHeader, Hash } from "@/components/ui";

type Kind = "text" | "url" | "secret-url" | "pubkey" | "int" | "bigint" | "bool" | "select" | "check";
interface Setting { key: string; group: string; label: string; help: string; kind: Kind; options?: string[]; unit?: string; required?: boolean; placeholder?: string;
  value: string; secretSet?: boolean; source: "admin" | "env" | "default"; updatedBy: string | null; updatedAt: string | null }
interface AdminState {
  admin: boolean; wallet?: string | null; passwordConfigured?: boolean;
  settings?: Setting[]; audit?: { id: string; key: string; old_value: string | null; new_value: string | null; wallet: string; created_at: string }[];
  cluster?: string; mainnetConfirmed?: boolean; bootstrap?: { registryKeyFromEnv: boolean; artifactStore: string; allowMainnet: string | null };
  registryKey?: { keyId: string; publicKey: string };
}
interface Readiness { target: string; ready: boolean; blocking: string[]; checkedAt: string; checks: { id: string; label: string; ok: boolean | null; detail: string; required: boolean }[] }

const GROUPS = ["Network", "Token", "Credits & limits", "Governance", "Site", "Launch attestations"];

export default function AdminPage() {
  const qc = useQueryClient();
  const st = useQuery({ queryKey: ["admin"], queryFn: () => api<AdminState>("/api/admin") });
  const live = useStreamStatus();
  const d = st.data;

  if (st.isLoading) return <div className="p-8"><Spinner label="loading admin" /></div>;
  if (st.error) return <div className="mx-auto max-w-[900px] p-8"><ErrorBox error={st.error} /></div>;
  if (!d?.admin) return <Gate d={d} onIn={() => qc.invalidateQueries()} />;

  const byGroup = (g: string) => d.settings!.filter((s) => s.group === g);
  const onSaved = (next: AdminState) => qc.setQueryData(["admin"], (old: AdminState | undefined) => ({ ...old, ...next }));

  return (
    <div className="mx-auto max-w-[1440px] px-5 pb-16 sm:px-8">
      <PageHeader title="Control room." meta={<>
        <span className={`pill ${d.cluster === "mainnet-beta" ? "text-good" : "text-accent-2"}`}>{d.cluster}</span>
        <span className="flex items-center gap-1.5"><span className={`dot ${live === "live" ? "text-good dot-live" : "text-warn"}`} aria-hidden />{live === "live" ? "Changes apply everywhere instantly" : "Reconnecting to the live stream…"}</span>
        <span>signed in{d.wallet && d.wallet !== "password" ? <> as <span className="mono">{short(d.wallet, 5)}</span></> : " with the admin password"}</span>
        <button className="act sm" onClick={async () => { await api("/api/admin/login", { method: "DELETE" }); qc.invalidateQueries(); }}>Sign out of admin</button>
      </>}>
        Everything needed to run NEURON and take it to mainnet. Each field saves as you type and takes effect on every page, the API and the worker within a second. No redeploy.
      </PageHeader>

      <div className="mt-6 grid gap-6 xl:grid-cols-[200px_minmax(0,1fr)_400px]">
        <nav aria-label="Sections" className="hidden xl:block">
          <ul className="sticky top-[96px] space-y-1 text-[13.5px]">
            {[...GROUPS, "Launch"].map((g) => <li key={g}><a href={`#${slug(g)}`} className="block rounded-lg px-3 py-1.5 text-muted no-underline hover:bg-fg/[0.05] hover:text-fg">{g}</a></li>)}
          </ul>
        </nav>

        <div className="flex min-w-0 flex-col gap-6">
          {GROUPS.map((g) => (
            <Panel key={g} id={slug(g)} title={g} meta={g === "Launch attestations" ? "you confirm these; software cannot" : `${byGroup(g).filter((s) => s.source === "admin").length} set here`}>
              <div className="divide-y divide-line">{byGroup(g).map((s) => <Field key={s.key} s={s} onSaved={onSaved} mainnet={d.cluster === "mainnet-beta"} />)}</div>
            </Panel>
          ))}
          <Panel title="Set in the server environment" meta="needs a redeploy to change">
            <dl className="kv text-[13px]">
              <dt>DATABASE_URL</dt><dd>configured</dd>
              <dt>REGISTRY_SIGNING_KEY</dt><dd>{d.bootstrap?.registryKeyFromEnv ? "set" : <span className="text-warn">not set: using a key generated into the database</span>}</dd>
              <dt>registry key</dt><dd><Hash value={d.registryKey?.publicKey} /> <span className="text-faint">({d.registryKey?.keyId})</span></dd>
              <dt>ADMIN_WALLETS</dt><dd>includes your wallet</dd>
              <dt>ALLOW_MAINNET</dt><dd>{d.bootstrap?.allowMainnet ?? "not set (the go-live action decides)"}</dd>
              <dt>ARTIFACT_STORE</dt><dd>{d.bootstrap?.artifactStore}</dd>
            </dl>
          </Panel>
        </div>

        <aside className="flex min-w-0 flex-col gap-6 xl:sticky xl:top-[84px] xl:self-start" id="launch">
          <Launch cluster={d.cluster!} onSaved={onSaved} />
          <Panel title="Change log" meta="live">
            {!d.audit?.length ? <p className="text-muted">No changes yet.</p> : (
              <ul className="max-h-[420px] space-y-2 overflow-auto text-[12.5px]" data-testid="admin-audit">
                {d.audit.map((a) => (
                  <li key={a.id} className="border-b border-line pb-2 last:border-0">
                    <div className="flex justify-between gap-2"><span className="mono text-fg">{a.key}</span><span className="text-faint">{ago(a.created_at)}</span></div>
                    <div className="mt-0.5 truncate text-muted"><span className="line-through decoration-faint">{a.old_value ?? "default"}</span> → <span className="text-fg">{a.new_value ?? "default"}</span></div>
                    <div className="text-faint">by <span className="mono">{short(a.wallet, 4)}</span></div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </aside>
      </div>
    </div>
  );
}

const slug = (g: string) => g.toLowerCase().replace(/[^a-z]+/g, "-");

function Gate({ d, onIn }: { d?: AdminState; onIn: () => void }) {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await api("/api/admin/login", { method: "POST", json: { password: pw } }); setPw(""); onIn(); }
    catch (x) { setErr(x); } finally { setBusy(false); }
  };
  return (
    <div className="mx-auto max-w-[480px] px-5 py-24 sm:px-8">
      <h1 className="display text-[56px]">Admin</h1>
      {d?.passwordConfigured === false ? (
        <div className="panel mt-6 p-6 text-[15px]"><p>Admin access is not configured.</p><p className="mt-2 text-muted">Set <span className="mono text-fg">ADMIN_PASSWORD</span> in the server environment (Render → neuron → Environment) and reload.</p></div>
      ) : (
        <form className="panel mt-6 flex flex-col gap-3 p-6" onSubmit={submit} data-testid="admin-login">
          <label htmlFor="admin-pw" className="text-[14px]">Password</label>
          <input id="admin-pw" type="password" className="field" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
          <button className="act-primary self-start" disabled={busy || !pw} aria-busy={busy}>{busy ? "Checking…" : "Enter"}</button>
          <ErrorBox error={err} />
        </form>
      )}
    </div>
  );
}

type FieldState = { kind: "idle" } | { kind: "dirty" } | { kind: "saving" } | { kind: "saved"; at: number } | { kind: "error"; error: unknown };

function Field({ s, onSaved, mainnet }: { s: Setting; onSaved: (n: AdminState) => void; mainnet: boolean }) {
  const isSecret = s.kind === "secret-url";
  const toggle = s.kind === "bool" || s.kind === "check";
  const [draft, setDraft] = useState(isSecret ? "" : s.value);
  const [state, setState] = useState<FieldState>({ kind: "idle" });
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // follow live changes (another admin, another tab) unless this field is being edited
  useEffect(() => { if (!focused.current && state.kind !== "dirty" && !isSecret) setDraft(s.value); }, [s.value]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (value: string) => {
    if (timer.current) clearTimeout(timer.current);
    setState({ kind: "saving" });
    try {
      const next = await api<AdminState>("/api/admin/settings", { method: "PATCH", json: { key: s.key, value } });
      onSaved(next); setState({ kind: "saved", at: Date.now() });
      if (isSecret) setDraft("");
    } catch (e) { setState({ kind: "error", error: e }); }
  };
  const valid = (v: string) => {
    if (!v) return true;
    if (s.kind === "int" || s.kind === "bigint") return /^\d+$/.test(v);
    if (s.kind === "pubkey") return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
    if (s.kind === "url" || s.kind === "secret-url") { try { return /^https?:$/.test(new URL(v).protocol); } catch { return false; } }
    return true;
  };
  const onType = (v: string) => {
    setDraft(v); setState({ kind: "dirty" });
    if (timer.current) clearTimeout(timer.current);
    if (isSecret) return; // secrets save on Enter / blur only
    if (valid(v)) timer.current = setTimeout(() => save(v), 700);
  };
  const id = `f-${s.key}`;
  const invalid = draft !== "" && !valid(draft);

  return (
    <div className="grid gap-3 py-4 first:pt-0 last:pb-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]" data-testid={`setting-${s.key}`}>
      <div className="min-w-0">
        <label htmlFor={id} className="flex items-center gap-2 text-[14px] text-fg">{s.label}{s.required && <span className="text-[11px] text-faint">required for mainnet</span>}</label>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{s.help}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11.5px] text-faint">
          <span className="mono">{s.key}</span>
          <span aria-hidden>·</span>
          <span>{s.source === "admin" ? <>set here{s.updatedBy && <> by <span className="mono">{short(s.updatedBy, 4)}</span></>}{s.updatedAt && <> {ago(s.updatedAt)}</>}</> : s.source === "env" ? "from the server environment" : "default"}</span>
          {s.source === "admin" && !toggle && <button type="button" className="act sm !h-auto !px-1.5 !py-0 text-[11.5px]" onClick={() => save("")} title="Remove the override and use the environment / default value">reset</button>}
        </div>
      </div>
      <div className="min-w-0">
        {toggle ? (
          <button id={id} type="button" role="switch" aria-checked={s.value === "true"} onClick={() => save(s.value === "true" ? "false" : "true")}
            className={`inline-flex h-[30px] w-[54px] items-center rounded-full border p-[3px] transition-colors ${s.value === "true" ? "border-good/50 bg-good/20" : "border-line bg-fg/[0.05]"}`}>
            <span className={`h-[22px] w-[22px] rounded-full shadow transition-transform ${s.value === "true" ? "translate-x-[24px] bg-good" : "bg-fg/40"}`} />
            <span className="sr-only">{s.value === "true" ? "on" : "off"}</span>
          </button>
        ) : s.kind === "select" ? (
          <select id={id} className="field" value={mainnet && s.key === "SOLANA_CLUSTER" ? "mainnet-beta" : draft} disabled={mainnet && s.key === "SOLANA_CLUSTER"}
            onChange={(e) => { setDraft(e.target.value); save(e.target.value); }}>
            {mainnet && s.key === "SOLANA_CLUSTER" && <option value="mainnet-beta">mainnet-beta</option>}
            {s.options!.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : (
          <div className="flex items-center gap-2">
            <input id={id} className={`field ${s.kind === "pubkey" || s.kind === "secret-url" ? "mono text-[13px]" : ""} ${s.kind === "int" || s.kind === "bigint" ? "tnum" : ""} ${invalid ? "!border-bad/60" : ""}`}
              value={draft} spellCheck={false} autoComplete="off" inputMode={s.kind === "int" || s.kind === "bigint" ? "numeric" : undefined}
              type={isSecret ? "password" : "text"}
              placeholder={isSecret ? (s.secretSet ? `set: ${s.value} (type to replace)` : s.placeholder) : s.placeholder}
              onFocus={() => { focused.current = true; }} onBlur={() => { focused.current = false; if (state.kind === "dirty" && valid(draft) && (draft !== "" || !isSecret)) save(draft); }}
              onKeyDown={(e) => { if (e.key === "Enter" && valid(draft)) save(draft); }}
              onChange={(e) => onType(e.target.value)} aria-invalid={invalid} aria-describedby={`${id}-st`} />
            {s.unit && <span className="shrink-0 text-[12px] text-faint">{s.unit}</span>}
          </div>
        )}
        <div id={`${id}-st`} aria-live="polite" className="mt-1.5 min-h-[18px] text-[12px]">
          {invalid ? <span className="text-bad">{s.kind === "pubkey" ? "Not a Solana address." : s.kind.includes("url") ? "Not a valid URL." : "Whole numbers only."}</span>
            : state.kind === "saving" ? <span className="text-muted">Saving…</span>
            : state.kind === "saved" ? <span className="text-good">Saved · live everywhere</span>
            : state.kind === "dirty" ? <span className="text-faint">{isSecret ? "Press Enter to save" : "Editing…"}</span>
            : state.kind === "error" ? <span className="text-bad">{(state.error as Error).message}</span> : null}
        </div>
      </div>
    </div>
  );
}

function Launch({ cluster, onSaved }: { cluster: string; onSaved: (n: AdminState) => void }) {
  const mainnet = cluster === "mainnet-beta";
  const r = useQuery({ queryKey: ["readiness", mainnet ? "current" : "mainnet-beta"], queryFn: () => api<Readiness>(`/api/admin/readiness?target=${mainnet ? "current" : "mainnet-beta"}`), refetchInterval: 20_000 });
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const qc = useQueryClient();
  const passed = useMemo(() => r.data?.checks.filter((c) => c.ok === true).length ?? 0, [r.data]);
  const act = async (path: string, json: unknown) => {
    setBusy(true); setErr(null);
    try { onSaved(await api<AdminState>(path, { method: "POST", json })); setConfirm(""); await qc.invalidateQueries({ queryKey: ["readiness"] }); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <Panel title={mainnet ? "Mainnet health" : "Mainnet readiness"} meta={r.data ? `${passed} / ${r.data.checks.length} pass · ${ago(r.data.checkedAt)}` : ""}>
      {r.isLoading ? <Spinner label="checking the chain" /> : r.error ? <ErrorBox error={r.error} /> : r.data && (
        <ul className="space-y-2 text-[12.5px]" data-testid="readiness">
          {r.data.checks.map((c) => (
            <li key={c.id} className="flex gap-2.5">
              <span aria-hidden className={`mt-[1px] grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full text-[10px] ${c.ok === true ? "bg-good/20 text-good" : c.ok === null ? "bg-fg/10 text-faint" : c.required ? "bg-bad/20 text-bad" : "bg-warn/20 text-warn"}`}>{c.ok === true ? "✓" : c.ok === null ? "–" : "!"}</span>
              <span className="min-w-0"><span className={c.ok === true ? "text-fg" : "text-fg"}>{c.label}</span>{!c.required && <span className="ml-1 text-faint">(recommended)</span>}
                <span className="block truncate text-faint" title={c.detail}>{c.detail}</span></span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 border-t border-line pt-4">
        {mainnet ? (
          <>
            <div className="flex items-center gap-2"><StatusPill status="active" /><span>Live on mainnet-beta.</span></div>
            <button className="act-ghost mt-3" disabled={busy} onClick={() => act("/api/admin/leave-mainnet", { cluster: "devnet" })}>Return to devnet</button>
          </>
        ) : (
          <>
            <p className="text-[12.5px] text-muted">{r.data?.ready ? "Every required check passes." : `${r.data?.blocking.length ?? "…"} required check${r.data?.blocking.length === 1 ? "" : "s"} still failing.`} Going live switches every page, the API and the worker to mainnet-beta immediately and signs everyone out.</p>
            <label className="mt-3 block text-[12px] text-faint" htmlFor="golive">Type <span className="mono text-fg">GO MAINNET</span> to confirm</label>
            <div className="mt-1.5 flex gap-2">
              <input id="golive" className="field mono" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" spellCheck={false} placeholder="GO MAINNET" />
              <button className="act-primary shrink-0" disabled={busy || !r.data?.ready || confirm !== "GO MAINNET"} aria-busy={busy} onClick={() => act("/api/admin/go-live", { confirm })} data-testid="go-live">Go live</button>
            </div>
          </>
        )}
        <ErrorBox error={err} />
      </div>
    </Panel>
  );
}
