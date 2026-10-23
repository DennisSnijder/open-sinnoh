/**
 * How the frontier VM handles each frontier command (`opensinnoh coverage`'s frontier report): a handler is real unless it
 * is a logged stand-in (`FRONTIER_STUBBED`); a command without one logs once (`frontier:<op>`) and does nothing.
 */
import { FRONTIER_COMMANDS } from './commands.ts';
import { frontierHandlers } from './ops.ts';
import { towerFrontierHandlers } from './tower-ops.ts';
import { factoryFrontierHandlers } from './factory-ops.ts';
import { hallFrontierHandlers } from './hall-ops.ts';

/**
 * Frontier handlers that are logged stand-ins: battle videos (the Vs. Recorder: none is saved, saving one fails), the
 * Frontier Brain cut-in (its timing and flashes, not its art), the particle effects (not drawn; no emitter to wait for)
 * and the Hall's TV segment.
 */
export const FRONTIER_STUBBED = [
  'fr_cmd_70',
  'fr_cmd_6d',
  'fr_init_new_battle_recording',
  'fr_free_battle_recording',
  'fr_play_frontier_brain_encounter_effect',
  'fr_init_particle_system',
  'fr_free_particle_system',
  'fr_create_particle_system_emitter',
  'fr_wait_for_particle_system_emitters',
  'fr_cmd_c7',
];

export interface FrontierOpClassification {
  op: string;
  opcode: number;
  status: 'implemented' | 'stubbed' | 'unimplemented';
}

export function classifyFrontierOps(): FrontierOpClassification[] {
  const handled = new Set(Object.keys({ ...frontierHandlers(), ...towerFrontierHandlers(), ...factoryFrontierHandlers(), ...hallFrontierHandlers() }));
  return FRONTIER_COMMANDS.map((c) => ({
    op: c.name,
    opcode: c.opcode,
    status: !handled.has(c.name) ? 'unimplemented' : FRONTIER_STUBBED.includes(c.name) ? 'stubbed' : 'implemented',
  }));
}
