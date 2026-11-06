/**
 * The critical-path commands: trainers, text buffers, progress (badges,
 * Pokédex, Pokétch), items and party, field, scripted menus, and stubs with a return value. Each follows the
 * decomp handler (src/scrcmd*.c); a handler returns 'yield' where the decomp returns TRUE.
 *
 * The battle commands are in m2a-ops.ts.
 */
import { dayOfWeek, type Arg, type Id } from '@opensinnoh/core';
import type { Facing, InputFrame } from '@opensinnoh/contracts';
import { TEXT_SPEED, TextPrinter, plainMarkup, toPrintOps } from '@opensinnoh/text';
import { LIST_HEADER, MENU_RESULT, NO_ALT_TEXT, ScriptMenu, type MenuKind } from './menu.ts';
import type { Context, Handler, Result, Runner, Thread } from './runner.ts';

/** pl_msg banks the commands read by number (decomp TEXT_BANK_*; `textBanks` sourceIndex). */
export const BANKS = { chooseStarter: 360, menuEntries: 361, pokedexRatings: 383, speciesNameWithArticles: 413, poketchAppNames: 457, counterpartNames: 553 } as const;
/** Decomp TRAINER_DEFEATED_FLAGS_START: the defeated flag of trainer N is flag START + N. */
export const TRAINER_FLAGS_START = 1360;
/** Decomp sBadgeIDs order = BADGE_ID_* values. */
export const BADGES = ['COAL', 'FOREST', 'COBBLE', 'FEN', 'RELIC', 'MINE', 'ICICLE', 'BEACON'].map((b) => `platinum:BADGE_ID_${b}` as Id);
/** Decomp enum TrainerMessageType (generated/trainer_message_types.txt), as the importer's message kinds. */
const TRMSG = [
  'PRE_BATTLE', 'DEFEAT', 'POST_BATTLE', 'PRE_DOUBLE_BATTLE_1', 'DOUBLE_BATTLE_DEFEAT_1', 'POST_DOUBLE_BATTLE_1', 'DOUBLE_BATTLE_NOT_ENOUGH_POKEMON_1',
  'PRE_DOUBLE_BATTLE_2', 'DOUBLE_BATTLE_DEFEAT_2', 'POST_DOUBLE_BATTLE_2', 'DOUBLE_BATTLE_NOT_ENOUGH_POKEMON_2', 'NOT_MORNING_UNUSED', 'NOT_NIGHT_UNUSED',
  'FIRST_DAMAGE', 'ACTIVE_BATTLER_HALF_HP', 'LAST_BATTLER', 'LAST_BATTLER_HALF_HP', 'REMATCH', 'DOUBLE_BATTLE_REMATCH_1', 'DOUBLE_BATTLE_REMATCH_2',
];
const TRMSG_IDS = Object.fromEntries(TRMSG.map((n, i) => [n, i])) as Record<string, number>;
export const trainerMessageKind = (type: number): string => {
  const name = type === 100 ? 'WIN' : TRMSG[type];
  if (!name) throw new Error(`unknown trainer message type ${type}`);
  return name.toLowerCase().replace(/_([a-z0-9])/g, (_, ch: string) => ch.toUpperCase());
};
/** Player request bits (decomp generated/player_transitions.txt, 1 << index). */
const PLAYER_TRANSITION = { walking: 1 << 0, cycling: 1 << 1, surfing: 1 << 2, healing: 1 << 8 } as const;
/** Decomp MOVEMENT_TYPE_LOOK_NORTH..EAST (VsSeeker_SetMoveCodeForFacingDirection). */
const LOOK_TYPE: Record<Facing, number> = { up: 14, down: 15, left: 16, right: 17 };
const DIRS: Facing[] = ['up', 'down', 'left', 'right'];
/** Decomp FLAG_GAME_COMPLETED (generated/vars_flags.txt): the flag's `flags` sourceIndex. */
const FLAG_GAME_COMPLETED = 2404;

export function m1aHandlers(r: Runner): Record<string, Handler> {
  const dest = (t: Thread, a: Arg | undefined, v: number) => r.setVar(t, r.ref(a, 'var'), v);
  const val = (t: Thread, a: Arg | undefined) => r.val(t, a);
  const int = (a: Arg | undefined) => r.int(a);
  const stub = (key: string, detail: string) => r.log.stub(`stub:${key}`, detail);
  const slot = (t: Thread, a: Arg | undefined, markup: string) => void (t.slots[int(a)] = markup);
  const trainer = (id: number) => r.registries.trainers.get(r.source('trainers', id)!)!;
  const trainerFlag = (id: number) => r.source('flags', TRAINER_FLAGS_START + id)!;

  const sourceOf = (id: Id) => {
    const tr = r.registries.trainers.get(id);
    if (tr?.sourceIndex === undefined) throw new Error(`trainer ${id} has no sourceIndex`);
    return tr.sourceIndex;
  };
  /**
   * The trainer of the talked-to object and its side of a double pair (decomp Script_GetTrainerID and
   * Script_GetTrainerBattlerIndex on the trainer script id 3000+/5000+, imported as `ObjectEvent.trainer`).
   */
  const scriptTrainerRef = (t: Thread) => {
    const zone = r.registries.zones.get(t.zone);
    const ev = t.lastTalked === undefined ? undefined : zone?.events.objects.find((o) => o.localId === t.lastTalked);
    if (!ev?.trainer) throw new Error(`script ${t.label}: object ${t.lastTalked ?? '(none)'} of ${t.zone} is not a trainer`);
    return ev.trainer;
  };
  const scriptTrainer = (t: Thread) => sourceOf(scriptTrainerRef(t).id);
  const approaching = (t: Thread, n: number) => {
    const localId = t.trainer?.localIds[n];
    if (localId === undefined) throw new Error(`no approaching trainer ${n} (the script was started without a trainer context)`);
    return localId;
  };
  const approachingTrainer = (t: Thread, n: number) => {
    const id = t.trainer?.trainers[n];
    if (id === undefined) throw new Error(`no approaching trainer ${n} (the script was started without a trainer context)`);
    return sourceOf(id);
  };
  const liveObject = (localId: number) => r.state.objects.find((o) => o.localId === localId && o.zone === r.state.player.zone);

  const showText = (t: Thread, c: Context, text: Id): Result => {
    const p = r.showMessage(t, text, r.textSpeed());
    return r.pause(c, () => p.done);
  };
  const localBank = (a: Arg | undefined, op: string) => {
    if (a?.kind !== 'int') throw new Error(`${op}: no text bank operand (a map script with no known bank)`);
    return a.value;
  };
  /** A menu entry: the bank message formatted with the template slots, as plain text. */
  const entryText = (t: Thread, bank: number, index: number) =>
    toPrintOps(r.textOf(r.bankText(bank, index)), t.slots)
      .map((op) => (op.kind === 'char' ? op.c : ''))
      .join('');

  // ---------------------------------------------------------------- menus
  const menu = () => {
    const m = r.ui.menu;
    if (!m) throw new Error('no scripted menu (init_*_text_menu first)');
    return m;
  };
  const initMenu = (bank: (a: Arg[]) => number): Handler => (t, _c, a) => {
    const v = r.ref(a[4], 'var');
    r.ui.menu = new ScriptMenu({ x: int(a[0]), y: int(a[1]) }, int(a[2]), int(a[3]) === 1, bank(a));
    t.menuVar = v;
    r.setVar(t, v, MENU_RESULT.pending);
    return 'yield';
  };
  const showMenu = (kind: MenuKind, columns?: (a: Arg[]) => number): Handler => (t, c, a) => showScriptMenu(r, t, c, menu(), kind, columns?.(a));

  return {
    // ---------------------------------------------------------------- trainers
    get_approaching_trainer_id: (t, _c, a) => (dest(t, a[1], approachingTrainer(t, val(t, a[0]))), 'continue'),
    get_approaching_trainer_type: (t, _c, a) => {
      if (!t.trainer) throw new Error('get_approaching_trainer_type without a trainer context');
      dest(t, a[0], t.trainer.sightType);
      return 'continue';
    },
    start_approaching_trainer_task: (t, _c, a) => {
      const n = val(t, a[0]);
      r.field.trainerApproach(approaching(t, n));
      t.approaching[n] = true;
      return 'continue';
    },
    check_is_approaching_trainer_task_done: (t, _c, a) => {
      const n = val(t, a[0]);
      let done = !t.approaching[n];
      if (!done && r.field.trainerApproachDone()) {
        t.approaching[n] = false;
        done = true;
      }
      dest(t, a[1], done ? 1 : 0);
      return 'yield';
    },
    get_trainer_id: (t, _c, a) => (dest(t, a[0], scriptTrainer(t)), 'continue'),
    check_is_trainer_double_battle: (t, _c, a) => (dest(t, a[0], trainer(scriptTrainer(t)).double ? 1 : 0), 'continue'),
    get_trainer_message_types: (t, _c, a) => {
      const k = scriptTrainerRef(t).battler + 1;
      const types = trainer(scriptTrainer(t)).double ? [TRMSG_IDS[`PRE_DOUBLE_BATTLE_${k}`]!, TRMSG_IDS[`POST_DOUBLE_BATTLE_${k}`]!, TRMSG_IDS[`DOUBLE_BATTLE_NOT_ENOUGH_POKEMON_${k}`]!] : [TRMSG_IDS.PRE_BATTLE!, TRMSG_IDS.POST_BATTLE!, 0];
      types.forEach((v, i) => dest(t, a[i], v));
      return 'continue';
    },
    get_trainer_rematch_message_types: (t, _c, a) => {
      const k = scriptTrainerRef(t).battler + 1;
      const types = trainer(scriptTrainer(t)).double ? [TRMSG_IDS[`DOUBLE_BATTLE_REMATCH_${k}`]!, 0, TRMSG_IDS[`DOUBLE_BATTLE_NOT_ENOUGH_POKEMON_${k}`]!] : [TRMSG_IDS.REMATCH!, 0, 0];
      types.forEach((v, i) => dest(t, a[i], v));
      return 'continue';
    },
    print_trainer_dialogue: (t, c, a) => {
      const tr = trainer(val(t, a[0]));
      const text = tr.messages[trainerMessageKind(val(t, a[1]))];
      if (text) return showText(t, c, text);
      // Decomp Trainer_LoadMessage: a missing message prints an empty string.
      const p = new TextPrinter([], { speed: r.textSpeed() });
      r.ui.message = { printer: p };
      return r.pause(c, () => p.done);
    },
    // ScrCmd_PlayTrainerEncounterBGM: the field BGM pauses for the class's eyes-meet music (Sound_SwapBGM).
    play_trainer_encounter_bgm: (t, _c, a) => {
      const tr = trainer(val(t, a[0]));
      if (tr.encounterBgm) r.audio.swapBgm(tr.encounterBgm);
      else r.log.stub('audio:trainer-music-missing', `${tr.id} has no eyes-meet music in the packs`);
      return 'yield';
    },
    check_trainer_flag: (t, c, a) => ((c.cmp = r.getFlag(trainerFlag(val(t, a[0]))) ? 1 : 0), 'continue'),
    set_trainer_flag: (t, _c, a) => (r.setFlag(trainerFlag(val(t, a[0])), true), 'continue'),
    clear_trainer_flag: (t, _c, a) => (r.setFlag(trainerFlag(val(t, a[0])), false), 'continue'),
    set_move_code_for_facing_direction: (t) => {
      const o = t.lastTalked === undefined ? undefined : liveObject(t.lastTalked);
      // Decomp ScrCmd_SetMoveCodeForFacingDirection: Hearthome Gym's trainers wander instead (the map feature decides).
      if (o && !r.field.trainerPostBattleMovement(o.localId)) r.field.switchMovementType(o.localId, LOOK_TYPE[o.facing]);
      return 'continue';
    },
    get_movement_type: (t, _c, a) => (dest(t, a[0], liveObject(val(t, a[1]))?.movementType ?? 0), 'continue'),

    // ---------------------------------------------------------------- text
    open_message: () => {
      r.ui.message ??= { printer: new TextPrinter([], { speed: TEXT_SPEED.instant }) };
      return 'continue';
    },
    // No arrow shows (ScriptView.waitsForAB).
    wait_ab_press: (_t, c) => {
      r.ui.abWait = true;
      return r.pause(c, (input) => {
        const done = input.pressed.includes('a') || input.pressed.includes('b');
        if (done) r.ui.abWait = false;
        return done;
      });
    },
    message_var: (t, c, a) => showText(t, c, r.bankText(localBank(a[1], 'message_var'), val(t, a[0]) & 0xff)),
    // Decomp ScrCmd_MessageNoSkip: ScriptMessage_Show with canSkipDelay FALSE (A and B do not speed it up).
    message_no_skip: (t, c, a) => {
      const p = r.showMessage(t, r.bankText(localBank(a[1], 'message_no_skip'), val(t, a[0]) & 0xff), r.textSpeed(), { canSpeedUp: false });
      return r.pause(c, () => p.done);
    },
    // Decomp ScrCmd_MessageAutoScroll: msgOptions.autoScroll TRUE (AUTO_SCROLL_ENABLED: the box scrolls on its own after a wait).
    message_auto_scroll: (t, c, a) => {
      const p = r.showMessage(t, r.bankText(localBank(a[1], 'message_auto_scroll'), val(t, a[0]) & 0xff), r.textSpeed(), { autoScroll: { skip: false } });
      return r.pause(c, () => p.done);
    },
    buffer_counterpart_name: (t, _c, a) => (slot(t, a[0], r.textOf(r.bankText(BANKS.counterpartNames, r.state.gender === 'male' ? 1 : 0))), 'continue'),
    buffer_number: (t, _c, a) => (slot(t, a[0], String(val(t, a[1]))), 'continue'),
    buffer_party_mon_species: (t, _c, a) => {
      const mon = r.state.party[val(t, a[1])];
      if (!mon) throw new Error(`no party member ${val(t, a[1])}`);
      slot(t, a[0], plainMarkup(r.registries.species.get(mon.species)!.name));
      return 'continue';
    },
    buffer_poketch_app_name: (t, _c, a) => (slot(t, a[0], r.textOf(r.bankText(BANKS.poketchAppNames, val(t, a[1])))), 'continue'),
    buffer_player_counterpart_starter_species_name_with_article: (t, _c, a) => {
      // Decomp SystemVars_GetPlayerCounterpartStarter: the starter before the player's (Turtwig → Piplup → Chimchar → Turtwig).
      const options = r.starterOptions();
      const player = r.getVar(t, r.source('vars', 0x4030)!);
      const i = options.findIndex((s) => s.sourceIndex === player);
      if (i < 0) throw new Error(`player starter ${player} is not a starter species`);
      const species = options[(i + options.length - 1) % options.length]!;
      slot(t, a[0], r.textOf(r.bankText(BANKS.speciesNameWithArticles, species.sourceIndex!)));
      return 'continue';
    },

    // ---------------------------------------------------------------- progress
    check_badge_acquired: (t, _c, a) => (dest(t, a[1], r.state.badges.includes(badge(val(t, a[0]))) ? 1 : 0), 'continue'),
    count_badges_acquired: (t, _c, a) => (dest(t, a[0], BADGES.filter((b) => r.state.badges.includes(b)).length), 'continue'),
    give_badge: (t, _c, a) => {
      const b = badge(val(t, a[0]));
      if (!r.state.badges.includes(b)) r.state.badges.push(b);
      return 'continue';
    },
    give_pokedex: () => ((r.state.pokedex.obtained = true), 'continue'),
    check_pokedex_acquired: (t, _c, a) => (dest(t, a[0], r.state.pokedex.obtained ? 1 : 0), 'continue'),
    get_set_national_dex_enabled: (t, _c, a) => {
      const mode = int(a[0]);
      dest(t, a[1], 0);
      if (mode === 1) r.state.pokedex.national = true;
      else if (mode === 2) dest(t, a[1], r.state.pokedex.national ? 1 : 0);
      else throw new Error(`get_set_national_dex_enabled: mode ${mode}`);
      return 'continue';
    },

    // ---------------------------------------------------------------- items and party
    get_party_count: (t, _c, a) => (dest(t, a[0], r.state.party.length), 'continue'),

    // ---------------------------------------------------------------- field
    set_player_state: (t, _c, a) => ((t.playerStateRequest = int(a[0])), 'yield'),
    change_player_state: (t) => {
      const bits = t.playerStateRequest;
      t.playerStateRequest = 0;
      // Decomp PlayerAvatar_RequestChangeState: every requested bit, lowest first.
      if (bits & PLAYER_TRANSITION.walking) r.field.setPlayerState('walk');
      if (bits & PLAYER_TRANSITION.cycling) r.field.setPlayerState('cycle');
      if (bits & PLAYER_TRANSITION.surfing) r.field.setPlayerState('surf');
      if (bits & PLAYER_TRANSITION.healing) r.field.setPlayerAvatar('heal');
      const rest = bits & ~(PLAYER_TRANSITION.walking | PLAYER_TRANSITION.cycling | PLAYER_TRANSITION.surfing | PLAYER_TRANSITION.healing);
      if (rest) stub('player-pose', `player avatar request 0x${rest.toString(16)} (Pokétch, save, fishing, …) is not drawn`);
      return 'continue';
    },
    set_position: (t, _c, a) => {
      const facing = DIRS[val(t, a[4])];
      if (!facing) throw new Error(`set_position: bad direction ${val(t, a[4])}`);
      r.field.setPositionLive(val(t, a[0]), val(t, a[1]), val(t, a[3]), facing);
      return 'continue';
    },
    add_camera_override_object: (t, _c, a) => (r.field.addFreeCamera(val(t, a[0]), val(t, a[1]), false), 'continue'),
    remove_camera_override_object: () => (r.field.restoreCamera(), 'continue'),
    start_destroy_obstacle_animation: (t, _c, a) => {
      const v = r.ref(a[1], 'var');
      const kind = val(t, a[0]);
      if (kind > 2) throw new Error(`start_destroy_obstacle_animation: obstacle ${kind}`);
      // The world places the animation (FieldHost.destroyObstacle); the task writes TRUE to the var when it ends.
      r.setVar(t, v, 0);
      r.field.destroyObstacle(kind);
      t.tasks.push(() => {
        if (!r.field.destroyObstacleDone()) return false;
        r.setVar(t, v, 1);
        return true;
      });
      return 'yield';
    },

    // ---------------------------------------------------------------- scripted menus
    init_global_text_menu: initMenu(() => BANKS.menuEntries),
    init_local_text_menu: initMenu((a) => localBank(a[5], 'init_local_text_menu')),
    init_global_text_list_menu: initMenu(() => BANKS.menuEntries),
    init_local_text_list_menu: initMenu((a) => localBank(a[5], 'init_local_text_list_menu')),
    add_menu_entry_imm: (t, _c, a) => {
      const m = menu();
      m.add({ text: entryText(t, m.bank, int(a[0])), index: int(a[1]) });
      return 'continue';
    },
    add_menu_entry: (t, _c, a) => {
      const m = menu();
      m.add({ text: entryText(t, m.bank, val(t, a[0])), index: val(t, a[1]) });
      return 'continue';
    },
    add_list_menu_entry: (t, _c, a) => {
      const m = menu();
      // The decomp handler keeps the low byte of each operand.
      const index = val(t, a[2]) & 0xff;
      m.add({ text: entryText(t, m.bank, val(t, a[0]) & 0xff), index: index === LIST_HEADER ? MENU_RESULT.header : index, altText: val(t, a[1]) & 0xff });
      return 'continue';
    },
    show_menu: showMenu('single'),
    show_menu_multi_column: showMenu('multi', (a) => int(a[0])),
    show_list_menu: showMenu('list'),
    // Decomp ScrCmd_ShowListMenuRememberCursor: the list opens at the offset and row the two vars hold, and its cursor
    // callback writes them back as the cursor moves (the Prize Exchange keeps its place between purchases).
    show_list_menu_remember_cursor: (t, c, a) => {
      const offsetVar = r.ref(a[0], 'var');
      const rowVar = r.ref(a[1], 'var');
      const m = menu();
      m.remember(r.getVar(t, offsetVar), r.getVar(t, rowVar));
      return showScriptMenu(r, t, c, m, 'list', undefined, () => {
        const p = m.listPosition();
        r.setVar(t, offsetVar, p.offset);
        r.setVar(t, rowVar, p.row);
      });
    },
    // Decomp ScrCmd_ShowListMenuSetWidth → FieldMenuManager_ShowListMenuWithWidth: the list at a set width (tiles).
    show_list_menu_set_width: (t, c, a) => showScriptMenu(r, t, c, menu(), 'list', undefined, undefined, val(t, a[0])),
    set_menu_x_origin_side: (_t, _c, a) => ((menu().anchorRight = int(a[0]) === 1), 'yield'),
    set_menu_y_origin_side: (_t, _c, a) => ((menu().anchorBottom = int(a[0]) === 1), 'yield'),

    // ---------------------------------------------------------------- system and sweep ops
    // Decomp ScrCmd_Dummy1F9 reads a var operand and does nothing; ScrCmd_Dummy14F does nothing.
    dummy1_f9: () => 'continue',
    dummy14_f: () => 'continue',
    // Decomp ScrCmd_CheckGameCompleted / SetGameCompleted: SystemFlag FLAG_GAME_COMPLETED.
    check_game_completed: (t, _c, a) => (dest(t, a[0], r.getFlag(r.source('flags', FLAG_GAME_COMPLETED)!) ? 1 : 0), 'continue'),
    set_game_completed: () => (r.setFlag(r.source('flags', FLAG_GAME_COMPLETED)!, true), 'continue'),
    // Decomp ScrCmd_GetHour (FieldSystem_GetHour): the saved GameTime's hour.
    get_hour: (t, _c, a) => (dest(t, a[0], r.state.gameTime.now.hour), 'continue'),
    // Decomp ScrCmd_GetDayOfWeek (GetCurrentDate, the RTC itself): 0 = Sunday.
    get_day_of_week: (t, _c, a) => (dest(t, a[0], dayOfWeek(r.clock().date)), 'continue'),
    // Decomp ScrCmd_1E0 (sub_0206BF04): 0 while the Battle Tower single streak record is below 20; no frontier records are kept.


    // ---------------------------------------------------------------- stubs with a return value
  };
}

function badge(n: number): Id {
  const b = BADGES[n];
  if (!b) throw new Error(`bad badge ${n}`);
  return b;
}

const measures = new WeakMap<Runner, (s: string) => number>();
/** Text width in px in the new-game message font (the menu windows are as wide as their widest entry). */
export function measureText(r: Runner, s: string): number {
  let measure = measures.get(r);
  if (!measure) {
    const ng = [...r.registries.newGame.values()][0];
    const font = ng && r.registries.fonts.get(ng.messageFont);
    if (!font) throw new Error('menus need the new-game message font');
    const widths = new Map(Array.from(font.chars).map((ch, i) => [ch, font.widths[i]!]));
    measure = (x) => Array.from(x).reduce((w, ch) => w + (widths.get(ch) ?? font.cellWidth), 0);
    measures.set(r, measure);
  }
  return measure(s);
}

function showAltText(r: Runner, t: Thread, m: ScriptMenu): void {
  const alt = m.current.altText;
  if (alt === undefined || alt === NO_ALT_TEXT) return;
  r.ui.message = { printer: new TextPrinter(toPrintOps(r.textOf(r.bankText(m.bank, alt)), t.slots), { speed: TEXT_SPEED.instant }) };
}

/**
 * Shows a scripted menu (`r.ui.menu`) and waits for a choice, written to `t.menuVar` (decomp FieldMenuManager_Show*
 * and ListMenu input in their SysTasks). The move tutors' list uses it too.
 */
export function showScriptMenu(r: Runner, t: Thread, c: Context, m: ScriptMenu, kind: MenuKind, columns?: number, moved?: () => void, width?: number): Result {
  m.show(kind, (s) => measureText(r, s), columns, width);
  if (kind === 'list') showAltText(r, t, m);
  moved?.();
  return r.pause(c, (input: InputFrame) => {
    const touch = input.touch?.screen === 'main' && !r.lastTouch ? input.touch : null;
    const before = m.current;
    const result = m.step(input, touch);
    if (m.current !== before) moved?.();
    if (m.current !== before || result !== null) r.playFieldSe(1500);
    if (result === null) {
      if (kind === 'list' && m.current !== before) showAltText(r, t, m);
      return false;
    }
    r.setVar(t, t.menuVar!, result);
    r.ui.menu = null;
    return true;
  });
}
