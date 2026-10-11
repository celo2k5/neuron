import type { NextRequest } from "next/server";
import { sseStream } from "@/lib/server/sse";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(req: NextRequest) {
  const last = req.headers.get("last-event-id") ?? req.nextUrl.searchParams.get("after");
  return sseStream(req, last && /^\d+$/.test(last) ? last : null);
}
