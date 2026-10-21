import * as THREE from 'three';
import type { Registries } from '@opensinnoh/contracts';
import type { AssetCache } from '../assets.ts';
import type { LightTemplate } from '../lighting.ts';
import { Ships } from '../ships.ts';

/** DWWarp_CameraMove: binary half-angle, shrinking by a decelerating 8.8 fixed-point step. */
export function warpFov(tick: number): number {
  let angle = Math.trunc(22 * 65535 / 360);
  for (let i = 0; i < tick; i++) angle = (angle - (Math.max(16 * 256, 60 * 256 - i * 128) >> 8)) & 0xffff;
  return angle * 720 / 65536;
}

/** The application animates throughout both fades, independently of the field's held black fade. */
export function warpFade(tick: number): number {
  return Math.max(0, 1 - tick / 16, Math.min(1, (tick - 102) / 20));
}

const LIGHT: LightTemplate = {
  lights: [{ direction: [0, -1, 0], color: [28 / 31, 28 / 31, 28 / 31] }, null, null, null],
  diffuse: [1, 1, 1], ambient: [1, 1, 1], specular: [1, 1, 1], emission: [1, 1, 1],
};

export class DistortionWarp {
  private readonly scenes: Ships;
  constructor(reg: Registries, assets: AssetCache, failed: (e: unknown) => void) {
    const record = [...reg.newGame.values()][0]?.distortionWorld?.warp;
    this.scenes = new Ships(reg, assets, failed, record ? [record] : []);
  }
  ready(): boolean { return this.scenes.ready(); }
  dispose(): void { this.scenes.dispose(); }
  pose(tick: number, aspect: number) {
    const pass = this.scenes.pose({ direction: 0, tick: tick + 1, frames: 123 }, aspect, LIGHT);
    if (pass) {
      // The DS uses near=0: its projection maps every positive distance onto the far clip
      // boundary, while W buffering still orders surfaces. With an epsilon near plane,
      // Three needs a far plane enclosing the tunnel's center cap (343 units
      // from the camera, beyond the nominal 300). 1000 encloses this scene.
      pass.camera.far = 1000;
      pass.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(warpFov(tick) / 2)) * Math.max(1, (4 / 3) / aspect)));
      pass.camera.updateProjectionMatrix();
      // Nitro culls after the authored reflection. Three automatically reverses front
      // faces for negative scales; undo that for the tunnel's inward-facing rings.
      pass.root.updateMatrixWorld(true);
      pass.root.traverse(o => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) (mesh.material as THREE.Material).side = mesh.matrixWorld.determinant() < 0 ? THREE.BackSide : THREE.FrontSide;
      });
    }
    return pass;
  }
}
