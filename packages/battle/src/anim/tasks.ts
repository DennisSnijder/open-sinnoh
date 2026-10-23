/**
 * The decomp's animation helpers (battle_anim_helpers.c XYTransformContext, ValueLerpContext, ShakeContext,
 * BattleAnimUtil_GetBattlerSprites …) for the native functions: fixed-point lerps, revolutions and shakes
 * stepped once per frame.
 */
import { cosIdx, fxDiv, fxMul, idiv, sinIdx } from './fx.ts';
import type { AnimVm, MonSprite, Side } from './vm.ts';

export type Func = (vm: AnimVm) => void;

/** BATTLE_ANIM_* target bits. */
export const ATTACKER = 1 << 1;
export const ATTACKER_PARTNER = 1 << 2;
export const DEFENDER = 1 << 3;
export const DEFENDER_PARTNER = 1 << 4;
export const NOT_ATTACKER = 1 << 5;
export const ALL_BATTLERS = 1 << 6;
export const BATTLER_SPRITES = 1 << 8;
export const POKEMON_SPRITES = 1 << 9;
export const BACKGROUND = 1 << 10;
export const SPECIFIC = 1 << 11;
/** BATTLE_PARTICLE_PIXEL_FACTOR (BATTLE_PARTICLE_SCREEN_TO_WORLD and back). */
export const PIXEL = 172;

/**
 * BattleAnimUtil_GetBattlerSprites. Singles: a battler's "partner" is itself, as the decomp's GetAlliedBattler has it
 * (all battlers: the attacker twice and the defender twice). Doubles: every battler present, in the decomp's order
 * (the attacker, its ally, the one facing it, that one's ally; without the attacker for NOT_ATTACKER), or the
 * attacker, its partner, the defender and its partner as the bits ask.
 */
export function battlerSprites(vm: AnimVm, targets: number): MonSprite[] {
  const atk = vm.sprite(vm.attacker);
  const def = vm.sprite(vm.defender);
  if (!vm.doubles) {
    if (targets & ALL_BATTLERS) return [atk, atk, def, def];
    if (targets & NOT_ATTACKER) return [def, def];
    const out: MonSprite[] = [];
    if (targets & ATTACKER) out.push(atk);
    if (targets & DEFENDER) out.push(def);
    return out;
  }
  const present = (b: number) => vm.deps.battlers[b] !== null;
  const facing = vm.attacker ^ 1;
  let ids: number[];
  if (targets & ALL_BATTLERS) ids = [vm.attacker, vm.ally(vm.attacker), facing, vm.ally(facing)];
  else if (targets & NOT_ATTACKER) ids = [vm.ally(vm.attacker), facing, vm.ally(facing)].filter((b) => b !== vm.attacker);
  else {
    ids = [];
    if (targets & ATTACKER) ids.push(vm.attacker);
    if (targets & ATTACKER_PARTNER) ids.push(vm.ally(vm.attacker));
    if (targets & DEFENDER) ids.push(vm.defender);
    if (targets & DEFENDER_PARTNER) ids.push(vm.ally(vm.defender));
  }
  return ids.filter(present).map((b) => vm.sprite(b));
}

/**
 * A single battler from a BATTLE_ANIM_* target: the attacker, the defender, in doubles their partners; with
 * SPECIFIC a slot (player 1, player 2, enemy 1, enemy 2; in singles the partners' slots are none: null).
 */
export function battler(vm: AnimVm, target: number): MonSprite | null {
  if (target & SPECIFIC) {
    if (target & ATTACKER) return vm.sprite(0);
    if (target & DEFENDER) return vm.sprite(1);
    if (vm.doubles && target & ATTACKER_PARTNER) return vm.sprite(2);
    if (vm.doubles && target & DEFENDER_PARTNER) return vm.sprite(3);
    return null;
  }
  if (target & ATTACKER) return vm.sprite(vm.attacker);
  if (target & DEFENDER) return vm.sprite(vm.defender);
  if (vm.doubles && target & ATTACKER_PARTNER) return vm.sprite(vm.ally(vm.attacker));
  if (vm.doubles && target & DEFENDER_PARTNER) return vm.sprite(vm.ally(vm.defender));
  return null;
}

/** BattleAnimUtil_GetTransformDirectionX: −1 for a battler on the enemy's side; in a contest for the player's (the performer faces left). */
export const dirX = (vm: AnimVm, battler: number) => ((battler & 1) === (vm.contest ? 0 : 1) ? -1 : 1);

/** A battler's side: the player's (even ids) or the enemy's (odd). */
export const sideOf = (battler: number): Side => (battler & 1 ? 'enemy' : 'player');

/** XYTransformContext PosLerp (fx32 steps, integer output). */
export class PosLerp {
  x: number;
  y: number;
  private cx: number;
  private cy: number;
  private readonly sx: number;
  private readonly sy: number;
  constructor(
    x0: number,
    x1: number,
    y0: number,
    y1: number,
    private steps: number,
  ) {
    this.x = x0;
    this.y = y0;
    this.cx = x0 * 4096;
    this.cy = y0 * 4096;
    this.sx = steps ? fxDiv(x1 * 4096 - x0 * 4096, steps * 4096) : 0;
    this.sy = steps ? fxDiv(y1 * 4096 - y0 * 4096, steps * 4096) : 0;
  }
  update(): boolean {
    if (!this.steps) return false;
    this.cx += this.sx;
    this.cy += this.sy;
    this.x = this.cx >> 12;
    this.y = this.cy >> 12;
    this.steps--;
    return true;
  }
}

/** RevolutionContext: sin/cos offsets of two angles stepping toward their ends. */
export class Revolution {
  x = 0;
  y = 0;
  private ax: number;
  private ay: number;
  private readonly stepX: number;
  private readonly stepY: number;
  private steps: number;
  constructor(
    sx: number,
    ex: number,
    sy: number,
    ey: number,
    /** Radii in fx32 (callers may scale or flip them before the first update). */
    public rx: number,
    public ry: number,
    steps: number,
    /** RevolutionContext_InitOvalRevolutions multiplies the step count (whole turns). */
    turns = 1,
  ) {
    this.ax = sx & 0xffff;
    this.ay = sy & 0xffff;
    this.stepX = idiv(ex - sx, steps);
    this.stepY = idiv(ey - sy, steps);
    this.steps = steps * turns;
  }
  update(): boolean {
    if (!this.steps) return false;
    this.ax = (this.ax + this.stepX) & 0xffff;
    this.ay = (this.ay + this.stepY) & 0xffff;
    this.steps--;
    this.x = fxMul(sinIdx(this.ax), this.rx) >> 12;
    this.y = fxMul(cosIdx(this.ay), this.ry) >> 12;
    return true;
  }
}

export class Shake {
  x = 0;
  y = 0;
  private counter: number;
  private cycle = 0;
  private prevX: number;
  private prevY: number;
  constructor(
    ex: number,
    ey: number,
    private readonly interval: number,
    private remaining: number,
  ) {
    this.counter = interval;
    this.prevX = -ex;
    this.prevY = -ey;
  }
  update(): boolean {
    if (!this.remaining) return false;
    if (++this.counter >= this.interval) {
      this.counter = 0;
      const px = this.prevX;
      this.prevX = this.x;
      this.x = px === 0 ? 0 : -px;
      const py = this.prevY;
      this.prevY = this.y;
      this.y = py === 0 ? 0 : -py;
      if (++this.cycle >= 4) {
        this.cycle = 0;
        this.remaining--;
      }
    }
    return true;
  }
}

/** ScaleLerpContext_InitXY / UpdateXY: scales relative to `ref` percent, 0x100 = 100 %. */
export class ScaleLerp {
  x: number;
  y: number;
  cy: number;
  private cx: number;
  private readonly stepX: number;
  private readonly stepY: number;
  constructor(
    sx: number,
    ex: number,
    sy: number,
    ey: number,
    ref: number,
    private steps: number,
  ) {
    const rel = (s: number) => idiv(s * 256, ref);
    this.stepX = steps ? fxDiv(rel(ex) * 4096 - rel(sx) * 4096, steps * 4096) : 0;
    this.stepY = steps ? fxDiv(rel(ey) * 4096 - rel(sy) * 4096, steps * 4096) : 0;
    this.x = rel(sx);
    this.y = rel(sy);
    this.cx = this.x * 4096;
    this.cy = this.y * 4096;
  }
  /** ScaleLerpContext_Update: the X step on both axes (the decomp's first scaling frame uses it). */
  updateUniform(): boolean {
    if (!this.steps) return false;
    this.steps--;
    this.cx += this.stepX;
    this.cy += this.stepX;
    this.x = this.cx >> 12;
    this.y = this.cy >> 12;
    return true;
  }
  update(): boolean {
    if (!this.steps) return false;
    this.steps--;
    this.cx += this.stepX;
    this.cy += this.stepY;
    this.x = this.cx >> 12;
    this.y = this.cy >> 12;
    return true;
  }
}

/** BattleAnimUtil_GetGroundAnchoredScaleOffset: keeps a scaled sprite's feet on the ground (`scaleY` fx32: 0x100 << 12 = 100 %, a ScaleLerp's `cy`). */
export function anchoredOffset(height: number, scaleY: number): number {
  const avail = (80 - height * 2) * 4096;
  const scaled = fxDiv(fxMul(avail, scaleY), 256 * 4096);
  let diff = avail - scaled;
  const frac = diff % 4096;
  let int = diff - frac;
  if (int) int += 2048;
  diff = frac + int;
  return idiv(diff >> 12, 2);
}

export const task = (vm: AnimVm, step: () => boolean, now = false): void => {
  const t = { kind: 'anim' as const, step };
  vm.tasks.push(t);
  if (now) step();
};

/** ValueLerpContext: an integer value stepping by a truncated step (Init), or through fx32 (InitFX32). */
export class ValueLerp {
  value: number;
  private cur: number;
  private step: number;
  constructor(
    start: number,
    end: number,
    private steps: number,
    fx = false,
  ) {
    this.value = start;
    this.cur = start * 4096;
    const st = steps ? fxDiv(end * 4096 - start * 4096, steps * 4096) : 0;
    this.fx = fx;
    this.step = fx ? st : st >> 12;
  }
  private readonly fx: boolean;
  /** Flips the step (the decomp negates data[1] for the enemy's side). */
  negate(): void {
    this.step = -this.step;
  }
  update(): boolean {
    if (!this.steps) return false;
    if (this.fx) {
      this.cur += this.step;
      this.value = this.cur >> 12;
    } else this.value += this.step;
    this.steps--;
    return true;
  }
}

/** RevolutionContext_InitOvalRevolutions: `revs` turns of a 32 × −8 px oval, `steps` frames a turn. */
export function ovalRevolution(revs: number, steps: number, rx = 32 * 4096, ry = -8 * 4096): Revolution {
  return new Revolution(0, 0xffff, 0, 0xffff, rx, ry, steps, revs);
}
