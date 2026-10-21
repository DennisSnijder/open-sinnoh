import type { DistortionRoom, DistortionWorldTables, DwPropKind } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import type { FieldSound } from '../sound.ts';
import { TILE } from '../tiles.ts';

/**
 * A floor's ghost props (decomp DistWorldGhostPropManager and the platform/obstacle prop animators): groups of
 * props shown or hidden by direction + box triggers (`DistortionWorld.moved`). Drawn only: a hidden group's props
 * fade out, a shown group's fade in; platforms bob, obstacles (vines, rocks) play their clip forward or back. No
 * collision changes with them (the rooms' land and supports carry it).
 */

/** GHOST_PROP_OPACITY_MAX. */
export const GHOST_OPACITY_MAX = 31;
/** PLATFORM_PROP_ANIM_DELTA and sPlatformPropAnimOffsets (fx32 heights by eighth of the bob). */
const BOB_DELTA = 0x800;
const BOB_OFFSETS = [0, -0x1000, -0x2000, -0x4000, -0x5000, -0x5800, -0x5c00, -0x6000];
const FX = 4096;
/** OBSTACLE_PROP_ANIM_DELTA. */
const OBSTACLE_DELTA = 2;
const OBSTACLES = new Set<DwPropKind>(['land-vine-flower', 'land-rock']);
/** The ghost props' sounds (SEQ_SE_PL_SYUWA3; obstacles SEQ_SE_PL_MEKI/MEKI2, rocks SEQ_SE_PL_FW089_2), by sequence name. */
const SOUNDS = { platform: 'SEQ_SE_PL_SYUWA3', rockAppear: 'SEQ_SE_PL_FW089_2', rockDisappear: 'SEQ_SE_PL_FW089_2', appear: 'SEQ_SE_PL_MEKI', disappear: 'SEQ_SE_PL_MEKI2' } as const;

interface GhostProp {
  group: number;
  prop: DwPropKind;
  anchor: [number, number, number];
  opacity: number;
  /** Platforms: the bob (fx32 progress through eight steps, its direction); obstacles: the clip frame. */
  progress: number;
  delta: number;
  frame: number;
  /** Platforms: this frame's bob height (fx32). */
  bob: number;
  sound: 'none' | 'appear' | 'disappear';
}

/** A drawn prop as `DistortionView.props` wants it, without its last position. */
export interface GhostDraw {
  key: string;
  prop: DwPropKind;
  cur: [number, number, number];
  opacity: number;
  frame?: number;
}

/**
 * The platforms' bob starts at LCRNG_Next() % (8 × FX32_ONE), its direction by the low bit: the DS draws it from
 * the global LCRNG. Drawn only, so any fixed start serves; this one is a hash of the floor and the prop's index.
 */
function bobStart(zone: Id, i: number): number {
  let h = 2166136261;
  for (const c of `${zone}#${i}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0) % (8 * FX);
}

export class Ghosts {
  private readonly props: GhostProp[];

  constructor(
    readonly zone: Id,
    room: DistortionRoom,
    private readonly hidden: () => number,
    private readonly tables: DistortionWorldTables,
  ) {
    const mask = hidden();
    this.props = (room.ghosts?.props ?? []).map((p, i) => {
      const o = tables.props[p.prop].offset;
      const shown = !(mask & (1 << p.group));
      const clip = tables.props[p.prop].clip;
      const progress = bobStart(zone, i);
      return {
        group: p.group,
        prop: p.prop,
        // VecFx32_SetPosFromMapCoords and MAP_OBJECT_COORD_CENTER_TO_FX32(tileY), plus the kind's offset.
        anchor: [p.x * TILE + TILE / 2 + o[0], p.y * TILE + TILE / 2 + o[1], p.z * TILE + TILE / 2 + o[2]],
        opacity: shown ? GHOST_OPACITY_MAX : 0,
        progress,
        delta: progress & 1 ? -BOB_DELTA : BOB_DELTA,
        frame: shown && clip ? clip.frames : 0,
        bob: 0,
        sound: 'none',
      };
    });
  }

  /** One frame of every prop's animator. `occupied(x, y, z)`: an object stands on a small platform's tile (it bobs half). */
  step(sound: FieldSound, occupied: (p: { x: number; y: number; z: number }) => boolean, current: boolean, room: DistortionRoom): void {
    const mask = this.hidden();
    this.props.forEach((g, i) => {
      const hide = !!(mask & (1 << g.group));
      if (OBSTACLES.has(g.prop)) {
        const frames = this.tables.props[g.prop].clip?.frames ?? 0;
        const rock = g.prop === 'land-rock';
        if (hide) {
          g.frame = Math.max(0, g.frame - 2);
          if (g.opacity >= g.frame) {
            if (g.opacity > 0) {
              g.opacity = Math.max(0, g.opacity - OBSTACLE_DELTA);
              if (g.sound !== 'disappear') {
                g.sound = 'disappear';
                sound.playNamed(rock ? SOUNDS.rockDisappear : SOUNDS.disappear, true);
              }
            } else g.opacity = 0;
          }
        } else {
          if (g.opacity < GHOST_OPACITY_MAX) {
            g.opacity = Math.min(GHOST_OPACITY_MAX, g.opacity + OBSTACLE_DELTA);
            if (g.sound !== 'appear') {
              g.sound = 'appear';
              sound.playNamed(rock ? SOUNDS.rockAppear : SOUNDS.appear, true);
            }
          }
          g.frame = Math.min(frames, g.frame + 2);
        }
        return;
      }
      // DistWorldPlatformProp_AnimTick: a small platform an object stands on bobs half as far.
      const t = room.ghosts!.props[i]!;
      const slow = g.prop === 'small-platform' && current && occupied(t);
      let y = BOB_OFFSETS[Math.trunc(g.progress / FX) % 8]!;
      if (slow) y >>= 1;
      g.bob = y;
      g.progress += g.delta;
      if (g.progress < 0) {
        g.progress = 0;
        g.delta = BOB_DELTA;
      } else if (g.progress >= 8 * FX) {
        g.progress = 8 * FX - BOB_DELTA;
        g.delta = -BOB_DELTA;
      }
      if (hide) {
        if (g.opacity > 0) {
          g.opacity--;
          if (g.sound !== 'disappear') {
            g.sound = 'disappear';
            sound.playNamed(SOUNDS.platform, true);
          }
        }
      } else if (g.opacity < GHOST_OPACITY_MAX) {
        g.opacity++;
        if (g.sound !== 'appear') {
          g.sound = 'appear';
          sound.playNamed(SOUNDS.platform, true);
        }
      }
    });
  }

  /** The props drawn now (a fully faded prop is still drawn, at opacity 0, as the DS keeps its animator). */
  draw(): GhostDraw[] {
    return this.props.map((g, i) => {
      const key = `ghost:${this.zone}:${i}`;
      if (OBSTACLES.has(g.prop)) return { key, prop: g.prop, cur: [...g.anchor], opacity: g.opacity, frame: g.frame };
      return { key, prop: g.prop, cur: [g.anchor[0], g.anchor[1] + g.bob / FX, g.anchor[2]], opacity: g.opacity };
    });
  }
}
