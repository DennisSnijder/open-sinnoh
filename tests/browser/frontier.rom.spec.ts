/**
 * The Battle Frontier in the app on the real ROM (OPENSINNOH_NDS_ROM; desktop, phone and landscape): a Battle Tower singles challenge
 * and the BP exchange through `window.openSinnohGame` (tests/rom-replays sys-tower-single, sys-bp-exchange). At each
 * screenshot line the screen is checked: the party's order pick shows CONFIRM and CANCEL and fits as fit.rom.spec's
 * menus do (the buttons inside the screen, clear of the phone's edge); the tower battle is on the BATTLE_TOWER backdrop
 * with ROM art; the battle room (a frontier scene) is drawn on the overlay from the ROM's room and characters; the
 * exchange counter's list is the shop panel in BP. Every frontier scene the replay passes through (the corridor and the
 * battle room; the elevator is a field map) is checked as it is drawn: its DS frame at the layout's whole-pixel unit, centred in the
 * room, the largest that fits on touch layouts, clear of the controls, nothing drawn outside it.
 * Screenshots go to test-artifacts (ROM content, never commit).
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { AppView, MartView, PartyView, Registries } from '@opensinnoh/contracts';
import { loadGamePacks, runReplay } from '@opensinnoh/game';
import { pageDriver } from '../../packages/cli/src/browser.ts';
import { romSlice } from '../rom.ts';
import { battleSceneStats, canvasStats } from './canvas.ts';
import { screenProblems } from './fit.ts';
import { seedRomImport } from './seed.ts';
import { settle } from './settle.ts';
import { readReplay, resolveReplay } from '../rom-replays/sys-replays.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;
const SHOTS = 'test-artifacts/frontier';

test.describe.configure({ mode: 'serial' });
test.skip(!ROM, 'OPENSINNOH_NDS_ROM is not set');

let registries: Registries;
let context: BrowserContext;
let page: Page;
const errors: string[] = [];

test.beforeAll(async ({ browser }, info) => {
  test.setTimeout(120_000);
  registries = loadGamePacks([romSlice().pack]).registries;
  const use = info.project.use;
  context = await browser.newContext({ baseURL: use.baseURL, viewport: use.viewport, ...(use.isMobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: use.deviceScaleFactor } : {}) });
  page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
});

test.afterAll(async () => {
  await context?.close();
});

test('import the ROM', async () => {
  test.setTimeout(420_000);
  await seedRomImport(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
});

const frame = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const app = async () => (await page.evaluate(() => window.openSinnohGame!.snapshot().app)) as AppView | null;

/**
 * The running frontier scene's frame problems (null when no scene runs), after a frame is drawn: device px throughout.
 * The frame is at the layout's unit, inside the room and centred in it, the largest whole scale that fits on touch
 * layouts (the phone's game area), inside the viewport and clear of the on-screen controls; nothing is drawn on the
 * overlay outside it (the rest is black).
 */
async function sceneProblems(): Promise<{ scene: number; problems: string[] } | null> {
  if (!(await page.evaluate(() => !!window.openSinnohApp!.game.scripts.view().frontier))) return null;
  await frame();
  return page.evaluate(() => {
    const fr = window.openSinnohApp!.game.scripts.view().frontier;
    if (!fr) return null;
    const out: string[] = [];
    const l = window.openSinnohApp!.layout;
    const dpr = devicePixelRatio || 1;
    const f = window.openSinnohApp!.overlayFrame();
    const canvas = document.getElementById('overlay-canvas') as HTMLCanvasElement;
    const [W, H, s] = [canvas.width, canvas.height, f.scale];
    const [w, h] = [256 * s, 192 * s];
    const [L, T, R, B] = [l.room.left, l.room.top, l.room.right, l.room.bottom].map((v) => Math.round(v * dpr)) as [number, number, number, number];
    const at = `${w}×${h} at ${f.x},${f.y} in the room ${L},${T}–${W - R},${H - B}`;
    if (s !== Math.max(1, Math.round(l.ui.unit * dpr))) out.push(`scale ${s} is not the layout's unit ${l.ui.unit} × ${dpr}`);
    if (f.x < L || f.y < T || f.x + w > W - R || f.y + h > H - B) out.push(`frame ${at} leaves the room`);
    if (Math.abs(f.x - L - (W - R - f.x - w)) > 1 || Math.abs(f.y - T - (H - B - f.y - h)) > 1) out.push(`frame ${at} is off centre`);
    if (l.controls && 256 * (s + 1) <= W - L - R && 192 * (s + 1) <= H - T - B) out.push(`frame ${at}: scale ${s + 1} fits too`);
    const box = canvas.getBoundingClientRect();
    const css = new DOMRect(box.left + f.x / dpr, box.top + f.y / dpr, w / dpr, h / dpr);
    if (css.left < -0.5 || css.top < -0.5 || css.right > innerWidth + 0.5 || css.bottom > innerHeight + 0.5) out.push(`frame ${at} leaves the ${innerWidth}×${innerHeight} viewport`);
    for (const b of document.querySelectorAll<HTMLElement>('.controls button, .hud-button')) {
      const r = b.getBoundingClientRect();
      if (!r.width || getComputedStyle(b).visibility === 'hidden' || b.closest('[hidden]')) continue;
      if (r.left < css.right && css.left < r.right && r.top < css.bottom && css.top < r.bottom) out.push(`frame ${at} is under the ${b.dataset.button ?? b.getAttribute('aria-label')} button`);
    }
    const px = canvas.getContext('2d')!.getImageData(0, 0, W, H).data;
    let outside = 0;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (x >= f.x && x < f.x + w && y >= f.y && y < f.y + h) continue;
        const i = (y * W + x) * 4;
        if (px[i]! + px[i + 1]! + px[i + 2]! > 0 || px[i + 3] !== 255) outside++;
      }
    if (outside) out.push(`${outside} px drawn outside the frame ${at} (or not black)`);
    return { scene: fr.scene, problems: out };
  });
}

const CHECKS: Record<string, (name: string) => Promise<void>> = {
  async 'tower-party'(name) {
    const v = (await app()) as PartyView | null;
    expect(v?.app, name).toBe('party');
    expect(v?.mode, name).toBe('order');
    await page.waitForSelector('.party-order-button', { timeout: 20_000 });
    expect(await page.locator('.party-order-button').count(), name).toBe(2);
    await settle(page);
    expect(await screenProblems(page), name).toEqual([]);
    // The buttons' art runs to the DS screen's edge: whole, inside the screen and a DS px or more clear of the glass.
    const buttons = await page.evaluate(() => {
      const screen = document.querySelector('.ui-host [data-screen]')!;
      const unit = parseFloat(getComputedStyle(screen).getPropertyValue('--unit'));
      const sr = screen.getBoundingClientRect();
      return [...document.querySelectorAll('.party-order-button')].map((b) => {
        const r = b.getBoundingClientRect();
        return { inScreen: r.left >= sr.left - 0.5 && r.right <= sr.right + 0.5 && r.top >= sr.top - 0.5 && r.bottom <= sr.bottom + 0.5, edge: Math.min(r.left, innerWidth - r.right) >= unit - 0.01 };
      });
    });
    expect(buttons, name).toEqual([{ inScreen: true, edge: true }, { inScreen: true, edge: true }]);
  },
  async 'tower-battle'(name) {
    const view = await page.evaluate(() => window.openSinnohGame!.battleView());
    expect(view?.background, name).toBe('platinum:BACKGROUND_BATTLE_TOWER');
    expect(view?.terrain, name).toBe('platinum:TERRAIN_BATTLE_TOWER');
    await page.waitForFunction(() => window.openSinnohApp?.sceneLoading() === false, undefined, { timeout: 120_000 });
    await frame();
    const pixels = await battleSceneStats(page);
    expect(pixels.colours, name).toBeGreaterThan(32);
    expect(pixels.lit, name).toBeGreaterThan(0.1);
  },
  async 'tower-room'(name) {
    // The view returns from a full-screen battle through 8 ticks of black (battle/index.ts RETURN_TICKS); a replay
    // stops the clock at its screenshot line, so it plays them here (the menu waits).
    await page.evaluate(() => window.openSinnohGame!.advance(10));
    await frame();
    const fr = await page.evaluate(() => window.openSinnohGame!.snapshot().view.frontier);
    expect(fr?.scene, name).toBe(7);
    expect(fr?.actors.filter((a) => a.visible).length, name).toBeGreaterThan(1);
    // The room loads on first use: its BG and the 2D characters on the overlay, the DS frame filled.
    await expect.poll(async () => (await canvasStats(page, '#overlay-canvas')).colours, { timeout: 20_000 }).toBeGreaterThan(16);
    expect((await canvasStats(page, '#overlay-canvas')).lit, name).toBeGreaterThan(0.2);
    // Nothing covers it (the battle canvas is gone).
    const top = await page.evaluate(() => {
      const r = document.getElementById('overlay-canvas')!.getBoundingClientRect();
      return document.elementFromPoint(r.x + r.width / 2, r.y + r.height - 60)?.id ?? '';
    });
    expect(top, name).not.toBe('battle-canvas');
  },
  async 'bp-exchange'(name) {
    const v = (await app()) as MartView | null;
    expect(v?.app, name).toBe('mart');
    expect(v?.currency, name).toBe('bp');
    await page.waitForSelector('.money-window-bp', { timeout: 20_000 });
    expect(await page.locator('.mart-row, .item-row').count(), name).toBeGreaterThan(1);
  },
};

/** The tower's frontier scenes in sys-tower-single (decomp FRONTIER_SCENE_*): the corridor (5) and the battle room (7); the elevator is a field map. */
const TOWER_SCENES = [5, 7];

for (const file of ['sys-tower-single', 'sys-bp-exchange']) {
  test(`${file} in the app, with its screens at each screenshot line`, async () => {
    test.setTimeout(900_000);
    const project = test.info().project.name;
    const base = pageDriver(page, SHOTS, `${project}-${file}`);
    const seen: string[] = [];
    /** The frontier scenes drawn and their problems, sampled every 30 ticks while one runs. */
    const scenes = new Set<number>();
    const found: string[] = [];
    const sample = async () => {
      const r = await sceneProblems();
      if (!r) return;
      scenes.add(r.scene);
      found.push(...r.problems.map((p) => `scene ${r.scene}: ${p}`));
    };
    const driver = {
      ...base,
      async advance(n: number) {
        for (let left = n; left > 0; left -= 30) {
          await base.advance(Math.min(30, left));
          await sample();
        }
      },
      async screenshot(name: string) {
        await frame();
        await CHECKS[name]!(name);
        seen.push(name);
        return base.screenshot!(name);
      },
    };
    const result = await runReplay(driver, readReplay(`${file}.replay`), { registries, seed: 1, name: `${file}.replay`, resolve: resolveReplay, repeat: false });
    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(seen.length).toBeGreaterThan(0);
    if (file === 'sys-tower-single') expect([...scenes].sort((a, b) => a - b), 'frontier scenes drawn').toEqual(TOWER_SCENES);
    expect([...new Set(found)]).toEqual([]);
    expect(errors).toEqual([]);
  });
}
