/** The commands on synthetic IR, synthetic records and a fake field (no ROM). */
import { describe, expect, it } from 'vitest';
import { parseIR, type Id } from '@opensinnoh/core';
import { menuRects, type Registries, type RegistryTypes } from '@opensinnoh/contracts';
import { Driver, loadFixture, newState, testMon } from './test-support.ts';
import { BANKS, BADGES, TRAINER_FLAGS_START } from './ops.ts';
import { poketchApp } from './m3b-poketch-ops.ts';
import { MENU_RESULT } from './menu.ts';

const fixture = loadFixture();

type Recs = { [K in keyof RegistryTypes]?: RegistryTypes[K][] };

function bank(sourceIndex: number, name: string, texts: string[]): Recs {
  const ids = texts.map((_, i) => `test:${name}_${i}` as Id);
  return { textBanks: [{ id: `test:${name}` as Id, sourceIndex, messages: ids }], texts: texts.map((text, i) => ({ id: ids[i]!, text })) };
}

function merge(...parts: Recs[]): Registries {
  const out: Record<string, Map<Id, unknown>> = Object.fromEntries(Object.entries(fixture.registries).map(([k, m]) => [k, new Map(m as Map<Id, unknown>)]));
  for (const p of parts) for (const [k, recs] of Object.entries(p)) for (const r of recs as { id: Id }[]) out[k]!.set(r.id, r);
  return out as unknown as Registries;
}

const town = fixture.registries.zones.get('fixture:TOWN' as Id)!;
const trainerObject = (localId: number, trainer: Id) => ({ ...town.events.objects[0]!, localId, label: 'platinum:scripts_battles/0' as Id, trainer: { id: trainer, battler: 0 as const }, x: 40, z: 14 });

const registries = merge(
  bank(BANKS.menuEntries, 'MENU', ['YES', 'NO', 'Maybe', 'Later', '{var 0}!', 'Header', 'Alt one', 'Alt two']),
  bank(BANKS.counterpartNames, 'COUNTERPART', ['Lucas', 'Dawn']),
  bank(BANKS.poketchAppNames, 'POKETCH', ['Digital Watch', 'Calculator']),
  bank(BANKS.speciesNameWithArticles, 'ARTICLE', ['-', 'a Mosslet', 'an Emberkit', 'a Dripling']),
  { textBanks: [{ id: 'test:RATINGS' as Id, sourceIndex: BANKS.pokedexRatings, messages: ['test:Intro', 'platinum:PokedexRatings_Text_OakPokemonCaughtUnder40', 'platinum:PokedexRatings_Text_RowanPokemonSeenUpTo15'] as Id[] }] },
  { texts: [{ id: 'test:Intro' as Id, text: 'Intro' }, { id: 'platinum:PokedexRatings_Text_OakPokemonCaughtUnder40' as Id, text: 'Oak' }, { id: 'platinum:PokedexRatings_Text_RowanPokemonSeenUpTo15' as Id, text: 'Seen few.' }] },
  bank(900, 'LOCAL', ['Local zero', '{var 0} {var 1} {var 2} {var 3} {var 4}', 'Choice A', 'Choice B', 'One{scroll}Two']),
  {
    vars: [
      { id: 'test:VAR_A' as Id, sourceIndex: 0x8000, initial: 0, scope: 'temp' },
      { id: 'test:VAR_B' as Id, sourceIndex: 0x8001, initial: 0, scope: 'temp' },
      { id: 'test:VAR_C' as Id, sourceIndex: 0x8002, initial: 0, scope: 'temp' },
    ],
    flags: [1, 2].map((n) => ({ id: `test:FLAG_DEFEATED_TRAINER_${n}` as Id, sourceIndex: TRAINER_FLAGS_START + n, initial: false, scope: 'saved' as const })),
    items: [{ ...fixture.registries.items.get('fixture:ITEM_TOWN_GUIDE' as Id)!, id: 'test:ITEM_PARCEL' as Id, sourceIndex: 5, name: 'Parcel' }],
    species: [{ ...fixture.registries.species.get('fixture:SPECIES_BURROWBIT' as Id)!, id: 'test:SPECIES_BIDOOF' as Id, sourceIndex: 399, name: 'Bidoof' }],
    trainers: [
      {
        id: 'test:TRAINER_TWINS' as Id,
        sourceIndex: 2,
        name: 'Twins',
        class: 'test:TRAINER_CLASS_TWINS' as Id,
        double: true,
        gender: 'female',
        party: [{ species: 'fixture:SPECIES_SKYLET' as Id, level: 4, ivs: 0, pid: 0, otId: 0, ballSeal: 0 }],
        items: [],
        ai: 0,
        classPrize: 4,
        className: 'fixture:Text_RivalBefore' as Id,
        messages: { preDoubleBattle1: 'fixture:Text_RivalBefore' as Id },
      },
    ],
    zones: [{ ...town, events: { ...town.events, objects: [...town.events.objects, trainerObject(7, 'fixture:TRAINER_RIVAL_FIRST' as Id), trainerObject(8, 'test:TRAINER_TWINS' as Id)] } }],
  },
);

function drive(ir: string) {
  const labels = new Map([...fixture.labels, ...Object.entries(parseIR(ir).labels).map(([id, commands]) => [id as Id, { pack: 'test', commands }] as const)]);
  return new Driver(registries, labels, newState());
}

const vars = (d: Driver) => d.state.vars;

describe('trainer commands', () => {
  it('an approaching trainer: type and id from the trainer context, approach task, dialogue, stubbed win, flag', () => {
    const d = drive(`
platinum:scripts_battles/9::
  get_approaching_trainer_type var(test:VAR_A)
  get_approaching_trainer_id 0, var(test:VAR_B)
  start_approaching_trainer_task 0
  go_to label(platinum:Wait)
platinum:Wait::
  check_is_approaching_trainer_task_done 0, var(test:VAR_C)
  compare_var_to_value var(test:VAR_C), 0
  go_to_if "eq", label(platinum:Wait)
  open_message
  print_trainer_dialogue var(test:VAR_B), 0
  close_message
  start_trainer_battle var(test:VAR_B), 0
  check_won_battle var(fixture:VAR_RESULT)
  set_trainer_flag var(test:VAR_B)
  check_trainer_flag var(test:VAR_B)
  end
`);
    d.field.approachTicks = 5;
    d.vm.start({ label: 'platinum:scripts_battles/9' as Id, zone: 'fixture:TOWN', source: 'trainer', trainer: { localIds: [7], trainers: ['fixture:TRAINER_RIVAL_FIRST' as Id], sightType: 0 } });
    d.tick();
    expect(d.field.calls).toContain('trainerApproach 7');
    // The dialogue prints after the approach (no button wait: close_message follows at once).
    d.until(() => d.vm.view().message?.text === 'Let us see whose companion is braver!');
    expect(d.ticks).toBeGreaterThanOrEqual(5);
    d.until(() => !d.vm.running());
    expect(d.field.battles).toEqual([{ kind: 'trainer', trainers: ['fixture:TRAINER_RIVAL_FIRST'], wild: [] }]);
    expect(d.state.flags).toEqual({ 'test:FLAG_DEFEATED_TRAINER_1': true });
  });

  it('a talked-to trainer: id from its object event, message types, double, rematch, look code', () => {
    const d = drive(`
platinum:scripts_battles/1::
  get_trainer_id var(test:VAR_A)
  check_is_trainer_double_battle var(test:VAR_B)
  get_trainer_message_types var(test:VAR_C), var(fixture:VAR_RESULT), var(fixture:VAR_SCENE)
  get_movement_type var(fixture:VAR_ROOM_INTRO), 8
  get_rematch_trainer_id var(test:VAR_A), var(fixture:VAR_PLAYER_STARTER)
  set_move_code_for_facing_direction
  call label(platinum:Store)
  end
platinum:Store::
  set_var_from_var var(fixture:VAR_OBJ_GFX_ID_0), var(test:VAR_A)
  set_var_from_var var(fixture:VAR_MAP_LOCAL_0), var(test:VAR_B)
  return
`);
    d.state.objects.push({ zone: 'fixture:TOWN', localId: 8, x: 40, z: 14, y: 0, facing: 'left', movementType: 3 });
    d.state.vars['fixture:VAR_PLAYER_STARTER' as Id] = 9;
    d.vm.start({ label: 'platinum:scripts_battles/1' as Id, zone: 'fixture:TOWN', lastTalked: 8, source: 'object' });
    d.until(() => !d.vm.running());
    expect(vars(d)).toMatchObject({ 'fixture:VAR_OBJ_GFX_ID_0': 2, 'fixture:VAR_MAP_LOCAL_0': 1, 'fixture:VAR_ROOM_INTRO': 3 });
    // TRMSG_PRE_DOUBLE_BATTLE_1, TRMSG_POST_DOUBLE_BATTLE_1, TRMSG_DOUBLE_BATTLE_NOT_ENOUGH_POKEMON_1; no rematch (TRAINER_NONE).
    expect(d.state.vars['fixture:VAR_SCENE' as Id]).toBe(6);
    expect(d.state.vars['fixture:VAR_PLAYER_STARTER' as Id]).toBeUndefined();
    expect(d.field.calls).toContain('switchMovementType 8 16');
  });

  it('trainer commands outside a trainer script fail loudly', () => {
    const d = drive(`
test:NotTrainer::
  get_trainer_id var(test:VAR_A)
  end
`);
    d.vm.start({ label: 'test:NotTrainer', zone: 'fixture:TOWN', lastTalked: 0, source: 'test' });
    expect(() => d.tick()).toThrow(/is not a trainer/);
  });
});

describe('text buffers and messages', () => {
  it('counterpart name, numbers, party species, Pokétch app name, counterpart starter with article, message_var', () => {
    const d = drive(`
test:Buffers::
  buffer_counterpart_name 0
  buffer_number 1, 1234
  buffer_party_mon_species 2, 0
  buffer_poketch_app_name 3, 1
  buffer_player_counterpart_starter_species_name_with_article 4
  set_var_from_value var(test:VAR_A), 1
  message_var var(test:VAR_A), 900
  wait_ab_press
  end
`);
    d.state.party.push(testMon(registries, 'fixture:SPECIES_EMBERKIT', 5));
    d.state.vars['fixture:VAR_PLAYER_STARTER' as Id] = 1; // Mosslet: the counterpart has the starter before it (Dripling)
    d.vm.start({ label: 'test:Buffers', zone: 'fixture:TOWN', source: 'test' });
    d.until(() => d.vm.view().message?.text === 'Dawn 1234 Emberkit Calculator a Dripling');
    // The printer finishes, the script resumes, then wait_ab_press starts waiting.
    d.tick();
    d.tick();
    d.tick();
    d.until(() => d.vm.view().waitsForAB === true);
    expect(d.vm.view().message?.waitingForInput).toBe(false); // wait_ab_press shows no arrow
    d.press('up');
    expect(d.vm.running()).toBe(true);
    d.press('b');
    d.until(() => !d.vm.running());
    expect(d.vm.view().waitsForAB).toBeUndefined();
  });

  it('message_no_skip: A does not speed it up (canSkipDelay FALSE); message_auto_scroll goes past a scroll by itself', () => {
    const ticksPressingA = (op: string) => {
      const d = drive(`test:M::\n  ${op} 0, 900\n  end\n`);
      d.vm.start({ label: 'test:M', zone: 'fixture:TOWN', source: 'test' });
      let n = 0;
      for (; d.vm.running(); n++) d.press('a');
      return n;
    };
    const plain = ticksPressingA('message_var');
    const noSkip = ticksPressingA('message_no_skip');
    expect(noSkip).toBeGreaterThan(plain);
    // 'Local zero': 10 characters at the normal speed, two printer steps a tick.
    expect(noSkip).toBeGreaterThanOrEqual(20);

    const auto = drive('test:A::\n  message_auto_scroll 4, 900\n  end\n');
    auto.vm.start({ label: 'test:A', zone: 'fixture:TOWN', source: 'test' });
    // The scroll waits AUTO_SCROLL_WAIT (100) printer steps, two a tick, instead of a button.
    expect(auto.until(() => !auto.vm.running(), 400)).toBeGreaterThan(50);
    const waits = drive('test:W::\n  message_var 4, 900\n  end\n');
    waits.vm.start({ label: 'test:W', zone: 'fixture:TOWN', source: 'test' });
    expect(() => waits.until(() => !waits.vm.running(), 400)).toThrow('condition not met');
  });

  it('message_var without a bank operand fails loudly', () => {
    const d = drive(`
test:NoBank::
  message_var 0
  end
`);
    d.vm.start({ label: 'test:NoBank', zone: 'fixture:TOWN', source: 'test' });
    expect(() => d.tick()).toThrow(/no text bank/);
  });
});

describe('progress commands', () => {
  it('badges, Pokédex, national dex, dex rating, Pokétch', () => {
    const d = drive(`
test:Progress::
  give_badge 0
  give_badge 0
  check_badge_acquired 0, var(test:VAR_A)
  check_badge_acquired 1, var(test:VAR_B)
  count_badges_acquired var(test:VAR_C)
  call label(test:Store)
  give_pokedex
  get_set_national_dex_enabled 2, var(test:VAR_A)
  load_pokedex_rating 0, var(test:VAR_B)
  get_local_dex_seen_count var(test:VAR_C)
  call label(test:Store2)
  get_set_national_dex_enabled 1, var(test:VAR_A)
  enable_poketch
  register_poketch_app 0
  register_poketch_app 1
  register_poketch_app 0
  check_poketch_app_registered 1, var(test:VAR_A)
  check_poketch_enabled var(test:VAR_B)
  check_poketch_app_registered 2, var(test:VAR_C)
  call label(test:Store3)
  end
test:Store::
  set_var_from_var var(fixture:VAR_SCENE), var(test:VAR_A)
  set_var_from_var var(fixture:VAR_ROOM_INTRO), var(test:VAR_B)
  set_var_from_var var(fixture:VAR_OBJ_GFX_ID_0), var(test:VAR_C)
  return
test:Store2::
  set_var_from_var var(fixture:VAR_MAP_LOCAL_0), var(test:VAR_A)
  set_var_from_var var(fixture:VAR_PLAYER_STARTER), var(test:VAR_B)
  return
test:Store3::
  add_var var(fixture:VAR_SCENE), var(test:VAR_A)
  add_var var(fixture:VAR_SCENE), var(test:VAR_B)
  add_var var(fixture:VAR_SCENE), var(test:VAR_C)
  return
`);
    d.vm.start({ label: 'test:Progress', zone: 'fixture:TOWN', source: 'test' });
    d.until(() => !d.vm.running());
    expect(d.state.badges).toEqual([BADGES[0]]);
    // VAR_SCENE: has badge 0 (1) + 2 (app 1 registered, Pokétch enabled, app 2 not) = 3; badge 1: no; 1 badge.
    expect(vars(d)).toMatchObject({ 'fixture:VAR_SCENE': 3, 'fixture:VAR_OBJ_GFX_ID_0': 1 });
    expect(vars(d)['fixture:VAR_ROOM_INTRO' as Id]).toBeUndefined();
    // No national dex yet (0); the local rating is "up to 15 seen" (message 2 of the ratings bank).
    expect(vars(d)['fixture:VAR_MAP_LOCAL_0' as Id]).toBeUndefined();
    expect(vars(d)['fixture:VAR_PLAYER_STARTER' as Id]).toBe(2);
    expect(d.state.pokedex).toEqual({ obtained: true, national: true, seen: [], caught: [], forms: {} });
    expect(d.state.poketch).toMatchObject({ enabled: true, apps: [poketchApp(0), poketchApp(1)], current: poketchApp(0), steps: 0 });
  });
});

describe('items, party and field commands', () => {
  it('remove_item and check_item; party count and species', () => {
    const d = drive(`
test:Items::
  check_item 5, 2, var(test:VAR_A)
  remove_item 5, 2, var(test:VAR_B)
  check_item 5, 1, var(test:VAR_C)
  set_var_from_var var(fixture:VAR_SCENE), var(test:VAR_A)
  set_var_from_var var(fixture:VAR_ROOM_INTRO), var(test:VAR_B)
  set_var_from_var var(fixture:VAR_OBJ_GFX_ID_0), var(test:VAR_C)
  remove_item 5, 1, var(test:VAR_B)
  get_party_count var(test:VAR_A)
  get_party_mon_species var(fixture:VAR_RESULT), var(fixture:VAR_PLAYER_STARTER)
  set_var_from_var var(fixture:VAR_MAP_LOCAL_0), var(test:VAR_A)
  end
`);
    d.state.bag.key_items!.push({ item: 'test:ITEM_PARCEL' as Id, count: 3 });
    d.state.party.push(testMon(registries, 'fixture:SPECIES_DRIPLING', 5));
    d.vm.start({ label: 'test:Items', zone: 'fixture:TOWN', source: 'test' });
    d.until(() => !d.vm.running());
    expect(vars(d)).toMatchObject({ 'fixture:VAR_SCENE': 1, 'fixture:VAR_ROOM_INTRO': 1, 'fixture:VAR_OBJ_GFX_ID_0': 1, 'fixture:VAR_MAP_LOCAL_0': 1, 'fixture:VAR_PLAYER_STARTER': 3 });
    expect(d.state.bag.key_items).toEqual([]);
  });

  it('player state, live position, camera override, obstacle task', () => {
    const d = drive(`
test:Field::
  set_player_state 1
  change_player_state
  set_player_state 0x100
  change_player_state
  set_player_state 0x40
  change_player_state
  set_position 3, 10, 0, 12, 2
  add_camera_override_object 20, 30
  remove_camera_override_object
  start_destroy_obstacle_animation 1, var(test:VAR_A)
  go_to label(test:Wait)
test:Wait::
  wait_time 1, var(test:VAR_B)
  compare_var_to_value var(test:VAR_A), 0
  go_to_if "eq", label(test:Wait)
  end
`);
    d.field.obstacleTicks = 6;
    d.vm.start({ label: 'test:Field', zone: 'fixture:TOWN', source: 'test' });
    d.until(() => !d.vm.running());
    expect(d.field.calls).toEqual(['setPlayerState walk', 'setPlayerAvatar heal', 'setPositionLive 3 10 12 left', 'addFreeCamera 20 30 false', 'restoreCamera', 'destroyObstacle 1']);
    expect(d.log.keys.get('stub:player-pose')).toBe(1);
    expect(d.ticks).toBeGreaterThanOrEqual(6);
  });
});

describe('scripted menus', () => {
  it('multichoice: 3-tick input delay, no wrap under 4 entries, A picks the entry index', () => {
    const d = drive(`
test:Menu::
  init_global_text_menu 30, 1, 0, 1, var(test:VAR_A)
  set_menu_x_origin_side 1
  add_menu_entry_imm 0, 10
  add_menu_entry_imm 1, 11
  add_menu_entry_imm 2, 12
  show_menu
  set_var_from_var var(fixture:VAR_SCENE), var(test:VAR_A)
  end
`);
    d.vm.start({ label: 'test:Menu', zone: 'fixture:TOWN', source: 'test' });
    d.until(() => d.vm.view().menu !== null);
    const m = d.vm.view().menu!;
    expect(m.entries).toEqual(['YES', 'NO', 'Maybe']);
    // Right-anchored at tile 30: the window ends at 240 px and is a whole number of tiles wide.
    expect(m.x + m.width).toBe(240);
    expect(m.width % 8).toBe(0);
    expect([m.y, m.rows, m.columns, m.top]).toEqual([8, 3, 1, 0]);
    d.press('up'); // ignored: input starts after 3 ticks
    expect(d.vm.view().menu!.cursor).toBe(0);
    d.tick();
    d.tick();
    d.press('up'); // no wrap with 3 entries
    expect(d.vm.view().menu!.cursor).toBe(0);
    d.press('down');
    d.press('down');
    d.press('down');
    expect(d.vm.view().menu!.cursor).toBe(2);
    d.press('a');
    expect(d.vm.view().menu).toBeNull();
    d.until(() => !d.vm.running());
    expect(vars(d)['fixture:VAR_SCENE' as Id]).toBe(12);
  });

  it('B cancels only when allowed; 4+ entries wrap; a tap on the main screen picks an entry; entries use the template', () => {
    const d = drive(`
test:Menu::
  buffer_player_name 0
  init_global_text_menu 1, 1, 0, 0, var(test:VAR_A)
  add_menu_entry_imm 0, 0
  add_menu_entry_imm 1, 1
  add_menu_entry_imm 2, 2
  add_menu_entry_imm 4, 3
  show_menu
  set_var_from_var var(fixture:VAR_SCENE), var(test:VAR_A)
  init_global_text_menu 1, 1, 0, 1, var(test:VAR_A)
  add_menu_entry_imm 0, 0
  show_menu
  set_var_from_var var(fixture:VAR_ROOM_INTRO), var(test:VAR_A)
  end
`);
    d.vm.start({ label: 'test:Menu', zone: 'fixture:TOWN', source: 'test' });
    d.until(() => d.vm.view().menu !== null);
    expect(d.vm.view().menu!.entries[3]).toBe('Ari!');
    d.tick();
    d.tick();
    d.tick();
    d.press('b'); // not allowed
    expect(d.vm.view().menu).not.toBeNull();
    d.press('up'); // wraps to the last entry
    expect(d.vm.view().menu!.cursor).toBe(3);
    const r = menuRects(d.vm.view().menu!)[1]!;
    d.tick({ touch: { x: r.x + 2, y: r.y + 2, screen: 'main' } });
    d.until(() => d.vm.view().menu?.entries.length === 1);
    d.tick();
    d.tick();
    d.tick();
    d.press('b');
    d.until(() => !d.vm.running());
    expect(vars(d)).toMatchObject({ 'fixture:VAR_SCENE': 1, 'fixture:VAR_ROOM_INTRO': MENU_RESULT.cancel });
  });

  it('multi-column menus are column-major and do not wrap', () => {
    const d = drive(`
test:Menu::
  init_global_text_menu 1, 1, 0, 1, var(test:VAR_A)
  add_menu_entry_imm 0, 0
  add_menu_entry_imm 1, 1
  add_menu_entry_imm 2, 2
  add_menu_entry_imm 3, 3
  add_menu_entry_imm 5, 4
  show_menu_multi_column 2
  end
`);
    d.vm.start({ label: 'test:Menu', zone: 'fixture:TOWN', source: 'test' });
    d.until(() => d.vm.view().menu !== null);
    for (let i = 0; i < 3; i++) d.tick();
    expect(d.vm.view().menu).toMatchObject({ columns: 2, rows: 3 });
    d.press('right');
    expect(d.vm.view().menu!.cursor).toBe(3);
    d.press('down');
    expect(d.vm.view().menu!.cursor).toBe(4);
    d.press('down'); // no wrap
    d.press('right'); // no wrap
    expect(d.vm.view().menu!.cursor).toBe(4);
    d.press('down'); // still no slot past the last entry
    d.press('left');
    expect(d.vm.view().menu!.cursor).toBe(1);
    const rects = menuRects(d.vm.view().menu!);
    expect(rects[3]!.x - rects[0]!.x).toBe(d.vm.view().menu!.width);
  });

  it('list menus: local bank, at most 8 rows, scrolling, paging, alt text in the message box', () => {
    const entries = Array.from({ length: 10 }, (_, i) => `  add_list_menu_entry ${2 + (i % 2)}, ${i === 1 ? 0 : 255}, ${i}`).join('\n');
    const d = drive(`
test:List::
  init_local_text_list_menu 1, 1, 0, 1, var(test:VAR_A), 900
${entries}
  show_list_menu
  set_var_from_var var(fixture:VAR_SCENE), var(test:VAR_A)
  end
`);
    d.vm.start({ label: 'test:List', zone: 'fixture:TOWN', source: 'test' });
    d.until(() => d.vm.view().menu !== null);
    for (let i = 0; i < 3; i++) d.tick();
    expect(d.vm.view().menu).toMatchObject({ rows: 8, top: 0, cursor: 0 });
    expect(d.vm.view().menu!.entries.slice(0, 2)).toEqual(['Choice A', 'Choice B']);
    d.press('down');
    expect(d.vm.view().message?.text).toBe('Local zero'); // entry 1's alt text (local bank message 0)
    d.press('right'); // page down
    expect(d.vm.view().menu).toMatchObject({ cursor: 9, top: 2 });
    expect(menuRects(d.vm.view().menu!)[0]).toBeNull();
    d.press('a');
    d.until(() => !d.vm.running());
    expect(vars(d)['fixture:VAR_SCENE' as Id]).toBe(9);
  });
});

describe('signposts', () => {
  it('a map sign slides in 16 px per tick, waits for input, and slides out after the script ends', () => {
    const d = drive(`
test:Sign::
  draw_signpost_instant_message text(fixture:Text_RoomIntro), 0, 0, 0x800c
  set_signpost_command 3
  wait_for_signpost_done
  get_signpost_input var(fixture:VAR_RESULT)
  set_signpost_command 2
  end
`);
      d.vm.start({ label: 'test:Sign', zone: 'fixture:TOWN', source: 'bg' });
    const offsets: number[] = [];
    for (let i = 0; i < 5; i++) {
      d.tick();
      offsets.push(d.vm.view().message?.signpost?.offset ?? -1);
    }
    expect(d.vm.view().message?.signpost?.kind).toBe('map');
    expect(offsets).toEqual([48, 32, 16, 0, 0]);
    // The wait ends one tick later; get_signpost_input starts waiting the tick after.
    d.tick();
    d.tick();
    d.press('a');
    d.until(() => !d.vm.running());
    expect(d.vm.view().message?.signpost?.offset).toBeGreaterThan(0);
    d.until(() => d.vm.view().message === null);
  });
});

describe('stubs with a return value', () => {
  it('an interview with room is eligible, a journal event without an owned journal does nothing; the game records are real (pack limits: even ids high)', () => {
    const d = drive(`
test:Stubs::
  create_journal_event 0, 0, 0, 0, 0
  increment_game_record 3
  increment_game_record 3
  add_to_game_record 34, var(fixture:VAR_SCENE)
  add_to_game_record_big_value 34, 150000
  add_to_game_record_big_value 81, 20000
  check_tv_interview_eligible 1, var(fixture:VAR_SCENE)
  end
`);
    d.state.vars['fixture:VAR_SCENE' as Id] = 5;
    d.vm.start({ label: 'test:Stubs', zone: 'fixture:TOWN', source: 'test' });
    d.until(() => !d.vm.running());
    // TVInterview_IsEligible: an empty interviews list has room, and the unused interview 1 has no check of its own.
    expect(vars(d)['fixture:VAR_SCENE' as Id]).toBe(1);
    expect(d.state.records.counts).toEqual({ 3: 2, 34: 150005, 81: 9999 });
    expect(d.log.keys.get('stub:check_tv_interview_eligible')).toBeUndefined();
    expect(d.log.keys.get('stub:create_journal_event')).toBeUndefined();
    expect(d.state.journal).toEqual([]);
    expect(d.log.keys.get('stub:increment_game_record')).toBeUndefined();
  });
});

describe('sweep ops', () => {
  it('dummies, game completed, hour (the saved clock), tower streak, weather and object height stubs', () => {
    const flag = { id: 'test:FLAG_GAME_COMPLETED' as Id, sourceIndex: 2404, initial: false, scope: 'saved' as const };
    const regs = { ...registries, flags: new Map([...registries.flags, [flag.id, flag]]) } as Registries;
    const labels = new Map([...fixture.labels, ...Object.entries(parseIR(`
test:Sweep::
  dummy1_f9 var(test:VAR_A)
  dummy14_f
  check_game_completed var(test:VAR_A)
  set_game_completed
  check_game_completed var(test:VAR_B)
  get_hour var(fixture:VAR_ROOM_INTRO)
  check_game_completed var(fixture:VAR_PLAYER_STARTER)
  set_var_from_value var(fixture:VAR_SCENE), 9
  scr_cmd_1e0 var(fixture:VAR_SCENE)
  end
`).labels).map(([id, commands]) => [id as Id, { pack: 'test', commands }] as const)]);
    const d = new Driver(regs, labels, newState());
    d.vm.start({ label: 'test:Sweep', zone: 'fixture:TOWN', source: 'test' });
    d.until(() => !d.vm.running());
    expect(vars(d)['fixture:VAR_ROOM_INTRO' as Id]).toBe(12);
    expect(vars(d)['fixture:VAR_PLAYER_STARTER' as Id]).toBe(1);
    expect(d.state.flags['test:FLAG_GAME_COMPLETED' as Id]).toBe(true);
    expect(vars(d)['fixture:VAR_SCENE' as Id]).toBeUndefined();
    expect(d.log.keys.get('stub:scr_cmd_1e0')).toBeUndefined(); // real: no trophy due, 0
    expect([...d.log.keys.keys()].filter((k) => k.startsWith('cmd:'))).toEqual([]);
  });
});

describe('clock ops', () => {
  it('get_time_of_day and get_hour read the saved GameTime; get_day_of_week the live clock', () => {
    const labels = new Map([...fixture.labels, ...Object.entries(parseIR(`
test:Clock::
  get_time_of_day var(fixture:VAR_ROOM_INTRO)
  get_hour var(fixture:VAR_PLAYER_STARTER)
  get_day_of_week var(fixture:VAR_SCENE)
  end
`).labels).map(([id, commands]) => [id as Id, { pack: 'test', commands }] as const)]);
    const run = (hour: number, live: string) => {
      const state = newState();
      state.gameTime.now = { date: '2009-03-22', hour, minute: 59, second: 0 };
      const d = new Driver(registries, labels, state);
      d.clock = { date: live, hour: 3, minute: 0, second: 0 };
      d.vm.start({ label: 'test:Clock', zone: 'fixture:TOWN', source: 'test' });
      d.until(() => !d.vm.running());
      return [vars(d)['fixture:VAR_ROOM_INTRO' as Id] ?? 0, vars(d)['fixture:VAR_PLAYER_STARTER' as Id] ?? 0, vars(d)['fixture:VAR_SCENE' as Id] ?? 0];
    };
    // TIMEOFDAY_* values: morning 0, day 1, twilight 2, night 3, late night 4 (the saved hour, not the live 3:00).
    expect(run(4, '2009-03-22')).toEqual([0, 4, 0]);
    expect(run(16, '2009-03-23')).toEqual([1, 16, 1]);
    expect(run(17, '2009-03-27')).toEqual([2, 17, 5]);
    expect(run(20, '2009-03-28')).toEqual([3, 20, 6]);
    expect(run(3, '2009-03-22')).toEqual([4, 3, 0]);
  });
});

describe('the Villa commands (villa-ops.ts)', () => {
  it('show_list_menu_set_width shows the list at the given width in tiles, the anchors not applied', () => {
    const entries = Array.from({ length: 10 }, (_, i) => `  add_list_menu_entry 2, 255, ${i}`).join('\n');
    const d = drive(`
test:Width::
  init_local_text_list_menu 1, 1, 0, 1, var(test:VAR_A), 900
${entries}
  set_menu_x_origin_side 1
  show_list_menu_set_width 18
  set_var_from_var var(fixture:VAR_SCENE), var(test:VAR_A)
  end
`);
    d.vm.start({ label: 'test:Width', zone: 'fixture:TOWN', source: 'test' });
    d.until(() => d.vm.view().menu !== null);
    expect(d.vm.view().menu).toMatchObject({ x: 8, y: 8, width: 18 * 8, rows: 8 });
    for (let i = 0; i < 3; i++) d.tick();
    d.press('down');
    d.press('down');
    d.press('a');
    d.until(() => !d.vm.running());
    expect(vars(d)['fixture:VAR_SCENE' as Id]).toBe(2);
  });

  it('check_met_furniture_requirements: the gates of the Bust, the Piano and the Chandelier; any other piece TRUE', () => {
    const d = drive(`
test:Gates::
  check_met_furniture_requirements 13, var(test:VAR_A)
  check_met_furniture_requirements 15, var(test:VAR_B)
  check_met_furniture_requirements 20, var(test:VAR_C)
  set_var_from_var var(fixture:VAR_SCENE), var(test:VAR_A)
  set_var_from_var var(fixture:VAR_ROOM_INTRO), var(test:VAR_B)
  set_var_from_var var(fixture:VAR_PLAYER_STARTER), var(test:VAR_C)
  end
`);
    const run = (counts: Record<number, number>) => {
      d.state.records.counts = counts;
      d.vm.start({ label: 'test:Gates', zone: 'fixture:TOWN', source: 'test' });
      d.until(() => !d.vm.running());
      return ['fixture:VAR_SCENE', 'fixture:VAR_ROOM_INTRO', 'fixture:VAR_PLAYER_STARTER'].map((v) => vars(d)[v as Id] ?? 0);
    };
    expect(run({})).toEqual([0, 0, 0]);
    expect(run({ 29: 1, 60: 1, 61: 1, 62: 1, 63: 0, 73: 9, 0: 299999 })).toEqual([0, 0, 0]);
    expect(run({ 29: 1, 60: 1, 61: 1, 62: 1, 63: 1, 73: 10, 0: 300000 })).toEqual([1, 1, 1]);
  });

  it('check_ab_press reads A or B held this frame', () => {
    const d = drive(`
test:Held::
  wait_time 1, var(test:VAR_B)
  check_ab_press var(test:VAR_A)
  set_var_from_var var(fixture:VAR_SCENE), var(test:VAR_A)
  end
`);
    const run = (held: ('a' | 'b' | 'up')[]) => {
      d.vm.start({ label: 'test:Held', zone: 'fixture:TOWN', source: 'test' });
      for (let i = 0; i < 4 && d.vm.running(); i++) d.tick({ held });
      return vars(d)['fixture:VAR_SCENE' as Id] ?? 0;
    };
    expect(run(['up'])).toBe(0);
    expect(run(['b'])).toBe(1);
  });
});
