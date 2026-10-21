/**
 * A small Nitro SPL particle system (decomp lib/spl: spl_emitter.c SPLEmitter_Update, spl_emit.c
 * SPLEmitter_EmitParticles, spl_anim.c, spl_manager.c SPLManager_Update) for the emitters a pack gives
 * (`Ui2dEmitter`). It follows the DS rules for emission, velocity, air resistance, lifetimes, the scale,
 * colour and alpha curves, simple children and emitter termination; behaviours (gravity, spin, …), texture
 * animations and directional billboards are not modelled (every particle is a plain billboard). Its own
 * PRNG, so positions differ from the cartridge's. One `update` per DS frame: the evolution scene calls
 * ParticleSystem_UpdateAll once per main loop, so once per 30 Hz tick.
 *
 * Projection (decomp particle_system.c, ParticleSystem_SetCameraProjection(…, ORTHOGRAPHIC)): the camera at
 * z = 4 with a 45° field gives a box 4 units high above and below the centre, so 24 DS px per unit, y up,
 * centred on the 256×192 screen.
 */
import type { EvolutionParticleView, Ui2dEmitter } from '@opensinnoh/contracts';
import { Prng } from '@opensinnoh/core';

const PX_PER_UNIT = 24;
type Vec = [number, number, number];

interface Particle {
  pos: Vec;
  vel: Vec;
  /** The emitter's position when it was born (followEmitter is not modelled). */
  origin: Vec;
  baseScale: number;
  animScale: number;
  color: number;
  baseAlpha: number;
  animAlpha: number;
  life: number;
  age: number;
  texture: number;
  child: boolean;
}

interface Emitter {
  res: Ui2dEmitter;
  pos: Vec;
  age: number;
  started: boolean;
  fraction: number;
  particles: Particle[];
  children: Particle[];
}

const rgb555 = (hex: string): number => {
  const v = parseInt(hex.slice(1), 16);
  return (((v >> 19) & 31) << 10) | (((v >> 11) & 31) << 5) | ((v >> 3) & 31);
};
const hex555 = (c: number): string => {
  const to8 = (x: number) => (x << 3) | (x >> 2);
  return `#${[c & 31, (c >> 5) & 31, (c >> 10) & 31].map((x) => to8(x).toString(16).padStart(2, '0')).join('')}`;
};
const lerp555 = (a: number, b: number, t: number, n: number): number => {
  const ch = (c: number, s: number) => (c >> s) & 31;
  return [0, 5, 10].reduce((out, s) => out | ((ch(a, s) + Math.trunc((t * (ch(b, s) - ch(a, s))) / n)) << s), 0);
};

export class ParticleSystem {
  private readonly emitters: Emitter[] = [];
  private readonly rng: Prng;

  /** `origin`: where emitters are created, in world units (decomp sub_0207C854's callback position). */
  constructor(
    private readonly resources: readonly Ui2dEmitter[],
    private readonly origin: Vec,
    seed: number,
  ) {
    this.rng = new Prng(seed);
  }

  /** Decomp ParticleSystem_CreateEmitterWithCallback. */
  start(index: number): void {
    const res = this.resources[index];
    if (!res) throw new Error(`particles: no emitter ${index} (the pack has ${this.resources.length})`);
    this.emitters.push({ res, pos: [this.origin[0] + res.position[0], this.origin[1] + res.position[1], this.origin[2] + res.position[2]], age: 0, started: false, fraction: 0, particles: [], children: [] });
  }

  /** Decomp ParticleSystem_GetActiveEmitterCount. */
  get active(): number {
    return this.emitters.length;
  }

  clear(): void {
    this.emitters.length = 0;
  }

  /** One DS frame: SPLManager_Update over every emitter. */
  update(): void {
    for (const e of [...this.emitters]) {
      if (!e.started && e.age >= e.res.startDelay) {
        e.started = true;
        e.age = 0;
      }
      this.updateEmitter(e);
      // EMITTER_SHOULD_TERMINATE (every emitter here is self-maintaining).
      if (e.started && e.res.life !== 0 && e.age > e.res.life && !e.particles.length && !e.children.length) this.emitters.splice(this.emitters.indexOf(e), 1);
    }
  }

  private random(): number {
    return this.rng.next() / 0x1_0000_0000;
  }

  /** SPLRandom_VecFx32: a random unit vector (random attenuations are not imported: none). */
  private unit(): Vec {
    for (;;) {
      const v: Vec = [this.random() * 2 - 1, this.random() * 2 - 1, this.random() * 2 - 1];
      const l = Math.hypot(...v);
      if (l > 0.01 && l <= 1) return [v[0] / l, v[1] / l, v[2] / l];
    }
  }

  private axes(res: Ui2dEmitter): [Vec, Vec] {
    // SPLEmitter_ComputeOrthogonalAxes.
    const axis: Vec = res.circleAxis === 0 ? [0, 0, 1] : res.circleAxis === 1 ? [0, 1, 0] : res.circleAxis === 2 ? [1, 0, 0] : norm(res.axis);
    let up: Vec = [0, 1, 0];
    if (Math.abs(dot(up, axis)) === 1) up = [1, 0, 0];
    const a1 = norm(cross(axis, up));
    const a2 = norm(cross(axis, a1));
    return [a1, a2];
  }

  private emit(e: Emitter): void {
    const res = e.res;
    const total = Math.floor(res.count + e.fraction);
    e.fraction = res.count + e.fraction - total;
    const [a1, a2] = this.axes(res);
    const tilt = (x: number, y: number): Vec => [x * a1[0] + y * a2[0], x * a1[1] + y * a2[1], x * a1[2] + y * a2[2]];
    for (let i = 0; i < total; i++) {
      let pos: Vec;
      switch (res.emission) {
        case 0:
          pos = [0, 0, 0];
          break;
        case 1:
          pos = scale(this.unit(), res.radius);
          break;
        case 2:
        case 5: {
          const t = this.random() * Math.PI * 2;
          const r = res.emission === 5 ? res.radius * this.random() : res.radius;
          pos = tilt(Math.cos(t) * r, Math.sin(t) * r);
          break;
        }
        case 3: {
          const t = (i / total) * Math.PI * 2;
          pos = tilt(Math.sin(t) * res.radius, Math.cos(t) * res.radius);
          break;
        }
        case 4:
          pos = this.unit().map((v) => v * res.radius * this.random()) as Vec;
          break;
        default:
          throw new Error(`particles: emission type ${res.emission} is not modelled`);
      }
      const dir = pos[0] || pos[1] || pos[2] ? norm(pos) : this.unit();
      const axis = norm(res.axis);
      const vel: Vec = [0, 1, 2].map((k) => dir[k]! * res.velPos + axis[k]! * res.velAxis) as Vec;
      e.particles.push({ pos, vel, origin: [...e.pos], baseScale: res.scale, animScale: 1, color: rgb555(res.color), baseAlpha: res.alpha, animAlpha: 31, life: res.particleLife + 1, age: 0, texture: res.texture, child: false });
    }
  }

  private updateEmitter(e: Emitter): void {
    const res = e.res;
    if ((res.life === 0 || e.age < res.life) && e.started && e.age % Math.max(1, res.interval) === 0) this.emit(e);
    const air = res.air / 512;
    for (const p of [...e.particles]) {
      const rate = Math.floor((Math.floor(0xffff / p.life) * p.age) / 256) & 255;
      if (res.scaleAnim) p.animScale = curve3(res.scaleAnim, rate);
      if (res.colorAnim) p.color = colorCurve(res.colorAnim, rgb555(res.color), rate);
      if (res.alphaAnim) p.animAlpha = Math.trunc(curve3(res.alphaAnim, rate));
      p.vel = scale(p.vel, air);
      p.pos = add(p.pos, p.vel);
      const c = res.child;
      if (c) {
        const delay = Math.floor((p.life * c.delay) / 256);
        if (p.age >= delay && (p.age - delay) % Math.max(1, c.every) === 0) {
          for (let k = 0; k < c.count; k++) {
            e.children.push({
              pos: [...p.pos],
              vel: scale(p.vel, c.velocityRatio / 256),
              origin: p.origin,
              baseScale: (p.baseScale * p.animScale * (c.scaleRatio + 1)) / 64,
              animScale: 1,
              color: c.color ? rgb555(c.color) : p.color,
              baseAlpha: (p.baseAlpha * (p.animAlpha + 1)) >> 5,
              animAlpha: 31,
              life: c.life,
              age: 0,
              texture: c.texture,
              child: true,
            });
          }
        }
      }
      p.age++;
      if (p.age > p.life) e.particles.splice(e.particles.indexOf(p), 1);
    }
    const c = res.child;
    for (const p of [...e.children]) {
      const rate = Math.floor((p.age << 8) / p.life) & 255;
      if (c?.endScale !== null && c?.endScale !== undefined) p.animScale = c.endScale + ((c.endScale - 1) * (rate - 255)) / 255;
      if (c?.fade) p.animAlpha = Math.floor(((255 - rate) * 31) / 255);
      p.vel = scale(p.vel, air);
      p.pos = add(p.pos, p.vel);
      p.age++;
      if (p.age > p.life) e.children.splice(e.children.indexOf(p), 1);
    }
    e.age++;
  }

  /** The particles to draw, parents then children, in DS screen px. */
  view(): EvolutionParticleView[] {
    const out: EvolutionParticleView[] = [];
    const add = (res: Ui2dEmitter, p: Particle) => {
      const at = [p.pos[0] + p.origin[0], p.pos[1] + p.origin[1]];
      const alpha = (p.baseAlpha * (p.animAlpha + 1)) >> 5;
      if (alpha <= 0) return;
      // SPLDraw_Billboard / _DirectionalBillboard: height = scale, width = scale · aspect, the animation on one or both.
      let h = p.baseScale;
      let w = h * (p.child ? 1 : res.aspect);
      const dir = p.child ? 0 : res.scaleAnimDir;
      if (dir !== 2) w *= p.animScale;
      if (dir !== 1) h *= p.animScale;
      let angle = 0;
      if (!p.child && res.drawType === 1) {
        // The quad's height lies along the velocity on screen (the camera looks down −z: v̂·view = v̂z).
        const speed = Math.hypot(...p.vel);
        if (!speed || (!p.vel[0] && !p.vel[1])) return;
        h *= 1 + (1 - Math.abs(p.vel[2] / speed)) * res.dbbScale;
        angle = Math.atan2(p.vel[0], p.vel[1]);
      }
      out.push({ x: round(128 + at[0]! * PX_PER_UNIT), y: round(96 - at[1]! * PX_PER_UNIT), w: round(w * PX_PER_UNIT), h: round(h * PX_PER_UNIT), angle: Math.round(angle * 1000) / 1000, texture: p.texture, color: hex555(p.color), alpha });
    };
    for (const e of this.emitters) {
      if (!e.res.hideParent) e.particles.forEach((p) => add(e.res, p));
      e.children.forEach((p) => add(e.res, p));
    }
    return out;
  }
}

/** SPLAnim_Scale / SPLAnim_Alpha: start → mid over [0, in), mid until out, then → end at 255. */
function curve3(a: { start: number; mid: number; end: number; in: number; out: number }, rate: number): number {
  if (rate < a.in) return a.start + (rate * (a.mid - a.start)) / a.in;
  if (rate < a.out) return a.mid;
  return a.end + ((rate - 255) * (a.end - a.mid)) / (255 - a.out);
}

/** SPLAnim_Color: start until in, → the emitter colour by peak, → end by out, then end. */
function colorCurve(a: NonNullable<Ui2dEmitter['colorAnim']>, peak: number, rate: number): number {
  const start = rgb555(a.start);
  const end = rgb555(a.end);
  if (rate < a.in) return start;
  if (rate < a.peak) return a.interpolate ? lerp555(start, peak, rate - a.in, a.peak - a.in) : peak;
  if (rate < a.out) return a.interpolate ? lerp555(peak, end, rate - a.peak, a.out - a.peak) : end;
  return end;
}

const round = (v: number) => Math.round(v * 4) / 4;
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k, a[2] * k];
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
function norm(a: Vec): Vec {
  const l = Math.hypot(...a);
  return l ? scale(a, 1 / l) : [0, 0, 0];
}
