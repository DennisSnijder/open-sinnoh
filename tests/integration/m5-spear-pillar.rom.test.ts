/**
 * On the real ROM (OPENSINNOH_NDS_ROM): Spear Pillar's battles before Cyrus, by their branch replays,
 * each twice on seeds 1–3 with a save round trip:
 * - `m5-spear-pillar-barry`: the grunts as two trainers against the player alone (19) after the two-alive check,
 *   then Mars and Jupiter with Barry's full party as the AI partner (75), his team picked by the player's starter;
 * - `m5-spear-pillar-one-alive`: one Pokémon that can fight, so the grunts send the player back without a battle.
 * Constructed starts (setup lines), labelled in each replay.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Id } from '@opensinnoh/core';
import { CountingStubLog, createGame, gameDriver, runReplay, type ReplayResolver } from '@opensinnoh/game';
import { createBattle } from '@opensinnoh/battle';
import { createApp } from '@opensinnoh/menus';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';
import { ROM, romSlice } from '../rom.ts';

const dir = join(import.meta.dirname, '../rom-replays');
const read = (file: string) => readFileSync(join(dir, file), 'utf8');
const p = (name: string) => `platinum:${name}` as Id;

describe.skipIf(!ROM)('Spear Pillar battles: types 19 and 75, the two-alive check (OPENSINNOH_NDS_ROM)', () => {
  for (const file of ['m5-spear-pillar-barry.replay', 'm5-spear-pillar-one-alive.replay'])
    for (const seed of [1, 2, 3])
      it(`${file} passes twice from seed ${seed} and round-trips its save`, async () => {
        const log = new CountingStubLog(() => {});
        const game = createGame({ packs: [romSlice().pack], createWorld, createScriptRunner, createBattle, createApp, seed, log, now: () => '2026-01-01T00:00:00.000Z' });
        const resolve: ReplayResolver = (f) => ({ name: f, text: read(f) });
        const setups: string[] = [];
        const result = await runReplay(gameDriver(game), read(file), {
          registries: game.registries,
          seed,
          name: file,
          resolve,
          beforeLine: () => {
            const s = game.battleSetup();
            const key = s && `${s.topology}:${s.trainers.join('+')}${s.partner ? ` with ${s.partner}` : ''}`;
            if (key && setups.at(-1) !== key) setups.push(key);
          },
        });
        expect(result.error).toBeUndefined();
        expect(result).toMatchObject({ ok: true, determinism: 'identical', roundTrip: 'identical' });
        if (file === 'm5-spear-pillar-barry.replay')
          expect([...new Set(setups)]).toEqual([
            `trainer-pair:${p('TRAINER_GALACTIC_GRUNT_SPEAR_PILLAR_1')}+${p('TRAINER_GALACTIC_GRUNT_SPEAR_PILLAR_2')}`,
            `ai-partner:${p('TRAINER_COMMANDER_MARS_SPEAR_PILLAR')}+${p('TRAINER_COMMANDER_JUPITER_SPEAR_PILLAR')} with ${p('TRAINER_RIVAL_SPEAR_PILLAR_TURTWIG')}`,
          ]);
        else expect(setups).toEqual([]);
        expect(log.report().filter((s) => s.key.startsWith('battle:'))).toEqual([]);
      }, 900_000);
});
