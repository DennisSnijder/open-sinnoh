/** The side systems' commands on a fake field (no ROM): berry patches, the shard tutors, the relearner, the deleter, NPC trades. */
import { describe, expect, it } from 'vitest';
import { parseIR, type Id } from '@opensinnoh/core';
import { giveItem, itemCount, type BerryTables, type MoveTutorTables, type NpcTrade, type Registries } from '@opensinnoh/contracts';
import { emptyBerryPatch } from '@opensinnoh/services';
import { MENU_RESULT } from './menu.ts';
import { Driver, loadFixture, newState, testMon } from './test-support.ts';

const fixture = loadFixture();
const SOIL = 30;
const berries: BerryTables = {
  berries: [{ item: 'test:ITEM_TEST_BERRY' as Id, stageHours: 1, drain: 10, baseYield: 2, sprites: { growing: 'test:G' as Id, blooming: 'test:B' as Id, fruit: 'test:F' as Id }, flavors: [10, 0, 0, 10, 0], smoothness: 25 }],
  patches: [{ item: 'test:ITEM_TEST_BERRY' as Id, yield: 3 }],
  mulches: ['test:ITEM_GROWTH_MULCH', 'test:ITEM_DAMP_MULCH', 'test:ITEM_STABLE_MULCH', 'test:ITEM_GOOEY_MULCH'] as BerryTables['mulches'],
  soil: 'test:SOIL' as Id,
  sprout: 'test:SPROUT' as Id,
  moisture: ['test:DRY0', 'test:DRY1', 'test:DRY2'] as BerryTables['moisture'],
  sprayduck: { male: 'test:M' as Id, female: 'test:F' as Id },
};
const tutors: MoveTutorTables = {
  shards: ['test:ITEM_RED_SHARD', 'test:ITEM_BLUE_SHARD', 'test:ITEM_YELLOW_SHARD', 'test:ITEM_GREEN_SHARD'] as MoveTutorTables['shards'],
  moves: [
    { move: 'fixture:MOVE_LEAF_TAP' as Id, cost: [2, 0, 0, 1], location: 0 },
    { move: 'fixture:MOVE_GUST_PECK' as Id, cost: [0, 4, 0, 0], location: 0 },
    { move: 'fixture:MOVE_DIG_PAW' as Id, cost: [0, 0, 6, 0], location: 1 },
  ],
};
const trade: NpcTrade = {
  species: 'fixture:SPECIES_SKYLET' as Id,
  requested: 'fixture:SPECIES_EMBERKIT' as Id,
  pid: 0x1234,
  otId: 0x5678,
  otName: 'Pell',
  otGender: 'female',
  nickname: 'Breezy',
  ivs: { hp: 15, attack: 16, defense: 17, speed: 18, spAttack: 19, spDefense: 20 },
  heldItem: 'fixture:ITEM_TONIC' as Id,
  language: 2,
  condition: { cool: 5, beauty: 10, cute: 15, smart: 20, tough: 25 },
};
/** Original stand-ins for the records these commands read by constant (sourceIndex). */
const registries = (() => {
  const out = Object.fromEntries(Object.entries(fixture.registries).map(([k, m]) => [k, new Map(m as Map<Id, unknown>)])) as Record<string, Map<Id, unknown>>;
  for (const n of ['A', 'B', 'C', 'D']) out.vars!.set(`test:VAR_${n}` as Id, { id: `test:VAR_${n}`, sourceIndex: 0x4100 + n.charCodeAt(0), initial: 0, scope: 'saved' });
  const tonic = fixture.registries.items.get('fixture:ITEM_TONIC' as Id) as object;
  const item = (name: string, sourceIndex: number, pocket: string) => out.items!.set(`test:${name}` as Id, { ...tonic, id: `test:${name}`, sourceIndex, pocket });
  item('ITEM_TEST_BERRY', 149, 'berries');
  ['GROWTH', 'DAMP', 'STABLE', 'GOOEY'].forEach((m, i) => item(`ITEM_${m}_MULCH`, 95 + i, 'items'));
  ['RED', 'BLUE', 'YELLOW', 'GREEN'].forEach((m, i) => item(`ITEM_${m}_SHARD`, 72 + i, 'items'));
  // Mosslet learns two Route 212 moves and the Survival Area one from the tutors.
  const mosslet = out.species!.get('fixture:SPECIES_MOSSLET' as Id) as object;
  out.species!.set('fixture:SPECIES_MOSSLET' as Id, { ...mosslet, tutorMoves: ['fixture:MOVE_LEAF_TAP', 'fixture:MOVE_GUST_PECK', 'fixture:MOVE_DIG_PAW'] });
  const ng = out.newGame!.get('fixture:NEW_GAME' as Id) as object;
  out.newGame!.set('fixture:NEW_GAME' as Id, { ...ng, berries, moveTutors: tutors, npcTrades: [trade] });
  // A berry soil object in the town (patch 0), and the menu entries bank's shard window lines and EXIT.
  const town = out.zones!.get('fixture:TOWN' as Id) as { events: { objects: object[] } };
  const soil = { localId: SOIL, sprite: berries.soil, movementType: 0, trainerType: 0, label: 'fixture:Town_Guide', facing: 'up', data: [0, 0, 0], range: { x: 0, z: 0 }, x: 40, z: 10, y: 0 };
  out.zones!.set('fixture:TOWN' as Id, { ...town, events: { ...town.events, objects: [...town.events.objects, soil] } });
  const line = (n: number, text: string) => out.texts!.set(`test:MENU_${n}` as Id, { id: `test:MENU_${n}`, text });
  ['Red', 'Blue', 'Yellow', 'Green'].forEach((c, i) => line(273 + i, `${c} Shard`));
  line(277, '{var 0} pieces');
  out.textBanks!.set('test:BANK_361' as Id, { id: 'test:BANK_361', sourceIndex: 361, messages: Array.from({ length: 278 }, (_, i) => `test:MENU_${i}`) });
  out.texts!.set('fixture:MenuEntries_Text_Exit' as Id, { id: 'fixture:MenuEntries_Text_Exit', text: 'LEAVE' });
  return out as unknown as Registries;
})();

function run(body: string, edit: (d: Driver) => void = () => {}, during: (d: Driver) => void = () => {}, lastTalked?: number) {
  const ir = `test:Script::\n${body
    .trim()
    .split('\n')
    .map((l) => `  ${l.trim()}`)
    .join('\n')}\n  end\n`;
  const labels = new Map([...fixture.labels, ...Object.entries(parseIR(ir).labels).map(([id, commands]) => [id as Id, { pack: 'test', commands }] as const)]);
  const state = newState();
  state.berryPatches = [emptyBerryPatch()];
  const d = new Driver(registries, labels, state);
  edit(d);
  d.vm.start({ label: 'test:Script' as Id, zone: 'fixture:TOWN', source: 'test', ...(lastTalked !== undefined ? { lastTalked } : {}) });
  during(d);
  d.until(() => !d.vm.running());
  const v = (n: string) => d.state.vars[`test:VAR_${n}` as Id] ?? 0;
  return { d, v };
}
const soilScript = (body: string, edit?: (d: Driver) => void, during?: (d: Driver) => void) => run(body, edit, during, SOIL);
const mosslet = (moves: string[]) => testMon(registries, 'fixture:SPECIES_MOSSLET', 20, moves);

describe('berry patches (decomp scrcmd_berry.c)', () => {
  it('reads an empty patch, lays mulch, plants (RECORD_BERRIES_PLANTED) and reads the plant', () => {
    const { d, v } = soilScript(`
      get_berry_growth_stage var(test:VAR_A)
      get_berry_item_id var(test:VAR_B)
      set_berry_mulch 96
      plant_berry 149
      get_berry_mulch_type var(test:VAR_C)
      get_berry_moisture var(test:VAR_D)`);
    expect([v('A'), v('B'), v('C'), v('D')]).toEqual([0, 0, 96, 2]);
    expect(d.state.berryPatches[0]).toMatchObject({ berry: 'test:ITEM_TEST_BERRY', stage: 'planted', mulch: 'test:ITEM_DAMP_MULCH', growing: true });
    expect(d.state.records.counts[4]).toBe(1);
  });

  it('waters with the Sprayduck task (the script waits for it), then gives the avatar back', () => {
    const { d } = soilScript('set_berry_watering_state 0\nset_berry_watering_state 1');
    expect(d.field.calls).toEqual(expect.arrayContaining(['startWatering', 'endWatering']));
  });

  it('harvests the fruit into the bag and scores BERRY_HARVESTED; reads the yield first', () => {
    const { d, v } = soilScript(
      'get_berry_yield var(test:VAR_A)\nharvest_berry',
      (d) => (d.state.berryPatches[0] = { ...emptyBerryPatch(), berry: 'test:ITEM_TEST_BERRY' as Id, stage: 'fruit', stageMinutes: 60, yield: 4, moisture: 100, yieldRating: 5, growing: true }),
    );
    expect(v('A')).toBe(4);
    expect(itemCount(d.state, 'test:ITEM_TEST_BERRY' as Id)).toBe(4);
    expect(d.state.berryPatches[0]).toEqual(emptyBerryPatch());
    expect(d.state.records.score).toBeGreaterThan(0);
  });

  it('the script bag: open_bag picks from one pocket (items, berries), get_selected_item reads it (0 for none)', () => {
    const pick = (mode: number, item: Id | null) =>
      run(`open_bag ${mode}\nget_selected_item var(test:VAR_A)`, () => {}, (d) => {
        d.tick();
        expect(d.vm.view().app).toEqual({ app: 'bag-pick', pocket: mode === 0 ? 'items' : 'berries' });
        d.vm.appDone({ app: 'bag-pick', item });
      }).v('A');
    expect(pick(1, 'test:ITEM_TEST_BERRY' as Id)).toBe(149);
    expect(pick(0, null)).toBe(0);
  });

  it('a script on an object that is not berry soil fails loudly', () => {
    expect(() => run('get_berry_growth_stage var(test:VAR_A)', () => {}, () => {}, 0)).toThrow(/is not berry soil/);
  });
});

describe('the shard tutors (decomp scrcmd_move_tutor.c)', () => {
  it('check_has_learnable_tutor_moves: moves of the location it learns and does not know', () => {
    expect(run('check_has_learnable_tutor_moves 0, 0, var(test:VAR_A)', (d) => (d.state.party = [mosslet(['fixture:MOVE_BOP'])])).v('A')).toBe(1);
    expect(run('check_has_learnable_tutor_moves 0, 0, var(test:VAR_A)', (d) => (d.state.party = [mosslet(['fixture:MOVE_LEAF_TAP', 'fixture:MOVE_GUST_PECK'])])).v('A')).toBe(0);
    expect(run('check_has_learnable_tutor_moves 0, 2, var(test:VAR_A)', (d) => (d.state.party = [mosslet(['fixture:MOVE_BOP'])])).v('A')).toBe(0);
  });

  it('the move list: the learnable moves and EXIT at tile 20,1; the pick or MENU_CANCEL goes to the var', () => {
    const choose = (slot: number, presses: ('down' | 'a' | 'b')[]) =>
      run(`show_move_tutor_move_selection_menu ${slot}, 0, var(test:VAR_A)`, (d) => (d.state.party = [mosslet(['fixture:MOVE_LEAF_TAP'])]), (d) => {
        d.until(() => d.vm.view().menu !== null);
        expect(d.vm.view().menu).toMatchObject({ x: 160, y: 8 });
        for (let i = 0; i < 4; i++) d.tick();
        for (const p of presses) d.press(p);
      });
    const one = choose(0, ['a']);
    expect(one.v('A')).toBe(6); // Gust Peck: Leaf Tap is known.
    const all = run('show_move_tutor_move_selection_menu 255, 0, var(test:VAR_A)', () => {}, (d) => {
      d.until(() => d.vm.view().menu !== null);
      expect(d.vm.view().menu!.entries).toEqual(['Leaf Tap', 'Gust Peck', 'LEAVE']);
      for (let i = 0; i < 4; i++) d.tick();
      d.press('b');
    });
    expect(all.v('A')).toBe(MENU_RESULT.cancel);
  });

  it('shard costs: can afford, pay (each colour), and the cost window', () => {
    const afford = (n: number) =>
      run('check_can_afford_move 3, var(test:VAR_A)', (d) => {
        giveItem(d.state, registries, 'test:ITEM_RED_SHARD' as Id, n);
        giveItem(d.state, registries, 'test:ITEM_GREEN_SHARD' as Id, 1);
      }).v('A');
    expect([afford(1), afford(2)]).toEqual([0, 1]);
    const { d } = run('pay_shard_cost 3', (d) => {
      giveItem(d.state, registries, 'test:ITEM_RED_SHARD' as Id, 5);
      giveItem(d.state, registries, 'test:ITEM_GREEN_SHARD' as Id, 1);
    });
    expect([itemCount(d.state, 'test:ITEM_RED_SHARD' as Id), itemCount(d.state, 'test:ITEM_GREEN_SHARD' as Id)]).toEqual([3, 0]);
    run('show_shard_cost 21, 1, 3, var(test:VAR_B)\nwait_ab_press\nclose_shard_cost_window', () => {}, (d) => {
      d.tick();
      expect(d.vm.view().floorWindow).toEqual({
        x: 168, y: 8, width: 80, height: 128,
        lines: [
          { text: 'Red Shard', x: 0, y: 0 }, { text: '  2 pieces', x: 0, y: 16 },
          { text: 'Blue Shard', x: 0, y: 32 }, { text: '  0 pieces', x: 0, y: 48 },
          { text: 'Yellow Shard', x: 0, y: 64 }, { text: '  0 pieces', x: 0, y: 80 },
          { text: 'Green Shard', x: 0, y: 96 }, { text: '  1 pieces', x: 0, y: 112 },
        ],
      });
      d.press('a');
      d.until(() => !d.vm.running());
      expect(d.vm.view().floorWindow).toBeUndefined();
    });
  });

  it('reset_move_slot: the slot gets the move with full PP (the decomp reads the slot second)', () => {
    const { d } = run('reset_move_slot 0, 1, 7', (d) => (d.state.party = [mosslet(['fixture:MOVE_BOP', 'fixture:MOVE_STARE'])]));
    expect(d.state.party[0]!.moves).toEqual(['fixture:MOVE_BOP', 'fixture:MOVE_DIG_PAW']);
    const add = run('reset_move_slot 0, 2, 7', (d) => (d.state.party = [mosslet(['fixture:MOVE_BOP', 'fixture:MOVE_STARE'])])).d;
    expect(add.state.party[0]!.moves).toEqual(['fixture:MOVE_BOP', 'fixture:MOVE_STARE', 'fixture:MOVE_DIG_PAW']);
  });
});

describe('the relearner, the tutor menu and the deleter (decomp scrcmd_party_mon_moves.c)', () => {
  it('check_has_learnable_reminder_moves and open_move_reminder_menu: the level-up moves it forgot; the outcome as 0 or 0xFF', () => {
    const relearn = (learned: boolean) =>
      run('check_has_learnable_reminder_moves var(test:VAR_A), 0\nopen_move_reminder_menu 0\ncheck_learned_reminder_move var(test:VAR_B)', (d) => (d.state.party = [mosslet(['fixture:MOVE_STARE'])]), (d) => {
        d.tick();
        const app = d.vm.view().app as { app: string; moves: Id[]; tutor: boolean };
        expect(app.app).toBe('move-reminder');
        expect(app.tutor).toBe(false);
        expect(app.moves.length).toBeGreaterThan(0);
        expect(app.moves).not.toContain('fixture:MOVE_STARE');
        d.vm.appDone({ app: 'move-reminder', learned });
      });
    expect([relearn(true).v('A'), relearn(true).v('B'), relearn(false).v('B')]).toEqual([1, 0, 0xff]);
  });

  it('open_move_tutor_menu: one move; check_learned_tutor_move', () => {
    const { v } = run('open_move_tutor_menu 0, 7\ncheck_learned_tutor_move var(test:VAR_A)', (d) => (d.state.party = [mosslet(['fixture:MOVE_BOP'])]), (d) => {
      d.tick();
      expect(d.vm.view().app).toEqual({ app: 'move-reminder', slot: 0, moves: ['fixture:MOVE_DIG_PAW'], tutor: true });
      d.vm.appDone({ app: 'move-reminder', learned: true });
    });
    expect(v('A')).toBe(0);
  });

  it('the deleter: select_party_mon_move (the summary with no new move), get_selected_party_mon_move (0xFF for none), clear_party_mon_move_slot shifts the rest up', () => {
    const pick = (slot: number | null) =>
      run('select_party_mon_move 0\nget_selected_party_mon_move var(test:VAR_A)', (d) => (d.state.party = [mosslet(['fixture:MOVE_BOP', 'fixture:MOVE_STARE'])]), (d) => {
        d.tick();
        expect(d.vm.view().app).toEqual({ app: 'summary-teach', slot: 0, move: null });
        d.vm.appDone({ app: 'summary-teach', forget: slot });
      }).v('A');
    expect([pick(1), pick(null)]).toEqual([1, 0xff]);
    const { d } = run('clear_party_mon_move_slot 0, 0', (d) => (d.state.party = [mosslet(['fixture:MOVE_BOP', 'fixture:MOVE_STARE', 'fixture:MOVE_LEAF_TAP'])]));
    expect(d.state.party[0]!.moves).toEqual(['fixture:MOVE_STARE', 'fixture:MOVE_LEAF_TAP']);
    expect(d.state.party[0]!.pp.length).toBe(2);
  });
});

describe('NPC trades (decomp npc_trade.c, ScrCmd_*NPCTrade)', () => {
  it('init, the species asked for and given, the trade itself, finish', () => {
    const { d, v } = run('init_npc_trade 0\nget_npc_trade_requested_species var(test:VAR_A)\nget_npc_trade_species var(test:VAR_B)\nstart_npc_trade 1\nfinish_npc_trade', (d) => (d.state.party = [mosslet(['fixture:MOVE_BOP']), testMon(registries, 'fixture:SPECIES_EMBERKIT', 12, ['fixture:MOVE_BOP'])]), (d) => {
      d.until(() => d.vm.view().app !== null);
      const app = d.vm.view().app as { app: string; sent: { species: Id }; received: { species: Id; nickname: string }; otName: string; background: string };
      expect(app).toMatchObject({ app: 'trade', otName: 'Pell', background: 'day', sent: { species: 'fixture:SPECIES_EMBERKIT' }, received: { species: 'fixture:SPECIES_SKYLET', nickname: 'Breezy' } });
      d.vm.appDone({ app: 'trade' });
    });
    expect([v('A'), v('B')]).toEqual([2, 4]);
    const got = d.state.party[1]!;
    expect(got).toMatchObject({ species: 'fixture:SPECIES_SKYLET', level: 12, pid: 0x1234, otId: 0x5678, otName: 'Pell', otGender: 'female', nickname: 'Breezy', heldItem: 'fixture:ITEM_TONIC', ivs: trade.ivs, met: { zone: null, level: 12 } });
    expect(d.state.pokedex.caught).toContain('fixture:SPECIES_SKYLET');
  });

  it('commands without init_npc_trade fail loudly', () => {
    expect(() => run('get_npc_trade_species var(test:VAR_A)')).toThrow(/no NPC trade loaded/);
  });
});
