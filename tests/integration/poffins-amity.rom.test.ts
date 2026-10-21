/** an Amity Square walk with Pikachu, ending in its find. */
import { describe } from 'vitest';
import { poffinReplay } from './poffin-replays.ts';

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('Amity Square (OPENSINNOH_NDS_ROM)', () => poffinReplay('sys-amity-square'));
