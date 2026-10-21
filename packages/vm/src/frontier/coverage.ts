/**
 * How the frontier VM handles each frontier command (`opensinnoh coverage`'s frontier report): a handler is real unless it
 * is a logged stand-in (`FRONTIER_STUBBED`); a command without one logs once (`frontier:<op>`) and does nothing.
 */
import { FRONTIER_COMMANDS } from './commands.ts';
import { frontierHandlers } from './ops.ts';
import { towerFrontierHandlers } from './tower-ops.ts';

/**
 * Frontier handlers that are logged stand-ins: battle videos (the Vs. Recorder: none is saved, saving one fails) and
 * the Frontier Brain cut-in (its timing and flashes, not its art).
 */
export const FRONTIER_STUBBED = ['fr_cmd_70', 'fr_cmd_6d', 'fr_init_new_battle_recording', 'fr_free_battle_recording', 'fr_play_frontier_brain_encounter_effect'];

export interface FrontierOpClassification {
  op: string;
  opcode: number;
  status: 'implemented' | 'stubbed' | 'unimplemented';
}

export function classifyFrontierOps(): FrontierOpClassification[] {
  const handled = new Set(Object.keys({ ...frontierHandlers(), ...towerFrontierHandlers() }));
  return FRONTIER_COMMANDS.map((c) => ({
    op: c.name,
    opcode: c.opcode,
    status: !handled.has(c.name) ? 'unimplemented' : FRONTIER_STUBBED.includes(c.name) ? 'stubbed' : 'implemented',
  }));
}
