/**
 * Story checkpoints in the app (OPENSINNOH_NDS_ROM; desktop and phone): each chunk replay starts a page at
 * the end of the replay before it (its chain anchor loaded as a save, story-seed.ts) and plays through
 * `window.openSinnohGame`, seed 1, with a pixel-checked beat at its key scene:
 * - CP14: the Galactic HQ control room after the release (`galactic-hq-release`); CP15: the Distortion World's 1F;
 *   CP16: Volkner's room before his battle; CP17: the League's north Pokémon Center after Barry;
 *   CP18: Aaron's room; CP19: the Champion's room.
 * One test per replay, so the workers play them side by side. Screenshots go to test-artifacts (ROM content,
 * never commit).
 */
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { runReplay } from '@opensinnoh/game';
import { openChunk } from './story-seed.ts';
import { anchoredText, branchParent, M5C } from '../integration/checkpoints-anchors.ts';
import { mainCanvasStats, waitForScene } from '../../packages/cli/src/browser.ts';

test.skip(!process.env.OPENSINNOH_NDS_ROM, 'OPENSINNOH_NDS_ROM is not set');

const SHOTS = join(import.meta.dirname, '../../test-artifacts/story-m5c');

/** Each replay's screenshot beats in order. */
const BEATS: Record<string, string[]> = {
  'cp14.replay': ['galactic-hq-release'],
  'cp15-dw-cyrus.replay': ['distortion-world'],
  'cp15-giratina-room.replay': [],
  'cp15.replay': [],
  'cp16.replay': ['sunyshore-volkner'],
  'cp17.replay': ['league-barry'],
  'cp18.replay': ['aaron-room'],
  'cp19.replay': ['champion-room'],
};

for (const file of M5C.replays) {
  const parent = branchParent(file)!;
  test(`in the app: ${file} from the ${parent} anchor, beats ${BEATS[file]!.join(', ')}`, async ({ page }, info) => {
    test.setTimeout(2_400_000);
    const project = info.project.name;
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    const { driver, registries } = await openChunk(page, parent, 1, SHOTS, project);
    const started = Date.now();
    const beats: string[] = [];
    const result = await runReplay(driver, anchoredText(file, parent), {
      registries,
      seed: 1,
      name: file,
      repeat: false,
      async beforeLine(line) {
        if (line.action.type !== 'screenshot') return;
        await waitForScene(page);
        const stats = await mainCanvasStats(page);
        expect(stats.colours, `${line.action.name}: colours`).toBeGreaterThan(8);
        expect(stats.litShare, `${line.action.name}: lit share`).toBeGreaterThan(0.1);
        beats.push(line.action.name);
      },
    });
    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(beats).toEqual(BEATS[file]);
    expect(result.screenshots).toHaveLength(BEATS[file]!.length);
    console.log(`${file} in the app (${project}): ${result.ticks} ticks in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    expect(errors).toEqual([]);
  });
}
