/** Namespaced record ID: `namespace:NAME`, e.g. `platinum:FLAG_UNK_0x00F0` or `fixture:ROOM`. */
export type Id = `${string}:${string}`;

const ID_RE = /^[a-z][a-z0-9-]*:[A-Za-z0-9_./-]+$/;
const PACK_ID_RE = /^[a-z][a-z0-9-]*$/;

export function isId(s: string): s is Id {
  return ID_RE.test(s);
}

export function asId(s: string): Id {
  if (!isId(s)) throw new Error(`invalid id "${s}" (expected namespace:NAME)`);
  return s;
}

export function isPackId(s: string): boolean {
  return PACK_ID_RE.test(s);
}
