import * as THREE from 'three';
import { disposeTree } from './assets.ts';
import { WEATHER_FOG_STEPS, WEATHER_LOAD_TICKS, weatherFadeTicks, type AssetRef, type Weather } from '@opensinnoh/contracts';
import { FlashLimiter } from './flash.ts';
import { WEATHER_POOL, WeatherSim } from './weather-particles.ts';

/**
 * NOT DS behaviour: a readability adjustment (docs/decisions.md). The Galactic
 * interior's weather (decomp OVERWORLD_WEATHER_26) keeps its colour and distance curve, but its fog
 * densities are drawn at this fraction. Every other weather's fog is drawn as the ROM has it.
 */
export const GALACTIC_HAZE = { weather: 26, strength: 0.4 } as const;

/** The fog a weather draws on the field, after the Galactic haze adjustment. */
export function fieldFog(weather: Weather): Weather['fog'] | null {
  return weather.fog ? hazed(weather, weather.fog) : null;
}

/** `fog` (the weather's, or one of its fade steps) after the Galactic haze adjustment. */
function hazed(weather: Weather, fog: NonNullable<Weather['fog']>): NonNullable<Weather['fog']> {
  if (weather.sourceIndex !== GALACTIC_HAZE.weather) return fog;
  return { ...fog, densities: fog.densities.map(d => d * GALACTIC_HAZE.strength) };
}

/**
 * Screen-space weather (the DS draws it on the 2D layers over the 3D field): the BG layer (`Weather.layer`, repeating
 * sideways and down past the DS screen; behind the field when `under`), the particles (the weather task's OAM sprites,
 * stepped as the task steps them: weather-particles.ts), the lightning flash (the world's) and the dark-map circle.
 * Everything is in DS pixels: the DS screen is 256×192 and wider screens show more of the field, so the overlay spans
 * `width × height` DS px with the DS screen in the middle; every DS screen of it runs its own particles. Particles
 * advance on 30 Hz ticks with the renderer's own generator (weather rolls no game random numbers).
 */

/**
 * The BG layer's scroll at `tick` (G2_SetBG2Offset): the image pixel at the DS screen's top-left, in
 * 0..255 (the 256×256 BG wraps). Pure; exported for tests.
 */
export function layerOffset(scroll: readonly [number, number], tick: number): [number, number] {
  const wrap = (v: number) => ((v % 256) + 256) % 256;
  return [wrap(scroll[0] * tick), wrap(scroll[1] * tick)];
}

export type FadePhase = 'in' | 'steady' | 'out';

/** A weather on screen and where it is in its fade (`t` = ticks in this phase). */
export interface ShownWeather {
  weather: Weather;
  phase: FadePhase;
  t: number;
  /** An overlapping weather's fade in: the fog its fog parameters move from (ov5_021D73B0); null = none was on. */
  from?: Weather['fog'] | null;
  /** An overlapped weather's fade out leaves the fog alone (ov5_021D6418 command 7). */
  keepsFog?: boolean;
}

/**
 * The weather fades (decomp ov5_021D5EB8.c): `set` on every frame with the view's weather; `instant` on a map load,
 * which starts the weather at full (ov5_021D5F24). A change without one fades (ov5_021D5F7C): the old weather fades
 * out, the new one loads and fades in (ov5_021D5FE4); weathers that overlap fade into each other (ov5_021D60B4).
 * Pure tick-based state, stepped once per 30 Hz tick.
 */
export class WeatherFades {
  shown: ShownWeather[] = [];
  private next: { weather: Weather; wait: number } | null = null;

  set(weather: Weather, instant: boolean): void {
    if (instant || (!this.shown.length && !this.next)) {
      this.shown = [{ weather, phase: 'steady', t: 0 }];
      this.next = null;
      return;
    }
    const target = this.next?.weather ?? this.shown.at(-1)!.weather;
    if (target.id === weather.id) return;
    const current = this.shown.at(-1)!;
    if (!this.next && current.phase !== 'out' && current.weather.fade?.overlaps?.includes(weather.id)) {
      const from = this.fog();
      current.phase = 'out';
      current.t = 0;
      current.keepsFog = true;
      this.shown.push({ weather, phase: 'in', t: 0, from });
      return;
    }
    for (const s of this.shown)
      if (s.phase !== 'out') {
        s.phase = 'out';
        s.t = 0;
      }
    this.next = { weather, wait: WEATHER_LOAD_TICKS };
  }

  /** One tick; `drained(s)`: the fading-out weather's last particles have left the screen. */
  step(drained: (s: ShownWeather) => boolean): void {
    for (const s of this.shown) {
      s.t++;
      if (s.phase === 'in' && s.t >= weatherFadeTicks(s.weather, 'in')) {
        s.phase = 'steady';
        s.t = 0;
        delete s.from;
      }
    }
    this.shown = this.shown.filter((s) => !(s.phase === 'out' && s.t >= weatherFadeTicks(s.weather, 'out', s.keepsFog) && drained(s)));
    if (this.next && !this.shown.length && --this.next.wait <= 0) {
      this.shown.push({ weather: this.next.weather, phase: 'in', t: 0 });
      this.next = null;
    }
  }

  /** The particle spawn rate over the faded-in rate. */
  static level(s: ShownWeather): number {
    if (s.phase === 'steady') return 1;
    const ramp = s.weather.fade?.particles?.[s.phase];
    if (!ramp) return s.phase === 'in' ? 1 : 0;
    return ramp[Math.min(s.t, ramp.length - 1)]!;
  }

  /** The BG layer's blend over `Weather.layer.alpha` (ov5_021D64FC, ov5_021D650C: EVA steps in whole sixteenths). */
  static layerLevel(s: ShownWeather): number {
    const layer = s.weather.layer;
    if (!layer || s.phase === 'steady') return 1;
    const fade = s.weather.fade?.layer;
    if (!fade) return s.phase === 'in' ? 1 : 0;
    if (fade === 'steady') return 0;
    const eva = Math.round(layer.alpha * 16);
    const n = fade[s.phase];
    const step = Math.floor((eva * Math.min(s.t, n)) / n);
    return (s.phase === 'in' ? step : eva - step) / eva;
  }

  /** The fog drawn: an overlapping fade in moves the old fog's parameters to the new; otherwise a density fade. */
  fog(): Weather['fog'] | null {
    const incoming = this.shown.find((s) => s.from !== undefined);
    if (incoming) return lerpFog(incoming.from!, incoming.weather.fog ?? null, incoming.t, WEATHER_FOG_STEPS * (incoming.weather.fade?.fog?.in ?? 1));
    const s = this.shown.find((x) => x.weather.fog);
    if (!s) return null;
    const fog = s.weather.fog!;
    const fade = s.weather.fade?.fog;
    if (s.phase === 'steady' || !fade || s.keepsFog) return fog;
    const steps = Math.min(WEATHER_FOG_STEPS, Math.floor(s.t / fade[s.phase]));
    if (s.phase === 'out' && steps >= WEATHER_FOG_STEPS) return null;
    return { ...fog, densities: fogFadeDensities(s.phase, steps) };
  }
}

/**
 * The fog density table after `steps` of a fade (ov5_021D7534; the steady table is 4 i). Fading in from all zeros,
 * step k sets entries above (128 − k) / 4 to 4 (i − that); fading out, step k sets entries above (k − 1) / 4 to
 * 4 (i − that), so the entries it passes keep 4.
 */
export function fogFadeDensities(phase: 'in' | 'out', steps: number): number[] {
  return Array.from({ length: 32 }, (_, i) => {
    if (phase === 'in') return steps === 0 ? 0 : Math.min(127, 4 * Math.max(0, i - Math.floor((128 - steps) / 4)));
    if (steps === 0 || i === 0) return 4 * i;
    return 4 * Math.max(1, i - Math.floor((steps - 1) / 4));
  });
}

/** ov5_021D73B0/ov5_021D7434: slope, offset and colour (in 0–31 steps) move linearly over `n` ticks; no fog moves from black at 0. */
function lerpFog(from: Weather['fog'] | null, to: Weather['fog'] | null, t: number, n: number): Weather['fog'] | null {
  if (!to) return null;
  const a = from ?? { ...to, slope: 0, offset: 0, color: [0, 0, 0] as [number, number, number] };
  const k = Math.min(t, n);
  const lerp = (x: number, y: number) => x + Math.trunc(((y - x) * k) / n);
  const c = (x: number, y: number) => lerp(Math.round(x * 31), Math.round(y * 31)) / 31;
  return { ...to, slope: lerp(a.slope, to.slope), offset: lerp(a.offset, to.offset), color: [c(a.color[0], to.color[0]), c(a.color[1], to.color[1]), c(a.color[2], to.color[2])] };
}

/** A weather's particles on one DS screen of the view (`WeatherSim`) and where that screen's top-left is. */
interface Tile {
  sim: WeatherSim;
  x: number;
  y: number;
}

/** What a shown weather draws: its particle screens and sprites, and its BG layer image. */
interface WeatherDrawing {
  tiles: Map<string, Tile>;
  quads: THREE.Mesh | null;
  sprites: THREE.Texture | null;
  spritesLoading: AssetRef | null;
  /** The spawner that runs at full: the map load's when the weather started at full, else its fade in's end. */
  spawner: [number, number];
  /** Ticks to the next steady spawn (the task's unk_06), and the fades' spawn remainder. */
  timer: number;
  carry: number;
  layer: THREE.Texture | null;
  layerLoading: AssetRef | null;
}

/** The camera as the weather tasks see it (ov5_021D7028): its target and the DS px per world unit across and down. */
export interface WeatherCamera {
  x: number;
  z: number;
  /** DS px per unit across (256 px over the view's width at the target). */
  perX: number;
  /** DS px per unit down: moving north, and moving south (the DS divides by 0xBE8D0 and 0xBE811). */
  perZ: [north: number, south: number];
}

/**
 * The weather tasks' camera scale (ov5_021D7028, CalcLinearFov at aspect 4:3): the view at the target is
 * 2·distance·tan(fov / 2) units high; 256 px span its width, and 190.55 (190.07 moving south) px its height.
 */
export function weatherCameraScale(fovY: number, distance: number): Pick<WeatherCamera, 'perX' | 'perZ'> {
  const height = 2 * distance * Math.tan(((fovY / 2) * Math.PI) / 180);
  return { perX: 256 / ((height * 4) / 3), perZ: [0xbe8d0 / 4096 / height, 0xbe811 / 4096 / height] };
}

/** The DS screens (256×192, the DS screen in the middle) a `width × height` DS px view needs, by key. */
export function weatherTiles(width: number, height: number): { key: string; x: number; y: number }[] {
  const ox = Math.round((width - 256) / 2);
  const oy = Math.round((height - 192) / 2);
  const nx = Math.ceil(Math.max(0, ox) / 256);
  const ny = Math.ceil(Math.max(0, oy) / 192);
  const out: { key: string; x: number; y: number }[] = [];
  for (let j = -ny; j <= ny; j++) for (let i = -nx; i <= nx; i++) out.push({ key: `${i},${j}`, x: ox + i * 256, y: oy + j * 192 });
  return out;
}

const TILE_VERTEX = /* glsl */ `
attribute vec4 aClip;
varying vec2 vUv;
varying vec2 vPos;
varying vec4 vClip;
void main() {
  vUv = uv;
  vPos = position.xy;
  vClip = aClip;
  gl_Position = projectionMatrix * viewMatrix * vec4(position.xy, 0.0, 1.0);
}`;
/** OBJs are opaque: colour 0 is not drawn; each screen's sprites show only inside it, as the DS screen clips them. */
const TILE_FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;
varying vec2 vPos;
varying vec4 vClip;
void main() {
  if (vPos.x < vClip.x || vPos.y < vClip.y || vPos.x >= vClip.z || vPos.y >= vClip.w) discard;
  vec4 c = texture2D(uMap, vUv);
  if (c.a < 0.5) discard;
  gl_FragColor = vec4(c.rgb, 1.0);
}`;

export class WeatherOverlay {
  private readonly scene = new THREE.Scene();
  /** The BG layer when it is behind the 3D field (`Weather.layer.under`), drawn before it. */
  private readonly underScene = new THREE.Scene();
  /** y down, as DS screen coordinates (this mirrors winding: every overlay material is double-sided). */
  private readonly camera = new THREE.OrthographicCamera(0, 256, 0, 192, -1, 1);
  /** The BG layer: a full-view quad sampling the repeating 256×256 image at DS-pixel centres. */
  private readonly layer: THREE.Mesh;
  private readonly layerUnder: THREE.Mesh;
  private readonly layerUniforms = { uMap: { value: null as THREE.Texture | null }, uOrigin: { value: new THREE.Vector2() }, uAlpha: { value: 1 } };
  private readonly flash: THREE.Mesh;
  private readonly dark: THREE.Mesh;
  private readonly darkUniforms = { uCenter: { value: new THREE.Vector2() }, uRadius: { value: 0 } };
  private readonly flashLimit = new FlashLimiter();
  readonly fades = new WeatherFades();
  private readonly drawings = new Map<ShownWeather, WeatherDrawing>();
  private loads: number | null = null;
  private tick = -1;
  private size = { width: 256, height: 192 };
  /** The camera at the last shift (ov5_021D7028's unk_B8C); null until the first frame of a map. */
  private lastCamera: { x: number; z: number } | null = null;

  /** `load` reads a pack PNG; `failed` is the renderer's rejection handler. */
  constructor(
    private readonly load: (ref: AssetRef) => Promise<THREE.Texture>,
    private readonly failed: (what: string) => (e: unknown) => never,
  ) {
    const quad = () => new THREE.PlaneGeometry(1, 1).translate(0.5, 0.5, 0);
    // Image pixel = (DS screen pixel + scroll offset) mod 256; uOrigin = the DS screen's top-left in the view, minus the offset.
    const layerMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      side: THREE.DoubleSide,
      uniforms: this.layerUniforms,
      vertexShader: 'varying vec2 vPos; void main() { vPos = (modelMatrix * vec4(position, 1.0)).xy; gl_Position = projectionMatrix * viewMatrix * vec4(vPos, 0.0, 1.0); }',
      fragmentShader:
        'uniform sampler2D uMap; uniform vec2 uOrigin; uniform float uAlpha; varying vec2 vPos; void main() { vec4 c = texture2D(uMap, fract((floor(vPos - uOrigin) + 0.5) / 256.0)); gl_FragColor = vec4(c.rgb, c.a * uAlpha); }',
    });
    this.layer = new THREE.Mesh(quad(), layerMaterial);
    this.layerUnder = new THREE.Mesh(this.layer.geometry, layerMaterial);
    this.flash = new THREE.Mesh(quad(), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthTest: false, side: THREE.DoubleSide }));
    // Outside the circle black (the DS window shows only the backdrop there); the circle is a hard edge.
    this.dark = new THREE.Mesh(
      quad(),
      new THREE.ShaderMaterial({
        transparent: true,
        depthTest: false,
        side: THREE.DoubleSide,
        uniforms: this.darkUniforms,
        vertexShader: 'varying vec2 vPos; void main() { vPos = (modelMatrix * vec4(position, 1.0)).xy; gl_Position = projectionMatrix * viewMatrix * vec4(vPos, 0.0, 1.0); }',
        fragmentShader: 'uniform vec2 uCenter; uniform float uRadius; varying vec2 vPos; void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, distance(vPos, uCenter) < uRadius ? 0.0 : 1.0); }',
      }),
    );
    // Particles over the layer, under the flash and the dark circle.
    this.flash.renderOrder = this.dark.renderOrder = 2;
    this.scene.add(this.layer, this.flash, this.dark);
    this.underScene.add(this.layerUnder);
    for (const o of [...this.scene.children, this.layerUnder]) o.frustumCulled = false;
  }

  dispose(): void {
    for (const d of this.drawings.values()) if (d.quads) this.scene.add(d.quads);
    this.underScene.remove(this.layerUnder);
    disposeTree(this.scene);
  }

  /** The view in DS px (wide screens are wider than 256). */
  setSize(width: number, height: number): void {
    this.size = { width, height };
    Object.assign(this.camera, { left: 0, right: width, top: 0, bottom: height });
    this.camera.updateProjectionMatrix();
    for (const m of [this.layer, this.layerUnder, this.flash, this.dark]) m.scale.set(width, height, 1);
  }

  /**
   * Updates for the view's weather, darkness and lightning flash (`FieldView.lightning`, 0..1; the world times it with
   * its thunder) at a simulation tick; `loads` is the view's map-load count (a new map shows its weather at full, a
   * change on the same map fades); `camera` moves the particles with the field (null: they stay). The dark circle's
   * centre is in overlay DS px (the DS window circle sits at (128, 84) of its screen, i.e. 12 px above the player at
   * the screen centre).
   */
  update(weather: Weather, darkness: { radius: number } | null, lightning: number, tick: number, loads: number, camera: WeatherCamera | null = null): void {
    const { width, height } = this.size;
    const instant = loads !== this.loads;
    this.loads = loads;
    this.fades.set(weather, instant);
    if (instant) {
      this.tick = tick - 1;
      this.lastCamera = null;
    }
    // Catch up at most a second of particle ticks (a hidden tab must not spin here); the fades keep the whole count.
    const skipped = Math.max(0, tick - this.tick - 30);
    for (let t = this.tick + 1; t <= tick; t++) {
      const draw = t > this.tick + skipped;
      this.fades.step((s) => skipped > 0 || particleCount(this.drawings.get(s)) === 0);
      this.sync();
      if (!draw) continue;
      for (const s of this.fades.shown) this.stepParticles(s, this.drawings.get(s)!);
    }
    this.sync();
    this.tick = tick;
    if (camera) {
      const last = this.lastCamera;
      if (last) {
        const dx = (camera.x - last.x) * camera.perX;
        const dz = camera.z - last.z;
        const dy = dz * (dz <= 0 ? camera.perZ[0] : camera.perZ[1]);
        for (const d of this.drawings.values()) for (const tile of d.tiles.values()) tile.sim.shift(dx, dy);
      }
      this.lastCamera = { x: camera.x, z: camera.z };
    }
    this.darkUniforms.uCenter.value.set(width / 2, height / 2 - 12);
    this.darkUniforms.uRadius.value = darkness?.radius ?? 0;
    this.dark.visible = !!darkness;
    let layer: { shown: ShownWeather; texture: THREE.Texture } | null = null;
    for (const s of this.fades.shown) {
      const d = this.drawings.get(s)!;
      this.drawParticles(d);
      if (!layer && d.layer && WeatherFades.layerLevel(s) > 0) layer = { shown: s, texture: d.layer };
    }
    // Reduce flashing (flash.ts): the lightning is capped and eased, not a strobe.
    const flash = this.flashLimit.apply(lightning);
    this.flash.visible = flash > 0;
    (this.flash.material as THREE.MeshBasicMaterial).opacity = flash;
    const under = !!layer?.shown.weather.layer!.under;
    this.layer.visible = !!layer && !under;
    this.layerUnder.visible = under;
    if (layer) {
      const l = layer.shown.weather.layer!;
      this.layerUniforms.uMap.value = layer.texture;
      const [ox, oy] = layerOffset(l.scroll, tick);
      this.layerUniforms.uOrigin.value.set(Math.round((width - 256) / 2) - ox, Math.round((height - 192) / 2) - oy);
      this.layerUniforms.uAlpha.value = l.alpha * WeatherFades.layerLevel(layer.shown);
    }
  }

  /** One tick of a shown weather's particles on every DS screen of the view: the spawner, then each update. */
  private stepParticles(s: ShownWeather, d: WeatherDrawing): void {
    const p = s.weather.particles;
    if (!p) return;
    const { width, height } = this.size;
    const wanted = weatherTiles(width, height);
    const keys = new Set(wanted.map((t) => t.key));
    for (const key of [...d.tiles.keys()]) if (!keys.has(key)) d.tiles.delete(key);
    for (const t of wanted) {
      const tile = d.tiles.get(t.key);
      if (tile) Object.assign(tile, { x: t.x, y: t.y });
      else {
        const sim = new WeatherSim(p.kind, hashSeed(`${s.weather.id}|${t.key}`));
        // A screen that comes into view (a map load, a zoom) starts at full, as the map load's task does.
        if (s.phase === 'steady') sim.prewarm(...p.spawner.prewarm);
        d.tiles.set(t.key, { sim, x: t.x, y: t.y });
      }
    }
    const sims = [...d.tiles.values()].map((t) => t.sim);
    if (s.phase === 'steady') {
      for (const sim of sims) sim.steadyTick();
      // The task's state 3: `if (unk_06-- <= 0)` spawns every interval + 1 ticks.
      if (d.timer-- <= 0) {
        for (const sim of sims) sim.spawn(sim.steadyCount(d.spawner[0]));
        d.timer = d.spawner[1];
      }
    } else {
      // A fade's spawner ramp (contracts WeatherFade.particles), as a rate of the faded-in spawner's.
      const [count, interval] = p.spawner.steady;
      d.carry += (WeatherFades.level(s) * count) / Math.max(1, interval);
      const n = Math.floor(d.carry);
      d.carry -= n;
      if (s.phase === 'out') for (const sim of sims) sim.fadeOut(WeatherFades.level(s) === 0);
      if (n) for (const sim of sims) sim.spawn(n);
      // The fade in's spawner carries on at full from where it ended.
      if (s.phase === 'in') d.spawner = p.spawner.steady;
      d.timer = 0;
    }
    for (const sim of sims) sim.update();
  }

  /** The fog the field draws under the weather (null = off), after its fades and the Galactic haze. */
  fog(): Weather['fog'] | null {
    const fog = this.fades.fog();
    const s = this.fades.shown.at(-1);
    return fog && s ? hazed(s.weather, fog) : fog;
  }

  /** The shown weathers for RenderStats: phase, live particles, and the drawn fog's farthest density. */
  stats(): { id: Weather['id']; phase: FadePhase; particles: number; fog: number | null }[] {
    const fog = this.fog()?.densities[31] ?? null;
    return this.fades.shown.map((s) => ({ id: s.weather.id, phase: s.phase, particles: particleCount(this.drawings.get(s)), fog }));
  }

  /** Drawings for the shown weathers: new ones built, gone ones dropped. */
  private sync(): void {
    const shown = new Set(this.fades.shown);
    for (const [s, d] of this.drawings)
      if (!shown.has(s)) {
        if (d.quads) {
          this.scene.remove(d.quads);
          d.quads.geometry.dispose();
          (d.quads.material as THREE.Material).dispose();
        }
        this.drawings.delete(s);
      }
    for (const s of this.fades.shown) {
      if (this.drawings.has(s)) continue;
      const w = s.weather;
      const p = w.particles;
      const d: WeatherDrawing = {
        tiles: new Map(),
        quads: null,
        sprites: null,
        spritesLoading: p?.sprites.image ?? null,
        spawner: p ? (s.phase === 'steady' ? p.spawner.load : p.spawner.steady) : [0, 0],
        timer: 0,
        carry: 0,
        layer: null,
        layerLoading: w.layer?.image ?? null,
      };
      this.drawings.set(s, d);
      const sprites = d.spritesLoading;
      if (sprites)
        void this.load(sprites).then((t) => {
          if (d.spritesLoading !== sprites) return;
          d.sprites = t;
          d.spritesLoading = null;
        }, this.failed(`weather sprites ${sprites}`));
      const ref = d.layerLoading;
      if (ref)
        void this.load(ref).then((t) => {
          if (d.layerLoading !== ref) return;
          d.layer = t;
          d.layerLoading = null;
        }, this.failed(`weather layer ${ref}`));
    }
  }

  /** Whether a layer image or sprite sheet is still loading (the scene is not complete). */
  loading(): boolean {
    for (const d of this.drawings.values()) if (d.layerLoading !== null || d.spritesLoading !== null) return true;
    return false;
  }

  /** Each particle as its frame's cell, at its integer position (OAM coordinates are whole pixels), clipped to its screen. */
  private drawParticles(d: WeatherDrawing): void {
    const shown = [...this.drawings].find(([, x]) => x === d)![0];
    const p = shown.weather.particles;
    if (!p || !d.sprites) {
      if (d.quads) d.quads.visible = false;
      return;
    }
    const capacity = d.tiles.size * WEATHER_POOL;
    if (!d.quads || (d.quads.geometry.attributes.position as THREE.BufferAttribute).count < capacity * 4) {
      if (d.quads) {
        this.scene.remove(d.quads);
        d.quads.geometry.dispose();
        (d.quads.material as THREE.Material).dispose();
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity * 12), 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(capacity * 8), 2));
      geo.setAttribute('aClip', new THREE.BufferAttribute(new Float32Array(capacity * 16), 4));
      const index: number[] = [];
      for (let i = 0; i < capacity; i++) index.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
      geo.setIndex(index);
      const material = new THREE.ShaderMaterial({ depthTest: false, side: THREE.DoubleSide, uniforms: { uMap: { value: d.sprites } }, vertexShader: TILE_VERTEX, fragmentShader: TILE_FRAGMENT });
      d.quads = new THREE.Mesh(geo, material);
      d.quads.frustumCulled = false;
      d.quads.renderOrder = 1;
      this.scene.add(d.quads);
    }
    d.quads.visible = true;
    const image = d.sprites.image as { width: number; height: number };
    const pos = d.quads.geometry.attributes.position as THREE.BufferAttribute;
    const uv = d.quads.geometry.attributes.uv as THREE.BufferAttribute;
    const clip = d.quads.geometry.attributes.aClip as THREE.BufferAttribute;
    let n = 0;
    for (const tile of d.tiles.values())
      for (const q of tile.sim.particles) {
        const cellIndex = p.sprites.frames[q.frame];
        const cell = cellIndex === undefined ? undefined : p.sprites.cells[cellIndex];
        if (!cell) throw new Error(`render: weather ${shown.weather.id} has no cell for frame ${q.frame}`);
        const x0 = tile.x + Math.floor(q.x) - cell.ox;
        const y0 = tile.y + Math.floor(q.y) - cell.oy;
        const [u0, v0, u1, v1] = [cell.x / image.width, cell.y / image.height, (cell.x + cell.w) / image.width, (cell.y + cell.h) / image.height];
        pos.setXYZ(n * 4, x0, y0, 0);
        pos.setXYZ(n * 4 + 1, x0 + cell.w, y0, 0);
        pos.setXYZ(n * 4 + 2, x0 + cell.w, y0 + cell.h, 0);
        pos.setXYZ(n * 4 + 3, x0, y0 + cell.h, 0);
        uv.setXY(n * 4, u0, v0);
        uv.setXY(n * 4 + 1, u1, v0);
        uv.setXY(n * 4 + 2, u1, v1);
        uv.setXY(n * 4 + 3, u0, v1);
        for (let k = 0; k < 4; k++) clip.setXYZW(n * 4 + k, tile.x, tile.y, tile.x + 256, tile.y + 192);
        n++;
      }
    pos.needsUpdate = uv.needsUpdate = clip.needsUpdate = true;
    d.quads.geometry.setDrawRange(0, n * 6);
  }

  /** The 2D layers over the field: the BG layer in front of it, the particles, the flash and the dark circle. */
  draw(renderer: THREE.WebGLRenderer): void {
    renderer.render(this.scene, this.camera);
  }

  /** Whether a BG layer is behind the 3D field (the field's rear plane is then clear: `drawUnder` shows through). */
  under(): boolean {
    return this.layerUnder.visible;
  }

  /** The BG layer behind the 3D field, drawn before it. */
  drawUnder(renderer: THREE.WebGLRenderer): void {
    renderer.render(this.underScene, this.camera);
  }

  /** Whether anything is drawn over the field (skip the pass otherwise). */
  active(): boolean {
    return this.layer.visible || this.dark.visible || this.flash.visible || [...this.drawings.values()].some((d) => d.quads?.visible);
  }
}

function particleCount(d: WeatherDrawing | undefined): number {
  let n = 0;
  for (const t of d?.tiles.values() ?? []) n += t.sim.particles.length;
  return n;
}

/** A screen's generator seed from its weather and place (FNV-1a). */
function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}
