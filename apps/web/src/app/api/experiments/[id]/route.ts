import { handler } from "@/lib/server/http";
import { getExperiment } from "@/lib/server/experiments";
import { pool } from "@/lib/server/db";
export const dynamic = "force-dynamic";
export const GET = handler<{ id: string }>(async ({ params }) => ({ experiment: await getExperiment(pool(), params.id) }));
