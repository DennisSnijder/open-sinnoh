/**
 * The Underground's secret base on the ROM: the Digger Drill digs it, the entrance is closed to decorate, two goods are
 * placed (a touch on the floor, the keys), the game is saved and loaded, a good's writing is read, and out again.
 */
import { describe } from 'vitest';
import { undergroundReplay } from './underground-replays.ts';

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('the secret base (OPENSINNOH_NDS_ROM)', () => {
  undergroundReplay('sys-underground-base');
});
