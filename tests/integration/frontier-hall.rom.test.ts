/** the Battle Hall singles challenge (frontier-replays.ts). */
import { describe } from 'vitest';
import { frontierReplay } from './frontier-replays.ts';

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('Battle Hall singles (OPENSINNOH_NDS_ROM)', () => frontierReplay('sys-hall-single'));
