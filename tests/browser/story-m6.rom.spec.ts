/**
 * Story checkpoints in the app (OPENSINNOH_NDS_ROM; desktop and phone): each chunk replay starts a page at
 * the end of the replay before it (its chain anchor loaded as a save, story-seed.ts) and plays through
 * `window.openSinnohGame`, seed 1, with a pixel-checked beat at its key scene:
 * - CP20: Barry's tag battle with the player against Volkner and Flint in the Fight Area (`fight-area-tag`).
 * - CP21a-f (the dex sweep): Uxie in Acuity Cavern, Manaphy's picture over the Mansion book, Victory Road's low
 *   corridor, Chansey on Route 209, the Old Chateau's TV at night, Mesprit's picture in Verity Cavern.
 * - CP22: Buck's tag battle in Stark Mountain room 2 against Drake and Jarrett (`stark-mountain-tag`).
 * - CP23: Heatran in Stark Mountain room 3 before its battle; Snowpoint Temple B5F.
 * - CP24: Cynthia's rematch at its first command (`cynthia-rematch`, two battlers, a single).
 * One test per replay, so the workers play them side by side. Screenshots go to test-artifacts (ROM content,
 * never commit).
 */
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { runReplay } from '@opensinnoh/game';
import type { BattleView } from '@opensinnoh/contracts';
import { battleSceneStats } from './canvas.ts';
import { openChunk } from './story-seed.ts';
import { anchoredText, branchParent, M6 } from '../integration/checkpoints-anchors.ts';
import { mainCanvasStats, waitForScene } from '../../packages/cli/src/browser.ts';

test.skip(!process.env.OPENSINNOH_NDS_ROM, 'OPENSINNOH_NDS_ROM is not set');

const SHOTS = join(import.meta.dirname, '../../test-artifacts/story-m6');

/** Each replay's screenshot beats in order. */
const BEATS: Record<string, string[]> = {
  'cp20.replay': ['fight-area-tag'],
  'cp21a.replay': ['acuity-cavern-uxie'],
  'cp21b.replay': ['manaphy-preview'],
  'cp21c.replay': ['victory-road-low-corridor'],
  'cp21d.replay': ['route-209-chansey'],
  'cp21e.replay': ['old-chateau-tv'],
  'cp21f.replay': ['mesprit-preview'],
  'cp22.replay': ['stark-mountain-tag'],
  'cp23a.replay': ['stark-mountain-heatran'],
  'cp23b.replay': ['snowpoint-temple-b5f'],
  'cp24.replay': ['cynthia-rematch'],
};
/** Battle beats: four battlers drawn, the AI partner beside the player. */
const BATTLE_BEATS = new Set(['fight-area-tag', 'stark-mountain-tag']);
/** Single battle beats: the player's and the opponent's battlers drawn. */
const SINGLE_BATTLE_BEATS = new Set(['cynthia-rematch']);

for (const file of M6.replays) {
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
        if (BATTLE_BEATS.has(line.action.name)) {
          const view = (await page.evaluate(() => window.openSinnohGame!.battleView())) as BattleView;
          expect(view.topology).toBe('ai-partner');
          expect(view.battlers.map((b) => [b.battler, b.owner, b.visible])).toEqual([
            [0, 'player', true],
            [1, 'enemy', true],
            [2, 'partner', true],
            [3, 'enemy2', true],
          ]);
          const stats = await battleSceneStats(page);
          expect(stats.colours, `${line.action.name}: colours`).toBeGreaterThan(32);
          expect(stats.lit, `${line.action.name}: lit share`).toBeGreaterThan(0.2);
        } else if (SINGLE_BATTLE_BEATS.has(line.action.name)) {
          const view = (await page.evaluate(() => window.openSinnohGame!.battleView())) as BattleView;
          expect(view.topology).toBe('single');
          expect(view.battlers.map((b) => [b.battler, b.owner, b.visible])).toEqual([
            [0, 'player', true],
            [1, 'enemy', true],
          ]);
          const stats = await battleSceneStats(page);
          expect(stats.colours, `${line.action.name}: colours`).toBeGreaterThan(32);
          expect(stats.lit, `${line.action.name}: lit share`).toBeGreaterThan(0.2);
        } else {
          const stats = await mainCanvasStats(page);
          expect(stats.colours, `${line.action.name}: colours`).toBeGreaterThan(8);
          expect(stats.litShare, `${line.action.name}: lit share`).toBeGreaterThan(0.1);
        }
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
