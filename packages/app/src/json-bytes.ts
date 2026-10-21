/**
 * `JSON.stringify(value)` as UTF-8 bytes, built piece by piece: the members of the top `depth` levels of plain
 * objects and arrays are stringified one at a time and encoded in about 1 MB runs. The base pack's JSON is 25 MB,
 * and stringifying it whole (the string, its builder and the encoder's copy) set the import's memory peak.
 * The bytes are the same as `new TextEncoder().encode(JSON.stringify(value))` (json-bytes.test.ts).
 */
export function jsonBytes(value: unknown, depth = 2): Uint8Array {
  const encoder = new TextEncoder();
  const runs: Uint8Array[] = [];
  let text = '';
  const put = (s: string) => {
    text += s;
    if (text.length >= 1 << 20) {
      runs.push(encoder.encode(text));
      text = '';
    }
  };
  const plain = (v: unknown): v is object => v !== null && typeof v === 'object' && (Array.isArray(v) || Object.getPrototypeOf(v) === Object.prototype) && typeof (v as { toJSON?: unknown }).toJSON !== 'function';
  // JSON.stringify drops object members it cannot write (undefined, functions, symbols) and writes them as null in arrays.
  const skipped = (v: unknown) => v === undefined || typeof v === 'function' || typeof v === 'symbol';
  const walk = (v: unknown, levels: number): void => {
    if (levels === 0 || !plain(v)) return put(JSON.stringify(v) ?? 'null');
    if (Array.isArray(v)) {
      put('[');
      v.forEach((x, i) => {
        if (i) put(',');
        walk(skipped(x) ? null : x, levels - 1);
      });
      return put(']');
    }
    put('{');
    let first = true;
    for (const [k, x] of Object.entries(v)) {
      if (skipped(x)) continue;
      put(`${first ? '' : ','}${JSON.stringify(k)}:`);
      first = false;
      walk(x, levels - 1);
    }
    put('}');
  };
  walk(value, depth);
  runs.push(encoder.encode(text));
  const out = new Uint8Array(runs.reduce((n, r) => n + r.byteLength, 0));
  let at = 0;
  for (const r of runs) {
    out.set(r, at);
    at += r.byteLength;
  }
  return out;
}
