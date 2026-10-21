import table from './data/commands.json' with { type: 'json' };

/** One operand of a native script command (from the generated table, see tools/gen-commands.ts). */
export interface OperandSpec {
  name: string;
  type: 'u8' | 'u16' | 'u32' | 'rel';
  /** var = var id, vov = var-or-value (≥ 0x4000 → var), flag = flag id, msg = u8 message index. */
  kind?: 'var' | 'vov' | 'flag' | 'msg';
}

export interface CommandSpec {
  opcode: number;
  name: string;
  macro: string;
  operands: OperandSpec[];
  /** Operands after the fixed ones depend on the first operand's value (six commands). */
  variable?: 'field_move' | 'group_connection' | 'tv_broadcast' | 'mystery_gift';
  unverified?: boolean;
}

export const COMMANDS = table.commands as CommandSpec[];
export const COMMAND_BY_NAME = new Map(COMMANDS.map((c) => [c.name, c]));
/** Movement action index → name (lower-case, no MOVEMENT_ACTION_ prefix). */
export const MOVEMENT_ACTIONS = table.movementActions as (string | null)[];
/** scr_seq member index → decomp file name (`scripts_twinleaf_town`). */
export const SCRIPT_FILES = table.scriptFiles;
/** Global script id ranges (≥ 2000): first base ≤ id from the top wins; entry = id − base. */
export const SCRIPT_RANGES = table.scriptRanges;
export const DUMMY_SCRIPT = table.dummyScript;
/** Move id → decomp constant name without `MOVE_` (`SURF`); a party move is the id `<ns>:MOVE_<name>`. */
export const MOVES = table.moves;

/**
 * Commands that read a message of the script's own bank by a runtime number (decomp `ctx->loader`): the
 * decoder appends that bank (pl_msg number = `textBanks` sourceIndex) as a trailing int operand.
 */
export const LOCAL_BANK_OPS = new Set(['message_var', 'message_no_skip', 'message_auto_scroll', 'message_unown', 'message_from_trainer_type', 'message_seen_banlist_species', 'init_local_text_menu', 'init_local_text_list_menu']);

export const CONDITIONS = ['lt', 'eq', 'gt', 'le', 'ge', 'ne'] as const;
export type Condition = (typeof CONDITIONS)[number];

/** `scripts_twinleaf_town_player_house_2f` → `TwinleafTownPlayerHouse2F`. */
export function fileLabelName(file: string): string {
  return file
    .replace(/^scripts_/, '')
    .split('_')
    .map((s) => (/^\d+[a-z]+$/.test(s) ? s.toUpperCase() : s.charAt(0).toUpperCase() + s.slice(1)))
    .join('');
}

/** Kind of a scr_seq member by its decomp name: level-script tables are `scripts_init_*` (except the new-game script). */
export function memberKind(member: number): 'script' | 'init' {
  const name = SCRIPT_FILES[member];
  if (name === undefined) throw new Error(`scr_seq member ${member} out of range`);
  return name.startsWith('scripts_init_') && name !== 'scripts_init_new_game' ? 'init' : 'script';
}
