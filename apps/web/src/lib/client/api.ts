"use client";
/** Typed client for the NEURON API. Errors surface the server's `{ error: { code, message } }` envelope. */
export class ClientApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown, public requestId?: string) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(path, {
    ...rest,
    headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    credentials: "same-origin",
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const e = data?.error ?? {};
    throw new ClientApiError(res.status, e.code ?? "http_error", e.message ?? `Request failed (${res.status})`, e.details, e.requestId);
  }
  return data as T;
}

export interface PublicConfig {
  cluster: "localnet" | "devnet" | "mainnet-beta";
  rpc: string;
  programId: string | null;
  mint: string | null;
  treasury: string | null;
  creditPriceBaseUnits: string;
  freeExperimentsPerDay: number;
  freeTrainingPerDay: number;
  freeTrainingMaxEpochs: number;
  registrationCredits: number;
  blockers: string[];
  engine: string;
  limits: Record<string, number>;
  trainLimits: Record<string, number>;
  tolerance: { rel: number; abs: number };
}
