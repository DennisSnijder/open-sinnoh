/**
 * The Vs. Seeker's field task (decomp src/overlay005/vs_seeker.c VsSeeker_Start, VsSeeker_ExecuteTask), started by
 * `start_vs_seeker` from the item's script (scripts_vs_seeker.s). One state runs per frame:
 * - the map's objects finish their step and pause;
 * - the trainers in range are collected (7 tiles left, right and up, 6 down; not disguised); a battery short of 100 or no
 *   trainer ends the task with its result;
 * - otherwise the player raises the Vs. Seeker (PLAYER_AVATAR_VS_SEEKER, walking only), the beep plays and the battery
 *   empties; each trainer in range not yet beaten shows '!'; each beaten one has a 50% chance (a roll per trainer, even
 *   for one spinning already) to turn south, show '!!' and spin (MOVEMENT_TYPE_VS_SEEKER_SPIN), with its double-battle
 *   partner anywhere on the map; a rematch sets FLAG_VS_SEEKER_USED;
 * - once the emotes end and the beep is over, the player's walking avatar is back.
 * Independent implementation.
 */
import { FIELD_VARS, nextFieldRandom, readSystemVar, SEEKER_SPIN, SEEKER_USED, systemFlag, trainerDefeated, writeSystemVar } from '@opensinnoh/core';
import type { GameState, Registries } from '@opensinnoh/contracts';
import type { Actor } from './npc.ts';

/** VS_SEEKER_USE_RESULT_* (constants/vs_seeker.h). */
export const VS_SEEKER_RESULT = { ok: 0, noBattery: 1, noTrainers: 2, noTrainersPicked: 3 } as const;
/** SE_DP_VS_SEEKER_BEEP.sseq: SEQ_SE_DP_UG_005. */
export const SE_VS_SEEKER = 1568;
const MAX_BATTERY = 100;
const REMATCH_CHANCE = 50;
const RADIUS = { left: 7, right: 7, up: 7, down: 6 } as const;
/** TRAINER_TYPE_NORMAL, _VIEW_ALL_DIRECTIONS, _FACE_SIDES, _FACE_COUNTERCLOCKWISE, _FACE_CLOCKWISE, _SPIN_*. */
const TRAINER_TYPES: readonly number[] = [1, 2, 4, 5, 6, 7, 8];
/** MOVEMENT_TYPE_DISGUISE_SNOW, _SAND, _ROCK, _GRASS (VsSeeker_IsMoveCodeHidden). */
const DISGUISES: readonly number[] = [51, 52, 53, 54];
const SINGLE = [{ op: 'emote_exclamation_mark', count: 1 }];
const DOUBLE = [{ op: 'face_south', count: 1 }, { op: 'emote_double_exclamation_mark', count: 1 }];

export interface VsSeekerHost {
  readonly reg: Registries;
  readonly state: GameState;
  /** The map's own objects (MapObjMan_LocalMapObjByIndex). */
  objects(): Actor[];
  /** MapObject_SetPauseMovementOn / Off. */
  pause(a: Actor, paused: boolean): void;
  /** MapObject_StartAnimation with a movement list, and whether it has ended. */
  animate(a: Actor, steps: { op: string; count: number }[]): void;
  animationDone(a: Actor): boolean;
  switchMovementType(a: Actor, movementType: number): void;
  /** FieldSystem_StartVsSeekerTask / EndVsSeekerTask: the Vs. Seeker avatar while walking. */
  playerAvatar(raised: boolean): void;
  playSe(source: number): void;
  sePlaying(source: number): boolean;
}

type Phase = 'wait-npcs' | 'check' | 'start' | 'wait-player' | 'pick' | 'wait-anims' | 'wait-se' | 'done';

export class VsSeekerTask {
  private phase: Phase = 'wait-npcs';
  private trainers: Actor[] = [];
  private animating: Actor[] = [];
  private outcome: number | null = null;
  private result: number = VS_SEEKER_RESULT.ok;

  constructor(private readonly h: VsSeekerHost) {}

  /** The VS_SEEKER_USE_RESULT_* once the task is over, else null. */
  done(): number | null {
    return this.outcome;
  }

  /** One frame; true once the task is over. */
  step(): boolean {
    const h = this.h;
    switch (this.phase) {
      case 'wait-npcs': {
        // VsSeeker_WaitForNPCsToPause: a moving object finishes its step, the others pause.
        let moving = false;
        for (const a of h.objects()) {
          const busy = a.motion !== null;
          h.pause(a, !busy);
          moving ||= busy;
        }
        if (!moving) this.phase = 'check';
        return false;
      }
      case 'check': {
        this.trainers = this.collect();
        if (readSystemVar(h.reg, h.state, FIELD_VARS.battery) !== MAX_BATTERY) return this.finish(VS_SEEKER_RESULT.noBattery);
        if (!this.trainers.length) return this.finish(VS_SEEKER_RESULT.noTrainers);
        this.phase = 'start';
        return false;
      }
      case 'start':
        h.playerAvatar(true);
        h.playSe(SE_VS_SEEKER);
        writeSystemVar(h.reg, h.state, FIELD_VARS.battery, 0);
        this.phase = 'wait-player';
        return false;
      case 'wait-player':
        // No animation runs yet: the native state passes on the next frame.
        this.phase = 'pick';
        return false;
      case 'pick':
        if (!this.pick()) this.result = VS_SEEKER_RESULT.noTrainersPicked;
        this.phase = 'wait-anims';
        return false;
      case 'wait-anims':
        if (this.animating.every((a) => h.animationDone(a))) this.phase = 'wait-se';
        return false;
      case 'wait-se':
        if (h.sePlaying(SE_VS_SEEKER)) return false;
        h.playerAvatar(false);
        return this.finish(this.result);
      case 'done':
        return true;
    }
  }

  private finish(result: number): boolean {
    this.outcome = result;
    this.phase = 'done';
    return true;
  }

  /** VsSeekerSystem_CollectViableNPCs. */
  private collect(): Actor[] {
    const p = this.h.state.player;
    const xMin = Math.max(0, p.x - RADIUS.left);
    const zMin = Math.max(0, p.z - RADIUS.up);
    return this.h.objects().filter((a) => a.trainer && TRAINER_TYPES.includes(a.trainerType) && a.x >= xMin && a.x <= p.x + RADIUS.right && a.z >= zMin && a.z <= p.z + RADIUS.down && !DISGUISES.includes(a.movementType));
  }

  /** VsSeekerSystem_PickRematchTrainers. */
  private pick(): boolean {
    const h = this.h;
    let any = false;
    for (const a of this.trainers) {
      if (!trainerDefeated(h.reg, h.state, this.source(a))) {
        this.animate(a, SINGLE);
        any = true;
        continue;
      }
      // The roll comes first: it is drawn even for a trainer spinning already.
      if (nextFieldRandom(h.state) % 100 >= REMATCH_CHANCE || a.movementType === SEEKER_SPIN) continue;
      h.switchMovementType(a, SEEKER_SPIN);
      this.animate(a, DOUBLE);
      const partner = this.partner(a);
      if (partner) {
        h.switchMovementType(partner, SEEKER_SPIN);
        this.animate(partner, DOUBLE);
      }
      any = true;
      h.state.flags[systemFlag(h.reg, SEEKER_USED)] = true;
    }
    return any;
  }

  /** VsSeeker_GetSecondDoubleBattleTrainer (REMATCH_ANIM_CHECK): the other object of a double battle, not spinning yet. */
  private partner(a: Actor): Actor | undefined {
    const id = a.trainer!.id;
    if (!this.h.reg.trainers.get(id)?.double) return undefined;
    return this.h.objects().find((o) => o !== a && o.movementType !== SEEKER_SPIN && TRAINER_TYPES.includes(o.trainerType) && o.trainer?.id === id && o.trainer.battler !== a.trainer!.battler);
  }

  private source(a: Actor): number {
    const n = this.h.reg.trainers.get(a.trainer!.id)?.sourceIndex;
    if (n === undefined) throw new Error(`Vs. Seeker: ${a.trainer!.id} has no sourceIndex`);
    return n;
  }

  private animate(a: Actor, steps: { op: string; count: number }[]): void {
    this.h.animate(a, steps);
    this.animating.push(a);
  }
}
