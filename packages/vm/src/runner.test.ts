import { describe, expect, it } from 'vitest';
import { parseIR, type Id } from '@opensinnoh/core';
import { hitChoice, choiceRects } from '@opensinnoh/text';
import { Driver, loadFixture, newState, testMon } from './test-support.ts';
import { coverage, implementedOps } from './coverage.ts';
import { COMMAND_BY_NAME } from './commands.ts';

const fixture = loadFixture();
const driver = () => new Driver(fixture.registries, fixture.labels, newState());

describe('VM on the fixture scripts', () => {
  it('runs the whole guide scene: movement, messages, starter choice by d-pad and touch, yes/no loop', () => {
    const d = driver();
    d.vm.start({ label: 'fixture:Town_GuideScene', zone: 'fixture:TOWN', source: 'coord' });
    expect(d.vm.running()).toBe(true);
    d.readMessage('Wait! You should not walk into\nthe tall grass alone.');
    expect(d.field.calls.slice(0, 3)).toEqual(['lockAll', 'applyMovement 0 fixture:MV_GUIDE_APPROACH', 'applyMovement 255 fixture:MV_PLAYER_FACE_EAST']);
    d.readMessage('Take one of these companions.\nWhich one will you pick?');

    // Starter choice on the panel: move the cursor with the d-pad and confirm with A.
    d.until(() => d.vm.view().panel.kind === 'choice');
    const panel = d.vm.view().panel;
    expect(panel.kind === 'choice' && panel.options.map((o) => o.label)).toEqual(['Mosslet', 'Emberkit', 'Dripling']);
    d.press('down');
    expect(d.vm.view().panel).toMatchObject({ cursor: 1 });
    d.press('a');
    expect(d.vm.view().panel.kind).toBe('idle');

    // "Is this the one?" → No: back to the choice.
    d.until(() => d.vm.view().yesNo !== null);
    expect(d.vm.view().message?.text).toBe('Is this the one you want?');
    d.press('down');
    expect(d.vm.view().yesNo).toEqual({ yes: 'YES', no: 'NO', cursor: 1 });
    d.press('a');
    d.until(() => d.vm.view().panel.kind === 'choice');

    // This time pick by touch: a tap on the third option (touch must be new this tick).
    const r = choiceRects(3)[2]!;
    expect(hitChoice(3, { x: r.x + 1, y: r.y + 1 })).toBe(2);
    d.tick({ touch: { x: r.x + 1, y: r.y + 1 } });
    expect(d.vm.view().panel.kind).toBe('idle');
    d.until(() => d.vm.view().yesNo !== null);
    d.press('a'); // yes

    d.readMessage('Take good care of it, Ari!');
    d.until(() => !d.vm.running());
    expect(d.state.party.map((m) => [m.species, m.level, m.otName, m.met.zone])).toEqual([['fixture:SPECIES_DRIPLING', 5, 'Ari', 'fixture:TOWN']]);
    expect(d.state.pokedex.caught).toEqual(['fixture:SPECIES_DRIPLING']);
    expect(d.state.vars).toEqual({ 'fixture:VAR_PLAYER_STARTER': 3, 'fixture:VAR_SCENE': 1 });
    expect(d.field.calls).toContain('applyMovement 0 fixture:MV_GUIDE_LEAVE');
    expect(d.field.calls.at(-1)).toBe('releaseAll');
    expect(d.vm.view()).toEqual({ message: null, yesNo: null, menu: null, panel: { kind: 'idle', title: '' }, app: null });
  });

  it('Room_Helper branches on its flag', () => {
    const d = driver();
    d.vm.start({ label: 'fixture:Room_Helper', zone: 'fixture:ROOM', lastTalked: 0, source: 'object' });
    d.readMessage('Good morning, Ari!\nThe guide is waiting outside.');
    d.until(() => !d.vm.running());
    expect(d.state.flags).toEqual({ 'fixture:FLAG_TALKED_TO_HELPER': true });
    expect(d.field.calls).toContain('facePlayer 0');
    d.vm.start({ label: 'fixture:Room_Helper', zone: 'fixture:ROOM', lastTalked: 0, source: 'object' });
    d.readMessage('Go on, the guide is east of here.');
    d.until(() => !d.vm.running());
  });

  it('onFrame intro sets its var so it does not fire again', () => {
    const d = driver();
    d.vm.start({ label: 'fixture:Room_OnFrame_Intro', zone: 'fixture:ROOM', source: 'frame' });
    d.readMessage('Morning light fills the room.');
    d.until(() => !d.vm.running());
    expect(d.state.vars['fixture:VAR_ROOM_INTRO']).toBe(1);
  });

  it('runImmediate runs a map script to completion now', () => {
    const d = driver();
    d.vm.runImmediate({ label: 'fixture:Town_OnTransition', zone: 'fixture:TOWN', source: 'transition' });
    expect(d.state.vars).toEqual({ 'fixture:VAR_OBJ_GFX_ID_0': 3, 'fixture:VAR_MAP_LOCAL_0': 1 });
    expect(d.vm.running()).toBe(false);
  });

  it('{clear} waits for a button and starts a new page', () => {
    const d = driver();
    d.vm.start({ label: 'fixture:Room_TV', zone: 'fixture:ROOM', source: 'bg' });
    d.readMessage('A show about lanterns is on.');
    // The press clears the box (and, being a fresh press, arms speed-up); the next tick prints on. As on the DS
    // the cleared window reaches the screen with that next char (render_text.c: VRAM copies on RENDER_PRINT).
    expect(d.vm.view().message?.text).toBe('A show about lanterns is on.');
    d.tick();
    expect(d.vm.view().message?.text).toBe('I');
    d.readMessage('It is very calm.');
  });

  it('prints at the DS normal speed and resumes one tick after a wait ends', () => {
    const d = driver();
    d.vm.start({ label: 'fixture:Room_OnFrame_Intro', zone: 'fixture:ROOM', source: 'frame' });
    d.tick(); // lock_all yields
    d.tick(); // set var, message starts; 2 render calls: first char
    expect(d.vm.view().message?.text).toBe('M');
    d.tick();
    d.tick();
    expect(d.vm.view().message?.text).toBe('Mo'); // 1 char per 4 render calls = per 2 ticks
    // Holding A after a fresh press speeds printing up to one char per render call.
    d.tick({ pressed: ['a'], held: ['a'] });
    const before = d.vm.view().message!.text.length;
    d.tick({ held: ['a'] });
    expect(d.vm.view().message!.text.length).toBe(before + 2);
    d.until(() => d.vm.view().message?.waitingForInput === true);
    // wait_button is waiting; the press is seen on this tick, close_message runs on the next one.
    d.press('a');
    expect(d.vm.view().message).not.toBeNull();
    d.tick();
    expect(d.vm.view().message).toBeNull();
  });
});

describe('VM semantics', () => {
  it('wait_button: a d-pad press turns the player and ends the wait', () => {
    const d = driver();
    d.vm.start({ label: 'fixture:Room_OnFrame_Intro', zone: 'fixture:ROOM', source: 'frame' });
    d.until(() => d.vm.view().message?.waitingForInput === true);
    d.press('left');
    expect(d.field.calls).toContain('turnPlayer left');
    expect(d.vm.view().message?.waitingForInput).toBe(false);
  });

  const run = (ir: string, setup?: (d: Driver) => void) => {
    const labels = new Map([...fixture.labels, ...Object.entries(parseIR(ir).labels).map(([id, commands]) => [id as Id, { pack: 'test', commands }] as const)]);
    const d = new Driver(fixture.registries, labels, newState());
    setup?.(d);
    return d;
  };

  it('script parameters start in VAR_0x8000.. (decomp FieldSystem_SetScriptParameters)', () => {
    const d = run(`
test:Params::
  set_var_from_var var(fixture:VAR_SCENE), var(fixture:VAR_MSG_PRE)
  set_var_from_var var(fixture:VAR_ROOM_INTRO), var(fixture:VAR_MSG_POST)
  end
`);
    d.vm.start({ label: 'test:Params', zone: 'fixture:TOWN', source: 'field-move', params: [3, 9] });
    d.until(() => !d.vm.running());
    expect(d.state.vars).toEqual({ 'fixture:VAR_SCENE': 3, 'fixture:VAR_ROOM_INTRO': 9 });
  });

  it('call stack, conditions, common scripts as a concurrent sub-context', () => {
    const d = run(`
test:Main::
  set_var_from_value var(fixture:VAR_SCENE), 5
  compare_var_to_value var(fixture:VAR_SCENE), 3
  call_if "gt", label(test:Sub)
  call_common_script label(test:Common)
  check_flag flag(fixture:FLAG_HIDE_GUIDE)
  go_to_if "eq", label(test:Flagged)
  end

test:Sub::
  add_var var(fixture:VAR_SCENE), 10
  return

test:Common::
  set_flag flag(fixture:FLAG_HIDE_GUIDE)
  return_common_script
  wait_time 3, var(fixture:VAR_RESULT)
  set_var_from_value var(fixture:VAR_ROOM_INTRO), 7
  end

test:Flagged::
  set_var_from_value var(fixture:VAR_ROOM_INTRO), 9
  end
`);
    d.vm.start({ label: 'test:Main', zone: 'fixture:TOWN', source: 'test' });
    d.tick();
    // Main waits on the sub context, which ran in the same tick until its wait_time.
    expect(d.state.vars['fixture:VAR_SCENE']).toBe(15);
    expect(d.state.flags['fixture:FLAG_HIDE_GUIDE']).toBe(true);
    d.tick(); // main sees return_common_script (resume tick, no command)
    d.tick(); // main runs on: Flagged sets 9
    expect(d.state.vars['fixture:VAR_ROOM_INTRO']).toBe(9);
    expect(d.vm.running()).toBe(true); // sub is still in wait_time
    d.until(() => !d.vm.running());
    expect(d.state.vars['fixture:VAR_ROOM_INTRO']).toBe(7);
  });

  it('a push onto a full call stack is dropped', () => {
    const d = run(`
test:Deep::
  add_var var(fixture:VAR_SCENE), 1
  compare_var_to_value var(fixture:VAR_SCENE), 25
  call_if "lt", label(test:Deep)
  add_var var(fixture:VAR_ROOM_INTRO), 1
  return
`);
    d.vm.start({ label: 'test:Deep', zone: 'fixture:TOWN', source: 'test' });
    d.tick();
    // 19 frames return normally, then the empty-stack return stops the script.
    expect(d.state.vars['fixture:VAR_ROOM_INTRO']).toBe(20);
    expect(d.vm.running()).toBe(false);
  });

  it('logs a dropped call-stack push', () => {
    const d = run(`
test:Deep::
  add_var var(fixture:VAR_SCENE), 1
  compare_var_to_value var(fixture:VAR_SCENE), 25
  call_if "lt", label(test:Deep)
  return
`);
    d.vm.start({ label: 'test:Deep', zone: 'fixture:TOWN', source: 'test' });
    d.tick();
    expect(d.log.keys.get('vm:call-stack-overflow')).toBeGreaterThan(0);
  });

  it('show_start_menu and X in a button wait request the start menu once the script ends', () => {
    const d = run(`
test:Menu::
  show_start_menu
  wait_time 2, var(fixture:VAR_RESULT)
  end
`);
    d.vm.start({ label: 'test:Menu', zone: 'fixture:TOWN', source: 'test' });
    d.tick();
    expect(d.vm.takeStartMenuRequest()).toBe(false);
    d.until(() => !d.vm.running());
    expect(d.vm.takeStartMenuRequest()).toBe(true);
    expect(d.vm.takeStartMenuRequest()).toBe(false);

    const w = driver();
    w.vm.start({ label: 'fixture:Room_OnFrame_Intro', zone: 'fixture:ROOM', source: 'frame' });
    w.until(() => w.vm.view().message?.waitingForInput === true);
    w.press('x');
    w.until(() => !w.vm.running());
    expect(w.vm.takeStartMenuRequest()).toBe(true);
  });

  it('the starter choice is titled with the scene bank prompt; messages print at the text speed option', () => {
    const d = run(`
test:Choose::
  start_choose_starter_scene
  end
`);
    d.vm.start({ label: 'test:Choose', zone: 'fixture:TOWN', source: 'test' });
    d.tick();
    expect(d.vm.view().panel).toMatchObject({ kind: 'choice', title: 'Pick one! Which companion will it be?' });

    const fast = driver();
    fast.textSpeed = 1;
    fast.vm.start({ label: 'fixture:Room_OnFrame_Intro', zone: 'fixture:ROOM', source: 'frame' });
    fast.tick();
    fast.tick();
    fast.tick();
    expect(fast.vm.view().message?.text).toBe('Morn'); // 1 char per render call, 2 per tick
  });

  it('buffer_pocket_name reads the pocket-name text (markup kept); player names are escaped', () => {
    const texts = new Map(fixture.registries.texts);
    // Original stand-ins for the imported pocket-name bank (one message per pocket).
    texts.set('platinum:pl_msg_00000396_00003' as Id, { id: 'platinum:pl_msg_00000396_00003' as Id, text: '{color 2}#{color 0}Tools' });
    texts.set('test:Line' as Id, { id: 'test:Line' as Id, text: '{var 1} put it in {var 0}.' });
    const labels = new Map([...fixture.labels, ...Object.entries(parseIR(`
test:Pocket::
  buffer_pocket_name 0, 3
  buffer_player_name 1
  message text(test:Line)
  wait_button
  end
`).labels).map(([id, commands]) => [id as Id, { pack: 'test', commands }] as const)]);
    const state = newState();
    state.names.player = 'A{b}';
    const d = new Driver({ ...fixture.registries, texts }, labels, state);
    d.vm.start({ label: 'test:Pocket', zone: 'fixture:TOWN', source: 'test' });
    d.readMessage('A{b} put it in #Tools.');
  });

  it('lock_all waits for a moving partner follower, then yields', () => {
    const d = run(`
test:Lock::
  lock_all
  set_var_from_value var(fixture:VAR_SCENE), 1
  end
`);
    d.state.hasPartner = true;
    let moving = 3;
    d.field.objectMoving = () => moving > 0;
    d.vm.start({ label: 'test:Lock', zone: 'fixture:TOWN', source: 'test' });
    d.tick();
    d.tick();
    expect(d.state.vars['fixture:VAR_SCENE']).toBeUndefined();
    moving = 0;
    d.tick(); // the wait ends (resume tick, no command)
    d.tick();
    expect(d.state.vars['fixture:VAR_SCENE']).toBe(1);
  });

  it('heal_party restores HP, status and PP (PP Ups included); eggs are left alone', () => {
    const d = run(`
test:Heal::
  heal_party
  end
`);
    const m = testMon(d.registries, 'fixture:SPECIES_MOSSLET', 10);
    Object.assign(m, { hp: 1, status: 'poison', pp: m.pp.map(() => 0), ppUps: m.ppUps.map(() => 3) });
    d.state.party.push(m);
    d.vm.start({ label: 'test:Heal', zone: 'fixture:TOWN', source: 'test' });
    d.tick();
    expect([m.hp, m.status]).toEqual([m.stats.hp, 'none']);
    expect(m.pp).toEqual([56, 48, 40]); // Bop 35, Stare 30, Leaf Tap 25, each +60% (3 PP Ups)
    expect(d.log.keys.get('stub:heal_party')).toBeUndefined();
  });

  it('unclassified ops log once per op and continue; bucket stubs return 0', () => {
    const d = run(`
test:Unknown::
  set_var_from_value var(fixture:VAR_RESULT), 7
  check_step_flag var(fixture:VAR_RESULT)
  check_step_flag var(fixture:VAR_RESULT)
  set_var_from_value var(fixture:VAR_SCENE), 7
  check_has_enough_mon_for_catching_show var(fixture:VAR_SCENE)
  scr_cmd_1e4 var(fixture:VAR_SCENE)
  end
`);
    d.vm.start({ label: 'test:Unknown', zone: 'fixture:TOWN', source: 'test' });
    d.tick();
    expect(d.vm.running()).toBe(false);
    expect(d.log.keys.get('cmd:check_step_flag')).toBe(2); // StubLog dedupes; the VM reports every hit
    expect(d.log.keys.get('stub:check_has_enough_mon_for_catching_show')).toBe(1);
    expect(d.log.keys.get('stub:scr_cmd_1e4')).toBe(1);
    expect(d.state.vars['fixture:VAR_SCENE']).toBeUndefined(); // the stub returned 0 (the initial value)
  });

});

describe('coverage', () => {
  it('every implemented op is a real command; fixture ops are all implemented', () => {
    for (const op of implementedOps()) expect(COMMAND_BY_NAME.has(op), op).toBe(true);
    const c = coverage([...fixture.labels.values()].map((l) => l.commands));
    expect(c.usedMissing).toEqual([]);
  });

  it('implements the 94 slice commands (research §7)', () => {
    const slice =
      'end wait_time compare_var_to_value call_common_script return_common_script go_to call return go_to_if call_if set_flag clear_flag check_flag add_var set_var_from_value set_var_from_var message wait_button close_message draw_signpost_instant_message draw_signpost_text_box set_signpost_command wait_for_signpost_done draw_signpost_scrolling_message get_signpost_input show_start_menu show_yes_no_menu play_se wait_se play_cry wait_cry play_fanfare wait_fanfare play_music stop_music play_default_music fade_out_bgm set_bgm apply_movement wait_movement lock_all release_all lock_object add_object remove_object add_free_camera restore_camera face_player get_player_map_pos set_object_flag_is_persistent set_movement_type add_item can_fit_item get_item_pocket give_pokemon return_to_field start_choose_starter_scene save_chosen_starter fade_screen wait_fade_screen warp buffer_player_name buffer_rival_name buffer_item_name buffer_pocket_name buffer_rival_starter_species_name get_player_starter_species check_won_battle start_first_battle get_player_gender heal_party give_running_shoes set_has_partner clear_has_partner set_step_flag load_door_animation wait_for_animation unload_animation play_door_open_animation play_door_close_animation set_object_event_pos set_object_event_movement_type set_object_event_dir set_warp_event_pos get_time_of_day get_random get_player_dir init_size_contest_record give_journal randomize_jubilife_lottery init_daily_random_level set_initial_volume_for_sequence check_item_is_plate buffer_item_name_plural'.split(
        ' ',
      );
    expect(slice.length).toBe(94);
    const impl = new Set(implementedOps());
    expect(slice.filter((op) => !impl.has(op))).toEqual([]);
  });
});
