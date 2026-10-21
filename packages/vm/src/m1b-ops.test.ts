/** The field commands on synthetic IR, synthetic records and a fake field (no ROM). */
import { describe, expect, it } from 'vitest';
import { parseIR, type Id } from '@opensinnoh/core';
import type { Registries, RegistryTypes } from '@opensinnoh/contracts';
import { Driver, loadFixture, newState, testMon } from './test-support.ts';
import { FIELD_MOVE_FLAGS, HM_CUT_IN_TICKS, M1B_BANKS, VERSION_PLATINUM, formatNumber, moveNumber } from './m1b-ops.ts';

const fixture = loadFixture();
type Recs = { [K in keyof RegistryTypes]?: RegistryTypes[K][] };

function bank(sourceIndex: number, name: string, texts: string[], ids = texts.map((_, i) => `test:${name}_${i}` as Id)): Recs {
  return { textBanks: [{ id: `test:${name}` as Id, sourceIndex, messages: ids }], texts: texts.map((text, i) => ({ id: ids[i]!, text })) };
}

function merge(...parts: Recs[]): Registries {
  const out: Record<string, Map<Id, unknown>> = Object.fromEntries(Object.entries(fixture.registries).map(([k, m]) => [k, new Map(m as Map<Id, unknown>)]));
  for (const p of parts) for (const [k, recs] of Object.entries(p)) for (const r of recs as { id: Id }[]) out[k]!.set(r.id, r);
  return out as unknown as Registries;
}

const town = fixture.registries.zones.get('fixture:TOWN' as Id)!;
const moveNames = Array.from({ length: 71 }, (_, i) => `Move ${i}`);
moveNames[57] = 'Surf';
moveNames[70] = 'Strength';

const registries = merge(
  bank(M1B_BANKS.moveNames, 'MOVES', moveNames),
  // Entries 15 and 16 are the current-floor window's lines (pl_msg 361).
  bank(
    M1B_BANKS.menuEntries,
    'MENU',
    ['YES', '1F', '2F', 'B1F', ...Array.from({ length: 11 }, () => '-'), 'Current Floor', '{var 0}'],
    ['test:MENU_YES', 'test:MenuEntries_Text_1F', 'test:MenuEntries_Text_2F', 'test:MenuEntries_Text_B1F', ...Array.from({ length: 11 }, (_, i) => `test:MENU_${i + 4}`), 'test:MENU_CURRENT_FLOOR', 'test:MENU_FLOOR'] as Id[],
  ),
  bank(M1B_BANKS.natureNames, 'NATURES', ['Hardy', 'Lonely']),
  bank(M1B_BANKS.ballSealNames, 'SEALS', ['Heart Seal A', 'Heart Seal B']),
  bank(M1B_BANKS.itemNamesPlural, 'PLURAL', ['-', 'Master Balls']),
  bank(M1B_BANKS.berryNames, 'BERRIES', ['Cheri', 'Chesto']),
  bank(M1B_BANKS.npcTrainerNames, 'TRAINER_NAMES', ['-', 'barry', 'Roark']),
  bank(M1B_BANKS.undergroundGoods, 'GOODS', ['Close', 'Bronze Flag']),
  {
    // Moves the party knows (their numbers come from the decomp names: Tackle 33, Pound 1).
    moves: ['TACKLE', 'POUND'].map((n) => ({ ...fixture.registries.moves.get('fixture:MOVE_BOP' as Id)!, id: `fixture:MOVE_${n}` as Id })),
    flags: [
      { id: 'test:FLAG_STRENGTH_ACTIVE' as Id, sourceIndex: FIELD_MOVE_FLAGS.strength, initial: false, scope: 'saved' },
      { id: 'test:FLAG_FLASH_ACTIVE' as Id, sourceIndex: FIELD_MOVE_FLAGS.flash, initial: false, scope: 'saved' },
      { id: 'test:FLAG_DEFOG_ACTIVE' as Id, sourceIndex: FIELD_MOVE_FLAGS.defog, initial: false, scope: 'saved' },
      { id: 'test:FLAG_100' as Id, sourceIndex: 100, initial: false, scope: 'saved' },
    ],
    vars: [
      { id: 'test:VAR_A' as Id, sourceIndex: 0x8000, initial: 0, scope: 'temp' },
      { id: 'test:VAR_B' as Id, sourceIndex: 0x8001, initial: 0, scope: 'temp' },
      ...['X', 'Y', 'Z'].map((n, i) => ({ id: `test:VAR_${n}` as Id, sourceIndex: 0x4100 + i, initial: 0, scope: 'saved' as const })),
      ...[0, 1, 2, 3].map((n) => ({ id: `test:VAR_HIDDEN_LOCATION_${n}` as Id, sourceIndex: 0x4036 + n, initial: 0, scope: 'saved' as const })),
    ],
    zones: [
      { ...town, sourceIndex: 3 },
      { ...town, id: 'test:MAP_HEADER_VEILSTONE_STORE_2F' as Id, sourceIndex: 142, name: 'Veilstone Store' },
      { ...town, id: 'test:MAP_HEADER_JUBILIFE_TV_4F' as Id, sourceIndex: 143, name: 'Jubilife TV' },
    ],
  },
);

function drive(ir: string) {
  const labels = new Map([...fixture.labels, ...Object.entries(parseIR(ir).labels).map(([id, commands]) => [id as Id, { pack: 'test', commands }] as const)]);
  const d = new Driver(registries, labels, newState());
  d.state.party = [testMon(registries, 'fixture:SPECIES_MOSSLET', 10, ['fixture:MOVE_TACKLE']), testMon(registries, 'fixture:SPECIES_DRIPLING', 12, ['fixture:MOVE_POUND', 'fixture:MOVE_SURF'])];
  return d;
}

function run(d: Driver, label: string, max = 200) {
  d.vm.start({ label: label as Id, zone: 'fixture:TOWN' as Id, source: 'test' });
  return d.until(() => !d.vm.running(), max);
}

describe('HM commands', () => {
  it('find_party_slot_with_move finds the first slot that knows the move, else 6', () => {
    const d = drive(`
test:Find::
  find_party_slot_with_move var(test:VAR_X), 57
  set_var_from_var var(test:VAR_Y), var(test:VAR_X)
  find_party_slot_with_move var(test:VAR_X), 70
  end
`);
    run(d, 'test:Find');
    expect(d.state.vars['test:VAR_Y' as Id]).toBe(1);
    expect(d.state.vars['test:VAR_X' as Id]).toBe(6);
    expect(moveNumber('platinum:MOVE_STRENGTH' as Id)).toBe(70);
    expect(() => moveNumber('platinum:MOVE_NOPE' as Id)).toThrow('unknown move');
  });

  it('use_surf / use_waterfall / use_rock_climb start the world task with the slot and wait for it', () => {
    const d = drive(`
test:Surf::
  use_surf 1
  use_waterfall 1
  use_rock_climb 0
  end
`);
    let left = 3;
    d.field.surfDone = () => --left <= 0;
    const ticks = run(d, 'test:Surf');
    expect(d.field.calls).toEqual(['surf 1', 'waterfall 1', 'rockClimb 0']);
    expect(ticks).toBeGreaterThanOrEqual(3);
    expect(() => run(drive('test:Bad::\n  use_surf 4\n  end\n'), 'test:Bad')).toThrow('no party member 4');
  });

  it('do_*_func set, clear and check the field-move flags; 0C3/0C4 clear the weather', () => {
    const d = drive(`
test:Funcs::
  do_strength_func 1
  do_strength_func 2, var(test:VAR_X)
  do_flash_func 1
  do_defog_func 1
  do_defog_func 0
  do_defog_func 2, var(test:VAR_Y)
  scr_cmd_0c3
  end
`);
    d.state.weather = 'fixture:OVERWORLD_WEATHER_DARK_FLASH' as Id;
    run(d, 'test:Funcs');
    expect(d.state.flags).toEqual({ 'test:FLAG_STRENGTH_ACTIVE': true, 'test:FLAG_FLASH_ACTIVE': true });
    expect(d.state.vars['test:VAR_X' as Id]).toBe(1);
    expect(d.state.vars['test:VAR_Y' as Id]).toBeUndefined();
    expect(d.state.weather).toBe('fixture:OVERWORLD_WEATHER_CLEAR');
    expect(d.field.calls).toEqual(['setWeather fixture:OVERWORLD_WEATHER_CLEAR']);
  });

  it('play_hm_cut_in waits the cut-in length and logs that it is not drawn', () => {
    const d = drive('test:CutIn::\n  play_hm_cut_in 0\n  end\n');
    const ticks = run(d, 'test:CutIn');
    expect(ticks).toBe(HM_CUT_IN_TICKS + 2); // the command tick, the wait, the resume tick, then end
    expect(d.field.hmCutInDone()).toBe(true);
  });
});

describe('camera, objects and the bike', () => {
  it('move_camera, shake_object (waits), hide/show_object', () => {
    const d = drive(`
test:Cam::
  move_camera 8, 0, 0
  shake_object 3, 8, 90, 4, 0
  hide_object 255
  show_object 3
  end
`);
    let left = 4;
    d.field.shakeObjectDone = () => --left <= 0;
    const ticks = run(d, 'test:Cam');
    expect(d.field.calls).toEqual(['moveCamera 8 0 0', 'shakeObject 3 8 90 4 0', 'setObjectVisible 255 false', 'setObjectVisible 3 true']);
    expect(ticks).toBeGreaterThanOrEqual(4);
  });

  it('flicker_object toggles visibility every delay+1 ticks, times flips, then resumes', () => {
    const d = drive('test:Flicker::\n  flicker_object 2, 2, 1\n  end\n');
    run(d, 'test:Flicker');
    // Decomp Task_FlickerMapObject: set, (timer 0→1) set, flip; set, set, flip; set, set, flip and stop.
    expect(d.field.calls).toEqual(['true', 'true', 'false', 'false', 'true', 'true'].map((x) => `setObjectVisible 2 ${x}`));
  });

  it('set_player_bike switches the player state; check_player_on_bike reads it', () => {
    const d = drive(`
test:Bike::
  set_player_bike 1
  check_player_on_bike var(test:VAR_X)
  set_player_bike 0
  check_player_on_bike var(test:VAR_Y)
  end
`);
    run(d, 'test:Bike');
    expect(d.field.calls).toEqual(['setPlayerState cycle', 'setPlayerState walk']);
    expect(d.state.vars['test:VAR_X' as Id]).toBe(1);
    expect(d.state.vars['test:VAR_Y' as Id]).toBeUndefined();
  });
});

describe('locations, elevators and weather', () => {
  it('set_special_location stores the dynamic warp target; get_floors_above reads its map; the elevator waits', () => {
    const d = drive(`
test:Elevator::
  get_floors_above var(test:VAR_Y)
  set_special_location 142, 2, 18, 2, 1
  get_floors_above var(test:VAR_X)
  play_elevator_animation 1, 4
  set_special_location 143, 65535, 5, 6, 3
  end
`);
    let left = 5;
    d.field.elevatorDone = () => --left <= 0;
    d.vm.start({ label: 'test:Elevator' as Id, zone: 'fixture:TOWN' as Id, source: 'test' });
    d.tick();
    expect(d.state.specialLocation).toEqual({ zone: 'test:MAP_HEADER_VEILSTONE_STORE_2F', warp: 2, x: 18, z: 2, facing: 'down' });
    expect(d.state.vars['test:VAR_Y' as Id]).toBe(1); // no special location yet: the decomp default
    expect(d.state.vars['test:VAR_X' as Id]).toBe(3);
    expect(d.field.calls).toEqual(['elevator down 4']);
    d.until(() => !d.vm.running());
    expect(d.state.specialLocation).toEqual({ zone: 'test:MAP_HEADER_JUBILIFE_TV_4F', warp: -1, x: 5, z: 6, facing: 'right' });
  });

  it('get_overworld_weather, get_current_map_id, set_hidden_location, get_game_version, set_flag_from_var', () => {
    const d = drive(`
test:Sys::
  get_overworld_weather var(test:VAR_A)
  get_current_map_id var(test:VAR_B)
  set_var_from_var var(test:VAR_Y), var(test:VAR_A)
  set_var_from_var var(test:VAR_Z), var(test:VAR_B)
  set_hidden_location 1, 1
  set_hidden_location 3, 1
  set_hidden_location 3, 0
  get_game_version var(test:VAR_X)
  set_var_from_value var(test:VAR_A), 100
  set_flag_from_var var(test:VAR_A)
  check_heap_memory 0
  wait_for_transition
  end
`);
    d.state.weather = 'fixture:OVERWORLD_WEATHER_FOG' as Id;
    run(d, 'test:Sys');
    expect(d.state.vars).toMatchObject({ 'test:VAR_Y': 14, 'test:VAR_Z': 3, 'test:VAR_HIDDEN_LOCATION_1': 0x0229, 'test:VAR_X': VERSION_PLATINUM });
    expect(d.state.vars['test:VAR_HIDDEN_LOCATION_3' as Id]).toBeUndefined();
    expect(d.state.flags['test:FLAG_100' as Id]).toBe(true);
  });
});

describe('the 0.12.0 field members (Cycling Road, heights, bg events, previous map, platform lifts)', () => {
  it('release_object, force_bicycling, set_player_height_calculation_enabled (yields), set_bg_event_pos, get_player_state', () => {
    const d = drive(`
test:Field::
  release_object 255
  force_bicycling 1
  set_player_height_calculation_enabled 0
  set_bg_event_pos 2, 30, 40
  get_player_state var(test:VAR_X)
  end
`);
    d.state.playerState = 'surf';
    const ticks = run(d, 'test:Field');
    expect(d.field.calls).toEqual(['releaseObject 255', 'forceBicycling true', 'setPlayerHeightCalculation false', 'setBgEventPosition 2 30 40']);
    expect(ticks).toBe(2);
    expect(d.state.vars['test:VAR_X' as Id]).toBe(2);
  });

  it('get_previous_map_id: the zone left by the last warp, 0 before any', () => {
    const d = drive(`
test:Prev::
  get_previous_map_id var(test:VAR_X)
  set_var_from_var var(test:VAR_Y), var(test:VAR_X)
  end
`);
    run(d, 'test:Prev');
    expect(d.state.vars['test:VAR_Y' as Id] ?? 0).toBe(0);
    d.state.previousZone = 'test:MAP_HEADER_JUBILIFE_TV_4F' as Id;
    run(d, 'test:Prev');
    expect(d.state.vars['test:VAR_Y' as Id]).toBe(143);
  });

  it('the platform lift: init, the not-used check, and trigger_platform_lift waits for the ride', () => {
    const d = drive(`
test:Lift::
  init_persisted_map_features_for_platform_lift
  check_platform_lift_not_used_when_entered_map var(test:VAR_X)
  trigger_platform_lift
  end
`);
    d.field.liftNotUsed = false;
    d.field.liftTicks = 30;
    const ticks = run(d, 'test:Lift');
    expect(d.field.calls).toEqual(['initPlatformLift', 'triggerPlatformLift']);
    expect(d.state.vars['test:VAR_X' as Id] ?? 0).toBe(0);
    expect(ticks).toBeGreaterThanOrEqual(30);
  });
});

describe('text buffers', () => {
  it('bank buffers, floors, map and species names, numbers and capitalisation', () => {
    const d = drive(`
test:Buffers::
  buffer_move_name 0, 57
  buffer_party_move_name 1, 1, 1
  buffer_party_mon_nickname 2, 0
  buffer_nature_name 3, 1
  buffer_ball_seal_name 4, 2
  buffer_item_name_plural 5, 1
  buffer_berry_name 6, 150, 0
  buffer_trainer_name 7, 2
  message text(test:Out)
  wait_button
  buffer_floor_number 0, 0
  buffer_floor_number 1, 2
  buffer_map_name 2, 142
  buffer_species_name_from_var 3, 3, 0, 0
  buffer_value_padding_digits 4, 7, 2, 3
  buffer_var_padding_digits 5, 42, 1, 4
  buffer_underground_goods_name 6, 1
  buffer_trainer_name 7, 1
  capitalize_first_letter 7
  message text(test:Out)
  wait_button
  end
`);
    const reg = d.registries as unknown as { texts: Map<Id, { id: Id; text: string }> };
    reg.texts.set('test:Out' as Id, { id: 'test:Out' as Id, text: '{var 0}|{var 1}|{var 2}|{var 3}|{var 4}|{var 5}|{var 6}|{var 7}' });
    d.vm.start({ label: 'test:Buffers' as Id, zone: 'fixture:TOWN' as Id, source: 'test' });
    d.readMessage('Surf|Surf|Mosslet|Lonely|Heart Seal B|Master Balls|Chesto|Roark');
    d.readMessage('B1F|2F|Veilstone Store|Dripling|007|  42|Bronze Flag|Barry');
    d.until(() => !d.vm.running());
  });

  it('formatNumber pads like StringTemplate_SetNumber', () => {
    expect(formatNumber(5, 0, 3)).toBe('5');
    expect(formatNumber(5, 1, 3)).toBe('  5');
    expect(formatNumber(5, 2, 3)).toBe('005');
    expect(() => formatNumber(5, 3, 3)).toThrow('bad padding mode');
  });
});

describe('show_current_floor (decomp FieldMenu_ShowCurrentFloorWindow)', () => {
  it('opens the window with the buffered floor, zeroes its var, and closes when the var becomes 0xFFFF', () => {
    const d = drive(`
test:Elevator::
  set_var_from_value var(test:VAR_Y), 3
  buffer_floor_number 0, 2
  show_current_floor 20, 1, var(test:VAR_Y), var(test:VAR_Y)
  wait_time 1, var(test:VAR_A)
  set_var_from_var var(test:VAR_X), var(test:VAR_Y)
  wait_time 3, var(test:VAR_A)
  set_var_from_value var(test:VAR_Y), 0xffff
  wait_time 1, var(test:VAR_A)
  end
`);
    d.vm.start({ label: 'test:Elevator' as Id, zone: 'fixture:TOWN' as Id, source: 'test' });
    d.until(() => !!d.vm.view().floorWindow);
    expect(d.vm.view().floorWindow).toEqual({
      x: 160,
      y: 8,
      width: 88,
      height: 32,
      lines: [
        { text: 'Current Floor', x: 0, y: 0 },
        { text: '2F', x: 32, y: 16 },
      ],
    });
    d.until(() => !d.vm.view().floorWindow);
    expect(d.state.vars['test:VAR_X' as Id] ?? 0).toBe(0);
    expect(d.vm.running()).toBe(true);
    d.until(() => !d.vm.running());
    expect(d.log.keys.has('ui:current-floor-window')).toBe(false);
  });
});
