/**
 * Teleport (decomp field_move_tasks.c FieldMoves_TeleportTask, overlay006/field_warp.c sDigTeleportStates and
 * sFieldWarpFadeInStates, field_map_change.c FieldTask_MapChangeByFieldWarp), one state step per 30 Hz tick:
 *
 * - the HM cut-in (hm-cut-in.ts), then the warp-out spin: the camera closes in 150 units over 15 frames
 *   (ov5_021F0EB0), the player turns through sFadeOutWarpAnimation (SEQ_SE_DP_TELE), then sWarpFastSpinningAnimation
 *   again and again; at its eighth start the screen fades to black (6 steps), and the map changes once it has;
 * - the map change as a field warp's (on foot, a warp's game data, FieldSystem_SetTeleportFlags), to the fly
 *   position of the blackout spawn, facing down;
 * - the warp-in: the fade from black with the camera 150 units in at once, fast spins until it has faded in, the
 *   camera easing back over 60 frames, four more fast spins, sFadeInWarpAnimation, then the end once the camera is back.
 *
 * A movement animation's step (a face or a one-frame delay) takes one tick, and its end is seen on the tick after.
 */
import type { Facing } from '@opensinnoh/contracts';
import { CameraZoom, FX } from './fly.ts';
import { HmCutIn } from './hm-cut-in.ts';

type Step = Facing | number;
/** sWarpFastSpinningAnimation. */
const FAST: Step[] = ['up', 'right', 'down', 'left'];
/** sFadeOutWarpAnimation (numbers are MOVEMENT_ACTION_DELAY_1 counts). */
const OUT: Step[] = ['down', 2, 'left', 2, 'up', 2, 'right', 2, 'down', 1, 'left', 1, 'up', 1, 'right', 1, 'down', 'left', 'up', 'right', 'down', 'left', 'up', 'right'];
/** sFadeInWarpAnimation. */
const IN: Step[] = ['down', 'left', 'up', 'right', 'down', 'left', 'up', 'right', 'down', 1, 'left', 1, 'up', 1, 'right', 1, 'down', 2, 'left', 3, 'up', 4, 'right', 5, 'down'];
const FADE_TICKS = 6;
const MAP_CHANGE_AT = 3;
const FADE_IN_AT = 6;

/** A MapObject animation: one tick per face, `n` ticks per delay; `ended` from the tick after its last step. */
class Spin {
  private ticks: (Facing | null)[];
  private at = 0;
  constructor(steps: Step[]) {
    this.ticks = steps.flatMap((s) => (typeof s === 'number' ? Array<null>(s).fill(null) : [s]));
  }
  /** The facing this tick sets, if any. */
  tick(): Facing | null {
    return this.at < this.ticks.length ? this.ticks[this.at++]! : (this.at++, null);
  }
  get ended(): boolean {
    return this.at > this.ticks.length;
  }
}

export interface TeleportHost {
  cutIn: HmCutIn;
  se(name: string): void;
  fade(kind: 'in' | 'out'): void;
  fadeDone(): boolean;
  face(facing: Facing): void;
  /** The field warp's map change (on foot, a warp's game data, FieldSystem_SetTeleportFlags). */
  changeMap(): void;
}

export class TeleportTask {
  private phase: 'cut-in' | 'out-start' | 'out-spin' | 'out-fade' | 'map' | 'in-start' | 'in-fade' | 'in-slow' | 'in-end' = 'cut-in';
  private spin: Spin | null = null;
  private delay = 0;
  private gap = 0;
  readonly zoom = new CameraZoom();
  private zoomActive = false;
  done = false;

  constructor(private readonly h: TeleportHost) {}

  private runSpin(): void {
    const f = this.spin?.tick();
    if (f) this.h.face(f);
  }

  tick(): void {
    if (this.zoomActive) this.zoom.tick();
    switch (this.phase) {
      case 'cut-in':
        if (this.h.cutIn.step()) this.phase = 'out-start';
        return;
      case 'out-start': // StartWarpOutSpinning
        this.zoom.set(1, -150 * FX, 15);
        this.zoomActive = true;
        this.spin = new Spin(OUT);
        this.h.se('SEQ_SE_DP_TELE');
        this.runSpin();
        this.phase = 'out-spin';
        return;
      case 'out-spin': // StartFadeOut
        if (this.spin!.ended) {
          this.spin = new Spin(FAST);
          if (++this.delay >= 8) {
            this.h.fade('out');
            this.phase = 'out-fade';
          }
        }
        this.runSpin();
        return;
      case 'out-fade': // FinishFadeOut
        if (this.spin!.ended) this.spin = new Spin(FAST);
        this.runSpin();
        if (!this.h.fadeDone()) return;
        this.spin = null;
        this.zoomActive = false;
        this.phase = 'map';
        return;
      case 'map': // ChangeMap → FieldTask_MapChangeByFieldWarp, then FieldTask_FadeInFieldWarp
        this.gap++;
        if (this.gap === MAP_CHANGE_AT) {
          this.h.changeMap();
          this.zoom.offset = 0;
        }
        if (this.gap === FADE_IN_AT) this.phase = 'in-start';
        return;
      case 'in-start': // StartFadeIn
        this.h.fade('in');
        this.zoom.set(1, -150 * FX, 1);
        this.zoomActive = true;
        this.spin = new Spin(FAST);
        this.runSpin();
        this.phase = 'in-fade';
        return;
      case 'in-fade': // FinishFadeIn
        if (this.spin!.ended) this.spin = new Spin(FAST);
        this.runSpin();
        if (!this.h.fadeDone()) return;
        this.zoom.set(2, 0, 60);
        this.delay = 0;
        this.phase = 'in-slow';
        return;
      case 'in-slow': // SlowDownWarpInSpinning
        if (this.spin!.ended) {
          this.spin = new Spin(++this.delay < 4 ? FAST : IN);
          if (this.delay >= 4) this.phase = 'in-end';
        }
        this.runSpin();
        return;
      case 'in-end': // FinishWarpInAnimation
        this.runSpin();
        if (this.spin!.ended && this.zoom.done) {
          this.spin = null;
          this.done = true;
        }
        return;
    }
  }

  /** The camera zoom's distance (world units). */
  cameraDistance(): number {
    return this.zoom.offset / FX;
  }
}

export const TELEPORT_FADE_TICKS = FADE_TICKS;
