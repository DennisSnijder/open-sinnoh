import type { FieldSound } from './sound.ts';
import type { Actor } from './npc.ts';

/**
 * Field tasks a script waits on that only move sprites (decomp src/unk_0205DFC4.c, src/overlay006/
 * elevator_animation.c). Nothing here touches simulation state.
 */

/**
 * shake_object (MapObject_Shake → Task_ShakeMapObject): each frame the sprite is offset by
 * sin(degrees) × x/z units, then degrees += speed; at 360 it restarts and `times` counts down; at 0 the
 * offset clears and the task ends.
 */
export class ShakeTask {
  private degrees = 0;
  constructor(
    readonly actor: Actor,
    private times: number,
    private readonly speed: number,
    private readonly x: number,
    private readonly z: number,
  ) {}

  /** One frame; true when the task has ended. */
  step(): boolean {
    const s = Math.sin((this.degrees * Math.PI) / 180);
    this.actor.offset = [s * this.x, 0, s * this.z];
    this.degrees += this.speed;
    if (this.degrees >= 360) {
      this.degrees = 0;
      this.times--;
    }
    if (this.times > 0) return false;
    this.actor.offset = [0, 0, 0];
    return true;
  }
}

/**
 * The elevator lights' one-shot animations (build model 498 `elevator_lights`, bm_anime 35 `ev_o01_up` and
 * 36 `ev_o01_down`, BTA0 of 31 frames each).
 */
export const ELEVATOR_LOOP_TICKS = 31;
/** FieldTask_PlayElevatorAnimation: a frame to load the animations and one to start them. */
export const ELEVATOR_START_TICKS = 2;

/**
 * play_elevator_animation (FieldTask_PlayElevatorAnimation): the lights play `loops` times, then the
 * arrival chime. The chime is a cue only (sound never alters timing), so the task ends with the last loop.
 */
export function elevatorTicks(loops: number): number {
  if (loops < 1) throw new Error(`world: elevator with ${loops} loops (decomp asserts at least 1)`);
  return ELEVATOR_START_TICKS + loops * ELEVATOR_LOOP_TICKS;
}

/**
 * The elevator ride task: loads the lights' animations (ELEVATOR_START_TICKS), then plays the
 * direction's one `loops` times (MapPropOneShotAnimationManager_PlayAnimation); unloading puts the
 * lights back at rest.
 */
export class ElevatorRide {
  private elapsed = 0;
  private readonly ticks: number;
  constructor(
    private readonly direction: 'up' | 'down',
    loops: number,
    private readonly sound: FieldSound,
  ) {
    this.ticks = elevatorTicks(loops);
  }

  /** One frame; true when the task has ended. The motor and chime are cues only: the ride's length never waits on audio. */
  step(): boolean {
    this.elapsed++;
    if (this.elapsed === ELEVATOR_START_TICKS) this.sound.play(1554);
    if (this.elapsed === this.ticks) {
      this.sound.stop(1554);
      this.sound.play(1521);
    }
    return this.elapsed >= this.ticks;
  }

  /** `FieldView.elevatorLights`: the playing animation and its frame count since it started, or null while loading. */
  view(): { direction: 'up' | 'down'; tick: number } | null {
    return this.elapsed < ELEVATOR_START_TICKS ? null : { direction: this.direction, tick: this.elapsed - ELEVATOR_START_TICKS };
  }
}
