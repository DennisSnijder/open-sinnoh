/** The form and legendary commands on a fake field (no ROM): Rotom, the titans, the fateful bit, the summary, the tablet. */
import { describe, expect, it } from 'vitest';
import { parseIR, type Id, type Pokemon } from '@opensinnoh/core';
import { grantDevEvent, itemCount, type Registries } from '@opensinnoh/contracts';
import { Driver, loadFixture, newState, testMon } from './test-support.ts';

const fixture = loadFixture();
/** Original stand-ins for the decomp records these commands find by constant (sourceIndex). */
const registries = (() => {
  const out = Object.fromEntries(Object.entries(fixture.registries).map(([k, m]) => [k, new Map(m as Map<Id, unknown>)])) as Record<string, Map<Id, unknown>>;
  for (const n of ['A', 'B', 'C', 'D', 'E']) out.vars!.set(`test:VAR_${n}` as Id, { id: `test:VAR_${n}`, sourceIndex: 0x4100 + n.charCodeAt(0), initial: 0, scope: 'saved' });
  const base = fixture.registries.species.get('fixture:SPECIES_MOSSLET' as Id) as object;
  const species = (name: string, sourceIndex: number, forms: object[] = []) => out.species!.set(`test:${name}` as Id, { ...base, id: `test:${name}`, sourceIndex, ...(forms.length ? { forms } : {}) });
  // Rotom (479) with five appliance forms, each with its own Attack; the titans and Regigigas.
  species('SPECIES_ROTOM', 479, [1, 2, 3, 4, 5].map((form) => ({ ...base, form, baseStats: { hp: 50, attack: 50 + form * 10, defense: 77, speed: 86, spAttack: 105, spDefense: 107 }, abilities: ['fixture:ABILITY_BURROW', null] })));
  for (const [name, n] of [['SPECIES_REGIROCK', 377], ['SPECIES_REGICE', 378], ['SPECIES_REGISTEEL', 379], ['SPECIES_REGIGIGAS', 486]] as const) species(name, n);
  const bop = fixture.registries.moves.get('fixture:MOVE_BOP' as Id) as object;
  for (const [name, n] of [['MOVE_OVERHEAT', 315], ['MOVE_HYDRO_PUMP', 56], ['MOVE_BLIZZARD', 59], ['MOVE_AIR_SLASH', 403], ['MOVE_LEAF_STORM', 437], ['MOVE_THUNDER_SHOCK', 84]] as const) {
    out.moves!.set(`test:${name}` as Id, { ...bop, id: `test:${name}`, sourceIndex: n, pp: 5 });
  }
  // The distribution vars (VAR_DISTRIBUTION_EVENT_DARKRAI 0x4043 …) and the four key items.
  for (const [i, n] of ['DARKRAI', 'SHAYMIN', 'ARCEUS', 'ROTOM'].entries()) out.vars!.set(`test:VAR_DISTRIBUTION_EVENT_${n}` as Id, { id: `test:VAR_DISTRIBUTION_EVENT_${n}`, sourceIndex: 0x4043 + i, initial: 0, scope: 'saved' });
  const key = fixture.registries.items.get('fixture:ITEM_TOWN_GUIDE' as Id) as object;
  for (const [name, n] of [['ITEM_MEMBER_CARD', 454], ['ITEM_OAKS_LETTER', 452], ['ITEM_AZURE_FLUTE', 455], ['ITEM_SECRET_KEY', 467]] as const) out.items!.set(`test:${name}` as Id, { ...key, id: `test:${name}`, sourceIndex: n });
  return out as unknown as Registries;
})();

function run(body: string, edit: (d: Driver) => void = () => {}, during: (d: Driver) => void = () => {}) {
  const ir = `test:Script::\n${body
    .trim()
    .split('\n')
    .map((l) => `  ${l.trim()}`)
    .join('\n')}\n  end\n`;
  const labels = new Map([...fixture.labels, ...Object.entries(parseIR(ir).labels).map(([id, commands]) => [id as Id, { pack: 'test', commands }] as const)]);
  const d = new Driver(registries, labels, newState());
  edit(d);
  d.vm.start({ label: 'test:Script' as Id, zone: 'fixture:TOWN', source: 'test' });
  during(d);
  d.until(() => !d.vm.running());
  const v = (n: string) => d.state.vars[`test:VAR_${n}` as Id] ?? 0;
  return { d, v };
}

const mon = (species: string, moves: string[] = ['fixture:MOVE_BOP']) => testMon(registries, species, 30, moves);
const rotom = (moves: string[], form = 0) => {
  const m = mon('test:SPECIES_ROTOM', moves);
  m.form = form;
  return m;
};

describe('Rotom (decomp ScrCmd_SetRotomForm, GetRotomFormsInSave, GetPartyRotomCountAndFirst)', () => {
  it('set_rotom_form: the form, its stats and ability; the appliance move into a free slot; the Pokédex records the form', () => {
    const { d } = run('set_rotom_form 0, 0, 0, 1', (d) => (d.state.party = [rotom(['fixture:MOVE_BOP'])]));
    const m = d.state.party[0]!;
    expect([m.form, m.ability, m.moves]).toEqual([1, 'fixture:ABILITY_BURROW', ['fixture:MOVE_BOP', 'test:MOVE_OVERHEAT']]);
    expect(m.pp).toEqual([35, 5]);
    expect(m.stats.attack).toBeGreaterThan(mon('test:SPECIES_ROTOM').stats.attack);
    expect(d.state.pokedex.forms['test:SPECIES_ROTOM' as Id]?.map((f) => f.form)).toEqual([1]);
  });

  it('set_rotom_form: an appliance move becomes the new form’s; four moves and none: moveSlot is replaced; back to base drops it (Thunder Shock if none is left)', () => {
    const swap = run('set_rotom_form 0, 3, 0, 4', (d) => (d.state.party = [rotom(['fixture:MOVE_BOP', 'test:MOVE_OVERHEAT', 'fixture:MOVE_STARE'], 1)])).d.state.party[0]!;
    expect([swap.form, swap.moves]).toEqual([4, ['fixture:MOVE_BOP', 'test:MOVE_AIR_SLASH', 'fixture:MOVE_STARE']]);
    const full = run('set_rotom_form 0, 2, 0, 5', (d) => (d.state.party = [rotom(['fixture:MOVE_BOP', 'fixture:MOVE_STARE', 'fixture:MOVE_LEAF_TAP', 'fixture:MOVE_DIG_PAW'])])).d.state.party[0]!;
    expect(full.moves).toEqual(['fixture:MOVE_BOP', 'fixture:MOVE_STARE', 'test:MOVE_LEAF_STORM', 'fixture:MOVE_DIG_PAW']);
    const base = run('set_rotom_form 0, 0, 0, 0', (d) => (d.state.party = [rotom(['test:MOVE_BLIZZARD', 'fixture:MOVE_BOP'], 3)])).d.state.party[0]!;
    expect([base.form, base.moves, base.pp]).toEqual([0, ['fixture:MOVE_BOP'], [35]]);
    const bare = run('set_rotom_form 0, 0, 0, 0', (d) => (d.state.party = [rotom(['test:MOVE_HYDRO_PUMP'], 2)])).d.state.party[0]!;
    expect(bare.moves).toEqual(['test:MOVE_THUNDER_SHOCK']);
  });

  it('get_rotom_forms_in_save: the appliance forms in the party, the Day Care and the PC, eggs left out', () => {
    const { v } = run('get_rotom_forms_in_save var(test:VAR_A), var(test:VAR_B), var(test:VAR_C), var(test:VAR_D), var(test:VAR_E)', (d) => {
      const egg = rotom([], 2);
      egg.isEgg = true;
      d.state.party = [rotom(['fixture:MOVE_BOP'], 1), egg];
      d.state.daycare.mons[0] = { mon: rotom(['fixture:MOVE_BOP'], 3), steps: 0 };
      d.state.boxes = [{ name: 'BOX 1', wallpaper: 0, slots: [null, rotom(['fixture:MOVE_BOP'], 5)] }];
    });
    // Heat (1), Wash (2), Frost (3), Fan (4), Mow (5).
    expect(['A', 'B', 'C', 'D', 'E'].map(v)).toEqual([1, 0, 1, 0, 1]);
  });

  it('get_party_rotom_count_and_first: Rotom in an appliance form only; none → PARTY_SLOT_NONE', () => {
    const r = run('get_party_rotom_count_and_first var(test:VAR_A), var(test:VAR_B)', (d) => (d.state.party = [mon('fixture:SPECIES_EMBERKIT'), rotom(['fixture:MOVE_BOP']), rotom(['fixture:MOVE_BOP'], 2), rotom(['fixture:MOVE_BOP'], 4)]));
    expect([r.v('A'), r.v('B')]).toEqual([2, 2]);
    const none = run('get_party_rotom_count_and_first var(test:VAR_A), var(test:VAR_B)', (d) => (d.state.party = [rotom(['fixture:MOVE_BOP'])]));
    expect([none.v('A'), none.v('B')]).toEqual([0, 0xff]);
  });
});

describe('the titans and Regigigas', () => {
  const titans = () => [mon('test:SPECIES_REGIROCK'), mon('test:SPECIES_REGICE'), mon('test:SPECIES_REGISTEEL')];
  it('check_has_all_legendary_titans_in_party: all three species (decomp HasAllLegendaryTitansInParty)', () => {
    expect(run('check_has_all_legendary_titans_in_party var(test:VAR_A)', (d) => (d.state.party = [mon('fixture:SPECIES_EMBERKIT'), ...titans()])).v('A')).toBe(1);
    expect(run('check_has_all_legendary_titans_in_party var(test:VAR_A)', (d) => (d.state.party = titans().slice(0, 2).concat(mon('test:SPECIES_REGIROCK')))).v('A')).toBe(0);
  });

  it('check_party_has_fateful_encounter_regigigas: a Regigigas with the fateful bit, not an egg; the species alone is not enough', () => {
    const gigas = (fateful: boolean, egg = false): Pokemon => Object.assign(mon('test:SPECIES_REGIGIGAS'), fateful ? { fatefulEncounter: true } : {}, { isEgg: egg });
    expect(run('check_party_has_fateful_encounter_regigigas var(test:VAR_A)', (d) => (d.state.party = [gigas(true)])).v('A')).toBe(1);
    expect(run('check_party_has_fateful_encounter_regigigas var(test:VAR_A)', (d) => (d.state.party = [gigas(false)])).v('A')).toBe(0);
    expect(run('check_party_has_fateful_encounter_regigigas var(test:VAR_A)', (d) => (d.state.party = [gigas(true, true)])).v('A')).toBe(0);
  });

  it('find_party_slot_with_fateful_encounter_species: the first fateful one of the species, not an egg; none → 0xFF', () => {
    const party = (d: Driver) => {
      const egg = Object.assign(mon('test:SPECIES_REGIGIGAS'), { fatefulEncounter: true as const, isEgg: true });
      d.state.party = [mon('test:SPECIES_REGIGIGAS'), egg, Object.assign(mon('test:SPECIES_REGIGIGAS'), { fatefulEncounter: true as const })];
    };
    expect(run('find_party_slot_with_fateful_encounter_species var(test:VAR_A), 486', party).v('A')).toBe(2);
    expect(run('find_party_slot_with_fateful_encounter_species var(test:VAR_A), 486').v('A')).toBe(0xff);
  });

  it('start_fateful_encounter: a legendary wild battle whose Pokémon is fateful (decomp Encounter_NewFatefulVsSpeciesAtLevel)', () => {
    const { d } = run('start_fateful_encounter 486, 300\ncheck_won_battle var(test:VAR_A)');
    expect(d.field.battles).toEqual([{ kind: 'legendary', trainers: [], wild: [{ species: 'test:SPECIES_REGIGIGAS', level: 44, fateful: true }] }]);
  });
});

describe('the summary’s teach-move continuation and Route 224’s tablet', () => {
  it('open_summary_screen_teach_move opens the summary on the move; get_summary_selected_move_slot reads the pick or LEARNED_MOVES_MAX', () => {
    const picks: (number | null)[] = [2, null];
    for (const forget of picks) {
      const { d, v } = run(
        'open_summary_screen_teach_move 0, 437\nget_summary_selected_move_slot var(test:VAR_A)',
        (d) => (d.state.party = [rotom(['fixture:MOVE_BOP', 'fixture:MOVE_STARE', 'fixture:MOVE_LEAF_TAP', 'fixture:MOVE_DIG_PAW'])]),
        (d) => {
          d.tick();
          expect(d.vm.view().app).toEqual({ app: 'summary-teach', slot: 0, move: 'test:MOVE_LEAF_STORM' });
          d.vm.appDone({ app: 'summary-teach', forget });
        },
      );
      expect(v('A')).toBe(forget ?? 4);
      expect(d.state.party[0]!.moves).toHaveLength(4);
    }
    expect(() => run('get_summary_selected_move_slot var(test:VAR_A)')).toThrow(/no summary ran/);
  });

  it('open_shaymin_tablet_naming_screen keeps a word (OK = 0) or keeps the old one on an empty entry (NO_INPUT = 1); buffer_tablet_name reads it', () => {
    const name = (entered: string | null, before?: string) =>
      run(
        'open_shaymin_tablet_naming_screen var(test:VAR_A)\nbuffer_tablet_name 1',
        (d) => {
          if (before) d.state.tabletName = before;
        },
        (d) => {
          d.tick();
          expect(d.vm.view().app).toMatchObject({ app: 'naming', kind: 'tablet', maxLength: 10, pokemon: null });
          d.vm.appDone({ app: 'naming', name: entered });
        },
      );
    const ok = name('Mom');
    expect([ok.v('A'), ok.d.state.tabletName]).toEqual([0, 'Mom']);
    const empty = name(null, 'Rowan');
    expect([empty.v('A'), empty.d.state.tabletName]).toEqual([1, 'Rowan']);
  });

  it('set_player_volume sets the field player’s volume', () => {
    const { d } = run('set_player_volume 0\nset_player_volume 127');
    expect(d.audio.played).toEqual(['field volume 0', 'field volume 127']);
  });
});

describe('the dev-only events (contracts grantDevEvent)', () => {
  it('a distribution sets the ROM’s own var to its magic number and gives the key item once: check_distribution_event reads TRUE', () => {
    const checks = 'check_distribution_event 0, var(test:VAR_A)\ncheck_distribution_event 3, var(test:VAR_B)';
    expect([run(checks).v('A'), run(checks).v('B')]).toEqual([0, 0]);
    const r = run(checks, (d) => {
      grantDevEvent(d.state, registries, 'darkrai');
      grantDevEvent(d.state, registries, 'darkrai');
    });
    expect([r.v('A'), r.v('B')]).toEqual([1, 0]);
    expect(r.d.state.vars['test:VAR_DISTRIBUTION_EVENT_DARKRAI' as Id]).toBe(0x1209);
    expect(itemCount(r.d.state, 'test:ITEM_MEMBER_CARD' as Id)).toBe(1);
    const rotom = run(checks, (d) => grantDevEvent(d.state, registries, 'rotom'));
    expect([rotom.v('A'), rotom.v('B'), itemCount(rotom.d.state, 'test:ITEM_SECRET_KEY' as Id)]).toEqual([0, 1, 1]);
  });

  it('regigigas: a fateful Regigigas joins the party, caught in the Pokédex: the ruins’ check reads TRUE', () => {
    const r = run('check_party_has_fateful_encounter_regigigas var(test:VAR_A)', (d) => grantDevEvent(d.state, registries, 'regigigas'));
    expect(r.v('A')).toBe(1);
    expect(r.d.state.party[0]).toMatchObject({ species: 'test:SPECIES_REGIGIGAS', level: 100, fatefulEncounter: true });
    expect(r.d.state.pokedex.caught).toEqual(['test:SPECIES_REGIGIGAS']);
  });
});
