/**
 * Finds the US build's pinned binary regions (a table at an arm9/overlay offset, checked by SHA-1) in another
 * build of the same game, such as the German Platinum (CPUD). Used by tools/relocate.ts; pure functions, no ROM I/O.
 *
 * Three ways to find a pin, tried in order:
 * - `same`: the target has the same bytes at the same offset.
 * - `moved`: a window elsewhere in the module has the US SHA-1 (pure data: the bytes are identical).
 * - `relocated`: the bytes differ only in pointers. With the US bytes (`--us`), pointer words are masked and the
 *   rest compared. Without them, each pointer in a candidate window is mapped back to its US address through the
 *   anchors (the `moved`/`same` pins: per module, how far the target's data moved) and the window re-hashed; an
 *   overlay's unknown US RAM address is solved on the way (only an exact SHA-1 accepts a candidate).
 */
import { createHash } from 'node:crypto';

export type Where = 'arm9' | number;

/** A US region: `length` bytes (rows of `size`) at `offset` of arm9 or an overlay, with the SHA-1 the importer checks. */
export interface Pin {
  key: string;
  where: Where;
  offset: number;
  length: number;
  size: number;
  sha1: string;
}

/** A module (arm9 or an overlay) as loaded: its bytes and its RAM address. */
export interface Module {
  bytes: Uint8Array;
  ram: number;
}

export type Modules = Map<Where, Module>;

export type Found =
  | { key: string; status: 'same' | 'moved'; offset: number; sha1: string; candidates: number }
  | { key: string; status: 'relocated'; offset: number; sha1: string; candidates: number; pointers: number }
  | { key: string; status: 'missing'; predicted: number | null; reason: string };

/** An anchor: a pin found exactly, at `us` in the US module and `target` in the target module. */
interface Anchor {
  us: number;
  target: number;
}

export const sha1 = (bytes: Uint8Array): string => createHash('sha1').update(bytes).digest('hex');

const u32 = (b: Uint8Array, o: number) => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;

/** Pins shorter than this match by chance too often to anchor anything (they still get found, nearest first). */
const MIN_ANCHOR = 16;
/** How far from the predicted offset the pointer passes look (bytes, each way). */
const RELOCATE_RADIUS = 0x8000;
/** Exact matches are searched over the whole module up to this length, and near the prediction above it. */
const FULL_SCAN_MAX = 0x1000;
/** Solving a module's US RAM address: offsets this far from the prediction, addresses this many 32-byte steps away. */
const SOLVE_RADIUS = 0x80;
const SOLVE_BASES = 64;

/** Every offset in [from, to) where a `length`-byte window hashes to one of `wanted`. */
function scan(bytes: Uint8Array, length: number, wanted: Set<string>, from = 0, to = bytes.length): Map<string, number[]> {
  const hits = new Map<string, number[]>();
  const end = Math.min(to, bytes.length - length + 1);
  for (let o = Math.max(0, from); o < end; o++) {
    const h = sha1(bytes.subarray(o, o + length));
    if (wanted.has(h)) {
      const list = hits.get(h);
      if (list) list.push(o);
      else hits.set(h, [o]);
    }
  }
  return hits;
}

/** The target offset of US offset `us`, by the nearest anchor's shift (null without anchors). */
export function predict(anchors: Anchor[], us: number): number | null {
  let best: Anchor | null = null;
  for (const a of anchors) if (!best || Math.abs(a.us - us) < Math.abs(best.us - us)) best = a;
  return best ? us + best.target - best.us : null;
}

/** The US offset of target offset `target`, by the anchor nearest in the target module. */
function unpredict(anchors: Anchor[], target: number): number | null {
  let best: Anchor | null = null;
  for (const a of anchors) if (!best || Math.abs(a.target - target) < Math.abs(best.target - target)) best = a;
  return best ? target - best.target + best.us : null;
}

const nearest = (offsets: number[], to: number | null) => (to === null ? offsets[0]! : offsets.reduce((a, b) => (Math.abs(b - to) < Math.abs(a - to) ? b : a)));

export interface RelocateInput {
  pins: Pin[];
  target: Modules;
  /** The US modules' RAM addresses (the pointer pass maps pointers back to them). */
  usRam: Map<Where, number>;
  /** The US modules' bytes, when the US ROM is at hand: the pointer pass then masks pointers instead of re-hashing. */
  us?: Modules;
}

/** The pins found (in `pins` order) and the US RAM addresses: the given ones and those solved on the way. */
export function relocate({ pins, target, usRam, us }: RelocateInput): { found: Found[]; usRam: Map<Where, number> } {
  const found = new Map<string, Found>();
  const anchors = new Map<Where, Anchor[]>();
  const addAnchor = (pin: Pin, at: number) => {
    if (pin.length < MIN_ANCHOR) return;
    const list = anchors.get(pin.where) ?? [];
    list.push({ us: pin.offset, target: at });
    anchors.set(pin.where, list);
  };
  const moduleOf = (pin: Pin) => {
    const m = target.get(pin.where);
    if (!m) throw new Error(`relocate: no target module ${pin.where} for ${pin.key}`);
    return m;
  };

  // 1. Same bytes at the same offset.
  for (const pin of pins) {
    const m = moduleOf(pin);
    if (pin.offset + pin.length <= m.bytes.length && sha1(m.bytes.subarray(pin.offset, pin.offset + pin.length)) === pin.sha1) {
      found.set(pin.key, { key: pin.key, status: 'same', offset: pin.offset, sha1: pin.sha1, candidates: 1 });
      addAnchor(pin, pin.offset);
    }
  }

  // 2. Same bytes elsewhere: a whole-module scan for the pins up to FULL_SCAN_MAX, one pass per (module, length).
  const groups = new Map<string, Pin[]>();
  for (const pin of pins) {
    if (found.has(pin.key) || pin.length > FULL_SCAN_MAX) continue;
    const k = `${pin.where}:${pin.length}`;
    groups.set(k, [...(groups.get(k) ?? []), pin]);
  }
  const exact: { pin: Pin; offsets: number[] }[] = [];
  for (const group of groups.values()) {
    const first = group[0]!;
    const hits = scan(moduleOf(first).bytes, first.length, new Set(group.map((p) => p.sha1)));
    for (const pin of group) {
      const offsets = hits.get(pin.sha1);
      if (!offsets) continue;
      exact.push({ pin, offsets });
      if (offsets.length === 1) addAnchor(pin, offsets[0]!);
    }
  }
  // Ambiguous (repeated) matches take the one nearest the unique anchors' prediction.
  for (const { pin, offsets } of exact) {
    const offset = nearest(offsets, predict(anchors.get(pin.where) ?? [], pin.offset));
    found.set(pin.key, { key: pin.key, status: 'moved', offset, sha1: pin.sha1, candidates: offsets.length });
  }

  // 3. Larger pins: exact, near the prediction (a module without anchors: near the US offset). Each find anchors.
  for (const pin of pins) {
    if (found.has(pin.key) || pin.length <= FULL_SCAN_MAX) continue;
    const at = predict(anchors.get(pin.where) ?? [], pin.offset) ?? pin.offset;
    const offsets = scan(moduleOf(pin).bytes, pin.length, new Set([pin.sha1]), at - RELOCATE_RADIUS, at + RELOCATE_RADIUS).get(pin.sha1);
    if (!offsets) continue;
    const offset = nearest(offsets, at);
    found.set(pin.key, { key: pin.key, status: 'moved', offset, sha1: pin.sha1, candidates: offsets.length });
    if (offsets.length === 1) addAnchor(pin, offset);
  }

  // 4. Pointers: the same data with relocated pointers, near the prediction (a module without anchors: unmoved).
  // Without the US bytes, a module whose US RAM address is unknown has it solved: the candidates near the target's
  // address are tried, and only an exact US SHA-1 accepts one (then it is kept for the module's other pins).
  const ram = new Map(usRam);
  for (const pin of pins) {
    if (found.has(pin.key)) continue;
    const m = moduleOf(pin);
    const at = predict(anchors.get(pin.where) ?? [], pin.offset) ?? pin.offset;
    const usBytes = us?.get(pin.where)?.bytes.subarray(pin.offset, pin.offset + pin.length);
    if (usBytes && sha1(usBytes) !== pin.sha1) throw new Error(`relocate: the US ROM's ${pin.key} does not have its pinned SHA-1`);
    const known = ram.get(pin.where);
    const radius = usBytes || known !== undefined ? RELOCATE_RADIUS : SOLVE_RADIUS;
    const bases = known !== undefined ? [known] : Array.from({ length: 2 * SOLVE_BASES + 1 }, (_, k) => m.ram + (k - SOLVE_BASES) * 0x20);
    const offsets = Array.from({ length: 2 * radius + 1 }, (_, k) => at - radius + k)
      .filter((o) => o >= 0 && o + pin.length <= m.bytes.length)
      .sort((a, b) => Math.abs(a - at) - Math.abs(b - at));
    const hits: { offset: number; pointers: number; base: number | null }[] = [];
    for (const o of offsets) {
      const window = m.bytes.subarray(o, o + pin.length);
      if (usBytes) {
        const pointers = maskedMatch(window, usBytes, pin.offset, usRam, us!);
        if (pointers !== null) hits.push({ offset: o, pointers, base: null });
        continue;
      }
      // The pin itself anchors its module at this candidate (its pointers into itself move with it).
      const own = [...(anchors.get(pin.where) ?? []), { us: pin.offset, target: o }];
      // Pointers into the module itself first: data words can look like arm9 addresses (bytes 03 06 01 02).
      const ownerSets: Where[][] = pin.where === 'arm9' ? [['arm9']] : [[pin.where], [pin.where, 'arm9']];
      for (const owners of ownerSets) {
        for (const base of bases) {
          const pointers = rewrittenMatch(window, o, pin.sha1, owners, target, (w) => (w === pin.where ? base : ram.get(w)), (w) => (w === pin.where ? own : (anchors.get(w) ?? [])));
          if (pointers !== null) hits.push({ offset: o, pointers, base });
        }
        if (hits.some((h) => h.offset === o)) break;
      }
      if (hits.length && known === undefined) break;
    }
    if (hits.length === 0) {
      found.set(pin.key, { key: pin.key, status: 'missing', predicted: at, reason: usBytes ? 'no window matches outside pointer words' : 'no window matches with its pointers mapped back (function pointers, or pointers into other modules)' });
      continue;
    }
    const best = hits.reduce((a, b) => (Math.abs(b.offset - at) < Math.abs(a.offset - at) ? b : a));
    if (known === undefined && best.base !== null) ram.set(pin.where, best.base);
    found.set(pin.key, { key: pin.key, status: 'relocated', offset: best.offset, sha1: sha1(m.bytes.subarray(best.offset, best.offset + pin.length)), candidates: hits.length, pointers: best.pointers });
  }

  return { found: pins.map((p) => found.get(p.key)!), usRam: ram };
}

/**
 * The window matches the US bytes except in words that are pointers on both sides (a word, aligned in the
 * module, whose US value lies in a US module): the count of such words, or null. All-equal windows count 0.
 */
function maskedMatch(window: Uint8Array, usBytes: Uint8Array, usOffset: number, usRam: Map<Where, number>, us: Modules): number | null {
  let pointers = 0;
  const isPointer = (v: number) => [...us].some(([w, m]) => v >= usRam.get(w)! && v < usRam.get(w)! + m.bytes.length);
  for (let i = 0; i < window.length; ) {
    if ((usOffset + i) % 4 === 0 && i + 4 <= window.length) {
      const a = u32(usBytes, i);
      const b = u32(window, i);
      if (a !== b) {
        if (!isPointer(a) || b < 0x02000000 || b >= 0x02400000) return null;
        pointers++;
      }
      i += 4;
    } else {
      if (window[i] !== usBytes[i]) return null;
      i++;
    }
  }
  return pointers;
}

/**
 * Maps each aligned word of the window that points into one of `owners` back to its US address (the nearest
 * anchor's shift) and compares the SHA-1: the count of mapped words, or null.
 */
function rewrittenMatch(window: Uint8Array, offset: number, sha: string, owners: Where[], target: Modules, usRamOf: (w: Where) => number | undefined, anchorsOf: (w: Where) => Anchor[]): number | null {
  const copy = window.slice();
  const view = new DataView(copy.buffer);
  let pointers = 0;
  for (let i = (4 - (offset % 4)) % 4; i + 4 <= copy.length; i += 4) {
    const v = view.getUint32(i, true);
    for (const w of owners) {
      const m = target.get(w);
      const base = usRamOf(w);
      if (!m || base === undefined || v < m.ram || v >= m.ram + m.bytes.length) continue;
      const usOff = unpredict(anchorsOf(w), v - m.ram);
      if (usOff === null) return null;
      view.setUint32(i, base + usOff, true);
      pointers++;
      break;
    }
  }
  return pointers > 0 && sha1(copy) === sha ? pointers : null;
}
