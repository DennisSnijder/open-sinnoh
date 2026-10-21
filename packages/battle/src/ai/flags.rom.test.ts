/**
 * The research doc's boundary scenarios against the imported routines, using only original battle state.
 * No ROM bytecode or extracted fixtures are retained here. Each test isolates one flag and accounts for
 * every draw; TAG_STRATEGY uses one target's ScoreRun to isolate its ally/enemy handlers.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { type Id } from '@opensinnoh/core';
import { loadGamePacks } from '@opensinnoh/game';
import { type Registries } from '@opensinnoh/contracts';
import { ROM, romSlice } from '../../../../tests/rom.ts';
import { createAiDex, type AiDex } from './dex.ts';
import { trainerAiOf } from './choose.ts';
import { ABILITY, BATTLE_TYPE, FIELD_CONDITION, MON_CONDITION, TYPE } from './constants.ts';
import { ScoreRun } from './script.ts';
import { fakeView, mon, partyMon, scriptedRng, type FakeView } from './testing/fake.ts';
import { type AiBattler } from './view.ts';

const P = (name: string) => `platinum:${name}` as Id;

describe.skipIf(!ROM)('per-flag AI score boundaries (OPENSINNOH_NDS_ROM)', () => {
  let reg: Registries;
  let dex: AiDex;
  beforeAll(() => {
    reg = loadGamePacks([romSlice().pack]).registries;
    dex = createAiDex(reg);
  });
  const num = (kind: 'moves' | 'abilities' | 'species', name: string) => reg[kind].get(P(name))!.sourceIndex!;
  const move = (name: string) => num('moves', `MOVE_${name}`);
  const ability = (name: string) => num('abilities', `ABILITY_${name}`);
  const mask = (flag: string) => 1 << dex.script.flags.findIndex((f) => f.name === `AI_FLAG_${flag}`);

  function state(moves: string[], a: Partial<AiBattler> = {}, d: Partial<AiBattler> = {}): FakeView {
    return fakeView({ dex, battlers: [mon({ species: num('species', 'SPECIES_UNOWN'), ...d }),
      mon({ species: num('species', 'SPECIES_UMBREON'), types: [TYPE.DARK, TYPE.DARK], moves: moves.map(move), ...a })] });
  }

  /** Four initialization rolls, then precisely the branch draws, then a controlled tie draw. */
  function check(flag: string, view: FakeView, draws: number[], scores: number[], slot: number, tie = 1) {
    const rng = scriptedRng([0, 0, 0, 0, ...draws, tie]);
    const result = trainerAiOf(dex).chooseMove(view, { battler: 1, ai: mask(flag) }, rng);
    expect(result).toEqual({ action: { kind: 'move', slot, target: 0 }, scores: [{ target: 0, scores }] });
    expect(rng.left()).toBe(0);
  }

  it('SETUP_FIRST_TURN: 79/80 boundary, whole-battle turn gate, and Dragon Dance exclusion', () => {
    check('SETUP_FIRST_TURN', state(['SWORDS_DANCE', 'TACKLE']), [79], [100, 100, 0, 0], 1);
    check('SETUP_FIRST_TURN', state(['SWORDS_DANCE', 'TACKLE']), [80], [102, 100, 0, 0], 0);
    const later = state(['SWORDS_DANCE', 'TACKLE'], { switchInTurn: 1 });
    Object.assign(later, { totalTurns: 1 });
    check('SETUP_FIRST_TURN', later, [], [100, 100, 0, 0], 1);
    check('SETUP_FIRST_TURN', state(['DRAGON_DANCE', 'TACKLE']), [], [100, 100, 0, 0], 1);
  });

  it('RISKY: confusion gains two at 128, not 127', () => {
    check('RISKY', state(['CONFUSE_RAY', 'TACKLE']), [127], [100, 100, 0, 0], 1);
    check('RISKY', state(['CONFUSE_RAY', 'TACKLE']), [128], [102, 100, 0, 0], 0);
  });

  it('PRIORITIZE_EXTREMES: the no-comparison status move gains two at 100, not 99', () => {
    check('PRIORITIZE_EXTREMES', state(['GROWL', 'TACKLE']), [99], [100, 100, 0, 0], 1);
    check('PRIORITIZE_EXTREMES', state(['GROWL', 'TACKLE']), [100], [102, 100, 0, 0], 0);
  });

  it('BATON_PASS: generic status fall-through stacks with setup, and its later HP boundary is 60%', () => {
    for (const [turn, hp, score] of [[0, 100, 108], [1, 59, 93], [1, 60, 104]]) {
      const v = state(['GROWL', 'TACKLE', 'BATON_PASS'], { hp });
      v.parties[1] = [partyMon(), partyMon()];
      Object.assign(v, { totalTurns: turn });
      // Baton Pass starts at 98 on turn zero; no positive attacking stages on later turns.
      check('BATON_PASS', v, [20], [score!, 100, turn === 0 ? 98 : 100, 0], score! > 100 ? 0 : 1, 0);
    }
  });

  it('BATON_PASS: Attack is tested before Sp. Atk, and bonuses are not summed', () => {
    const v = state(['BATON_PASS', 'TACKLE'], { statStages: [6, 7, 6, 6, 12, 6, 6, 6] });
    v.parties[1] = [partyMon(), partyMon()];
    Object.assign(v, { totalTurns: 1 });
    check('BATON_PASS', v, [], [101, 100, 0, 0], 0);
  });

  it('CHECK_HP: both independent 70% passes subtract two; 71% omits the effect', () => {
    check('CHECK_HP', state(['HOWL', 'TACKLE'], { hp: 70 }, { hp: 70 }), [50, 50], [96, 100, 0, 0], 1);
    check('CHECK_HP', state(['HOWL', 'TACKLE'], { hp: 71 }, { hp: 71 }), [], [100, 100, 0, 0], 1);
  });

  it('WEATHER: non-weather moves fall through to the sun check; whole-battle and entry gates apply', () => {
    check('WEATHER', state(['TACKLE', 'RAIN_DANCE']), [], [105, 105, 0, 0], 1);
    const sun = state(['TACKLE', 'RAIN_DANCE']);
    Object.assign(sun, { fieldConditions: FIELD_CONDITION.SUNNY });
    check('WEATHER', sun, [], [100, 105, 0, 0], 1);
    const later = state(['TACKLE', 'RAIN_DANCE'], { switchInTurn: 1 });
    Object.assign(later, { totalTurns: 1 });
    check('WEATHER', later, [], [100, 100, 0, 0], 1);
  });

  it('HARRASSMENT: ordinary poison, but not Toxic, gains two at 128', () => {
    check('HARRASSMENT', state(['POISON_POWDER', 'TACKLE', 'TOXIC']), [127], [100, 100, 100, 0], 1);
    check('HARRASSMENT', state(['POISON_POWDER', 'TACKLE', 'TOXIC']), [128], [102, 100, 100, 0], 0);
  });

  it('EXPERT: faster recovery loses eight, and Snore uses the Nightmare alias while Nightmare has no dispatch', () => {
    check('EXPERT', state(['RECOVER', 'TACKLE'], { speed: 101, hp: 50 }), [], [92, 100, 0, 0], 1);
    check('EXPERT', state(['SNORE', 'TACKLE', 'NIGHTMARE'], { status: MON_CONDITION.SLEEP }), [], [102, 100, 100, 0], 0);
  });

  it('EXPERT: Feint chain 2 follows chain 0, but chain 3 loses two', () => {
    for (const [chain, score, draws] of [[2, 101, [255]], [3, 98, []]] as const) {
      const v = state(['FEINT', 'TACKLE'], {}, { protectSuccessTurns: chain });
      v.memory.knownMoves[0]![0] = move('PROTECT');
      v.protectMove = () => move('PROTECT');
      check('EXPERT', v, [...draws], [score, 100, 0, 0], score > 100 ? 0 : 1);
    }
  });

  it('EXPERT: Punishment accumulates ten from seven positive target stages', () => {
    check('EXPERT', state(['PUNISHMENT', 'TACKLE'], {}, { statStages: [6, 7, 7, 7, 7, 7, 7, 7] }), [255, 255, 255, 255], [110, 100, 0, 0], 0);
  });

  /** One isolated Tag target; suppress common damaging-move bonuses with a status move or a strong partner. */
  function tag(name: string, target: number, a: Partial<AiBattler>, partner: Partial<AiBattler>, draws: number[], expected: number) {
    const v = state([name], a);
    Object.assign(v, { battleType: BATTLE_TYPE.TRAINER | BATTLE_TYPE.DOUBLES });
    v.battlers[2] = mon();
    v.battlers[3] = mon({ types: [TYPE.NORMAL, TYPE.NORMAL], ...partner });
    const rng = scriptedRng([0, 0, 0, 0, ...draws]);
    const run = new ScoreRun({ dex, view: v, rng }, 1, target, 0xf, mask('TAG_STRATEGY'));
    run.evalFlags();
    expect(run.scores).toEqual([expected, 0, 0, 0]);
    expect(rng.left()).toBe(0);
  }

  it('TAG_STRATEGY: full-HP Solar Power has an independent 127/128 penalty draw', () => {
    tag('SUNNY_DAY', 0, { ability: ability('SOLAR_POWER') }, {}, [127], 101);
    tag('SUNNY_DAY', 0, { ability: ability('SOLAR_POWER') }, {}, [128], 99);
  });

  it('TAG_STRATEGY: Poison Heal accepts poison at 91% HP and rejects it at 92%', () => {
    tag('POISON_POWDER', 3, {}, { ability: ability('POISON_HEAL'), hp: 91 }, [], 105);
    tag('POISON_POWDER', 3, {}, { ability: ability('POISON_HEAL'), hp: 92 }, [], 70);
  });

  it('TAG_STRATEGY: Water/Ground takes the Discharge weakness branch before Ground immunity', () => {
    tag('DISCHARGE', 0, {}, { types: [TYPE.WATER, TYPE.GROUND], attack: 1000, moves: [move('POUND')] }, [], 90);
  });

  it('TAG_STRATEGY: Electric-first Skill Swap falls through, while mono-Electric terminates after two bonuses', () => {
    tag('SKILL_SWAP', 3, { ability: ABILITY.LEVITATE }, { types: [TYPE.ELECTRIC, TYPE.NORMAL] }, [], 71);
    tag('SKILL_SWAP', 3, { ability: ABILITY.LEVITATE }, { types: [TYPE.ELECTRIC, TYPE.ELECTRIC] }, [], 102);
  });

  it('TAG_STRATEGY: Acupressure at 75% needs two independent draws at 128 and 80', () => {
    tag('ACUPRESSURE', 3, {}, { hp: 75 }, [128, 80], 102);
    tag('ACUPRESSURE', 3, {}, { hp: 75 }, [127], 100);
    tag('ACUPRESSURE', 3, {}, { hp: 75 }, [128, 79], 100);
  });

  it('unused bits 11–28 terminate without changing scores', () => {
    const v = state(['TACKLE', 'GROWL']);
    for (let bit = 11; bit <= 28; bit++) {
      const rng = scriptedRng([0, 0, 0, 0, 1]);
      const result = trainerAiOf(dex).chooseMove(v, { battler: 1, ai: 1 << bit }, rng);
      expect(result).toEqual({ action: { kind: 'move', slot: 1, target: 0 }, scores: [{ target: 0, scores: [100, 100, 0, 0] }] });
      expect(rng.left()).toBe(0);
    }
  });

  it('ROAMING_POKEMON: escapes unless trapped; Levitate bypasses Arena Trap', () => {
    for (const [a, d, escape] of [[{}, {}, true], [{ volatile: 1 << 13 }, {}, false], [{}, { ability: ABILITY.SHADOW_TAG }, false],
      [{}, { ability: ABILITY.ARENA_TRAP }, false], [{ ability: ABILITY.LEVITATE }, { ability: ABILITY.ARENA_TRAP }, true]] as const) {
      const rng = scriptedRng([0, 0, 0, 0, ...(escape ? [] : [0])]);
      const result = trainerAiOf(dex).chooseMove(state(['TACKLE'], a, d), { battler: 1, ai: mask('ROAMING_POKEMON') }, rng);
      expect(result.action).toEqual(escape ? { kind: 'escape' } : { kind: 'move', slot: 0, target: 0 });
      expect(rng.left()).toBe(0);
    }
  });

  it('SAFARI: fails explicitly on its non-advancing native handler', () => {
    expect(() => trainerAiOf(dex).chooseMove(state(['TACKLE']), { battler: 1, ai: mask('SAFARI') }, scriptedRng([0, 0, 0, 0])))
      .toThrow(/never ends on the DS/);
  });

  it('CATCH_TUTORIAL: escapes at 20% but selects a move at 21%', () => {
    for (const hp of [20, 21]) {
      const rng = scriptedRng([0, 0, 0, 0, ...(hp === 20 ? [] : [0])]);
      const result = trainerAiOf(dex).chooseMove(state(['TACKLE'], {}, { hp }), { battler: 1, ai: mask('CATCH_TUTORIAL') }, rng);
      expect(result.action).toEqual(hp === 20 ? { kind: 'escape' } : { kind: 'move', slot: 0, target: 0 });
      expect(rng.left()).toBe(0);
    }
  });
});
