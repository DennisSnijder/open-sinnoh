/** the Battle Castle singles challenge (frontier-replays.ts). */
import { describe } from 'vitest';
import { frontierReplay } from './frontier-replays.ts';

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('Battle Castle singles (OPENSINNOH_NDS_ROM)', () => frontierReplay('sys-castle-single'));
