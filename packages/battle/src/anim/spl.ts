/**
 * The particle simulation (decomp lib/spl: spl_manager.c, spl_emitter.c, spl_emit.c, spl_anim.c,
 * spl_behavior.c, spl_draw.c), run headless on `ParticleEmitter` records in the DS's fixed point. One
 * `ParticleManager` per loaded particle system: up to 20 emitters and 200 particles, emitters and particles
 * kept newest first as the SPL lists are. `update()` is SPLManager_Update (once per 30 Hz tick, after the
 * draw); `draw()` projects what SPLManager_Draw would submit into screen-space quads (`AnimParticle`).
 */
import type { AnimParticle, ParticleEmitter, ParticleSystem } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { dirToView, PX_PER_UNIT, SCREEN_CENTER, toView, type ParticleCamera, type ViewMatrix } from './camera.ts';
import { cosIdx, cross, fxMul, idiv, normalize, s16, sinIdx, type Vec } from './fx.ts';

export const MAX_EMITTERS = 20;
export const MAX_PARTICLES = 200;

/** The SPL random generator (gSPLRandomState): one stream for every particle system. */
export class SplRandom {
  constructor(public state: number) {}
  next(): number {
    this.state = (Math.imul(this.state, 0x5eedf715) + 0x1b0cb173) >>> 0;
    return this.state;
  }
  u32(bits: number): number {
    return this.next() >>> (32 - bits);
  }
  /** SPLRandom_FX32: the signed value shifted arithmetically. */
  fx32(bits: number): number {
    return (this.next() | 0) >> (32 - bits);
  }
  /** SPLRandom_ScaledRangeFX32: num · (1 − range·r), r in [0, 1). */
  scaled(num: number, range: number): number {
    return Math.floor((num * (255 - ((range * this.u32(8)) >> 8))) / 256);
  }
  /** SPLRandom_DoubleScaledRangeFX32. */
  doubleScaled(num: number, range: number): number {
    return Math.floor((num * (255 + range - ((range * this.u32(8)) >> 7))) / 256);
  }
  /** SPLRandom_RangeFX32: [−num, num). */
  range(num: number): number {
    return Math.floor((num * this.u32(9) - num * 256) / 256);
  }
  /** SPLRandom_BetweenFX32. */
  between(min: number, max: number): number {
    return (max - min) * this.u32(12) + min * 4096;
  }
  vec(): Vec {
    return normalize([this.fx32(24), this.fx32(24), this.fx32(24)]);
  }
  vecXY(): Vec {
    return normalize([this.fx32(24), this.fx32(24), 0]);
  }
}

interface Particle {
  pos: Vec;
  vel: Vec;
  rotation: number;
  angularVelocity: number;
  life: number;
  age: number;
  loopTimeFactor: number;
  lifeTimeFactor: number;
  texture: number;
  lifeRateOffset: number;
  baseAlpha: number;
  animAlpha: number;
  baseScale: number;
  animScale: number;
  color: number;
  emitterPos: Vec;
}

export class Emitter {
  particles: Particle[] = [];
  children: Particle[] = [];
  terminate = false;
  started = false;
  paused = false;
  emissionPaused = false;
  renderingDisabled = false;
  position: Vec;
  velocity: Vec = [0, 0, 0];
  particleInitVelocity: Vec = [0, 0, 0];
  age = 0;
  emissionFraction = 0;
  axis: Vec;
  initAngle: number;
  count: number;
  radius: number;
  length: number;
  velPos: number;
  velAxis: number;
  baseScale: number;
  particleLife: number;
  color = 0x7fff;
  interval: number;
  baseAlpha: number;
  collisionPlaneHeight: number | null = null;
  textureS: number;
  textureT: number;
  childTextureS = 0;
  childTextureT = 0;
  crossAxis1: Vec = [0, 0, 0];
  crossAxis2: Vec = [0, 0, 0];

  constructor(
    readonly res: ParticleEmitter,
    pos: Vec,
  ) {
    this.position = [pos[0] + res.basePos[0], pos[1] + res.basePos[1], pos[2] + res.basePos[2]];
    this.axis = [...res.axis];
    this.initAngle = res.initAngle;
    this.count = res.count;
    this.radius = res.radius;
    this.length = res.length;
    this.velPos = res.velPos;
    this.velAxis = res.velAxis;
    this.baseScale = res.scale;
    this.particleLife = res.particleLife;
    this.interval = res.interval;
    this.baseAlpha = res.alpha;
    this.textureS = (4096 << res.tileS) * (res.flipS ? -1 : 1);
    this.textureT = (4096 << res.tileT) * (res.flipT ? -1 : 1);
    if (res.child) {
      this.childTextureS = (4096 << res.child.tileS) * (res.child.flipS ? -1 : 1);
      this.childTextureT = (4096 << res.child.tileT) * (res.child.flipT ? -1 : 1);
    }
  }

  /** SPLEmitter_SetPos* (the resource's base position is added). */
  setPos(axis: 0 | 1 | 2, v: number): void {
    this.position[axis] = v + this.res.basePos[axis];
  }

  get selfMaintaining(): boolean {
    return ((this.res.flags >>> 14) & 1) === 1;
  }
}

const flag = (e: ParticleEmitter, bit: number) => ((e.flags >>> bit) & 1) === 1;
const R5 = (c: number) => c & 31;
const G5 = (c: number) => (c >> 5) & 31;
const B5 = (c: number) => (c >> 10) & 31;
const rgb = (r: number, g: number, b: number) => (r & 31) | ((g & 31) << 5) | ((b & 31) << 10);

/** One loaded particle system (decomp ParticleSystem + SPLManager). */
export class ParticleManager {
  /** Newest first (SPLEmitterList_PushFront). */
  emitters: Emitter[] = [];
  /** The resources, copied: emitter callbacks write the behaviours (ParticleSystem_SetEmitter*). */
  readonly resources: ParticleEmitter[];
  private particleCount = 0;

  constructor(
    readonly system: ParticleSystem,
    readonly camera: ParticleCamera,
    private readonly rng: SplRandom,
  ) {
    this.resources = structuredClone(system.emitters);
  }

  get textures(): Id {
    return this.system.textures;
  }

  /** SPLManager_CreateEmitterWithCallback: the callback runs before the emitter is listed. */
  createEmitter(resource: number, init: (e: Emitter) => void): Emitter | null {
    const res = this.resources[resource];
    if (!res) throw new Error(`particles ${this.system.id}: no emitter resource ${resource} of ${this.resources.length}`);
    if (this.emitters.length >= MAX_EMITTERS) return null;
    const e = new Emitter(res, [0, 0, 0]);
    init(e);
    this.emitters.unshift(e);
    return e;
  }

  deleteEmitter(e: Emitter): void {
    const i = this.emitters.indexOf(e);
    if (i < 0) return;
    this.particleCount -= e.particles.length + e.children.length;
    this.emitters.splice(i, 1);
  }

  /** SPLManager_Update. */
  update(): void {
    for (const e of [...this.emitters]) {
      const res = e.res;
      if (!e.started && e.age >= res.startDelay) {
        e.started = true;
        e.age = 0;
      }
      if (!e.paused) this.updateEmitter(e);
      const ended = ((e.selfMaintaining && res.emitterLife !== 0 && e.started && e.age > res.emitterLife) || e.terminate) && e.particles.length === 0 && e.children.length === 0;
      if (ended) this.emitters.splice(this.emitters.indexOf(e), 1);
    }
  }

  private updateEmitter(e: Emitter): void {
    const res = e.res;
    const air = res.air + 384;
    if (res.emitterLife === 0 || e.age < res.emitterLife) {
      if (e.age % e.interval === 0 && !e.terminate && !e.emissionPaused && e.started) this.emit(e);
    }
    const anims: [(p: Particle, rate: number) => void, boolean][] = [];
    if (res.scaleAnim) anims.push([(p, r) => this.animScale(p, res, r), res.scaleAnim.loop]);
    if (res.colorAnim && !res.colorAnim.randomStart) anims.push([(p, r) => this.animColor(p, res, r), res.colorAnim.loop]);
    if (res.alphaAnim) anims.push([(p, r) => this.animAlpha(p, res, r), res.alphaAnim.loop]);
    if (res.texAnim && !res.texAnim.randomStart) anims.push([(p, r) => this.animTexture(p, res, r), res.texAnim.loop]);
    const child = res.child;
    for (const p of [...e.particles]) {
      const rates = [((p.lifeTimeFactor * p.age) >> 8) & 255, (p.lifeRateOffset + ((p.loopTimeFactor * p.age) >> 8)) & 255];
      for (const [f, loop] of anims) f(p, rates[loop ? 1 : 0]!);
      const acc: Vec = [0, 0, 0];
      if (flag(res, 15)) p.emitterPos = [...e.position];
      this.behave(res, p, acc, e);
      this.integrate(p, acc, e, air);
      if (child) {
        const delay = fxMul(p.life * 4096, child.delay * 4096);
        const diff = p.age * 4096 - (delay >> 8);
        if (diff >= 0 && (diff >> 12) % child.interval === 0) this.emitChildren(p, e);
      }
      p.age++;
      if (p.age > p.life) {
        e.particles.splice(e.particles.indexOf(p), 1);
        this.particleCount--;
      }
    }
    if (child) {
      const scaleAnim = ((child.flags >>> 1) & 1) === 1;
      const alphaAnim = ((child.flags >>> 2) & 1) === 1;
      const behaviours = (child.flags & 1) === 1;
      for (const p of [...e.children]) {
        const rate = idiv(p.age << 8, p.life) & 255;
        if (scaleAnim) p.animScale = child.endScale + idiv((child.endScale - 4096) * (rate - 255), 255);
        if (alphaAnim) p.animAlpha = idiv((255 - rate) * 31, 255);
        const acc: Vec = [0, 0, 0];
        if (((child.flags >>> 5) & 1) === 1) p.emitterPos = [...e.position];
        if (behaviours) this.behave(res, p, acc, e);
        this.integrate(p, acc, e, air);
        p.age++;
        if (p.age > p.life) {
          e.children.splice(e.children.indexOf(p), 1);
          this.particleCount--;
        }
      }
    }
    e.age++;
  }

  private integrate(p: Particle, acc: Vec, e: Emitter, air: number): void {
    p.rotation = (p.rotation + p.angularVelocity) & 0xffff;
    for (let i = 0; i < 3; i++) {
      p.vel[i] = (p.vel[i]! * air) >> 9;
      p.vel[i]! += acc[i]!;
      p.pos[i]! += p.vel[i]! + e.velocity[i]!;
    }
  }

  /** The behaviours in SPLManager_LoadResources order: gravity, random, magnet, spin, collision plane, convergence. */
  private behave(res: ParticleEmitter, p: Particle, acc: Vec, e: Emitter): void {
    if (res.gravity) for (let i = 0; i < 3; i++) acc[i]! += res.gravity[i]!;
    if (res.random && p.age % res.random.interval === 0) for (let i = 0; i < 3; i++) acc[i]! += this.rng.range(res.random.magnitude[i]!);
    if (res.magnet) {
      const m = res.magnet;
      for (let i = 0; i < 3; i++) acc[i]! += (m.force * (m.target[i]! - p.pos[i]! - p.vel[i]!)) >> 12;
    }
    if (res.spin) {
      const s = sinIdx(res.spin.angle);
      const c = cosIdx(res.spin.angle);
      const [x, y, z] = p.pos;
      if (res.spin.axis === 0) p.pos = [x, fxMul(y, c) - fxMul(z, s), fxMul(y, s) + fxMul(z, c)];
      else if (res.spin.axis === 1) p.pos = [fxMul(x, c) + fxMul(z, s), y, fxMul(z, c) - fxMul(x, s)];
      else if (res.spin.axis === 2) p.pos = [fxMul(x, c) - fxMul(y, s), fxMul(x, s) + fxMul(y, c), z];
    }
    if (res.collision) {
      const c = res.collision;
      const y = e.collisionPlaneHeight ?? c.y;
      const ey = p.emitterPos[1];
      const crossed = (ey < y && ey + p.pos[1] > y) || (ey >= y && ey + p.pos[1] < y);
      if (crossed) {
        p.pos[1] = y - ey;
        if (c.type === 0) p.age = p.life;
        else if (c.type === 1) p.vel[1] = -fxMul(p.vel[1], c.elasticity);
      }
    }
    if (res.convergence) {
      const c = res.convergence;
      for (let i = 0; i < 3; i++) p.pos[i]! += fxMul(c.force, c.target[i]! - p.pos[i]!);
    }
  }

  private animScale(p: Particle, res: ParticleEmitter, rate: number): void {
    const a = res.scaleAnim!;
    if (rate < a.in) p.animScale = a.start + idiv(rate * (a.mid - a.start), a.in);
    else if (rate < a.out) p.animScale = a.mid;
    else p.animScale = a.out === 255 ? a.end : a.end + idiv((rate - 255) * (a.end - a.mid), 255 - a.out);
    p.animScale = s16(p.animScale);
  }

  private animColor(p: Particle, res: ParticleEmitter, rate: number): void {
    const a = res.colorAnim!;
    const peak = res.color;
    if (rate < a.in) p.color = a.start;
    else if (rate < a.peak) {
      if (a.interpolate) {
        const t = rate - a.in;
        const n = a.peak - a.in;
        p.color = rgb(R5(a.start) + idiv(t * (R5(peak) - R5(a.start)), n), G5(a.start) + idiv(t * (G5(peak) - G5(a.start)), n), B5(a.start) + idiv(t * (B5(peak) - B5(a.start)), n));
      } else p.color = peak & 0x7fff;
    } else if (rate < a.out) {
      if (a.interpolate) {
        const t = rate - a.peak;
        const n = a.out - a.peak;
        p.color = rgb(R5(peak) + idiv(t * (R5(a.end) - R5(peak)), n), G5(peak) + idiv(t * (G5(a.end) - G5(peak)), n), B5(peak) + idiv(t * (B5(a.end) - B5(peak)), n));
      } else p.color = a.end & 0x7fff;
    } else p.color = a.end;
  }

  private animAlpha(p: Particle, res: ParticleEmitter, rate: number): void {
    const a = res.alphaAnim!;
    let v: number;
    if (rate < a.in) v = idiv(rate * (a.mid - a.start), a.in) + a.start;
    else if (rate < a.out) v = a.mid;
    // out = 255 reaches here only at rate 255, where the fade-out term is 0.
    else v = a.out === 255 ? a.end : idiv((rate - 255) * (a.end - a.mid), 255 - a.out) + a.end;
    p.animAlpha = this.rng.scaled(v >>> 0, a.random) & 31;
  }

  private animTexture(p: Particle, res: ParticleEmitter, rate: number): void {
    const a = res.texAnim!;
    for (let i = 0; i < a.textures.length; i++) {
      if (rate < a.step * (i + 1)) {
        p.texture = a.textures[i]!;
        return;
      }
    }
  }

  private computeCrossAxes(e: Emitter): void {
    let up: Vec = [0, 4096, 0];
    const ax = (e.res.flags >>> 6) & 3;
    const axis: Vec = ax === 2 ? [4096, 0, 0] : ax === 1 ? [0, 4096, 0] : ax === 0 ? [0, 0, 4096] : normalize(e.axis);
    const d = fxMul(up[0], axis[0]) + fxMul(up[1], axis[1]) + fxMul(up[2], axis[2]);
    if (d === 4096 || d === -4096) up = [4096, 0, 0];
    e.crossAxis1 = normalize(cross(axis, up));
    e.crossAxis2 = normalize(cross(axis, e.crossAxis1));
  }

  private tilt(e: Emitter, pos: Vec): Vec {
    const n = normalize(cross(e.crossAxis1, e.crossAxis2));
    const a = e.crossAxis1;
    const b = e.crossAxis2;
    return [
      fxMul(pos[0], a[0]) + fxMul(pos[1], b[0]) + fxMul(pos[2], n[0]),
      fxMul(pos[0], a[1]) + fxMul(pos[1], b[1]) + fxMul(pos[2], n[1]),
      fxMul(pos[0], a[2]) + fxMul(pos[1], b[2]) + fxMul(pos[2], n[2]),
    ];
  }

  /** SPLEmitter_EmitParticles. */
  private emit(e: Emitter): void {
    const res = e.res;
    const rng = this.rng;
    const total4096 = e.count + e.emissionFraction;
    const total = total4096 >> 12;
    e.emissionFraction = total4096 & 0xfff;
    const type = res.flags & 15;
    if ([2, 3, 5, 6, 7, 8, 9].includes(type)) this.computeCrossAxes(e);
    for (let i = 0; i < total; i++) {
      if (this.particleCount >= MAX_PARTICLES) return;
      this.particleCount++;
      const p: Particle = {
        pos: [0, 0, 0],
        vel: [0, 0, 0],
        rotation: 0,
        angularVelocity: 0,
        life: 1,
        age: 0,
        loopTimeFactor: 0,
        lifeTimeFactor: 0,
        texture: 0,
        lifeRateOffset: 0,
        baseAlpha: 0,
        animAlpha: 31,
        baseScale: 0,
        animScale: 4096,
        color: 0,
        emitterPos: [0, 0, 0],
      };
      e.particles.unshift(p);
      const rf = () => rng.range(4096);
      switch (type) {
        case 0:
          break;
        case 1: {
          const v = rng.vec();
          p.pos = [fxMul(v[0], e.radius), fxMul(v[1], e.radius), fxMul(v[2], e.radius)];
          break;
        }
        case 2: {
          const v = rng.vecXY();
          p.pos = this.tilt(e, [fxMul(v[0], e.radius), fxMul(v[1], e.radius), 0]);
          break;
        }
        case 3: {
          const idx = idiv(i * 0x10000, total);
          p.pos = this.tilt(e, [fxMul(sinIdx(idx), e.radius), fxMul(cosIdx(idx), e.radius), 0]);
          break;
        }
        case 4: {
          const v = rng.vec();
          const x = fxMul(fxMul(v[0], e.radius), rf());
          const y = fxMul(fxMul(v[1], e.radius), rf());
          p.pos = [x, y, fxMul(fxMul(v[2], e.radius), rf())];
          break;
        }
        case 5: {
          const v = rng.vecXY();
          const x = fxMul(fxMul(v[0], e.radius), rf());
          p.pos = this.tilt(e, [x, fxMul(fxMul(v[1], e.radius), rf()), 0]);
          break;
        }
        case 6:
        case 7: {
          p.vel = rng.vecXY();
          const x = type === 6 ? fxMul(p.vel[0], e.radius) : fxMul(fxMul(p.vel[0], e.radius), rf());
          const y = type === 6 ? fxMul(p.vel[1], e.radius) : fxMul(fxMul(p.vel[1], e.radius), rf());
          p.pos = this.tilt(e, [x, y, rng.range(e.length)]);
          break;
        }
        case 8:
        case 9: {
          const v = rng.vec();
          const up = cross(e.crossAxis1, e.crossAxis2);
          const d = fxMul(up[0], v[0]) + fxMul(up[1], v[1]) + fxMul(up[2], v[2]);
          const flip = type === 8 ? d <= 0 : d < 0;
          const w: Vec = flip ? [-v[0], -v[1], -v[2]] : v;
          if (type === 8) p.pos = [fxMul(w[0], e.radius), fxMul(w[1], e.radius), fxMul(w[2], e.radius)];
          else {
            const x = fxMul(fxMul(w[0], e.radius), (rf() >> 1) + 2048);
            const y = fxMul(fxMul(w[1], e.radius), (rf() >> 1) + 2048);
            p.pos = [x, y, fxMul(fxMul(w[2], e.radius), (rf() >> 1) + 2048)];
          }
          break;
        }
        default:
          throw new Error(`particles: emission type ${type}`);
      }
      const magPos = rng.doubleScaled(e.velPos, res.attenuation[2]);
      const magAxis = rng.doubleScaled(e.velAxis, res.attenuation[2]);
      let n: Vec;
      if (type === 6) {
        const v = p.vel;
        const a = e.crossAxis1;
        const b = e.crossAxis2;
        n = normalize([fxMul(v[0], a[0]) + fxMul(v[1], b[0]), fxMul(v[0], a[1]) + fxMul(v[1], b[1]), fxMul(v[0], a[2]) + fxMul(v[1], b[2])]);
      } else if (p.pos[0] === 0 && p.pos[1] === 0 && p.pos[2] === 0) n = rng.vec();
      else n = normalize(p.pos);
      p.vel = [0, 1, 2].map((k) => fxMul(n[k]!, magPos) + fxMul(e.axis[k]!, magAxis) + e.particleInitVelocity[k]!) as Vec;
      p.emitterPos = [...e.position];
      p.baseScale = rng.doubleScaled(e.baseScale, res.attenuation[0]);
      p.animScale = 4096;
      if (res.colorAnim?.randomStart) {
        const k = rng.u32(12);
        p.color = [res.colorAnim.start, res.color, res.colorAnim.end][k % 3]!;
      } else p.color = res.color;
      p.baseAlpha = e.baseAlpha & 31;
      p.animAlpha = 31;
      p.rotation = flag(res, 13) ? rng.u32(32) & 0xffff : e.initAngle;
      p.angularVelocity = flag(res, 12) ? s16(rng.between(res.minRotation, res.maxRotation) >>> 12) : 0;
      p.life = rng.scaled(e.particleLife, res.attenuation[1]) + 1;
      p.age = 0;
      if (res.texAnim?.randomStart) p.texture = res.texAnim.textures[rng.u32(12) % res.texAnim.textures.length]!;
      else if (res.texAnim) p.texture = res.texAnim.textures[0]!;
      else p.texture = res.texture;
      p.loopTimeFactor = idiv(0xffff, res.loopFrames || 1) & 0xffff;
      p.lifeTimeFactor = idiv(0xffff, p.life) & 0xffff;
      p.lifeRateOffset = flag(res, 20) ? rng.u32(8) : 0;
    }
  }

  /** SPLEmitter_EmitChildren. */
  private emitChildren(parent: Particle, e: Emitter): void {
    const c = e.res.child!;
    const ratio = fxMul(c.velRatio * 4096, 16);
    for (let i = 0; i < c.count; i++) {
      if (this.particleCount >= MAX_PARTICLES) return;
      this.particleCount++;
      const vel: Vec = [0, 0, 0];
      for (let k = 0; k < 3; k++) vel[k] = fxMul(parent.vel[k]!, ratio) + this.rng.range(c.randomVel);
      const parentScale = (parent.baseScale * parent.animScale) >> 12;
      const p: Particle = {
        pos: [...parent.pos],
        vel,
        rotation: (c.flags >>> 3) & 3 ? parent.rotation : 0,
        angularVelocity: ((c.flags >>> 3) & 3) === 2 ? parent.angularVelocity : 0,
        life: c.life,
        age: 0,
        loopTimeFactor: idiv(0xffff, idiv(parent.life, 2) || 1) & 0xffff,
        lifeTimeFactor: idiv(0xffff, parent.life) & 0xffff,
        texture: c.texture,
        lifeRateOffset: 0,
        baseAlpha: (parent.baseAlpha * (parent.animAlpha + 1)) >> 5,
        animAlpha: 31,
        baseScale: (parentScale * (c.scaleRatio + 1)) >> 6,
        animScale: 4096,
        color: ((c.flags >>> 6) & 1) === 1 ? c.color : parent.color,
        emitterPos: [...parent.emitterPos],
      };
      e.children.unshift(p);
    }
  }

  /** What SPLManager_Draw submits, as screen-space quads in draw order (later on top). */
  draw(out: AnimParticle[]): void {
    const view = this.camera.view();
    for (const e of this.emitters) {
      if (e.renderingDisabled) continue;
      const res = e.res;
      const parents = () => {
        if (flag(res, 22)) return;
        for (const p of e.particles) this.drawParticle(out, view, e, p, false);
      };
      const children = () => {
        if (!res.child) return;
        for (const p of e.children) this.drawParticle(out, view, e, p, true);
      };
      if (flag(res, 21)) {
        children();
        parents();
      } else {
        parents();
        children();
      }
    }
  }

  private drawParticle(out: AnimParticle[], view: ViewMatrix, e: Emitter, p: Particle, child: boolean): void {
    const res = e.res;
    const alpha = (p.baseAlpha * (p.animAlpha + 1)) >> 5;
    if (alpha === 0) return;
    const aspect = res.aspect / 4096;
    let sclY = p.baseScale / 4096;
    let sclX = sclY * aspect;
    const anim = p.animScale / 4096;
    if (res.scaleDir === 0) {
      sclX *= anim;
      sclY *= anim;
    } else if (res.scaleDir === 1) sclX *= anim;
    else sclY *= anim;
    const viewSpace = flag(res, 23);
    const base = viewSpace ? res.basePos : ([0, 0, 0] as Vec);
    const world: Vec = [p.pos[0] + p.emitterPos[0] - base[0], p.pos[1] + p.emitterPos[1] - base[1], p.pos[2] + p.emitterPos[2] - base[2]];
    const t = toView(view, world);
    if (viewSpace) for (let i = 0; i < 3; i++) t[i]! += base[i]! / 4096;
    const drawType = child ? (res.child!.flags >>> 7) & 3 : (res.flags >>> 4) & 3;
    // The quad's axes in view space (rows of the SPL draw matrix).
    let ax: [number, number];
    let ay: [number, number];
    if (drawType === 1) {
      // Directional billboard: the quad's x across the velocity on screen, its y along it, stretched by dbbScale.
      const look = view.z;
      const v = p.vel.map((k) => k / 4096) as [number, number, number];
      const c: [number, number, number] = [v[1] * look[2] - v[2] * look[1], v[2] * look[0] - v[0] * look[2], v[0] * look[1] - v[1] * look[0]];
      const cl = Math.hypot(...c);
      if (cl === 0) return;
      const dir = dirToView(view, [c[0] / cl, c[1] / cl, c[2] / cl]);
      const vl = Math.hypot(...v);
      const vd = vl ? [v[0] / vl, v[1] / vl, v[2] / vl] : [0, 0, 0];
      const d = Math.abs(vd[0]! * -look[0] + vd[1]! * -look[1] + vd[2]! * -look[2]);
      const stretch = sclY * ((1 - d) * (res.dbbScale / 4096) + 1);
      ax = [dir[0] * sclX, dir[1] * sclX];
      ay = [-dir[1] * stretch, dir[0] * stretch];
    } else {
      // Billboards (and, approximated as billboards, the rare polygon types): rotated about the view axis.
      const r = (p.rotation / 0x10000) * 2 * Math.PI;
      const s = Math.sin(r);
      const co = Math.cos(r);
      ax = [co * sclX, s * sclX];
      ay = [-s * sclY, co * sclY];
    }
    const px = (child ? 0 : res.polygonX) / 4096;
    const py = (child ? 0 : res.polygonY) / 4096;
    // Quad corner (u, v) = (0, 0) is local (px − 1, py + 1); u runs to +x over 2 units, v to −y.
    const lx = px - 1;
    const ly = py + 1;
    const vx = lx * ax[0] + ly * ay[0] + t[0];
    const vy = lx * ax[1] + ly * ay[1] + t[1];
    const k = PX_PER_UNIT;
    const ts = child ? e.childTextureS : e.textureS;
    const tt = child ? e.childTextureT : e.textureT;
    const param = this.system.textureParams[p.texture] ?? 0;
    const color = rgb((R5(p.color) * R5(e.color)) >> 5, (G5(p.color) * G5(e.color)) >> 5, (B5(p.color) * B5(e.color)) >> 5);
    out.push({
      textures: this.system.textures,
      cell: p.texture,
      m: [2 * ax[0] * k, -2 * ax[1] * k, -2 * ay[0] * k, 2 * ay[1] * k, SCREEN_CENTER.x + vx * k, SCREEN_CENTER.y - vy * k],
      tile: [ts / 4096, tt / 4096],
      mirror: [((param >>> 14) & 1) === 1, ((param >>> 15) & 1) === 1],
      color,
      alpha,
    });
  }

  /** Active emitters (ParticleSystem_GetActiveEmitterCount). */
  get activeEmitters(): number {
    return this.emitters.length;
  }
}
