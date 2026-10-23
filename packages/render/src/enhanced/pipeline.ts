import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { Camera as CameraRecord, Zone } from '@opensinnoh/contracts';
import type { EnhancedConfig } from './config.ts';
import { AO_SHADER, DOF_SHADER, GRADE_SHADER, SUN_SHADER } from './shaders.ts';
import { Particles, particleKinds } from './particles.ts';
import { LampGlows } from './lamps.ts';
import type { LampPoint } from './lamp-points.ts';
import { bloomAt, goldenAt, gradeAt, nightAt, sunDirection } from './time.ts';

/**
 * Enhanced visuals (prototype; config.ts): a lazy chunk, loaded only once a config turns an effect on. The field
 * renderer hands it the camera after the DS placed it (`placeCamera`), the character shadows (`stretchShadows`) and
 * the composited DS frame (`begin` redirects the composite into this chunk's buffer, `finish` draws the particles,
 * the lamp glows and the post chain to the screen). The 2D layers (weather, darkness, fades) stay on top, unchanged.
 */

const DEG = Math.PI / 180;
const OUTDOORS = new Set<Zone['mapType']>(['town', 'city', 'route', 'outdoors']);

/** What the angled camera does to the DS preset: the FOV's tangent grows by this, the distance shrinks by it. */
const FOV_SCALE = 1.37;
/** The angled camera's pitch: the DS pitch less this, but no lower than `MIN_PITCH` (degrees). */
const PITCH_DROP = 21;
const MIN_PITCH = 30;
/** Follow: the target's lag (seconds to close 63 %), how far ahead it looks (ticks of movement) and its leash. */
const FOLLOW_LAG = 0.2;
const LOOKAHEAD_TICKS = 10;
const LEASH = 30;

export interface Reach {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface EnhancedFrame {
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  /** The composite's depth (the field render's), the same camera's. */
  depth: THREE.Texture;
  /** Clock seconds since midnight. */
  seconds: number;
  zone: Zone;
  /** A weather draws (rain, snow, fog, sandstorm): no particles. */
  weather: boolean;
  /** The player's feet (world), for the focus. */
  player: THREE.Vector3 | null;
  /** The camera target (world). */
  target: THREE.Vector3;
  /** Lamps and lit windows in the scene (world). */
  lamps: readonly LampPoint[];
}

export class EnhancedPipeline {
  private config: EnhancedConfig;
  private readonly composer: EffectComposer;
  private readonly ao: ShaderPass;
  private readonly bloom: UnrealBloomPass;
  private readonly sun: ShaderPass;
  private readonly dofH: ShaderPass;
  private readonly dofV: ShaderPass;
  private readonly grade: ShaderPass;
  private readonly particles = new Particles();
  private readonly lamps = new LampGlows();
  private readonly size = new THREE.Vector2(1, 1);
  private follow: { aim: THREE.Vector3; ahead: THREE.Vector3; last: number } | null = null;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    config: EnhancedConfig,
  ) {
    this.config = config;
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.composer = new EffectComposer(renderer, target);
    this.composer.setPixelRatio(1);
    this.ao = new ShaderPass(AO_SHADER);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.4, 0.5, 0.85);
    this.sun = new ShaderPass(SUN_SHADER);
    this.dofH = new ShaderPass(DOF_SHADER);
    this.dofV = new ShaderPass(DOF_SHADER);
    this.grade = new ShaderPass(GRADE_SHADER);
    for (const p of [this.ao, this.bloom, this.sun, this.dofH, this.dofV, this.grade]) this.composer.addPass(p);
    this.setConfig(config);
  }

  setConfig(config: EnhancedConfig): void {
    if (config.camera !== this.config.camera) this.follow = null;
    this.config = config;
    this.ao.enabled = config.ao;
    this.bloom.enabled = config.bloom || config.lamps;
    this.sun.enabled = config.sun;
    this.dofH.enabled = this.dofV.enabled = config.dof;
    // The grade pass always runs last: it writes the screen (neutral when grading is off).
    this.grade.enabled = true;
  }

  /** The drawing buffer's size in device pixels. */
  setSize(width: number, height: number): void {
    this.size.set(width, height);
    this.composer.setSize(width, height);
  }

  /** A new map: the follow camera snaps. */
  reset(): void {
    this.follow = null;
  }

  /**
   * The angled camera, after the DS placed `camera` (`dsFov`: the DS preset's FOV widened to the view): lower pitch,
   * wider FOV, nearer, framing the same ground size at the target; `follow` lags and looks ahead of the target. The
   * view reaches farther, so the far plane moves out (the DS fog's depth table then lands nearer; no field map with
   * fog uses this camera's look in the showcase). Returns how far the view reaches on the ground, for chunk loading.
   */
  placeCamera(camera: THREE.PerspectiveCamera | THREE.OrthographicCamera, rec: CameraRecord, target: THREE.Vector3, velocity: THREE.Vector3, dsFov: number, zoom: number): Reach | null {
    if (this.config.camera === 'off' || !(camera instanceof THREE.PerspectiveCamera)) return null;
    const tan = Math.tan((dsFov / 2) * DEG) * FOV_SCALE;
    camera.fov = (2 * Math.atan(tan)) / DEG;
    camera.far = rec.far * 1.8;
    camera.updateProjectionMatrix();
    const sign = Math.sign(rec.angle[0]) || -1;
    const pitch = sign * Math.max(MIN_PITCH, Math.abs(rec.angle[0]) - PITCH_DROP) * DEG;
    const distance = (rec.distance + zoom) / FOV_SCALE;
    const aim = target.clone();
    if (this.config.camera === 'follow') {
      const now = performance.now();
      const ahead = velocity.clone().setY(0).multiplyScalar(LOOKAHEAD_TICKS);
      if (ahead.length() > LEASH) ahead.setLength(LEASH);
      if (!this.follow || this.follow.aim.distanceTo(target) > 96) this.follow = { aim: target.clone(), ahead, last: now };
      const f = this.follow;
      const k = 1 - Math.exp(-Math.min(0.1, (now - f.last) / 1000) / FOLLOW_LAG);
      f.last = now;
      f.ahead.lerp(ahead, k * 0.5);
      f.aim.lerp(target.clone().add(f.ahead), k);
      // The leash: the player never leaves the middle of the frame.
      const off = f.aim.clone().sub(target);
      if (off.length() > LEASH) f.aim.copy(target).add(off.setLength(LEASH));
      aim.copy(f.aim);
    }
    aim.y += 6;
    camera.position.set(0, -Math.sin(pitch) * distance, Math.cos(pitch) * distance).applyAxisAngle(new THREE.Vector3(0, 1, 0), rec.angle[1] * DEG).add(aim);
    camera.lookAt(aim);
    if (rec.angle[2]) camera.rotateZ(rec.angle[2] * DEG);
    camera.updateMatrixWorld();
    return groundReach(camera, target);
  }

  /**
   * Long character shadows at golden hour: each shadow turns away from the sun and stretches with its low elevation.
   * The shadows' own position and scale are set each frame before this; their rotation is ours.
   */
  stretchShadows(shadows: readonly THREE.Object3D[], seconds: number, zone: Zone): void {
    const on = this.config.sun && OUTDOORS.has(zone.mapType);
    const sun = sunDirection(seconds / 3600);
    const golden = goldenAt(seconds / 3600);
    const away = new THREE.Vector3(-sun.x, 0, -sun.z);
    const flat = away.length();
    const length = on && sun.y > 0 && flat > 0.01 ? 1 + Math.min(2.2, (flat / Math.max(0.15, sun.y)) * 0.5) * Math.max(0.35, golden) : 1;
    for (const s of shadows) {
      if (!on || length === 1) {
        s.rotation.y = 0;
        continue;
      }
      away.normalize();
      s.rotation.y = Math.atan2(away.x, away.z);
      s.scale.z *= length;
      s.position.addScaledVector(away, (length - 1) * 4);
    }
  }

  /** Sends the composite to this chunk's buffer (call instead of drawing to the screen). */
  begin(): void {
    this.renderer.setRenderTarget(this.composer.readBuffer);
  }

  /** Particles and lamp glows into the buffer, then the post chain to the screen. */
  finish(frame: EnhancedFrame): void {
    const { camera, depth } = frame;
    // Indoors and in caves the DS light does not follow the clock: neither does the look, and there is no sun.
    const outdoors = OUTDOORS.has(frame.zone.mapType);
    const hour = outdoors ? frame.seconds / 3600 : 12;
    const night = nightAt(frame.seconds / 3600);
    // No sun at night (the flare and the shafts would streak the lamps and fireflies).
    const sunOn = this.config.sun && outdoors && night < 0.9;
    const golden = goldenAt(hour);
    const [w, h] = [this.size.x, this.size.y];
    const persp = camera instanceof THREE.PerspectiveCamera;
    const projScale = camera.projectionMatrix.elements[5]! * (h / 2);
    const lin = { uNear: camera.near, uFar: camera.far, uPersp: persp };
    const r = this.renderer;

    if (this.config.particles) {
      const kinds = frame.weather ? [] : particleKinds(frame.zone, frame.seconds / 3600);
      this.particles.draw(r, camera, frame.target, kinds, depth, w, h, projScale, persp);
    }
    // Lamps light at night outdoors; indoors and in caves they are always on, softer.
    const lampLevel = outdoors ? night : 0.6;
    if (this.config.lamps && lampLevel > 0.05) this.lamps.draw(r, camera, frame.lamps, depth, w, h, projScale, persp, lampLevel);

    if (this.config.ao) {
      set(this.ao, { tDepth: depth, uProjScale: projScale, uStrength: 0.55 });
      (uniforms(this.ao).uTexel!.value as THREE.Vector2).set(1 / w, 1 / h);
      setLin(this.ao, lin);
    }
    if (this.bloom.enabled) {
      const b = bloomAt(hour, this.config.lamps);
      this.bloom.strength = b.strength;
      this.bloom.threshold = b.threshold;
      this.bloom.radius = b.radius;
    }
    this.sun.enabled = sunOn;
    if (sunOn) {
      const dir = sunDirection(hour);
      const p = camera.position.clone().addScaledVector(new THREE.Vector3(dir.x, Math.max(0.05, dir.y), dir.z), camera.far * 0.9).project(camera);
      // The sun behind the camera (noon, in this top-down view) mirrors to the frame's edge on its side.
      const sx = p.z > 1 ? 0.5 - p.x * 0.5 : 0.5 + p.x * 0.5;
      const sy = p.z > 1 ? 0.5 - p.y * 0.5 : 0.5 + p.y * 0.5;
      // Kept just outside the frame: the shafts then cross the whole picture from the sun's side.
      const c = new THREE.Vector2(sx - 0.5, sy - 0.5);
      const edge = Math.max(Math.abs(c.x), Math.abs(c.y));
      if (edge > 0.75) c.multiplyScalar(0.75 / edge);
      const u = uniforms(this.sun);
      u.tDepth!.value = depth;
      (u.uSun!.value as THREE.Vector2).set(c.x + 0.5, c.y + 0.5);
      u.uIntensity!.value = (0.15 + golden * 0.85) * (1 - night);
      u.uAspect!.value = w / h;
      u.uFlare!.value = golden;
      (u.uColor!.value as THREE.Color).setRGB(1, 0.78 + 0.2 * (1 - golden), 0.45 + 0.4 * (1 - golden));
    }
    if (this.config.dof) {
      const focus = (frame.player ?? frame.target).clone().add(new THREE.Vector3(0, 12, 0));
      const view = focus.clone().applyMatrix4(camera.matrixWorldInverse);
      const screen = focus.clone().project(camera);
      const focusZ = persp ? -view.z : camera.near + ((screen.z + 1) / 2) * (camera.far - camera.near);
      for (const [pass, dir] of [
        [this.dofH, new THREE.Vector2(1 / w, 0)],
        [this.dofV, new THREE.Vector2(0, 1 / h)],
      ] as const) {
        set(pass, { tDepth: depth, uDir: dir, uFocusY: screen.y * 0.5 + 0.5, uFocusZ: focusZ, uBand: 0.12, uMaxR: Math.max(4, h / 90) });
        setLin(pass, lin);
      }
    }
    const g = gradeAt(hour, this.config.grade, sunOn);
    const u = uniforms(this.grade);
    (u.uGain!.value as THREE.Vector3).set(...g.gain);
    (u.uLift!.value as THREE.Vector3).set(...g.lift);
    u.uSat!.value = g.saturation;
    u.uContrast!.value = g.contrast;
    u.uExposure!.value = g.exposure;
    u.uVignette!.value = g.vignette;
    (u.uSunset!.value as THREE.Vector3).set(...g.sunset);
    u.uSunsetAmt!.value = g.sunsetAmount;
    this.composer.render(0);
  }

  dispose(): void {
    this.composer.renderTarget1.dispose();
    this.composer.renderTarget2.dispose();
    this.composer.dispose();
    for (const p of [this.ao, this.sun, this.dofH, this.dofV, this.grade]) p.dispose();
    this.bloom.dispose();
    this.particles.dispose();
    this.lamps.dispose();
  }
}

function uniforms(pass: ShaderPass): Record<string, THREE.IUniform> {
  return pass.uniforms as Record<string, THREE.IUniform>;
}

function set(pass: ShaderPass, values: Record<string, unknown>): void {
  const u = uniforms(pass);
  for (const [k, v] of Object.entries(values)) u[k]!.value = v;
}

function setLin(pass: ShaderPass, lin: { uNear: number; uFar: number; uPersp: boolean }): void {
  const u = uniforms(pass);
  u.uNear!.value = lin.uNear;
  u.uFar!.value = lin.uFar;
  u.uPersp!.value = lin.uPersp;
}

/** Where the view's corner rays meet the ground through the target (relative to it); a ray over the horizon stops at the far plane. */
function groundReach(camera: THREE.PerspectiveCamera, target: THREE.Vector3): Reach {
  const r = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const near = new THREE.Vector3(x, y, -1).unproject(camera);
    const far = new THREE.Vector3(x, y, 1).unproject(camera);
    const t = near.y > target.y && far.y < target.y ? (near.y - target.y) / (near.y - far.y) : 1;
    const p = near.lerp(far, t).sub(target);
    r.minX = Math.min(r.minX, p.x);
    r.maxX = Math.max(r.maxX, p.x);
    r.minZ = Math.min(r.minZ, p.z);
    r.maxZ = Math.max(r.maxZ, p.z);
  }
  return r;
}
