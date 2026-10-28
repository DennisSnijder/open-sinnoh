/**
 * Default stubs for the script commands the VM has no handler for (S8). Each
 * command falls in a bucket by its name; a bucket stub writes 0 (FALSE) to every destination var and does
 * not wait, and is logged once with its milestone. The "other" bucket and the unused/unnamed decomp
 * commands get no default unless TRIAGE names them (each read from its decomp handler); the rest stay
 * logged as unimplemented. No ROM script uses an untriaged one.
 */
import { COMMAND_BY_NAME, type CommandSpec } from './commands.ts';

export type Bucket = 'menus' | 'party' | 'battle' | 'contest' | 'communication' | 'underground' | 'field' | 'objects' | 'text' | 'other';

export const BUCKETS: Record<Bucket, { label: string; milestone: string }> = {
  menus: { label: 'Menus, UI, saves', milestone: 'scripted menus M1a; save, PC and mart M3' },
  party: { label: 'Party, mon, items, dex', milestone: 'counts and flags M1; screens M3' },
  battle: { label: 'Battle', milestone: 'M2' },
  contest: { label: 'Contest, accessory, ribbon', milestone: 'later' },
  communication: { label: 'Communication, Wi-Fi, Union Room', milestone: 'out' },
  underground: { label: 'Underground', milestone: 'scope pending' },
  field: { label: 'Field, camera, HM', milestone: 'M1b' },
  objects: { label: 'Objects and player', milestone: 'M1b' },
  text: { label: 'Text buffers', milestone: 'M1' },
  other: { label: 'Other', milestone: 'unscheduled (unnamed or unused decomp command; triaged per op where a ROM script uses it)' },
};

/**
 * Milestones of the field and object ops that later milestones took
 * out of the field bucket: an op not triaged and not real takes the first match here instead of its bucket's.
 */
const MILESTONE_RULES: [RegExp, string][] = [
  [/distortion_world|^do_dw_warp$|giratina/, 'M5 (Distortion World)'],
  [/_gym$|_gym_|gym_clock/, 'M5 (gym puzzles)'],
  [/great_marsh|safari/, 'M5 (Great Marsh tram and Safari)'],
  [/lake_guardian/, 'M5 (Galactic HQ)'],
  [/bgm|music|volume|sequence|^play_se$|^stop_se$|^wait_se$|cry|fanfare/, 'M4 (audio)'],
  [/naming_screen|teach_move|^use_fly$|pc_|_pc$|hall_of_fame_screen/, 'M3 (menus and field moves)'],
  [/time_of_day|^get_hour$|birthday/, 'clock (later)'],
  [/received_temp_data/, 'later (Battle Frontier)'],
  [/^get_player3_d_pos$/, 'M5 (Distortion World)'],
  [/^lock_last_talked$/, 'unscheduled (no ROM script uses it)'],
  [/regi_ruins|spiritomb|amity_square|villa|boat|vista_lighthouse|hall_of_fame|h_blank|bg3|field_scene|sub_scene|text_speed/, 'later (systems and scenes after M1)'],
];

/** First match wins; checked in this order. */
const RULES: [Bucket, RegExp][] = [
  ['text', /^buffer_|^capitalize_/],
  ['underground', /underground|give_trap|give_sphere|good|treasure|turnback/],
  ['communication', /union_room|wi_fi|wi_f_|(^|_)comm(_|$)|communication|link_|_link|gts|mystery_gift|battle_client|battle_server|net_id|network|signature|group_connection|distribution|plaza|save_type|is_misc_save|gba_cartridge|teala|frontier_scene/],
  ['contest', /contest|accessor|backdrop|ribbon|dress_up|poffin|seal|judge|fashion/],
  ['battle', /battle|trainer|encounter|catching_tutorial|black_out|vs_seeker|legendary|giratina|fateful|roaming|swarm|safari|colosseum|did_not_capture|_won_|_lost_|bp_display/],
  ['objects', /object|player|movement|follower|partner|move_code|position|face_|lock_|release_|shake|flicker|_dir$|bg_event|warp_event/],
  ['field', /camera|^use_|hm_|strength|flash|defog|weather|warp|door|animation|fade|screen|elevator|lift|gym|tram|lighthouse|h_blank|bg3|scene|map_features|distortion|dw_|special_location|floor|hidden_location|height|cutscene|transition|great_marsh|lake_guardian|regi_ruins|spiritomb|binoculars|amity/],
  ['party', /party|mon|pokemon|item|bag|dex|egg|species|move|berry|money|coin|daycare|day_care|hatch|nickname|poketch|pc|storage|nature|friendship|form|pokerus|shard|tutor|reminder|trade|plate|tmhm|badge|running_shoes|hall_of_fame|journal|game_record|trainer_score|catching_show|fossil|mail|trophy|stat|type|hidden_power/],
  ['menus', /menu|save|message|yes_no|signpost|wait_|naming|mart|window|diploma|open_|show_|hide_|choose|select|close_|ab_press|sentence|word|text_speed|icon|preview|summary|rankings|records|photo|scratch_off|lottery|_shop/],
];

/**
 * Per-command triage of the "other" bucket and the unnamed decomp handlers that ROM scripts use
 * ("unknown 77"), and of named stubs whose reason is not their bucket's (state the engine does not keep, unreachable
 * maps). Each entry was read from its decomp handler. `zero` lists the operands its stub sets
 * to 0 when their names do not say so (`arg0`); `milestone` overrides the bucket's.
 */
interface Triage {
  bucket: Bucket;
  milestone?: string;
  /** What the decomp handler does. */
  note: string;
  zero?: number[];
}
const TOWER = 'later (Battle Tower)';
const CHATTER = 'later (recording a Chatot cry needs the microphone)';
const SAVE = 'M3 (save)';
const comm = (note: string, zero?: number[]): Triage => ({ bucket: 'communication', note, ...(zero ? { zero } : {}) });

export const TRIAGE: Record<string, Triage> = {
  check_recorded_chatot_cry_is_playable: { bucket: 'party', milestone: CHATTER, note: 'Chatot cry recording' },
  try_record_chatot_cry: { bucket: 'party', milestone: CHATTER, note: 'Chatot cry recording' },
  stop_recording_chatot_cry: { bucket: 'party', milestone: CHATTER, note: 'Chatot cry recording' },
  store_recorded_chatot_cry: { bucket: 'party', milestone: CHATTER, note: 'Chatot cry recording' },
  scr_cmd_1b3: { bucket: 'party', milestone: 'M3 (mailbox)', note: 'opens the mailbox app' },
  scr_cmd_2b2: { bucket: 'menus', milestone: SAVE, note: 'FieldSystem_SaveObjects before a save' },
  scr_cmd_258: { bucket: 'menus', milestone: SAVE, note: 'starts the save-pose player task' },
  scr_cmd_259: { bucket: 'menus', milestone: SAVE, note: 'ends the save-pose player task' },
  scr_cmd_1e1: { bucket: 'battle', milestone: TOWER, note: 'Battle Tower command' },
  scr_cmd_1e2: { bucket: 'battle', milestone: TOWER, note: 'Battle Tower save task' },
  scr_cmd_1e3: { bucket: 'battle', milestone: TOWER, note: 'Wi-Fi tower match indices', zero: [0, 1] },
  scr_cmd_1e4: { bucket: 'battle', milestone: TOWER, note: 'Wi-Fi tower match list present', zero: [0] },
  count_mail_in_mailbox: { bucket: 'party', milestone: 'M3 (mailbox)', note: 'Mailbox_CountMail: the engine keeps no PC mailbox (Mail is never sent to it), so the PC says it is empty' },
  set_favorite_mon: { bucket: 'party', milestone: 'out', note: 'MiscSaveBlock_SetFavoriteMon: only the Wi-Fi Plaza reads the favorite; not kept' },
  turn_on_pokedex_form_detection: { bucket: 'party', milestone: 'later (Pokédex form detection)', note: 'Pokedex_TurnOnFormDetection: the saved canDetectForms is not kept; our Pokédex shows the forms page from the start' },
  check_is_today_player_birthday: { bucket: 'objects', milestone: 'out (DS firmware data)', note: "the DS owner's birthday is firmware data (SystemData), not available: never the birthday" },
  move_hearthome_gym_dp_lift: { bucket: 'field', milestone: 'unscheduled (Diamond/Pearl leftover maps)', note: "HearthomeGym_MoveLift: only the DP_GYM elevator rooms run it; Platinum's leader room warps to them lie outside its walls" },
  set_mon_summary: { bucket: 'party', note: "the daycare's and contests' party menus open the summary themselves, so the scripts' summary loop is not taken" },
  get_mon_party_slot: { bucket: 'party', note: "the daycare's and contests' party menus open the summary themselves, so the scripts' summary loop is not taken" },
  scr_cmd_0a2: comm('Communication Club task'),
  scr_cmd_0a3: comm('comm app (mode 2)'),
  scr_cmd_0a5: comm('Union Room easy chat window'),
  scr_cmd_0ac: comm('Union Room app'),
  scr_cmd_0ae: comm('Union Room app'),
  scr_cmd_0af: comm('Union Room party management'),
  scr_cmd_0b3: comm('comm app (mode 1)', [0]),
  scr_cmd_135: comm('CommTiming sync'),
  scr_cmd_139: comm('Union Room state'),
  scr_cmd_13a: comm('pauses the Union Room server'),
  scr_cmd_13b: comm('restarts the Union Room search'),
  scr_cmd_13e: comm('Union Room restart'),
  scr_cmd_140: comm('Union Room talk target', [0]),
  scr_cmd_141: comm('Union Room wait'),
  scr_cmd_142: comm('Union Room objects'),
  scr_cmd_143: comm('Union Room state'),
  scr_cmd_144: comm('Union Room wait'),
  scr_cmd_145: comm('Union Room wait'),
  scr_cmd_146: comm('Union Room talk result', [1]),
  scr_cmd_153: comm('map change into the Union Room'),
  scr_cmd_204: comm('map change back from the Communication Club'),
  scr_cmd_205: comm('Wi-Fi app'),
  scr_cmd_2ba: comm('Union Room result', [0]),
  scr_cmd_2c6: comm('Union Room party management'),
  scr_cmd_2f6: comm('Wi-Fi login app', [2]),
  scr_cmd_2f7: comm('Wi-Fi login task'),
  scr_cmd_30e: comm('Union Room intro message', [0]),
};

/** The milestone of an op that is not triaged: MILESTONE_RULES, else its bucket's. */
export function milestoneOf(op: string, bucket: Bucket): string {
  return MILESTONE_RULES.find(([re]) => re.test(op))?.[1] ?? BUCKETS[bucket].milestone;
}

export function bucketOf(op: string): Bucket {
  return TRIAGE[op]?.bucket ?? RULES.find(([, re]) => re.test(op))?.[0] ?? 'other';
}

const DEST = /^(dest|result|out|success|ret$|response|selectedOption|destTrue)/;

/** Operand indexes a stub writes 0 to: var operands named as results (`destVar`, `resultVar`, …), or its triage list. */
export function stubDefault(spec: CommandSpec): { zero: number[] } {
  return { zero: TRIAGE[spec.name]?.zero ?? spec.operands.flatMap((o, i) => (o.kind === 'var' && DEST.test(o.name) ? [i] : [])) };
}

export interface FallbackClass {
  status: 'stubbed' | 'unimplemented';
  bucket: Bucket;
  milestone: string;
  /** What the stub does: "returns 0" (destination vars set to 0), "buffers an empty string" (text slot) or "no-op". */
  default: string;
}

/** How the VM runs a command it has no handler for. */
export function classifyOp(op: string): FallbackClass {
  const spec = COMMAND_BY_NAME.get(op);
  const bucket = bucketOf(op);
  const triage = TRIAGE[op];
  const unnamed = !spec || /^(unused_|scr_cmd_|dummy)/.test(op);
  const status = triage ? 'stubbed' : unnamed || bucket === 'other' ? 'unimplemented' : 'stubbed';
  const zero = spec ? stubDefault(spec).zero.length : 0;
  const buffers = bucket === 'text' && spec?.operands[0]?.name === 'templateArg';
  const def = status === 'unimplemented' ? 'no-op (unimplemented)' : buffers ? 'buffers an empty string' : zero ? 'returns 0' : 'no-op';
  return { status, bucket, milestone: triage?.milestone ?? milestoneOf(op, bucket), default: triage ? `${def}; decomp: ${triage.note}` : def };
}
