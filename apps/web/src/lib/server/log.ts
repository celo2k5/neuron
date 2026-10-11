/** Structured JSON logs. Never log secrets, session tokens, signatures of challenges, or raw request bodies. */
type Fields = Record<string, unknown>;
const out = (level: string, msg: string, f: Fields) => {
  if (process.env.NEURON_LOG === "silent") return;
  process.stdout.write(JSON.stringify({ t: new Date().toISOString(), level, msg, ...f }) + "\n");
};
export const log = {
  info: (m: string, f: Fields = {}) => out("info", m, f),
  warn: (m: string, f: Fields = {}) => out("warn", m, f),
  error: (m: string, f: Fields = {}) => out("error", m, f),
};
