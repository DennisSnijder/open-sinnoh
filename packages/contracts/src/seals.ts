/**
 * Seals and Ball Capsules (docs/research/seals.md; decomp ball_seal_info.c, include/struct_defs/seal_case.h,
 * applications/capsule_menu). The Seal Case is saved state; the seal table and the trainer capsules are imported.
 */
import type { BallSeal } from '@opensinnoh/core';

/** Decomp SEAL_ID_MAX − 1 (seal ids 1–80), CAPSULE_NUM, SEALS_PER_CAPSULE, MAX_SEALS_PER_TYPE. */
export const SEALS = { count: 80, capsules: 12, perCapsule: 8, max: 99 } as const;

/** The capsule circle on the editor's touch screen (decomp: centre (190, 70), radius 60). */
export const CAPSULE_CIRCLE = { x: 190, y: 70, r: 60 } as const;

/**
 * The Seal Case (decomp SealCase): `counts[id − 1]` the loose seals of seal id (not on a capsule); `capsules` the 12
 * capsules, each its placed seals (at most SEALS.perCapsule; the DS's empty slots are left out).
 */
export interface SealCase {
  counts: number[];
  capsules: BallSeal[][];
}

export const newSealCase = (): SealCase => ({
  counts: Array.from({ length: SEALS.count }, () => 0),
  capsules: Array.from({ length: SEALS.capsules }, () => []),
});

/**
 * One seal kind (decomp sealTypeValues row, arm9): `sheet` its cb_data NCGR member, `name` its entry in the seal name
 * banks, `particle` its ball_particle SPA member, `alphabet` an alphabet seal (A–Z, !, ?), `price` the seal shop's
 * price, `description` its entry in the shop description bank.
 */
export interface SealType {
  sheet: number;
  name: number;
  particle: number;
  alphabet: boolean;
  price: number;
  description: number;
}

/**
 * The seal tables (`NewGame.seals`): `types` indexed by seal id (0 is the dummy row), `marts` the Sunyshore seal
 * merchant's stock per MART_SEAL_ID (Monday … Sunday), `trainerCapsules` the NPC trainers' capsules
 * (pl_cb_data.narc; a trainer's `ballSeal` n ≥ 1 uses capsule n − 1), `delays` the send-out effect's start delays
 * by distance step (ov12_02237EA0's table), `ballOpen` the default burst of a send-out without a capsule (decomp
 * Unk_ov12_0223AD70, row ball − 1 for balls 1–17; rows 17–19 unused): the `ball_particle.narc` member and how many
 * of its emitters (0 … n − 1) start.
 */
export interface SealTables {
  types: SealType[];
  marts: number[][];
  trainerCapsules: BallSeal[][];
  delays: number[];
  ballOpen: { particle: number; emitters: number }[];
}

/** Decomp trainer_data.c → Pokemon_SetBallSeal: an NPC trainer's Pokémon with cbSeal n ≥ 1 has capsule id 1 and a copy of trainer capsule n − 1. */
export function trainerCapsule(tables: SealTables, ballSeal: number): { id: number; seals: BallSeal[] } {
  const seals = tables.trainerCapsules[ballSeal - 1];
  if (!seals) throw new Error(`seals: no trainer capsule ${ballSeal}`);
  return { id: 1, seals: seals.map((s) => ({ ...s })) };
}

/** The capsule grid's places (decomp CapsuleGraphics_GetCapsuleGridLocation): capsule i's centre on the top screen. */
export const capsuleGridAt = (i: number): { x: number; y: number } => ({ x: 40 + 56 * (i % 4), y: 27 + 53 * Math.floor(i / 4) });

/**
 * The Ball Capsule editor (decomp applications/capsule_menu; docs/research/seals.md §5), one composed screen in DS pixels:
 * - `select`: the capsule grid (the top screen: `capsule/main2`, the 12 capsules at `capsuleGridAt`, each holder's
 *   party icon at (−16, +12) from it, the cursor and SHIFT's second cursor), the message window and the capsule menu.
 * - `edit`: the touch screen (`capsule/sub3`): the seal list page (`list`, slot i at (19 + 56·(i % 2), 23 + 24·⌊i / 2⌋)),
 *   the loose counts, the page arrows, Test, CONFIRM and CANCEL, the capsule and its seals (`seals`, centres, back to
 *   front; `ghost` while one is held outside the circle). The top screen's seal-name line folds into `status`.
 * - `test`: the Test's still (OpenSinnoh: the DS throws the Pokémon and plays the seals' effect): `capsule/main3`, the
 *   Pokémon's front picture and the capsule's seals around it where the send-out effect starts them.
 * Seals are their `capsule/seals` cell (the seal type's NCGR member − 184). Taps: `capsule:<i>` (select: the cursor to
 * capsule i and its menu), `menu:<i>`, `next`, `yes`, `no`, `back`; in edit the stylus sends `seal:<x>,<y>` (DS px)
 * while it is down and `seal-up` when it lifts, and the buttons are hit by their DS touch rects.
 */
export interface CapsuleEditorView {
  app: 'capsule-editor';
  screen: 'select' | 'edit' | 'test';
  capsules: { sealed: boolean; holder: { species: import('@opensinnoh/core').Id; form: number; egg: boolean } | null }[];
  cursor: number;
  shift: number | null;
  seals: { cell: number; x: number; y: number; ghost: boolean }[];
  /** The list page's slots: the seal's cell and its loose count, right-aligned in 3 digits. */
  list: { cell: number; count: string }[];
  page: { index: number; count: number };
  /** The UI sprite drawn pressed (frame 1). */
  pressed: 'page-up' | 'page-down' | 'test' | 'confirm' | 'cancel' | null;
  buttons: { confirm: string; cancel: string };
  /** The keys' hand (OpenSinnoh: the DS edits by touch only), at the focused place; `grabbing` while it holds a seal. */
  hand: { x: number; y: number; grabbing: boolean } | null;
  /** The seal-name line: the touched seal's name, or the editor's refusal ("There's no more room!"). */
  status: string | null;
  message: { text: string; waiting: boolean } | null;
  menu: { entries: { label: string }[]; cursor: number } | null;
  yesNo: { yes: string; no: string; cursor: 0 | 1 } | null;
  /** The Test's Pokémon (front picture, frame 0). */
  test: { species: import('@opensinnoh/core').Id; form: number; female: boolean; shiny: boolean } | null;
  /** The screens dim (the cancel prompt). */
  dim: boolean;
}
