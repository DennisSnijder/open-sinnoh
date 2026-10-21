import type { EffectView, Facing, FieldView, Vec3 } from '@opensinnoh/contracts';
import type { Surface } from './support.ts';

const FX = 4096;
const DEG = Math.PI / 180;
const yaw: Record<Facing, number> = { up: 180, down: 0, left: 270, right: 90 };
/** DistWorldSurfMountRenderer's 1–4 unit bob; one update per simulation tick. */
const bob = (tick: number) => 1 + Math.min(tick % 24, 24 - tick % 24) / 4;

/** The cascade owns these visual accumulators; none are persisted or used for collision. */
export class CascadeMount {
  private angleX: number;
  private angleY = 90 * FX;
  private orbit: number;
  private fixZ: number;
  private cameraSteps = [70, 30];
  bobX = 0;
  bobFix = 0;
  externalBob = true;

  constructor(readonly down: boolean) {
    this.angleX = (down ? 180 : 0) * FX;
    this.orbit = (down ? 90 : 270) * FX;
    this.fixZ = (down ? 6 : -7) * FX;
  }

  turnIn(): void {
    const frames = this.down ? 32 : 4;
    this.angleX -= 90 * FX / frames;
    this.angleY += 180 * FX / frames;
    this.orbit += (this.down ? -70 : 110) * FX / frames;
    if (this.down) this.fixZ += 4 * FX / frames;
  }

  ride(cameraState: number, bobX: number): void {
    this.bobX = bobX;
    if (!this.down) {
      if (cameraState === 1 && this.fixZ < 10 * FX) this.fixZ += 17 * FX / 16;
    } else if (cameraState > 0) {
      const i = cameraState - 1;
      if (this.cameraSteps[i]! > 0) {
        this.cameraSteps[i]!--;
        const frames = i === 0 ? 70 : 30;
        this.fixZ += Math.trunc((i === 0 ? -16 : 6) * FX / frames);
        this.bobFix += Math.trunc((i === 0 ? -4 : 4) * FX / frames) / FX;
      }
    }
  }

  turnOut(bobX: number): void {
    this.bobX = bobX;
    this.bobFix = 0;
    this.externalBob = false;
    const frames = this.down ? 16 : 2;
    this.angleX += (this.down ? -90 : 90) * FX / frames;
    this.orbit += (this.down ? -110 : 70) * FX / frames;
    this.fixZ += (this.down ? -7 : -4) * FX / frames;
  }

  pose(): MountPose {
    return {
      rotation: [Math.trunc(this.angleX / FX), Math.trunc(this.angleY / FX) % 360, 0],
      orbit: Math.trunc(this.orbit / FX) % 360, fix: [0, 0, this.fixZ / FX],
      bobX: this.bobX, bobFix: this.bobFix, externalBob: this.externalBob,
    };
  }
}

export interface MountPose {
  rotation: Vec3;
  orbit: number;
  fix: Vec3;
  bobX: number;
  bobFix: number;
  externalBob: boolean;
}

function resting(surface: Surface, facing: Facing): MountPose {
  const ceiling = surface === 'ceiling';
  const wall = surface === 'west-wall' || surface === 'east-wall';
  return {
    rotation: [ceiling ? 180 : 0, ceiling && (facing === 'left' || facing === 'right') ? (yaw[facing] + 180) % 360 : yaw[facing], 0],
    orbit: ceiling ? 90 : wall ? 0 : 270,
    fix: ceiling ? [0, 0, 6] : wall ? [0, 0, 0] : [0.25, 6, -5],
    bobX: 0, bobFix: 0, externalBob: false,
  };
}

/** Resolve the DS orbit in the world XY plane, before model rotation. Rendering only consumes this pose. */
export function mountPosition(anchor: Vec3, pose: MountPose, tick: number): Vec3 {
  return [
    anchor[0] + 20 * Math.cos(pose.orbit * DEG) + pose.fix[0] - (pose.externalBob ? 0 : pose.bobX),
    anchor[1] + 8 + 20 * Math.sin(pose.orbit * DEG) + pose.fix[1] + (pose.externalBob ? 0 : bob(tick)),
    anchor[2] + pose.fix[2],
  ];
}

export function presentSurf(view: FieldView, mount: EffectView, surface: Surface, facing: Facing, current: MountPose | null, previous: MountPose | null): void {
  const now = current ?? resting(surface, facing);
  const prev = previous ?? now;
  mount.rotation = now.rotation;
  mount.cur = mountPosition(mount.cur, now, mount.tick);
  mount.prev = mountPosition(mount.prev, prev, Math.max(0, mount.tick - 1));
  const player = view.actors.find(a => a.home === undefined);
  if (!player) return;
  const sprite = (at: Vec3, pose: MountPose, tick: number): Vec3 => [at[0] + pose.bobFix + (pose.externalBob ? pose.bobX : 0), at[1] + (pose.externalBob ? 0 : bob(tick)), at[2]];
  player.cur = sprite(player.cur, now, mount.tick);
  player.prev = sprite(player.prev, prev, Math.max(0, mount.tick - 1));
}
