/** The Game Corner: the clerk's coins and TM64 (sys-game-corner-clerk.replay, game-corner-replays.ts). */
import { describe } from 'vitest';
import { gameCornerReplay } from './game-corner-replays.ts';

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('Game Corner: clerk (OPENSINNOH_NDS_ROM)', () => gameCornerReplay('sys-game-corner-clerk', ['check_bonus_round_streak']));
