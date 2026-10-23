/**
 * The Veilstone Game Corner (docs/research/game-corner.md): the slot machines' tables (read from the player's ROM:
 * the launcher's mode list in arm9, the rules' tables in overlay 101), the prizes, the slot app's request, result and
 * view. The rules and their timing are services `SlotMachine`; the app (packages/menus) draws nothing itself.
 */
import type { Id } from '@opensinnoh/core';
import type { AppMessage } from './apps.ts';

/** Decomp UnkEnum_ov101_021D9688: the reel symbols (6 = no symbol, no line). */
export const SLOT_SYMBOL = { red7: 0, galactic7: 1, replay: 2, cherry: 3, pikachu: 4, moonStone: 5, none: 6 } as const;
/** Reels, strip length, machines and modes. */
export const SLOT = { reels: 3, strip: 21, machines: 12, modes: 6, maxCoins: 50000 } as const;
/** The stop buttons, left to right (decomp PAD_BUTTON_Y, _B, _A). */
export type SlotButton = 'y' | 'b' | 'a';

/**
 * 0.37.0. The slot tables (`NewGame.slots`). Every array by mode has `SLOT.modes` rows.
 * - `modes`: sub_0203E484's mode per machine id (12), shuffled each use by the daily random.
 * - `reels`: Unk_ov101_021D9688, the symbol at each strip index (3 × 21).
 * - `payouts` / `bonusPayouts`: coins per winning line by symbol, in normal play and in bonus rounds.
 * - `winChance`: % a normal spin draws any flag; `winFlags`: the 7 flag shares in check order (bits 3, 2, 7, 6, 5, 4, 1;
 *   the rest is bit 0); `hintChance`: % the Poké Ball shows the flag's symbol.
 * - `standbySmall`: % a standby spin draws a small flag; `standbyFlags`: its shares (cherries, Moon Stone; the DS reads
 *   entry 1 twice and never entries 2 and 3).
 * - `bonusTypes`: per mode, 6 rows of {chance, type, class}; `continueStart` by type; `clefairyKinds` [mode][class][3]
 *   {chance, kind}.
 * - `redMoon` / `blueMoon`: % per bonus spin; `continueDrop`: [mode] [% for −10, % for −5]; `endTells`: [mode] 9 rows
 *   {min chance, % of tell A, % of tell B}.
 * - `bonusOrders`: Unk_ov101_021D87A8, the bonus stop orders and Clefairy's pointing animation per button.
 * - `lightShow`: Unk_ov101_021D8938, the attract light show {mask, from, to, step} (levels in 16ths).
 * - `stopButtons`: the stop buttons' BG1 tiles; `linePalettes`: the line lamps' BG1 palettes (line bit order);
 *   `lineFlash`: the 7-line flash positions per line and reel (px); `messageWindow`: the message window (tiles).
 * - `prizes`: sGameCornerPrizeData, the Prize Exchange's items and prices.
 * - `messages`: TEXT_BANK_UNK_0544's three messages; `streakVar`: VAR_CONSECUTIVE_BONUS_ROUND_WINS.
 */
export interface SlotTables {
  modes: number[];
  reels: number[][];
  payouts: number[];
  bonusPayouts: number[];
  winChance: number[];
  winFlags: number[][];
  hintChance: number[];
  standbySmall: number[];
  standbyFlags: number[][];
  bonusTypes: { chance: number; type: number; class: number }[][];
  continueStart: number[];
  clefairyKinds: { chance: number; kind: number }[][][];
  redMoon: number[];
  blueMoon: number[];
  continueDrop: number[][];
  endTells: { min: number; a: number; b: number }[][];
  bonusOrders: { buttons: SlotButton[]; clefairy: number[] }[];
  lightShow: { mask: number; from: number; to: number; step: number }[];
  stopButtons: { x: number; y: number }[];
  linePalettes: number[];
  lineFlash: { x: number; y: number }[][];
  messageWindow: { x: number; y: number; width: number; height: number };
  prizes: { item: Id; price: number }[];
  messages: Id[];
  streakVar: Id;
}

/**
 * 0.37.0. Decomp ScrCmd_267 → sub_0203E414: the slot machine `machine` in `mode` (the day's shuffle), its session
 * LCRNG seeded by `seed` (one draw of the game's main stream: our choice, docs/research/game-corner.md §4.2).
 */
export interface SlotsRequest {
  app: 'slots';
  machine: number;
  mode: number;
  seed: number;
}

/**
 * 0.37.0. What the slot app hands back (ov101_021D0F3C): the coins (capped at 50000), the session's best bonus streak
 * (rounds in one bonus that ended normally) and the bonus rounds played (RECORD_UNK_014).
 */
export interface SlotsResult {
  app: 'slots';
  coins: number;
  streak: number;
  rounds: number;
}

/**
 * 0.37.0. The slot machine, one 30 Hz frame per view, in DS px of its two screens folded into one composition: `main`
 * things are on the DS top screen (the machine, 256×192), `sub` things on the bottom one (the moonlit field).
 * - `reels`: per reel the five symbol sprites (centre y on the main screen, symbol id); `stops` each stop button's
 *   state (armed: BG palette 5, pressed: 6); `lamps` the five line lamps' light (0–16, line bit order); `credit` and
 *   `payout` the counters (payout 0 = hidden).
 * - `ball`: the Poké Ball hint (kind 0–4, its animation and frame, sub-screen centre, scale, rotation in degrees);
 *   `sparkle`: its sparkle's frame; `clefairy`: kind, animation, frame, centre y, scale; `pikachu`: the two peeking
 *   Pikachu's centres (the right one mirrored); `sevens`: the 7-line flash (the symbol, its three centres in the DS's
 *   joint OAM space: main-screen y, then 192 + sub-screen y; `from`: the y they started at).
 * - `counters`: the bonus round's small counters (spins left, coins gained); `banner`: the round number shown at a
 *   round start; `summary`: the 2× counters at the bonus end (rounds, coins gained).
 * - `field`: the moonlit field's palette: `bonus` the blend toward the bonus colouring (0–16), `moon` a moon pulse.
 * - `fade`: the screen's brightness fade (0 shown … 16 black). `message`: the message box (A or B closes it).
 * Taps: `stop:<0–2>` (Y, B, A), `bet` (X), `spin` (↓), `quit` (START), `next` (A).
 */
export interface SlotsView {
  app: 'slots';
  tick: number;
  fade: number;
  reels: { y: number; symbol: number }[][];
  stops: ('armed' | 'pressed')[];
  lamps: number[];
  credit: number;
  payout: number;
  ball: { kind: number; anim: number; frame: number; x: number; y: number; scale: number; rotation: number } | null;
  sparkle: { frame: number } | null;
  clefairy: { kind: number; anim: number; frame: number; y: number; scale: number } | null;
  pikachu: { left: { x: number; y: number }; right: { x: number; y: number } } | null;
  sevens: { symbol: number; from: number; at: { x: number; y: number }[] } | null;
  counters: { spins: number; gained: number } | null;
  banner: { round: number; frame: number } | null;
  summary: { rounds: number; gained: number } | null;
  field: { bonus: number; moon: { kind: 'red' | 'blue'; level: number } | null };
  message: AppMessage | null;
}
