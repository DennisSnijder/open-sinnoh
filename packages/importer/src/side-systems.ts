/**
 * The side systems' tables (docs/research/berries-honey-radar.md; decomp berry_patches.c, scrcmd_move_tutor.c,
 * npc_trade.c): berry growth data and the new game's patches, the shard tutors, the in-game trades.
 */
import type { BerryTables, MoveTutorTables, NpcTrade } from '@opensinnoh/contracts';
import { STATS, type Id, type Stats } from '@opensinnoh/core';
import { Reader, readNarc, type NitroFs } from '@opensinnoh/nds';

/** Decomp NUM_BERRIES and FIRST_BERRY_IDX (ITEM_CHERI_BERRY). */
const NUM_BERRIES = 64;
const FIRST_BERRY = 149;
/** Decomp FIRST_MULCH_IDX (ITEM_GROWTH_MULCH): Growth, Damp, Stable, Gooey. */
const FIRST_MULCH = 95;
/** OBJ_EVENT_GFX_BERRY_SOIL, OBJ_EVENT_GFX_BERRY_SPROUT; a berry's trees are SPROUT + berry × 3 + 1…3 (berry_tree_obj_event_gfx.h). */
export const BERRY_SOIL_GFX = 100;
export const BERRY_SPROUT_GFX = 4096;
export const berryTreeGfx = (berry: number, stage: 1 | 2 | 3) => BERRY_SPROUT_GFX + berry * 3 + stage;
/** Decomp sizeof(BerryData) (nuts_data members). */
const BERRY_DATA_SIZE = 12;
/** Decomp ITEM_RED_SHARD … ITEM_GREEN_SHARD. */
const FIRST_SHARD = 72;
/** Decomp sizeof(TeachableMove) and MOVESET_MASK_SIZE. */
export const TUTOR_MOVE_SIZE = 12;
export const TUTOR_MASK_SIZE = 5;
/** Decomp sizeof(NPCTradeMon): 20 u32. */
const NPC_TRADE_SIZE = 80;
/** NPCTradeMon IV fields in order: hp, atk, def, speed, spAtk, spDef (u32 1–6). */
const TRADE_IVS: (keyof Stats)[] = ['hp', 'attack', 'defense', 'speed', 'spAttack', 'spDefense'];

export interface SideContext {
  fs: NitroFs;
  item: (i: number) => Id;
  species: (i: number) => Id;
  move: (i: number) => Id;
  sprite: (gfx: number) => Id;
  /** The `fieldEffects` id of a fldeff model effect. */
  moistureEffects: [Id, Id, Id];
  /** OBJ_EVENT_GFX_PLAYER_M/F_SPRAYDUCK. */
  sprayduck: { male: Id; female: Id };
  /** TEXT_BANK_NPC_TRADE_NAMES message n, plain text. */
  tradeName: (n: number) => string;
}

/** decomp nuts_data (BerryData: u16 size, u8 firmness, baseYield, stageDuration, moistureDrainRate, the five flavours, smoothness) and sBerryInitTable ({u16 item, u16 yield}). */
export function readBerryTables(ctx: SideContext, initTable: Uint8Array, searcherTable: Uint8Array): BerryTables {
  const nuts = readNarc(ctx.fs.file('/itemtool/itemdata/nuts_data.narc'));
  if (nuts.length !== NUM_BERRIES) throw new Error(`nuts_data: ${nuts.length} members, expected ${NUM_BERRIES}`);
  const berries = nuts.map((m, i) => {
    if (m.length !== BERRY_DATA_SIZE) throw new Error(`nuts_data ${i}: ${m.length} bytes, expected ${BERRY_DATA_SIZE}`);
    const r = new Reader(m);
    const stageHours = r.u8(4);
    if (!stageHours) throw new Error(`nuts_data ${i}: stage duration 0`);
    return {
      item: ctx.item(FIRST_BERRY + i),
      stageHours,
      drain: r.u8(5),
      baseYield: r.u8(3),
      sprites: { growing: ctx.sprite(berryTreeGfx(i, 1)), blooming: ctx.sprite(berryTreeGfx(i, 2)), fruit: ctx.sprite(berryTreeGfx(i, 3)) },
      flavors: [r.u8(6), r.u8(7), r.u8(8), r.u8(9), r.u8(10)] as [number, number, number, number, number],
      smoothness: r.u8(11),
    };
  });
  const init = new Reader(initTable);
  const patches = Array.from({ length: initTable.length / 4 }, (_, i) => {
    const item = init.u16(i * 4);
    if (item < FIRST_BERRY || item >= FIRST_BERRY + NUM_BERRIES) throw new Error(`berry init ${i}: item ${item} is not a berry`);
    return { item: ctx.item(item), yield: init.u16(i * 4 + 2) };
  });
  return {
    berries,
    patches,
    mulches: [0, 1, 2, 3].map((k) => ctx.item(FIRST_MULCH + k)) as BerryTables['mulches'],
    soil: ctx.sprite(BERRY_SOIL_GFX),
    sprout: ctx.sprite(BERRY_SPROUT_GFX),
    moisture: ctx.moistureEffects,
    sprayduck: ctx.sprayduck,
    searcher: Array.from({ length: searcherTable.length / 2 }, (_, i) => ({ x: searcherTable[i * 2]!, y: searcherTable[i * 2 + 1]! })),
  };
}

/** Decomp sTeachableMoves ({u16 move, u8 red, blue, yellow, green, pad, u32 location}). */
export function readTutorTables(ctx: SideContext, moves: Uint8Array): MoveTutorTables {
  const r = new Reader(moves);
  return {
    shards: [0, 1, 2, 3].map((k) => ctx.item(FIRST_SHARD + k)) as MoveTutorTables['shards'],
    moves: Array.from({ length: moves.length / TUTOR_MOVE_SIZE }, (_, i) => {
      const o = i * TUTOR_MOVE_SIZE;
      const location = r.u32(o + 8);
      if (location > 2) throw new Error(`tutor move ${i}: location ${location}`);
      return { move: ctx.move(r.u16(o)), cost: [r.u8(o + 2), r.u8(o + 3), r.u8(o + 4), r.u8(o + 5)], location };
    }),
  };
}

/** Decomp NATIONAL_DEX_COUNT: masks 0–492 are species 1–493, then one per data form (MOVESET_FORM_*, data form order). */
const NATIONAL_DEX_COUNT = 493;

/**
 * Decomp sSpeciesLearnsetsByTutor (Pokemon_ReadMovesetMaskByte): bit i teaches sTeachableMoves[i]. `species` is the
 * species index, `form` the data form's index (names.json `dataForms`) or null for the species itself; species past
 * the National Dex (the Egg) teach nothing.
 */
export function tutorMovesOf(masks: Uint8Array, tutorMoves: Id[], species: number, form: number | null): Id[] {
  const index = form !== null ? NATIONAL_DEX_COUNT + form : species >= 1 && species <= NATIONAL_DEX_COUNT ? species - 1 : -1;
  if (index < 0) return [];
  const mask = masks.subarray(index * TUTOR_MASK_SIZE, (index + 1) * TUTOR_MASK_SIZE);
  if (mask.length !== TUTOR_MASK_SIZE) throw new Error(`tutor masks: no entry ${index}`);
  return tutorMoves.filter((_, i) => (mask[i >> 3]! >> (i & 7)) & 1);
}

/** Decomp fld_trade.narc (NPCTradeMon) and TEXT_BANK_NPC_TRADE_NAMES (nickname n, OT name MAX_NPC_TRADES + n). */
export function readNpcTrades(ctx: SideContext): NpcTrade[] {
  const members = readNarc(ctx.fs.file('/fielddata/pokemon_trade/fld_trade.narc'));
  return members.map((m, n) => {
    if (m.length !== NPC_TRADE_SIZE) throw new Error(`fld_trade ${n}: ${m.length} bytes, expected ${NPC_TRADE_SIZE}`);
    const r = new Reader(m);
    const u = (k: number) => r.u32(k * 4);
    const ivs = Object.fromEntries(STATS.map((s) => [s, u(1 + TRADE_IVS.indexOf(s))])) as Stats;
    const otGender = u(16);
    if (otGender > 1) throw new Error(`fld_trade ${n}: OT gender ${otGender}`);
    return {
      species: ctx.species(u(0)),
      requested: ctx.species(u(19)),
      pid: u(14),
      otId: u(8),
      otName: ctx.tradeName(members.length + n),
      otGender: otGender ? 'female' : 'male',
      nickname: ctx.tradeName(n),
      ivs,
      heldItem: u(15) ? ctx.item(u(15)) : null,
      language: u(18),
      condition: { cool: u(9), beauty: u(10), cute: u(11), smart: u(12), tough: u(13) },
    };
  });
}
