/** The Game Corner: the Prize Exchange and the guitarist (sys-game-corner-prizes.replay, game-corner-replays.ts). */
import { describe } from 'vitest';
import { gameCornerReplay } from './game-corner-replays.ts';

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('Game Corner: prizes (OPENSINNOH_NDS_ROM)', () => gameCornerReplay('sys-game-corner-prizes'));
