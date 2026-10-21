import { Reader } from '@opensinnoh/nds';

/**
 * Pokémon data formats (raw, native indexes; platinum.ts names them): pl_personal (decomp SpeciesData,
 * 44 B), evo (7 × SpeciesEvolution), wotbl (level-up learnsets), pl_waza_tbl (MoveTable, 16 B),
 * pl_item_data (ItemData, 34 B), pl_growtbl (101 u32 per exp rate), and the arm9/overlay tables (TM/HM
 * moves, egg moves, trainer class genders, nature stat affinities, marts).
 */

/** Stat order of the personal data and EV yields (decomp SpeciesBaseStats). */
export const PERSONAL_STATS = ['hp', 'attack', 'defense', 'speed', 'spAttack', 'spDefense'] as const;

export interface RawPersonal {
  baseStats: number[];
  types: [number, number];
  catchRate: number;
  baseExp: number;
  evYield: number[];
  heldItems: [number, number];
  genderRatio: number;
  hatchCycles: number;
  baseFriendship: number;
  expRate: number;
  eggGroups: [number, number];
  abilities: [number, number];
  safariFleeRate: number;
  color: number;
  flip: boolean;
  /** TM/HM indexes (bit i of the four u32 masks = TM/HM i). */
  tms: number[];
}

export function readPersonal(bytes: Uint8Array, tmCount: number): RawPersonal {
  if (bytes.length !== 44) throw new Error(`personal data: ${bytes.length} bytes, expected 44`);
  const r = new Reader(bytes);
  const ev = r.u16(10);
  const tms: number[] = [];
  for (let i = 0; i < 128; i++) {
    if (!((r.u32(28 + (i >> 5) * 4) >>> (i & 31)) & 1)) continue;
    if (i >= tmCount) throw new Error(`personal data: TM/HM bit ${i} set, only ${tmCount} TMs/HMs`);
    tms.push(i);
  }
  return {
    baseStats: [0, 1, 2, 3, 4, 5].map((i) => r.u8(i)),
    types: [r.u8(6), r.u8(7)],
    catchRate: r.u8(8),
    baseExp: r.u8(9),
    evYield: [0, 1, 2, 3, 4, 5].map((i) => (ev >> (i * 2)) & 3),
    heldItems: [r.u16(12), r.u16(14)],
    genderRatio: r.u8(16),
    hatchCycles: r.u8(17),
    baseFriendship: r.u8(18),
    expRate: r.u8(19),
    eggGroups: [r.u8(20), r.u8(21)],
    abilities: [r.u8(22), r.u8(23)],
    safariFleeRate: r.u8(24),
    color: r.u8(25) & 0x7f,
    flip: (r.u8(25) & 0x80) !== 0,
    tms,
  };
}

/** evo member: up to 7 {u16 method, u16 param, u16 target}; method 0 = none. */
export function readEvolutions(bytes: Uint8Array): { method: number; param: number; target: number }[] {
  if (bytes.length !== 44) throw new Error(`evolution data: ${bytes.length} bytes, expected 44`);
  const r = new Reader(bytes);
  const out: { method: number; param: number; target: number }[] = [];
  for (let i = 0; i < 7; i++) {
    const method = r.u16(i * 6);
    if (method) out.push({ method, param: r.u16(i * 6 + 2), target: r.u16(i * 6 + 4) });
  }
  return out;
}

/** wotbl member: u16 (level << 9 | move) until 0xFFFF (decomp SpeciesLearnsetEntry). */
export function readLearnset(bytes: Uint8Array): { level: number; move: number }[] {
  const r = new Reader(bytes);
  const out: { level: number; move: number }[] = [];
  for (let o = 0; ; o += 2) {
    const v = r.u16(o);
    if (v === 0xffff) return out;
    out.push({ level: v >> 9, move: v & 0x1ff });
  }
}

export interface RawMove {
  effect: number;
  class: number;
  power: number;
  type: number;
  accuracy: number;
  pp: number;
  effectChance: number;
  range: number;
  priority: number;
  flags: number;
  contest: { effect: number; type: number };
}

export function readMove(bytes: Uint8Array): RawMove {
  if (bytes.length !== 16) throw new Error(`move data: ${bytes.length} bytes, expected 16`);
  const r = new Reader(bytes);
  return {
    effect: r.u16(0),
    class: r.u8(2),
    power: r.u8(3),
    type: r.u8(4),
    accuracy: r.u8(5),
    pp: r.u8(6),
    effectChance: r.u8(7),
    range: r.u16(8),
    priority: (r.u8(10) << 24) >> 24,
    flags: r.u8(11),
    contest: { effect: r.u8(12), type: r.u8(13) },
  };
}

/** Decomp ItemPartyParam bit fields, in order: [name, bits]. */
const PARTY_BITS: [string, number][] = [
  ['healSleep', 1], ['healPoison', 1], ['healBurn', 1], ['healFreeze', 1], ['healParalysis', 1], ['healConfusion', 1], ['healAttract', 1], ['guardSpec', 1],
  ['revive', 1], ['reviveAll', 1], ['levelUp', 1], ['evolve', 1], ['attack', 4],
  ['defense', 4], ['spAttack', 4],
  ['spDefense', 4], ['speed', 4],
  ['accuracy', 4], ['crit', 2], ['ppUp', 1], ['ppMax', 1],
  ['ppRestore', 1], ['ppRestoreAll', 1], ['hpRestore', 1], ['giveHpEvs', 1], ['giveAtkEvs', 1], ['giveDefEvs', 1], ['giveSpeedEvs', 1], ['giveSpAtkEvs', 1],
  ['giveSpDefEvs', 1], ['giveFriendshipLow', 1], ['giveFriendshipMed', 1], ['giveFriendshipHigh', 1],
];
const STAGE_FIELDS = new Set(['attack', 'defense', 'spAttack', 'spDefense', 'speed', 'accuracy', 'crit']);

export interface RawItem {
  price: number;
  holdEffect: number;
  holdParam: number;
  pluckEffect: number;
  flingEffect: number;
  flingPower: number;
  naturalGiftPower: number;
  naturalGiftType: number;
  preventToss: boolean;
  canRegister: boolean;
  pocket: number;
  battlePocket: number;
  fieldUse: number;
  battleUse: number;
  /** Set when the item has a party use (decomp partyUse != 0). */
  partyUse?: { flags: string[]; stages: Record<string, number>; evs: number[]; hp: number; pp: number; friendship: [number, number, number] };
}

/** pl_item_data member (decomp ItemData, 34 B with the ItemPartyParam union). */
export function readItem(bytes: Uint8Array): RawItem {
  if (bytes.length !== 34) throw new Error(`item data: ${bytes.length} bytes, expected 34`);
  const r = new Reader(bytes);
  const bits = r.u16(8);
  const item: RawItem = {
    price: r.u16(0),
    holdEffect: r.u8(2),
    holdParam: r.u8(3),
    pluckEffect: r.u8(4),
    flingEffect: r.u8(5),
    flingPower: r.u8(6),
    naturalGiftPower: r.u8(7),
    naturalGiftType: bits & 0x1f,
    preventToss: (bits & 0x20) !== 0,
    canRegister: (bits & 0x40) !== 0,
    pocket: (bits >> 7) & 0xf,
    battlePocket: bits >> 11,
    fieldUse: r.u8(10),
    battleUse: r.u8(11),
  };
  if (!r.u8(12)) return item;
  const flags: string[] = [];
  const stages: Record<string, number> = {};
  let bit = 14 * 8;
  for (const [name, n] of PARTY_BITS) {
    let v = 0;
    for (let k = 0; k < n; k++, bit++) v |= ((r.u8(bit >> 3) >> (bit & 7)) & 1) << k;
    if (!v) continue;
    if (STAGE_FIELDS.has(name)) stages[name] = v;
    else flags.push(name);
  }
  // 164 bits of fields; no field straddles a byte, so the u8 bit fields pack in order.
  if (bit !== 20 * 8 + 4) throw new Error(`item data: party bit fields end at bit ${bit}`);
  const s8 = (o: number) => (r.u8(o) << 24) >> 24;
  item.partyUse = { flags, stages, evs: [21, 22, 23, 24, 25, 26].map(s8), hp: r.u8(27), pp: r.u8(28), friendship: [s8(29), s8(30), s8(31)] };
  return item;
}

/** pl_growtbl member: total exp for levels 0..100. */
export function readGrowthTable(bytes: Uint8Array): number[] {
  if (bytes.length !== 404) throw new Error(`growth table: ${bytes.length} bytes, expected 404`);
  const r = new Reader(bytes);
  return Array.from({ length: 101 }, (_, l) => r.u32(l * 4));
}

export function readU16s(bytes: Uint8Array): number[] {
  const r = new Reader(bytes);
  return Array.from({ length: bytes.length >> 1 }, (_, i) => r.u16(i * 2));
}

/** Decomp sEggMoves: per species `20000 + species` then its moves, ending with 0xFFFF. */
export const EGG_MOVES_SPECIES_OFFSET = 20000;
export function readEggMoves(bytes: Uint8Array): Map<number, number[]> {
  const words = readU16s(bytes);
  if (words[words.length - 1] !== 0xffff) throw new Error('egg moves: no terminator');
  const out = new Map<number, number[]>();
  let list: number[] | undefined;
  for (const w of words.slice(0, -1)) {
    if (w > EGG_MOVES_SPECIES_OFFSET) {
      const species = w - EGG_MOVES_SPECIES_OFFSET;
      if (out.has(species)) throw new Error(`egg moves: species ${species} twice`);
      out.set(species, (list = []));
    } else if (!list) throw new Error('egg moves: a move before the first species');
    else list.push(w);
  }
  return out;
}

/** Decomp sNatureStatAffinities: per nature 5 s8 (attack, defense, speed, sp. attack, sp. defense), +1 / −1 / 0. */
export function readNatureAffinities(bytes: Uint8Array, count: number): number[][] {
  if (bytes.length !== count * 5) throw new Error(`nature table: ${bytes.length} bytes for ${count} natures`);
  return Array.from({ length: count }, (_, n) => Array.from({ length: 5 }, (_, s) => ((bytes[n * 5 + s] as number) << 24) >> 24));
}

/** Decomp PokeMartCommonItems: {u16 item, u16 requiredBadges}. */
export function readCommonMart(bytes: Uint8Array): { item: number; level: number }[] {
  const words = readU16s(bytes);
  return Array.from({ length: words.length / 2 }, (_, i) => ({ item: words[i * 2]!, level: words[i * 2 + 1]! }));
}

/** A u16 item list ending with SHOP_ITEM_END (0xFFFF) at `offset`. */
export function readItemList(bytes: Uint8Array, offset: number): number[] {
  const r = new Reader(bytes);
  const out: number[] = [];
  for (let o = offset; ; o += 2) {
    const v = r.u16(o);
    if (v === 0xffff) return out;
    out.push(v);
  }
}
