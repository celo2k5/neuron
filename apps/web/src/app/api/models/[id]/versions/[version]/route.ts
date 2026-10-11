import { NextResponse } from "next/server";
import { handler } from "@/lib/server/http";
import { loadVersion } from "@/lib/server/models";
import { pool } from "@/lib/server/db";
import { exportModel } from "@neuron/engine";
export const dynamic = "force-dynamic";
/** Declarative, validated model artifact (JSON). Immutable per version, so cacheable forever. */
export const GET = handler<{ id: string; version: string }>(async ({ params }) => {
  const { model } = await loadVersion(pool(), params.id, Number(params.version) || undefined);
  return NextResponse.json(exportModel(model), { headers: { "cache-control": "public, max-age=31536000, immutable", "content-disposition": `inline; filename="${model.id}-v${model.version}.json"` } });
});
