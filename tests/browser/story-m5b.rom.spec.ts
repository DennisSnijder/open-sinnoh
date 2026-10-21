/**
 * Story checkpoints in the app (OPENSINNOH_NDS_ROM; desktop and phone): each chunk replay starts a page at
 * the end of the replay before it (its chain anchor loaded as a save, story-seed.ts) and plays through
 * `window.openSinnohGame`, seed 1, with a pixel-checked beat at its key scene:
 * - CP9: the Pastoria Gym's pools (`pastoria-gym`).
 * - CP10: Celestic Town after the ruins and Cyrus (`celestic-town`).
 * - CP11: the Canalave Gym's lifts (`canalave-gym`).
 * - CP12: Lake Verity after Mars (`lake-verity`).
 * - CP13: the Snowpoint Gym's ice and snowballs (`snowpoint-gym`), Lake Acuity after the scene (`lake-acuity`).
 * One test per replay, so the workers play them side by side. Screenshots go to test-artifacts (ROM content,
 * never commit).
 */
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { runReplay } from '@opensinnoh/game';
import { openChunk } from './story-seed.ts';
import { anchoredText, chunkParent, M5B } from '../integration/checkpoints-anchors.ts';
import { mainCanvasStats, waitForScene } from '../../packages/cli/src/browser.ts';

test.skip(!process.env.OPENSINNOH_NDS_ROM, 'OPENSINNOH_NDS_ROM is not set');

const SHOTS = join(import.meta.dirname, '../../test-artifacts/story-m5b');

/** Each replay's screenshot beats in order. */
const BEATS: Record<string, string[]> = {
  'cp9.replay': ['pastoria-gym'],
  'cp10.replay': ['celestic-town'],
  'cp11.replay': ['canalave-gym'],
  'cp12.replay': ['lake-verity'],
  'cp13.replay': ['snowpoint-gym', 'lake-acuity'],
};

for (const file of M5B.replays) {
  const parent = chunkParent(file)!;
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
