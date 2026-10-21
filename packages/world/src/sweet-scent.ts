/**
 * Sweet Scent and Honey in the field (decomp overlay005/ov5_021F101C.c: the party move's HM cut-in, then
 * ov5_021F007C.c ov5_021F0488, the task Honey starts from the bag), one state step per 30 Hz tick:
 *
 * - weather that stops the scent (ov5_021F0438's list) waits 20 frames, then COMMON_SCRIPTS 29 ("nothing");
 * - else the pink (GX_RGB(31, 10, 23)) BG2 blends in from 0 to 10/16 over 20 frames with SEQ_SE_DP_FW230
 *   (ov5_021F013C, ov5_021F01C0), holds for 23 frames, then on an encounter tile of a zone with encounters a wild
 *   battle starts (WildEncounters_TrySweetScentEncounter); otherwise it blends out over 16 frames and COMMON_SCRIPTS 28
 *   ("faded") runs.
 *
 * The DS's palette-blend variant in weather 23 and the palette mask in weather 8 change only how the pink is drawn.
 */
import type { HmCutIn } from './hm-cut-in.ts';

/** ov5_021F0438: the weathers (`sourceIndex`) in which the scent does nothing. */
export const SWEET_SCENT_BLOCKED_WEATHERS = new Set([2, 3, 4, 5, 6, 7, 10, 21, 22, 14, 15, 16, 1, 9, 13, 17, 24, 25]);
/** ov5_021F0260's colour and the blend's top (ev1 out of 16). */
export const SWEET_SCENT_COLOR: [number, number, number] = [31 / 31, 10 / 31, 23 / 31];
const BLEND_MAX = 10;
const IN_STEPS = 19;
const OUT_STEPS = 15;
const HOLD = 22;
const FAIL_WAIT = 20;

export interface SweetScentHost {
  /** The party move's cut-in; null for Honey. */
  cutIn: HmCutIn | null;
  blocked(): boolean;
  /** MapHeader_HasWildEncounters. */
  zoneEncounters(): boolean;
  /** WildEncounters_TileHasEncounterRate under the player. */
  tileRate(): boolean;
  playSe(): void;
}

export type SweetScentEnd = 'encounter' | 'faded' | 'nothing';

export class SweetScentTask {
  private phase: 'cut-in' | 'check' | 'in' | 'hold' | 'out' | 'fail' = 'cut-in';
  /** ov5_021F02B8's interpolation: from, span, steps, step. */
  private blend = { from: 0, span: 0, steps: 1, at: 0, value: 0 };
  private wait = 0;

  constructor(private readonly h: SweetScentHost) {
    if (!h.cutIn) this.phase = 'check';
  }

  /** The pink's alpha now (0 when none). */
  alpha(): number {
    return this.phase === 'in' || this.phase === 'hold' || this.phase === 'out' ? this.blend.value / 16 : 0;
  }

  /** One tick; the outcome once the task ends. */
  step(): SweetScentEnd | null {
    switch (this.phase) {
      case 'cut-in':
        if (this.h.cutIn!.step()) this.phase = 'check';
        return null;
      case 'check':
        if (this.h.blocked()) {
          this.phase = 'fail';
          this.wait = FAIL_WAIT;
          return null;
        }
        this.start(0, BLEND_MAX, IN_STEPS);
        this.h.playSe();
        this.phase = 'in';
        return null;
      case 'in':
        if (this.advance()) {
          this.wait = HOLD;
          this.phase = 'hold';
        }
        return null;
      case 'hold':
        this.wait--;
        if (this.h.zoneEncounters() && this.wait >= 0) return null;
        if (this.h.zoneEncounters() && this.h.tileRate()) return 'encounter';
        this.start(BLEND_MAX, 0, OUT_STEPS);
        this.phase = 'out';
        return null;
      case 'out':
        return this.advance() ? 'faded' : null;
      case 'fail':
        return --this.wait < 0 ? 'nothing' : null;
    }
  }

  private start(from: number, to: number, steps: number): void {
    this.blend = { from, span: to - from, steps, at: 0, value: from };
  }

  /** ov5_021F02C8: the value at this step; true once the last step is reached. */
  private advance(): boolean {
    const b = this.blend;
    b.value = Math.trunc((b.span * b.at) / b.steps) + b.from;
    if (b.at + 1 <= b.steps) {
      b.at++;
      return false;
    }
    b.at = b.steps;
    return true;
  }
}
