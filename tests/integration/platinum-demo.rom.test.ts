/**
 * The Platinum demo mod (packs/platinum-demo), headless (OPENSINNOH_NDS_ROM): with the mod, Chimchar
 * takes the starter slot Piplup had (one JSON Patch) and the Twinleaf collector says the mod's line
 * (one IR label override); without it, the vanilla data and label run.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { readPackFolder, type PackData } from '@opensinnoh/core';
import type { GameState } from '@opensinnoh/contracts';
import { createBattle } from '@opensinnoh/battle';
import { createGame, gameDriver, runReplay, type Game, type ReplayResolver } from '@opensinnoh/game';
import { romSlice } from '../rom.ts';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';

const romPath = process.env.OPENSINNOH_NDS_ROM;
const MOD_TEXT = 'platinum-demo:Text_LanternRumor';
const COLLECTOR = 'platinum:TwinleafTown_Collector';
const VANILLA_TEXT = 'platinum:TwinleafTown_Text_TechnologyBlowsMeAway';

describe.skipIf(!romPath)('Platinum demo mod (OPENSINNOH_NDS_ROM)', () => {
  let base: PackData;
  const modDir = join(import.meta.dirname, '../../packs/platinum-demo');
  const mod = readPackFolder((p) => (existsSync(join(modDir, p)) ? readFileSync(join(modDir, p), 'utf8') : undefined), 'packs/platinum-demo');
  beforeAll(async () => {
    ({ pack: base } = romSlice());
  }, 60_000);

  // Seed 2: both starters win the first battle there (the opening replay asserts the win; on seed 1 the
  // mod's Chimchar loses to the rival's Piplup, which the replay's message lines do not follow).
  const game = (withMod: boolean) =>
    createGame({ packs: withMod ? [base, mod] : [base], createWorld, createScriptRunner, createBattle, seed: 2, now: () => '2026-01-01T00:00:00.000Z' });

  /** Loads a state standing south of the Twinleaf collector, talks to it, and returns the full message. */
  function talkToCollector(g: Game): string {
    const state: GameState = structuredClone(g.state);
    state.player = { zone: 'platinum:MAP_HEADER_TWINLEAF_TOWN', x: 108, z: 890, y: 0, facing: 'up' };
    state.objects = [];
    state.follower = null;
    g.load({ format: 'lantern-nds-save', version: 1, savedAt: '2026-01-01T00:00:00.000Z', state }, 'arrival');
    for (let i = 0; i < 100 && !g.canSave(); i++) g.tick();
    expect(g.canSave()).toBe(true);
    g.press('a');
    g.tick();
    g.release('a');
    for (let i = 0; i < 600 && !g.snapshot().view.message?.waitingForInput; i++) g.tick();
    const message = g.snapshot().view.message;
    expect(message?.waitingForInput).toBe(true);
    return message!.text;
  }

  it('without the mod: vanilla starters and the original collector script', () => {
    const g = game(false);
    expect(g.overrides).toEqual([]);
    expect(g.labels.get(COLLECTOR)?.pack).toBe('platinum');
    expect(g.registries.species.get('platinum:SPECIES_CHIMCHAR')?.starterSlot).toBe(1);
    expect(g.registries.species.get('platinum:SPECIES_PIPLUP')?.starterSlot).toBe(2);
    const text = talkToCollector(g);
    const vanilla = g.registries.texts.get(VANILLA_TEXT)!.text;
    expect(text.replace(/\s+/g, ' ')).toContain(vanilla.split(/\s+/).slice(0, 3).join(' '));
    expect(g.registries.texts.has(MOD_TEXT)).toBe(false);
  });

  it('with the mod: the label override and the patch take effect', () => {
    const g = game(true);
    expect(g.loadOrder.map((p) => p.id)).toEqual(['platinum', 'platinum-demo']);
    expect(g.overrides).toEqual([expect.objectContaining({ label: COLLECTOR, pack: 'platinum-demo' })]);
    expect(g.labels.get(COLLECTOR)?.pack).toBe('platinum-demo');
    expect(g.registries.species.get('platinum:SPECIES_CHIMCHAR')?.starterSlot).toBe(2);
    expect(g.registries.species.get('platinum:SPECIES_PIPLUP')?.starterSlot).toBe(1);
    expect(talkToCollector(g).replace(/\s+/g, ' ')).toContain('A lantern glows over Lake Verity');
  });

  it('the opening with the mod: the same inputs (right, right, A at the starter panel) give Chimchar', async () => {
    const read = (file: string) => readFileSync(join(import.meta.dirname, '../rom-replays', file), 'utf8');
    for (const [withMod, species, index] of [
      [false, 'platinum:SPECIES_PIPLUP', 393],
      [true, 'platinum:SPECIES_CHIMCHAR', 390],
    ] as const) {
      const g = game(withMod);
      const edit = (replay: string) =>
        replay
        .replaceAll('assert party 0 platinum:SPECIES_PIPLUP', `assert party 0 ${species}`)
        .replaceAll('"platinum:SPECIES_PIPLUP"', `"${species}"`)
        // The rival's trainer is named after your starter.
        .replaceAll('TRAINER_RIVAL_ROUTE_201_PIPLUP', `TRAINER_RIVAL_ROUTE_201_${species.slice('platinum:SPECIES_'.length)}`)
        .replaceAll('assert var platinum:VAR_PLAYER_STARTER 393', `assert var platinum:VAR_PLAYER_STARTER ${index}`);
      const resolve: ReplayResolver = (file) => ({ name: file, text: edit(read(file)) });
      const result = await runReplay(gameDriver(g), edit(read('opening.replay')), { registries: g.registries, seed: 2, resolve });
      expect(result.error).toBeUndefined();
      expect(result.ok).toBe(true);
      expect(result.roundTrip).toBe('identical');
      // Level 6 after winning the first battle.
      expect(g.state.party.map((m) => [m.species, m.level])).toEqual([[species, 6]]);
    }
  }, 120_000);
});
