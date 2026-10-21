/**
 * The wild battle on the real ROM (OPENSINNOH_NDS_ROM): the battle engine maps every ROM species and move, the
 * battle texts exist (bank 368 = TEXT_BANK_BATTLE_STRINGS), and `m2-wild-201.replay` (from the opening)
 * fights a real wild battle on Route 201, twice from each of seeds 1–3, with save round trips before
 * and after the battle.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PackData } from '@opensinnoh/core';
import { battleStringNames, createBattle, simData } from '@opensinnoh/battle';
import { CountingStubLog, createGame, gameDriver, loadGamePacks, runReplay, type ReplayResolver } from '@opensinnoh/game';
import { romSlice } from '../rom.ts';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';

const romPath = process.env.OPENSINNOH_NDS_ROM;
const dir = join(import.meta.dirname, '../rom-replays');
const read = (file: string) => readFileSync(join(dir, file), 'utf8');

describe.skipIf(!romPath)('a wild battle on Route 201 (OPENSINNOH_NDS_ROM)', () => {
  let pack: PackData;
  beforeAll(async () => {
    ({ pack } = romSlice());
  }, 60_000);

  it('maps every ROM species and move to the sim, and the ROM has the battle texts', () => {
    const { registries } = loadGamePacks([pack]);
    const log = new CountingStubLog(() => {});
    const data = simData(registries, log);
    // The three non-Pokémon entries (none, egg, bad egg) have no sim species (sim/dex.rom.test.ts).
    for (const s of registries.species.values()) if (!['platinum:SPECIES_NONE', 'platinum:SPECIES_EGG', 'platinum:SPECIES_BAD_EGG'].includes(s.id)) expect(() => data.species(s.id), s.id).not.toThrow();
    for (const m of registries.moves.values()) expect(() => data.move(m.id), m.id).not.toThrow();
    // No move becomes a custom sim entry.
    expect(log.report().filter((s) => s.key.startsWith('battle:move-effect'))).toEqual([]);
    const bank = registries.textBanks.get('platinum:TEXT_BANK_BATTLE_STRINGS')!;
    expect(bank.sourceIndex).toBe(368);
    expect(bank.messages).toHaveLength(1269);
    for (const n of battleStringNames()) expect(bank.messages, n).toContain(`platinum:BattleStrings_Text_${n}`);
    expect(registries.textBanks.get('platinum:TEXT_BANK_MOVES_USED_IN_BATTLE')!.messages).toHaveLength(468 * 3);
  });

  for (const seed of [1, 2, 3]) {
    it(`m2-wild-201.replay wins a wild battle, twice from seed ${seed}, with save round trips`, async () => {
      const log = new CountingStubLog(() => {});
      const game = createGame({ packs: [pack], createWorld, createScriptRunner, createBattle, seed, log, now: () => '2026-01-01T00:00:00.000Z' });
      const resolve: ReplayResolver = (file) => ({ name: file, text: read(file) });
      const result = await runReplay(gameDriver(game), read('m2-wild-201.replay'), { registries: game.registries, seed, name: 'm2-wild-201.replay', resolve });
      console.log(`m2-wild-201 seed ${seed}: ${result.ticks} ticks, ${result.assertions} asserts; Piplup L${game.state.party[0]!.level} exp ${game.state.party[0]!.exp}; stubs ${log.report().filter((s) => s.key.startsWith('battle')).map((s) => `${s.key}×${s.count}`).join(', ') || 'none'}`);
      expect(result.error).toBeUndefined();
      expect(result).toMatchObject({ ok: true, determinism: 'identical', roundTrip: 'identical' });
      // Piplup L6 after the first battle has 202 exp (medium slow); Route 201's Starly/Bidoof/Kricketot at
      // L2–3 give 15–24. One EV from the rival's Turtwig, one from the wild Pokémon.
      const piplup = game.state.party[0]!;
      expect(piplup.exp).toBeGreaterThan(202);
      expect(piplup.exp).toBeLessThanOrEqual(202 + 24);
      expect(Object.values(piplup.evs).reduce((a, b) => a + b, 0)).toBe(2);
      expect(piplup.pp[0]).toBeLessThan(35);
      expect(game.state.pokedex.seen.length).toBeGreaterThanOrEqual(2);
    }, 120_000);
  }
});
