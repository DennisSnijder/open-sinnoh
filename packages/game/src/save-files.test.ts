import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createGame } from './game.ts';
import { NewerSaveError, NotASaveError, PackMismatchError, SAVE_SCHEMA_VERSION, SaveError } from './save.ts';
import { saveToJson } from './storage.ts';
import { CountingStubLog } from './stub-log.ts';
import { createFakeScriptRunner, createFakeWorld } from '../test/fakes.ts';
import { readPack } from '../test/packs.ts';

const newGame = () => createGame({ packs: [readPack('fixture')], createWorld: createFakeWorld, createScriptRunner: createFakeScriptRunner, seed: 1, log: new CountingStubLog(() => {}), now: () => 'now' });

/** `release-v0.8.json` was written by the v0.8 release (git tag v0.8) on the fixture pack; the save format has not changed since. */
const release = () => JSON.parse(readFileSync(join(import.meta.dirname, '../test/saves/release-v0.8.json'), 'utf8')) as { savedAt: string; state: Record<string, unknown> };

describe('save files from other places', () => {
  it("loads the previous release's save and exports it again unchanged in meaning", () => {
    const game = newGame();
    game.load(release());
    expect(game.state.names.player).toBe('Ari');
    expect(game.state.party).toHaveLength(1);
    expect(game.state.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    // Exported and imported again (what Options › Data does): the same state.
    const again = newGame();
    again.load(JSON.parse(saveToJson(game.save())));
    expect(again.state).toEqual(game.state);
  });

  it('says what is wrong with a file that is not a usable save', () => {
    const game = newGame();
    expect(() => game.load({ hello: 'world' })).toThrow(NotASaveError);
    expect(() => game.load([1, 2])).toThrow(NotASaveError);
    expect(() => game.load(null)).toThrow(NotASaveError);
    const newer = release();
    newer.state.schemaVersion = SAVE_SCHEMA_VERSION + 1;
    expect(() => game.load(newer)).toThrow(NewerSaveError);
    expect(() => game.load(newer)).toThrow(/newer version of OpenSinnoh/);
    const damaged = release();
    delete damaged.state.names;
    expect(() => game.load(damaged)).toThrow(SaveError);
    expect(() => game.load(damaged)).not.toThrow(NotASaveError);
  });

  it('a pack mismatch lists what the save needs and what it lacks', () => {
    const game = newGame();
    const file = release();
    file.state.packs = [
      { id: 'fixture', version: '0.1.0' },
      { id: 'demo-mod', version: '1.0.0' },
    ];
    try {
      game.load(file);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(PackMismatchError);
      expect((e as PackMismatchError).needed).toEqual(['demo-mod@1.0.0']);
      expect((e as PackMismatchError).extra).toEqual([]);
    }
  });
});
