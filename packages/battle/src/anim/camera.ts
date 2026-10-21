/**
 * A particle system's camera (decomp particle_system.c, camera.c): it looks from (0, 0, 4) at the origin
 * with +y up, 45° "fov"; the battle draws particles orthographically (BattleAnimSystem_StartMove), where
 * that fov makes the view 8 units tall: 24 DS px per unit, the origin at the screen's centre (128, 96).
 * Scripts can turn it around its target (Camera_SetAngleAroundTarget), flip its up vector (SetCameraFlip)
 * or switch it to perspective (rare; drawn orthographically here, see docs/research/move-animations.md).
 */
import { cosIdx, fxMul, sinIdx, type Vec } from './fx.ts';

export const PX_PER_UNIT = 24;
export const SCREEN_CENTER = { x: 128, y: 96 } as const;

/** A row-vector view matrix (NNS MtxFx43 as doubles): view = [x y z 1] · m. */
export interface ViewMatrix {
  x: [number, number, number];
  y: [number, number, number];
  z: [number, number, number];
  t: [number, number, number];
}

export class ParticleCamera {
  position: Vec = [0, 0, 4 * 4096];
  target: Vec = [0, 0, 0];
  up: Vec = [0, 4096, 0];
  readonly distance = 4 * 4096;
  angle: [number, number, number] = [0, 0, 0];
  /** 0 perspective, 1 orthographic (decomp CameraProjection). */
  projection = 1;

  /** Camera_SetAngleAroundTarget. */
  setAngleAroundTarget(angle: [number, number, number]): void {
    this.angle = [angle[0] & 0xffff, angle[1] & 0xffff, angle[2] & 0xffff];
    const [ax, ay] = this.angle;
    const x = fxMul(fxMul(sinIdx(ay), this.distance), cosIdx(ax));
    const z = fxMul(fxMul(cosIdx(ay), this.distance), cosIdx(ax));
    const y = fxMul(sinIdx(-ax & 0xffff), this.distance);
    this.position = [x + this.target[0], y + this.target[1], z + this.target[2]];
  }

  /** Camera_SetTarget: moves the target (and the position with it). */
  setTarget(target: Vec): void {
    const d: Vec = [target[0] - this.target[0], target[1] - this.target[1], target[2] - this.target[2]];
    this.target = [...target];
    this.position = [this.position[0] + d[0], this.position[1] + d[1], this.position[2] + d[2]];
  }

  /** MTX_LookAt from the position toward the target. */
  view(): ViewMatrix {
    const norm = (v: [number, number, number]): [number, number, number] => {
      const l = Math.hypot(...v);
      return l ? [v[0] / l, v[1] / l, v[2] / l] : [0, 0, 0];
    };
    const crossD = (a: [number, number, number], b: [number, number, number]): [number, number, number] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const p = this.position.map((v) => v / 4096) as [number, number, number];
    const t = this.target.map((v) => v / 4096) as [number, number, number];
    const z = norm([p[0] - t[0], p[1] - t[1], p[2] - t[2]]);
    const x = norm(crossD(this.up.map((v) => v / 4096) as [number, number, number], z));
    const y = crossD(z, x);
    const d = (a: [number, number, number]) => -(p[0] * a[0] + p[1] * a[1] + p[2] * a[2]);
    return { x, y, z, t: [d(x), d(y), d(z)] };
  }
}

/** A world point (fx32) in view space (units). */
export function toView(m: ViewMatrix, v: Vec): [number, number, number] {
  const [px, py, pz] = [v[0] / 4096, v[1] / 4096, v[2] / 4096];
  return [px * m.x[0] + py * m.x[1] + pz * m.x[2] + m.t[0], px * m.y[0] + py * m.y[1] + pz * m.y[2] + m.t[1], px * m.z[0] + py * m.z[1] + pz * m.z[2] + m.t[2]];
}

/** A world direction (fx32) in view space. */
export function dirToView(m: ViewMatrix, v: [number, number, number]): [number, number, number] {
  return [v[0] * m.x[0] + v[1] * m.x[1] + v[2] * m.x[2], v[0] * m.y[0] + v[1] * m.y[1] + v[2] * m.y[2], v[0] * m.z[0] + v[1] * m.z[1] + v[2] * m.z[2]];
}
