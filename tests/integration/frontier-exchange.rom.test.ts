/** the BP exchange, the IV judge and the Wi-Fi attendant's refusal (frontier-replays.ts). */
import { describe } from 'vitest';
import { frontierReplay } from './frontier-replays.ts';

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('Battle Frontier: BP exchange (OPENSINNOH_NDS_ROM)', () => frontierReplay('sys-bp-exchange'));
describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('Battle Tower: IV judge (OPENSINNOH_NDS_ROM)', () => frontierReplay('sys-iv-judge'));
describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('Battle Tower: Wi-Fi refused (OPENSINNOH_NDS_ROM)', () => frontierReplay('sys-tower-wifi'));
