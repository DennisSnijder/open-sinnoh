/** The daycare and egg ops on the fixture pack: deposit, the state and price, the egg, hatching. */
import { describe, expect, it } from 'vitest';
import { parseIR, type Id } from '@opensinnoh/core';
import type { Registries } from '@opensinnoh/contracts';
import { Driver, loadFixture, newState, testMon } from './test-support.ts';

const fixture = loadFixture();
const registries = (() => {
  const out = Object.fromEntries(Object.entries(fixture.registries).map(([k, m]) => [k, new Map(m as Map<Id, unknown>)])) as Record<string, Map<Id, unknown>>;
  for (const [name, n] of [['A', 0x4100], ['B', 0x4101], ['C', 0x4102]] as const) out.vars!.set(`test:VAR_${name}` as Id, { id: `test:VAR_${name}`, sourceIndex: n, initial: 0, scope: 'saved' });
  // The town's map label (the fixture's zones have none): the TV's egg segment names it.
  const town = out.zones!.get('fixture:TOWN' as Id) as Record<string, unknown>;
  out.zones!.set('fixture:TOWN' as Id, { ...town, mapPopup: { label: 7, window: 'fixture:ui2d/none', onWarp: false } });
  return out as unknown as Registries;
})();
const v = (name: string) => `var(test:VAR_${name})`;

function driver(ir: string): Driver {
  const labels = new Map([...fixture.labels, ...Object.entries(parseIR(ir).labels).map(([id, commands]) => [id as Id, { pack: 'test', commands }] as const)]);
  return new Driver(registries, labels, newState());
}
function run(d: Driver, label: string) {
  d.vm.start({ label: `test:${label}` as Id, zone: 'fixture:TOWN', source: 'test' });
  d.until(() => !d.vm.running());
}
const value = (d: Driver, name: string) => d.state.vars[`test:VAR_${name}` as Id] ?? 0;

describe('daycare ops', () => {
  it('deposits, reports state, levels, price and compatibility, and gives a Pokémon back', () => {
    const d = driver(`test:In::
  store_party_mon_into_daycare 1
  store_party_mon_into_daycare 1
  get_daycare_state ${v('A')}
  get_daycare_compatibility_level ${v('B')}
  end
test:Price::
  buffer_daycare_price_by_slot ${v('A')}, 0
  buffer_daycare_gained_levels_by_slot ${v('B')}, 0
  end
test:Out::
  move_mon_to_party_from_daycare_slot ${v('A')}, 0
  get_daycare_state ${v('B')}
  end
`);
    const female = testMon(registries, 'fixture:SPECIES_SKYLET', 5);
    const male = testMon(registries, 'fixture:SPECIES_SKYLET', 5);
    female.pid = 0x100; // low byte 0 < 127: female
    male.pid = 0x1ff;
    d.state.party.push(testMon(registries, 'fixture:SPECIES_MOSSLET', 5), female, male);
    run(d, 'In');
    expect(d.state.party.length).toBe(1);
    expect([value(d, 'A'), value(d, 'B')]).toEqual([3, 1]); // two Pokémon; same species and OT: "get along"
    d.state.daycare.mons[0]!.steps = 216 - 100; // Skylet grows quickly: 0.8 n³ → level 6 at 172
    run(d, 'Price');
    expect([value(d, 'A'), value(d, 'B')]).toEqual([200, 1]);
    run(d, 'Out');
    expect(value(d, 'A')).toBe(registries.species.get('fixture:SPECIES_SKYLET' as Id)!.sourceIndex);
    expect(d.state.party[1]).toMatchObject({ pid: 0x100, level: 6 });
    expect(value(d, 'B')).toBe(2);
    expect(d.state.daycare.mons[0]!.mon.pid).toBe(0x1ff);
  });

  it('give_egg makes an egg with the species hatch cycles; hatch_egg hatches the first ready one and opens the scene', () => {
    const d = driver(`test:Egg::
  give_egg 1, 0
  end
test:Hatch::
  hatch_egg
  end
`);
    d.state.party.push(testMon(registries, 'fixture:SPECIES_MOSSLET', 5));
    run(d, 'Egg');
    const egg = d.state.party[1]!;
    expect(egg).toMatchObject({ species: 'fixture:SPECIES_MOSSLET', isEgg: true, friendship: 20, level: 1, met: { level: 0 } });
    egg.friendship = 0;
    d.vm.start({ label: 'test:Hatch' as Id, zone: 'fixture:TOWN', source: 'test' });
    d.tick();
    expect(d.vm.view().app).toEqual({ app: 'hatch', slot: 1 });
    expect(egg).toMatchObject({ isEgg: false, friendship: 120, nickname: null, met: { zone: 'fixture:TOWN', level: 0 } });
    expect(d.state.pokedex.caught).toContain('fixture:SPECIES_MOSSLET');
    // FieldSystem_HatchEgg: the Happy Happy Egg Club's segment, before the hatch.
    expect(d.state.tv.sightings[0]).toEqual({ data: { kind: 'egg', species: 'fixture:SPECIES_MOSSLET', location: 7 }, plays: 0 });
    d.vm.appDone({ app: 'hatch', nickname: 'Sprout' });
    d.until(() => !d.vm.running());
    expect(egg.nickname).toBe('Sprout');
  });

  it('hatch_egg without a ready egg fails loudly', () => {
    const d = driver('test:Hatch::\n  hatch_egg\n  end\n');
    d.vm.start({ label: 'test:Hatch' as Id, zone: 'fixture:TOWN', source: 'test' });
    expect(() => d.tick()).toThrow(/no party egg is ready/);
  });
});
