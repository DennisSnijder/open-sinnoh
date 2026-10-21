/**
 * The AI's decisions (decomp trainer_ai.c TrainerAI_PickCommand, TrainerAI_Main, TrainerAI_MainSingles/
 * MainDoubles; battle_display.c's post-KO party choice).
 */
import type { Registries } from '@opensinnoh/contracts';
import { BATTLE_TYPE, MOVE, NO_SLOT, TYPE } from './constants.ts';
import { createAiDex, type AiDex } from './dex.ts';
import { shouldUseItem, type AiItemUse } from './items.ts';
import { ScoreRun } from './script.ts';
import { firstAlive, postKOSwitchIn, randomOpponent, shouldSwitch } from './switching.ts';
import type { Calc } from './calc.ts';
import type { AiBattleView, AiRng } from './view.ts';

/** decomp AI_FLAG_TAG_STRATEGY and AI_FLAG_ROAMING_POKEMON bits. */
const AI_FLAG_TAG_STRATEGY = 1 << 7;
const AI_FLAG_ROAMING_POKEMON = 1 << 29;

/** The battler the AI decides for and its trainer's `Trainer.ai` mask (0 for none). */
export interface AiTrainer {
  battler: number;
  ai: number;
}

export type AiAction =
  | { kind: 'move'; slot: number; target: number }
  | { kind: 'switch'; slot: number }
  | ({ kind: 'item' } & AiItemUse)
  | { kind: 'escape' }
  | { kind: 'safari' };

/** An action and, when moves were scored, the final scores per target (singles: only the target's). */
export interface AiDecision {
  action: AiAction;
  scores: { target: number; scores: number[] }[];
}

export interface TrainerAi {
  readonly dex: AiDex;
  /**
   * The AI's whole turn choice, in the DS's order: switch, then item (TrainerAI_PickCommand: trainer battles
   * and the player's AI partner only), then a move and its target (TrainerAI_Main).
   */
  chooseAction(view: AiBattleView, trainer: AiTrainer, rng: AiRng): AiDecision;
  /** TrainerAI_Main alone: the move for battles that skip the command AI (first battle, roamers). */
  chooseMove(view: AiBattleView, trainer: AiTrainer, rng: AiRng): AiDecision;
  /** The party slot to send out after `battler` fainted (BattleAI_PostKOSwitchIn, then the DS's fallback). */
  chooseSwitchIn(view: AiBattleView, battler: number, rng: AiRng): number;
}

/** TrainerAI_Init's flag mask: roamers think as roamers; doubles add TAG_STRATEGY. */
function thinkingMask(view: AiBattleView, trainer: AiTrainer): number {
  let mask = view.battleType & BATTLE_TYPE.ROAMER ? AI_FLAG_ROAMING_POKEMON : trainer.ai;
  if (view.battleType & BATTLE_TYPE.DOUBLES) mask |= AI_FLAG_TAG_STRATEGY;
  return mask >>> 0;
}

/** TrainerAI_RecordLastMove: remember the defender's last move in its first free known-move slot. */
function recordLastMove(c: Calc, defender: number): void {
  const known = c.view.memory.knownMoves[defender]!;
  const prev = c.view.previousMove(defender);
  for (let i = 0; i < 4; i++) {
    if (known[i] === prev) break;
    if (known[i] === MOVE.NONE) {
      known[i] = prev;
      break;
    }
  }
}

/** The highest score among the slots with a move (slot 0 always counts), ties broken by one draw. */
function bestSlot(c: Calc, run: ScoreRun): { slot: number; score: number } {
  const moves = c.view.battler(run.attacker).moves;
  let best = run.scores[0]!;
  let slots = [0];
  for (let i = 1; i < 4; i++) {
    if (!moves[i]) continue;
    if (best === run.scores[i]) slots.push(i);
    if (best < run.scores[i]!) {
      best = run.scores[i]!;
      slots = [i];
    }
  }
  return { slot: slots[c.rng.next() % slots.length]!, score: best };
}

function mainSingles(c: Calc, run: ScoreRun): AiDecision {
  recordLastMove(c, run.defender);
  run.evalFlags();
  const scores = [{ target: run.defender, scores: [...run.scores] }];
  if (run.escaped) return { action: { kind: 'escape' }, scores };
  if (run.safari) return { action: { kind: 'safari' }, scores };
  return { action: { kind: 'move', slot: bestSlot(c, run).slot, target: run.defender }, scores };
}

function mainDoubles(c: Calc, attacker: number, mask: number): AiDecision {
  const v = c.view;
  const best: number[] = [-1, -1, -1, -1];
  const actions: (AiAction | null)[] = [null, null, null, null];
  const scores: AiDecision['scores'] = [];
  for (let battler = 0; battler < 4; battler++) {
    if (battler === attacker || v.battler(battler).hp === 0) continue;
    const run = new ScoreRun(c, attacker, battler, 0xf, mask);
    if ((battler & 1) !== (attacker & 1)) recordLastMove(c, battler);
    run.evalFlags();
    scores.push({ target: battler, scores: [...run.scores] });
    if (run.escaped) actions[battler] = { kind: 'escape' };
    else if (run.safari) actions[battler] = { kind: 'safari' };
    else {
      const { slot, score } = bestSlot(c, run);
      actions[battler] = { kind: 'move', slot, target: battler };
      // An ally only as a target for a move scored 100 or more.
      best[battler] = battler === (attacker ^ 2) && score < 100 ? -1 : score;
    }
  }
  let max = best[0]!;
  let targets = [0];
  for (let b = 1; b < 4; b++) {
    if (max === best[b]) targets.push(b);
    if (max < best[b]!) {
      max = best[b]!;
      targets = [b];
    }
  }
  let target = targets[c.rng.next() % targets.length]!;
  const action = actions[target];
  // The DS reads the slot as an action either way; an escape/safari result carries through as that action.
  if (!action) throw new Error(`trainer AI: battler ${attacker} has no target to act on`);
  if (action.kind !== 'move') return { action, scores };
  const a = v.battler(attacker);
  const move = a.moves[action.slot]!;
  if (c.dex.move(move).range === 'USER_OR_ALLY' && (target & 1) === 0) target = attacker;
  if (move === MOVE.CURSE && a.types[0] !== TYPE.GHOST && a.types[1] !== TYPE.GHOST) target = attacker;
  return { action: { kind: 'move', slot: action.slot, target }, scores };
}

export function createTrainerAi(registries: Registries): TrainerAi {
  return trainerAiOf(createAiDex(registries));
}

/** The AI over an already built dex (tests build one by hand). */
export function trainerAiOf(dex: AiDex): TrainerAi {
  function chooseMove(view: AiBattleView, trainer: AiTrainer, rng: AiRng): AiDecision {
    const c: Calc = { dex, view, rng };
    const mask = thinkingMask(view, trainer);
    const defender = randomOpponent(c, trainer.battler);
    const run = new ScoreRun(c, trainer.battler, defender, 0xf, mask);
    return view.battleType & BATTLE_TYPE.DOUBLES ? mainDoubles(c, trainer.battler, mask) : mainSingles(c, run);
  }

  return {
    dex,
    chooseMove,
    chooseAction(view, trainer, rng) {
      const c: Calc = { dex, view, rng };
      const battler = trainer.battler;
      if (view.battleType & BATTLE_TYPE.TRAINER || (battler & 1) === 0) {
        if (shouldSwitch(c, battler)) {
          if (view.memory.switchedSlot[battler] === NO_SLOT) {
            let slot = postKOSwitchIn(c, battler);
            if (slot === NO_SLOT) slot = firstAlive(c, battler, true);
            view.memory.switchedSlot[battler] = slot;
          }
          return { action: { kind: 'switch', slot: view.memory.switchedSlot[battler]! }, scores: [] };
        }
        const item = shouldUseItem(c, battler);
        if (item) return { action: { kind: 'item', ...item }, scores: [] };
      }
      return chooseMove(view, trainer, rng);
    },
    chooseSwitchIn(view, battler, rng) {
      const c: Calc = { dex, view, rng };
      let slot = view.memory.switchedSlot[battler]!;
      if (slot === NO_SLOT) slot = postKOSwitchIn(c, battler);
      return slot === NO_SLOT ? firstAlive(c, battler, false) : slot;
    },
  };
}
