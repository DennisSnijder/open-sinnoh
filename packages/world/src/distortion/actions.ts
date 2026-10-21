import type { Facing } from '@opensinnoh/contracts';

/**
 * The Distortion World's movement actions 105–116 (walk and surf, 8 frames) and 121–132 (run, 4 frames)
 * (decomp unk_020655F4.c sub_02066824 callers): one tile on one axis of the shared space, the sprite drawn facing
 * `face` (MapObject_TryFace) and the moving direction turned to `turn` (MapObject_Turn). The east wall's +z steps
 * turn west, as the decomp's tables have them.
 */
export interface DwStep {
  d: readonly [number, number, number];
  face: Facing;
  turn: Facing;
  ticks: number;
  anim: 'walk' | 'run';
}

const step = (d: [number, number, number], face: Facing, turn: Facing, run: boolean): DwStep => ({ d, face, turn, ticks: run ? 4 : 8, anim: run ? 'run' : 'walk' });

const table = (run: boolean): DwStep[] => [
  // West wall (105–108 / 121–124): up +y, down −y, left +z, right −z.
  step([0, 1, 0], 'left', 'up', run),
  step([0, -1, 0], 'right', 'down', run),
  step([0, 0, 1], 'down', 'left', run),
  step([0, 0, -1], 'up', 'right', run),
  // East wall (109–112 / 125–128): up +y, down −y, left −z, right +z.
  step([0, 1, 0], 'right', 'up', run),
  step([0, -1, 0], 'left', 'down', run),
  step([0, 0, -1], 'up', 'left', run),
  step([0, 0, 1], 'down', 'left', run),
  // Ceiling (113–116 / 129–132): up +z, down −z, left −x, right +x.
  step([0, 0, 1], 'down', 'up', run),
  step([0, 0, -1], 'up', 'down', run),
  step([-1, 0, 0], 'right', 'left', run),
  step([1, 0, 0], 'left', 'right', run),
];

/** The ceiling's faster steps 145–148 (4 frames) and 149–152 (2 frames): the waterfall's ride away (cascade up). */
const ceilingFast = (ticks: number): DwStep[] =>
  [
    step([0, 0, 1], 'down', 'up', false),
    step([0, 0, -1], 'up', 'down', false),
    step([-1, 0, 0], 'right', 'left', false),
    step([1, 0, 0], 'left', 'right', false),
  ].map((s) => ({ ...s, ticks }));

/** By movement action number. */
export const DW_STEPS: ReadonlyMap<number, DwStep> = new Map([
  ...table(false).map((s, i) => [105 + i, s] as const),
  ...table(true).map((s, i) => [121 + i, s] as const),
  ...ceilingFast(4).map((s, i) => [145 + i, s] as const),
  ...ceilingFast(2).map((s, i) => [149 + i, s] as const),
]);

export type Upright = 'west-wall' | 'east-wall' | 'ceiling';
const FIRST: Record<Upright, number> = { 'west-wall': 105, 'east-wall': 109, ceiling: 113 };
const ORDER: Facing[] = ['up', 'down', 'left', 'right'];

/** PlayerAvatar_SetMovement_Distortion{WestWall,EastWall,Ceiling}'s walk (and surf) or run action for an input. */
export function uprightStep(surface: Upright, dir: Facing, run: boolean): DwStep {
  const s = DW_STEPS.get(FIRST[surface] + ORDER.indexOf(dir) + (run ? 16 : 0));
  if (!s) throw new Error(`world: no Distortion World step for ${surface} ${dir}`);
  return s;
}

/** MOVEMENT_ACTION_JUMP_DISTORTION_WORLD_*: 2 units a frame for 24 frames (3 tiles), arc rate 0xA0. */
export const DW_JUMP = { tiles: 3, ticks: 24, rate: 0xa0 } as const;
