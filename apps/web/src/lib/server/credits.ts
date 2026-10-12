import type { Db } from "./db";
import { one } from "./db";
import { payment } from "./http";

/**
 * Credit ledger. Every movement is a credit_events row with a unique (kind, ref_type, ref_id),
 * so retries can never double-apply. Balances live in credit_accounts with non-negative checks.
 *   purchase: +available     reserve: available→reserved
 *   consume: reserved→consumed     release: reserved→available
 */
async function event(db: Db, userId: string, kind: string, amount: number, refType: string, refId: string) {
  const r = await db.query("insert into credit_events (user_id, kind, amount, ref_type, ref_id) values ($1,$2,$3,$4,$5) on conflict do nothing", [userId, kind, amount, refType, refId]);
  return r.rowCount === 1;
}

export async function balance(db: Db, userId: string) {
  return (await one<{ available: number; reserved: number; consumed: number; refunded: number }>(
    "select available, reserved, consumed, refunded from credit_accounts where user_id = $1", [userId], db)) ?? { available: 0, reserved: 0, consumed: 0, refunded: 0 };
}

export async function purchase(db: Db, userId: string, amount: number, intentId: string) {
  if (!(await event(db, userId, "purchase", amount, "payment_intent", intentId))) return false;
  await db.query("insert into credit_accounts (user_id) values ($1) on conflict do nothing", [userId]);
  await db.query("update credit_accounts set available = available + $2, updated_at = now() where user_id = $1", [userId, amount]);
  return true;
}

export async function reserve(db: Db, userId: string, amount: number, refType: string, refId: string) {
  if (amount <= 0) return true;
  const acc = await one<{ available: number }>("select available from credit_accounts where user_id = $1 for update", [userId], db);
  if (!acc || acc.available < amount) throw payment(`This needs ${amount} credits; you have ${acc?.available ?? 0}. Claim free credits on the Credits page.`, { needed: amount, available: acc?.available ?? 0 });
  if (!(await event(db, userId, "reserve", amount, refType, refId))) return false;
  await db.query("update credit_accounts set available = available - $2, reserved = reserved + $2, updated_at = now() where user_id = $1", [userId, amount]);
  return true;
}

/** consume `used` of a reservation and release the rest */
export async function settle(db: Db, userId: string, reserved: number, used: number, refType: string, refId: string) {
  used = Math.max(0, Math.min(reserved, used));
  const unused = reserved - used;
  if (used > 0 && (await event(db, userId, "consume", used, refType, refId))) {
    await db.query("update credit_accounts set reserved = reserved - $2, consumed = consumed + $2, updated_at = now() where user_id = $1", [userId, used]);
  }
  if (unused > 0 && (await event(db, userId, "release", unused, refType, refId))) {
    await db.query("update credit_accounts set reserved = reserved - $2, available = available + $2, updated_at = now() where user_id = $1", [userId, unused]);
  }
}

export async function grant(db: Db, userId: string, amount: number, refType: string, refId: string) {
  if (!(await event(db, userId, "grant", amount, refType, refId))) return false;
  await db.query("insert into credit_accounts (user_id) values ($1) on conflict do nothing", [userId]);
  await db.query("update credit_accounts set available = available + $2 where user_id = $1", [userId, amount]);
  return true;
}

const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);
/** Daily free credits, once per wallet per UTC day (unique event key makes double claims impossible). */
export async function claimDaily(db: Db, userId: string, amount: number) {
  const day = utcDay();
  const next = new Date(`${day}T00:00:00.000Z`); next.setUTCDate(next.getUTCDate() + 1);
  if (amount <= 0) return { claimed: false, amount: 0, nextAt: next.toISOString() };
  const ok = await event(db, userId, "claim", amount, "daily", `${userId}:${day}`);
  if (ok) {
    await db.query("insert into credit_accounts (user_id) values ($1) on conflict do nothing", [userId]);
    await db.query("update credit_accounts set available = available + $2, updated_at = now() where user_id = $1", [userId, amount]);
  }
  return { claimed: ok, amount: ok ? amount : 0, nextAt: next.toISOString() };
}
export async function claimedToday(db: Db, userId: string) {
  return !!(await one("select 1 from credit_events where kind = 'claim' and ref_type = 'daily' and ref_id = $1", [`${userId}:${utcDay()}`], db));
}
