/**
 * The seal tables (docs/research/seals.md §3.2, §4.2, §6.2, §9): the seal table (capsule_menu/main.c sealTypeValues,
 * arm9), the Sunyshore seal merchant's stock per weekday (mart_items.h SunyshoreMarketDailyStocks: a pointer per
 * MART_SEAL_ID to a 0xFFFF-ended list), the NPC trainers' capsules (pl_cb_data.narc member 0, 128 decomp BallCapsules)
 * and the send-out effect's delay table (ov12_02237EA0). Strictly checked: an unexpected size, id or position fails.
 */
import type { BallSeal } from '@opensinnoh/core';
import { SEALS, type SealTables, type SealType } from '@opensinnoh/contracts';
import { Reader, readNarc } from '@opensinnoh/nds';

/** Decomp sealTypeValues row: u16 memberIdx, u8 nameIndex, u8 unused, u8 particleIndex, u8 isAlphabetSeal, u16 price, u8 nonAlphabetIndex, u8 padding. */
export const SEAL_TYPE_SIZE = 10;
/** Decomp BallCapsule: SEALS_PER_CAPSULE × {u8 type, u8 x, u8 y}. */
const CAPSULE_SIZE = SEALS.perCapsule * 3;
/** pl_cb_data's capsules (one per trainer cbSeal value 1–128). */
export const TRAINER_CAPSULES = 128;
/** cb_data.narc's seal NCGRs (§5.5) and ball_particle.narc's seal SPAs (§6.1). */
const SEAL_MEMBERS = { first: 184, last: 264 };
const SEAL_PARTICLES = { first: 37, last: 116 };

export interface SealRomTables {
  types: Uint8Array;
  /** The pointer table and the arm9 it points into (its RAM base). */
  marts: Uint8Array;
  arm9: Uint8Array;
  arm9Ram: number;
  delays: Uint8Array;
  /** /application/custom_ball/edit/pl_cb_data.narc. */
  trainerCapsules: Uint8Array;
  /** The name and description banks' sizes (12 and 542). */
  names: number;
  descriptions: number;
}

export function readSealTables(t: SealRomTables): SealTables {
  const r = new Reader(t.types);
  const types = Array.from({ length: SEALS.count + 1 }, (_, id): SealType => {
    const o = id * SEAL_TYPE_SIZE;
    const row: SealType = { sheet: r.u16(o), name: r.u8(o + 2), particle: r.u8(o + 4), alphabet: r.u8(o + 5) === 1, price: r.u16(o + 6), description: r.u8(o + 8) };
    if (id === 0) return row;
    if (row.sheet < SEAL_MEMBERS.first || row.sheet > SEAL_MEMBERS.last) throw new Error(`seal ${id}: cb_data member ${row.sheet}`);
    if (row.particle < SEAL_PARTICLES.first || row.particle > SEAL_PARTICLES.last) throw new Error(`seal ${id}: ball_particle member ${row.particle}`);
    if (r.u8(o + 5) > 1) throw new Error(`seal ${id}: isAlphabetSeal ${r.u8(o + 5)}`);
    if (row.name >= t.names) throw new Error(`seal ${id}: name ${row.name} past the ${t.names} names`);
    if (row.description >= t.descriptions) throw new Error(`seal ${id}: description ${row.description} past the ${t.descriptions} descriptions`);
    return row;
  });

  const arm9 = new Reader(t.arm9);
  const ptrs = new Reader(t.marts);
  const marts = Array.from({ length: t.marts.length / 4 }, (_, k) => {
    const out: number[] = [];
    for (let o = ptrs.u32(k * 4) - t.arm9Ram; ; o += 2) {
      const id = arm9.u16(o);
      if (id === 0xffff) break;
      if (id < 1 || id > SEALS.count) throw new Error(`seal mart ${k}: seal ${id}`);
      out.push(id);
    }
    return out;
  });

  const narc = readNarc(t.trainerCapsules);
  if (narc.length !== 1 || narc[0]!.length !== TRAINER_CAPSULES * CAPSULE_SIZE) throw new Error(`pl_cb_data: ${narc.length} members, member 0 of ${narc[0]?.length} bytes`);
  const cb = narc[0]!;
  const trainerCapsules = Array.from({ length: TRAINER_CAPSULES }, (_, c): BallSeal[] => {
    const seals: BallSeal[] = [];
    for (let s = 0; s < SEALS.perCapsule; s++) {
      const o = c * CAPSULE_SIZE + s * 3;
      const seal = { seal: cb[o]!, x: cb[o + 1]!, y: cb[o + 2]! };
      if (seal.seal === 0) continue;
      if (seal.seal > SEALS.count) throw new Error(`trainer capsule ${c}: seal ${seal.seal}`);
      seals.push(seal);
    }
    return seals;
  });

  return { types, marts, trainerCapsules, delays: [...t.delays] };
}
