/**
 * Every menu app fits its screen (real ROM: OPENSINNOH_NDS_ROM; skipped without it), on every viewport
 * project: desktop 1280×720, mid 1000×750 at dpr 2, fhd 1920×1080, big 2560×1440, phone 390×844,
 * phone-small 375×812 and landscape 844×390. The svc-*
 * replays run through the bridge; at each screenshot beat with an app open:
 * - the app's screen lies inside the viewport, centred in the room (the field view less the landscape controls'
 *   columns and the portrait HUD row: layout.ts `room`), for sheets and scenes;
 * - it never covers an on-screen control or HUD button (they stay usable over every menu);
 * - its dot and unit are whole device pixels (the UI's fractional last resort never runs: `fractionalFits` 0);
 * - nothing in it is clipped or scrolled out: the screen and every panel in it have no overflow, except
 *   lists that scroll on purpose (`data-scrolls`), whose rows must then still fit their width;
 * - every pixel label lies inside its window (text never runs past a frame).
 * Screenshots go to test-artifacts/fit-rom (gitignored: ROM content, never commit), or OPENSINNOH_FIT_SHOTS.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { ReplayLine } from '@opensinnoh/core';
import type { Registries } from '@opensinnoh/contracts';
import { loadGamePacks, runReplay } from '@opensinnoh/game';
import { romSlice } from '../rom.ts';
import { romContext, resetRomDevice } from './rom-context.ts';
import { fromChainAnchor } from './replay-anchor.ts';
import { settle } from './settle.ts';
import { screenProblems } from './fit.ts';
import { pageDriver } from '../../packages/cli/src/browser.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;
const SHOTS = process.env.OPENSINNOH_FIT_SHOTS ?? 'test-artifacts/fit-rom';
/** Probe mode: report what does not fit instead of failing (to survey a change). */
const PROBE = !!process.env.OPENSINNOH_FIT_PROBE;
const REPLAYS = join(import.meta.dirname, '../rom-replays');
const read = (file: string) => readFileSync(join(REPLAYS, file), 'utf8');

test.describe.configure({ mode: 'parallel' });
test.skip(!ROM, 'OPENSINNOH_NDS_ROM is not set');

let registries: Registries;
let context: BrowserContext;
let page: Page;
const errors: string[] = [];

test.beforeAll(async ({ browser }, info) => {
  test.setTimeout(420_000);
  const { pack } = romSlice();
  registries = loadGamePacks([pack]).registries;
  const use = info.project.use;
  context = await romContext(browser, use);
  page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await resetRomDevice(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
});

// Each replay resets its game; workers share only their own imported pack.
test.beforeEach(() => { errors.length = 0; });

test.afterAll(async () => {
  await page?.close();
});

const REPLAY_FILES = ['svc-card', 'svc-dex', 'svc-party', 'svc-naming', 'svc-bag', 'svc-mart', 'svc-dept-store', 'svc-dept-store-2f', 'svc-dept-store-3f', 'svc-dept-store-b1f', 'svc-pc-storage', 'svc-pc-compare', 'svc-name-rater', 'svc-registered'];

for (const name of REPLAY_FILES) {
  test(`${name}: every app fits, centred, nothing cut`, async () => {
    const project = test.info().project.name;
    test.setTimeout(300_000);
    const found: string[] = [];
    let beats = 0;
    await page.evaluate(() => window.openSinnohGame!.reset(1));
    const driver = pageDriver(page, SHOTS, `${project}-${name}`);
    const replay = name === 'svc-naming' ? await fromChainAnchor(driver, `${name}.replay`) : { driver, text: read(`${name}.replay`) };
    const result = await runReplay(replay.driver, replay.text, {
      registries,
      name: `${name}.replay`,
      resolve: (file) => ({ name: file, text: read(file) }),
      repeat: false,
      async beforeLine(line: ReplayLine) {
        if (line.action.type !== 'screenshot') return;
        await settle(page);
        found.push(...(await screenProblems(page)).map((p) => `${line.action.type === 'screenshot' ? line.action.name : ''}: ${p}`));
        beats++;
      },
    });
    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(beats).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.openSinnohApp!.ui.state.fractionalFits)).toBe(0);
    if (PROBE) console.log(`${project} ${name}\n${found.join('\n')}`);
    else expect(found).toEqual([]);
    expect(errors).toEqual([]);
  });
}
