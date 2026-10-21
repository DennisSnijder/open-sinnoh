/** Full field-system replays: twice on EACH seed, with the driver's canonical save round trip. */
import { describe, expect, it } from 'vitest';
import { createGame, CountingStubLog, gameDriver, runReplay } from '@opensinnoh/game';
import { createWorld } from '@opensinnoh/world';
import { createScriptRunner } from '@opensinnoh/vm';
import { createBattle } from '@opensinnoh/battle';
import { createApp } from '@opensinnoh/menus';
import { romSlice } from '../rom.ts';
import { readReplay, resolveReplay } from '../rom-replays/sys-replays.ts';

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('field items and daily events (OPENSINNOH_NDS_ROM)', () => {
  it('imports the Feebas tiles on Mt. Coronet B1F only (MapHeader_HasFeebasTiles)', () => {
    const { pack } = romSlice();
    const zones = (pack.registries.zones ?? []) as { id: string; feebas?: { species: string; tiles: number[] } }[];
    expect(zones.filter((z) => z.feebas).map((z) => z.id)).toEqual(['platinum:MAP_HEADER_MT_CORONET_B1F']);
    const { species, tiles } = zones.find((z) => z.feebas)!.feebas!;
    expect(species).toBe('platinum:SPECIES_FEEBAS');
    expect(tiles.length).toBeGreaterThanOrEqual(4);
    expect(Math.floor(tiles.length / 4)).toBeLessThan(256);
  });
  for (const file of ['sys-vs-seeker', 'sys-fishing', 'sys-escape-rope', 'sys-escape-rope-north', 'svc-daily-events']) for (const seed of [1, 2, 3]) {
    it(`${file}: twice on seed ${seed}, save round trip`, async () => {
      const { pack } = romSlice();
      const game = createGame({ packs: [pack], createWorld, createScriptRunner, createBattle, createApp, seed, log: new CountingStubLog(() => {}), now: () => '2009-03-22T12:00:00Z' });
      const result = await runReplay(gameDriver(game), readReplay(`${file}.replay`), { name: `${file}.replay`, resolve: resolveReplay, registries: game.registries, seed, repeat: true, beforeLine: (line) => {
        if (file === 'sys-fishing' && line.action.type === 'press' && line.action.button === 'a') {
          expect(game.world.view().actors.find((a) => a.localId === 255)!.emote).toBe(true);
        }
      } });
      expect(result.error).toBeUndefined();
      expect(result).toMatchObject({ ok: true, determinism: 'identical', roundTrip: 'identical' });
    }, 120000);
  }
});
