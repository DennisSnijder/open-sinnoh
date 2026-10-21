/**
 * Trainer AI score traces for fixed states, through the running battle (OPENSINNOH_NDS_ROM): Roark's Geodude
 * (Stealth Rock, Rock Throw; BASIC + EVAL_ATTACK + EXPERT) against the player's Piplup, with the AI view over
 * the sim (`createAiView`), not the test fake. The expected scores follow the decomp script by hand
 * (src/battle/trainer_ai/script.s), every routine in flag order, each move starting at 100:
 *
 * - Stealth Rock. BASIC: Basic_CheckStealthRock scores −10 when the defender's side has Stealth Rock or
 *   CountAlivePartyBattlers (the defender's other Pokémon that can fight) is 0. EVAL_ATTACK: it cannot kill,
 *   and FlagMoveDamageScore makes no comparison for a move of power 0 (AI_NO_COMPARISON_MADE): 0. EXPERT:
 *   Expert_StealthRock, IfRandomLessThan 128 → end, else +1 (Geodude knows no Roar or Whirlwind).
 * - Rock Throw (HIT). BASIC: no immunity, no effect check. EVAL_ATTACK: does not kill (Piplup L15 at full
 *   HP), the highest damage, not quadruple: 0. EXPERT: no entry for HIT: 0.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createPokemon, type Id, type PackData } from '@opensinnoh/core';
import { dexOf, type Battle, type InputFrame, type Registries, type Trainer } from '@opensinnoh/contracts';
import { CountingStubLog, loadGamePacks } from '@opensinnoh/game';
import { ROM, romSlice } from '../../../../tests/rom.ts';
import { createBattle } from '../controller.ts';
import type { AiBattleView } from '../ai/view.ts';
import type { AiDecision, TrainerAi } from '../ai/choose.ts';

const P = (s: string) => `platinum:${s}` as Id;
const IDLE: InputFrame = { held: [], pressed: [], touch: null };

/** The controller's AI parts (private: the trace reads the same view the foe's command phase reads). */
interface Internals {
  ai: TrainerAi;
  aiView(): AiBattleView;
  sim: { p1: SimSide; p2: SimSide };
  trainer: Trainer;
  speedRand: number[];
  powerMul: number;
}
interface SimSide {
  addSideCondition(id: string, source: unknown): unknown;
  active: { addVolatile(id: string, source?: unknown): unknown }[];
}

describe.skipIf(!ROM)('trainer AI score traces through the battle (OPENSINNOH_NDS_ROM)', () => {
  let reg: Registries;
  beforeAll(() => {
    const { pack } = romSlice() as { pack: PackData };
    reg = loadGamePacks([pack]).registries;
  });

  /** Roark against `party` Piplups (L15 unless given), at the first command prompt. */
  function roark(party: number, o: { level?: number; item?: string; moves?: string[] } = {}): Battle & Internals {
    const dex = dexOf(reg);
    const mons = Array.from({ length: party }, () =>
      createPokemon(dex, { species: P('SPECIES_PIPLUP'), level: o.level ?? 15, pid: 0, ivs: 15, otId: 1, otName: 'Lucas', otGender: 'male', ball: P('ITEM_POKE_BALL'), heldItem: o.item ? P(o.item) : null, ...(o.moves ? { moves: o.moves.map(P) } : {}) }),
    );
    const b = createBattle(
      { kind: 'trainer', trainers: [P('TRAINER_LEADER_ROARK')], wild: [], background: null, terrain: null, time: 'day' },
      { registries: reg, party: mons, bag: {}, pc: { current: { box: 0, name: 'BOX 1' }, free: { box: 0, name: 'BOX 1' }, metBebe: false }, met: { zone: null, date: null }, player: { name: 'Lucas', gender: 'male', trainerId: 1, rival: 'Barry' }, money: 3000, badges: 0, caught: [], seed: 1, textSpeed: 1, log: new CountingStubLog(() => {}) },
    );
    for (let i = 0; i < 2000 && b.view().prompt?.kind !== 'command'; i++) b.step(IDLE);
    expect(b.view().prompt?.kind).toBe('command');
    return b as Battle & Internals;
  }

  /** TrainerAI_Main's scores for Geodude, every draw `roll`. */
  const trace = (b: Internals, roll: number): AiDecision => b.ai.chooseMove(b.aiView(), { battler: 1, ai: b.trainer.ai }, { next: () => roll });

  it('Roark uses BASIC, EVAL_ATTACK and EXPERT; Geodude knows Stealth Rock and Rock Throw', () => {
    const b = roark(2);
    const flags = [...reg.aiScripts.values()][0]!.flags.map((f) => f.name);
    expect(flags.filter((_, bit) => b.trainer.ai & (1 << bit))).toEqual(['AI_FLAG_BASIC', 'AI_FLAG_EVAL_ATTACK', 'AI_FLAG_EXPERT']);
    const view = b.aiView();
    expect(view.battler(1).moves.slice(0, 2)).toEqual([reg.moves.get(P('MOVE_STEALTH_ROCK'))!.sourceIndex, reg.moves.get(P('MOVE_ROCK_THROW'))!.sourceIndex]);
  });

  it('two Piplups, no Stealth Rock: 100 / 100 on a low roll; 101 / 100 on a high one, and Stealth Rock goes up', () => {
    const b = roark(2);
    expect(trace(b, 0).scores[0]!.scores.slice(0, 2)).toEqual([100, 100]);
    const high = trace(b, 200);
    expect(high.scores[0]!.scores.slice(0, 2)).toEqual([101, 100]);
    expect(high.action).toEqual({ kind: 'move', slot: 0, target: 0 });
  });

  it('the last Piplup: Stealth Rock −10 (CountAlivePartyBattlers 0) → 90 / 91, and Rock Throw is chosen', () => {
    const b = roark(1);
    expect(trace(b, 0).scores[0]!.scores.slice(0, 2)).toEqual([90, 100]);
    const high = trace(b, 200);
    expect(high.scores[0]!.scores.slice(0, 2)).toEqual([91, 100]);
    expect(high.action).toEqual({ kind: 'move', slot: 1, target: 0 });
  });

  it('Stealth Rock already on the player’s side: −10 as well', () => {
    const b = roark(2);
    b.sim.p1.addSideCondition('stealthrock', b.sim.p2.active[0]);
    expect(trace(b, 200).scores[0]!.scores.slice(0, 2)).toEqual([91, 100]);
  });

  describe('the AI view reads what the DS keeps per turn', () => {
    it('Quick Claw: speedRand % (100 / 20) == 0 puts the holder first in CompareBattlerSpeed', () => {
      // Piplup L5 is slower than Geodude L12: without the roll it compares as slower (1).
      const b = roark(2, { level: 5, item: 'ITEM_QUICK_CLAW' });
      b.speedRand = [1, 0, 0, 0];
      expect(b.aiView().compareSpeed(0, 1)).toBe(1);
      b.speedRand = [5, 0, 0, 0];
      expect(b.aiView().compareSpeed(0, 1)).toBe(0);
      expect(b.aiView().compareSpeed(1, 0)).toBe(1);
    });

    it('powerMul: the AI damage of a move after Revenge or Avalanche hit first is at double power', () => {
      const b = roark(2);
      const rockThrow = reg.moves.get(P('MOVE_ROCK_THROW'))!;
      const plain = b.aiView().calcMoveDamage(rockThrow.sourceIndex!, 1, 0, rockThrow.power * 2, 0);
      b.powerMul = 20;
      expect(b.aiView().calcMoveDamage(rockThrow.sourceIndex!, 1, 0, 0, 0)).toBe(plain);
    });

    it('Imprison and Heal Block make moves invalid (Move_Imprisoned, Move_HealBlocked)', () => {
      const b = roark(2, { moves: ['MOVE_ROCK_THROW', 'MOVE_REST', 'MOVE_POUND'] });
      expect(b.aiView().invalidMoves(0)).toBe(0b1000);
      b.sim.p2.active[0]!.addVolatile('imprison');
      expect(b.aiView().invalidMoves(0)).toBe(0b1001);
      b.sim.p1.active[0]!.addVolatile('healblock');
      expect(b.aiView().invalidMoves(0)).toBe(0b1011);
    });
  });
});
