/**
 * The doubles rules the dex mod changes where the DS and the sim differ (sim/dex.ts `doublesScripts`;
 * docs/research/double-battles.md §5.2, §7.3), on the fixture pack's original creatures in the sim's `doubles`
 * format:
 * - spread damage after a KO: a spread move whose first target faints hits the second at full damage (decomp
 *   BattleSystem_CountAliveBattlers at that hit), where the sim takes 3/4 for both;
 * - a normal move aimed at an ally that fainted earlier in the turn goes at a foe (decomp BattleSystem_Defender,
 *   BattleSystem_RandomOpponent), where the sim's move has no target.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Battle, PRNG } from '@pkmn/sim';
import { describe, expect, it } from 'vitest';
import { createPokemon, readPackFolder, type Id } from '@opensinnoh/core';
import { dexOf } from '@opensinnoh/contracts';
import { CountingStubLog, loadGamePacks } from '@opensinnoh/game';
import { Lcrng, simData, simOwners, simSet } from './dex.ts';

const root = join(import.meta.dirname, '../../../../packs/fixture');
const read = (p: string) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : undefined);
const registries = loadGamePacks([readPackFolder(read, 'packs/fixture')]).registries;
const dex = dexOf(registries);
const data = simData(registries, new CountingStubLog(() => {}));
const f = (n: string) => `fixture:${n}` as Id;

const set = (species: string, level: number, moves: string[]) => {
  const mon = createPokemon(dex, { species: f(species), level, pid: 0x2222, ivs: 15, otId: 1, otName: 'T', otGender: 'male', ball: f('ITEM_CAPTURE_ORB'), heldItem: null, moves: moves.map((m) => f(`MOVE_${m}`)) });
  return simSet(data, dex, mon, species);
};

function start(seed: number, p1: ReturnType<typeof set>[], p2: ReturnType<typeof set>[]) {
  const prng = new PRNG('sodium,00000000000000000000000000000000');
  (prng as unknown as { rng: Lcrng }).rng = new Lcrng(seed);
  const battle = data.createBattle('trainer', 'doubles', { prng, strictChoices: true });
  battle.setPlayer('p1', { name: 'player', team: p1 } as never);
  battle.setPlayer('p2', { name: 'enemy', team: p2 } as never);
  return battle;
}

const hpAfter = (battle: Battle, ident: string) => {
  const line = battle.log.filter((l) => l.startsWith(`|-damage|${ident}`) && !l.includes('[from]')).at(-1);
  if (!line) throw new Error(`no damage to ${ident}`);
  return Number(line.split('|')[3]!.split('/')[0]);
};

describe('doubles rules on the sim (fixture pack, sim doubles format)', () => {
  it('spread damage after a KO: the second target of Rock Slide takes full damage once the first has fainted at its hit', () => {
    const p1 = [set('SPECIES_MOSSGROVE', 40, ['BOP', 'ROCK_SLIDE']), set('SPECIES_MOSSGROVE', 40, ['BARK_SHIELD'])];
    const p2 = () => [set('SPECIES_MOSSGROVE', 40, ['BARK_SHIELD']), set('SPECIES_MOSSGROVE', 40, ['BARK_SHIELD'])];
    const run = (firstHp: number | null) => {
      const battle = start(3, p1, p2());
      if (firstHp !== null) battle.p2.active[0]!.hp = firstHp;
      const max = battle.p2.active[1]!.maxhp;
      battle.makeChoices('move 2, move 1', 'move 1, move 1');
      return { second: max - hpAfter(battle, 'p2b'), fainted: battle.p2.active[0]!.fainted };
    };
    const both = run(null);
    const ko = run(1);
    expect(both.fainted).toBe(false);
    expect(ko.fainted).toBe(true);
    // 3/4 when both stand at the hit (the same rolls: the damage draws come in the same order).
    expect(ko.second).toBeGreaterThan(both.second);
    expect(Math.abs(ko.second * 3 - both.second * 4)).toBeLessThanOrEqual(4);
  });

  it('a move aimed at an ally that fainted earlier in the turn goes at a foe (the sim would leave it without a target)', () => {
    const battle = start(5, [set('SPECIES_MOSSGROVE', 30, ['BOP']), set('SPECIES_MOSSGROVE', 30, ['BARK_SHIELD'])], [set('SPECIES_SKYLET', 30, ['QUICK_DASH']), set('SPECIES_SKYLET', 30, ['BARK_SHIELD'])]);
    battle.p1.active[1]!.hp = 1;
    // Quick Dash (+1) knocks out the ally first; then Bop, aimed at that ally.
    battle.makeChoices('move 1 -2, move 1', 'move 1 2, move 1');
    expect(battle.p1.active[1]!.fainted).toBe(true);
    const bop = battle.log.find((l) => l.startsWith('|move|p1a: ') && l.includes('|Bop|'))!;
    expect(bop.split('|')[4]).toMatch(/^p2[ab]: /);
    expect(battle.log.some((l) => l.startsWith('|-notarget|'))).toBe(false);
  });

  it('type 19’s owner map (simOwners): Beat Up, Assist and Heal Bell keep to the user’s trainer’s party', () => {
    // Sim moves by id on the fixture's creatures: owner A's members know Ember-like moves, B's Water Gun.
    const raw = (species: string, moves: string[]) => ({ ...set(species, 20, ['BOP']), moves });
    const A = [0, 1, 2].map(() => raw('SPECIES_EMBERKIT', ['beatup', 'assist', 'ember']));
    const B = [0, 1, 2].map(() => raw('SPECIES_DRIPLING', ['watergun', 'healbell']));
    const battle = start(7, [raw('SPECIES_MOSSGROVE', ['softboiled']), raw('SPECIES_MOSSGROVE', ['softboiled'])], [A[0]!, B[0]!, A[1]!, A[2]!, B[1]!, B[2]!]);
    battle.p2.pokemon.forEach((p, i) => simOwners.set(p, i === 0 || i === 2 || i === 3 ? 1 : 3));
    battle.p1.pokemon.forEach((p) => (p.maxhp = p.hp = 2000));
    // Beat Up: one hit per healthy member of A's party (3), not the side's 6.
    battle.makeChoices('move 1, move 1', 'move 1 1, move 1 1');
    expect(Number(battle.log.find((l) => l.startsWith('|-hitcount|'))!.split('|')[3])).toBe(3);
    // Assist: only A's moves.
    const called = new Set<string>();
    for (let t = 0; t < 8; t++) {
      battle.makeChoices('move 1, move 1', 'move 2, move 1 1');
      for (const l of battle.log.slice(-30)) if (l.startsWith('|move|p2a:') && !l.includes('|Assist|')) called.add(l.split('|')[3]!);
    }
    expect(called.size).toBeGreaterThan(0);
    expect([...called].every((m) => m === 'Beat Up' || m === 'Ember')).toBe(true);
    // Heal Bell by B's battler: B's members cured, A's not.
    for (const p of battle.p2.pokemon) if (!p.fainted) p.setStatus('psn');
    battle.makeChoices('move 1, move 1', 'move 3 1, move 2');
    const cured = battle.p2.pokemon.filter((p) => !p.fainted && !p.status).map((p) => simOwners.get(p));
    expect(new Set(cured)).toEqual(new Set([3]));
  });
});
