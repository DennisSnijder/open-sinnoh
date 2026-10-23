/**
 * The Underground traps' escape games (decomp src/underground/traps.c: Traps_ProcessSmoke, _ProcessBubbles,
 * _ProcessBoulder, _ProcessLeaves, _ProcessFlame), one 30 Hz tick per `step`, in DS px of the 256×192 touch screen.
 * Game-agnostic rules; behavioural references only, an independent implementation. The DS's fixed-point sines,
 * square roots and arctangents are floats here (the results are the same up to a pixel).
 */
import type { Rand32 } from './underground.ts';

const W = 256;
const H = 192;

/** FX_SinIdx / FX_CosIdx on a u16 angle (the DS's 4096-entry table). */
const sinIdx = (a: number) => Math.sin(((a & 0xffff) >> 4) * ((2 * Math.PI) / 4096));
const cosIdx = (a: number) => Math.cos(((a & 0xffff) >> 4) * ((2 * Math.PI) / 4096));

// ---------------------------------------------------------------- smoke

/** BG_LAYER_MAIN_2's 32 × 24 tiles of 8 px. */
export const SMOKE = { width: 32, height: 24, done: 13 } as const;
/** Traps_ClearSmoke's neighbourhood, row by row: +3 on the tile, +2 beside it, +1 on the corners. */
const RUB = [1, 2, 1, 2, 3, 2, 1, 2, 1];

/**
 * The smoke trap (Traps_SmokeTrapClientTask): 32×24 NSCR entries whose character (the low byte) is the smoke there,
 * 0 clear. The stylus thins the 3×3 tiles around each point of its path since the last tick's point (Traps_HandleSmoke
 * Touch walks from the new point towards the old, without the old); a tile past 5 is clear. Won when fewer than 13
 * tiles are left.
 */
export class SmokeGame {
  readonly tiles: number[];
  private prev: { x: number; y: number } | null = null;

  constructor(pattern: readonly number[]) {
    if (pattern.length !== SMOKE.width * SMOKE.height) throw new Error(`smoke: a pattern of ${pattern.length} tiles`);
    this.tiles = [...pattern];
  }

  get won(): boolean {
    return this.tiles.filter((e) => e & 0xff).length < SMOKE.done;
  }

  /** The stylus is up (Traps_ResetSmokeTrapTouchCoords): the next point starts a new stroke. */
  lift(): void {
    this.prev = null;
  }

  /** The held stylus at (x, y) this tick; whether any smoke was thinned. */
  rub(x: number, y: number): boolean {
    const prev = this.prev;
    this.prev = { x, y };
    if (!prev) return false;
    const xd = Math.abs(x - prev.x);
    const yd = Math.abs(prev.y - y);
    const sx = x < prev.x ? 1 : -1;
    const sy = y < prev.y ? 1 : -1;
    let cleared = false;
    let cx = x;
    let cy = y;
    if (xd >= yd) {
      let e = -xd;
      while (cx !== prev.x) {
        cleared = this.clear(cx, cy) || cleared;
        cx += sx;
        e += 2 * yd;
        if (e >= 0) {
          e -= 2 * xd;
          cy += sy;
        }
      }
    } else {
      let e = -yd;
      while (cy !== prev.y) {
        cleared = this.clear(cx, cy) || cleared;
        cy += sy;
        e += 2 * xd;
        if (e >= 0) {
          e -= 2 * yd;
          cx += sx;
        }
      }
    }
    return cleared;
  }

  /** Traps_ClearSmoke at a point. */
  private clear(x: number, y: number): boolean {
    const tx = Math.floor(x / 8);
    const ty = Math.floor(y / 8);
    let cleared = false;
    for (let i = 0; i < 9; i++) {
      const nx = tx + (i % 3) - 1;
      const ny = ty + Math.floor(i / 3) - 1;
      if (nx < 0 || nx >= SMOKE.width || ny < 0 || ny >= SMOKE.height) continue;
      const k = ny * SMOKE.width + nx;
      const e = this.tiles[k]!;
      if (!(e & 0xff)) continue;
      cleared = true;
      const next = (e & 0xff) + RUB[i]!;
      this.tiles[k] = (e & ~0xff) | (next > 5 ? 0 : next);
    }
    return cleared;
  }
}

// ---------------------------------------------------------------- bubbles

/** sBubbleSizeRadii: large, medium, small. MAX_BUBBLES and the foam's seven. */
export const BUBBLE_RADII = [32, 28, 24] as const;
const BUBBLE_COUNT = { bubble: 20, foam: 7 };

export interface Bubble {
  /** 0 large, 1 medium, 2 small. */
  size: number;
  x: number;
  y: number;
  angle: number;
  /** The wobble's phase (bubbleScaleTimer). */
  scale: number;
  popped: boolean;
}

/**
 * The bubble and foam traps (Traps_InitBubbles, Traps_ProcessBubbles): 20 bubbles (1–2 large, 5–7 medium counted with
 * them, the rest small) or 7 for the foam (none large), rolled on `rand`; each drifts a pixel a tick along its angle,
 * bouncing off the edges; a stylus press inside one pops the first such (in slot order). Won when all are popped.
 */
export class BubbleGame {
  readonly bubbles: Bubble[];

  constructor(foam: boolean, rand: Rand32) {
    const count = foam ? BUBBLE_COUNT.foam : BUBBLE_COUNT.bubble;
    const large = foam ? 0 : rand.next(2) + 1;
    const medium = rand.next(3) + large + 5;
    this.bubbles = Array.from({ length: count });
    for (let i = 0; i < count; i++) {
      const size = i < large ? 0 : i < medium ? 1 : 2;
      const r = BUBBLE_RADII[size]!;
      const x = rand.next(W - r * 2) + r;
      const y = rand.next(H - r * 2) + r;
      this.bubbles[count - i - 1] = { size, x, y, angle: rand.next(0xffff), scale: rand.next(0xffff), popped: false };
    }
  }

  get won(): boolean {
    return this.bubbles.every((b) => b.popped);
  }

  /** A stylus press: the bubble popped, or null. */
  press(x: number, y: number): Bubble | null {
    const b = this.bubbles.find((b) => !b.popped && Math.hypot(x - b.x, y - b.y) < BUBBLE_RADII[b.size]!);
    if (b) b.popped = true;
    return b ?? null;
  }

  /** The bubbles left drift and bounce. */
  step(): void {
    this.bubbles.forEach((b, i) => {
      if (b.popped) return;
      b.scale = (b.scale + 0x250 + i * 100) & 0xffff;
      b.y -= sinIdx(b.angle);
      b.x += cosIdx(b.angle);
      const r = BUBBLE_RADII[b.size]!;
      if (b.y < r || b.y >= H - r) b.angle = (0xffff - b.angle) & 0xffff;
      if (b.x < r || b.x >= W - r) b.angle = (0xffff - ((b.angle - 0x8000) & 0xffff)) & 0xffff;
    });
  }

  /** Traps_UpdateBubbleSprite's wobble: 0.9–1. */
  static wobble(b: Bubble): number {
    return 1 - (sinIdx(b.scale) + 1) / 20;
  }
}

// ---------------------------------------------------------------- the boulder

/** BOULDER_XPOS, BOULDER_RADIUS, the fall (from y 0 at 5 px a tick, 3 more each tick, until past 65), past 15 it breaks. */
export const BOULDER = { x: 128, radius: 48, speed: 5, accel: 3, land: 65, broken: 15, shadow: 20, debris: 20, collapse: 75 } as const;

/**
 * The rock and rockfall traps (Traps_ProcessBoulder): the shadow (20 ticks), the fall, then each stylus press within the
 * boulder's radius is a hit (from 5 damage for the rock, already cracked to stage 2, −1 for the rockfall); every third
 * hit (damage 2, 5, 8, …) cracks it to the next stage (damage / 3 + 1) and throws debris for 20 ticks, when hits do not
 * count; past 15 it collapses (75 ticks, sinking a pixel a tick). Won once it is gone.
 */
export class BoulderGame {
  phase: 'shadow' | 'fall' | 'main' | 'debris' | 'collapse' | 'gone' = 'shadow';
  t = 0;
  y = 0;
  damage = 0;
  /** The picture: 0 whole, 1–5 cracked (boulder_damaged_n), 6 collapsing. */
  stage: number;
  /** The shake after a hit: ±3, alternating, easing off (boulderShakeDisplacement). */
  shake = 0;
  private speed = 0;

  constructor(private readonly fall: boolean) {
    this.stage = fall ? 0 : 2;
  }

  get won(): boolean {
    return this.phase === 'gone';
  }

  /** A stylus press: `hit` (it counts), `cracked` (and the boulder cracked), or null. */
  press(x: number, y: number): 'hit' | 'cracked' | null {
    if (this.phase !== 'main' || Math.hypot(x - BOULDER.x, y - this.y) >= BOULDER.radius) return null;
    this.shake = 3;
    this.damage++;
    if (this.damage % 3 !== 2) return 'hit';
    this.stage = Math.floor(this.damage / 3) + 1;
    this.phase = 'debris';
    this.t = 0;
    return 'cracked';
  }

  /** One tick; `landed` and `collapsed` mark the sounds' moments. */
  step(): 'landed' | 'collapsed' | null {
    const shake = () => {
      if (this.shake === 0) return;
      if (this.shake < 0) this.shake++;
      this.shake = -this.shake;
    };
    switch (this.phase) {
      case 'shadow':
        if (++this.t > BOULDER.shadow) {
          this.phase = 'fall';
          this.y = 0;
          this.speed = BOULDER.speed;
        }
        return null;
      case 'fall':
        if (this.y > BOULDER.land) {
          this.phase = 'main';
          this.damage = this.fall ? -1 : 5;
          return 'landed';
        }
        this.y += this.speed;
        this.speed += BOULDER.accel;
        return null;
      case 'main':
        if (this.damage > BOULDER.broken) {
          this.phase = 'collapse';
          this.t = 0;
          this.shake = 0;
          this.stage = 6;
          return 'collapsed';
        }
        shake();
        return null;
      case 'debris':
        if (++this.t === BOULDER.debris) this.phase = 'main';
        shake();
        return null;
      case 'collapse':
        this.t++;
        this.y++;
        if (this.t === BOULDER.collapse) this.phase = 'gone';
        return null;
      case 'gone':
        return null;
    }
  }
}

// ---------------------------------------------------------------- leaves

/** The leaf trap's 16 leaves, the flower trap's 32 petals; the ring of the last 40 blows. */
const LEAVES = { leaf: 16, flower: 32, ring: 40 };

export interface Leaf {
  x: number;
  y: number;
  angle: number;
  /** How many ticks late this leaf hears a blow (micBlowDelay: further from the centre, later). */
  delay: number;
}

/**
 * The leaf and flower traps (Traps_ProcessLeaves): leaves at random points; each tick's blow (the microphone's
 * |sample| / 25, or / 33 for the petals) joins a ring of 40, and each leaf hears it `delay` ticks later: a heard blow
 * pushes it straight out from the screen's centre by that much, silence sways it (its angle +0x400) and sets its
 * delay by its distance. A leaf off the screen is gone; won when all are.
 */
export class LeafGame {
  readonly leaves: (Leaf | null)[];
  private readonly ring = Array.from({ length: LEAVES.ring }, () => 0);
  private at = 0;

  constructor(private readonly flower: boolean, rand: Rand32) {
    this.leaves = Array.from({ length: flower ? LEAVES.flower : LEAVES.leaf }, () => ({ x: rand.next(W), y: rand.next(H), angle: rand.next(0xffff), delay: 0 }));
  }

  get won(): boolean {
    return this.leaves.every((l) => l === null);
  }

  /** One tick with the microphone's |sample| (0–127). */
  step(sample: number): void {
    this.ring[this.at] = Math.floor(sample / (this.flower ? 33 : 25));
    this.leaves.forEach((l, i) => {
      if (!l) return;
      if (l.x <= 0 || l.x >= W || l.y <= 0 || l.y >= H) {
        this.leaves[i] = null;
        return;
      }
      let k = this.at - l.delay;
      if (k < 0) k += LEAVES.ring;
      const blow = this.ring[k]!;
      const dx = l.x - W / 2;
      const dy = l.y - H / 2;
      const distance = Math.hypot(dx, dy);
      if (blow === 0) {
        l.delay = Math.floor((distance / 160) * (LEAVES.ring - 2));
        l.angle = (l.angle + 0x400) & 0xffff;
      } else if (dy === 0) l.x += dx < 0 ? -blow : blow;
      else if (dx === 0) l.y += dy < 0 ? -blow : blow;
      else {
        const angle = Math.atan2(dy, dx);
        l.y = H / 2 + Math.trunc(Math.sin(angle) * (distance + blow));
        l.x = W / 2 + Math.trunc(Math.cos(angle) * (distance + blow));
      }
    });
    this.at = (this.at + 1) % LEAVES.ring;
  }

  /** Traps_SwayLeaf: where a leaf is drawn (its point, swung by its angle). */
  static drawn(l: Leaf): { x: number; y: number } {
    return { x: Math.round(l.x + sinIdx(l.angle) * 4.5), y: Math.round(l.y + Math.abs(cosIdx(l.angle) * 2.5)) };
  }
}

// ---------------------------------------------------------------- the flame

/**
 * The ember and fire traps (Traps_ProcessFlame): the flame starts at 2 (ember) or 4 (fire); while the last ten samples
 * sum past 500 it burns down a step every ten ticks; once they do not, it is relit at full the next tick. Won at 0.
 */
export class FlameGame {
  intensity: number;
  /** Ticks blown hard since it was last lit (the flame flickers while > 0). */
  t = 0;
  private readonly samples = Array.from({ length: 10 }, () => 0);
  private at = 0;
  private lit = true;

  constructor(private readonly big: boolean) {
    this.intensity = big ? 4 : 2;
  }

  get won(): boolean {
    return this.intensity === 0;
  }

  /** One tick with the microphone's |sample|; whether it was blown hard enough (the hiss). */
  step(sample: number): boolean {
    if (!this.lit) {
      this.intensity = this.big ? 4 : 2;
      this.t = 0;
      this.lit = true;
    }
    this.at++;
    this.samples[this.at % 10] = sample;
    const hard = this.samples.reduce((n, s) => n + s, 0) > 500;
    if (hard) this.t++;
    else this.lit = false;
    if (this.t % 10 === 9) this.intensity--;
    return hard;
  }

  /** The flame's affine scale by intensity (fire 2, 1.5, 1, 0.5; ember 2, 1.5). */
  scale(): number {
    if (this.big) return ({ 4: 2, 3: 1.5, 2: 1 } as Record<number, number>)[this.intensity] ?? 0.5;
    return this.intensity === 2 ? 2 : 1.5;
  }
}
