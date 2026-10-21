import type { BillboardSprite } from '@opensinnoh/contracts';
import { BILLBOARD_DIRECTIONS, textureAt, type FrameSequence, type SpriteAtlas } from '@opensinnoh/g3d';
import type { BillboardAnim } from './object-gfx.ts';

type Animations = BillboardSprite['animations'];

/** decomp `BillboardFrameSequence` names (lower case, `-` separated); mmodel member = 445 + index. */
export const FRAME_SEQ_NAMES = [
  'generic-walk', 'walk-and-run', 'berry-tree', 'bike', 'holding-poke-ball', 'spray-duck', 'surf', 'starly',
  'alternating-frames', 'contest', 'fishing', 'pokecenter-nurse', 'magikarp', 'poketch', 'save', 'heal-pokecenter',
  'arceus', 'darkrai', 'cresselia', 'giratina-altered', 'heatran', 'giratina-origin', 'vs-seeker',
] as const;

/**
 * Pose names for animations that are not walk/run, by frame sequence. A name ending in `-<dir>` marks
 * four direction-indexed animations (the DS picks them by facing). Sources: the movement actions that
 * set the anim code (decomp unk_020655F4.c: PlayerGive → code 0 → anim 0, PlayerReceive → code 1 →
 * anim 1, PokecenterNurseBow → code 9 → anim 4) and the per-gfx renderers in ov5_021EB1A0.c.
 */
const POSE_NAMES: Partial<Record<(typeof FRAME_SEQ_NAMES)[number], Record<number, string>>> = {
  'pokecenter-nurse': { 4: 'pose-bow' },
  'heal-pokecenter': { 0: 'pose-give', 1: 'pose-receive' },
  surf: { 0: 'pose-surf-up', 1: 'pose-surf-down', 2: 'pose-surf-left', 3: 'pose-surf-right' },
  poketch: { 0: 'pose-poketch-up', 1: 'pose-poketch-down', 2: 'pose-poketch-left', 3: 'pose-poketch-right' },
  save: { 0: 'pose-save' },
  'vs-seeker': { 0: 'pose-vs-seeker' },
  'holding-poke-ball': { 0: 'pose-holding-poke-ball' },
};

/**
 * Sprite animations from an object gfx's DS animation table. Animations 0–3 that are 16-frame loops
 * at 0, 16, 32, 48 are `walk-<dir>` (and 4–7 at 64.. are `run-<dir>`); `stand-<dir>` is the first
 * frame of the walk. Every other animation is a pose (`POSE_NAMES`, else `pose-<sequence>-<index>`).
 * Sets without walks stand on the first frame of their first animation (or of the facing's pose when
 * the poses are direction-indexed). Frames are inclusive, one per 30 Hz tick (decomp billboard.c).
 */
export function frameTableAnimations(seq: FrameSequence, seqIndex: number, atlas: SpriteAtlas, anims: BillboardAnim[]): Animations {
  const seqName = FRAME_SEQ_NAMES[seqIndex];
  if (!seqName) throw new Error(`frame table: unknown frame sequence ${seqIndex}`);
  const frameAt = (f: number) => {
    const slot = atlas.frameOfTexture[textureAt(seq, f)];
    if (slot === undefined) throw new Error(`frame table ${seqName}: frame ${f} names texture ${textureAt(seq, f)} beyond ${atlas.frameCount} textures`);
    return slot;
  };
  const frames = (a: BillboardAnim) => {
    const list: { frame: number; ticks: number }[] = [];
    for (let f = a.start; f <= a.end; f++) {
      const frame = frameAt(f);
      const last = list[list.length - 1];
      if (last && last.frame === frame) last.ticks++;
      else list.push({ frame, ticks: 1 });
    }
    return list;
  };
  const isWalk = (k: number) => anims[k]?.loop === true && anims[k]!.start === k * 16 && anims[k]!.end === k * 16 + 15;
  const walks = [0, 1, 2, 3].every(isWalk);
  const runs = walks && [4, 5, 6, 7].every(isWalk);
  const out: Animations = {};
  anims.forEach((a, k) => {
    if (walks && k < 4) out[`walk-${BILLBOARD_DIRECTIONS[k]}`] = frames(a);
    else if (runs && k < 8) out[`run-${BILLBOARD_DIRECTIONS[k - 4]}`] = frames(a);
    else out[POSE_NAMES[seqName]?.[k] ?? `pose-${seqName}-${k}`] = frames(a);
  });
  const facingPose = (dir: string) => Object.keys(out).find((k) => k.startsWith('pose-') && k.endsWith(`-${dir}`));
  BILLBOARD_DIRECTIONS.forEach((dir) => {
    const pose = facingPose(dir);
    const first = (walks ? out[`walk-${dir}`]! : pose ? out[pose]! : frames(anims[0]!))[0]!;
    out[`stand-${dir}`] = [{ frame: first.frame, ticks: 1 }];
    out[`walk-${dir}`] ??= [{ frame: first.frame, ticks: 1 }];
  });
  return out;
}
