import { handler } from "@/lib/server/http";
import { stopTraining, resumeTraining } from "@/lib/server/training";
import { requireSession } from "@/lib/server/auth";
import { tx } from "@/lib/server/db";
import { notFound } from "@/lib/server/http";
export const dynamic = "force-dynamic";
export const POST = handler<{ id: string; action: string }>(async ({ req, params }) => {
  const s = await requireSession(req);
  if (params.action === "cancel" || params.action === "pause") return tx((db) => stopTraining(db, s.userId, params.id, params.action as "cancel" | "pause"));
  if (params.action === "resume") return tx((db) => resumeTraining(db, s.userId, params.id));
  throw notFound();
});
