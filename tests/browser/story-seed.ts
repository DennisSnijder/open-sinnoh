/**
 * Story specs start a page at a chunk's start (the chunk replays run in one page
 * from the previous chunk's end state (save import)): the chain anchor (the prefix played headless once per
 * seed and cached, tests/integration/checkpoints-anchors.ts) is loaded into the app's game as a save, so a
 * spec plays only its own chunk. The replay driver's reset loads the anchor again (the chunk replays never
 * reset to a new game), and the chunk replay's `from` and `+0 reload` lines are left out (`anchoredText`).
 */
import type { Page } from '@playwright/test';
import { CountingStubLog, createGame, type ReplayDriver } from '@opensinnoh/game';
import type { Registries } from '@opensinnoh/contracts';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';
import { romSlice } from '../rom.ts';
import { anchoredDriver, chainAnchor } from '../integration/checkpoints-anchors.ts';
import { seedRomImport } from './seed.ts';
import { pageDriver } from '../../packages/cli/src/browser.ts';

export interface ChunkPage {
  /** Resets to the chunk's start: a new game, the anchor's clock, the anchor loaded. */
  driver: ReplayDriver;
  /** The registries the replay runner checks asserts with (the slice import; the page has the full one). */
  registries: Registries;
}

/**
 * Seeds the page with the ROM import, opens the app in replay mode and returns a driver whose reset loads the
 * anchor of `prefix` (a chunk's prefix, or the replay a chunk replay starts from) on `seed`. Screenshots go to
 * `shots` with the project name as prefix.
 */
export async function openChunk(page: Page, prefix: string, seed: number, shots: string, project: string): Promise<ChunkPage> {
  const save = await chainAnchor(prefix, seed);
  await seedRomImport(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
  const driver = anchoredDriver(pageDriver(page, shots, project), save);
  const { registries } = createGame({ packs: [romSlice().pack], createWorld, createScriptRunner, seed, log: new CountingStubLog(() => {}) });
  return { driver, registries };
}
