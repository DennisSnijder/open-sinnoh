/**
 * The Underground's traps on the ROM: laid traps set off (the Leaf Trap's escape, the Move Up Trap's slide), one dug up
 * again, the touch radar, a hidden Hole Trap of the day's climbed out of,
 * and ten hidden traps dug up in one visit (the TV's traps record).
 */
import { describe } from 'vitest';
import { undergroundReplay } from './underground-replays.ts';

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('Underground traps (OPENSINNOH_NDS_ROM)', () => {
  undergroundReplay('sys-underground-trap');
  undergroundReplay('sys-underground-hole');
  undergroundReplay('sys-underground-traps-record');
});
