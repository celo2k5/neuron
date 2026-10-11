import type { NextRequest } from "next/server";
import { q } from "./db";

let open = 0;
export const sseConnections = () => open;

/**
 * Server-sent events over activity_events. Event ids are the monotonic bigserial cursor,
 * so a reconnecting EventSource resumes with Last-Event-ID and never sees an event twice.
 * Clients refetch authoritative snapshots on reconnect; events are hints, not state.
 */
export function sseStream(req: NextRequest, after: string | null) {
  const enc = new TextEncoder();
  let cursor = after;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  const stream = new ReadableStream({
    async start(ctrl) {
      open++;
      const send = (s: string) => { if (!closed) ctrl.enqueue(enc.encode(s)); };
      if (!cursor) {
        const r = await q<{ id: string }>("select coalesce(max(id),0)::text as id from activity_events");
        cursor = r[0].id;
      }
      send(`retry: 3000\nevent: hello\ndata: ${JSON.stringify({ cursor })}\n\n`);
      const tick = async () => {
        if (closed) return;
        try {
          const rows = await q<{ id: string; topic: string; ref_id: string; data: unknown; created_at: string }>(
            "select id::text, topic, ref_id, data, created_at from activity_events where id > $1::bigint order by id limit 200", [cursor]);
          for (const r of rows) { send(`id: ${r.id}\nevent: activity\ndata: ${JSON.stringify(r)}\n\n`); cursor = r.id; }
          if (!rows.length) send(`: keepalive\n\n`);
        } catch { send(`event: error\ndata: {"message":"event source degraded; refetching"}\n\n`); }
        timer = setTimeout(tick, 1000);
      };
      tick();
      req.signal.addEventListener("abort", () => { closed = true; if (timer) clearTimeout(timer); open--; try { ctrl.close(); } catch { /* closed */ } });
    },
    cancel() { closed = true; if (timer) clearTimeout(timer); open--; },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" } });
}
