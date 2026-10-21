/**
 * Quality-of-life replays, headless (OPENSINNOH_NDS_ROM): the party field moves (Dig, Chatter, Softboiled and Milk Drink), the
 * repeat-Repel prompt and the item wheel, each replay twice on seeds 1–3 with a save round trip. The QoL options run as a player sets
 * them (`memoryDevice`), and with the contract default (the DS) where that shows the difference.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createBattle } from '@opensinnoh/battle';
import type { DeviceOptions } from '@opensinnoh/contracts';
import { CountingStubLog, createGame, gameDriver, memoryDevice, runReplay, type ReplayResolver } from '@opensinnoh/game';
import { createApp } from '@opensinnoh/menus';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';
import { romSlice } from '../rom.ts';

const dir = join(import.meta.dirname, '../rom-replays');
const read = (file: string) => readFileSync(join(dir, file), 'utf8');
const resolve: ReplayResolver = (file) => ({ name: file, text: read(file) });
const newGame = (seed: number, log: CountingStubLog, options: Partial<DeviceOptions> = {}) =>
  createGame({ packs: [romSlice().pack], createWorld, createScriptRunner, createApp, createBattle, seed, log, device: memoryDevice(options), now: () => '2026-01-01T00:00:00.000Z' });

const REPLAYS: [string, Partial<DeviceOptions>][] = [
  ['sys-dig', {}],
  ['sys-chatter', {}],
  ['svc-softboiled', {}],
  ['svc-repel-repeat', { repelPrompt: 0 }],
  ['svc-item-wheel', { itemWheel: 0 }],
];

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('Q1: party field moves and the repeat-Repel prompt (OPENSINNOH_NDS_ROM)', () => {
  for (const [name, options] of REPLAYS)
    for (const seed of [1, 2, 3])
      it(`${name}: twice on seed ${seed}, save round trip`, async () => {
        const lines: string[] = [];
        const log = new CountingStubLog((l) => lines.push(l));
        const game = newGame(seed, log, options);
        const result = await runReplay(gameDriver(game), read(`${name}.replay`), { registries: game.registries, seed, name: `${name}.replay`, resolve, repeat: true });
        expect(result.error).toBeUndefined();
        expect(result).toMatchObject({ ok: true, determinism: 'identical', roundTrip: 'identical' });
        expect(lines.filter((k) => k.includes('field-move') || k.includes('sequence-missing'))).toEqual([]);
      }, 300_000);

  it('Chatter shows the Chatot preview while its script asks; recording is a logged stub (no microphone)', async () => {
    const lines: string[] = [];
    const game = newGame(1, new CountingStubLog((l) => lines.push(l)));
    const text = read('sys-chatter.replay').split('\n');
    const upTo = text.findIndex((l) => l.startsWith('until yesno'));
    await runReplay(gameDriver(game), text.slice(0, upTo + 1).join('\n'), { registries: game.registries, seed: 1, name: 'chatter', resolve, repeat: false });
    expect(game.scripts.view().pokemonPreview?.species).toBe('platinum:SPECIES_CHATOT');
    expect(lines.some((l) => l.includes('try_record_chatot_cry'))).toBe(true);
  }, 120_000);

  it('with the contract default (the DS) the Repel wears off with no question', async () => {
    const game = newGame(1, new CountingStubLog(() => {}));
    const text = read('svc-repel-repeat.replay');
    const upTo = text.indexOf('until yesno');
    const r = await runReplay(gameDriver(game), `${text.slice(0, upTo)}until idle 60\n+0 assert state repel 0\n+0 assert state bag.items [{"item":"platinum:ITEM_REPEL","count":1}]\n`, { registries: game.registries, seed: 1, name: 'repel (DS)', resolve, repeat: false });
    expect(r.error).toBeUndefined();
    expect(r.ok).toBe(true);
  }, 120_000);
});
