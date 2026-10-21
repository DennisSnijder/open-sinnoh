import type { DistortionView } from '@opensinnoh/contracts';

/**
 * The Distortion World's sky (decomp overlay 9 InitSkyCloudAnimators, DistWorldSkyCloudAnimator_AnimTick,
 * RecalculateSkyBackgroundDarkness): nine clouds orbiting points of the DS screen at their groups' speeds, and a
 * darkness that follows the player's height. Presentation only, stepped with the world so it is deterministic.
 */

/** The sky kinds (decomp SkyKind): their cloud groups' extra turning speeds. */
export type SkyKind = 'normal' | 'giratina-room' | 'giratina-room-dark';

const FX = 4096;
/** sSkyCloudsRotAngleDeltas (fx32 degrees a frame) by sky kind and cloud group. */
const GROUP_DELTA: Record<SkyKind, number[]> = {
  normal: [0, 0, 0, 0],
  'giratina-room': [0.5, 1.5, 3, 5].map((v) => v * FX),
  'giratina-room-dark': [-2, -4.5, -7, -12.5].map((v) => v * FX),
};

interface CloudTemplate {
  set: number;
  group: number;
  angle: number;
  offset: number;
  radius: number;
  speed: number;
  x: number;
  y: number;
  scale: number;
}

const cloud = (set: number, group: number, angle: number, offset: number, radius: number, speed: number, y: number, scale: number): CloudTemplate => ({ set, group, angle: angle * FX, offset: offset * FX, radius, speed: speed * FX, x: 128, y, scale });

/** sSkyCloudsTemplates: cloud set, group, start angle, sprite turn, orbit radius (px), speed (degrees a frame), centre, scale. */
const CLOUDS: CloudTemplate[] = [
  cloud(6, 3, 0, 135, 0x68, 1.25, 108, 2),
  cloud(6, 3, 180, 135, 0x68, 1.25, 108, 2),
  cloud(6, 3, 90, 135, 0x68, 1.25, 108, 2),
  cloud(6, 3, 270, 135, 0x68, 1.25, 108, 2),
  cloud(1, 2, 0, 90, 0x3c, 1, 128, 1),
  cloud(2, 2, 180, 90, 0x3c, 1, 128, 1),
  cloud(3, 1, 315, 90, 0x2a, 0.75, 128, 1),
  cloud(4, 1, 135, 90, 0x2a, 0.75, 128, 1),
  cloud(5, 0, 0, 90, 0, 0.5, 128, 1),
];

/** SKY_BACKGROUND_MAX_DARKNESS and DISTORTION_WORLD_MIN_Y / MAX_Y (tiles). */
const MAX_DARKNESS = 12;
const MIN_Y = 65;
const MAX_Y = 289;
/** A cloud group's speed eases toward its sky kind's by 0x200 (fx32 degrees) a frame. */
const DELTA_STEP = 0x200;

/** ApplyRotationToTargetFx32: an angle in fx32 degrees, kept in [0, 360). */
const wrap = (a: number) => (((a % (360 * FX)) + 360 * FX) % (360 * FX));

export class Sky {
  kind: SkyKind;
  /** Set by Giratina's arrival (SetSkyBackgroundDarknessCalculationDisabled / Level); else from the player's height. */
  fixedDarkness: number | null = null;
  darkness = 0;
  private readonly clouds = CLOUDS.map((t) => ({ t, angle: t.angle, delta: 0 }));

  constructor(kind: SkyKind) {
    this.kind = kind;
    for (const c of this.clouds) c.delta = GROUP_DELTA[kind][c.t.group]!;
  }

  /** One frame: the darkness from the player's height (world units), then each cloud's turn. */
  step(playerY: number): void {
    const level = this.fixedDarkness ?? Math.trunc((playerY * FX - MIN_Y * 16 * FX) / Math.trunc(((MAX_Y - MIN_Y) * 16 * FX) / MAX_DARKNESS));
    this.darkness = Math.max(0, Math.min(MAX_DARKNESS, level));
    for (const c of this.clouds) {
      const want = GROUP_DELTA[this.kind][c.t.group]!;
      if (want < c.delta) c.delta = Math.max(want, c.delta - DELTA_STEP);
      else if (want > c.delta) c.delta = Math.min(want, c.delta + DELTA_STEP);
      c.angle = wrap(c.angle + c.t.speed + c.delta);
    }
  }

  view(): DistortionView['sky'] {
    return {
      darkness: this.darkness,
      clouds: this.clouds.map((c) => {
        // CalcCosineDegrees / CalcSineDegrees of the whole degrees, times the radius.
        const deg = Math.trunc(c.angle / FX);
        return {
          set: c.t.set,
          x: c.t.x + Math.cos((deg * Math.PI) / 180) * c.t.radius,
          y: c.t.y + Math.sin((deg * Math.PI) / 180) * c.t.radius,
          rotation: Math.trunc(wrap(c.angle + c.t.offset) / FX),
          scale: c.t.scale,
        };
      }),
    };
  }
}
