import { handler } from "@/lib/server/http";
export const dynamic = "force-dynamic";
/** liveness: process is up */
export const GET = handler(async () => ({ ok: true, service: "neuron-web", time: new Date().toISOString() }));
