/**
 * The field commands: HM field moves, weather, camera and object effects,
 * elevators and special locations, the bike, and the text buffers that read a text bank or a record. Each
 * follows its decomp handler (src/scrcmd*.c); a handler returns 'yield' where the decomp returns TRUE, and
 * a field task the decomp waits on (FieldTask_InitCall) is polled with `pause`.
 */
import type { Arg, Id } from '@opensinnoh/core';
import { plainMarkup, toPrintOps } from '@opensinnoh/text';
import { MOVES } from './commands.ts';
import { bikeMusic } from './audio-ops.ts';
import type { Handler, Result, Runner, Thread } from './runner.ts';

/** pl_msg banks the buffers read by number (decomp TEXT_BANK_*, line order of generated/text_banks.txt). */
export const M1B_BANKS = {
  ballSealNames: 12,
  ballSealNamesPlural: 13,
  natureNames: 202,
  menuEntries: 361,
  accessoryNames: 386,
  accessoryNamesWithArticles: 387,
  backdropNames: 388,
  itemNamesWithArticles: 393,
  itemNamesPlural: 394,
  speciesNameWithArticles: 413,
  berryNames: 424,
  npcTrainerNames: 618,
  trainerClassNamesWithArticles: 620,
  typeNames: 624,
  undergroundGoods: 626,
  undergroundGoodsWithArticles: 627,
  undergroundItems: 628,
  undergroundTraps: 630,
  moveNames: 647,
} as const;

/** Decomp FIELD_MOVE_FUNC_* (do_strength_func, do_flash_func, do_defog_func). */
export const FIELD_MOVE_FUNC = { clear: 0, set: 1, check: 2 } as const;
/** Flags of the field-move states (decomp FLAG_STRENGTH_ACTIVE, FLAG_FLASH_ACTIVE, FLAG_DEFOG_ACTIVE; `flags` sourceIndex). */
export const FIELD_MOVE_FLAGS = { strength: 2402, flash: 2426, defog: 2427 } as const;
/** Decomp OVERWORLD_WEATHER_CLEAR (`weathers` sourceIndex). */
const WEATHER_CLEAR = 0;
/** Decomp GAME_VERSION = VERSION_PLATINUM. */
export const VERSION_PLATINUM = 12;
/** Decomp VAR_HIDDEN_LOCATION_FULL_MOON_ISLAND (`vars` sourceIndex); the next three are New Moon, Spring Path, Seabreak Path. */
const VAR_HIDDEN_LOCATION_FIRST = 0x4036;
/** Decomp sHiddenLocationMagicNumbers (system_vars.c), by enum HiddenLocation. */
export const HIDDEN_LOCATION_MAGIC = [0x0208, 0x0229, 0x0312, 0x1028];
/** Decomp FIRST_BERRY_IDX (ITEM_CHERI_BERRY): berry names are indexed by item − this. */
const FIRST_BERRY_ITEM = 149;
/** Decomp MAX_PARTY_SIZE: find_party_slot_with_move's "no slot". */
const NO_SLOT = 6;
/** Decomp ELEVATOR_DIR_UP / ELEVATOR_DIR_DOWN. */
const ELEVATOR_DIRS = ['up', 'down'] as const;
/** Decomp enum PaddingMode. */
const PADDING = { none: 0, spaces: 1, zeroes: 2 } as const;
/** Decomp PADDING_MODE_SPACES. */
export const PADDING_SPACES = PADDING.spaces;
const DIRS = ['up', 'down', 'left', 'right'] as const;
/**
 * HM cut-in length in ticks: SysTask_CutIn is a main-loop SysTask, one sCutInTaskFuncs state step per tick
 * (init 1, sprites 1, window X 4, window Y 6, speed-up 15, slide in 3, to centre 6, pause 8, slide out 7,
 * shrink 5, cleanup 3 = 59; the world's `HM_CUT_IN_TICKS` counts the same).
 */
export const HM_CUT_IN_TICKS = 59;
/**
 * Decomp FieldMenu_ShowCurrentFloorWindow: 8 × FONT_SYSTEM max letter width (11 px) = 11 tiles wide,
 * CURRENT_FLOOR_WINDOW_HEIGHT 4 tiles; menu entries 15 ("Current Floor") at 0,0 and 16 (the floor, string
 * template slot 0) at 4 tiles, GLYPH_ROW_HEIGHT.
 */
const CURRENT_FLOOR_WINDOW = { width: 88, height: 32 } as const;
const CURRENT_FLOOR_LINES = [
  { message: 15, x: 0, y: 0 },
  { message: 16, x: 32, y: 16 },
] as const;
/** Decomp FieldMenu_GetFloorsAbove: floors above each elevator floor; other maps 1. */
const FLOORS_ABOVE: Record<string, number> = {
  HEARTHOME_CITY_SOUTHEAST_HOUSE_1F: 1,
  HEARTHOME_CITY_SOUTHEAST_HOUSE_2F: 0,
  VISTA_LIGHTHOUSE: 0,
  SUNYSHORE_CITY: 1,
  HEARTHOME_CITY_NORTHEAST_HOUSE_1F: 1,
  HEARTHOME_CITY_NORTHEAST_HOUSE_2F: 0,
  RESORT_AREA_RIBBON_SYNDICATE_1F: 1,
  RESORT_AREA_RIBBON_SYNDICATE_2F: 0,
  VEILSTONE_STORE_1F: 4,
  VEILSTONE_STORE_2F: 3,
  VEILSTONE_STORE_3F: 2,
  VEILSTONE_STORE_4F: 1,
  VEILSTONE_STORE_5F: 0,
  VEILSTONE_STORE_B1F: 5,
  JUBILIFE_TV_1F: 3,
  JUBILIFE_TV_2F: 2,
  JUBILIFE_TV_3F: 1,
  JUBILIFE_TV_4F: 0,
};


/** The move number of a move id (`platinum:MOVE_SURF` → 57). */
export function moveNumber(id: Id): number {
  const n = MOVES.indexOf(id.slice(id.indexOf(':') + 1).replace(/^MOVE_/, ''));
  if (n < 0) throw new Error(`unknown move ${id}`);
  return n;
}

/** Decomp StringTemplate_SetNumber: right-justified to `digits` with spaces or zeroes, or plain. */
export function formatNumber(value: number, mode: number, digits: number): string {
  const s = String(value);
  if (mode === PADDING.none) return s;
  if (mode === PADDING.spaces) return s.padStart(digits, ' ');
  if (mode === PADDING.zeroes) return s.padStart(digits, '0');
  throw new Error(`bad padding mode ${mode}`);
}

export function m1bHandlers(r: Runner): Record<string, Handler> {
  const dest = (t: Thread, a: Arg | undefined, v: number) => r.setVar(t, r.ref(a, 'var'), v);
  const val = (t: Thread, a: Arg | undefined) => r.val(t, a);
  const int = (a: Arg | undefined) => r.int(a);
  const slot = (t: Thread, a: Arg | undefined, markup: string) => void (t.slots[int(a)] = markup);
  const bank = (b: number, i: number) => r.textOf(r.bankText(b, i));
  /** A buffer op that sets its slot to message `index(operand 1)` of a bank (decomp SetArgFromArchive). */
  const bankBuffer =
    (b: number, index: (v: number) => number = (v) => v): Handler =>
    (t, _c, a) => (slot(t, a[0], bank(b, index(val(t, a[1])))), 'continue');
  const mon = (t: Thread, a: Arg | undefined) => {
    const i = val(t, a);
    const m = r.state.party[i];
    if (!m) throw new Error(`no party member ${i}`);
    return m;
  };
  const speciesName = (sourceIndex: number) => plainMarkup(r.speciesName(sourceIndex));
  const fieldMoveFunc =
    (flag: number): Handler =>
    (t, _c, a) => {
      const id = r.source('flags', flag)!;
      const fn = int(a[0]);
      if (fn === FIELD_MOVE_FUNC.set) r.setFlag(id, true);
      else if (fn === FIELD_MOVE_FUNC.clear) r.setFlag(id, false);
      else if (fn === FIELD_MOVE_FUNC.check) dest(t, a[1], r.getFlag(id) ? 1 : 0);
      else throw new Error(`bad field move func ${fn}`);
      return 'continue';
    };
  /** An HM traversal task (decomp FieldTask_StartUse*): the script waits until the world reports it done. */
  const hmTask =
    (start: (slot: number) => void, done: () => boolean): Handler =>
    (t, c, a) => {
      const s = val(t, a[0]);
      if (!r.state.party[s]) throw new Error(`no party member ${s}`);
      start(s);
      return r.pause(c, done);
    };
  // Decomp ScrCmd_0C3 / ScrCmd_0C4: the overworld weather becomes CLEAR now (after Flash and Defog).
  const clearWeather: Handler = () => (r.field.setWeather(r.source('weathers', WEATHER_CLEAR)!), 'continue');
  const visible = (v: boolean): Handler => (t, _c, a) => (r.field.setObjectVisible(val(t, a[0]), v), 'continue');
  const facing = (d: number) => {
    const f = DIRS[d];
    if (!f) throw new Error(`bad direction ${d}`);
    return f;
  };
  const numberBuffer: Handler = (t, _c, a) => (slot(t, a[0], formatNumber(val(t, a[1]), int(a[2]), int(a[3]))), 'continue');

  return {
    // ---------------------------------------------------------------- HMs and field-move states
    use_surf: hmTask((s) => r.field.surf(s), () => r.field.surfDone()),
    use_waterfall: hmTask((s) => r.field.waterfall(s), () => r.field.waterfallDone()),
    use_rock_climb: hmTask((s) => r.field.rockClimb(s), () => r.field.rockClimbDone()),
    do_strength_func: fieldMoveFunc(FIELD_MOVE_FLAGS.strength),
    do_flash_func: fieldMoveFunc(FIELD_MOVE_FLAGS.flash),
    do_defog_func: fieldMoveFunc(FIELD_MOVE_FLAGS.defog),
    scr_cmd_0c3: clearWeather,
    scr_cmd_0c4: clearWeather,
    play_hm_cut_in: (t, c, a) => {
      mon(t, a[0]);
      r.field.hmCutIn(val(t, a[0]));
      return r.pause(c, () => r.field.hmCutInDone());
    },
    find_party_slot_with_move: (t, _c, a) => {
      const move = val(t, a[1]);
      // Eggs are skipped (decomp ScrCmd_FindPartySlotWithMove).
      const i = r.state.party.findIndex((m) => !m.isEgg && m.moves.some((id) => moveNumber(id) === move));
      dest(t, a[0], i < 0 ? NO_SLOT : i);
      return 'continue';
    },
    check_has_partner: (t, _c, a) => (dest(t, a[0], r.state.hasPartner ? 1 : 0), 'continue'),

    // ---------------------------------------------------------------- camera and objects
    move_camera: (t, _c, a) => (r.field.moveCamera(val(t, a[0]), val(t, a[1]), val(t, a[2])), 'continue'),
    shake_object: (t, c, a) => {
      r.field.shakeObject(val(t, a[0]), val(t, a[1]), val(t, a[2]), val(t, a[3]), val(t, a[4]));
      return r.pause(c, () => r.field.shakeObjectDone());
    },
    // Decomp Task_FlickerMapObject, one call per tick: apply the hidden flag; every `delay + 1` calls flip
    // it, and stop on the flip after `times` flips.
    flicker_object: (t, c, a) => {
      const localId = val(t, a[0]);
      let times = val(t, a[1]);
      const delay = val(t, a[2]);
      let hidden = false;
      let timer = 0;
      return r.pause(c, () => {
        r.field.setObjectVisible(localId, !hidden);
        if (timer++ < delay) return false;
        hidden = !hidden;
        timer = 0;
        return times-- === 0;
      });
    },
    release_object: (t, _c, a) => (r.field.releaseObject(val(t, a[0])), 'continue'),
    force_bicycling: (_t, _c, a) => (r.field.forceBicycling(int(a[0]) !== 0), 'continue'),
    // Decomp ScrCmd_SetPlayerHeightCalculationEnabled returns TRUE: the script resumes next frame.
    set_player_height_calculation_enabled: (_t, _c, a) => (r.field.setPlayerHeightCalculation(int(a[0]) !== 0), 'yield'),
    set_bg_event_pos: (t, _c, a) => (r.field.setBgEventPosition(val(t, a[0]), val(t, a[1]), val(t, a[2])), 'continue'),
    init_persisted_map_features_for_platform_lift: () => (r.field.initPlatformLift(), 'continue'),
    check_platform_lift_not_used_when_entered_map: (t, _c, a) => (dest(t, a[0], r.field.platformLiftNotUsedWhenEntered() ? 1 : 0), 'continue'),
    // Decomp PlatformLift_Trigger starts the ride with FieldTask_InitCall: the script waits for it.
    trigger_platform_lift: (_t, c) => {
      r.field.triggerPlatformLift();
      return r.pause(c, () => r.field.platformLiftDone());
    },
    hide_object: visible(false),
    show_object: visible(true),
    set_player_bike: (_t, _c, a) => {
      const ride = int(a[0]) === 1;
      // ScrCmd_SetPlayerBike: the bike BGM before the avatar change (getting off: after it).
      if (ride) bikeMusic(r, true);
      r.field.setPlayerState(ride ? 'cycle' : 'walk');
      if (!ride) bikeMusic(r, false);
      return 'continue';
    },
    // Decomp PlayerAvatar_GetPlayerState: PLAYER_AVATAR_WALKING 0, CYCLING 1, SURFING 2.
    get_player_state: (t, _c, a) => (dest(t, a[0], ['walk', 'cycle', 'surf'].indexOf(r.state.playerState)), 'continue'),
    check_player_on_bike: (t, _c, a) => (dest(t, a[0], r.state.playerState === 'cycle' ? 1 : 0), 'continue'),

    // ---------------------------------------------------------------- locations, elevators, weather
    set_special_location: (t, _c, a) => {
      const warp = val(t, a[1]);
      r.state.specialLocation = { zone: r.source('zones', val(t, a[0]))!, warp: warp === 0xffff ? -1 : warp, x: val(t, a[2]), z: val(t, a[3]), facing: facing(val(t, a[4])) };
      return 'continue';
    },
    set_hidden_location: (t, _c, a) => {
      const n = val(t, a[0]);
      const magic = HIDDEN_LOCATION_MAGIC[n];
      if (magic === undefined) throw new Error(`bad hidden location ${n}`);
      r.setVar(t, r.source('vars', VAR_HIDDEN_LOCATION_FIRST + n)!, int(a[1]) ? magic : 0);
      return 'continue';
    },
    get_floors_above: (t, _c, a) => {
      const zone = r.state.specialLocation?.zone;
      dest(t, a[0], (zone && FLOORS_ABOVE[zone.slice(zone.indexOf(':MAP_HEADER_') + ':MAP_HEADER_'.length)]) ?? 1);
      return 'continue';
    },
    // Decomp StringTemplate_SetFloorNumber: 0 = B1F, n = nF (menu entries bank).
    buffer_floor_number: (t, _c, a) => {
      const floor = int(a[1]);
      if (floor > 5) throw new Error(`bad floor ${floor}`);
      const name = floor === 0 ? 'B1F' : `${floor}F`;
      const id = r.registries.textBanks.get(r.source('textBanks', M1B_BANKS.menuEntries)!)!.messages.find((m) => m.endsWith(`:MenuEntries_Text_${name}`));
      if (!id) throw new Error(`menu entries bank has no MenuEntries_Text_${name}`);
      slot(t, a[0], r.textOf(id));
      return 'continue';
    },
    // Decomp FieldMenu_ShowCurrentFloorWindow: the window beside the elevator menu, printed once with the
    // template slots (the floor from buffer_floor_number). FieldMenuManager_Init sets the var to 0; the window
    // closes when the script sets it to 0xFFFF (Runner.step).
    show_current_floor: (t, _c, a) => {
      const closeVar = r.ref(a[2], 'var');
      const text = (i: number) =>
        toPrintOps(r.textOf(r.bankText(M1B_BANKS.menuEntries, i)), t.slots)
          .map((op) => (op.kind === 'char' ? op.c : ''))
          .join('');
      r.setVar(t, closeVar, 0);
      const lines = CURRENT_FLOOR_LINES.map((l) => ({ text: text(l.message), x: l.x, y: l.y }));
      r.ui.floorWindow = { view: { x: int(a[0]) * 8, y: int(a[1]) * 8, ...CURRENT_FLOOR_WINDOW, lines }, thread: t, closeVar };
      return 'continue';
    },
    play_elevator_animation: (t, c, a) => {
      const dir = ELEVATOR_DIRS[val(t, a[0])];
      if (!dir) throw new Error(`bad elevator direction ${val(t, a[0])}`);
      r.field.elevator(dir, val(t, a[1]) & 0xff);
      return r.pause(c, () => r.field.elevatorDone());
    },
    get_overworld_weather: (t, _c, a) => {
      const w = r.registries.weathers.get(r.state.weather);
      if (w?.sourceIndex === undefined) throw new Error(`weather ${r.state.weather} has no sourceIndex`);
      dest(t, a[0], w.sourceIndex);
      return 'continue';
    },
    // Decomp ScrCmd_GetPreviousMapID: FieldOverworldState's previous location; before any warp it is the
    // zeroed location (map 0).
    get_previous_map_id: (t, _c, a) => {
      const prev = r.state.previousZone;
      const z = prev ? r.registries.zones.get(prev) : null;
      if (prev && z?.sourceIndex === undefined) throw new Error(`zone ${prev} has no sourceIndex`);
      dest(t, a[0], z?.sourceIndex ?? 0);
      return 'continue';
    },
    get_current_map_id: (t, _c, a) => {
      const z = r.registries.zones.get(r.state.player.zone);
      if (z?.sourceIndex === undefined) throw new Error(`zone ${r.state.player.zone} has no sourceIndex`);
      dest(t, a[0], z.sourceIndex);
      return 'continue';
    },
    // Decomp FieldTransition_FinishMap ends the field map before an app; our field stays (as return_to_field).
    wait_for_transition: (): Result => 'yield',

    // ---------------------------------------------------------------- system
    set_flag_from_var: (t, _c, a) => (r.setFlag(r.source('flags', r.getVar(t, r.ref(a[0], 'var')))!, true), 'continue'),
    get_game_version: (t, _c, a) => (dest(t, a[0], VERSION_PLATINUM), 'continue'),
    // Decomp ScrCmd_CheckHeapMemory asserts on heap use (debug); nothing to do.
    check_heap_memory: () => 'continue',
    dummy316: () => 'yield',

    // ---------------------------------------------------------------- stand-ins (STUBBED)
    // ---------------------------------------------------------------- text buffers
    buffer_move_name: bankBuffer(M1B_BANKS.moveNames),
    buffer_party_move_name: (t, _c, a) => {
      const id = mon(t, a[1]).moves[val(t, a[2])];
      slot(t, a[0], bank(M1B_BANKS.moveNames, id ? moveNumber(id) : 0));
      return 'continue';
    },
    // No nickname = the species name, as on the DS.
    buffer_party_mon_nickname: (t, _c, a) => {
      const m = mon(t, a[1]);
      slot(t, a[0], plainMarkup(m.nickname ?? r.registries.species.get(m.species)!.name));
      return 'continue';
    },
    buffer_nature_name: bankBuffer(M1B_BANKS.natureNames),
    buffer_type_name: bankBuffer(M1B_BANKS.typeNames),
    buffer_accessory_name: bankBuffer(M1B_BANKS.accessoryNames),
    buffer_accessory_name_with_article: bankBuffer(M1B_BANKS.accessoryNamesWithArticles),
    buffer_ball_seal_name: bankBuffer(M1B_BANKS.ballSealNames, (v) => v - 1),
    buffer_ball_seal_name_plural: bankBuffer(M1B_BANKS.ballSealNamesPlural, (v) => v - 1),
    buffer_contest_backdrop_name: bankBuffer(M1B_BANKS.backdropNames),
    buffer_item_name_plural: bankBuffer(M1B_BANKS.itemNamesPlural),
    buffer_item_name_with_article: bankBuffer(M1B_BANKS.itemNamesWithArticles),
    buffer_species_name_with_article: bankBuffer(M1B_BANKS.speciesNameWithArticles),
    buffer_trainer_class_name_with_article: bankBuffer(M1B_BANKS.trainerClassNamesWithArticles),
    buffer_trainer_name: bankBuffer(M1B_BANKS.npcTrainerNames),
    buffer_berry_name: bankBuffer(M1B_BANKS.berryNames, (item) => item - FIRST_BERRY_ITEM),
    buffer_underground_goods_name: bankBuffer(M1B_BANKS.undergroundGoods),
    buffer_underground_goods_name_with_article: bankBuffer(M1B_BANKS.undergroundGoodsWithArticles),
    buffer_underground_item_name: bankBuffer(M1B_BANKS.undergroundItems),
    buffer_underground_trap_name: bankBuffer(M1B_BANKS.undergroundTraps),
    buffer_map_name: (t, _c, a) => (slot(t, a[0], plainMarkup(r.registries.zones.get(r.source('zones', val(t, a[1]))!)!.name)), 'continue'),
    buffer_player_starter_species_name: (t, _c, a) => (slot(t, a[0], speciesName(r.getVar(t, r.source('vars', 0x4030)!))), 'continue'),
    buffer_species_name_from_var: (t, _c, a) => (slot(t, a[0], speciesName(val(t, a[1]))), 'continue'),
    buffer_value_padding_digits: numberBuffer,
    buffer_var_padding_digits: numberBuffer,
    // Decomp String_UpperChar(arg, 0): the first character, if it is a lower-case letter.
    capitalize_first_letter: (t, _c, a) => {
      const s = t.slots[int(a[0])] ?? '';
      t.slots[int(a[0])] = s.charAt(0).toUpperCase() + s.slice(1);
      return 'continue';
    },
  };
}
