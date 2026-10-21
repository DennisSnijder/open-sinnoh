/** ROM scoring scripts over a live doubles sim; original controlled stats pin the KO boundary. */
import { PRNG } from '@pkmn/sim';
import { beforeAll, describe, expect, it } from 'vitest';
import { createPokemon, type Id } from '@opensinnoh/core';
import { dexOf, type Registries } from '@opensinnoh/contracts';
import { CountingStubLog, loadGamePacks } from '@opensinnoh/game';
import { ROM, romSlice } from '../../../../tests/rom.ts';
import { createTrainerAi } from '../ai/choose.ts';
import { BATTLE_TYPE } from '../ai/constants.ts';
import { createAiMemory } from '../ai/memory.ts';
import { ScoreRun } from '../ai/script.ts';
import { scriptedRng } from '../ai/testing/fake.ts';
import { simData, simSet } from '../sim/dex.ts';
import { createAiView } from './ai-view.ts';

const P = (name: string) => `platinum:${name}` as Id;

describe.skipIf(!ROM)('doubles AI damage and scores (OPENSINNOH_NDS_ROM)', () => {
  let reg: Registries;
  beforeAll(() => { reg = loadGamePacks([romSlice().pack]).registries; });

  it('screens and spread cross EVAL_ATTACK’s KO boundary and change the selected target', () => {
    const dex = dexOf(reg);
    const data = simData(reg, new CountingStubLog(() => {}));
    const mons = Array.from({ length: 4 }, () => createPokemon(dex, {
      species: P('SPECIES_UMBREON'), level: 45, ivs: 0, pid: 0, otId: 1, otName: 'Test', otGender: 'male',
      ball: P('ITEM_POKE_BALL'), moves: [P('MOVE_SURF')],
    }));
    const sim = data.createBattle('trainer', 'doubles', { prng: new PRNG('sodium,00000000000000000000000000000000') });
    sim.setPlayer('p1', { name: 'A', team: [0, 2].map((b) => simSet(data, dex, mons[b]!, 'A')) } as never);
    sim.setPlayer('p2', { name: 'B', team: [1, 3].map((b) => simSet(data, dex, mons[b]!, 'B')) } as never);
    const sims = [sim.p1.active[0]!, sim.p2.active[0]!, sim.p1.active[1]!, sim.p2.active[1]!];
    for (const mon of sims) {
      Object.assign(mon.storedStats, { atk: 100, def: 100, spa: 100, spd: 100, spe: 100 });
      mon.hp = 100;
    }
    sim.p1.addSideCondition('lightscreen', sims[0]);
    const ai = createTrainerAi(reg);
    const evalAttack = 1 << ai.dex.script.flags.findIndex((f) => f.name === 'AI_FLAG_EVAL_ATTACK');
    const surf = reg.moves.get(P('MOVE_SURF'))!;
    // level factor 20, power 95, equal stats: 38 → screen floor(38*2/3)=25
    // → spread floor(25*3/4)=18 → +2=20; neutral type, no STAB on Dark-type Umbreon.
    const view = () => createAiView(reg, {
      battleType: BATTLE_TYPE.TRAINER | BATTLE_TYPE.DOUBLES, totalTurns: 0,
      memory: createAiMemory(BATTLE_TYPE.TRAINER | BATTLE_TYPE.DOUBLES, []), rng: { next: () => 0 }, sim,
      sides: mons.map((mon, b) => ({ party: [mon], sims: [sims[b]!], active: 0 })),
      packMove: data.packMove, packItem: data.packItem, speedRand: [1, 1, 1, 1], powerMul: 10,
    });
    expect(view().calcMoveDamage(surf.sourceIndex!, 1, 0, 0, 0)).toBe(20);
    for (const hp of [21, 20]) {
      sims[0]!.hp = hp;
      // Isolate the damage flag before the forced doubles TAG_STRATEGY additions.
      const rng = scriptedRng([0, 0, 0, 0]);
      const run = new ScoreRun({ dex: ai.dex, view: view(), rng }, 1, 0, 0xf, evalAttack);
      run.evalFlags();
      expect(run.scores).toEqual([hp === 20 ? 104 : 100, 0, 0, 0]);
      expect(rng.left()).toBe(0);
      // Normal opponent draw + initial four rolls, then three targets' four rolls and slot ties.
      // Enemy targets each consume one Tag highest-damage trial (0 suppresses the bonus).
      const choiceRng = scriptedRng([0, 0, 0, 0, 0, ...[0, 2].flatMap(() => [0, 0, 0, 0, 0, 0]), 0, 0, 0, 0, 0, 1]);
      const result = ai.chooseMove(view(), { battler: 1, ai: evalAttack }, choiceRng);
      expect(result.scores).toEqual([
        { target: 0, scores: [hp === 20 ? 101 : 97, 0, 0, 0] },
        { target: 2, scores: [97, 0, 0, 0] },
        { target: 3, scores: [70, 0, 0, 0] },
      ]);
      expect(result.action).toEqual({ kind: 'move', slot: 0, target: hp === 20 ? 0 : 2 });
      expect(choiceRng.left()).toBe(0);
    }
    sim.destroy();
  });
});
