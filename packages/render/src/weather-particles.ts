import type { WeatherParticles } from '@opensinnoh/contracts';

/**
 * The weather tasks' particles on one DS screen (decomp ov5_021D5EB8.c): each kind's spawn and per-tick update, the
 * 48-sprite pool, the screen wrap and the camera shift. Positions are DS screen pixels of the sprite (the cell's
 * origin), `frame` the animation frame it shows (Sprite_SetAnimFrame). The DS draws its random numbers from MTRNG; this
 * draws them from its own seeded generator (the look only: weather rolls no game random numbers). Pure tick state.
 *
 * Kinds and their functions: rain ov5_021D78A4/ov5_021D7960, heavy rain and the thunderstorm ov5_021DA0A8/ov5_021DA1A8,
 * snow ov5_021D7C40/ov5_021D7E20, heavy snow (and weather 21) ov5_021D8098/ov5_021D81BC, the blizzard
 * ov5_021D92C4/ov5_021D93DC, ash ov5_021DA5A0/ov5_021DA6BC, sand (the sandstorm and weather 22) ov5_021D8B88/ov5_021D8C90,
 * hail ov5_021D9690/ov5_021D97C0, spirits ov5_021DA9DC/ov5_021DAADC.
 */

/** ov5_021D75E4: a weather task holds 48 sprites; a spawn stops when they are all in use. */
export const WEATHER_POOL = 48;

export interface WeatherParticle {
  x: number;
  y: number;
  frame: number;
  /** The task's per-sprite words (`s32 *unk_08`). */
  d: number[];
  dead: boolean;
}

/** The blizzard's speed tables by phase (Unk_ov5_021F8CDC, Unk_ov5_021F8CEC). */
const BLIZZARD_X = [-4, -6, -8, -10];
const BLIZZARD_Y = [2, 4, 2, 4];
/** The sand's (ov5_021D8B88's own tables). */
const SAND_X = [-3, -5, -5, -4, -5, -6, -10, -6];
const SAND_Y = [2, 2, 2, 4, 4, 2, 2, 2];
/** Heavy rain's speed factor by fifth of its 300-tick cycle (ov5_021DA0A8). */
const HEAVY_RAIN_FACTOR = [1, 1, 2, 1, 3];
/** Heavy snow's slow-down period by quarter of its 800-spawn cycle (ov5_021D8098). */
const HEAVY_SNOW_PERIOD = [16, 32, 16, 10];

/** ov5_021D630C: positions wrap into x −64..319 and y −64..256. */
function wrap(p: WeatherParticle): void {
  const W = 255 + 64;
  const H = 192 + 64;
  if (p.x > W) p.x %= W;
  else if (p.x < -64) p.x += W;
  if (p.y > H) p.y %= H;
  else if (p.y < -64) p.y += H;
}

/** C's int division (towards zero). */
const div = (a: number, b: number) => Math.trunc(a / b);

export class WeatherSim {
  readonly particles: WeatherParticle[] = [];
  private seed: number;
  /** The task's shared words: a spawn counter or cycle (unk_B4[1]), heavy rain's cycle (unk_B4[2]). */
  private counter = 0;
  private cycle = 0;
  /** Snow and ash: a flake has reached the bottom (unk_B4[1] = 1), so spawns double, half of them higher up. */
  private landed = false;
  /** Ash: the fade out has started (unk_B4[5]); snow: it has ended (unk_B4[2]). */
  private fading = false;
  private faded = false;

  constructor(
    readonly kind: WeatherParticles,
    seed: number,
  ) {
    if (kind === 'diamond-dust') throw new Error('weather particles: no weather task draws diamond dust');
    this.seed = seed >>> 0 || 1;
  }

  /** A u32 (xorshift32). */
  private rand(): number {
    let s = this.seed;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this.seed = s >>> 0;
    return this.seed;
  }

  private add(x: number, y: number, frame: number, d: number[]): WeatherParticle | null {
    if (this.particles.length >= WEATHER_POOL) return null;
    const p: WeatherParticle = { x, y, frame, d, dead: false };
    wrap(p);
    this.particles.push(p);
    return p;
  }

  /** Ash's fade out has started (true); snow's has ended (`done`). */
  fadeOut(done: boolean): void {
    this.fading = true;
    if (done) this.faded = true;
  }

  /** One tick of the steady state before its spawn (heavy rain's speed cycle, ov5_021D9AEC). */
  steadyTick(): void {
    if (this.kind === 'heavy-rain' || this.kind === 'thunder') this.cycle = (this.cycle + 1) % 300;
  }

  /** The steady spawner's count this time (the blizzard doubles it in its fast phases). */
  steadyCount(count: number): number {
    return this.kind === 'blizzard' && BLIZZARD_X[Math.floor(this.counter / 512)]! <= -8 ? count * 2 : count;
  }

  /** The kind's spawn function for `n` (it stops when the pool is full). */
  spawn(n: number): void {
    const r = () => this.rand();
    switch (this.kind) {
      case 'rain':
        for (let i = 0; i < n; i++) {
          const v = r();
          const size = v % 3;
          let speed = 10 * (size + 1) + (v % 20);
          if (size === 2) speed += 10;
          let side = -5 * (size + 1) + div(v % 20, -5);
          if (size === 2) side -= 5;
          if (!this.add(size * 15 + (v % 270), -96, size, [0, 1 + (v % 3), speed, 0, side])) return;
        }
        return;
      case 'heavy-rain':
      case 'thunder': {
        const f = HEAVY_RAIN_FACTOR[Math.floor(this.cycle / 60)]!;
        for (let i = 0; i < n; i++) {
          const v = r();
          const size = v % 3;
          if (!this.add(v % 512, -80 + (v % 48), size, [0, div(v % 4, f), 24 * (size + 1) * f, 0, -24 * (size + 1) * f])) return;
        }
        return;
      }
      case 'snow':
      case 'ash': {
        const total = this.landed ? n * 2 : n;
        for (let i = 0; i < total; i++) {
          if (this.particles.length >= WEATHER_POOL) return;
          const frame = r() % 4;
          const v = r();
          const sway = v % 2 === 0 ? 1 : -1;
          let d: number[];
          if (this.kind === 'snow') {
            // d[1] the swing's side, d[2] its period, d[3] the fall's period, d[4] swing steps, d[5] the two tick counts,
            // d[8] the state, d[9] the countdown once the fade out has ended.
            const period = 4 + (r() % 2);
            const fall = 1 + (r() % 2);
            d = [0, sway, period, fall, 10, 0, 0, 0, 0, 4 + (v % 60)];
          } else {
            const fall = 1 + (r() % 1);
            // d[3] the fall's period, d[5] its tick count, d[7] the countdown once the fade out has started.
            d = [0, sway, 0, fall, 10, 0, 0, 10 + (r() % 20)];
          }
          const x = -32 + (r() % 414);
          const y = this.landed && i >= div(total, 2) ? -40 - (r() % 20) : -8 - (r() % 20);
          this.add(x, y, frame, d);
        }
        return;
      }
      case 'heavy-snow':
        for (let i = 0; i < n; i++) {
          if (this.particles.length >= WEATHER_POOL) return;
          this.counter++;
          if (this.counter >= 800) this.counter = 0;
          const phase = Math.floor(this.counter / 200);
          const life = 4 + (r() % 42);
          const size = div(life - 4, 15);
          this.add(-20 + size * 20 + (r() % 420), -8, size, [0, life, 2 * (size + 1), 0, -(size + 1), HEAVY_SNOW_PERIOD[phase]!]);
        }
        return;
      case 'blizzard': {
        this.counter++;
        if (this.counter >= 2048) this.counter = 0;
        const phase = Math.floor(this.counter / 512);
        const X = BLIZZARD_X[phase]!;
        const Y = BLIZZARD_Y[phase]!;
        for (let i = 0; i < n * 4; i++) {
          if (this.particles.length >= WEATHER_POOL) return;
          const life = 18 + (r() % 6);
          const size = r() % 4;
          let side = X * (size + 1);
          let speed = Y * (size + 1);
          if (size === 3) {
            side += X;
            speed += Y;
          }
          this.add(256 + (r() % 24), -32 + (r() % 168), size, [0, life, speed, 0, side, X]);
        }
        return;
      }
      case 'sand': {
        this.counter = (this.counter + 1) % 320;
        const phase = Math.floor(this.counter / 40);
        for (let i = 0; i < n; i++) {
          if (this.particles.length >= WEATHER_POOL) return;
          const life = 15 + (r() % 20);
          let size = 3 - div(life - 15, 6);
          let speed = SAND_Y[phase]! * (size + 1);
          const side = SAND_X[phase]! * (size + 1);
          if (r() % 1000 === 777) {
            size = 4;
            speed += div(speed, 2);
          }
          this.add(262 + (r() % 24), -64 + (r() % 192), size, [0, life, speed, 0, side, SAND_X[phase]!]);
        }
        return;
      }
      case 'hail':
        for (let i = 0; i < n; i++) {
          if (this.particles.length >= WEATHER_POOL) return;
          const d = [0, 7 + (r() % 5), 0, 1, 0, 0];
          d[2] = (r() % 1000) % 2 === 0 ? 1 : -1;
          d[4] = 3 + (r() % 6);
          d[5] = 4 + (r() % 5);
          let frame = r() % 0x14;
          const p = this.add(-64 + (r() % 384), -8 + (r() % 256), 0, d)!;
          const x = Math.floor(p.x);
          const y = Math.floor(p.y);
          const top = 50 - div(x, 3);
          let span = 206 - div(x, 3);
          let bottom: number;
          if (span < 0) {
            span = -span;
            bottom = top - (r() % span);
          } else bottom = top + (r() % span);
          // The band across the screen keeps its sparkles twice as long; elsewhere they are the small ones.
          if (top <= y && bottom >= y) d[1]! *= 2;
          else frame = r() % 4;
          p.frame = frame;
        }
        return;
      case 'spirits':
        for (let i = 0; i < n; i++) {
          if (this.particles.length >= WEATHER_POOL) return;
          const frame = r() % 0xe;
          const s = div(frame, 4) + 1;
          const rise = (8 + (r() % 25)) * s;
          const swing = r() % 2;
          const x = -128 + (r() % 512);
          const y = s <= 2 ? 8 + (r() % 192) : s === 3 ? 64 + (r() % 128) : 160 + (r() % 32);
          this.add(x, y, frame, [rise, div(16, s), 0, swing, 1]);
        }
        return;
    }
  }

  /** The kind's update for every particle, in spawn order; the dead leave the pool. */
  update(): void {
    for (const p of this.particles) if (!p.dead) this.updateOne(p);
    this.sweep();
  }

  private sweep(): void {
    for (let i = this.particles.length - 1; i >= 0; i--) if (this.particles[i]!.dead) this.particles.splice(i, 1);
  }

  private updateOne(p: WeatherParticle): void {
    const d = p.d;
    switch (this.kind) {
      case 'rain':
      case 'heavy-rain':
      case 'thunder': {
        // State 0 falls, then (30 % for rain, 50 % for heavy rain) splashes for 4 ticks; state 2 goes.
        if (d[3] === 0) {
          p.x += d[4]! * 2;
          p.y += d[2]! * 2;
          d[0]! += 2;
          if (d[0]! > d[1]!) {
            if (this.rand() % 10 < (this.kind === 'rain' ? 7 : 5)) d[3] = 2;
            else {
              d[3] = 1;
              d[0] = 4;
              p.frame = 3;
            }
          }
          wrap(p);
        } else if (d[3] === 1) {
          if (d[0]!-- <= 0) d[3] = 2;
        } else p.dead = true;
        return;
      }
      case 'snow': {
        if (d[8] === 0) {
          if (this.faded) d[8] = 1;
        } else if (--d[9]! < 0) {
          p.dead = true;
          return;
        }
        if ((d[5]! & 0xffff) >= d[2]!) {
          p.x += d[1]!;
          d[4]!++;
          d[5] = d[5]! & ~0xffff;
          if (d[4]! < 10) d[2]!--;
          else d[2]!++;
          if (d[4]! >= 20) {
            d[4] = 0;
            d[1] = -d[1]!;
          }
        }
        if (d[5]! >> 16 >= d[3]!) {
          p.y += 1;
          d[5] = d[5]! & 0xffff;
        }
        wrap(p);
        d[6] = (d[6]! + 1) % 100;
        d[5] = d[5]! + 1 + 0x10000;
        const y = Math.floor(p.y);
        if ((y < -284 && y > -296) || (y > 212 && y < 232)) {
          this.landed = true;
          p.dead = true;
        }
        return;
      }
      case 'ash': {
        if (d[5]! >= d[3]!) {
          p.y += 1;
          d[5] = 0;
          wrap(p);
        }
        d[5]!++;
        const y = Math.floor(p.y);
        let gone = false;
        if (this.fading && --d[7]! <= 0) gone = true;
        if ((y < -284 && y > -296) || (y > 212 && y < 232)) gone = true;
        if (gone) {
          this.landed = true;
          p.dead = true;
        }
        return;
      }
      case 'heavy-snow':
        if (d[3] !== 0) {
          p.dead = true;
          return;
        }
        p.x += d[4]!;
        p.y += d[2]!;
        if (d[0]!++ > d[1]!) d[3] = 1;
        if (d[0]! % d[5]! === 0) {
          d[4]!--;
          if (d[2]! > 1) d[2]!--;
        }
        wrap(p);
        return;
      case 'blizzard':
        if (d[3] !== 0) {
          p.dead = true;
          return;
        }
        p.x += d[4]!;
        p.y += d[2]!;
        if (d[0]!++ > d[1]!) d[3] = 1;
        if (d[0]! % 4 === 0) {
          d[4]! += d[5]!;
          if (d[2]! > 1) d[2]!--;
        }
        wrap(p);
        return;
      case 'sand':
        if (d[3] !== 0) {
          p.dead = true;
          return;
        }
        p.x += d[4]!;
        p.y += d[2]!;
        if (d[0]! % 5 === 0) d[4]! += d[5]!;
        if (d[0]!++ > d[1]!) d[3] = 1;
        wrap(p);
        return;
      case 'hail':
        // ov5_021D97C0 works out a move but never sets it: the sparkle stays where it was spawned.
        if (++d[0]! >= d[1]!) p.dead = true;
        return;
      case 'spirits': {
        d[2]! += d[1]!;
        if (d[0]! > 0) {
          d[0]!--;
          p.y -= div(d[2]!, 100);
        } else p.y -= div(d[2]!, 50);
        if (--d[4]! <= 0) {
          d[4] = 1;
          p.x += d[3] === 0 ? 2 : -2;
          d[3] = d[3] === 0 ? 1 : 0;
        }
        wrap(p);
        if (Math.floor(p.y) <= -16) p.dead = true;
        return;
      }
    }
  }

  /** ov5_021D71B4: the camera moved `dx`, `dy` DS px; every particle moves the other way (the blizzard's do not). */
  shift(dx: number, dy: number): void {
    if (this.kind === 'blizzard' || (dx === 0 && dy === 0)) return;
    for (const p of this.particles) {
      p.x -= dx;
      p.y -= dy;
      wrap(p);
    }
  }

  /**
   * ov5_021D7568, a map load's start at full: spawn `n`, then advance the k-th particle `steps` times, `steps` growing
   * by `step` every `period` particles from the `period`-th.
   */
  prewarm(n: number, period: number, step: number): void {
    const start = this.particles.length;
    this.spawn(n);
    let steps = 0;
    const list = this.particles.slice(start);
    for (let k = 0; k < n && k < list.length; k++) {
      const p = list[k]!;
      for (let i = 0; i < steps && !p.dead; i++) this.updateOne(p);
      if (k >= period && k % period === 0) steps += step;
    }
    this.sweep();
  }
}
