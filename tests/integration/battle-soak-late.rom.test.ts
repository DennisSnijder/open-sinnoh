/** The battle soak (tests/battle-soak.ts) on a few fixed seeds: the Battle Castle, Arcade, late-game trainers and the specials. */
import { describe } from 'vitest';
import { soakSuite } from './battle-soak-suite.ts';

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('battle soak: Castle, Arcade, late game (OPENSINNOH_NDS_ROM)', () =>
  soakSuite(['castle-single', 'castle-double', 'arcade-single', 'arcade-double', 'late-game', 'specials']));
