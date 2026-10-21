import * as THREE from 'three';
import { disposeTree } from './assets.ts';
import { WEATHER_FOG_STEPS, WEATHER_LOAD_TICKS, weatherFadeTicks, type AssetRef, type Weather, type WeatherParticles } from '@opensinnoh/contracts';
import { FlashLimiter } from './flash.ts';

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
 * Screen-space weather (the DS draws it on the 2D layers over the 3D field): the BG layer
 * (`Weather.layer`, repeating sideways and down past the DS screen), particles, the lightning flash (the world's) and
 * the dark-map circle. Everything is in DS pixels: the DS screen is 256×192 and wider screens show more
 * of the field, so the overlay spans `width × height` DS px with the DS screen in the middle. Particles advance on 30 Hz ticks with the renderer's own PRNG (weather rolls no game
 * random numbers). Their look is ours (the DS OAM sets are not imported): judged by screenshots.
 */

/** Per kind: speed (DS px per tick), streak length, size, colour, alpha, sway. */
interface Kind {
  vx: [number, number];
  vy: [number, number];
  /** Streak length in ticks of travel (0 = a dot of `size` px). */
  streak: number;
  size: number;
  color: number;
  alpha: number;
  sway: number;
}

const KINDS: Record<WeatherParticles, Kind> = {
  rain: { vx: [-6, -4], vy: [22, 34], streak: 0.6, size: 1, color: 0xc8d8f0, alpha: 0.7, sway: 0 },
  'heavy-rain': { vx: [-14, -9], vy: [30, 46], streak: 0.6, size: 1, color: 0xc8d8f0, alpha: 0.75, sway: 0 },
  thunder: { vx: [-14, -9], vy: [30, 46], streak: 0.6, size: 1, color: 0xc8d8f0, alpha: 0.75, sway: 0 },
  snow: { vx: [-0.5, 0.5], vy: [0.8, 1.6], streak: 0, size: 3, color: 0xffffff, alpha: 0.95, sway: 0.6 },
  'heavy-snow': { vx: [-3, -1.5], vy: [2, 3.5], streak: 0, size: 3, color: 0xffffff, alpha: 0.95, sway: 0.8 },
  blizzard: { vx: [-12, -8], vy: [3, 6], streak: 0.8, size: 2, color: 0xffffff, alpha: 0.9, sway: 0 },
  ash: { vx: [-0.6, 0.2], vy: [0.5, 1.1], streak: 0, size: 2, color: 0x6e6a64, alpha: 0.9, sway: 0.4 },
  sand: { vx: [-14, -9], vy: [1, 3], streak: 0.6, size: 2, color: 0xd8b060, alpha: 0.8, sway: 0 },
  hail: { vx: [-3, -1], vy: [9, 13], streak: 0.3, size: 2, color: 0xf0f8ff, alpha: 0.95, sway: 0 },
  spirits: { vx: [-0.5, 0.5], vy: [-1.2, -0.4], streak: 0, size: 3, color: 0xb090e0, alpha: 0.6, sway: 1 },
  'diamond-dust': { vx: [-0.3, 0.3], vy: [0.3, 0.8], streak: 0, size: 2, color: 0xe0f8ff, alpha: 0.9, sway: 0.5 },
};

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
}

/** Deterministic PRNG for the look only (xorshift32). */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
}

/** Particle state stepped per 30 Hz tick (pure; exported for tests). */
export class ParticleField {
  readonly particles: Particle[] = [];
  private readonly random = rng(0x5eed);

  constructor(
    readonly kind: WeatherParticles,
    /** Kept alive; the overlay sets it from the view size (a zoom changes it). */
    public count: number,
  ) {}

  private spawn(width: number, height: number, anywhere: boolean): Particle {
    const k = KINDS[this.kind];
    const r = this.random;
    const vx = k.vx[0] + (k.vx[1] - k.vx[0]) * r();
    const vy = k.vy[0] + (k.vy[1] - k.vy[0]) * r();
    // Enter from the side the particle moves from, anywhere along it (or anywhere at all on the first fill).
    let x = (r() * 1.4 - 0.2) * width;
    let y = vy >= 0 ? -8 : height + 8;
    if (anywhere) y = r() * height;
    else if (Math.abs(vx) > Math.abs(vy) && r() < Math.abs(vx) / (Math.abs(vx) + Math.abs(vy))) {
      x = vx < 0 ? width + 8 : -8;
      y = r() * height;
    }
    return { x, y, vx, vy, phase: r() * Math.PI * 2 };
  }

  /**
   * Advances one tick in a `width × height` DS px view. `fill` keeps `count` alive (new ones anywhere in the view, extra
   * ones dropped: a zoom, or a weather shown at full at once). `fade` (a weather fading in or out): new ones enter from
   * the edge and extra ones leave the screen before they go.
   */
  step(width: number, height: number, mode: 'fill' | 'fade' = 'fill'): void {
    const k = KINDS[this.kind];
    if (mode === 'fill' && this.particles.length > this.count) this.particles.length = this.count;
    while (this.particles.length < this.count) this.particles.push(this.spawn(width, height, mode === 'fill'));
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i]!;
      p.phase += 0.15;
      p.x += p.vx + Math.sin(p.phase) * k.sway;
      p.y += p.vy;
      if (p.y > height + 16 || p.y < -16 || p.x < -32 || p.x > width + 32) {
        if (this.particles.length > this.count) this.particles.splice(i--, 1);
        else this.particles[i] = this.spawn(width, height, false);
      }
    }
  }
}

/**
 * The BG layer's scroll at `tick` (G2_SetBG2Offset): the image pixel at the DS screen's top-left, in
 * 0..255 (the 256×256 BG wraps). Pure; exported for tests.
 */
export function layerOffset(scroll: readonly [number, number], tick: number): [number, number] {
  const wrap = (v: number) => ((v % 256) + 256) % 256;
  return [wrap(scroll[0] * tick), wrap(scroll[1] * tick)];
}

/** Particle quads at most per weather (the DS pool is 48 on its screen; wide views hold proportionally more). */
const MAX_PARTICLES = 1024;


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

/** What a shown weather draws: its particles and BG layer image. */
interface WeatherDrawing {
  field: ParticleField | null;
  quads: THREE.Mesh;
  layer: THREE.Texture | null;
  layerLoading: AssetRef | null;
}

export class WeatherOverlay {
  private readonly scene = new THREE.Scene();
  /** y down, as DS screen coordinates (this mirrors winding: every overlay material is double-sided). */
  private readonly camera = new THREE.OrthographicCamera(0, 256, 0, 192, -1, 1);
  /** The BG layer: a full-view quad sampling the repeating 256×256 image at DS-pixel centres. */
  private readonly layer: THREE.Mesh;
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

  /** `load` reads a pack PNG; `failed` is the renderer's rejection handler. */
  constructor(
    private readonly load: (ref: AssetRef) => Promise<THREE.Texture>,
    private readonly failed: (what: string) => (e: unknown) => never,
  ) {
    const quad = () => new THREE.PlaneGeometry(1, 1).translate(0.5, 0.5, 0);
    // Image pixel = (DS screen pixel + scroll offset) mod 256; uOrigin = the DS screen's top-left in the view, minus the offset.
    this.layer = new THREE.Mesh(
      quad(),
      new THREE.ShaderMaterial({
        transparent: true,
        depthTest: false,
        side: THREE.DoubleSide,
        uniforms: this.layerUniforms,
        vertexShader: 'varying vec2 vPos; void main() { vPos = (modelMatrix * vec4(position, 1.0)).xy; gl_Position = projectionMatrix * viewMatrix * vec4(vPos, 0.0, 1.0); }',
        fragmentShader:
          'uniform sampler2D uMap; uniform vec2 uOrigin; uniform float uAlpha; varying vec2 vPos; void main() { vec4 c = texture2D(uMap, fract((floor(vPos - uOrigin) + 0.5) / 256.0)); gl_FragColor = vec4(c.rgb, c.a * uAlpha); }',
      }),
    );
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
    this.scene.add(this.layer, this.flash, this.dark);
    for (const o of this.scene.children) o.frustumCulled = false;
  }

  dispose(): void {
    for (const d of this.drawings.values()) this.scene.add(d.quads);
    disposeTree(this.scene);
  }

  /** The view in DS px (wide screens are wider than 256). */
  setSize(width: number, height: number): void {
    this.size = { width, height };
    Object.assign(this.camera, { left: 0, right: width, top: 0, bottom: height });
    this.camera.updateProjectionMatrix();
    for (const m of [this.layer, this.flash, this.dark]) m.scale.set(width, height, 1);
  }

  /**
   * Updates for the view's weather, darkness and lightning flash (`FieldView.lightning`, 0..1; the world times it with
   * its thunder) at a simulation tick; `loads` is the view's map-load count (a new map
   * shows its weather at full, a change on the same map fades). The dark circle's centre is in overlay DS px (the DS
   * window circle sits at (128, 84) of its screen, i.e. 12 px above the player at the screen centre).
   */
  update(weather: Weather, darkness: { radius: number } | null, lightning: number, tick: number, loads: number): void {
    const { width, height } = this.size;
    const instant = loads !== this.loads;
    this.loads = loads;
    this.fades.set(weather, instant);
    if (instant) this.tick = tick - 1;
    // Catch up at most a second of particle ticks (a hidden tab must not spin here); the fades keep the whole count.
    const skipped = Math.max(0, tick - this.tick - 30);
    for (let t = this.tick + 1; t <= tick; t++) {
      const draw = t > this.tick + skipped;
      this.fades.step((s) => skipped > 0 || !(this.drawings.get(s)?.field?.particles.length ?? 0));
      this.sync();
      if (!draw) continue;
      for (const s of this.fades.shown) {
        const d = this.drawings.get(s)!;
        if (d.field && s.weather.particles) {
          // The DS keeps `count` alive on its 256×192 screen: a larger view keeps the same density.
          d.field.count = Math.min(MAX_PARTICLES, Math.round((s.weather.particles.count * width * height * WeatherFades.level(s)) / (256 * 192)));
          d.field.step(width, height, s.phase === 'steady' ? 'fill' : 'fade');
        }
      }
    }
    this.sync();
    this.tick = tick;
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
    this.layer.visible = !!layer;
    if (layer) {
      const l = layer.shown.weather.layer!;
      this.layerUniforms.uMap.value = layer.texture;
      const [ox, oy] = layerOffset(l.scroll, tick);
      this.layerUniforms.uOrigin.value.set(Math.round((width - 256) / 2) - ox, Math.round((height - 192) / 2) - oy);
      this.layerUniforms.uAlpha.value = l.alpha * WeatherFades.layerLevel(layer.shown);
    }
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
    return this.fades.shown.map((s) => ({ id: s.weather.id, phase: s.phase, particles: this.drawings.get(s)?.field?.particles.length ?? 0, fog }));
  }

  /** Drawings for the shown weathers: new ones built, gone ones dropped. */
  private sync(): void {
    const shown = new Set(this.fades.shown);
    for (const [s, d] of this.drawings)
      if (!shown.has(s)) {
        this.scene.remove(d.quads);
        d.quads.geometry.dispose();
        (d.quads.material as THREE.Material).dispose();
        this.drawings.delete(s);
      }
    for (const s of this.fades.shown) {
      if (this.drawings.has(s)) continue;
      const w = s.weather;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 12), 3));
      const index: number[] = [];
      for (let i = 0; i < MAX_PARTICLES; i++) index.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
      geo.setIndex(index);
      const quads = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, side: THREE.DoubleSide }));
      quads.frustumCulled = false;
      // Particles over the layer, under the flash and the dark circle.
      quads.renderOrder = 1;
      this.flash.renderOrder = this.dark.renderOrder = 2;
      this.scene.add(quads);
      const d: WeatherDrawing = { field: w.particles ? new ParticleField(w.particles.kind, 0) : null, quads, layer: null, layerLoading: w.layer?.image ?? null };
      this.drawings.set(s, d);
      const ref = d.layerLoading;
      if (ref)
        void this.load(ref).then((t) => {
          if (d.layerLoading !== ref) return;
          d.layer = t;
          d.layerLoading = null;
        }, this.failed(`weather layer ${ref}`));
    }
  }

  /** Whether a layer image is still loading (the scene is not complete). */
  loading(): boolean {
    for (const d of this.drawings.values()) if (d.layerLoading !== null) return true;
    return false;
  }

  private drawParticles(d: WeatherDrawing): void {
    const f = d.field;
    d.quads.visible = !!f;
    if (!f) return;
    const k = KINDS[f.kind];
    const pos = d.quads.geometry.attributes.position as THREE.BufferAttribute;
    const h = k.size / 2;
    f.particles.forEach((p, i) => {
      // Streak from the head back along the velocity, `size` px wide; a dot is a size × size square.
      const tx = k.streak ? -p.vx * k.streak : 0;
      const ty = k.streak ? -p.vy * k.streak : k.size;
      const len = Math.hypot(tx, ty) || 1;
      const nx = (-ty / len) * h;
      const ny = (tx / len) * h;
      const x = k.streak ? p.x : p.x - h;
      const y = k.streak ? p.y : p.y - h;
      pos.setXYZ(i * 4, x + nx, y + ny, 0);
      pos.setXYZ(i * 4 + 1, x - nx, y - ny, 0);
      pos.setXYZ(i * 4 + 2, x + tx - nx, y + ty - ny, 0);
      pos.setXYZ(i * 4 + 3, x + tx + nx, y + ty + ny, 0);
    });
    pos.needsUpdate = true;
    d.quads.geometry.setDrawRange(0, f.particles.length * 6);
    const m = d.quads.material as THREE.MeshBasicMaterial;
    m.color.set(k.color);
    m.opacity = k.alpha;
  }

  draw(renderer: THREE.WebGLRenderer): void {
    renderer.render(this.scene, this.camera);
  }

  /** Whether anything is drawn (skip the pass otherwise). */
  active(): boolean {
    return this.layer.visible || this.dark.visible || this.flash.visible || [...this.drawings.values()].some((d) => d.field);
  }
}
