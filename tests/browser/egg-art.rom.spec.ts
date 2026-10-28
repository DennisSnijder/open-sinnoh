/** Egg pictures must not reveal the hatchling in the summary or PC preview. ROM bytes stay local. */
import { expect, test, type Page, type BrowserContext } from '@playwright/test';
import type { Id } from '@opensinnoh/core';
import { loadGamePacks, runReplay } from '@opensinnoh/game';
import { romFullFiles, romSlice } from '../rom.ts';
import { seedRomImport } from './seed.ts';
import { pageDriver } from '../../packages/cli/src/browser.ts';

test.describe.configure({ mode: 'serial' });
test.skip(!process.env.OPENSINNOH_NDS_ROM, 'OPENSINNOH_NDS_ROM is not set');
let context: BrowserContext;
let page: Page;
test.beforeAll(async ({ browser }, info) => {
  test.setTimeout(420_000);
  const use = info.project.use;
  context = await browser.newContext({ baseURL: use.baseURL, viewport: use.viewport, hasTouch: use.hasTouch, isMobile: use.isMobile, deviceScaleFactor: use.deviceScaleFactor });
  page = await context.newPage();
  await seedRomImport(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready, undefined, { timeout: 60_000 });
});
test.afterAll(async () => { await context?.close(); });

/** Compare the rendered picture to the imported egg, at native pixels, without storing either in git. */
async function expectEgg(page: Page, selector: string, png: Uint8Array, y: number): Promise<void> {
  await page.route('**/__egg-reference', route => route.fulfill({ body: Buffer.from(png), contentType: 'image/png' }));
  await expect.poll(() => page.evaluate(async ({ selector, y }) => {
    const actual = document.querySelector<HTMLCanvasElement>(selector);
    if (!actual) return false;
    const image = new Image();
    image.src = '/__egg-reference';
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 80;
    const g = canvas.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    g.drawImage(image, 0, y, 80, 80, 0, 0, 80, 80);
    const expected = g.getImageData(0, 0, 80, 80).data;
    g.clearRect(0, 0, 80, 80);
    g.drawImage(actual, 0, 0, 80, 80);
    const drawn = g.getImageData(0, 0, 80, 80).data;
    return expected.every((value, i) => value === drawn[i]);
  }, { selector, y }), { timeout: 10_000 }).toBe(true);
  await page.unroute('**/__egg-reference');
}

for (const [species, form] of [['PICHU', 0], ['MANAPHY', 1]] as const) {
  test(`${species}: summary and PC show the egg picture`, async () => {
    test.setTimeout(180_000);
    const registries = loadGamePacks([romSlice().pack]).registries;
    const egg = registries.pokemonSprites.get('platinum:SPECIES_EGG' as Id)!.forms[form]!;
    const png = new Map(romFullFiles()).get(egg.atlas.slice(egg.atlas.indexOf(':') + 1))!;
    const setup = `party 0 platinum:SPECIES_TURTWIG 12
party 1 platinum:SPECIES_${species} 1
set state party[1].isEgg true
warp platinum:MAP_HEADER_JUBILIFE_CITY_POKECENTER_1F 12 4 up
until idle
`;
    const play = async (text: string) => {
      const r = await runReplay(pageDriver(page, 'test-artifacts/egg-art', species), text, { registries, name: 'egg-art', resolve: () => ({ name: '', text: '' }), repeat: false });
      expect(r.error).toBeUndefined();
      expect(r.ok).toBe(true);
    };
    await play(`${setup}+1 press x
+1 release x
until app start-menu
+1 tap entry:0
until app party
+1 tap slot:1
+1 tap menu:0
until app summary
`);
    await expectEgg(page, '.sum-picture canvas', png, egg.front.y);
    await play(`${setup}+1 press a
+1 release a
advance text
+5 press a
+1 release a
advance text
+5 press a
+1 release a
until app storage
+1 tap party:1
+1 assert app storage
`);
    await expectEgg(page, '.box-preview-pic canvas', png, egg.front.y);
    // The DS heads an Egg's preview with its nickname and leaves the name line empty.
    await expect(page.locator('.box-preview-species')).toHaveText(registries.species.get('platinum:SPECIES_EGG' as Id)!.name);
    await expect(page.locator('.box-preview-name')).toHaveText('');
  });
}
