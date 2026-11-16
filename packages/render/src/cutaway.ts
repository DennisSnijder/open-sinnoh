import * as THREE from 'three';

/**
 * The angled camera's cutaway (enhanced visuals, enhanced/config.ts): it looks down less steeply than the DS camera,
 * so a tree's canopy, a roof or a ledge south of the player stands between the camera and the player and hides it.
 * Map and prop pixels (Materials.convert) that are nearer the camera than the player's sprite and over it on screen
 * are not drawn: a hole the size of the sprite, edge-marked like any other polygon edge. One shared uniform; the DS
 * camera leaves it off (radius 0) and draws every pixel as before.
 */
export const CUTAWAY = { value: new THREE.Vector4(0, 0, 0, 0) };

/** Fragment code: the hole (x, y: centre in drawing-buffer pixels; z: radius, 0 off; w: the sprite's window depth). */
export const CUTAWAY_GLSL = /* glsl */ `
  if (uCutaway.z > 0.0 && gl_FragCoord.z < uCutaway.w && distance(gl_FragCoord.xy, uCutaway.xy) < uCutaway.z) discard;`;

/** The hole's radius, in the sprite's frame sizes, around the frame's middle (a little past its feet). */
const RADIUS = 0.6;
/** The depth the hole starts at: the frame's height at this share, the sprite's upper part (its head). */
const DEPTH_AT = 0.75;

/**
 * Places the hole over a sprite standing at `feet` (world, the billboard's anchor) with frames `frameSize` units tall,
 * for `camera` drawing into a `width`×`height` buffer; `feet` null turns it off.
 */
export function placeCutaway(camera: THREE.Camera, feet: THREE.Vector3 | null, frameSize: number, width: number, height: number): void {
  const c = CUTAWAY.value;
  if (!feet) {
    c.set(0, 0, 0, 0);
    return;
  }
  const middle = feet.clone().setY(feet.y + frameSize / 2).project(camera);
  const edge = feet.clone().setY(feet.y + frameSize / 2 + frameSize * RADIUS).project(camera);
  const head = feet.clone().setY(feet.y + frameSize * DEPTH_AT).project(camera);
  const px = (ndc: THREE.Vector3) => new THREE.Vector2((ndc.x * 0.5 + 0.5) * width, (ndc.y * 0.5 + 0.5) * height);
  const centre = px(middle);
  c.set(centre.x, centre.y, centre.distanceTo(px(edge)), head.z * 0.5 + 0.5);
}
