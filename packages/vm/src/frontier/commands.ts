import table from '../data/frontier-commands.json' with { type: 'json' };

/** One operand of a frontier script command (the generated table, tools/gen-frontier-commands.ts). */
export interface FrontierOperandSpec {
  name: string;
  type: 'u8' | 'u16' | 'u32' | 'rel';
  /**
   * u16: `vov` a var or a value, `var` a frontier var (both kept as the raw u16: decomp FrontierScriptContext_GetVar
   * resolves 0x8000–0x8013 at run time), `sysvar` a field var, `msg` a message of the scene's text bank. rel: `code` a
   * branch target, `movement` a movement list, `table` an inline table.
   */
  kind?: 'vov' | 'var' | 'sysvar' | 'msg' | 'code' | 'movement' | 'table';
}

export interface FrontierCommandSpec {
  opcode: number;
  name: string;
  macro: string;
  operands: FrontierOperandSpec[];
  /** The inline table a `table` operand points at (decomp FrontierScrCmd_22/24/2A/2C). */
  table?: 'objects' | 'actors' | 'sprite-resources' | 'sprites';
}

export const FRONTIER_COMMANDS = table.commands as FrontierCommandSpec[];
export const FRONTIER_COMMAND_BY_NAME = new Map(FRONTIER_COMMANDS.map((c) => [c.name, c]));
/** Frontier movement action → name (decomp FRONTIER_MOVEMENT_*, lower-case); a Movement step op is `fr_<name>`. */
export const FRONTIER_MOVEMENT_ACTIONS = table.movementActions as (string | null)[];
/** fr_script member index → decomp file name (`frontier_scripts_battle_tower_corridor`, `frontier_scripts_unused_04`). */
export const FRONTIER_SCRIPT_FILES = table.scriptFiles;

/** `frontier_scripts_battle_tower_corridor` → `FrontierBattleTowerCorridor` (label namespace of the file). */
export function frontierFileLabelName(file: string): string {
  return `Frontier${file
    .replace(/^frontier_scripts_/, '')
    .split('_')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('')}`;
}

/** Decomp FrontierScriptContext_GetVarPointer: SCRIPT_LOCAL_VARS_START (0x8000) up to the context's data vars. */
export const FRONTIER_VARS = { first: 0x8000, last: 0x8013 } as const;
/** The table terminator and the stand-ins a table row's graphics take (decomp FrontierScrCmd_22/24). */
export const FRONTIER_TABLE = { end: 0xfd13, player: 0xeeee, linkPlayers: 0xeeef } as const;
