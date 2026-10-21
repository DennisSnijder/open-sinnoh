/**
 * Doubles in the app (OPENSINNOH_NDS_ROM; desktop): the double topologies draw and run to their end in the page
 * (four battlers at the decomp spots until the doubles scene): `m5-double-twins` (type 3), `m5-double-vs2`
 * (19) and `m5-cheryl-wild-double` (74, then 75), through `window.openSinnohGame`. The battle view is read at each
 * battle's first command.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { BattleView } from '@opensinnoh/contracts';
import { CountingStubLog, createGame, runReplay } from '@opensinnoh/game';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';
import { romSlice } from '../rom.ts';
import { seedRomImport } from './seed.ts';
import { pageDriver } from '../../packages/cli/src/browser.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;
const dir = join(import.meta.dirname, '../rom-replays');
const read = (file: string) => readFileSync(join(dir, file), 'utf8');

test.skip(!ROM, 'OPENSINNOH_NDS_ROM is not set');

const CASES: [string, string[]][] = [
  ['m5-double-twins.replay', ['double']],
  ['m5-double-vs2.replay', ['trainer-pair']],
  ['m5-cheryl-wild-double.replay', ['ai-partner', 'ai-partner']],
];

for (const [file, topologies] of CASES) {
  test(`${file}: the doubles run to their end in the app`, async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'desktop only');
    test.setTimeout(600_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await seedRomImport(page);
    await page.goto('/?replay');
    await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
    const driver = pageDriver(page, join(import.meta.dirname, '../../test-artifacts/m5-doubles'), 'desktop');
    const { pack } = romSlice();
    const { registries } = createGame({ packs: [pack], createWorld, createScriptRunner, seed: 1, log: new CountingStubLog(() => {}) });
    const seen: BattleView[] = [];
    const result = await runReplay(driver, read(file), {
      registries,
      seed: 1,
      name: file,
      repeat: false,
      async beforeLine(line) {
        if (line.action.type === 'battle-auto') seen.push((await page.evaluate(() => window.openSinnohGame!.battleView())) as BattleView);
        if (line.action.type === 'battle-auto' && file === 'm5-double-twins.replay') {
          await page.evaluate(() => { for (let i = 0; i < 5000 && window.openSinnohGame!.battleView()?.prompt?.kind !== 'command'; i++) window.openSinnohGame!.advance(1); });
          await page.locator('.bc-fight').click();
          await page.locator('.bc-move').first().click();
          await expect(page.locator('.battle-card')).toHaveAttribute('data-kind', 'target');
          await expect(page.locator('.bc-target[data-battler="1"]')).toBeVisible();
          await expect(page.locator('.bc-target[data-battler="3"]')).toBeVisible();
          await page.locator('.bc-back').click();
          await expect(page.locator('.battle-card')).toHaveAttribute('data-kind', 'fight');
          await page.locator('.bc-move').first().click();
          await page.locator('.bc-target[data-battler="1"]').click();
          await page.evaluate(() => window.openSinnohGame!.advance(1));
        }
      },
    });
    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(seen.map((v) => v.topology)).toEqual(topologies);
    for (const v of seen) {
      expect(v.battlers.map((b) => b.battler)).toEqual([0, 1, 2, 3]);
      expect(v.battlers.every((b) => b.visible)).toBe(true);
    }
    expect(await page.evaluate(() => !window.openSinnohGame!.snapshot().battle && !!document.querySelector('canvas'))).toBe(true);
    expect(errors).toEqual([]);
  });
}
