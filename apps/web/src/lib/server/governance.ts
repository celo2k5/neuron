import { z } from "zod";
import { ACTIVATIONS, hashCanonical } from "@neuron/engine";
import { one, q, tx, emit, pool, type Db } from "./db";
import { walletBalance } from "./chain";
import { consumeChallenge, type Session } from "./auth";
import { applyPolicy } from "./community";
import { bad, conflict, forbidden, notFound } from "./http";
import { enqueue } from "./jobs";

/**
 * Governance rules (also rendered on the Governance page):
 *  - weight: $NEURON balance of the voting wallet read at `confirmed` commitment at the moment of voting
 *    (a historical snapshot needs an indexer of balances; this is documented as a known limitation)
 *  - one signed vote per wallet per proposal; signatures are domain-separated and single-use
 *  - proposal threshold, quorum (sum of weights) and approval (bps of for/(for+against)) are explicit per proposal
 *  - "policy" proposals may only change whitelisted community-network parameters, after an execution delay
 *  - nothing here can move treasury funds
 */
export const RULES = {
  proposalThresholdBase: BigInt(process.env.GOV_PROPOSAL_THRESHOLD ?? "100000000"),
  quorumBase: BigInt(process.env.GOV_QUORUM ?? "1000000000"),
  approvalBps: 6000,
  votingPeriodSec: Number(process.env.GOV_VOTING_PERIOD_SEC ?? 3 * 86400),
  executionDelaySec: Number(process.env.GOV_EXECUTION_DELAY_SEC ?? 86400),
  snapshotRule: "balance-at-vote (confirmed); one vote per wallet",
};

export const PolicyChange = z.discriminatedUnion("type", [
  z.object({ type: z.literal("set_max_per_layer"), value: z.number().int().min(8).max(48) }),
  z.object({ type: z.literal("set_layer_activation"), layer: z.union([z.literal(1), z.literal(2)]), activation: z.enum(ACTIVATIONS as unknown as [string, ...string[]]) }),
]);
export type PolicyChange = z.infer<typeof PolicyChange>;

export const votePayloadHash = (proposalId: string, choice: string) => hashCanonical({ action: "vote", proposalId, choice });

export async function createProposal(s: Session, p: { kind: "advisory" | "policy"; title: string; body: string; change?: PolicyChange }) {
  if (p.kind === "policy" && !p.change) throw bad("Policy proposals need a change.");
  if (p.kind === "advisory" && p.change) throw bad("Advisory proposals cannot carry an executable change.");
  const bal = await walletBalance(s.wallet);
  if (BigInt(bal.amount) < RULES.proposalThresholdBase) throw forbidden(`Proposing needs at least ${RULES.proposalThresholdBase} base units of $NEURON; you hold ${bal.amount}.`);
  const now = new Date();
  const ends = new Date(now.getTime() + RULES.votingPeriodSec * 1000);
  const row = (await one<{ id: string }>(
    `insert into proposals (author_id, kind, title, body, change, snapshot_rule, quorum, approval_bps, starts_at, ends_at, execute_after)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
    [s.userId, p.kind, p.title, p.body, p.change ?? null, RULES.snapshotRule, RULES.quorumBase.toString(), RULES.approvalBps, now, ends,
      p.kind === "policy" ? new Date(ends.getTime() + RULES.executionDelaySec * 1000) : null]))!;
  await enqueue(pool(), "governance_execute", { proposalId: row.id }, { idempotencyKey: `gov:${row.id}`, runAfter: ends, maxAttempts: 10 });
  return row;
}

export async function castVote(s: Session, proposalId: string, choice: "for" | "against" | "abstain", signed: { message: string; signature: string }) {
  const bal = await walletBalance(s.wallet);
  return tx(async (db) => {
    const c = await consumeChallenge(db, signed.message, signed.signature, "vote", votePayloadHash(proposalId, choice));
    const p = await one<{ status: string; starts_at: string; ends_at: string }>("select status, starts_at, ends_at from proposals where id = $1 for update", [proposalId], db);
    if (!p) throw notFound("Proposal not found.");
    if (p.status !== "active" || Date.now() > Date.parse(p.ends_at)) throw conflict("Voting has closed.");
    const ins = await db.query(
      "insert into votes (proposal_id, user_id, wallet, choice, weight, signature, nonce) values ($1,$2,$3,$4,$5,$6,$7) on conflict (proposal_id, user_id) do nothing",
      [proposalId, s.userId, s.wallet, choice, bal.amount, signed.signature, c.nonce]);
    if (ins.rowCount !== 1) throw conflict("This wallet already voted on this proposal.");
    await emit(db, "governance.vote", proposalId, { choice, weight: bal.amount }, s.userId);
    return { weight: bal.amount };
  });
}

export async function tally(db: Db, id: string) {
  const rows = await q<{ choice: string; w: string; n: number }>("select choice, sum(weight)::text as w, count(*)::int as n from votes where proposal_id = $1 group by choice", [id], db);
  const get = (c: string) => BigInt(rows.find((r) => r.choice === c)?.w ?? "0");
  const f = get("for"), a = get("against"), ab = get("abstain");
  return { for: f.toString(), against: a.toString(), abstain: ab.toString(), total: (f + a + ab).toString(), voters: rows.reduce((s, r) => s + r.n, 0) };
}

/** Worker: close voting, decide, and (for policy) execute after the delay. Idempotent via status transitions. */
export async function processProposal(db: Db, id: string): Promise<{ done: boolean; runAfter?: Date }> {
  const p = await one<{ status: string; kind: string; change: PolicyChange | null; quorum: string; approval_bps: number; ends_at: string; execute_after: string | null }>(
    "select status, kind, change, quorum, approval_bps, ends_at, execute_after from proposals where id = $1 for update", [id], db);
  if (!p) return { done: true };
  if (p.status === "active") {
    if (Date.now() < Date.parse(p.ends_at)) return { done: false, runAfter: new Date(p.ends_at) };
    const t = await tally(db, id);
    const fa = BigInt(t.for) + BigInt(t.against);
    const passed = BigInt(t.total) >= BigInt(p.quorum) && fa > 0n && (BigInt(t.for) * 10000n) / fa >= BigInt(p.approval_bps);
    await db.query("update proposals set status = $2 where id = $1", [id, passed ? "passed" : "rejected"]);
    await emit(db, "governance.closed", id, { passed, ...t });
    if (!passed || p.kind !== "policy") return { done: true };
    return { done: false, runAfter: new Date(p.execute_after!) };
  }
  if (p.status === "passed" && p.kind === "policy" && p.change) {
    if (Date.now() < Date.parse(p.execute_after!)) return { done: false, runAfter: new Date(p.execute_after!) };
    const ch = PolicyChange.parse(p.change);
    const net = (await one<{ policy: { layerActivations: [string, string] } }>("select policy from networks where id = 'community'", [], db))!;
    const patch = ch.type === "set_max_per_layer" ? { maxPerLayer: ch.value }
      : { layerActivations: (ch.layer === 1 ? [ch.activation, net.policy.layerActivations[1]] : [net.policy.layerActivations[0], ch.activation]) as never };
    await applyPolicy(db, patch, { proposalId: id });
    await db.query("update proposals set status = 'executed', executed_at = now() where id = $1", [id]);
    await emit(db, "governance.executed", id, { change: ch });
  }
  return { done: true };
}

export async function listProposals(db: Db) {
  const rows = await q<Record<string, unknown> & { id: string }>("select p.*, u.wallet as author_wallet from proposals p join users u on u.id = p.author_id order by created_at desc limit 50", [], db);
  return Promise.all(rows.map(async (r) => ({ ...r, tally: await tally(db, r.id) })));
}
