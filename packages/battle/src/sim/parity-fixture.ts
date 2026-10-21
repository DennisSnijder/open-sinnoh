/** Original creatures and synthetic stats; known move IDs exercise the pack's Gen 4 sim mod. */
import { simData } from './dex.ts';
import { registries } from '../controller/parity-fixture.ts';

const data = simData(registries, { stub() {} });
export function set(moves: string[], ability = 'No Ability', item = '') {
  const stats = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  return { species: 'Mosslet', name: 'Test', level: 50, moves, ability, item, nature: 'Hardy', gender: 'M', evs: stats, ivs: stats };
}
export function start(p1 = [set(['splash'])], p2 = [set(['splash'])], gameType: 'singles' | 'doubles' = 'singles') {
  const battle = data.createBattle('trainer', gameType, { seed: 'sodium,00000000000000000000000000000000', strictChoices: true });
  battle.setPlayer('p1', { team: p1 });
  battle.setPlayer('p2', { team: p2 });
  for (const p of battle.getAllPokemon()) {
    p.hp = p.maxhp = p.baseMaxhp = 160;
    p.storedStats = { atk: 100, def: 100, spa: 100, spd: 100, spe: p.side.n === 0 ? 100 : 50 };
    p.speed = p.storedStats.spe;
  }
  return battle;
}
