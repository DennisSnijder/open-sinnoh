/** The battle soak (tests/battle-soak.ts) on a few fixed seeds: the Battle Tower, Factory and Hall. tools/battle-soak.ts runs it at scale. */
import { describe } from 'vitest';
import { soakSuite } from './battle-soak-suite.ts';

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('battle soak: Tower, Factory, Hall (OPENSINNOH_NDS_ROM)', () =>
  soakSuite(['tower-single', 'tower-double', 'tower-multi', 'factory-single', 'factory-double', 'factory-open', 'hall-single', 'hall-double']));
