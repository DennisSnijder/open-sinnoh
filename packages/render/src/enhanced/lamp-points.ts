import * as THREE from 'three';

/** A light source the enhanced lamps glow on: a lamp's bulb or a window's middle (world). */
export interface LampPoint {
  at: THREE.Vector3;
  kind: 'lamp' | 'window';
}

/** Map material names of lamps (Platinum `c1_lamp01`, `c5_light`, `dun_light`, build `light`) and windows (`h_mado`, `window`). */
const LAMP = /lamp|light/i;
const WINDOW = /mado|window/i;

/**
 * The lamps and windows a world-space geometry with material `name` holds: its vertices clustered on a 16-unit grid
 * (one land mesh holds every lamp of its chunk), a lamp at its cluster's top, a window at its middle. Empty for
 * other materials.
 */
export function lampPoints(name: string, geometry: THREE.BufferGeometry): LampPoint[] {
  const kind = WINDOW.test(name) ? 'window' : LAMP.test(name) ? 'lamp' : null;
  if (!kind) return [];
  const pos = geometry.getAttribute('position');
  const cells = new Map<string, { min: THREE.Vector3; max: THREE.Vector3 }>();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const key = `${Math.floor(v.x / 16)},${Math.floor(v.z / 16)}`;
    const c = cells.get(key);
    if (c) {
      c.min.min(v);
      c.max.max(v);
    } else cells.set(key, { min: v.clone(), max: v.clone() });
  }
  return [...cells.values()].map(({ min, max }) => {
    const at = min.clone().add(max).multiplyScalar(0.5);
    if (kind === 'lamp') at.y = max.y - 2;
    return { at, kind };
  });
}
