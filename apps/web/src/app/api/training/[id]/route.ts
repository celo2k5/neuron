import { handler } from "@/lib/server/http";
import { getTraining } from "@/lib/server/training";
import { pool } from "@/lib/server/db";
export const dynamic = "force-dynamic";
export const GET = handler<{ id: string }>(async ({ params }) => ({ training: await getTraining(pool(), params.id) }));
