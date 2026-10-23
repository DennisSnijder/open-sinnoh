import { DEFAULT_CLOCK, type Command } from '@opensinnoh/core';
import type { CreateScriptRunner, Registries } from '@opensinnoh/contracts';
import { BUCKETS, bucketOf, classifyOp, milestoneOf, TRIAGE, type Bucket } from './classify.ts';
import { COMMANDS } from './commands.ts';
import { CP_PATH_OPS, CP_PATH_OPS_M5A, CP_PATH_OPS_M5B, CP_PATH_OPS_M5C, CP_PATH_OPS_M6A, CP_PATH_OPS_M6B } from './cp-path.ts';
import { Runner } from './runner.ts';

/** Ops the VM has a handler for (some of them logged stand-ins: see STUBBED). */
export function implementedOps(): string[] {
  const deps = {
    registries: {} as Registries,
    labels: new Map(),
    state: {} as Parameters<CreateScriptRunner>[0]['state'],
    field: () => {
      throw new Error('no field');
    },
    rng: () => 0,
    textSpeed: () => 4,
    log: { stub: () => {} },
    battleLog: () => {},
    audio: {} as Parameters<CreateScriptRunner>[0]['audio'],
    clock: () => DEFAULT_CLOCK,
  };
  return Object.keys((new Runner(deps) as unknown as { handlers: Record<string, unknown> }).handlers).sort();
}

/**
 * Handlers that are logged stand-ins (no game effect beyond timing and a fixed or stubbed value): the
 * trainer eyes-meet music, battles (the battle stub rule), and systems that come later.
 */
export const STUBBED = [
  'set_step_flag',
  'check_tv_interview_eligible',
];

/**
 * The ops M1b makes real (the `real: M1b` tags of the export): HMs, weather, camera, objects,
 * the bike, Cycling Road and platform lifts, elevators and locations, the text buffers with a data source, and
 * the triaged system ops. Buffers of later systems are not listed.
 */
export const REAL_M1B = [
  'use_surf', 'use_waterfall', 'use_rock_climb', 'do_strength_func', 'do_flash_func', 'do_defog_func', 'scr_cmd_0c3', 'scr_cmd_0c4', 'play_hm_cut_in',
  'move_camera', 'shake_object', 'flicker_object', 'hide_object', 'show_object', 'set_player_bike', 'check_player_on_bike',
  'set_special_location', 'set_hidden_location', 'get_floors_above', 'buffer_floor_number', 'play_elevator_animation',
  'get_overworld_weather', 'wait_for_transition', 'get_current_map_id', 'find_party_slot_with_move', 'check_has_partner', 'set_flag_from_var',
  'get_game_version', 'check_heap_memory', 'dummy316',
  'show_current_floor', 'get_player_state', 'release_object', 'force_bicycling', 'set_player_height_calculation_enabled', 'set_bg_event_pos', 'get_previous_map_id',
  'init_persisted_map_features_for_platform_lift', 'trigger_platform_lift', 'check_platform_lift_not_used_when_entered_map',
  'buffer_move_name', 'buffer_party_move_name', 'buffer_party_mon_nickname', 'buffer_nature_name', 'buffer_type_name', 'buffer_accessory_name',
  'buffer_accessory_name_with_article', 'buffer_ball_seal_name', 'buffer_ball_seal_name_plural', 'buffer_contest_backdrop_name',
  'buffer_item_name_plural', 'buffer_item_name_with_article', 'buffer_map_name', 'buffer_player_starter_species_name', 'buffer_species_name_from_var',
  'buffer_species_name_with_article', 'buffer_trainer_class_name_with_article', 'buffer_trainer_name', 'buffer_value_padding_digits',
  'buffer_var_padding_digits', 'capitalize_first_letter', 'buffer_berry_name', 'buffer_underground_goods_name',
  'buffer_underground_goods_name_with_article', 'buffer_underground_item_name', 'buffer_underground_trap_name',
];

/**
 * The M3a ops made real so far (marts and the Pokémon Center, the PC, naming, ribbons, trainer score, game
 * records): `real: 'M3a'` in the export; `opensinnoh coverage` fails if one is not implemented.
 */
export const REAL_M3A = [
  'poke_mart_common', 'poke_mart_specialties', 'close_message_without_erasing', 'play_pokecenter_healing_animation', 'open_pokemon_storage', 'open_pokemon_naming_screen',
  'select_move_tutor_pokemon', 'get_selected_party_slot',
  'count_party_ribbons', 'count_party_mon_ribbons_unused', 'get_party_mon_ribbon', 'set_party_mon_ribbon', 'buffer_ribbon_name',
  'increment_trainer_score', 'increment_trainer_score2', 'get_trainer_card_level', 'check_local_dex_completed', 'check_national_dex_completed', 'start_signature_app',
  // Game records, the money window, the PC animation, instant messages.
  'increment_game_record', 'add_to_game_record', 'add_to_game_record_big_value', 'show_money', 'hide_money', 'update_money_display',
  'load_pc_animation', 'play_pc_boot_up_animation', 'play_pc_shut_down_animation', 'message_instant',
];

/** The M3b Pokétch ops (docs/research/poketch.md), part of `REAL_M3B`. */
export const REAL_M3B_POKETCH = ['enable_poketch', 'check_poketch_enabled', 'register_poketch_app', 'check_poketch_app_registered', 'hide_poketch', 'show_poketch', 'buffer_poketch_app_name'];

/**
 * The M3b daycare and egg ops: `real: 'M3b'`; `opensinnoh coverage` fails if one is
 * not implemented. The summary loop of the daycare party menu (`set_mon_summary`, `get_mon_party_slot`: our party app opens the summary
 * itself) are not among them.
 */
export const REAL_M3B = [
  'buffer_daycare_mon_nicknames', 'get_daycare_state', 'check_daycare_has_egg', 'reset_daycare_personality_and_step_counter',
  'get_daycare_compatibility_level', 'give_egg_from_daycare', 'give_egg', 'open_party_menu_for_daycare', 'get_day_care_party_menu_result',
  'try_revert_pokemon_form', 'buffer_party_mon_nickname_return_species', 'store_party_mon_into_daycare', 'buffer_daycare_gained_levels_by_slot',
  'buffer_daycare_nickname_level_gender', 'buffer_daycare_price_by_slot', 'move_mon_to_party_from_daycare_slot', 'hatch_egg',
  ...REAL_M3B_POKETCH,
];

/** The M2a battle ops: `real: 'M2a'`; `opensinnoh coverage` fails if one is not implemented. */
export const REAL_M2A = ['start_trainer_battle', 'start_first_battle', 'start_catching_tutorial', 'check_won_battle', 'check_lost_battle', 'check_did_not_capture', 'black_out_from_battle'];

/**
 * The clock ops (contracts 0.14): `real: 'clock'` in the export. `check_is_today_player_birthday`
 * stays a stub: the player's birthday is DS firmware data we do not have.
 */
export const REAL_CLOCK = ['get_time_of_day', 'get_hour', 'get_day_of_week'];

/**
 * The Super Contest ops, offline (contracts 0.35, contest-ops.ts): `real: 'contests'` in the export; `opensinnoh coverage`
 * fails if one is not implemented (0.35.1: the lobby's photo viewer, scr_cmd_0a8). The link ops stay stubs.
 */
export const REAL_CONTESTS = [
  'new_contest', 'end_contest', 'buffer_judge_name', 'buffer_contestant_trainer_name', 'buffer_contestant_mon_name',
  'buffer_contest_registration_entry_number', 'run_contest_application', 'buffer_contest_rank', 'buffer_contest_type',
  'buffer_winning_contestant_trainer_name', 'buffer_winning_contestant_mon_name', 'get_player_contest_placement',
  'get_winning_contestant_entry_num', 'get_contest_registration_entry_num', 'get_contestant_obj_event_gfx',
  'get_contestant_mon_contest_fame', 'get_contest_mode', 'get_contest_info', 'check_player_mon_has_ribbon', 'set_ribbon_name',
  'get_first_time_victory_accessory', 'start_contest_camera_flash_task', 'wait_for_contest_camera_flash_task',
  'get_should_skip_award_ceremony', 'start_contest_comm_sync', 'wait_for_comm_sync_state', 'lock_auto_scroll_for_link_contests',
  'lock_text_speed', 'change_into_contest_attire', 'open_party_menu_for_contest', 'get_contest_party_menu_result',
  'contest_photo_has_data', 'message_synchronized', 'stop_h_blank', 'start_h_blank', 'scr_cmd_0a8',
];

/**
 * The Villa, the journal, the diplomas and the small town and NPC rules (contracts 0.37, villa-ops.ts, journal-ops.ts,
 * npc-ops.ts; docs/research/villa-journal.md): `real: 'town'` in the export; `opensinnoh coverage` fails if one is not
 * implemented. The Villa's TV segments stay stubs (TV).
 */
export const REAL_TOWN = [
  'init_persisted_map_features_for_villa', 'check_met_furniture_requirements', 'show_list_menu_set_width', 'check_ab_press',
  'set_scene_play_bgm_music_box', 'set_field_scene', 'give_journal', 'create_journal_event', 'show_diploma_sinnoh', 'show_diploma_national_dex',
  'open_region_map', 'survive_poison', 'check_is_department_store_regular', 'get_party_mon_contest_stat', 'check_party_combee_gender_count',
  'change_deoxys_form', 'get_news_press_deadline', 'set_news_press_deadline', 'get_random_seen_species', 'get_spiritomb_counter', 'clear_spiritomb_counter',
];

/**
 * The contest rounds behind the round seam (packages/menus contest/rounds.ts), by status. Each round lane flips its
 * entry to 'real' with its model; a test checks this list against the rounds' `placeholder` flags. The coverage
 * report counts the placeholders.
 */
export const CONTEST_ROUNDS_STATUS: Record<'visual' | 'dance' | 'acting', 'placeholder' | 'real'> = { visual: 'real', dance: 'real', acting: 'real' };

/**
 * The ops made real over the Pokémon model (party, bag, money, Pokédex): `real: 'P'` in the export;
 * `opensinnoh coverage` fails if one is not implemented.
 */
export const REAL_P = [
  'give_money', 'remove_money', 'remove_money2', 'check_money', 'check_money2',
  'add_item', 'remove_item', 'can_fit_item', 'check_item', 'get_item_quantity', 'is_item_tmhm', 'check_pocket_has_items', 'buffer_tmhm_move_name',
  'give_pokemon', 'heal_party', 'check_has_two_alive_mons', 'count_party_non_eggs', 'count_party_eggs', 'count_alive_mons_except',
  'count_alive_mons_and_box_mons', 'get_first_non_egg_in_party', 'get_party_mon_species', 'get_party_mon_level', 'get_party_mon_form',
  'get_party_mon_form2', 'get_party_mon_friendship', 'increase_party_mon_friendship', 'decrease_party_mon_friendship_unused',
  'get_party_mon_nature', 'find_party_slot_with_nature', 'get_party_mon_type', 'get_party_mon_move_count', 'get_party_mon_move',
  'check_party_mon_has_move', 'get_party_mon_ev_total', 'get_party_mon_held_item_unused', 'delete_party_mon_held_item_unused',
  'check_party_has_species', 'check_party_has_species2', 'find_party_slot_with_species', 'count_repeated_species_in_party',
  'count_party_mons_below_level_threshold', 'check_party_has_held_item', 'check_party_pokerus', 'check_is_party_mon_outsider',
  'get_pc_boxes_free_slot_count', 'set_species_seen', 'check_has_seen_species', 'get_local_dex_seen_count',
  'get_local_dex_caught_count_unused', 'get_national_dex_seen_count', 'get_national_dex_caught_count', 'load_pokedex_rating',
];

/**
 * The ops each M5 chunk makes real: the stubbed ops on the chunk's story path
 * (`CP_PATH_OPS_M5A/B/C`, tools/cp-path-ops.ts) that M5 owns, by the area that owns each. An op on two
 * chunks' paths is tagged with the first. Stubs on the paths that stay with other systems (TV, contests,
 * the journal, rematches, distribution events, unused flags, the clock, the exit location) are not listed.
 * Unlike the earlier tags, a missing one is progress, not a failure: `opensinnoh coverage` lists them per chunk.
 */
export const REAL_M5 = {
  M5a: [
    // Eterna and Galactic scenes
    'scr_cmd_32d', 'scr_cmd_32e', 'scr_cmd_331', 'scr_cmd_332', 'scr_cmd_2cd', 'set_black_out_warp_id', 'try_set_unused_collected_orb_flag',
    // doubles
    'start_tag_battle',
    // gyms
    'init_persisted_map_features_for_eterna_gym', 'advance_eterna_gym_clock', 'init_persisted_map_features_for_hearthome_gym', 'init_persisted_map_features_for_veilstone_gym',
  ],
  M5b: [
    // gyms
    'init_persisted_map_features_for_pastoria_gym', 'press_pastoria_gym_button', 'init_persisted_map_features_for_canalave_gym',
    // scenes: the boat, the library explosion, Iron Island staging (Riley's collision)
    'play_boat_cutscene', 'scr_cmd_29f', 'start_library_tv', 'scr_cmd_2b6',
    // Route 214's gate (the Unown count)
    'get_unown_forms_seen_count',
  ],
  M5c: [
    // Galactic HQ and Spear Pillar
    'init_lake_guardian_containment_units', 'deactivate_lake_guardian_containment_units', 'scr_cmd_20d', 'scr_cmd_2fb', 'scr_cmd_18c', 'set_sub_scene63',
    // the Distortion World and Giratina
    'init_persisted_map_features_for_distortion_world', 'add_distortion_world_map_object', 'delete_distortion_world_map_object', 'do_dw_warp',
    'reset_distortion_world_persisted_camera_angles', 'start_distortion_world_giratina_shadow_event', 'finish_distortion_world_giratina_shadow_event',
    'set_party_giratina_form', 'start_giratina_origin_battle', 'get_battle_result', 'get_player3_d_pos', 'wait_ab_pad_press',
    // Spear Pillar's Hall of Origin check (the Arceus distribution)
    'check_distribution_event',
    // gyms
    'init_persisted_map_features_for_sunyshore_gym', 'press_sunyshore_gym_button',
    // the Hall of Fame
    'play_hall_of_fame_healing_animation', 'get_league_victories', 'clear_game',
  ],
  // M6: M6a the CP20–24 zones, M6b the legendary branch zones.
  M6a: [
    // post-game field ops
    'draw_pokemon_preview', 'remove_pokemon_preview', 'get_random_battleground_trainers', 'check_should_show_ghost', 'turn_on_pokedex_language_detection',
    // forms and legendaries
    'check_has_all_legendary_titans_in_party', 'check_party_has_fateful_encounter_regigigas',
  ],
  M6b: [
    // post-game field ops
    'init_turnback_cave', 'activate_regi_ruins_dot',
    // forms and legendaries
    'start_fateful_encounter', 'get_party_rotom_count_and_first', 'get_rotom_forms_in_save', 'set_rotom_form',
    'open_summary_screen_teach_move', 'get_summary_selected_move_slot', 'open_shaymin_tablet_naming_screen', 'buffer_tablet_name', 'set_player_volume',
  ],
} as const;
export type M5Chunk = keyof typeof REAL_M5;
/** The story-path ops of each M5 chunk (tools/cp-path-ops.ts). */
export const M5_PATH: Record<M5Chunk, readonly string[]> = { M5a: CP_PATH_OPS_M5A, M5b: CP_PATH_OPS_M5B, M5c: CP_PATH_OPS_M5C, M6a: CP_PATH_OPS_M6A, M6b: CP_PATH_OPS_M6B };

export interface OpClassification {
  op: string;
  opcode: number;
  /** implemented = real handler; stubbed = logged stand-in handler or bucket default; unimplemented = logged no-op. */
  status: 'implemented' | 'stubbed' | 'unimplemented';
  bucket: Bucket;
  /** Milestone of the real implementation (stubbed and unimplemented ops). */
  milestone?: string;
  /** What a stub does ("returns 0", "no-op", "stand-in", …). */
  default?: string;
  /** Reached by the checkpoint 1–4 story scripts or the trainer script. */
  cpPath: boolean;
  /** The M5 chunks whose story path reaches it; absent when none. */
  m5Path?: M5Chunk[];
  /** What makes this op real: M1b, P (the Pokémon model), M3a, M3b (the Pokétch), M2a or the clock (`opensinnoh coverage` fails if such an op is not implemented), or an M5 chunk (`REAL_M5`; progress, not a failure). */
  real?: 'M1b' | 'P' | 'M3a' | 'M3b' | 'M2a' | 'clock' | 'contests' | 'town' | M5Chunk;
}

/** Classification of every native script command (the `coverage` verb prints it). */
export function classifyOps(): OpClassification[] {
  const impl = new Set(implementedOps());
  const stand = new Set(STUBBED);
  const cp = new Set(CP_PATH_OPS);
  const m1b = new Set(REAL_M1B);
  const p = new Set(REAL_P);
  const m3a = new Set(REAL_M3A);
  const m3b = new Set(REAL_M3B);
  const m2a = new Set(REAL_M2A);
  const clock = new Set(REAL_CLOCK);
  const contests = new Set(REAL_CONTESTS);
  const town = new Set(REAL_TOWN);
  const chunks = Object.keys(REAL_M5) as M5Chunk[];
  const m5 = new Map(chunks.flatMap((k) => REAL_M5[k].map((op) => [op as string, k] as const)));
  const paths = chunks.map((k) => [k, new Set(M5_PATH[k])] as const);
  return COMMANDS.map((c): OpClassification => {
    const bucket = bucketOf(c.name);
    const m5Path = paths.filter(([, ops]) => ops.has(c.name)).map(([k]) => k);
    const real: OpClassification['real'] = m1b.has(c.name) ? 'M1b' : p.has(c.name) ? 'P' : m3a.has(c.name) ? 'M3a' : m3b.has(c.name) ? 'M3b' : m2a.has(c.name) ? 'M2a' : clock.has(c.name) ? 'clock' : contests.has(c.name) ? 'contests' : town.has(c.name) ? 'town' : m5.get(c.name);
    const base = { op: c.name, opcode: c.opcode, bucket, cpPath: cp.has(c.name), ...(m5Path.length ? { m5Path } : {}), ...(real ? { real } : {}) };
    if (impl.has(c.name)) return stand.has(c.name) ? { ...base, status: 'stubbed', milestone: TRIAGE[c.name]?.milestone ?? milestoneOf(c.name, bucket), default: 'stand-in (see the handler)' } : { ...base, status: 'implemented' };
    const f = classifyOp(c.name);
    return { ...base, status: f.status, milestone: f.milestone, default: f.default };
  });
}

/** The classification as committed JSON (`src/data/op-classification.json`, regenerated by tools/gen-classification.ts). */
export function classificationReport(): string {
  const ops = classifyOps();
  const count = (f: (o: OpClassification) => boolean) => ops.filter(f).length;
  const summary = {
    ops: ops.length,
    implemented: count((o) => o.status === 'implemented'),
    stubbed: count((o) => o.status === 'stubbed'),
    unimplemented: count((o) => o.status === 'unimplemented'),
    cpPath: count((o) => o.cpPath),
    cpPathUnimplemented: count((o) => o.cpPath && o.status === 'unimplemented'),
    realM1b: count((o) => o.real === 'M1b'),
    realM1bNotImplemented: count((o) => o.real === 'M1b' && o.status !== 'implemented'),
    realP: count((o) => o.real === 'P'),
    realPNotImplemented: count((o) => o.real === 'P' && o.status !== 'implemented'),
    realM3a: count((o) => o.real === 'M3a'),
    realM3aNotImplemented: count((o) => o.real === 'M3a' && o.status !== 'implemented'),
    realM3b: count((o) => o.real === 'M3b'),
    realM3bNotImplemented: count((o) => o.real === 'M3b' && o.status !== 'implemented'),
    realM2a: count((o) => o.real === 'M2a'),
    realM2aNotImplemented: count((o) => o.real === 'M2a' && o.status !== 'implemented'),
    realClock: count((o) => o.real === 'clock'),
    realClockNotImplemented: count((o) => o.real === 'clock' && o.status !== 'implemented'),
    realContests: count((o) => o.real === 'contests'),
    realContestsNotImplemented: count((o) => o.real === 'contests' && o.status !== 'implemented'),
    realTown: count((o) => o.real === 'town'),
    realTownNotImplemented: count((o) => o.real === 'town' && o.status !== 'implemented'),
    contestRoundsPlaceholder: Object.values(CONTEST_ROUNDS_STATUS).filter((s) => s === 'placeholder').length,
    ...Object.fromEntries(
      (Object.keys(REAL_M5) as M5Chunk[]).flatMap((k) => [
        [`real${k}`, count((o) => o.real === k)],
        [`real${k}NotImplemented`, count((o) => o.real === k && o.status !== 'implemented')],
        [`path${k}`, M5_PATH[k].length],
        [`path${k}NotImplemented`, count((o) => !!o.m5Path?.includes(k) && o.status !== 'implemented')],
      ]),
    ),
  };
  return `${JSON.stringify({ note: 'Generated by packages/vm/tools/gen-classification.ts (op names and buckets only).', summary, buckets: BUCKETS, ops }, null, 1)}\n`;
}

export interface M5Progress {
  chunk: M5Chunk;
  /** Ops on the chunk's story path. */
  path: number;
  /** Path ops that are not implemented (stand-ins and stubs), with their milestone. */
  missing: { op: string; real: boolean; milestone: string }[];
  /** `REAL_M5[chunk]`: how many, and which are implemented. */
  real: number;
  realDone: string[];
}

/** Per-chunk M5 progress (`opensinnoh coverage`): the chunk's tagged ops done, and every stub left on its path. */
export function m5Progress(): M5Progress[] {
  const ops = new Map(classifyOps().map((o) => [o.op, o]));
  return (Object.keys(REAL_M5) as M5Chunk[]).map((chunk) => {
    const tagged = new Set<string>(REAL_M5[chunk]);
    const missing = M5_PATH[chunk]
      .map((op) => ops.get(op)!)
      .filter((o) => o.status !== 'implemented')
      .map((o) => ({ op: o.op, real: o.real !== undefined && /^M[56]/.test(o.real), milestone: o.milestone ?? '' }));
    return { chunk, path: M5_PATH[chunk].length, missing, real: tagged.size, realDone: [...tagged].filter((op) => ops.get(op)!.status === 'implemented') };
  });
}

export interface Coverage {
  implemented: number;
  used: string[];
  usedImplemented: string[];
  usedMissing: string[];
}

/** Ops with a handler vs used ops over a set of labels. */
export function coverage(labels: Iterable<readonly Command[]>): Coverage {
  const impl = new Set(implementedOps());
  const used = new Set<string>();
  for (const cmds of labels) for (const c of cmds) used.add(c.op);
  const u = [...used].sort();
  return { implemented: impl.size, used: u, usedImplemented: u.filter((o) => impl.has(o)), usedMissing: u.filter((o) => !impl.has(o)) };
}
