/** Story-played Cyrus loss and Giratina outcomes, from CP15's prefix anchors on desktop and phone. */
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { runReplay } from '@opensinnoh/game';
import { anchoredText, branchParent } from '../integration/checkpoints-anchors.ts';
import { openChunk } from './story-seed.ts';

test.skip(!process.env.OPENSINNOH_NDS_ROM, 'OPENSINNOH_NDS_ROM is not set');

for (const file of ['m5-dw-cyrus-lost.replay', 'm5-giratina-caught.replay', 'm5-giratina-fled.replay']) {
  test(`story branch in the app: ${file}`, async ({ page }, info) => {
    test.setTimeout(600_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    const parent = branchParent(file)!;
    const { driver, registries } = await openChunk(page, parent, 1, join(import.meta.dirname, '../../test-artifacts/story-m5c'), info.project.name);
    const result = await runReplay(driver, anchoredText(file, parent), { registries, seed: 1, name: file, repeat: false });
    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(result.roundTrip).toBe('identical');
    expect(errors).toEqual([]);
  });
}
