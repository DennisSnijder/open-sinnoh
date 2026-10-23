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
 * by distance step (ov12_02237EA0's table).
 */
export interface SealTables {
  types: SealType[];
  marts: number[][];
  trainerCapsules: BallSeal[][];
  delays: number[];
}
