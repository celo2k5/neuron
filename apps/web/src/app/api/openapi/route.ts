import { handler } from "@/lib/server/http";
import { openapi } from "@/lib/openapi";
export const dynamic = "force-static";
export const GET = handler(async () => openapi());
