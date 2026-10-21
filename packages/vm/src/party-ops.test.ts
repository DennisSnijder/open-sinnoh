/** Party, bag, money and Pokédex commands on the fixture's Pokémon data (no ROM). */
import { describe, expect, it } from 'vitest';
import { parseIR, type Id } from '@opensinnoh/core';
import type { Registries } from '@opensinnoh/contracts';
import { Driver, loadFixture, newState, testMon } from './test-support.ts';

const fixture = loadFixture();
const VARS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const registries = (() => {
  const out = Object.fromEntries(Object.entries(fixture.registries).map(([k, m]) => [k, new Map(m as Map<Id, unknown>)])) as Record<string, Map<Id, unknown>>;
  VARS.forEach((n, i) => out.vars!.set(`test:VAR_${n}` as Id, { id: `test:VAR_${n}`, sourceIndex: 0x4100 + i, initial: 0, scope: 'saved' }));
  out.texts!.set('test:Text_Buffer' as Id, { id: 'test:Text_Buffer', text: '{var 0}' });
  return out as unknown as Registries;
})();

/** Runs `body` as one script; returns the driver and the test vars A..H it set. */
function run(body: string, edit: (d: Driver) => void = () => {}) {
  const ir = `test:Script::\n${body
    .trim()
    .split('\n')
    .map((l) => `  ${l.trim()}`)
    .join('\n')}\n  end\n`;
  const labels = new Map([...fixture.labels, ...Object.entries(parseIR(ir).labels).map(([id, commands]) => [id as Id, { pack: 'test', commands }] as const)]);
  const d = new Driver(registries, labels, newState());
  edit(d);
  d.vm.start({ label: 'test:Script' as Id, zone: 'fixture:TOWN', source: 'test' });
  d.until(() => !d.vm.running());
  const v = Object.fromEntries(VARS.map((n) => [n, d.state.vars[`test:VAR_${n}` as Id] ?? 0]));
  return { d, v };
}

const mon = (species: string, level: number, moves: string[] = []) => testMon(registries, `fixture:${species}`, level, moves.map((m) => `fixture:${m}`));

describe('money (TrainerInfo_GiveMoney / TakeMoney clamp at 0 and 999999)', () => {
  it('give, remove and check', () => {
    const { d, v } = run(
      `
give_money 1000
check_money var(test:VAR_A), 4000
check_money var(test:VAR_B), 4001
remove_money 5000
check_money2 var(test:VAR_C), 0
give_money 2000000
`,
    );
    expect([v.A, v.B, v.C]).toEqual([1, 0, 1]);
    expect(d.state.money).toBe(999999);
  });
});

describe('bag', () => {
  it('add_item fills the pocket by item record, remove_item and quantities, TM items, pockets', () => {
    // Items: 1 Lamp Oil (items), 2 Tonic (medicine), 6 Lesson Dig (TM, teaches Dig Paw).
    const { d, v } = run(`
add_item 1, 3, var(test:VAR_A)
add_item 6, 1, var(test:VAR_B)
remove_item 1, 1, var(test:VAR_C)
get_item_quantity 1, var(test:VAR_D)
check_item 2, 1, var(test:VAR_E)
is_item_tmhm 6, var(test:VAR_F)
check_pocket_has_items 3, var(test:VAR_G)
can_fit_item 6, 99, var(test:VAR_H)
`);
    expect(v).toEqual({ A: 1, B: 1, C: 1, D: 2, E: 0, F: 1, G: 1, H: 0 });
    expect(d.state.bag.items).toEqual([{ item: 'fixture:ITEM_LAMP_OIL', count: 2 }]);
    expect(d.state.bag.tmhms).toEqual([{ item: 'fixture:ITEM_LESSON_DIG', count: 1 }]);
  });
});

describe('buffers', () => {
  it('buffer_tmhm_move_name buffers the move a TM teaches', () => {
    const labels = new Map([...fixture.labels, ...Object.entries(parseIR('test:Buf::\n  buffer_tmhm_move_name 0, 6\n  message text(test:Text_Buffer)\n  end\n').labels).map(([id, commands]) => [id as Id, { pack: 'test', commands }] as const)]);
    const d = new Driver(registries, labels, newState());
    d.vm.start({ label: 'test:Buf' as Id, zone: 'fixture:TOWN', source: 'test' });
    d.until(() => d.vm.view().message?.text === 'Dig Paw');
  });
});

describe('party', () => {
  it('give_pokemon makes a real Pokémon (random PID/IVs from the main stream, the player as OT), up to 6', () => {
    const { d, v } = run(`
give_pokemon 1, 7, 2, var(test:VAR_A)
get_party_mon_level var(test:VAR_B), 0
`);
    expect([v.A, v.B]).toEqual([1, 7]);
    const m = d.state.party[0]!;
    expect(m).toMatchObject({ species: 'fixture:SPECIES_MOSSLET', level: 7, heldItem: 'fixture:ITEM_TONIC', otName: 'Ari', otId: d.state.trainerId, ball: 'fixture:ITEM_CAPTURE_ORB', met: { zone: 'fixture:TOWN', level: 7 } });
    expect(m.moves).toEqual(['fixture:MOVE_BOP', 'fixture:MOVE_STARE', 'fixture:MOVE_LEAF_TAP']);
    expect(d.state.pokedex.caught).toEqual(['fixture:SPECIES_MOSSLET']);
    const full = run('give_pokemon 1, 5, 0, var(test:VAR_A)', (x) => (x.state.party = Array.from({ length: 6 }, () => mon('SPECIES_SKYLET', 3))));
    expect([full.v.A, full.d.state.party.length]).toEqual([0, 6]);
  });

  it('party queries: species, eggs, moves, friendship, natures, types, held items', () => {
    const { v } = run(
      `
set_var_from_value var(test:VAR_A), 1
get_party_mon_species var(test:VAR_A), var(test:VAR_B)
count_party_non_eggs var(test:VAR_C)
check_party_mon_has_move var(test:VAR_D), 10, 1
get_party_mon_move_count var(test:VAR_E), 1
find_party_slot_with_species var(test:VAR_F), 4
check_has_two_alive_mons var(test:VAR_G)
get_party_mon_type var(test:VAR_H), var(test:VAR_A), 0
`,
      (d) => {
        d.state.party = [mon('SPECIES_SKYLET', 5), mon('SPECIES_DRIPLING', 12, ['MOVE_SURF']), { ...mon('SPECIES_MOSSLET', 1), isEgg: true }];
        d.state.party[0]!.hp = 0;
      },
    );
    // Dripling (3), 2 non-eggs, Surf (10) known, 1 move, Skylet in slot 0, one alive (Skylet fainted), Skylet types Normal (0) / Flying (4).
    expect(v).toMatchObject({ B: 3, C: 2, D: 1, E: 1, F: 0, G: 0, H: 0, A: 4 });
  });

  it('friendship: Soothe-Bell-less increase, clamp at 255; heal_party', () => {
    const { d } = run('increase_party_mon_friendship 200, 0\nheal_party', (x) => {
      x.state.party = [mon('SPECIES_SKYLET', 5)];
      x.state.party[0]!.hp = 1;
    });
    expect(d.state.party[0]!.friendship).toBe(255);
    expect(d.state.party[0]!.hp).toBe(d.state.party[0]!.stats.hp);
  });
});

describe('Pokédex', () => {
  it('seen and caught sets; local counts read the regional dex', () => {
    // Burrowbit (5) is not in the fixture's regional dex.
    const { d, v } = run(`
set_species_seen 4
set_species_seen 5
check_has_seen_species 4, var(test:VAR_A)
check_has_seen_species 2, var(test:VAR_B)
get_local_dex_seen_count var(test:VAR_C)
get_national_dex_seen_count var(test:VAR_D)
get_national_dex_caught_count var(test:VAR_E)
`);
    expect(v).toMatchObject({ A: 1, B: 0, C: 1, D: 2, E: 0 });
    expect(d.state.pokedex.seen).toEqual(['fixture:SPECIES_SKYLET', 'fixture:SPECIES_BURROWBIT']);
  });
});
