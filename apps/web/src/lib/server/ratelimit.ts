import { one } from "./db";
import { ApiError } from "./http";

/** Fixed-window limiter stored in Postgres (works across API instances). */
export async function rateLimit(key: string, limit: number, windowSec: number) {
  const row = await one<{ count: number }>(
    `insert into rate_limits (key, window_start, count) values ($1, now(), 1)
     on conflict (key) do update set
       count = case when rate_limits.window_start < now() - make_interval(secs => $2) then 1 else rate_limits.count + 1 end,
       window_start = case when rate_limits.window_start < now() - make_interval(secs => $2) then now() else rate_limits.window_start end
     returning count`, [key, windowSec]);
  if (row && row.count > limit) throw new ApiError(429, "rate_limited", `Too many requests. Limit is ${limit} per ${windowSec}s.`);
}

export function clientKey(req: Request, userId?: string) {
  return userId ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "anon";
}
