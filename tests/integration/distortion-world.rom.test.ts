/**
 * The Distortion World's supports, jumps and elevators on the real ROM (OPENSINNOH_NDS_ROM),
 * from constructed starts (warps into the rooms): B1F's west wall (jump on, walk it, jump off), B2F's wall onto
 * its floor supports, B4F's east wall and ceiling, and the 1F elevator down to B1F. Each replay asserts the
 * shared-space position (x, height, z), the support and the surface, and passes twice from seeds 1–3 with a
 * save round trip at its end. The per-room story replays are `dw-*` (dw-replays.ts).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { PackData } from '@opensinnoh/core';
import { CountingStubLog, createGame, gameDriver, runReplay } from '@opensinnoh/game';
import { createBattle } from '@opensinnoh/battle';
import { createApp } from '@opensinnoh/menus';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';
import { ROM, romSlice } from '../rom.ts';

const R = (room: string) => `platinum:MAP_HEADER_DISTORTION_WORLD_${room}`;

const REPLAYS: Record<string, string> = {
  // B1F: the land jump point (12, 257, 49) pressing left lands on the west wall at (11, 258, 48); up is +y there,
  // left +z; pressing down at the jump-off point (11, 258, 48) lands back on the land at (12, 257, 49).
  'b1f-west-wall': `
warp ${R('B1F')} 12 49 left
until idle
+0 assert state mapFeatures.support null
+0 assert state player.y ${257 * 16}
+0 press left
+1 release left
until idle
+0 assert state player {"zone":"${R('B1F')}","x":11,"z":48,"y":${258 * 16},"facing":"left"}
+0 assert state mapFeatures.support 0
+0 press up
until state player.y ${260 * 16} 60
+0 release up
until idle
+0 assert state player.facing "left"
+0 press left
until state player.z 49 30
+0 release left
until idle
+0 assert state player.facing "down"
+0 press right
until state player.z 48 30
+0 release right
until idle
+0 press down
until state player.y ${258 * 16} 60
+0 release down
until idle
+1 press down
+1 release down
until idle
+0 assert state player {"zone":"${R('B1F')}","x":12,"z":49,"y":${257 * 16},"facing":"right"}
+0 assert state mapFeatures.support null
`,
  // B2F: the land jump point (31, 225, 23) pressing left lands on the west wall at (30, 226, 22); up the wall
  // (+y) and right along it (−z) to (30, 233, 15), where pressing down lands on floor support 0 at (31, 233, 15);
  // at (35, 233, 15) the room's event carries the player 9 tiles east on platform 9 and jumps it 3 more, onto the
  // next island, whose cells end at z 17: the support's grid, not the land below, stops the walk.
  'b2f-wall-to-floors': `
set var platinum:VAR_DISTORTION_WORLD_PROGRESS 5
warp ${R('B2F')} 31 23 left
until idle
+0 press left
+1 release left
until idle
+0 assert state player {"zone":"${R('B2F')}","x":30,"z":22,"y":${226 * 16},"facing":"left"}
+0 assert state mapFeatures.support 4
+0 press up
until state player.y ${233 * 16} 200
+0 release up
until idle
+0 press right
until state player.z 15 200
+0 release right
until idle
+1 press down
+1 release down
until idle
+0 assert state player {"zone":"${R('B2F')}","x":31,"z":15,"y":${233 * 16},"facing":"right"}
+0 assert state mapFeatures.support 0
+0 press right
until state player.x 35 60
+0 release right
until idle 400
+0 assert state player {"zone":"${R('B2F')}","x":47,"z":15,"y":${233 * 16},"facing":"right"}
+0 press down
until state player.z 17 60
+40 release down
until idle
+0 assert state player {"zone":"${R('B2F')}","x":47,"z":17,"y":${233 * 16},"facing":"down"}
`,
  // B4F: the land jump point (105, 161, 56–57) pressing right lands on the east wall at (106, 161, 55); right along
  // the wall (+z) and up it (+y) to (106, 169, 61), where pressing up lands on the ceiling at (106, 170, 61); up
  // on the ceiling is +z, drawn facing down.
  'b4f-east-wall-ceiling': `
warp ${R('B4F')} 105 56 right
until idle
+0 press right
+1 release right
until idle
+0 assert state player {"zone":"${R('B4F')}","x":106,"z":55,"y":${161 * 16},"facing":"right"}
+0 assert state mapFeatures.support 0
+0 press right
until state player.z 61 120
+0 release right
until idle
+0 assert state player.facing "down"
+0 press up
until state player.y ${169 * 16} 200
+0 release up
until idle
+0 assert state player.facing "right"
+1 press up
+1 release up
until idle
+0 assert state player {"zone":"${R('B4F')}","x":106,"z":61,"y":${170 * 16},"facing":"right"}
+0 assert state mapFeatures.support 1
+0 press up
until state player.z 63 60
+0 release up
until idle
+0 assert state player.facing "down"
`,
  // 1F: the elevator platform at (40, 289, 54) rides path 0 down to B1F (the floor changes on the way), and leaves
  // the player on B1F's platform at (40, 257, 54) with its platform flag set. Progress ENTERED_B1F: past 1F's scenes.
  '1f-elevator': `
set var platinum:VAR_DISTORTION_WORLD_PROGRESS 3
warp ${R('1F')} 40 55 up
until idle
+0 press up
until position 40 54
+0 release up
until state player.zone "${R('B1F')}" 200
until idle 200
+0 assert state player {"zone":"${R('B1F')}","x":40,"z":54,"y":${257 * 16},"facing":"up"}
+0 assert state mapFeatures.platformFlags ${(1 << 0) | (1 << 3) | (1 << 7)}
`,
};

describe.skipIf(!ROM)('Distortion World supports, jumps and elevators (OPENSINNOH_NDS_ROM)', () => {
  let pack: PackData;
  beforeAll(() => {
    ({ pack } = romSlice());
  });
  const newGame = (seed: number) => createGame({ packs: [pack], createWorld, createScriptRunner, createBattle, createApp, seed, log: new CountingStubLog(() => {}), now: () => '2026-01-01T00:00:00.000Z' });

  for (const [name, text] of Object.entries(REPLAYS)) {
    for (const seed of [1, 2, 3]) {
      it(`${name} passes twice from seed ${seed} and round-trips its save`, async () => {
        const game = newGame(seed);
        const result = await runReplay(gameDriver(game), text, { registries: game.registries, seed, name });
        expect(result.error).toBeUndefined();
        expect(result).toMatchObject({ ok: true, determinism: 'identical', roundTrip: 'identical' });
      }, 120_000);
    }
  }
});
