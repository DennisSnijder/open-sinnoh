import * as THREE from 'three';
import type { Id } from '@opensinnoh/core';
import type { AssetRef, Camera as CameraRecord, DistortionView, DistortionWorldTables, Weather } from '@opensinnoh/contracts';
import { fieldOutputs, type FieldOutput } from '../composite.ts';

/**
 * The Distortion World's presentation (decomp overlay 9): its own camera (CameraInit plus the camera manager's
 * angle offsets, rolled), its fog (InitFog: colour and alpha toward black, so the far field fades into the sky),
 * the sky behind the field (InitSkyBackground, the cloud sprites), and the props it places itself.
 */

const DEG = Math.PI / 180;
/** DS binary angle (65536 a turn, as a signed s16) to degrees. */
const angleDeg = (a: number) => (((a << 16) >> 16) * 360) / 65536;

/**
 * DISTORTION_WORLD_CAMERA_BASE_*: angle (−10750, 0, 0), distance 0x29AEC1 (fx32), perspective, half FOV 1473
 * (binary angle) widened by 0x681 − 0x5C1 outside the Giratina room, clipping 150–1700.
 */
const BASE = { angleX: -10750, distance: 0x29aec1 / 4096, fovHalf: 1473, wider: 0x681 - 0x5c1, near: 150, far: 1700 };

/** The camera this frame: the base angles plus the offsets (interpolated the short way between two ticks). */
export function distortionCamera(view: DistortionView, giratinaRoom: boolean, alpha: number): CameraRecord {
  const lerp = (a: number, b: number) => {
    const d = ((((b - a) << 16) >> 16) * alpha);
    return (a + d) & 0xffff;
  };
  const [x, y, z] = [0, 1, 2].map((i) => lerp(view.camera.prev[i]!, view.camera.cur[i]!)) as [number, number, number];
  const fovHalf = BASE.fovHalf + (giratinaRoom ? 0 : BASE.wider);
  return {
    id: (giratinaRoom ? 'distortion:camera-giratina' : 'distortion:camera') as Id,
    distance: BASE.distance,
    angle: [angleDeg((BASE.angleX + x) & 0xffff), angleDeg(y), angleDeg(z)],
    projection: 'perspective',
    fovY: ((2 * fovHalf * 360) / 65536),
    near: BASE.near,
    far: BASE.far,
  };
}

/**
 * InitFog: GX_FOGBLEND_COLOR_ALPHA toward black and alpha 16, GX_FOGSLOPE_0x0200 (shift 6), offset
 * 0x7600, densities (88 / 32) × i. The enum names the whole table's depth range, not one entry's step:
 * 0x200 / 32 = 16, i.e. `0x400 >> 6`.
 */
export const DISTORTION_FOG: NonNullable<Weather['fog']> = { slope: 6, offset: 0x7600, color: [0, 0, 0], alpha: 16, densities: Array.from({ length: 32 }, (_, i) => Math.trunc(88 / 32) * i) };

/** RecalculateSkyBackgroundDarkness's tints: the BG toward GX_RGB(4, 4, 8), the clouds toward GX_RGB(6, 6, 8). */
const BG_TINT = new THREE.Color(4 / 31, 4 / 31, 8 / 31);
const CLOUD_TINT = new THREE.Color(6 / 31, 6 / 31, 8 / 31);

const tinted = (map: THREE.Texture, tint: THREE.Color) =>
  new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    uniforms: { map: { value: map }, tint: { value: tint }, level: { value: 0 }, rows: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    // CalculateTintedColor: base + (tint − base) × level / 16, per 5-bit channel. `rows` > 0: v is held within the first `rows` texel rows (the BG's rows the DS screen shows), so a view taller
    // than the DS screen continues its top and bottom rows rather than the BG's unseen rest.
    fragmentShader:
      'uniform sampler2D map; uniform vec3 tint; uniform float level; uniform float rows; varying vec2 vUv; void main() { vec2 uv = vUv; if (rows > 0.0) uv.y = clamp(uv.y, 0.5 / 256.0, (rows - 0.5) / 256.0); vec4 c = texture2D(map, uv); if (c.a < 0.5) discard; gl_FragColor = vec4(mix(c.rgb, tint, level / 16.0), 1.0); }',
  });

/**
 * The sky behind the field: main BG2's picture, wrapping as a DS BG does past its 256×256 (the DS screen shows its
 * top left), and the nine clouds on their orbits over it (OBJ at the BG's priority), all in DS screen pixels
 * centred on the view.
 */
export class DistortionSky {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(0, 256, 0, 192, -1, 1);
  private background: THREE.Mesh | null = null;
  /** Each cloud set's quad and material, once its image is loaded; the clouds drawn, one mesh per view cloud. */
  private readonly sets: ({ geometry: THREE.BufferGeometry; material: THREE.ShaderMaterial } | null)[] = [];
  private readonly clouds: THREE.Mesh[] = [];
  private pending = 0;

  constructor(
    sky: DistortionWorldTables['sky'],
    texture: (ref: AssetRef) => Promise<THREE.Texture>,
    failed: (what: string) => (e: unknown) => never,
  ) {
    this.pending = 1 + sky.clouds.length;
    void texture(sky.background)
      .then((map) => {
        const t = map.clone();
        t.wrapS = THREE.RepeatWrapping;
        t.magFilter = t.minFilter = THREE.NearestFilter;
        t.needsUpdate = true;
        const material = tinted(t, BG_TINT);
        material.uniforms.rows!.value = 192;
        this.background = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
        this.background.renderOrder = 0;
        this.scene.add(this.background);
        this.pending--;
      })
      .catch(failed('the Distortion World sky'));
    sky.clouds.forEach((c, i) => {
      this.sets[i] = null;
      void texture(c.image)
        .then((map) => {
          const img = map.image as { width: number; height: number };
          // The quad's (0, 0) is the sprite position, the image's origin. Under the y-down camera a plane's +y
          // edge is its lower one, where v = 1 (the image's last row: textures are not flipped).
          const geometry = new THREE.PlaneGeometry(img.width, img.height).translate(img.width / 2 - c.originX, img.height / 2 - c.originY, 0);
          const t = map.clone();
          t.magFilter = t.minFilter = THREE.NearestFilter;
          t.needsUpdate = true;
          this.sets[i] = { geometry, material: tinted(t, CLOUD_TINT) };
          this.pending--;
        })
        .catch(failed(`the Distortion World cloud set ${i}`));
    });
  }

  loading(): boolean {
    return this.pending > 0;
  }

  /** Draws the sky for a view `width`×`height` DS px around the DS screen's centre. */
  draw(renderer: THREE.WebGLRenderer, view: DistortionView['sky'], width: number, height: number): void {
    const x0 = 128 - width / 2;
    const y0 = 96 - height / 2;
    Object.assign(this.camera, { left: x0, right: x0 + width, top: y0, bottom: y0 + height });
    this.camera.updateProjectionMatrix();
    if (this.background) {
      // The BG covers the view; its texels repeat every 256 px from the DS screen's top left (texture rows run down).
      const bg = this.background;
      bg.position.set(x0 + width / 2, y0 + height / 2, 0);
      bg.scale.set(width, height, 1);
      const uv = bg.geometry.attributes.uv as THREE.BufferAttribute;
      // PlaneGeometry's vertices: top left, top right, bottom left, bottom right (in +y, which is up the screen here).
      const corners = [[x0, y0 + height], [x0 + width, y0 + height], [x0, y0], [x0 + width, y0]];
      corners.forEach(([u, v], k) => uv.setXY(k, u! / 256, v! / 256));
      uv.needsUpdate = true;
      (bg.material as THREE.ShaderMaterial).uniforms.level!.value = view.darkness;
    }
    view.clouds.forEach((c, i) => {
      const set = this.sets[c.set];
      let mesh = this.clouds[i];
      if (set && (!mesh || mesh.geometry !== set.geometry)) {
        if (mesh) this.scene.remove(mesh);
        mesh = new THREE.Mesh(set.geometry, set.material);
        mesh.renderOrder = 1;
        this.clouds[i] = mesh;
        this.scene.add(mesh);
      }
      if (!mesh) return;
      mesh.position.set(c.x, c.y, 0);
      mesh.rotation.set(0, 0, c.rotation * DEG);
      mesh.scale.set(c.scale, c.scale, 1);
      (mesh.material as THREE.ShaderMaterial).uniforms.level!.value = view.darkness;
    });
    renderer.render(this.scene, this.camera);
  }
}

/**
 * The props the Distortion World places itself (`DistortionView.props`): one object per key and map load, its
 * materials its own so its opacity (GX polygon alpha, 0–31) is its own, posed at its joint clip's frame.
 */
export class DistortionProps {
  private readonly live = new Map<string, { root: THREE.Object3D | null; mixer?: THREE.AnimationMixer; opacity: number }>();
  private loads = -1;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly tables: DistortionWorldTables,
    private readonly loadModel: (model: Id) => Promise<THREE.Object3D>,
    private readonly failed: (what: string) => (e: unknown) => never,
  ) {}

  update(props: DistortionView['props'], loads: number, alpha: number): void {
    if (loads !== this.loads) this.clear(loads);
    const want = new Map(props.map((p) => [p.key, p]));
    for (const [key, e] of this.live) {
      if (want.has(key)) continue;
      if (e.root) this.scene.remove(e.root);
      this.live.delete(key);
    }
    for (const p of want.values()) {
      let e = this.live.get(p.key);
      if (!e) {
        const entry: { root: THREE.Object3D | null; mixer?: THREE.AnimationMixer; opacity: number } = { root: null, opacity: 31 };
        e = entry;
        this.live.set(p.key, entry);
        void this.loadModel(this.tables.props[p.prop].model)
          .then((root) => {
            if (this.live.get(p.key) !== entry) return;
            own(root, p.prop === 'portal');
            entry.root = root;
            this.scene.add(root);
          })
          .catch(this.failed(`Distortion World prop ${p.key}`));
      }
      const root = e.root;
      if (!root) continue;
      root.position.set(...([0, 1, 2].map((k) => p.prev[k]! + (p.cur[k]! - p.prev[k]!) * alpha) as [number, number, number]));
      root.scale.setScalar(p.scale ?? 1);
      const r = p.rotation ?? [0, 0, 0];
      root.rotation.set((r[0] * Math.PI) / 180, (r[1] * Math.PI) / 180, (r[2] * Math.PI) / 180);
      root.visible = p.opacity > 0;
      if (p.opacity !== e.opacity) {
        setOpacity(root, p.opacity);
        e.opacity = p.opacity;
      }
      const clip = this.tables.props[p.prop].clip;
      if (clip && p.frame !== undefined) pose(e, root, clip.name, p.frame);
    }
  }

  loading(): boolean {
    for (const e of this.live.values()) if (!e.root) return true;
    return false;
  }

  private clear(loads: number): void {
    for (const e of this.live.values()) if (e.root) this.scene.remove(e.root);
    this.live.clear();
    this.loads = loads;
  }
}

/** Gives every mesh its own material (keeping the field outputs), so one prop's opacity is not another's. */
function own(root: THREE.Object3D, portal: boolean): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const source = mesh.material as THREE.Material;
    const m = fieldOutputs(source.clone(), source.userData.fieldOutput as FieldOutput);
    if (portal) {
      // The portal's alpha-textured glow lies on the cliff face. Keep the full
      // alpha ramp and bias the translucent decal against that near-coplanar face.
      m.transparent = true;
      m.depthWrite = false;
      (m as THREE.MeshBasicMaterial).alphaTest = 1 / 255;
      m.polygonOffset = true;
      m.polygonOffsetFactor = -1;
      // Its tilted quad differs from the cliff by a fraction of a world unit;
      // 4096 depth steps keep the entire glow above it under the DW camera.
      m.polygonOffsetUnits = -4096;
    }
    m.userData.baseOpacity = source.opacity;
    m.userData.baseTransparent = m.transparent;
    mesh.material = m;
  });
}

/** SetPropOpacity: the polygon alpha of every material (31 = as authored). */
function setOpacity(root: THREE.Object3D, opacity: number): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const m = mesh.material as THREE.Material;
    m.opacity = (m.userData.baseOpacity as number) * (opacity / 31);
    m.transparent = opacity < 31 || (m.userData.baseTransparent as boolean);
    m.needsUpdate = true;
  });
}

function pose(e: { mixer?: THREE.AnimationMixer }, root: THREE.Object3D, name: string, frame: number): void {
  const clips = (root.userData.animations ?? []) as THREE.AnimationClip[];
  const clip = clips.find((c) => c.name === name);
  if (!clip) throw new Error(`render: Distortion World prop has no clip ${name}`);
  e.mixer ??= new THREE.AnimationMixer(root);
  const action = e.mixer.clipAction(clip);
  action.play();
  action.paused = true;
  action.time = frame / 30;
  e.mixer.update(0);
}
