/**
 * The Game Corner's `sys-` replays (the clerk, a machine played into and out of a bonus, the Prize Exchange), spread over
 * files: each runs twice on seeds 1–3 with the driver's save round trip.
 *
 * Not every build has the slot machines: the European ones (the German Platinum) have no slot launcher (ScrCmd_267) and
 * no bonus-streak prize at the clerk (ScrCmd_CheckBonusRoundStreak). A replay that needs such a command is skipped on a
 * build whose scripts never use it.
 */
import { expect, it } from 'vitest';
import { createGame, CountingStubLog, gameDriver, runReplay } from '@opensinnoh/game';
import { createWorld } from '@opensinnoh/world';
import { createScriptRunner } from '@opensinnoh/vm';
import { createBattle } from '@opensinnoh/battle';
import { createApp } from '@opensinnoh/menus';
import { romSlice } from '../rom.ts';
import { readReplay, resolveReplay } from '../rom-replays/sys-replays.ts';

/** Whether any of the pack's scripts uses the command. */
const usesOp = (op: string) => Object.values(romSlice().pack.scripts.labels).some((cmds) => cmds.some((c) => c.op === op));

export function gameCornerReplay(file: string, needs: readonly string[] = []): void {
  for (const seed of [1, 2, 3]) {
    it(`${file}: twice on seed ${seed}, save round trip`, async (ctx) => {
      const missing = needs.filter((op) => !usesOp(op));
      if (missing.length) return ctx.skip(`this build's scripts never use ${missing.join(', ')}`);
      const { pack } = romSlice();
      const game = createGame({ packs: [pack], createWorld, createScriptRunner, createBattle, createApp, seed, log: new CountingStubLog(() => {}), now: () => '2009-03-22T12:00:00Z' });
      const result = await runReplay(gameDriver(game), readReplay(`${file}.replay`), { name: `${file}.replay`, resolve: resolveReplay, registries: game.registries, seed, repeat: true });
      expect(result.error).toBeUndefined();
      expect(result).toMatchObject({ ok: true, determinism: 'identical', roundTrip: 'identical' });
    }, 600000);
  }
}
