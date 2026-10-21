/**
 * The healing machines (decomp overlay006/healing_machine_animation/pokecenter.c and hall_of_fame.c,
 * FieldTask_PlayHealingAnimation_*), one task state per 30 Hz tick:
 *   START (1) → per ball: ADD_POKEBALL (1) + WAIT_FOR_POKEBALL (15 counted + 1 advancing = 16)
 *   → PLAY_FINAL_ANIMATION (1) → WAIT_FOR_FINAL_ANIMATION → CLEAN_UP (1).
 * The Pokémon Center's plays SEQ_SE_DP_BOWA as each ball goes down and SEQ_ASA (the heal jingle) with the
 * balls' and the screen's one-shots, and waits for both one-shots, then for the jingle (Sound_IsBGMPausedByFanfare,
 * checked only once the one-shots are done). The Hall of Fame's has no sounds and waits for the balls' one-shot.
 */
export const BALL_TICKS = 17;
/** The final wait without imported one-shots (a pack without `NewGame.healMachine`). */
export const FINAL_TICKS = 45;
/** Decomp HEALING_MACHINE_ANIMATION_POKEBALL_MAX_TICKS. */
const POKEBALL_MAX_TICKS = 15;
/** Decomp MAX_PARTY_SIZE offsets: top/middle/bottom × left/right. */
export const MAX_BALLS = 6;

/** The Pokémon Center machine's sounds. */
export interface HealMachineSound {
  /** Sound_PlayEffect(SEQ_SE_DP_BOWA): a ball goes down. */
  ball(): void;
  /** Sound_PlayFanfare(SEQ_ASA). */
  fanfare(): void;
  /** Sound_IsBGMPausedByFanfare (each call counts one check). */
  fanfareWaiting(): boolean;
}

type State = 'start' | 'add' | 'wait-ball' | 'final' | 'wait-final' | 'clean-up';

export class HealMachine {
  private state: State = 'start';
  private placed = 0;
  private ballTicks = 0;
  /** Ticks since the final one-shots started (−1 before). */
  private frame = -1;

  /**
   * `final`: the one-shots' length (the longest clip; FINAL_TICKS without them). `pattern`: the view exposes
   * the one-shots' frame. `sound`: the Pokémon Center's sounds (none for the Hall of Fame).
   */
  constructor(
    readonly balls: number,
    private readonly final = FINAL_TICKS,
    private readonly pattern = false,
    private readonly sound?: HealMachineSound,
  ) {
    if (!Number.isInteger(balls) || balls < 1 || balls > MAX_BALLS) throw new Error(`world: healing machine with ${balls} balls (1–${MAX_BALLS})`);
  }

  /** One tick; true once the task has finished. */
  step(): boolean {
    if (this.frame >= 0) this.frame++;
    switch (this.state) {
      case 'start':
        this.state = 'add';
        return false;
      case 'add':
        this.sound?.ball();
        this.placed++;
        this.state = 'wait-ball';
        return false;
      case 'wait-ball':
        if (this.ballTicks < POKEBALL_MAX_TICKS) {
          this.ballTicks++;
          return false;
        }
        this.ballTicks = 0;
        this.state = this.placed < this.balls ? 'add' : 'final';
        return false;
      case 'final':
        this.frame = 0;
        this.sound?.fanfare();
        this.state = 'wait-final';
        return false;
      case 'wait-final':
        // The one-shots first; the fanfare is only checked once they are done (the decomp's && order).
        if (this.frame >= this.final && !this.sound?.fanfareWaiting()) this.state = 'clean-up';
        return false;
      case 'clean-up':
        return true;
    }
  }

  /** Balls placed so far, whether the final one-shots play and, with `pattern`, their frame since they started. */
  view(): { balls: number; flash: boolean; frame?: number } {
    const flash = this.frame >= 0;
    return { balls: this.placed, flash, ...(this.pattern && flash ? { frame: this.frame } : {}) };
  }
}
