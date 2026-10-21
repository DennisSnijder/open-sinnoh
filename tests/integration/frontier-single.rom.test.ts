/** the Battle Tower singles streak (frontier-replays.ts). */
import { describe } from 'vitest';
import { frontierReplay } from './frontier-replays.ts';

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('Battle Tower singles (OPENSINNOH_NDS_ROM)', () => frontierReplay('sys-tower-single'));
