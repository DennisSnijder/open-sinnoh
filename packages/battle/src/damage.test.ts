/**
 * Golden damage ranges on the fixture pack's original creatures (no ROM): for each of the 16 damage rolls,
 * the sim's gen 4 damage through our dex mod equals the decomp's, worked out by hand below and checked
 * against our port of the decomp routines (the AI view's BattleSystem_CalcMoveDamage and
 * BattleSystem_ApplyTypeChart, with BattleSystem_CalcDamageVariance between them):
 *
 *   base   = trunc(trunc(trunc(atk · power · (trunc(level·2/5) + 2)) / def) / 50) + 2, × 2 on a crit
 *   roll r = max(1, trunc(base · (100 − r) / 100)), r = rand % 16
 *   STAB   = trunc(damage · 15 / 10); each chart row = trunc(damage · mul / 10)
 *
 * The creatures are built with IVs 15, no EVs and the neutral nature (pid 0x1234); their abilities have no
 * battle effect.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type Battle as SimBattle, PRNG } from '@pkmn/sim';
import { createPokemon, readPackFolder, type Id, type Pokemon } from '@opensinnoh/core';
import { dexOf } from '@opensinnoh/contracts';
import { CountingStubLog, loadGamePacks } from '@opensinnoh/game';
import { simData } from './sim/dex.ts';
import { createAiMemory } from './ai/memory.ts';
import { createAiView, type SimPokemon } from './controller/ai-view.ts';

const root = join(import.meta.dirname, '../../../packs/fixture');
const read = (p: string) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : undefined);
const registries = loadGamePacks([readPackFolder(read, 'packs/fixture')]).registries;
const dex = dexOf(registries);
const f = (n: string) => `fixture:${n}` as Id;
const data = simData(registries, new CountingStubLog(() => {}));

function mon(species: string, level: number): Pokemon {
  return createPokemon(dex, { species: f(`SPECIES_${species}`), level, pid: 0x1234, ivs: 15, otId: 77, otName: 'Ash', otGender: 'male', ball: f('ITEM_POKE_BALL') });
}

/** A sim battle between the two (the controller's sets: our species, moves, IVs and level). */
function simBattle(attacker: Pokemon, defender: Pokemon): SimBattle {
  const set = (m: Pokemon) => ({
    name: m.species,
    species: data.species(m.species),
    item: '',
    ability: 'No Ability',
    moves: m.moves.map((id) => data.move(id)),
    nature: data.nature(null, null),
    gender: 'M',
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ivs: { hp: 15, atk: 15, def: 15, spa: 15, spd: 15, spe: 15 },
    level: m.level,
  });
  const sim = data.createBattle('wild', 'singles', { prng: new PRNG('sodium,00000000000000000000000000000000') } as never);
  sim.setPlayer('p1', { name: 'a', team: [set(attacker)] } as never);
  sim.setPlayer('p2', { name: 'b', team: [set(defender)] } as never);
  return sim;
}

/** The damage of `move` for rolls 0–15, by the sim and by our port of the decomp routines. */
function damages(attacker: Pokemon, defender: Pokemon, move: string, crit = false): { sim: number[]; decomp: number[] } {
  const sim = simBattle(attacker, defender);
  const [a, d] = [sim.p1.active[0]!, sim.p2.active[0]!];
  // The sim's stats are the ones we compute (the dex mod carries the pack's base stats).
  for (const [s, m] of [[a, attacker], [d, defender]] as const) {
    expect(s.storedStats).toEqual({ atk: m.stats.attack, def: m.stats.defense, spa: m.stats.spAttack, spd: m.stats.spDefense, spe: m.stats.speed });
    expect(s.maxhp).toBe(m.stats.hp);
  }
  const simRolls = Array.from({ length: 16 }, (_, r) => {
    (sim as unknown as { random: () => number }).random = () => r;
    const active = sim.dex.getActiveMove(data.move(f(move)));
    active.willCrit = crit;
    return sim.actions.getDamage(a, d, active, true) as number;
  });
  const view = createAiView(registries, {
    battleType: 0,
    totalTurns: 0,
    memory: createAiMemory(0, []),
    rng: { next: () => 0 },
    sim,
    sides: [
      { party: [attacker], sims: [a as SimPokemon], active: 0 },
      { party: [defender], sims: [d as SimPokemon], active: 0 },
    ],
    packMove: (id) => data.packMove(id),
    packItem: (id) => data.packItem(id),
    speedRand: [0, 0, 0, 0],
    powerMul: 10,
  });
  const n = registries.moves.get(f(move))!.sourceIndex!;
  const base = view.calcMoveDamage(n, 0, 1, 0, 0) * (crit ? 2 : 1);
  const decomp = Array.from({ length: 16 }, (_, r) => view.applyTypeChart(n, 0, 0, 1, Math.max(1, Math.trunc((base * (100 - r)) / 100)), false).damage);
  return { sim: simRolls, decomp };
}

const rolls = (...runs: [number, number][]) => runs.flatMap(([value, count]) => Array<number>(count).fill(value));

describe('damage ranges: the sim against the decomp formula (fixture pack)', () => {
  it('physical, STAB, super effective: Burrowbit L20 Dig Paw on Emberkit L18', () => {
    // Atk 26, power 45, level factor 10, Def 23: trunc(trunc(11700 / 23) / 50) + 2 = trunc(508 / 50) + 2 = 12.
    // Rolls: 12 (r 0), 11 (r 1–8: 11.88 … 11.04), 10 (r 9–15). STAB: 18, 16, 15. Ground on Fire ×20/10: 36, 32, 30.
    const golden = rolls([36, 1], [32, 8], [30, 7]);
    expect(damages(mon('BURROWBIT', 20), mon('EMBERKIT', 18), 'MOVE_DIG_PAW')).toEqual({ sim: golden, decomp: golden });
  });

  it('special, STAB, resisted: Dripling L15 Drizzle Jet on Mosslet L16', () => {
    // SpA 25, power 40, level factor 8, SpD 28: trunc(trunc(8000 / 28) / 50) + 2 = trunc(285 / 50) + 2 = 7.
    // Rolls: 7 (r 0), 6 (r 1–14), 5 (r 15: 5.95). STAB: 10, 9, 7. Water on Grass ×5/10: 5, 4, 3.
    const golden = rolls([5, 1], [4, 14], [3, 1]);
    expect(damages(mon('DRIPLING', 15), mon('MOSSLET', 16), 'MOVE_DRIZZLE_JET')).toEqual({ sim: golden, decomp: golden });
  });

  it('physical, neutral, and the same move as a critical hit (×2 before the roll)', () => {
    // Emberkit L18 Bop on Dripling L15: Atk 26, power 40, level factor 9, Def 23: trunc(9360 / 23) = 406 → 8 + 2 = 10.
    // Rolls: 10 (r 0), 9 (r 1–10), 8 (r 11–15). No STAB, Normal on Water ×1.
    const plain = rolls([10, 1], [9, 10], [8, 5]);
    expect(damages(mon('EMBERKIT', 18), mon('DRIPLING', 15), 'MOVE_BOP')).toEqual({ sim: plain, decomp: plain });
    // Crit: 20 → 20 (r 0), 19 (r 1–5), 18 (r 6–10), 17 (r 11–15).
    const crit = rolls([20, 1], [19, 5], [18, 5], [17, 5]);
    expect(damages(mon('EMBERKIT', 18), mon('DRIPLING', 15), 'MOVE_BOP', true)).toEqual({ sim: crit, decomp: crit });
  });
});
