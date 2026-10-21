/**
 * Warms the battle engine ahead of the first battle: builds the packs' dex (`simData`) and plays one throwaway
 * turn on it, so the sim's data tables are loaded and its turn code compiled. Cold, the tick that starts a
 * session's first battle took about 110 ms and its first turn about 21 ms at 4x CPU throttling (6 ms each warm).
 * The throwaway battle has its own PRNG and touches no game state.
 */
import type { Registries, StubLog } from '@opensinnoh/contracts';
import { simData } from './dex.ts';

const set = (species: string, ability: string) => ({
  name: species,
  species,
  item: '',
  ability,
  moves: ['tackle', 'growl'],
  nature: 'Hardy',
  gender: '',
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  level: 50,
});

export function warmBattleEngine(reg: Registries, log: StubLog): void {
  const battle = simData(reg, log).createBattle('wild', 'singles', {});
  battle.setPlayer('p1', { name: 'p1', team: [set('Bidoof', 'Simple')] });
  battle.setPlayer('p2', { name: 'p2', team: [set('Starly', 'Keen Eye')] });
  battle.choose('p1', 'move 1');
  battle.choose('p2', 'move 1');
  if (battle.turn < 2) throw new Error(`battle warm-up: the turn did not run (turn ${battle.turn})`);
  battle.destroy();
}
