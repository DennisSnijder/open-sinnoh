/**
 * The phone's rotation and safe areas in a real battle (real ROM: OPENSINNOH_NDS_ROM; skipped without it): a wild
 * battle on Route 202 with its command card up. Rotating (a phone's two orientations, a tablet's) keeps the battle
 * (same prompt, both healthboxes, the card) and lays it out again in one frame, the card and the healthboxes
 * inside the view; with notch-sized insets neither card nor controls sit under the notch or the home indicator.
 * No screenshots are kept (ROM content).
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { ReplayLine } from '@opensinnoh/core';
import type { BattleView, Registries } from '@opensinnoh/contracts';
import { loadGamePacks, runReplay } from '@opensinnoh/game';
import { romSlice } from '../rom.ts';
import { seedRomImport } from './seed.ts';
import { pageDriver, waitForScene } from '../../packages/cli/src/browser.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;

test.describe.configure({ mode: 'serial' });
test.skip(!ROM, 'OPENSINNOH_NDS_ROM is not set');

let registries: Registries;
let context: BrowserContext;
let page: Page;
const errors: string[] = [];

test.beforeAll(async ({ browser }, info) => {
  test.skip(info.project.name !== 'phone', 'the spec sets its own phone and tablet sizes');
  test.setTimeout(420_000);
  const { pack } = romSlice();
  registries = loadGamePacks([pack]).registries;
  const use = info.project.use;
  context = await browser.newContext({ baseURL: use.baseURL, viewport: use.viewport, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });
  page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await seedRomImport(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
});

test.afterAll(async () => {
  await context?.close();
});

const REPLAY = `party 0 platinum:SPECIES_CHIMCHAR 10 platinum:MOVE_SCRATCH platinum:MOVE_LEER platinum:MOVE_EMBER
set var platinum:VAR_ROUTE_202_STATE 1
warp platinum:MAP_HEADER_ROUTE_202 178 827 up
until idle
${'+0 press up\n+30 release up\n+0 press down\n+30 release down\n'.repeat(8)}until battle 900
+0 screenshot battle
`;

const battleView = () => page.evaluate(() => window.openSinnohGame!.battleView()) as Promise<BattleView | null>;

interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** What the battle puts on screen, outside the safe area given by `insets`. */
function outside(insets: Insets): Promise<string[]> {
  return page.evaluate((ins) => {
    const safe = { l: ins.left, t: ins.top, r: innerWidth - ins.right, b: innerHeight - ins.bottom };
    const out: string[] = [];
    const check = (name: string, r: { left: number; top: number; right: number; bottom: number }) => {
      if (r.left < safe.l - 0.5 || r.top < safe.t - 0.5 || r.right > safe.r + 0.5 || r.bottom > safe.b + 0.5) out.push(`${name} ${Math.round(r.left)},${Math.round(r.top)}–${Math.round(r.right)},${Math.round(r.bottom)}`);
    };
    const card = document.querySelector('.battle-card');
    if (!card) return ['no battle card'];
    check('card', card.getBoundingClientRect());
    for (const h of window.openSinnohApp!.battleScene().healthboxes) check(`healthbox ${h.battler}`, { left: h.rect.x, top: h.rect.y, right: h.rect.x + h.rect.width, bottom: h.rect.y + h.rect.height });
    for (const b of document.querySelectorAll<HTMLElement>('.controls button, .hud-button')) if (b.getClientRects().length) check(b.dataset.button ?? b.getAttribute('aria-label') ?? 'control', b.getBoundingClientRect());
    return out;
  }, insets);
}

test('rotating mid-battle keeps the battle and the card in view; insets keep them clear of the notch', async () => {
  test.setTimeout(400_000);
  const driver = pageDriver(page, 'test-artifacts/phone-rom', 'battle');
  const result = await runReplay(driver, REPLAY, {
    registries,
    name: 'phone-battle.replay',
    seed: 1,
    repeat: false,
    async beforeLine(line: ReplayLine) {
      if (line.action.type !== 'screenshot') return;
      for (let i = 0; i < 2000; i++) {
        if ((await battleView())?.prompt?.kind === 'command') break;
        await page.evaluate(() => window.openSinnohGame!.advance(1));
      }
      expect((await battleView())!.prompt!.kind).toBe('command');
      for (const [w, h, insets] of [
        [375, 812, { top: 47, right: 0, bottom: 34, left: 0 }],
        [844, 390, { top: 0, right: 47, bottom: 21, left: 47 }],
        [820, 1180, { top: 24, right: 0, bottom: 20, left: 0 }],
        [1180, 820, { top: 24, right: 0, bottom: 20, left: 0 }],
        [375, 812, { top: 47, right: 0, bottom: 34, left: 0 }],
      ] as const) {
        await page.setViewportSize({ width: w, height: h });
        await page.evaluate((ins) => window.openSinnohSafeArea!(ins), insets);
        // One frame later: the layout is the new orientation's and the battle is the one we left.
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
        expect(await page.evaluate(() => window.openSinnohApp!.layout.mode)).toBe(h > w ? 'portrait' : 'landscape');
        await waitForScene(page);
        expect((await battleView())!.prompt!.kind, `${w}x${h}: the command prompt is still up`).toBe('command');
        expect(await page.evaluate(() => window.openSinnohApp!.battleScene().healthboxes.length), `${w}x${h}: both healthboxes`).toBe(2);
        expect(await outside(insets), `${w}x${h}: battle clear of the notch`).toEqual([]);
      }
      await page.evaluate(() => window.openSinnohSafeArea!(null));
      await page.setViewportSize({ width: 1280, height: 720 });
      return false;
    },
  });
  expect(result.error).toBeUndefined();
  expect(errors).toEqual([]);
});
