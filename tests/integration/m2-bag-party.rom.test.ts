/**
 * Wild battles on the real ROM (OPENSINNOH_NDS_ROM): catching, the bag, switching, learning a move and running
 * in wild battles on Route 202, as replays (tests/rom-replays/m2-*.replay), each run twice from its seeds
 * with a save round trip after the battle. The game hosts the menu apps, so m2-bag drives the battle bag
 * and party sheets by keys and taps, as the browser does.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PackData } from '@opensinnoh/core';
import { BattleText, createBattle, pages } from '@opensinnoh/battle';
import { CountingStubLog, createGame, gameDriver, runReplay, type Game, type ReplayResolver } from '@opensinnoh/game';
import { createApp } from '@opensinnoh/menus';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';
import { romSlice } from '../rom.ts';

const romPath = process.env.OPENSINNOH_NDS_ROM;
const dir = join(import.meta.dirname, '../rom-replays');
const read = (file: string) => readFileSync(join(dir, file), 'utf8');

/** Replays and their seeds (m2-run's first try fails and its second escapes on seed 4 only). */
const REPLAYS: [string, number[]][] = [
  ['m2-catch-202.replay', [1, 2, 3]],
  ['m2-bag.replay', [1, 2]],
  ['m2-switch.replay', [1, 2]],
  ['m2-learn-move.replay', [1]],
  ['m2-run.replay', [4]],
];

describe.skipIf(!romPath)('catching, bag, switching, learning and running (OPENSINNOH_NDS_ROM)', () => {
  let pack: PackData;
  beforeAll(() => {
    ({ pack } = romSlice());
  }, 60_000);

  /** Plays a replay twice with a round trip; the finished battle messages and the player's battler species over time. */
  const play = async (file: string, seed: number): Promise<{ game: Game; log: CountingStubLog; messages: string[]; leads: string[] }> => {
    const log = new CountingStubLog(() => {});
    const game = createGame({ packs: [pack], createWorld, createScriptRunner, createBattle, createApp, seed, log, now: () => '2026-01-01T00:00:00.000Z' });
    const messages: string[] = [];
    const leads: string[] = [];
    const tick = game.tick.bind(game);
    game.tick = () => {
      tick();
      const v = game.battle?.view();
      const m = v?.message;
      if (m?.done && m.text !== messages.at(-1)) messages.push(m.text);
      const lead = v?.battlers.find((b) => b.side === 'player' && b.visible);
      if (lead && lead.species !== leads.at(-1)) leads.push(lead.species);
    };
    const resolve: ReplayResolver = (f) => ({ name: f, text: read(f) });
    const result = await runReplay(gameDriver(game), read(file), { registries: game.registries, seed, name: file, resolve });
    expect(result.error).toBeUndefined();
    expect(result).toMatchObject({ ok: true, determinism: 'identical', roundTrip: 'identical' });
    return { game, log, messages, leads };
  };

  for (const [file, seeds] of REPLAYS) {
    for (const seed of seeds) {
      it(`${file} passes from seed ${seed}, twice, with a save round trip`, async () => {
        const { game, log, messages, leads } = await play(file, seed);
        const text = new BattleText(game.registries);
        const name = (species: string) => game.registries.species.get(species as never)!.name;
        if (file === 'm2-switch.replay') {
          // The switches happen in the battle: Piplup is called back, Starly comes out, then Piplup again.
          const piplup = 'platinum:SPECIES_PIPLUP';
          const starly = 'platinum:SPECIES_STARLY';
          expect(leads.slice(0, 3)).toEqual([piplup, starly, piplup]);
          const recalls = ['PokemonSwitchOutComeBack', 'PokemonComeBack', 'PokemonGoodComeBack', 'PokemonOKComeBack', 'PokemonEnoughGetBack'];
          const sendOuts = ['YourFoesWeakGetEmPokemon', 'JustALittleMoreHangInTherePokemon', 'GoForItPokemon', 'YoureInChargePokemon', 'GoPokemon'];
          const lines = (names: string[], species: string) => names.map((n) => pages(text.get(n, [name(species)]), [])[0]!);
          const first = messages.findIndex((m) => lines(recalls, piplup).includes(m));
          expect(first, 'Piplup is called back').toBeGreaterThanOrEqual(0);
          expect(lines(sendOuts, starly), 'then Starly is sent out').toContain(messages[first + 1]);
        }
        if (file === 'm2-run.replay') {
          // The first try fails ("Can't escape!", the foe still acts), the second gets away.
          const cant = pages(text.get('CantEscape'), [])[0]!;
          const away = pages(text.get('GotAwaySafely'), [])[0]!;
          expect(messages).toContain(cant);
          expect(messages.indexOf(cant)).toBeLessThan(messages.indexOf(away));
        }
        if (file === 'm2-catch-202.replay') {
          const caught = game.state.party[1]!;
          expect(caught).toMatchObject({ ball: 'platinum:ITEM_POKE_BALL', otName: game.state.names.player, met: { zone: 'platinum:MAP_HEADER_ROUTE_202', level: caught.level } });
          expect(game.state.pokedex.caught).toContain(caught.species);
          // The trainer score (decomp UpdateGameRecords): a regional catch +2 and a new species +20.
          expect(game.state.records.score).toBe(22);
          // The Pokédex entry of the new species was shown (the menus host it) and closed with A.
          expect(log.report().map((s) => s.key).filter((k) => k.includes('pokedex-entry'))).toEqual([]);
        }
      }, 120_000);
    }
  }
});
