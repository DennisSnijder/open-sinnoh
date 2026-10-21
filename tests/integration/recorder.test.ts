/** Original fixture battle: record both sampled input and direct card choices, then replay twice. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { readPackFolder } from '@opensinnoh/core';
import { createBattle } from '@opensinnoh/battle';
import { CountingStubLog, createGame, gameDriver, runReplay } from '@opensinnoh/game';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';
import { ReplayRecorder } from '../../packages/app/src/recorder.ts';

it('records a fixture trainer battle and replays the choices and outcome green', async () => {
  const root = join(import.meta.dirname, '../../packs/fixture');
  const read = (p: string) => existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : undefined;
  const game = createGame({ packs: [readPackFolder(read, 'packs/fixture')], createWorld, createScriptRunner, createBattle, seed: 1, log: new CountingStubLog(() => {}) });
  const driver = gameDriver(game);
  let recorder: ReplayRecorder | null = null;
  const step = game.step.bind(game);
  game.step = (frame) => {
    recorder?.frame(frame, game);
    step(frame);
    recorder?.observe(game);
  };
  const setup = 'party 0 fixture:SPECIES_SKYLET 20\nwarp fixture:ROUTE_E 42 15 up\n';
  let text = '';
  let recorded: unknown;
  const captured = await runReplay({
    ...driver,
    load: (json, entry) => { driver.load(json, entry); recorder = ReplayRecorder.start(game, []); },
    save: () => { text = setup + recorder!.text(game.state); recorded = game.snapshot().state; return driver.save(); },
  }, setup + 'until idle\n+0 press up\n+8 release up\nadvance text\nuntil battle\nbattle auto\nadvance text\nuntil idle\n', { registries: game.registries, repeat: false });
  expect(captured.error).toBeUndefined();
  expect(text).toContain('battle start');
  expect(text).toContain('battle end');
  expect(text).toMatch(/\n\+\d+ battle move \d\n/);
  expect(text).toMatch(/assert battle trainer \S+ won/);
  expect(recorder!.stopped).toBeNull();
  recorder!.stop('done', game);
  recorder = null;
  let replayed: unknown;
  const result = await runReplay({ ...driver, save: () => { replayed = game.snapshot().state; return driver.save(); } }, text, { registries: game.registries });
  expect(result.error).toBeUndefined();
  expect(result).toMatchObject({ ok: true, determinism: 'identical', roundTrip: 'identical' });
  expect(replayed).toEqual(recorded);
}, 60_000);
