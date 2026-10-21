import { describe, expect, it } from 'vitest';
import { createGame, CountingStubLog, gameDriver, runReplay } from '@opensinnoh/game';
import { createWorld } from '@opensinnoh/world';
import { createScriptRunner } from '@opensinnoh/vm';
import { createBattle } from '@opensinnoh/battle';
import { romSlice } from '../rom.ts';
import { readReplay, resolveReplay } from '../rom-replays/sys-replays.ts';
import { m5cSystemPack } from './m5c-systems.ts';

const files = ['sys-gym-sunyshore', 'sys-hq-warp-panels', 'sys-hq-warp-panel-lab', 'sys-hq-containment', 'sys-spear-pillar-chain'];
describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('system replays', () => {
  for (const file of files)
    for (const seed of [1, 2, 3])
      it(`${file}: twice on seed ${seed}, save round trip`, async () => {
        const game = createGame({
          packs: [m5cSystemPack(romSlice().pack)],
          createWorld,
          createScriptRunner,
          createBattle,
          seed,
          log: new CountingStubLog(() => {}),
          now: () => '2009-03-22T12:00:00Z',
        });
        const phases = new Set<string>();
        const tick = game.tick.bind(game);
        game.tick = () => {
          tick();
          const scene = game.world.view().storyScene;
          if (scene?.kind === 'spear-app') {
            phases.add(scene.phase);
            expect(game.state.vars['platinum:VAR_SPEAR_PILLAR_STATE']).toBe(2);
            expect(game.canSave()).toBe(false);
          }
        };
        const result = await runReplay(gameDriver(game), readReplay(`${file}.replay`), {
          name: `${file}.replay`,
          registries: game.registries,
          resolve: resolveReplay,
          seed,
          repeat: true,
        });
        expect(result.error).toBeUndefined();
        expect(result).toMatchObject({ ok: true, determinism: 'identical', roundTrip: 'identical' });
        expect(game.world.view().storyScene).toBeUndefined();
        if (file === 'sys-spear-pillar-chain') expect([...phases]).toEqual(['summoning', 'guardians', 'giratina']);
        expect(
          [...game.log.counts.keys()].filter((k) =>
            ['scr_cmd_20d', 'scr_cmd_2fb', 'containment_units', 'sunyshore_gym'].some((op) => k.includes(op)),
          ),
        ).toEqual([]);
      }, 120000);
});
