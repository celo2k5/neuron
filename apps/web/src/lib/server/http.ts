import { NextResponse, type NextRequest } from "next/server";
import { z, ZodError, type ZodTypeAny } from "zod";
import { ValidationError, NumericError } from "@neuron/engine";
import { log } from "./log";
import { ensureSettings } from "./settings-sync";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}
export const bad = (m: string, d?: unknown) => new ApiError(400, "invalid_request", m, d);
export const unauthorized = (m = "Sign in with your wallet to do this.") => new ApiError(401, "unauthorized", m);
export const forbidden = (m: string) => new ApiError(403, "forbidden", m);
export const notFound = (m = "Not found.") => new ApiError(404, "not_found", m);
export const conflict = (m: string) => new ApiError(409, "conflict", m);
export const payment = (m: string, d?: unknown) => new ApiError(402, "insufficient_credits", m, d);
export const unavailable = (m: string) => new ApiError(503, "integration_unavailable", m);

type Ctx<P> = { req: NextRequest; params: P; requestId: string };

/** Uniform handler: request id, error envelope `{ error: { code, message, details, requestId } }`. */
export function handler<P = Record<string, string>>(fn: (c: Ctx<P>) => Promise<unknown>) {
  return async (req: NextRequest, ctx: { params: Promise<P> }) => {
    const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
    const t0 = Date.now();
    try {
      await ensureSettings();
      const out = await fn({ req, params: (await ctx?.params) ?? ({} as P), requestId });
      const res = out instanceof Response ? out : NextResponse.json(out ?? { ok: true });
      res.headers.set("x-request-id", requestId);
      log.info("http", { requestId, method: req.method, path: req.nextUrl.pathname, status: res.status, ms: Date.now() - t0 });
      return res;
    } catch (e) {
      let err: ApiError;
      if (e instanceof ApiError) err = e;
      else if (e instanceof ZodError) err = bad("Request failed validation.", e.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
      else if (e instanceof ValidationError) err = bad(e.issues.join("; "), e.issues);
      else if (e instanceof NumericError) err = new ApiError(422, "numeric_error", e.message);
      else {
        log.error("http_unhandled", { requestId, path: req.nextUrl.pathname, error: e instanceof Error ? e.message : String(e) });
        err = new ApiError(500, "internal", "Something failed on the server. Try again; if it persists, quote the request id.");
      }
      log.info("http", { requestId, method: req.method, path: req.nextUrl.pathname, status: err.status, code: err.code, ms: Date.now() - t0 });
      return NextResponse.json({ error: { code: err.code, message: err.message, details: err.details, requestId } }, { status: err.status, headers: { "x-request-id": requestId } });
    }
  };
}

export async function body<S extends ZodTypeAny>(req: NextRequest, s: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    const text = await req.text();
    if (text.length > 512_000) throw bad("Request body too large.");
    raw = text ? JSON.parse(text) : {};
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw bad("Body must be JSON.");
  }
  return s.parse(raw);
}

export function query<S extends ZodTypeAny>(req: NextRequest, s: S): z.infer<S> {
  return s.parse(Object.fromEntries(req.nextUrl.searchParams));
}

/** opaque keyset cursor: base64url(JSON [sortValue, id]) */
export const cursor = {
  encode: (value: string | number | Date, id: string) =>
    Buffer.from(JSON.stringify([value instanceof Date ? value.toISOString() : value, id])).toString("base64url"),
  decode: (c?: string | null): [string | number, string] | null => {
    if (!c) return null;
    try {
      const v = JSON.parse(Buffer.from(c, "base64url").toString());
      if (Array.isArray(v) && v.length === 2 && (typeof v[0] === "string" || typeof v[0] === "number") && typeof v[1] === "string") return [v[0], v[1]];
    } catch { /* fallthrough */ }
    throw bad("Invalid cursor.");
  },
};
