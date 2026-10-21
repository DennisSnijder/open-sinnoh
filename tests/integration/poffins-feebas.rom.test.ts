/** Dry-Sweet Poffins raise Feebas's beauty; a level up evolves it into Milotic. */
import { describe } from 'vitest';
import { poffinReplay } from './poffin-replays.ts';

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('Feebas into Milotic (OPENSINNOH_NDS_ROM)', () => poffinReplay('sys-feebas-milotic'));
