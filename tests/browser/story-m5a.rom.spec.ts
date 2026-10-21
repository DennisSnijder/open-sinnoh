/**
 * Story checkpoints in the app (OPENSINNOH_NDS_ROM; desktop and phone): each chunk replay starts a page at
 * the end of the replay before it (its chain anchor loaded as a save, story-seed.ts) and plays through
 * `window.openSinnohGame`, seed 1, with pixel-checked beats at its key scenes:
 * - CP5: the Jubilife tag battle with four battlers drawn (`jubilife-tag-battle`), the Windworks once Looker
 *   has left (`windworks-end`).
 * - CP6: a partner trainer double in Eterna Forest, Cheryl beside the player (`eterna-forest-double`), and the
 *   Eterna Gym's flower clock (`eterna-clock`).
 * - CP7: the Hearthome Gym's dark room in the gym avatar's light (`hearthome-dark-room`).
 * - CP8: the Veilstone Gym's bags and tyre stacks (`veilstone-gym`), the Veilstone tag battle
 *   (`veilstone-tag-battle`).
 * One test per replay, so the workers play them side by side. Screenshots go to test-artifacts (ROM content,
 * never commit).
 */
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { BattleView } from '@opensinnoh/contracts';
import { runReplay } from '@opensinnoh/game';
import { battleSceneStats } from './canvas.ts';
import { openChunk } from './story-seed.ts';
import { anchoredText, chunkParent, M5A } from '../integration/checkpoints-anchors.ts';
import { mainCanvasStats, waitForScene } from '../../packages/cli/src/browser.ts';

test.skip(!process.env.OPENSINNOH_NDS_ROM, 'OPENSINNOH_NDS_ROM is not set');

const SHOTS = join(import.meta.dirname, '../../test-artifacts/story-m5a');

/** Each replay's screenshot beats in order. */
const BEATS: Record<string, string[]> = {
  'cp5.replay': ['jubilife-tag-battle', 'windworks-end'],
  'cp6.replay': ['eterna-forest-double', 'eterna-clock'],
  'cp7.replay': ['hearthome-dark-room'],
  'cp8.replay': ['veilstone-gym', 'veilstone-tag-battle'],
};
/** Battle beats: four battlers drawn, the AI partner beside the player. */
const BATTLE_BEATS = new Set(['jubilife-tag-battle', 'eterna-forest-double', 'veilstone-tag-battle']);

for (const file of M5A.replays) {
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
