/** The static and legendary battle commands on a fake field (no ROM): requests, raw results, Giratina's forms. */
import { describe, expect, it } from 'vitest';
import { parseIR, type Id, type Pokemon } from '@opensinnoh/core';
import type { BattleOutcome, Registries } from '@opensinnoh/contracts';
import { Driver, loadFixture, newState, testMon } from './test-support.ts';

const fixture = loadFixture();
const registries = (() => {
  const out = Object.fromEntries(Object.entries(fixture.registries).map(([k, m]) => [k, new Map(m as Map<Id, unknown>)])) as Record<string, Map<Id, unknown>>;
  for (const n of ['A', 'B']) out.vars!.set(`test:VAR_${n}` as Id, { id: `test:VAR_${n}`, sourceIndex: 0x4100 + n.charCodeAt(0), initial: 0, scope: 'saved' });
  // Giratina (decomp SPECIES_GIRATINA 487) with an Origin form of its own stats and ability; the Griseous Orb (ITEM_GRISEOUS_ORB 112).
  const base = fixture.registries.species.get('fixture:SPECIES_MOSSLET' as Id) as object;
  const origin = { ...base, form: 1, name: 'ORIGIN', baseStats: { hp: 45, attack: 80, defense: 30, speed: 45, spAttack: 80, spDefense: 30 }, abilities: ['fixture:ABILITY_BURROW', null] };
  out.species!.set('test:SPECIES_GIRATINA' as Id, { ...base, id: 'test:SPECIES_GIRATINA', sourceIndex: 487, forms: [origin] });
  out.items!.set('test:ITEM_GRISEOUS_ORB' as Id, { ...(fixture.registries.items.get('fixture:ITEM_TONIC' as Id) as object), id: 'test:ITEM_GRISEOUS_ORB', sourceIndex: 112 });
  return out as unknown as Registries;
})();


function run(body: string, outcome: BattleOutcome = 'won', edit: (d: Driver) => void = () => {}) {
  const ir = `test:Script::\n${body
    .trim()
    .split('\n')
    .map((l) => `  ${l.trim()}`)
    .join('\n')}\n  end\n`;
  const labels = new Map([...fixture.labels, ...Object.entries(parseIR(ir).labels).map(([id, commands]) => [id as Id, { pack: 'test', commands }] as const)]);
  const d = new Driver(registries, labels, newState());
  d.field.nextOutcome = outcome;
  edit(d);
  d.vm.start({ label: 'test:Script' as Id, zone: 'fixture:TOWN', source: 'test' });
  d.until(() => !d.vm.running());
  const v = (n: string) => d.state.vars[`test:VAR_${n}` as Id] ?? 0;
  return { d, a: v('A'), b: v('B') };
}

describe('static battles', () => {
  it('start_wild_battle and start_legendary_battle: one scripted wild Pokémon, the level narrowed to u8 (decomp Encounter_NewVsSpeciesAtLevel)', () => {
    const { d } = run('start_wild_battle 2, 300\nstart_legendary_battle 3, 50');
    expect(d.field.battles).toEqual([
      { kind: 'static', trainers: [], wild: [{ species: 'fixture:SPECIES_EMBERKIT', level: 44 }] },
      { kind: 'legendary', trainers: [], wild: [{ species: 'fixture:SPECIES_DRIPLING', level: 50 }] },
    ]);
    expect(d.battles).toEqual([]); // the game logs real battles, not the VM
  });

  it('get_battle_result writes the raw result 1–6 (decomp BATTLE_RESULT_*) and does not clear it; check_won_battle still works', () => {
    const values: Record<BattleOutcome, number> = { won: 1, lost: 2, draw: 3, caught: 4, fled: 5, 'enemy-fled': 6 };
    for (const [outcome, value] of Object.entries(values) as [BattleOutcome, number][]) {
      const r = run('start_legendary_battle 2, 10\ncheck_won_battle var(test:VAR_A)\nget_battle_result var(test:VAR_B)\nget_battle_result var(test:VAR_B)', outcome);
      expect(r.b, outcome).toBe(value);
      expect(r.a, outcome).toBe(outcome === 'lost' || outcome === 'draw' ? 0 : 1);
    }
    expect(() => run('get_battle_result var(test:VAR_A)')).toThrow(/no battle has run/);
  });

  it('start_giratina_origin_battle: Giratina in its Origin form, the Giratina status for any species (decomp Encounter_NewVsGiratinaOrigin)', () => {
    const { d } = run('start_giratina_origin_battle 487, 47\nget_battle_result var(test:VAR_A)\nstart_giratina_origin_battle 2, 47', 'caught');
    expect(d.field.battles).toEqual([
      { kind: 'legendary', trainers: [], wild: [{ species: 'test:SPECIES_GIRATINA', level: 47, form: 1 }], giratina: true },
      { kind: 'legendary', trainers: [], wild: [{ species: 'fixture:SPECIES_EMBERKIT', level: 47 }], giratina: true },
    ]);
  });

  it('set_party_giratina_form: nonzero → every Giratina Origin; 0 → by the held item; ability and stats follow; the Pokédex records it', () => {
    const party = (d: Driver) => {
      const holder = testMon(registries, 'test:SPECIES_GIRATINA', 47);
      holder.heldItem = 'test:ITEM_GRISEOUS_ORB' as Id;
      d.state.party = [testMon(registries, 'test:SPECIES_GIRATINA', 47), holder, testMon(registries, 'fixture:SPECIES_EMBERKIT', 10)];
    };
    const look = (m: Pokemon) => [m.form, m.ability];
    const origin = run('set_party_giratina_form 1', 'won', party).d.state;
    expect(origin.party.map((m) => m.form)).toEqual([1, 1, 0]);
    expect(look(origin.party[0]!)).toEqual([1, 'fixture:ABILITY_BURROW']);
    expect(origin.party[0]!.stats.attack).toBeGreaterThan(origin.party[0]!.stats.defense);
    expect(origin.pokedex.caught).toEqual(['test:SPECIES_GIRATINA']);
    expect(origin.pokedex.forms['test:SPECIES_GIRATINA' as Id]?.map((f) => f.form)).toEqual([1]);
    const altered = run('set_party_giratina_form 1\nset_party_giratina_form 0', 'won', party).d.state;
    expect(altered.party.map((m) => m.form)).toEqual([0, 1, 0]);
    expect(look(altered.party[0]!)).toEqual([0, 'fixture:ABILITY_SPROUT']);
    expect(altered.party[0]!.stats.attack).toBeLessThan(altered.party[1]!.stats.attack);
    expect(altered.pokedex.forms['test:SPECIES_GIRATINA' as Id]?.map((f) => f.form)).toEqual([1, 0]);
  });

  it('activate_roaming_pokemon asks the field for the slot’s roamer', () => {
    expect(run('activate_roaming_pokemon 0').d.field.calls).toContain('activateRoamer 0');
  });
});
