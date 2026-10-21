/**
 * Fly and Teleport (decomp field_move_tasks.c, applications/town_map, overlay006/hm_cut_in.c and field_warp.c),
 * headless with the real menu apps: `sys-fly` and `sys-teleport`, each twice on seeds 1–3 with a save round trip;
 * the refusal message the party prints; the roamers scattered by a flight (FieldSystem_SetFlyFlags).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createBattle } from '@opensinnoh/battle';
import type { Id } from '@opensinnoh/core';
import type { PartyView } from '@opensinnoh/contracts';
import { CountingStubLog, createGame, gameDriver, runReplay, type ReplayResolver } from '@opensinnoh/game';
import { createApp, plainText } from '@opensinnoh/menus';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';
import { romSlice } from '../rom.ts';

const dir = join(import.meta.dirname, '../rom-replays');
const read = (file: string) => readFileSync(join(dir, file), 'utf8');
const resolve: ReplayResolver = (file) => ({ name: file, text: read(file) });
const newGame = (seed: number, log = new CountingStubLog(() => {})) => createGame({ packs: [romSlice().pack], createWorld, createScriptRunner, createApp, createBattle, seed, log, now: () => '2026-01-01T00:00:00.000Z' });
const id = (s: string) => `platinum:${s}` as Id;

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('Fly and Teleport (OPENSINNOH_NDS_ROM)', () => {
  for (const name of ['sys-fly', 'sys-teleport'])
    for (const seed of [1, 2, 3])
      it(`${name}: twice on seed ${seed}, save round trip`, async () => {
        const lines: string[] = [];
        const log = new CountingStubLog((l) => lines.push(l));
        const game = newGame(seed, log);
        const result = await runReplay(gameDriver(game), read(`${name}.replay`), { registries: game.registries, seed, name: `${name}.replay`, resolve, repeat: true });
        expect(result.error).toBeUndefined();
        expect(result).toMatchObject({ ok: true, determinism: 'identical', roundTrip: 'identical' });
        expect(lines.filter((k) => k.includes('field-move') || k.includes('sequence-missing'))).toEqual([]);
      }, 300_000);

  it('the party prints the ROM refusals: no Cobble Badge, a building', async () => {
    const message = async (setup: string) => {
      const game = newGame(1);
      await runReplay(gameDriver(game), `${setup}\nuntil idle\n+1 press x\n+1 release x\nuntil app start-menu\n+1 tap entry:0\n+1 tap slot:0\n+1 tap menu:1\n+1 assert app party\n`, { registries: game.registries, seed: 1, name: 'refusal', resolve, repeat: false });
      return (game.app() as PartyView).message?.text;
    };
    const party = 'party 0 platinum:SPECIES_STARAPTOR 40 platinum:MOVE_FLY';
    const texts = newGame(1).registries.texts;
    const text = (name: string) => plainText(texts.get(id(name))!.text, []);
    expect(await message(`${party}\nwarp platinum:MAP_HEADER_OREBURGH_CITY 303 757 down`)).toBe(text('PartyMenu_Text_CantBeUsedUntilBadgeIsObtained'));
    expect(await message(`give badge platinum:BADGE_ID_COBBLE\n${party}\nwarp platinum:MAP_HEADER_OREBURGH_CITY_POKECENTER_1F 8 6 up`)).toBe(text('PartyMenu_Text_CantUseThatHere'));
  }, 120_000);

  it('a flight scatters the roamers (FieldSystem_SetFlyFlags → RoamingPokemon_RandomizeAllLocations)', async () => {
    for (const seed of [1, 2, 3]) {
      const game = newGame(seed);
      await runReplay(gameDriver(game), 'give badge platinum:BADGE_ID_COBBLE\nparty 0 platinum:SPECIES_STARAPTOR 40 platinum:MOVE_FLY\nset flag platinum:FLAG_FIRST_ARRIVAL_JUBILIFE_CITY true\nwarp platinum:MAP_HEADER_OREBURGH_CITY 303 757 down\nuntil idle\n', { registries: game.registries, seed, name: 'roamer', resolve, repeat: false });
      // The runner's save round trip ends on a fresh load (its fade-in).
      for (let i = 0; i < 60 && !game.canSave(); i++) game.tick();
      game.world.activateRoamer(1);
      const before = game.state.roamers.routes[1];
      game.useFieldMove(0, id('MOVE_FLY'), 7);
      for (let i = 0; i < 600 && !game.world.flyDone(); i++) game.tick();
      expect(game.world.flyDone()).toBe(true);
      expect(game.state.player.zone).toBe(id('MAP_HEADER_JUBILIFE_CITY'));
      expect(game.state.roamers.routes[1], `seed ${seed}`).not.toBe(before);
    }
  }, 120_000);
});
