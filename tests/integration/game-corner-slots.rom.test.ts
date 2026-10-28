/** The Game Corner: a machine played into and out of a bonus (sys-game-corner-slots.replay, game-corner-replays.ts). */
import { describe } from 'vitest';
import { gameCornerReplay } from './game-corner-replays.ts';

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('Game Corner: slots (OPENSINNOH_NDS_ROM)', () => gameCornerReplay('sys-game-corner-slots', ['scr_cmd_267']));
