import { NextResponse } from "next/server";
import { handler } from "@/lib/server/http";
import { one } from "@/lib/server/db";
export const dynamic = "force-dynamic";
/** readiness: database reachable and migrated */
export const GET = handler(async () => {
  const t0 = Date.now();
  const db = await one<{ v: string }>("select max(version) as v from schema_migrations").then((r) => ({ ok: !!r?.v, migration: r?.v, ms: Date.now() - t0 })).catch((e: Error) => ({ ok: false, error: e.message }));
  return NextResponse.json({ ok: db.ok, db }, { status: db.ok ? 200 : 503 });
});
