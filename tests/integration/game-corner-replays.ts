/**
 * The Game Corner's `sys-` replays (the clerk, a machine played into and out of a bonus, the Prize Exchange), spread over
 * files: each runs twice on seeds 1–3 with the driver's save round trip.
 *
 * Only the US build has the slot machines: the European ones (the German and the European English Platinum) have no
 * slot launcher (ScrCmd_267) and no bonus-streak prize at the clerk (ScrCmd_CheckBonusRoundStreak). A replay that needs
 * them skips there, by the build: on the US ROM it always runs.
 */
import { expect, it } from 'vitest';
import { createGame, CountingStubLog, gameDriver, runReplay } from '@opensinnoh/game';
import { createWorld } from '@opensinnoh/world';
import { createScriptRunner } from '@opensinnoh/vm';
import { createBattle } from '@opensinnoh/battle';
import { createApp } from '@opensinnoh/menus';
import { hasSlotMachines, romSlice } from '../rom.ts';
import { readReplay, resolveReplay } from '../rom-replays/sys-replays.ts';

export function gameCornerReplay(file: string, needsSlots = false): void {
  for (const seed of [1, 2, 3]) {
    it(`${file}: twice on seed ${seed}, save round trip`, async (ctx) => {
      if (needsSlots && !hasSlotMachines()) return ctx.skip('this build has no slot machines');
      const { pack } = romSlice();
      const game = createGame({ packs: [pack], createWorld, createScriptRunner, createBattle, createApp, seed, log: new CountingStubLog(() => {}), now: () => '2009-03-22T12:00:00Z' });
      const result = await runReplay(gameDriver(game), readReplay(`${file}.replay`), { name: `${file}.replay`, resolve: resolveReplay, registries: game.registries, seed, repeat: true });
      expect(result.error).toBeUndefined();
      expect(result).toMatchObject({ ok: true, determinism: 'identical', roundTrip: 'identical' });
    }, 600000);
  }
}
