import * as THREE from 'three';
import { expect, it } from 'vitest';
import type { Id } from '@opensinnoh/core';
import type { ActorView, BillboardSprite as Sprite, Camera, Vec3 } from '@opensinnoh/contracts';
import { AssetCache, resolvePackPath, splitRef } from './assets.ts';
import { billboardDepth, slopeDepthLift } from './billboard.ts';
import { Materials, patternAt, patternBlend, withTranslucentParts } from './materials.ts';
import { dsPixelAlpha, type FieldOutput } from './composite.ts';
import { billboardLight, dsVertexLight, lightAt, SHADOW_BY_PERIOD, type LightTemplate } from './lighting.ts';
import { actorKeys, emoteBounce, sharedLightClone, spriteFrame, viewToWorld } from './renderer.ts';

it('resolves glTF-relative asset paths inside the pack', () => {
  expect(resolvePackPath('models/town.gltf', '../textures/grass.png')).toBe('textures/grass.png');
  expect(resolvePackPath('models/a/b.gltf', './c.bin')).toBe('models/a/c.bin');
  expect(() => resolvePackPath('a.gltf', '../../x.png')).toThrow(/escapes/);
  expect(splitRef('fixture:models/room.gltf')).toEqual({ pack: 'fixture', path: 'models/room.gltf' });
});

it('picks sprite frames by animation, facing and tick; run falls back to walk', () => {
  const sprite: Sprite = {
    id: 'test:S',
    atlas: 'test:s.png',
    frameSize: 32,
    frameCount: 8,
    animations: {
      'stand-down': [{ frame: 0, ticks: 1 }],
      'walk-down': [
        { frame: 1, ticks: 2 },
        { frame: 2, ticks: 2 },
      ],
    },
  };
  expect([0, 1, 2, 3, 4].map((t) => spriteFrame(sprite, 'walk', 'down', t))).toEqual([1, 1, 2, 2, 1]);
  expect(spriteFrame(sprite, 'run', 'down', 2)).toBe(2);
  expect(spriteFrame(sprite, 'stand', 'down', 9)).toBe(0);
  expect(() => spriteFrame(sprite, 'walk', 'up', 0)).toThrow(/no walk-up/);
});

it('plays poses once and holds the last frame; per-facing poses win', () => {
  const sprite: Sprite = {
    id: 'test:HEAL',
    atlas: 'test:h.png',
    frameSize: 32,
    frameCount: 6,
    animations: {
      'stand-down': [{ frame: 0, ticks: 1 }],
      'pose-give': [
        { frame: 1, ticks: 2 },
        { frame: 2, ticks: 3 },
      ],
      'pose-give-left': [{ frame: 5, ticks: 1 }],
    },
  };
  expect([0, 1, 2, 4, 5, 50].map((t) => spriteFrame(sprite, 'stand', 'down', t, 'give'))).toEqual([1, 1, 2, 2, 2, 2]);
  expect(spriteFrame(sprite, 'stand', 'left', 0, 'give')).toBe(5);
  expect(() => spriteFrame(sprite, 'stand', 'down', 0, 'bow')).toThrow(/no pose-bow/);
});

it('bounces the emote in over its first ticks, then rests', () => {
  expect([0, 1, 2, 3, 4, 5, 6, 40].map(emoteBounce)).toEqual([6, 10, 12, 12, 10, 6, 0, 0]);
});

it('puts world normals in the view space of the DS camera: camera-facing is +Z, east stays +X', () => {
  // Platinum's field camera (CAMERA_TYPE_DEFAULT): pitched down 59°, no yaw or roll.
  const camera: Camera = { id: 'test:C', distance: 667, angle: [-59.05, 0, 0], projection: 'perspective', fovY: 16, near: 150, far: 900 };
  const worldToView = viewToWorld(camera).invert();
  const view = (n: [number, number, number]) => new THREE.Vector3(...n).applyQuaternion(worldToView).toArray().map((x) => +x.toFixed(3) + 0);
  const pitch = 59.05 * (Math.PI / 180);
  expect(view([0, Math.sin(pitch), Math.cos(pitch)])).toEqual([0, 0, 1]);
  expect(view([1, 0, 0])).toEqual([1, 0, 0]);
  // So a sun travelling west (light 0 x < 0) lights east-facing walls, not west-facing ones.
  const sun: LightTemplate = { lights: [{ color: [1, 1, 1], direction: [-0.5, -0.87, 0.03] }], diffuse: [1, 1, 1], ambient: [0, 0, 0], specular: [0, 0, 0], emission: [0, 0, 0] };
  expect(dsVertexLight(view([1, 0, 0]) as [number, number, number], 1, sun)[0]).toBeCloseTo(0.5);
  expect(dsVertexLight(view([-1, 0, 0]) as [number, number, number], 1, sun)[0]).toBe(0);
});

it('lights vertices like the DS: emission + per light (ambient + diffuse + specular), clamped', () => {
  const t: LightTemplate = {
    lights: [{ color: [1, 1, 1], direction: [0, 0, -1] }, null, null, { color: [0.5, 0.5, 0.5], direction: [0, -1, 0] }],
    diffuse: [0.5, 0.5, 0.5],
    ambient: [0.1, 0.1, 0.1],
    specular: [0, 0, 0],
    emission: [0.2, 0.2, 0.2],
  };
  // Light 0 shines into the screen onto a face facing the viewer: emission + ambient + full diffuse.
  expect(dsVertexLight([0, 0, 1], 1, t).map((x) => +x.toFixed(3))).toEqual([0.8, 0.8, 0.8]);
  // Facing away: no diffuse. Lights outside the mask do nothing.
  expect(dsVertexLight([0, 0, -1], 1, t).map((x) => +x.toFixed(3))).toEqual([0.3, 0.3, 0.3]);
  expect(dsVertexLight([0, 0, 1], 0, t)).toEqual([0.2, 0.2, 0.2]);
  // Light 3 adds 0.5 × (ambient + diffuse) for an upward normal; the sum clamps at 1.
  expect(dsVertexLight([0, 1, 0], 8, t).map((x) => +x.toFixed(3))).toEqual([0.5, 0.5, 0.5]);
  expect(dsVertexLight([0, 0, 1], 1, { ...t, emission: [0.9, 0.9, 0.9] })).toEqual([1, 1, 1]);
  // Specular uses the unnormalised half vector between the light and the line of sight, squared.
  expect(dsVertexLight([0, 0, 1], 1, { ...t, diffuse: [0, 0, 0], ambient: [0, 0, 0], emission: [0, 0, 0], specular: [1, 1, 1] })).toEqual([1, 1, 1]);
});

it('binds the names a texture set lists; unlisted names stay unbound (logged); a listed texture that fails to load throws', async () => {
  const files: Record<string, string> = { 'test:textures/map/0/index.json': JSON.stringify(['grass__grass']) };
  const source = { get: (ref: string) => (ref in files ? Promise.resolve(new Blob([files[ref]!])) : Promise.reject(new Error(`no asset ${ref}`))) };
  const stubs: string[] = [];
  const materials = new Materials(new AssetCache(source), [], { stub: (k, d) => void stubs.push(`${k} ${d}`) });
  const mat = (texture: string, palette: string) => Object.assign(new THREE.MeshStandardMaterial(), { name: texture, userData: { lantern: { texture, palette } } });
  const unbound = (await materials.convert(mat('rock', 'pal'), 'test:textures/map/0', false)) as THREE.MeshBasicMaterial;
  expect(unbound.map).toBeNull();
  expect(stubs).toEqual(['render:unbound-texture test:textures/map/0 does not list rock__pal (drawn untextured)']);
  await expect(materials.convert(mat('grass', 'grass'), 'test:textures/map/0', false)).rejects.toThrow(/no asset test:textures\/map\/0\/grass__grass.png/);
});

it("binds a name the loaded area's set lacks from the chunk's own area's set; names the loaded set lists stay its own", async () => {
  // Cycling Road (Route 206, set 7) seen from Eterna City (set 8): r206_cy2b is only in set 7.
  const files: Record<string, string> = {
    'test:textures/map/8/index.json': JSON.stringify(['grass__pal']),
    'test:textures/map/7/index.json': JSON.stringify(['grass__pal', 'deck__pal']),
  };
  const source = { get: (ref: string) => (ref in files ? Promise.resolve(new Blob([files[ref]!])) : Promise.reject(new Error(`no asset ${ref}`))) };
  const stubs: string[] = [];
  const materials = new Materials(new AssetCache(source), [], { stub: (k, d) => void stubs.push(`${k} ${d}`) });
  const mat = (texture: string) => Object.assign(new THREE.MeshStandardMaterial(), { name: texture, userData: { lantern: { texture, palette: 'pal' } } });
  await expect(materials.convert(mat('deck'), 'test:textures/map/8', false, [], 'test:textures/map/7')).rejects.toThrow(/no asset test:textures\/map\/7\/deck__pal.png/);
  await expect(materials.convert(mat('grass'), 'test:textures/map/8', false, [], 'test:textures/map/7')).rejects.toThrow(/no asset test:textures\/map\/8\/grass__pal.png/);
  const none = (await materials.convert(mat('rock'), 'test:textures/map/8', false, [], 'test:textures/map/7')) as THREE.MeshBasicMaterial;
  expect(none.map).toBeNull();
  expect(stubs).toEqual(['render:unbound-texture test:textures/map/8 does not list rock__pal (drawn untextured)']);
});

it('combines texel and polygon alpha as the DS: alpha 0 is not drawn, 31 is opaque', () => {
  expect(dsPixelAlpha(13, 31)).toBe(13);
  expect(dsPixelAlpha(31, 31)).toBe(31);
  expect(dsPixelAlpha(0, 31)).toBe(0);
  expect(dsPixelAlpha(31, 9)).toBe(9);
  expect(dsPixelAlpha(13, 9)).toBe(4);
  expect(dsPixelAlpha(0, 30)).toBe(0);
});

it('splits a texture with per-texel alpha into its opaque texels and a translucent part; 1-bit alpha stays a cut-out', async () => {
  const materials = new Materials(new AssetCache({ get: () => Promise.reject(new Error('no assets')) }), [], { stub: () => {} });
  /** A glTF material (BLEND when `blend`) with a 2×2 texture of these texel alphas. */
  const mat = (alphas: number[], blend: boolean, lantern: object = {}) => {
    const map = new THREE.DataTexture(new Uint8Array(alphas.flatMap((a) => [10, 20, 30, a])), 2, 2);
    return Object.assign(new THREE.MeshStandardMaterial({ map, transparent: blend }), { name: 'water', userData: { lantern: { alpha: 31, polygonId: 3, ...lantern } } });
  };
  const output = (m: THREE.Material) => m.userData.fieldOutput as FieldOutput;
  const mesh = async (src: THREE.Material) => {
    const root = new THREE.Mesh(new THREE.BufferGeometry(), await materials.convert(src, undefined, false));
    withTranslucentParts(root);
    withTranslucentParts(root);
    return root;
  };

  // Opaque, translucent and transparent texels: the opaque ones draw as opaque pixels, the others in a translucent part.
  const mixed = await mesh(mat([255, 107, 0, 74], true));
  expect([mixed.material.transparent, mixed.material.depthWrite, output(mixed.material).texels]).toEqual([false, true, 'opaque']);
  expect(mixed.children).toHaveLength(1);
  const part = (mixed.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
  expect(part.map).toBe((mixed.material as THREE.MeshBasicMaterial).map);
  expect([part.transparent, part.depthWrite, output(part).texels, output(part).polygonId]).toEqual([true, false, 'blend', 3]);
  // A translucent pixel is not drawn over a translucent pixel of the same polygon ID.
  expect([part.stencilWrite, part.stencilRef, part.stencilFunc, part.stencilZPass]).toEqual([true, 4, THREE.NotEqualStencilFunc, THREE.ReplaceStencilOp]);

  // Only translucent texels (the lake): one translucent material; depth update writes depth.
  const lake = await mesh(mat([107, 107, 107, 107], true, { depthUpdate: true }));
  expect([lake.material.transparent, lake.material.depthWrite, output(lake.material).texels, lake.children.length]).toEqual([true, true, 'blend', 0]);

  // 1-bit alpha in a translucent format, and a colour-0-transparent texture: cut-outs.
  for (const src of [mat([255, 0, 0, 255], true), mat([255, 0, 0, 255], false)]) {
    const cut = await mesh(src);
    expect([cut.material.transparent, cut.material.depthWrite, (cut.material as THREE.MeshBasicMaterial).alphaTest, output(cut.material).texels, cut.children.length]).toEqual([false, true, 0.5, undefined, 0]);
  }

  // Polygon alpha under 31: translucent whatever the texels.
  const shadow = await mesh(mat([255, 0, 0, 255], true, { alpha: 9 }));
  expect([shadow.material.transparent, (shadow.material as THREE.MeshBasicMaterial).opacity, output(shadow.material).texels, shadow.children.length]).toEqual([true, 9 / 31, 'blend', 0]);
});

it('draws one-tick pattern frames blended with the frame before, so a frame-by-frame swap is steady', () => {
  // The bedroom TV (BTP0 tv01): two screen shades swapped every 30 Hz frame. Drawn sharp it flickered.
  const tv = [
    { texture: 'tv01.1~0', ticks: 1 },
    { texture: 'tv01.1~1', ticks: 1 },
  ];
  const drawn = (frames: { ticks: number }[], tick: number) => {
    const f = patternAt(frames, tick);
    const b = patternBlend(frames, f);
    return b === null ? [f] : [f, b].sort();
  };
  for (let tick = 0; tick < 12; tick++) expect(drawn(tv, tick)).toEqual([0, 1]);
  // Frames of two ticks or more are drawn as they are; a one-tick frame inside them blends with its predecessor.
  const light = [
    { ticks: 8 },
    { ticks: 8 },
    { ticks: 8 },
    { ticks: 1 },
  ];
  expect([0, 8, 16, 24, 25].map((t) => drawn(light, t))).toEqual([[0], [1], [2], [2, 3], [0]]);
  expect(patternBlend([{ ticks: 1 }], 0)).toBeNull();
});

it('pulls translucent materials in front of coplanar opaque ones', async () => {
  // Verity Lakefront: the sign's baked shadow (h_kage, alpha 9) and the white ground patches (s_snow,
  // opaque) both lie 1 unit above the grass; they fought pixel by pixel. Ties go to the shadow.
  const source = { get: () => Promise.reject(new Error('no assets')) };
  const materials = new Materials(new AssetCache(source), [], { stub: () => {} });
  const mat = (alpha: number) => Object.assign(new THREE.MeshStandardMaterial(), { userData: { lantern: { alpha } } });
  const shadow = (await materials.convert(mat(9), undefined, false)) as THREE.MeshBasicMaterial;
  const snow = (await materials.convert(mat(31), undefined, false)) as THREE.MeshBasicMaterial;
  expect(shadow.transparent).toBe(true);
  expect(shadow.polygonOffset && shadow.polygonOffsetFactor === 0 && shadow.polygonOffsetUnits < 0).toBe(true);
  expect(snow.polygonOffset).toBe(false);
});

it('gives billboard fragments the depth of a plane leaning back from the anchor to the object position, for both projections', () => {
  const perspective = new THREE.PerspectiveCamera(30, 4 / 3, 16, 2000);
  const ortho = new THREE.OrthographicCamera(-128, 128, 96, -96, 16, 2000);
  // The object stands at the tile centre (0, 0, 0); its quad's anchor is 6 units south.
  const anchor = new THREE.Vector3(0, 0, 6);
  for (const camera of [perspective, ortho]) {
    // Field framing: south of and above the character, looking down and north.
    camera.position.set(0, 180, 300);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const depth = (world: THREE.Vector3) => world.clone().project(camera).z * 0.5 + 0.5;
    // The fragment at a world point's pixel: any view-space point on that pixel's ray will do.
    const sprite = (world: THREE.Vector3) => billboardDepth(world.clone().applyMatrix4(camera.matrixWorldInverse), anchor, camera.matrixWorldInverse, camera.projectionMatrix, camera === ortho);
    // On the leaning plane: its own depth (8 units up, 3 units north of the anchor). Higher: the upright plane through the object.
    expect(sprite(new THREE.Vector3(5, 8, 3))).toBeCloseTo(depth(new THREE.Vector3(5, 8, 3)), 6);
    expect(sprite(new THREE.Vector3(5, 40, 0))).toBeCloseTo(depth(new THREE.Vector3(5, 40, 0)), 6);
    // A stair rail 2 units south of the anchor covers the sprite where they overlap.
    const rail = new THREE.Vector3(3, 12, 8);
    expect(depth(rail)).toBeLessThan(sprite(rail));
    // A wall on the object's tile, 2 units north of its position, up to the sprite's top, stays behind it.
    for (const y of [0, 16, 32]) {
      const wall = new THREE.Vector3(0, y, -2);
      expect(sprite(wall)).toBeLessThan(depth(wall));
    }
    // Pastoria City's face-in-hole board on the tile south (land 81): from 1.5 units up, 16 south of the object, to
    // 48 up, 3.6 south of it, leaning back over the anchor. On the DS it hides the character behind it: its lower
    // 40 units (all a 32-unit sprite can reach on screen) are in front of the sprite.
    for (let y = 1.5; y <= 40; y += 2) {
      const board = new THREE.Vector3(0, y, 16 - (y - 1.5) * (12.4 / 46.4));
      expect(depth(board), `board at height ${y}`).toBeLessThan(sprite(board));
    }
    // A desk on the tile north (z −24…−8, 16 high) whose top overhangs 4 units into the character's
    // tile stays behind the sprite at every point (the bedroom desk behind Barry).
    for (const x of [-12, 0, 12]) for (const y of [0, 8, 16]) for (const z of [-24, -16, -8, -4]) {
      const desk = new THREE.Vector3(x, y, z);
      expect(sprite(desk)).toBeLessThan(depth(desk));
    }
  }
});

it('turns billboard model nodes to the camera as G3D SBC BB and BBY do', async () => {
  const { billboardMatrix, faceCameraNodes } = await import('./billboard.ts');
  const camera = new THREE.PerspectiveCamera(30, 4 / 3, 16, 2000);
  camera.position.set(40, 180, 300);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const toViewer = new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion);
  // A node at (8, 0, 6), turned 90° about Y and scaled 2: full keeps position and scale, takes the camera's axes.
  const world = new THREE.Matrix4().compose(new THREE.Vector3(8, 0, 6), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2), new THREE.Vector3(2, 2, 2));
  const full = billboardMatrix(world, 'full', camera.quaternion);
  expect(new THREE.Vector3().setFromMatrixPosition(full).toArray()).toEqual([8, 0, 6]);
  expect(new THREE.Vector3(0, 0, 1).transformDirection(full).distanceTo(toViewer)).toBeLessThan(1e-6);
  expect(new THREE.Vector3(0, 0, 1).applyMatrix4(full).sub(new THREE.Vector3(8, 0, 6)).length()).toBeCloseTo(2, 6);
  // Y: the node's world up stays, its Z turns toward the viewer as far as that allows.
  const y = billboardMatrix(world, 'y', camera.quaternion);
  expect(new THREE.Vector3(0, 1, 0).transformDirection(y).distanceTo(new THREE.Vector3(0, 1, 0))).toBeLessThan(1e-6);
  const flat = toViewer.clone().setY(0).normalize();
  expect(new THREE.Vector3(0, 0, 1).transformDirection(y).distanceTo(flat)).toBeLessThan(1e-6);
  // A loaded model: the quad under its billboard node faces the camera when drawn, wherever the object stands.
  const node = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), new THREE.MeshBasicMaterial());
  node.userData.lantern = { billboard: 'full' };
  const root = new THREE.Group().add(new THREE.Group().add(node));
  root.position.set(100, 0, 50);
  faceCameraNodes(root);
  root.updateMatrixWorld(true);
  node.onBeforeRender({} as THREE.WebGLRenderer, new THREE.Scene(), camera, node.geometry, node.material, null as unknown as THREE.Group);
  expect(new THREE.Vector3(0, 0, 1).transformDirection(node.matrixWorld).distanceTo(toViewer)).toBeLessThan(1e-6);
  expect(new THREE.Vector3().setFromMatrixPosition(node.matrixWorld).toArray()).toEqual([100, 0, 50]);
});

it('draws billboards opaque, so their pixels carry their own polygon ID to edge marking', async () => {
  const { billboardMaterial } = await import('./billboard.ts');
  const { fieldOutputs } = await import('./composite.ts');
  const { material } = billboardMaterial(new THREE.Texture());
  fieldOutputs(material, { polygonId: 0, fog: true });
  const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: 'void main() {\ngl_Position = projectionMatrix * mvPosition;\n}', fragmentShader: 'void main() {\n#include <alphatest_fragment>\n}' };
  material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
  // w = 1: the pixel's ID replaces the one under it. With 0 (blended), the edges of the geometry behind a
  // character were drawn across it (the bedroom desk, the 1F mat, the Twinleaf door frame).
  expect(material.transparent).toBe(false);
  expect((shader.uniforms.uFieldId!.value as THREE.Vector4).w).toBe(1);
});

it('maps DS fog through the density table: offset, slope steps, interpolation, 127 as full', async () => {
  const { fogDensity } = await import('./composite.ts');
  const fog = { slope: 6, offset: 30037, color: [1, 1, 1] as [number, number, number], alpha: 31, densities: Array.from({ length: 32 }, (_, i) => i * 4) };
  expect(fogDensity(0, fog)).toBe(0);
  expect(fogDensity(30037 + 16 * 2, fog)).toBe(8); // step 0x400 >> 6 = 16
  expect(fogDensity(30037 + 16 * 2.5, fog)).toBe(10);
  expect(fogDensity(0x7fff, fog)).toBe(124);
  expect(fogDensity(0x7fff, { ...fog, densities: fog.densities.map(() => 127) })).toBe(128);
});

it('fogs by the DS Z-buffer depth: FOG is ~86% at the player on the field camera, clear 4 tiles nearer', async () => {
  const { fogDensity } = await import('./composite.ts');
  // CAMERA_TYPE_DEFAULT: distance 0x29AEC1 (666.9), pitch 59.05°, half fovY 8.09°, clip 150..900 (Camera_SetClipping).
  const [near, far, distance, pitch] = [150, 900, 666.922119140625, 59.051513671875];
  const camera = new THREE.PerspectiveCamera(16.182861328125, 4 / 3, near, far);
  camera.updateProjectionMatrix();
  // Our 15-bit depth: window depth × 0x7FFF, from the camera's own projection.
  const ours = (d: number) => ((new THREE.Vector3(0, 0, -d).project(camera).z + 1) / 2) * 0x7fff;
  // DS (GBATEK "3D Polygon Definitions", GX_BUFFERMODE_Z): ((z·0x4000 / w) + 0x3FFF)·0x200 in 24 bits; fog reads its top 15.
  const ds = (d: number) => {
    const z = ((far + near) / (near - far)) * -d + (2 * far * near) / (near - far);
    return Math.floor((Math.floor((z * 0x4000) / d) + 0x3fff) * 0x200) >> 9;
  };
  const fog = { slope: 6, offset: 30037, color: [1, 1, 1] as [number, number, number], alpha: 31, densities: Array.from({ length: 32 }, (_, i) => i * 4) };
  const tile = 16 * Math.cos((pitch * Math.PI) / 180); // view depth of one tile toward the camera
  for (const d of [distance, distance - tile, distance - 4 * tile, near + 1, far - 1]) expect(Math.abs(ours(d) - ds(d))).toBeLessThan(2);
  expect(Math.round(ds(distance))).toBe(30476);
  expect(Math.round(fogDensity(ds(distance), fog))).toBe(110); // 110/128 at the player
  expect(Math.round(fogDensity(ds(distance - tile), fog))).toBe(82); // one tile nearer
  expect(fogDensity(ds(distance - 4 * tile), fog)).toBe(0);
});

it('fogs the angled camera by linear depth: the DS window depth at the same distance from the target', async () => {
  const { linearFogDepth } = await import('./composite.ts');
  const [near, far, distance] = [150, 900, 666.922119140625];
  const window = (camera: THREE.PerspectiveCamera, d: number) => (new THREE.Vector3(0, 0, -d).project(camera).z + 1) / 2;
  const ds = new THREE.PerspectiveCamera(16, 4 / 3, near, far);
  const angled = new THREE.PerspectiveCamera(22, 4 / 3, near, far * 1.8);
  ds.updateProjectionMatrix();
  angled.updateProjectionMatrix();
  // The angled camera is nearer the target: the shift puts the target back at the DS camera's distance.
  const nearer = distance / 1.37;
  const l = { near, far: far * 1.8, dsNear: near, dsFar: far, shift: distance - nearer };
  for (const off of [0, -40, 60]) expect(linearFogDepth(window(angled, nearer + off), l)).toBeCloseTo(window(ds, distance + off), 5);
  // Past the DS far plane: the table's end.
  expect(linearFogDepth(window(angled, far * 1.5), l)).toBe(1);
  // No shift and the same planes: the DS depth itself.
  expect(linearFogDepth(0.7, { near, far, dsNear: near, dsFar: far, shift: 0 })).toBeCloseTo(0.7, 6);
});

it('plays field-effect animations once (holding the last frame) or looping; fades footprints; bobs the surf blob', async () => {
  const { effectFrame, fadeAlpha, surfBob } = await import('./effects.ts');
  const rustle = [
    { frame: 0, ticks: 4 },
    { frame: 1, ticks: 4 },
    { frame: 2, ticks: 1 },
  ];
  expect([0, 3, 4, 8, 50].map((t) => effectFrame(rustle, t, false))).toEqual([0, 0, 1, 2, 2]);
  expect([8, 9, 13].map((t) => effectFrame(rustle, t, true))).toEqual([2, 0, 1]);
  expect([0, 16, 17, 31, 40].map((t) => Math.round(fadeAlpha(t) * 31))).toEqual([31, 31, 29, 1, 0]);
  expect([0, 12, 24].map(surfBob)).toEqual([0, 3, 0]);
});

it('steps the weather tasks particles as the DS does: spawn, fall, the pool and the camera shift', async () => {
  const { WeatherSim, WEATHER_POOL } = await import('./weather-particles.ts');
  // Heavy snow (ov5_021D8098/ov5_021D81BC): flakes enter at y −8 and drift down-left, slowing; a map load prewarms 20.
  const snow = new WeatherSim('heavy-snow', 1);
  snow.prewarm(20, 2, 3);
  expect(snow.particles.length).toBeGreaterThan(10);
  expect(Math.max(...snow.particles.map((p) => p.y))).toBeGreaterThan(40);
  expect(snow.particles.every((p) => p.frame >= 0 && p.frame <= 2)).toBe(true);
  for (let t = 0; t < 300; t++) {
    if (t % 4 === 0) snow.spawn(6);
    snow.update();
    expect(snow.particles.length).toBeLessThanOrEqual(WEATHER_POOL);
  }
  expect(snow.particles.length).toBeGreaterThan(20);
  // The camera moving right by 10 px moves every flake 10 px left (wrapped into −64..319).
  const before = snow.particles.map((p) => p.x);
  snow.shift(10, 0);
  snow.particles.forEach((p, i) => expect(p.x === before[i]! - 10 || p.x > before[i]!).toBe(true));
  // Rain (ov5_021D78A4/ov5_021D7960): drops placed 96 px above the screen (wrapped by ov5_021D630C to 160) live one or
  // two ticks, then some splash.
  const rain = new WeatherSim('rain', 7);
  rain.spawn(4);
  expect(rain.particles.map((p) => p.y)).toEqual([160, 160, 160, 160]);
  let splashed = false;
  for (let t = 0; t < 60; t++) {
    rain.spawn(4);
    rain.update();
    splashed ||= rain.particles.some((p) => p.frame === 3);
  }
  expect(splashed).toBe(true);
  expect(rain.particles.length).toBeLessThan(WEATHER_POOL);
  // The blizzard (ov5_021D92C4) does not move with the camera.
  const blizzard = new WeatherSim('blizzard', 3);
  blizzard.spawn(1);
  const x = blizzard.particles.map((p) => p.x);
  blizzard.shift(10, 10);
  expect(blizzard.particles.map((p) => p.x)).toEqual(x);
});

it('covers a wide view with DS screens, the DS screen in the middle, and scales the camera shift as ov5_021D7028', async () => {
  const { weatherTiles, weatherCameraScale } = await import('./weather.ts');
  expect(weatherTiles(256, 192)).toEqual([{ key: '0,0', x: 0, y: 0 }]);
  const wide = weatherTiles(341, 192);
  expect(wide.map((t) => t.x)).toEqual([-213, 43, 299]);
  // The field camera (FOV 8.09°, distance 666.9): about 1 DS px per unit.
  const s = weatherCameraScale(16.18, 666.92);
  expect(s.perX).toBeCloseTo(1.01, 2);
  expect(s.perZ[0]).toBeCloseTo(1.0, 1);
});

it('scrolls a weather BG layer per tick, wrapping at 256 (G2_SetBG2Offset)', async () => {
  const { layerOffset } = await import('./weather.ts');
  // SANDSTORM: offset (2b, -b) with b += 6 per tick.
  expect([0, 1, 21, 22].map((t) => layerOffset([12, -6], t))).toEqual([
    [0, 0],
    [12, 250],
    [252, 130],
    [8, 124],
  ]);
  expect(layerOffset([0, 0], 1000)).toEqual([0, 0]);
});

it('keys actors uniquely when local ids repeat (a clone object next to a scripted one), whatever their order', () => {
  const actor = ([localId, sprite]: [number, Id]): ActorView => ({ localId, sprite, cur: [0, 0, 0] as Vec3, prev: [0, 0, 0] as Vec3, facing: 'down' as const, anim: 'stand' as const, animTick: 0, visible: true, emote: false });
  const twinleaf: [number, Id][] = [[255, 'test:PLAYER'], [3, 'test:GUITARIST'], [5, 'test:MAILBOX'], [3, 'test:SIGNPOST'], [5, 'test:MAILBOX']];
  expect(actorKeys(twinleaf.map(actor))).toEqual(['255:test:PLAYER#0', '3:test:GUITARIST#0', '5:test:MAILBOX#0', '3:test:SIGNPOST#0', '5:test:MAILBOX#1']);
  // Across the border the zone lists the pair the other way round: each keeps its key (and its drawable).
  const route: [number, Id][] = [[255, 'test:PLAYER'], [3, 'test:SIGNPOST'], [3, 'test:GUITARIST']];
  expect(actorKeys(route.map(actor))).toEqual(['255:test:PLAYER#0', '3:test:SIGNPOST#0', '3:test:GUITARIST#0']);
});

it('picks the area light template by the clock: the first whose end is later (AreaLightManager)', () => {
  const t = (k: number): LightTemplate => ({ lights: [null, null, null, null], diffuse: [k, k, k], ambient: [0, 0, 0], specular: [0, 0, 0], emission: [0, 0, 0] });
  const light = { ...t(0.5), schedule: [{ until: 0, ...t(0.1) }, { until: 6 * 3600, ...t(0.2) }, { until: 18 * 3600, ...t(0.3) }, { until: 86400, ...t(0.4) }] };
  expect(lightAt(light, 0).index).toBe(1); // a template ending at 0 is never chosen
  expect(lightAt(light, 6 * 3600 - 1).index).toBe(1);
  expect(lightAt(light, 6 * 3600).index).toBe(2);
  expect(lightAt(light, 86399)).toMatchObject({ index: 3, template: { diffuse: [0.4, 0.4, 0.4] } });
  expect(lightAt(t(0.5), 3600)).toMatchObject({ index: -1, template: { diffuse: [0.5, 0.5, 0.5] } });
  // Shadows by period: faint and small late at night, strongest by day.
  expect(SHADOW_BY_PERIOD.lateNight.alpha).toBeLessThan(SHADOW_BY_PERIOD.night.alpha);
  expect(SHADOW_BY_PERIOD.day).toEqual({ alpha: 18, x: 1.25, z: 1.25 });
});

it('lights a billboard with the template colours, light 0 only, its normal facing the camera', () => {
  const k = (n: number): [number, number, number] => [n / 31, n / 31, n / 31];
  // Light 0 shines straight away from the camera (no diffuse on a camera-facing quad); light 1 is ignored.
  const t: LightTemplate = { lights: [{ color: [0.5, 0.25, 1], direction: [0, 0, 1] }, { color: [1, 1, 1], direction: [0, 0, -1] }, null, null], diffuse: k(16), ambient: k(10), specular: k(0), emission: k(4) };
  const rgb = billboardLight(t);
  expect(rgb.map((v) => v * 31)).toEqual([0.5, 0.25, 1].map((c) => expect.closeTo(4 + c * 10, 9)));
  // Facing light 0 head on adds its diffuse share (normal 511/512) and the specular highlight.
  const lit = billboardLight({ lights: [{ color: [1, 1, 1], direction: [0, 0, -1] }, null, null, null], diffuse: k(8), ambient: k(4), specular: k(4), emission: k(2) });
  const n = 511 / 512;
  expect(lit[0] * 31).toBeCloseTo(2 + 8 * n + 4 + 4 * n * n, 9);
  // Clamped at full brightness.
  expect(billboardLight({ ...t, emission: k(31) })).toEqual([1, 1, 1]);
});

it('draws the field edge colour as Platinum sets it: COLOR_DARK_GRAY = RGB555 (4, 4, 4), 33 on screen', async () => {
  const { EDGE_COLORS, rgb5 } = await import('./composite.ts');
  // area_data.c sOutdoorsEdgeMarkings: 8× COLOR_DARK_GRAY; sIndoorsEdgeMarkings: COLOR_BLACK, then 7× dark grey.
  // The 5→8-bit expansion textures use (c << 3 | c >> 2): 4 → 33. It was drawn as (15, 15, 15) = 123, a light grey.
  expect(Math.round(rgb5(4) * 255)).toBe(33);
  expect(Math.round(rgb5(31) * 255)).toBe(255);
  for (const c of EDGE_COLORS.outdoors) expect(c.toArray().map((x) => Math.round(x * 255))).toEqual([33, 33, 33]);
  expect(EDGE_COLORS.indoors.map((c) => Math.round(c.r * 255))).toEqual([0, 33, 33, 33, 33, 33, 33, 33]);
});

it('blends edge-marked pixels 17/32 over the far polygon (DS anti-aliasing), unblended against the rear plane', async () => {
  const { edgePixel, rgb5 } = await import('./composite.ts');
  const grey = [rgb5(4), rgb5(4), rgb5(4)];
  const px = (c: number[]) => c.map((x) => Math.round(x * 255));
  // Grass behind a house edge in our 22:00 Twinleaf frame (25, 77, 65): a dark line, darker than both sides.
  expect(px(edgePixel(grey, [25 / 255, 77 / 255, 65 / 255]))).toEqual([29, 54, 48]);
  expect(px(edgePixel(grey, null))).toEqual([33, 33, 33]);
});

it('gives edge-marking IDs to opaque materials only: translucent ones keep the ID under them, as on the DS', async () => {
  const source = { get: () => Promise.reject(new Error('no assets')) };
  const materials = new Materials(new AssetCache(source), [], { stub: () => {} });
  const field = async (opensinnoh: object) => {
    const m = await materials.convert(Object.assign(new THREE.MeshStandardMaterial(), { userData: { lantern: opensinnoh } }), undefined, false);
    const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: '', fragmentShader: 'void main() {\n#include <alphatest_fragment>\n}' };
    m.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    const v = shader.uniforms.uFieldId!.value as THREE.Vector4;
    // Opaque materials write without blending; translucent ones blend by the second target's alpha (the fog flag), 0.
    return { id: Math.round(v.x * 63), writes: !m.transparent, fog: v.w === 1 };
  };
  // Twinleaf: every ground layer (grass, paths, flowers, trees) is ID 0, the houses 8, their baked shadow h_kage alpha 9.
  expect(await field({ alpha: 31, polygonId: 0 })).toEqual({ id: 0, writes: true, fog: false });
  expect(await field({ alpha: 31, polygonId: 8, fog: true })).toEqual({ id: 8, writes: true, fog: true });
  expect(await field({ alpha: 9, polygonId: 0, fog: true })).toEqual({ id: 0, writes: false, fog: false });
});

it('keeps the sprite behind an overhead surface even when its upright head would protrude through it', () => {
  for (const camera of [new THREE.PerspectiveCamera(30, 4 / 3, 16, 2000), new THREE.OrthographicCamera(-128, 128, 96, -96, 16, 2000)]) {
    camera.position.set(0, 180, 300);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const roof = new THREE.Vector3(0, 16, 2);
    const depth = roof.clone().project(camera).z * 0.5 + 0.5;
    const view = roof.clone().applyMatrix4(camera.matrixWorldInverse);
    const capped = billboardDepth(view, new THREE.Vector3(0, 0, 6), camera.matrixWorldInverse, camera.projectionMatrix, camera instanceof THREE.OrthographicCamera, 15.75);
    expect(capped, 'the belt covers the head at its pixels').toBeGreaterThan(depth);
  }
});

it('keeps the Galactic interior haze light while retaining its colour and depth gradient', async () => {
  const { fieldFog } = await import('./weather.ts');
  const { fogDensity } = await import('./composite.ts');
  const original = { slope: 3, offset: 26095, color: [2/31,2/31,6/31] as [number,number,number], alpha: 31, densities: Array.from({length:32},(_,i)=>i*4) };
  const weather = {id:'test:weather' as Id,sourceIndex:26,name:'Galactic haze',fog:original};
  const haze=fieldFog(weather)!;
  expect(haze.color).toEqual(original.color);
  expect(fogDensity(29222,haze)).toBeLessThan(50);
  expect(fogDensity(29222,haze)).toBeGreaterThan(20);
  expect(fogDensity(30000,haze)).toBeGreaterThan(fogDensity(29000,haze));
  expect(original.densities[31]).toBe(124);
  expect(fieldFog({...weather,sourceIndex:14})).toBe(original);
  expect(fieldFog({id:'test:clear' as Id,name:'Clear'})).toBeNull();
});

it('clones the lit shadow model sharing its geometry, without a JSON copy of its stored normals', () => {
  const geometry = new THREE.PlaneGeometry(8, 8);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  const normals = new Float32Array([0, 1, 0]);
  mesh.userData.lit = { mask: 1, normals };
  const root = new THREE.Group().add(mesh);
  const copy = sharedLightClone(root);
  const copied = copy.children[0] as THREE.Mesh;
  // Relighting the model recolours the copies: they draw its geometry, colour attribute included.
  expect(copied.geometry).toBe(geometry);
  expect(copied.userData.lit).toBeUndefined();
  expect((mesh.userData.lit as { normals: Float32Array }).normals).toBe(normals);
});

it('moves a billboard depth anchor past a stair that rises toward a camera looking down less steeply than it', () => {
  // A stair rising 1:1 to the south from z = 0 to z = 48 (y 0 → 48), a landing past it, and a wall at z = 80.
  const stair = (_x: number, z: number) => [z < 0 ? 0 : z < 48 ? z : z < 80 ? 48 : 80];
  const toward = (pitchDeg: number) => new THREE.Vector3(0, Math.sin((pitchDeg * Math.PI) / 180), Math.cos((pitchDeg * Math.PI) / 180));
  // The object stands on the stair's foot at z = 2; its anchor is 6 units south, under the stair's surface.
  const anchor = new THREE.Vector3(0, 2, 8);
  // A 35° camera: the stair and its landing hide the anchor; the depth moves past the stair's top, short of the wall
  // (a step, where the walk stops).
  const at = anchor.clone().add(slopeDepthLift(anchor, toward(35), 2, stair));
  expect(at.z).toBeGreaterThan(48);
  expect(at.z).toBeLessThan(80);
  expect(at.y).toBeGreaterThan(48);
  // A stair model on flat terrain (Pastoria City's gate): its 4-unit steps rise over the floor the terrain keeps.
  const model = (_x: number, z: number) => (z < 64 ? [0, 4 * Math.floor(z / 4) + 4] : []);
  expect(new THREE.Vector3(0, 0, 6).add(slopeDepthLift(new THREE.Vector3(0, 0, 6), toward(35), 0, model)).z).toBeGreaterThan(40);
  // Flat ground, a stair rising away from the camera, and a camera straight above: no lift.
  expect(slopeDepthLift(new THREE.Vector3(0, 0, 6), toward(35), 0, () => [0]).length()).toBe(0);
  expect(slopeDepthLift(new THREE.Vector3(0, -2, 8), toward(35), -2, (_x, z) => [-z]).length()).toBe(0);
  expect(slopeDepthLift(anchor, new THREE.Vector3(0, 1, 0), 2, stair).length()).toBe(0);
  // A cliff or a bridge deck right in front still hides the character.
  expect(slopeDepthLift(new THREE.Vector3(0, 0, 6), toward(35), 0, (_x, z) => (z > 10 ? [64] : [0])).length()).toBe(0);
  expect(slopeDepthLift(new THREE.Vector3(0, 0, 6), toward(35), 0, (_x, z) => (z > 10 ? [0, 40] : [0])).length()).toBe(0);
});
