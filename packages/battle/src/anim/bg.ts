/**
 * The battle screen's background layers during an animation (decomp battle_anim_system.c BattleBgSwitch,
 * palette.c PaletteData fades, screen_scroll_manager.c): the backdrop (BG3), a background switched in over
 * it (SwitchBg / RestoreBg, blended or faded through black or white), their palette fades, their scrolls
 * and HBlank waves, and grayscale. The palette fades share one fader, as the DS's BG palette buffer does: a
 * second fade started while one runs is ignored (PaletteData_StartFade).
 */
import type { AnimBgView } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { fxMul, sinIdx } from './fx.ts';
import { sideOf } from './tasks.ts';
import type { AnimVm } from './vm.ts';

type Palettes = 'base' | 'effect';

/** PaletteData_StartFade on the battle BG palettes: one fade at a time, steps of 2 (or more) every wait + 1 frames. */
export class PaletteFade {
  active = false;
  private cur = 0;
  private end = 0;
  private step = 2;
  private wait = 0;
  private waitStep = 0;
  private palettes: Palettes = 'base';
  /** The blend each palette set shows (it stays after its fade ends), 0–16 toward `color`. */
  readonly applied: Record<Palettes, { amount: number; color: number }> = { base: { amount: 0, color: 0 }, effect: { amount: 0, color: 0 } };

  start(palettes: Palettes, wait: number, from: number, to: number, color: number): void {
    if (this.active) return;
    const w = (wait << 24) >> 24;
    this.step = w < 0 ? 2 - w : 2;
    this.wait = w < 0 ? 0 : w;
    this.waitStep = this.wait;
    this.cur = from;
    this.end = to;
    this.palettes = palettes;
    this.applied[palettes].color = color;
    this.active = true;
    this.apply();
  }

  /** PaletteData_BlendMulti: a palette set blended at once. */
  set(palettes: Palettes, amount: number, color: number): void {
    this.applied[palettes] = { amount, color };
  }

  /** SysTask_FadePalette. */
  tick(): void {
    if (!this.active) return;
    if (this.waitStep < this.wait) {
      this.waitStep++;
      return;
    }
    this.waitStep = 0;
    this.apply();
  }

  private apply(): void {
    this.applied[this.palettes].amount = this.cur;
    if (this.cur === this.end) this.active = false;
    else if (this.cur < this.end) this.cur = Math.min(this.end, this.cur + this.step);
    else this.cur = Math.max(this.end, this.cur - this.step);
  }
}

/** BATTLE_ANIM_VAR_BG_*: script vars a switch reads. */
const VAR = { stepX: 0, stepY: 1, startX: 2, startY: 3, fadeType: 4, blendType: 5, animMode: 6, screenMode: 7 } as const;
/** BATTLE_BG_SWITCH_FLAG_* bits (of the param's high half) and the wave strips (decomp sBgWaveScrollSpeeds). */
const FLAG_MOVE = 0x02;
const FLAG_WAVE = 0x20;
const WAVE_SPEEDS = [32, 28, 24, 20, 16, 12, 8, 4, 4, 8, 12, 16, 20, 24, 28, 32];

interface Effect {
  bg: number;
  reversed: boolean;
}

export class BattleBg {
  readonly fade = new PaletteFade();
  /** BG offsets set by shakes (the layer the backdrop or a switched background is on). */
  offset = { x: 0, y: 0 };
  /** BATTLE_BG_SWITCH_STATE_*: 0 none, 1 running, 2 partial (faded out, the new background loading). */
  switchState = 0;
  effect: Effect | null = null;
  /** The switched background's weight against the backdrop, 0–1. */
  effectAlpha = 0;
  /** BattleBgAnim: the switched background's scroll (move) or wave. */
  private move: { x: number; y: number; stepX: number; stepY: number } | null = null;
  private wave: number[] | null = null;
  private waveSpeeds: number[] = [];
  /** ScrollSwitchedBg's sine scroll (ScreenScrollManager_ScrollX): its position, and whether it runs. */
  private sine: { pos: number } | null = null;
  grayscale = false;

  constructor(private readonly vm: AnimVm) {}

  /** BattleBgSwitch_ShouldBeReversed: by the attacker's and the defender's sides. */
  private reversed(mode: number): boolean {
    const atk = sideOf(this.vm.attacker);
    const def = sideOf(this.vm.defender);
    if (mode === 2) return atk === def ? def !== 'player' : def === 'player';
    return mode !== 0 && def === 'player';
  }

  /** SwitchBg (restore = RestoreBg) with its param: mode in the low half, flags in the high half. */
  start(bg: number, param: number, restore: boolean): void {
    const vars = [...this.vm.vars];
    const mode = param & 0xffff;
    const flags = param >>> 16;
    if (mode > 2) throw new Error(`battle anim: background switch mode ${mode}`);
    const blend = vars[VAR.blendType];
    const [a0, b0, ta, tb] = blend === 1 ? [0, 31, 15, 7] : blend === 2 ? [7, 15, 29, 2] : [0, 31, 29, 2];
    let a = a0;
    let b = b0;
    const color = vars[VAR.fadeType] === 1 ? 0x7fff : 0;
    let state = 0;
    this.switchState = 1;
    const applyFlags = () => {
      if (flags & FLAG_MOVE) {
        const rev = this.reversed(vars[VAR.animMode]!) ? -1 : 1;
        this.move = { x: vars[VAR.startX]! * rev, y: vars[VAR.startY]! * rev, stepX: vars[VAR.stepX]! * rev, stepY: vars[VAR.stepY]! * rev };
      }
      if (flags & FLAG_WAVE) {
        const rev = this.reversed(vars[VAR.animMode]!) ? -1 : 1;
        this.wave = WAVE_SPEEDS.map(() => 0);
        this.waveSpeeds = WAVE_SPEEDS.map((s) => s * rev);
      }
    };
    const load = () => {
      this.effect = { bg, reversed: this.reversed(vars[VAR.screenMode]!) };
      this.fade.set('effect', 0, 0);
    };
    const step = (): boolean => {
      let done = 0;
      if (a < ta) a += 2;
      else done++;
      if (b > tb) b -= 2;
      else done++;
      return done === 2;
    };
    const weight = (v: number) => Math.min(16, v) / 16;
    const fn = (): boolean => {
      if (mode === 2) {
        applyFlags();
        if (restore) this.move = null;
        return false;
      }
      if (mode === 0 && !restore) {
        if (state === 0) {
          state = 1;
          return true;
        }
        if (state === 1) {
          load();
          applyFlags();
          state = 2;
        }
        if (step()) {
          a = ta;
          b = tb;
          state = 3;
        }
        this.effectAlpha = weight(a) / (weight(a) + weight(b));
        return state === 2;
      }
      if (mode === 0 && restore) {
        if (state <= 1) {
          applyFlags();
          state = 2;
        }
        if (state === 2) {
          if (step()) {
            a = ta + 2;
            b = tb - 2;
            state = 3;
          }
          this.effectAlpha = weight(b) / (weight(a) + weight(b) || 1);
          return true;
        }
        if (state === 3) {
          this.move = null;
          this.wave = null;
          this.effect = null;
          this.offset = { x: 0, y: 0 };
          state = 4;
          return true;
        }
        if (state === 4) {
          state = 5;
          return true;
        }
        return false;
      }
      if (!restore) {
        // Fade: the backdrop fades out, the new background fades in from the same colour.
        if (state === 0) {
          this.fade.start('base', 0, 0, 16, color);
          this.fade.set('effect', 16, color);
          state = 1;
        }
        if (state === 1) {
          if (this.fade.active) return true;
          load();
          this.effectAlpha = 1;
          this.fade.set('effect', 16, color);
          this.fade.start('effect', 0, 16, 0, color);
          applyFlags();
          this.switchState = 2;
          state = 2;
          return true;
        }
        return this.fade.active;
      }
      if (state === 0) {
        applyFlags();
        this.fade.start('effect', 0, 0, 16, color);
        this.fade.set('base', 16, color);
        state = 1;
      }
      if (state === 1) {
        if (this.fade.active) return true;
        this.move = null;
        this.wave = null;
        this.effect = null;
        this.offset = { x: 0, y: 0 };
        this.fade.start('base', 0, 16, 0, color);
        state = 2;
      }
      if (this.fade.active) return true;
      this.switchState = 2;
      return false;
    };
    this.vm.tasks.push({
      kind: 'bg',
      step: () => {
        const on = fn();
        if (!on) this.switchState = 0;
        return on;
      },
    });
  }

  /** SetBgSwitchVar: the running move scroll's steps and start (the decomp sets X for "start Y", kept). */
  setVar(v: number, value: number): void {
    const m = this.move;
    if (!m) return;
    const s = (value << 16) >> 16;
    if (v === VAR.stepX) m.stepX = s;
    else if (v === VAR.stepY) m.stepY = s;
    else if (v === VAR.startX || v === VAR.startY) m.x = s;
  }

  /** ScrollSwitchedBg: a sine wave across rows 0–160 of the switched layer (1° a row, 32 px, 2 rows a frame) for `frames`. */
  startSine(frames: number): void {
    let timer = 0;
    let started = false;
    this.vm.tasks.push({
      kind: 'anim',
      step: () => {
        if (!started) {
          started = true;
          this.sine = { pos: 0 };
          return true;
        }
        if (++timer < frames) return true;
        this.sine = null;
        return false;
      },
    });
  }

  /** Per frame, after the animation tasks (the BG scroll tasks): the move scroll, the wave strips, the sine scroll. */
  scroll(): void {
    if (this.move) {
      this.move.x += this.move.stepX;
      this.move.y += this.move.stepY;
    }
    if (this.wave) this.wave = this.wave.map((v, i) => v + this.waveSpeeds[i]!);
    if (this.sine) this.sine.pos = (this.sine.pos + 200) % (192 * 100);
  }

  view(sheets: Id[]): AnimBgView {
    const base = this.fade.applied.base;
    const eff = this.fade.applied.effect;
    let rows: number[] | null = null;
    if (this.wave) {
      rows = new Array(192).fill(0);
      this.wave.forEach((v, i) => {
        for (let y = i * 8; y < i * 8 + 8; y++) rows![y] = v;
      });
    }
    if (this.sine) {
      rows ??= new Array(192).fill(0);
      const start = Math.floor(this.sine.pos / 100);
      for (let y = 0; y <= 160; y++) rows[y]! += fxMul(sinIdx(((start + y) % 192) * 182), 32 * 4096) >> 12;
    }
    const e = this.effect;
    const sheet = e ? sheets[e.bg] : undefined;
    if (e && !sheet) throw new Error(`battle anim: no switched background ${e.bg} in the packs`);
    return {
      fade: base.amount ? { ...base } : null,
      dx: this.offset.x,
      dy: this.offset.y,
      effect:
        e && sheet
          ? { sheet, cell: this.vm.contest ? 2 : e.reversed ? 1 : 0, alpha: this.effectAlpha, dx: this.offset.x + (this.move?.x ?? 0), dy: this.offset.y + (this.move?.y ?? 0), fade: eff.amount ? { ...eff } : null, rows }
          : null,
      grayscale: this.grayscale,
    };
  }
}
