/**
 * The Game Corner's tables (contracts `SlotTables`; docs/research/game-corner.md §3), read from the player's ROM. Each
 * region is checked by SHA-1 in platinum.ts (`TABLES`) before it is read here. Overlay 101's enums are u32.
 * - unk_0203D1B8.c sub_0203E484's mode list (arm9): u8 × 12.
 * - scrcmd_game_corner_prize.c sGameCornerPrizeData (arm9): {u16 item, u16 price} × 19.
 * - ov101_021D94D8.c (overlay 101): the reel strips, payouts, odds and the bonus tables (see `SlotTables`).
 * - ov101_021D1A28.c / ov101_021D0D80.c (overlay 101): the bonus orders, the stop buttons' tiles, the light show, the line
 *   palettes, the message window; ov101_021D59AC.c: the 7-line flash positions (VecFx32), the symbol animations (an
 *   identity map, checked) and the Poké Ball and Clefairy sprite members (read by the art, ui2d/slots.ts).
 */
import { SLOT, type SlotButton, type SlotTables } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { Reader } from '@opensinnoh/nds';

export const SLOT_PRIZES = 19;
export const LIGHT_SHOW = 82;
export const LINES = 5;
/** Decomp PAD_BUTTON_Y, PAD_BUTTON_B, PAD_BUTTON_A. */
const PAD: Record<number, SlotButton> = { 0x800: 'y', 0x2: 'b', 0x1: 'a' };
/** UnkEnum_ov101_021D679C_05..07: Clefairy pointing for B, Y, A. */
const POINTS = [5, 6, 7];
const FX = 4096;

export interface SlotRegions {
  modes: Uint8Array;
  prizes: Uint8Array;
  reels: Uint8Array;
  payouts: Uint8Array;
  bonusPayouts: Uint8Array;
  winChance: Uint8Array;
  winFlags: Uint8Array;
  hintChance: Uint8Array;
  standbySmall: Uint8Array;
  standbyFlags: Uint8Array;
  bonusTypes: Uint8Array;
  continueStart: Uint8Array;
  clefairyKinds: Uint8Array;
  redMoon: Uint8Array;
  blueMoon: Uint8Array;
  continueDrop: Uint8Array;
  endTells: Uint8Array;
  bonusOrders: Uint8Array;
  stopButtons: Uint8Array;
  lightShow: Uint8Array;
  linePalettes: Uint8Array;
  symbolAnims: Uint8Array;
  lineFlash: Uint8Array;
  messageWindow: Uint8Array;
}

const fail = (what: string): never => {
  throw new Error(`slots: ${what}`);
};
const u32s = (b: Uint8Array, n: number, at = 0): number[] => {
  const r = new Reader(b);
  return Array.from({ length: n }, (_, i) => r.u32(at + i * 4));
};
const percent = (v: number, what: string) => (v > 100 ? fail(`${what} is ${v}%`) : v);
const shares = (row: number[], what: string) => {
  row.forEach((v) => percent(v, what));
  if (row.reduce((a, b) => a + b, 0) > 100) fail(`${what} sums past 100%`);
  return row;
};
const byMode = (b: Uint8Array, what: string) => u32s(b, SLOT.modes).map((v) => percent(v, what));

export function readSlotTables(t: SlotRegions, o: { item: (i: number) => Id; messages: Id[]; streakVar: Id }): SlotTables {
  const modes = [...t.modes];
  if (modes.some((m) => m >= SLOT.modes)) fail(`a machine mode is out of range: ${modes}`);
  const reels = Array.from({ length: SLOT.reels }, (_, r) => u32s(t.reels, SLOT.strip, r * SLOT.strip * 4));
  if (reels.flat().some((s) => s > 5)) fail('a reel symbol is out of range');
  const winFlags = Array.from({ length: SLOT.modes }, (_, m) => {
    const r = new Reader(t.winFlags);
    return shares(Array.from({ length: 7 }, (_, i) => r.u16(m * 16 + i * 2)), `win flags of mode ${m}`);
  });
  const standbyFlags = Array.from({ length: SLOT.modes }, (_, m) => u32s(t.standbyFlags, 4, m * 16).map((v) => percent(v, 'a standby flag')));
  const bonusTypes = Array.from({ length: SLOT.modes }, (_, m) => {
    const row = Array.from({ length: 6 }, (_, i) => {
      const [chance, type, cls] = u32s(t.bonusTypes, 3, m * 72 + i * 12) as [number, number, number];
      if (type > 5 || cls > 2) fail(`bonus type row ${i} of mode ${m}: type ${type}, class ${cls}`);
      return { chance, type, class: cls };
    });
    if (row.reduce((a, b) => a + b.chance, 0) !== 100) fail(`the bonus types of mode ${m} do not sum to 100%`);
    return row;
  });
  const clefairyKinds = Array.from({ length: SLOT.modes }, (_, m) =>
    Array.from({ length: 3 }, (_, c) => {
      const row = Array.from({ length: 3 }, (_, i) => {
        const [chance, kind] = u32s(t.clefairyKinds, 2, m * 72 + c * 24 + i * 8) as [number, number];
        if (kind > 2) fail(`Clefairy kind ${kind}`);
        return { chance, kind };
      });
      if (row.reduce((a, b) => a + b.chance, 0) !== 100) fail(`the Clefairy kinds of mode ${m} class ${c} do not sum to 100%`);
      return row;
    }),
  );
  const continueDrop = Array.from({ length: SLOT.modes }, (_, m) => shares(u32s(t.continueDrop, 2, m * 8), 'a continue drop'));
  const endTells = Array.from({ length: SLOT.modes }, (_, m) =>
    Array.from({ length: 9 }, (_, i) => {
      const [min, a, b] = u32s(t.endTells, 3, m * 144 + i * 16) as [number, number, number];
      shares([a, b], 'an end tell');
      return { min, a, b };
    }),
  );
  if (endTells.some((rows) => rows.at(-1)!.min !== 0)) fail('the end tells must end at a minimum of 0');
  const bonusOrders = Array.from({ length: 6 }, (_, i) => {
    const pads = u32s(t.bonusOrders, 3, i * 24);
    const buttons = pads.map((p) => PAD[p] ?? fail(`bonus order ${i}: pad mask 0x${p.toString(16)}`));
    if (new Set(buttons).size !== 3) fail(`bonus order ${i} repeats a button`);
    const clefairy = u32s(t.bonusOrders, 3, i * 24 + 12);
    if (clefairy.some((a) => !POINTS.includes(a))) fail(`bonus order ${i}: Clefairy animations ${clefairy}`);
    return { buttons, clefairy };
  });
  const light = new Reader(t.lightShow);
  const lightShow = Array.from({ length: LIGHT_SHOW }, (_, i) => ({ mask: light.u32(i * 16), from: light.i32(i * 16 + 4) / FX, to: light.i32(i * 16 + 8) / FX, step: light.i32(i * 16 + 12) / FX }));
  if (lightShow.at(-1)!.mask !== 1 << 6) fail('the light show does not end with its restart');
  const stops = new Reader(t.stopButtons);
  const stopButtons = Array.from({ length: SLOT.reels }, (_, i) => ({ x: stops.i32(i * 8), y: stops.i32(i * 8 + 4) }));
  if (u32s(t.symbolAnims, 6).some((a, i) => a !== i)) fail('the symbol animations are not the symbols');
  const flash = new Reader(t.lineFlash);
  const lineFlash = Array.from({ length: LINES }, (_, l) => Array.from({ length: SLOT.reels }, (_, r) => ({ x: flash.i32((l * 3 + r) * 12) / FX, y: flash.i32((l * 3 + r) * 12 + 4) / FX })));
  const w = t.messageWindow;
  const r = new Reader(t.prizes);
  const prizes = Array.from({ length: SLOT_PRIZES }, (_, i) => ({ item: o.item(r.u16(i * 4)), price: r.u16(i * 4 + 2) }));
  if (o.messages.length !== 3) fail('the slot messages need TEXT_BANK_UNK_0544 0–2');
  return {
    modes,
    reels,
    payouts: u32s(t.payouts, 6),
    bonusPayouts: u32s(t.bonusPayouts, 6),
    winChance: byMode(t.winChance, 'a win chance'),
    winFlags,
    hintChance: byMode(t.hintChance, 'a hint chance'),
    standbySmall: byMode(t.standbySmall, 'a standby chance'),
    standbyFlags,
    bonusTypes,
    continueStart: u32s(t.continueStart, 6).map((v) => percent(v, 'a continue chance')),
    clefairyKinds,
    redMoon: byMode(t.redMoon, 'a red moon chance'),
    blueMoon: byMode(t.blueMoon, 'a blue moon chance'),
    continueDrop,
    endTells,
    bonusOrders,
    lightShow,
    stopButtons,
    linePalettes: u32s(t.linePalettes, LINES),
    lineFlash,
    messageWindow: { x: w[1]!, y: w[2]!, width: w[3]!, height: w[4]! },
    prizes,
    messages: o.messages,
    streakVar: o.streakVar,
  };
}

/** slotHintSprites / slotClefairySprites: {char, palette, cell, anim} NARC members per Poké Ball kind or Clefairy kind. */
export function readSpriteMembers(b: Uint8Array, count: number): { ncgr: number; nclr: number; ncer: number; nanr: number }[] {
  return Array.from({ length: count }, (_, i) => {
    const [ncgr, nclr, ncer, nanr] = u32s(b, 4, i * 16) as [number, number, number, number];
    return { ncgr, nclr, ncer, nanr };
  });
}
