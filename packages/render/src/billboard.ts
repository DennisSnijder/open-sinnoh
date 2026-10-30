import * as THREE from 'three';

/**
 * Billboard depth. The DS draws characters on a camera-facing quad (SBC `BB`) with plain depth: every pixel has
 * the depth of the anchor (the quad's bottom edge), as if the quad leaned far back with the camera pitch. Drawn as
 * is, its top cuts into a wall right behind the character, and its low pixels sink to the ground, where our texture
 * cards (cards.ts) stand on the same plane. So each fragment takes the depth of a plane through the anchor that
 * leans back less (`BILLBOARD_LEAN` per unit up) and stands upright `BILLBOARD_BACK` units north of the anchor,
 * through the character's own position: walls and furniture north of it stay behind, stair rails and counters south
 * of the anchor stay in front, and a surface that leans back from the tile south over the anchor still covers the
 * whole sprite, as on the DS (Pastoria City's face-in-hole board shows only the face of a character behind it).
 */

/** The lean of the depth plane: world units north per unit up. It reaches `BILLBOARD_BACK` halfway up a 32-unit character. */
export const BILLBOARD_LEAN = 6 / 16;
/** How far north of the anchor the depth plane stands upright (the DS anchor is 6 units south of the object). */
export const BILLBOARD_BACK = 6;

/**
 * Normalized depth (0 near … 1 far, the default depth range) of a billboard fragment: where the view ray through
 * `view` (a view-space point) meets the plane leaning back from `anchor` (world), or the upright plane
 * `BILLBOARD_BACK` north of it if that is nearer; under a ceiling at `ceilingY`, no higher than that. Mirrors the
 * shader in `billboardMaterial`; exported for tests.
 */
export function billboardDepth(view: THREE.Vector3, anchor: THREE.Vector3, viewMatrix: THREE.Matrix4, projection: THREE.Matrix4, orthographic: boolean, ceilingY = Infinity): number {
  const origin = orthographic ? view.clone() : new THREE.Vector3();
  const dir = orthographic ? new THREE.Vector3(0, 0, -1) : view.clone();
  const meet = (normal: THREE.Vector3, point: THREE.Vector3) => {
    const n = normal.clone().transformDirection(viewMatrix);
    const c = n.dot(point.clone().applyMatrix4(viewMatrix));
    return origin.clone().addScaledVector(dir, (c - n.dot(origin)) / n.dot(dir));
  };
  const p = meet(new THREE.Vector3(0, BILLBOARD_LEAN, 1), anchor);
  const back = meet(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, anchor.z - BILLBOARD_BACK));
  if (back.z > p.z) p.copy(back);
  if (Number.isFinite(ceilingY)) {
    const up = new THREE.Vector3(0, 1, 0).transformDirection(viewMatrix);
    const top = up.dot(new THREE.Vector3(0, ceilingY, 0).applyMatrix4(viewMatrix));
    if (up.dot(p) > top) p.copy(origin).addScaledVector(dir, (top - up.dot(origin)) / up.dot(dir));
  }
  const clip = new THREE.Vector4(p.x, p.y, p.z, 1).applyMatrix4(projection);
  return (clip.z / clip.w) * 0.5 + 0.5;
}

/** How far toward the camera (world units, along the ground) `slopeDepthLift` follows the ground. */
const SLOPE_REACH = 96;
/** The ground's sample spacing for `slopeDepthLift`, and the most a sample may rise or fall past the last one. */
const SLOPE_STEP = 4;
const SLOPE_RISE = 8;

/**
 * Where a billboard's depth anchor moves on ground that rises toward the camera (a stair down to the north under the
 * angled camera): the offset along `toCamera` (unit, from `anchor` toward the eye) to the point past the last stretch
 * of ground that hides the anchor, or zero. `heightsAt` gives the surface heights at a point (the terrain's and the
 * map model's floors and steps; none where actors cannot walk). The ground is followed from the actor's own height
 * `startY` while it runs on without a step: at each sample, the highest surface within `SLOPE_RISE` of the last one
 * (a terrain stair, a stair model on flat terrain, the landing past it; not a wall, a cliff or a bridge overhead), so
 * walls and cliffs still hide the sprite. The DS camera looks down steeper than any stair rises, and on the DS the
 * sprite stands over the stair it is on: the lifted depth keeps it in front of the steps under the angled camera too
 * (the renderer lifts only there).
 */
export function slopeDepthLift(anchor: THREE.Vector3, toCamera: THREE.Vector3, startY: number, heightsAt: (x: number, z: number, current: number) => readonly number[]): THREE.Vector3 {
  const lift = new THREE.Vector3();
  const flat = Math.hypot(toCamera.x, toCamera.z);
  if (flat < 1e-6) return lift;
  const rise = toCamera.y / flat;
  let ground = startY;
  let last = -1;
  for (let s = 0; s <= SLOPE_REACH; s += SLOPE_STEP) {
    // The first sample lies a few units off the actor's own position (the anchor stands south of it).
    const reach = s === 0 ? 1.5 * SLOPE_RISE : SLOPE_RISE;
    let next = -Infinity;
    for (const y of heightsAt(anchor.x + (toCamera.x / flat) * s, anchor.z + (toCamera.z / flat) * s, ground)) if (Math.abs(y - ground) <= reach && y > next) next = y;
    if (next === -Infinity) break;
    ground = next;
    if (ground > anchor.y + rise * s + 0.5) last = s;
  }
  if (last < 0) return lift;
  return lift.copy(toCamera).multiplyScalar((last + SLOPE_STEP) / flat);
}

/**
 * A sprite material whose fragments take the billboard depth (`billboardDepth`: the sprite's position is the anchor,
 * `anchorZ.value` its z, `depthLift.value` a world offset of the lean plane's anchor: `slopeDepthLift`), or, with `plain.value` 1, the quad's own depth (a character on a Distortion World wall or
 * ceiling, where no upright plane stands behind it).
 * The material colour is the billboard's lit colour (lighting.ts billboardLight), modulating the texture.
 * It is opaque (alpha-tested, not blended), like the DS quad (alpha 31): its pixels write their own
 * polygon ID to the field target, so edge marking outlines the sprite and never draws the edges of
 * the geometry behind it across the sprite.
 */
export function billboardMaterial(map: THREE.Texture): { material: THREE.SpriteMaterial; anchorZ: { value: number }; depthLift: { value: THREE.Vector3 }; plain: { value: number }; paletteDarkness: { value: number }; ceilingY: { value: number }; ceilingMin: { value: THREE.Vector3 }; ceilingMax: { value: THREE.Vector3 } } {
  const anchorZ = { value: 0 };
  const depthLift = { value: new THREE.Vector3() };
  const plain = { value: 0 };
  const paletteDarkness = { value: 0 };
  const ceilingY = { value: 1e9 };
  const ceilingMin = { value: new THREE.Vector3(-1e9, -1e9, -1e9) };
  const ceilingMax = { value: new THREE.Vector3(1e9, 1e9, 1e9) };
  const material = new THREE.SpriteMaterial({ map, alphaTest: 0.5, transparent: false });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uAnchorZ = anchorZ;
    shader.uniforms.uDepthLift = depthLift;
    shader.uniforms.uPlain = plain;
    shader.uniforms.uPaletteDarkness = paletteDarkness;
    shader.uniforms.uCeilingY = ceilingY;
    shader.uniforms.uCeilingMin = ceilingMin;
    shader.uniforms.uCeilingMax = ceilingMax;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'uniform vec3 uDepthLift;\nvarying vec3 vBillboardView;\nvarying vec3 vAnchorView;\nvoid main() {')
      .replace('gl_Position = projectionMatrix * mvPosition;', 'gl_Position = projectionMatrix * mvPosition;\n\tvBillboardView = mvPosition.xyz;\n\tvAnchorView = ( modelViewMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz + ( viewMatrix * vec4( uDepthLift, 0.0 ) ).xyz;');
    // The palette darkens before the texel modulates the billboard's lit colour (the material colour).
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      vec4 sampledDiffuseColor = texture2D( map, vMapUv );
      if (uPaletteDarkness > 0.0) {
        vec3 base = floor(sampledDiffuseColor.rgb * 31.0 + 0.5);
        sampledDiffuseColor.rgb = floor(base * (16.0 - uPaletteDarkness) / 16.0) / 31.0;
      }
      diffuseColor *= sampledDiffuseColor;`).replace('void main() {', 'uniform float uPaletteDarkness;\nuniform mat4 projectionMatrix;\nuniform float uAnchorZ;\nuniform float uPlain;\nuniform float uCeilingY;\nuniform vec3 uCeilingMin;\nuniform vec3 uCeilingMax;\nvarying vec3 vBillboardView;\nvarying vec3 vAnchorView;\nvoid main() {').replace(
      '#include <alphatest_fragment>',
      `#include <alphatest_fragment>
	vec3 rayO = isOrthographic ? vBillboardView : vec3( 0.0 );
	vec3 rayD = isOrthographic ? vec3( 0.0, 0.0, - 1.0 ) : vBillboardView;
	vec3 leanN = ( viewMatrix * vec4( 0.0, ${BILLBOARD_LEAN.toFixed(6)}, 1.0, 0.0 ) ).xyz;
	vec3 hit = rayO + rayD * ( ( dot( leanN, vAnchorView ) - dot( leanN, rayO ) ) / dot( leanN, rayD ) );
	vec3 planeN = ( viewMatrix * vec4( 0.0, 0.0, 1.0, 0.0 ) ).xyz;
	float planeC = dot( planeN, ( viewMatrix * vec4( 0.0, 0.0, uAnchorZ - ${BILLBOARD_BACK.toFixed(1)}, 1.0 ) ).xyz );
	vec3 back = rayO + rayD * ( ( planeC - dot( planeN, rayO ) ) / dot( planeN, rayD ) );
	if ( back.z > hit.z ) hit = back;
	vec3 up = ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz;
	float ceilingC = dot( up, ( viewMatrix * vec4( 0.0, uCeilingY, 0.0, 1.0 ) ).xyz );
	if ( dot( up, hit ) > ceilingC ) {
		mat3 viewToWorld = transpose( mat3( viewMatrix ) );
		vec3 worldO = viewToWorld * ( rayO - ( viewMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz );
		vec3 worldD = viewToWorld * rayD;
		// A tiny signed direction keeps axis-aligned rays finite for the slab test.
		worldD = ( step( vec3( 0.0 ), worldD ) * 2.0 - 1.0 ) * max( abs( worldD ), vec3( 1e-8 ) );
		vec3 t0 = ( uCeilingMin - worldO ) / worldD;
		vec3 t1 = ( uCeilingMax - worldO ) / worldD;
		vec3 enter = min( t0, t1 ), leave = max( t0, t1 );
		if ( min( leave.x, min( leave.y, leave.z ) ) >= max( enter.x, max( enter.y, enter.z ) ) ) {
			hit = rayO + rayD * ( ( ceilingC - dot( up, rayO ) ) / dot( up, rayD ) );
		}
	}
	vec4 hitClip = projectionMatrix * vec4( hit, 1.0 );
	gl_FragDepth = uPlain > 0.5 ? gl_FragCoord.z : ( hitClip.z / hitClip.w ) * 0.5 + 0.5;`,
    );
  };
  return { material, anchorZ, depthLift, plain, paletteDarkness, ceilingY, ceilingMin, ceilingMax };
}

/**
 * A reflection's sprite material: its fragments take the depth of the plane at world y = `groundY.value` (where the
 * ray through the fragment meets that plane), just under the ground the character stands on. The opaque ground and
 * whatever stands on it hide the reflection; a water bed under that plane never does (renderer.ts REFLECTS).
 */
export function reflectionMaterial(map: THREE.Texture): { material: THREE.SpriteMaterial; groundY: { value: number } } {
  const groundY = { value: 0 };
  const material = new THREE.SpriteMaterial({ map, alphaTest: 0.5, depthWrite: false });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGroundY = groundY;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vPlaneView;\nvoid main() {')
      .replace('gl_Position = projectionMatrix * mvPosition;', 'gl_Position = projectionMatrix * mvPosition;\n\tvPlaneView = mvPosition.xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('void main() {', 'uniform mat4 projectionMatrix;\nuniform float uGroundY;\nvarying vec3 vPlaneView;\nvoid main() {').replace(
      '#include <alphatest_fragment>',
      `#include <alphatest_fragment>
	vec3 planeN = ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz;
	float planeC = dot( planeN, ( viewMatrix * vec4( 0.0, uGroundY, 0.0, 1.0 ) ).xyz );
	vec3 rayO = isOrthographic ? vPlaneView : vec3( 0.0 );
	vec3 rayD = isOrthographic ? vec3( 0.0, 0.0, - 1.0 ) : vPlaneView;
	vec3 hit = rayO + rayD * ( ( planeC - dot( planeN, rayO ) ) / dot( planeN, rayD ) );
	vec4 hitClip = projectionMatrix * vec4( hit, 1.0 );
	gl_FragDepth = ( hitClip.z / hitClip.w ) * 0.5 + 0.5;`,
    );
  };
  return { material, groundY };
}

/** A model node the DS turns to face the camera (SBC BB: `full`; BBY: `y`), from glTF `extras.lantern.billboard`. */
export type NodeBillboard = 'full' | 'y';

/**
 * The world matrix of a billboard node (G3D SBC BB / BBY) from its unturned one: its world position and axis scales,
 * turned to the camera (world rotation `camera`). `full` takes the camera's rotation, so the node's local axes are the
 * view's; `y` keeps the node's world Y axis and turns about it until its Z axis points as near the viewer as it can.
 */
export function billboardMatrix(world: THREE.Matrix4, mode: NodeBillboard, camera: THREE.Quaternion, out = new THREE.Matrix4()): THREE.Matrix4 {
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  world.decompose(position, rotation, scale);
  if (mode === 'full') return out.compose(position, camera, scale);
  const y = new THREE.Vector3(0, 1, 0).applyQuaternion(rotation);
  const toViewer = new THREE.Vector3(0, 0, 1).applyQuaternion(camera);
  const z = toViewer.addScaledVector(y, -toViewer.dot(y)).normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  return out.makeBasis(x.multiplyScalar(scale.x), y.multiplyScalar(scale.y), z.multiplyScalar(scale.z)).setPosition(position);
}

/** The billboard mode of a node loaded from glTF (`extras.lantern.billboard`), if any. */
export function nodeBillboard(node: THREE.Object3D): NodeBillboard | undefined {
  return (node.userData.lantern as { billboard?: NodeBillboard } | undefined)?.billboard;
}

/**
 * Turns the billboard nodes under `root` to the camera whenever they are drawn: each mesh of a node (itself, its
 * primitives, their translucent parts) takes the node's `billboardMatrix` for the camera it is drawn with. The importer
 * rejects glTF child nodes under a billboard node, whose turn the DS's matrix stack would decide.
 */
export function faceCameraNodes(root: THREE.Object3D): void {
  root.traverse((node) => {
    const mode = nodeBillboard(node);
    if (!mode) return;
    const nodeWorld = new THREE.Matrix4();
    const camera = new THREE.Quaternion();
    node.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.onBeforeRender = (_renderer, _scene, view) => {
        nodeWorld.multiplyMatrices(node.parent!.matrixWorld, node.matrix);
        billboardMatrix(nodeWorld, mode, view.getWorldQuaternion(camera), mesh.matrixWorld);
        const local: THREE.Matrix4[] = [];
        for (let p: THREE.Object3D = mesh; p !== node; p = p.parent!) local.unshift(p.matrix);
        for (const m of local) mesh.matrixWorld.multiply(m);
      };
    });
  });
}
