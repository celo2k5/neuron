import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

/**
 * Canonical encoding (spec: docs/ENCODING.md)
 *  - objects: keys sorted by UTF-16 code unit order, no whitespace
 *  - arrays: in order
 *  - numbers: ECMAScript Number::toString (shortest round-trip). -0 encodes as 0.
 *    NaN / ±Infinity are rejected.
 *  - typed arrays are encoded as plain arrays
 *  - undefined object members are omitted; undefined array items are rejected
 */
export function canonical(value: unknown): string {
  return enc(value, "$");
}

function enc(v: unknown, path: string): string {
  if (v === null) return "null";
  switch (typeof v) {
    case "boolean":
      return v ? "true" : "false";
    case "number":
      if (!Number.isFinite(v)) throw new EncodingError(`non-finite number at ${path}`);
      return Object.is(v, -0) ? "0" : String(v);
    case "string":
      return JSON.stringify(v);
    case "object": {
      if (ArrayBuffer.isView(v) && !(v instanceof DataView)) {
        return enc(Array.from(v as unknown as ArrayLike<number>), path);
      }
      if (Array.isArray(v)) {
        return "[" + v.map((x, i) => {
          if (x === undefined) throw new EncodingError(`undefined array item at ${path}[${i}]`);
          return enc(x, `${path}[${i}]`);
        }).join(",") + "]";
      }
      const o = v as Record<string, unknown>;
      const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
      return "{" + keys.map((k) => JSON.stringify(k) + ":" + enc(o[k], `${path}.${k}`)).join(",") + "}";
    }
    default:
      throw new EncodingError(`unsupported type ${typeof v} at ${path}`);
  }
}

export class EncodingError extends Error {
  constructor(m: string) {
    super(m);
    this.name = "EncodingError";
  }
}

export function sha256Hex(data: string | Uint8Array): string {
  return bytesToHex(sha256(typeof data === "string" ? utf8ToBytes(data) : data));
}

export function hashCanonical(value: unknown): string {
  return sha256Hex(canonical(value));
}

export function sha256Bytes(data: string): Uint8Array {
  return sha256(utf8ToBytes(data));
}
