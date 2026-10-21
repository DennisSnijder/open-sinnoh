/**
 * The Underground on the ROM: mining a wall, burying a sphere and its growth across a day, a vendor,
 * a treasure into the bag.
 */
import { describe } from 'vitest';
import { undergroundReplay } from './underground-replays.ts';

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('Underground mining and spheres (OPENSINNOH_NDS_ROM)', () => {
  undergroundReplay('sys-underground-dig');
  undergroundReplay('sys-sphere-growth');
  undergroundReplay('sys-underground-vendor');
  undergroundReplay('sys-underground-treasure');
});
