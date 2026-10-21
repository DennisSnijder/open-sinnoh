/**
 * Script ops in the real game (OPENSINNOH_NDS_ROM): short headless replays from setup lines. None of
 * the ops under test may log a stub.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Id, PackData } from '@opensinnoh/core';
import { createBattle } from '@opensinnoh/battle';
import { CountingStubLog, createGame, gameDriver, runReplay, type Game } from '@opensinnoh/game';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';
import { romSlice } from '../rom.ts';

const romPath = process.env.OPENSINNOH_NDS_ROM;

describe.skipIf(!romPath)('script ops (OPENSINNOH_NDS_ROM)', () => {
  let pack: PackData;
  beforeAll(() => {
    ({ pack } = romSlice());
  }, 60_000);

  /** Plays a replay; `previews` collects the species of every Pokémon preview on screen after a tick. */
  const play = async (name: string, text: string, ops: string[], seed = 1): Promise<{ game: Game; previews: Set<Id> }> => {
    const log = new CountingStubLog(() => {});
    const game = createGame({ packs: [pack], createWorld, createScriptRunner, createBattle, seed, log, now: () => '2026-01-01T00:00:00.000Z' });
    const previews = new Set<Id>();
    const step = game.step.bind(game);
    game.step = (input) => {
      step(input);
      const p = game.scripts.view().pokemonPreview;
      if (p) previews.add(p.species);
    };
    const result = await runReplay(gameDriver(game), text, { registries: game.registries, seed, name, repeat: false });
    expect(result.error, name).toBeUndefined();
    expect(result.ok, name).toBe(true);
    expect([...log.counts.keys()].filter((k) => ops.some((op) => k.includes(op))), name).toEqual([]);
    return { game, previews };
  };

  it('the Pokémon Mansion book: the preview shows Manaphy and marks it seen (draw_pokemon_preview), then the dex message', async () => {
    const manaphy = 'platinum:SPECIES_MANAPHY' as Id;
    const { game, previews } = await play(
      'mansion-book',
      `warp platinum:MAP_HEADER_POKEMON_MANSION_OFFICE 16 5 down
until idle
+0 press a
+1 release a
advance text 600
+0 press a
+1 release a
${'+30 press a\n+1 release a\n'.repeat(20)}advance text 3000
until idle 3000
+0 assert flag platinum:FLAG_SKIP_POKEMON_MANSION_OFFICE_BOOK_SEEN_MANAPHY_CHECK true
`,
      ['draw_pokemon_preview', 'remove_pokemon_preview'],
    );
    expect(previews).toEqual(new Set([manaphy]));
    expect(game.state.pokedex.seen).toContain(manaphy);
    expect(game.scripts.view().pokemonPreview).toBeUndefined();
  });

  it('the Old Chateau dining area: its onTransition shows the old man on a 10% draw (check_should_show_ghost); he walks off at once', async () => {
    let shown = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const { game } = await play(`ghost-${seed}`, `warp platinum:MAP_HEADER_OLD_CHATEAU_DINING_AREA 19 10 up\nuntil idle 600\n+0 assert flag platinum:FLAG_HIDE_OLD_CHATEAU_DINING_AREA_OLD_MAN true\n`, ['check_should_show_ghost'], seed);
      // Shown: the onFrame walks the player a step north to watch him leave (decomp OldChateauDiningArea_OnFrame_OldManLeave).
      if (game.state.player.z === 9) shown++;
      else expect(game.state.player.z).toBe(10);
    }
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(20);
  }, 300_000);
});
