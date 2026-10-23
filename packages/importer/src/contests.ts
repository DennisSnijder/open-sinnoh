/**
 * The Super Contests' tables (docs/research/contests.md): contest_data.narc's opponents (member 0, decomp
 * UnkStruct_ov6_02248BE8), judges (member 1, UnkStruct_020954F0), NPC outfits (member 2, UnkStruct_020951B0) and the
 * twelve visual themes' accessory points (members 3–14, ov17_02252A70). Strictly checked: an unexpected size, id or
 * bit fails the import.
 */
import { ACCESSORIES, CONTEST_THEMES, type ContestAccessory, type ContestActingTables, type ContestDanceTables, type ContestDressUp, type ContestJudge, type ContestOpponent, type ContestTables } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { Reader, readNarc } from '@opensinnoh/nds';

const OPPONENT_SIZE = 48;
const JUDGE_SIZE = 8;
const DRESS_UP_SIZE = 84;
/** Decomp UnkStruct_020951B0: 20 placements of 4 bytes, then count, mon priority (s8), backdrop. */
const DRESS_UP_SLOTS = 20;
const MEMBERS = 3 + CONTEST_THEMES;

export interface ContestContext {
  species: (i: number) => Id;
  move: (i: number) => Id;
  /** TEXT_BANK_CONTEST_OPPONENT_NAMES / TEXT_BANK_CONTEST_JUDGE_NAMES message ids. */
  opponentName: (n: number) => Id;
  judgeName: (n: number) => Id;
  opponentNames: number;
  judgeNames: number;
  playerGfx: { male: number; female: number };
  playerSprite: { male: Id; female: Id };
  /** The Dance Competition's tables (contest-dance.ts, overlay 17). */
  dance: ContestDanceTables;
  /** The accessories' pictures (ui2d/contests.ts `accessoryPictures`). */
  accessories: ContestAccessory[];
  /** The acting round's tables (contest-acting.ts). */
  acting: ContestActingTables;
}

const s8 = (b: number) => (b << 24) >> 24;

export function readContestTables(narc: Uint8Array, ctx: ContestContext): ContestTables {
  const m = readNarc(narc);
  if (m.length !== MEMBERS) throw new Error(`contest_data: ${m.length} members, expected ${MEMBERS}`);
  const [opp, jud, dress] = m as [Uint8Array, Uint8Array, Uint8Array];
  for (const [what, b, size] of [['opponents', opp, OPPONENT_SIZE], ['judges', jud, JUDGE_SIZE], ['outfits', dress, DRESS_UP_SIZE]] as const) {
    if (b.length % size) throw new Error(`contest_data ${what}: ${b.length} bytes is not a multiple of ${size}`);
  }
  const dressCount = dress.length / DRESS_UP_SIZE;
  const name = (n: number, count: number, of: (n: number) => Id, what: string) => {
    if (n >= count) throw new Error(`contest_data: ${what} ${n} is past the ${count} names`);
    return of(n);
  };
  const opponents = Array.from({ length: opp.length / OPPONENT_SIZE }, (_, i): ContestOpponent => {
    const r = new Reader(opp.subarray(i * OPPONENT_SIZE, (i + 1) * OPPONENT_SIZE));
    const bits = r.u16(0x20);
    const rank = bits & 7;
    if (rank > 3) throw new Error(`contest_data opponent ${i}: rank ${rank}`);
    const moves = [0, 1, 2, 3].map((k) => r.u16(0x0c + k * 2)).filter((mv) => mv !== 0).map(ctx.move);
    const dressUps = Array.from({ length: CONTEST_THEMES }, (_, k) => r.u8(0x22 + k));
    if (dressUps.some((d) => d >= dressCount)) throw new Error(`contest_data opponent ${i}: an outfit past the ${dressCount} outfits`);
    const gender = (bits >> 12) & 3;
    if (gender > 1) throw new Error(`contest_data opponent ${i}: gender ${gender}`);
    return {
      species: ctx.species(r.u16(0x14)),
      moves,
      nickname: name(r.u16(0x16), ctx.opponentNames, ctx.opponentName, 'opponent name'),
      trainerName: name(r.u16(0x18), ctx.opponentNames, ctx.opponentName, 'trainer name'),
      condition: { cool: r.u8(0x1a), beauty: r.u8(0x1b), cute: r.u8(0x1c), smart: r.u8(0x1d), tough: r.u8(0x1e), sheen: r.u8(0x1f) },
      rank,
      types: [0, 1, 2, 3, 4].filter((t) => (bits >> (3 + t)) & 1),
      single: !!((bits >> 8) & 1),
      practice: !!((bits >> 9) & 1),
      pool: ((bits >> 10) & 3) as 0 | 1 | 2 | 3,
      gender: gender ? 'female' : 'male',
      aiLevel: (bits >> 14) & 3,
      gfx: r.u16(0x08),
      trainerClass: r.u16(0x0a),
      fame: r.u8(0x2e),
      dressUps,
    };
  });
  const judges = Array.from({ length: jud.length / JUDGE_SIZE }, (_, i): ContestJudge => {
    const r = new Reader(jud.subarray(i * JUDGE_SIZE, (i + 1) * JUDGE_SIZE));
    const bits = r.u16(4);
    return { name: name(r.u16(0), ctx.judgeNames, ctx.judgeName, 'judge name'), rank: (bits >> 10) & 3, roles: [0, 1, 2, 3, 4].map((t) => (bits >> (t * 2)) & 3) };
  });
  const dressUps = Array.from({ length: dressCount }, (_, i): ContestDressUp => {
    const b = dress.subarray(i * DRESS_UP_SIZE, (i + 1) * DRESS_UP_SIZE);
    const n = b[DRESS_UP_SLOTS * 4]!;
    if (n > DRESS_UP_SLOTS) throw new Error(`contest_data outfit ${i}: ${n} accessories`);
    const accessories = Array.from({ length: n }, (_, k) => ({ accessory: b[k * 4]!, x: b[k * 4 + 1]!, y: b[k * 4 + 2]!, priority: s8(b[k * 4 + 3]!) }));
    if (accessories.some((a) => a.accessory >= ACCESSORIES.count)) throw new Error(`contest_data outfit ${i}: an accessory past ${ACCESSORIES.count}`);
    const backdrop = b[DRESS_UP_SLOTS * 4 + 2]!;
    if (backdrop >= ACCESSORIES.backdrops) throw new Error(`contest_data outfit ${i}: backdrop ${backdrop}`);
    return { accessories, monPriority: s8(b[DRESS_UP_SLOTS * 4 + 1]!), backdrop };
  });
  const themes = m.slice(3).map((t, k) => {
    if (t.length !== ACCESSORIES.count) throw new Error(`contest_data theme ${k}: ${t.length} bytes, expected ${ACCESSORIES.count}`);
    return [...t];
  });
  if (ctx.accessories.length !== ACCESSORIES.count) throw new Error(`contest accessories: ${ctx.accessories.length} pictures, expected ${ACCESSORIES.count}`);
  return { opponents, judges, dressUps, themes, playerGfx: ctx.playerGfx, playerSprite: ctx.playerSprite, accessories: ctx.accessories, dance: ctx.dance, acting: ctx.acting };
}
