/** Battle Tower doubles, multi and Palmer (frontier-replays.ts). */
import { describe } from 'vitest';
import { frontierReplay } from './frontier-replays.ts';

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('Battle Tower doubles (OPENSINNOH_NDS_ROM)', () => frontierReplay('sys-tower-double'));
describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('Battle Tower: Palmer (OPENSINNOH_NDS_ROM)', () => frontierReplay('sys-tower-palmer'));
describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('Battle Tower multi (OPENSINNOH_NDS_ROM)', () => frontierReplay('sys-tower-multi'));
