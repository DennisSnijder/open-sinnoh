/**
 * Menus in the app on the real ROM (OPENSINNOH_NDS_ROM; skipped without it), desktop and phone: the
 * svc-pc-storage, svc-pc-compare, svc-naming, svc-bag, svc-party, svc-card, svc-name-rater, svc-registered and svc-bag-bicycle
 * replays through the bridge (the same menu models as headless), with checks at their screenshot beats: the
 * screen is up, its ROM art is drawn (box wallpapers, box marks, the compare pages, the summary's page tabs,
 * front sprite and ribbons, type icons, the naming screen's panels (its keys and glyphs on the panel's cells), badges, the card, its portrait and
 * signature), no horizontal scroll and tap targets of 40/48 px. A pointer drag on the card's signature pad
 * draws (the DOM's pen taps).
 * Screenshots go to test-artifacts/menus-rom (gitignored: ROM content, never commit), or OPENSINNOH_MENU_SHOTS.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { ReplayLine } from '@opensinnoh/core';
import type { Registries } from '@opensinnoh/contracts';
import { loadGamePacks, runReplay } from '@opensinnoh/game';
import { romSlice } from '../rom.ts';
import { expectNamingGrid } from './naming-grid.ts';
import { narrowRowHits } from './row-hits.ts';
import { romContext, resetRomDevice } from './rom-context.ts';
import { fromChainAnchor } from './replay-anchor.ts';
import { settle } from './settle.ts';
import { pageDriver } from '../../packages/cli/src/browser.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;
const SHOTS = process.env.OPENSINNOH_MENU_SHOTS ?? 'test-artifacts/menus-rom';
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

/** The smallest tap target outside a DS screen per project (design.md §2): 48 px on phones and tablets (touch), 40 on desktops. */
const minTarget = (project: string) => (project.startsWith('phone') || project.startsWith('tablet') || project === 'landscape' ? 48 : 40);

/**
 * The page never scrolls sideways, and every tap target of the open app is big enough. The naming keys
 * keep the keyboard window's 16 × 19 px cells at the board's unit (expectNamingGrid; the keyboard types too). Every menu app is a DS screen
 * (a `.board`) at the largest unit that fits (4/3 on a 390-px phone): its targets are the DS's own, at least a
 * 16-px DS row (21 CSS px there; DS-size rows on phones, each tap area its full row, the d-pad drives).
 */
async function layoutChecks(min: number): Promise<void> {
  const r = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollWidth, width: innerWidth }));
  expect(r.scroll).toBeLessThanOrEqual(r.width);
  const small = await page.evaluate(
    (min) =>
      [...document.querySelectorAll<HTMLElement>('.ui-host [data-tap]')]
        .filter((e) => e.offsetParent !== null && !e.classList.contains('msg-box') && !e.closest('.naming-keys'))
        .map((e) => {
          const ds = e.closest('.board, .ds-screen') ? 16 * parseFloat(getComputedStyle(e).getPropertyValue('--unit')) : Infinity;
          return { tap: e.dataset.tap, h: e.getBoundingClientRect().height, min: Math.min(min, ds) };
        })
        .filter((e) => e.h + 0.5 < e.min),
    min,
  );
  expect(small).toEqual([]);
  expect(await narrowRowHits(page), 'rows alone on their line tap across their window').toEqual([]);
}

/** ROM pictures drawn on the open screen: element backgrounds loaded and pixel canvases painted. */
/**
 * The naming screen's prompt and entry sit inside the entry box of its ROM background: the background
 * pixels under each are the box's one fill colour (no frame line or other window runs through the text).
 */
async function namingTextOnFill(): Promise<Record<string, number>> {
  // The board is redrawn while it settles: wait for a connected one with a numeric unit, then measure it
  // before anything awaits (a redraw during the image decode would leave a detached board, whose unit is NaN).
  await page.waitForFunction(() => {
    const board = document.querySelector<HTMLElement>('.naming-board.rom-picture');
    return !!board && Number.isFinite(parseFloat(getComputedStyle(board).getPropertyValue('--unit')));
  });
  return page.evaluate(async () => {
    const board = document.querySelector<HTMLElement>('.naming-board.rom-picture')!;
    const url = /url\("?(.*?)"?\)/.exec(board.style.backgroundImage)![1]!;
    const style = getComputedStyle(board);
    const unit = parseFloat(style.getPropertyValue('--unit'));
    if (!Number.isFinite(unit)) throw new Error(`naming board: --unit is ${style.getPropertyValue('--unit')}`);
    const crop = parseFloat(style.getPropertyValue('--crop')) || 0;
    const b = board.getBoundingClientRect();
    const rects = ['.naming-prompt', '.naming-entry'].map((sel) => [sel, board.querySelector(sel)!.getBoundingClientRect()] as const);
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    [c.width, c.height] = [img.width, img.height];
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    const out: Record<string, number> = {};
    for (const [sel, r] of rects) {
      const [x, y] = [Math.round((r.left - b.left) / unit) + crop, Math.round((r.top - b.top) / unit)];
      const px = g.getImageData(x, y, Math.round(r.width / unit), Math.round(r.height / unit)).data;
      const colours = new Set<number>();
      for (let i = 0; i < px.length; i += 4) colours.add((px[i]! << 16) | (px[i + 1]! << 8) | px[i + 2]!);
      out[sel] = colours.size;
    }
    return out;
  });
}

function art() {
  return page.evaluate(() => {
    const host = document.querySelector('.ui-host')!;
    const painted = (c: HTMLCanvasElement) => {
      const g = c.getContext('2d');
      if (!g || !c.width) return false;
      const px = g.getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < px.length; i += 4) if (px[i]) return true;
      return false;
    };
    /** Elements whose ROM background has loaded. */
    const loaded = (selector: string) => [...host.querySelectorAll<HTMLElement>(selector)].filter((e) => e.style.backgroundImage.startsWith('url(')).length;
    /** Inked pixels of the signature canvas (device pixels), -1 without one. */
    const inked = (c: HTMLCanvasElement | null) => {
      if (!c) return -1;
      const px = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < px.length; i += 4) if (px[i]) n++;
      return n;
    };
    return {
      pictures: [...host.querySelectorAll<HTMLElement>('.rom-picture')].filter((e) => e.style.backgroundImage.startsWith('url(')).length,
      fronts: [...host.querySelectorAll<HTMLCanvasElement>('canvas.mon-front')].filter(painted).length,
      icons: [...host.querySelectorAll<HTMLElement>('.mon-icon-sprite')].filter((e) => e.style.backgroundImage.startsWith('url(')).length,
      tabs: [...host.querySelectorAll<HTMLCanvasElement>('.sum-tab canvas')].filter(painted).length,
      types: [...host.querySelectorAll<HTMLCanvasElement>('.type-icon canvas')].filter(painted).length,
      badges: [...host.querySelectorAll<HTMLCanvasElement>('.badge-slot.rom canvas')].filter(painted).length,
      marks: [...host.querySelectorAll<HTMLCanvasElement>('.box-marks canvas, .mark-entry canvas')].filter(painted).length,
      compare: [...host.querySelectorAll<HTMLElement>('.compare-board.rom-picture')].filter((e) => e.style.backgroundImage.startsWith('url(')).length,
      compareNames: host.querySelectorAll('.cmp-name').length,
      compareCells: host.querySelectorAll('.cmp-cell').length,
      compareDots: host.querySelectorAll('.cmp-dot').length,
      ribbons: [...host.querySelectorAll<HTMLCanvasElement>('.ribbon-slot canvas')].filter(painted).length,
      ribbonDetail: [...host.querySelectorAll<HTMLCanvasElement>('.sum-detail.ribbon_info canvas')].filter(painted).length + host.querySelectorAll('.summary-screen .ribbon-desc').length,
      // The party's ROM art: the backdrop, the member panels, the HP bars' fill, the CANCEL button.
      partyBg: [...host.querySelectorAll<HTMLElement>('.party-bg.rom-picture')].filter((e) => e.style.backgroundImage.startsWith('url(')).length,
      panels: [...host.querySelectorAll<HTMLCanvasElement>('.party-panel canvas')].filter(painted).length,
      hpBars: host.querySelectorAll('.party-slot .hp-bar.rom canvas').length,
      cancel: [...host.querySelectorAll<HTMLCanvasElement>('.party-cancel-art canvas')].filter(painted).length,
      // The summary's page art, its detail panel, its HP/EXP bars from the page's characters.
      page: [...host.querySelectorAll<HTMLCanvasElement>('.sum-bg canvas')].filter(painted).length,
      moveInfo: [...host.querySelectorAll<HTMLCanvasElement>('.sum-detail.move_info canvas')].filter(painted).length,
      ball: [...host.querySelectorAll<HTMLCanvasElement>('.sum-ball canvas')].filter(painted).length,
      // The PC preview's info strip: its pages (item, types, nature, ability, the item again) and, sampled on a paused
      // copy of its cycle, the DS page shown (in 16-px rows) at frames 0, 40 (held), 83 (mid-scroll) and 85 (types).
      strip: (() => {
        const pages = host.querySelector<HTMLElement>('.box-preview-pages');
        if (!pages) return null;
        const [anim] = pages.getAnimations();
        const unit = parseFloat(getComputedStyle(pages).getPropertyValue('--unit'));
        const rowAt = (frame: number) => {
          anim!.pause();
          anim!.currentTime = (frame * 1000) / 30 + 1;
          return Math.round((-new DOMMatrix(getComputedStyle(pages).transform).m42 / unit / 16) * 1000) / 1000;
        };
        const rows = anim ? [0, 40, 83, 85].map(rowAt) : [];
        anim?.play();
        return { pages: pages.children.length, types: pages.children[1]!.querySelectorAll('.type-icon canvas, .type-chip').length, rows };
      })(),
      bars: [...host.querySelectorAll<HTMLCanvasElement>('.summary-screen .exp-bar.rom canvas, .summary-screen .hp-bar.rom canvas')].filter(painted).length,
      card: [...host.querySelectorAll<HTMLCanvasElement>('.trainer-card.rom .card-art canvas')].filter(painted).length,
      portrait: [...host.querySelectorAll<HTMLCanvasElement>('.card-portrait-art canvas')].filter(painted).length,
      signature: inked(host.querySelector<HTMLCanvasElement>('.signature-art')),
      pad: host.querySelectorAll('.signature-pad').length,
      open: host.querySelectorAll('[data-screen]').length,
      // The bag's DS screen: its BG, the bag picture, the item highlight and the registered item's SELECT mark.
      bagScreen: loaded('.bag-board > .ds-picture.rom-picture'),
      bagSprite: [...host.querySelectorAll<HTMLCanvasElement>('.bag-picture canvas')].filter(painted).length,
      itemHighlight: [...host.querySelectorAll<HTMLCanvasElement>('.item-highlight canvas')].filter(painted).length,
      registered: [...host.querySelectorAll<HTMLCanvasElement>('.item-row .registered-mark canvas')].filter(painted).length,
      // The PC's top screen: its BG, the wallpaper, the party tray, the hand; compare's corner buttons.
      boxScreen: loaded('.box-board > .ds-picture.rom-picture:first-child') + [...host.querySelectorAll<HTMLCanvasElement>('.box-board > .ds-sprite:first-child canvas')].filter(painted).length,
      wallpaper: loaded('.box-wallpaper.rom-picture'),
      tray: loaded('.box-tray.rom-picture'),
      hand: [...host.querySelectorAll<HTMLCanvasElement>('.box-hand canvas')].filter(painted).length,
      // The hand's shadow over the box: drawn behind the box's Pokémon (before every slot), as on the DS.
      shadow: (() => {
        const shadow = host.querySelector('.box-board .box-shadow');
        if (!shadow) return 'none';
        return [...host.querySelectorAll('.box-board .box-slot')].every((s) => shadow.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING) ? 'behind' : 'front';
      })(),
      compareButtons: [...host.querySelectorAll<HTMLCanvasElement>('.compare-touch .ds-sprite canvas')].filter(painted).length,
      // The player drawn on the bike (svc-registered's cycling beat): the cycling sprite among the actors on screen.
      bike: ((globalThis as unknown as { openSinnohRenderStats?: { actors: { sprite: string; kind: string; onScreen: boolean }[] } }).openSinnohRenderStats?.actors ?? []).filter((x) => x.kind === 'live' && x.onScreen && /CYCLE|BIKE/i.test(x.sprite)).length,
    };
  });
}

/** What each beat must show: the screen and the ROM art it draws. */
const BEATS: Record<string, { screen: string; art: (a: Awaited<ReturnType<typeof art>>) => boolean }> = {
  // The PC on its DS screen: the BG, the wallpaper and the hand; depositing, the party tray.
  deposit: { screen: 'storage', art: (a) => a.boxScreen === 1 && a.wallpaper === 1 && a.tray === 1 && a.hand === 1 && a.icons >= 1 },
  // The renamed box with its new wallpaper, the hand on the header (the party tray is down: Starly is the box's only icon).
  box: { screen: 'storage', art: (a) => a.boxScreen === 1 && a.wallpaper === 1 && a.hand === 1 && a.tray === 0 && a.icons === 1 },
  // The hand over Starly in the box: its shadow under the icon, not over it.
  'box-cursor': { screen: 'storage', art: (a) => a.boxScreen === 1 && a.hand === 1 && a.icons === 1 && a.shadow === 'behind' },
  // The preview's row of marks and the markings window's six rows, its info strip cycling (held, mid-scroll, then the types page); then compare's three pages (two sides each).
  mark: { screen: 'storage', art: (a) => a.boxScreen === 1 && a.wallpaper === 1 && a.marks === 7 && a.strip?.pages === 5 && a.strip.types >= 1 && JSON.stringify(a.strip.rows) === '[0,0,0.75,1]' },
  compare: { screen: 'storage', art: (a) => a.compare === 1 && a.boxScreen === 1 && a.compareButtons >= 3 && a.compareNames === 2 && a.compareCells === 24 && a.icons >= 4 },
  'compare-contest': { screen: 'storage', art: (a) => a.compare === 1 && a.compareNames === 2 && a.compareDots === 10 },
  'compare-moves': { screen: 'storage', art: (a) => a.compare === 1 && a.compareNames === 2 && a.compareCells >= 3 },
  keyboard: { screen: 'naming', art: (a) => a.pictures >= 2 && a.icons >= 1 },
  // The party on its DS screen: backdrop, a panel and an HP bar per member (svc-bag: a Potion's target, its message over CANCEL).
  potion: { screen: 'party', art: (a) => a.icons >= 1 && a.partyBg === 1 && a.panels === a.icons && a.hpBars === a.icons },
  // The bag on its DS screen (BG, bag picture, item highlight) with the registered key item's SELECT mark.
  registered: { screen: 'bag', art: (a) => a.bagScreen === 1 && a.bagSprite === 1 && a.itemHighlight === 1 && a.registered === 1 },
  // BATTLE MOVES with a move selected: the page art, the move detail panel, the tabs, the move and category type icons, the caught ball.
  summary: { screen: 'summary', art: (a) => a.page === 1 && a.moveInfo === 1 && a.fronts === 1 && a.tabs === 5 && a.types >= 4 && a.ball === 1 },
  // RIBBONS: 3 rows of 4 while browsing; selecting shows 2 rows (scrolled to rows 1–2) and the ribbon panel with the description.
  ribbons: { screen: 'summary', art: (a) => a.page === 1 && a.fronts === 1 && a.ribbons === 12 && a.ribbonDetail === 0 && a.ball === 1 },
  ribbon: { screen: 'summary', art: (a) => a.page === 1 && a.ribbons === 8 && a.ribbonDetail === 2 && a.ball === 1 },
  // The DS card picture (one star: cobalt), the portrait on the front, the signature box on the back.
  'card-front': { screen: 'trainer-card', art: (a) => a.badges === 1 && a.card === 1 && a.portrait === 1 },
  'card-back': { screen: 'trainer-card', art: (a) => a.badges === 1 && a.card === 1 && a.signature === 0 },
  'card-signing': { screen: 'trainer-card', art: (a) => a.card === 1 && a.pad === 1 && a.signature > 0 },
  'card-signed': { screen: 'trainer-card', art: (a) => a.badges === 1 && a.card === 1 && a.pad === 0 && a.signature > 0 },
  // svc-name-rater: the script's party pick (the party menu in select mode) with the party icons.
  pick: { screen: 'party', art: (a) => a.icons >= 2 && a.partyBg === 1 && a.panels === a.icons && a.cancel === 1 },
  // svc-registered: on the bike after Y; svc-bag-bicycle: after the bag's USE (no menu open).
  cycling: { screen: '', art: (a) => a.open === 0 && a.bike === 1 },
};

for (const name of ['svc-pc-storage', 'svc-pc-compare', 'svc-naming', 'svc-bag', 'svc-party', 'svc-card', 'svc-name-rater', 'svc-registered', 'svc-bag-bicycle']) {
  test(`${name}: the menus in the app, ROM art at each beat`, async () => {
    const project = test.info().project.name;
    test.setTimeout(300_000);
    const checks: string[] = [];
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
        const beat = BEATS[line.action.name];
        if (!beat) throw new Error(`no checks for the beat ${line.action.name}`);
        if (beat.screen) await expect(page.locator(`[data-screen="${beat.screen}"]`)).toBeVisible({ timeout: 30_000 });
        await expect.poll(async () => beat.art(await art()), { timeout: 30_000, message: `${line.action.name}: ${JSON.stringify(await art())}` }).toBe(true);
        await layoutChecks(minTarget(project));
        if (beat.screen === 'naming') {
          expect(await namingTextOnFill()).toEqual({ '.naming-prompt': 1, '.naming-entry': 1 });
          await expectNamingGrid(page);
        }
        await settle(page);
        checks.push(line.action.name);
      },
    });
    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(checks.length).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });
}

/** Opens the card's signing mode on its back (the setup of the pointer test). */
const TO_SIGNING = `party 0 platinum:SPECIES_TURTWIG 12
warp platinum:MAP_HEADER_JUBILIFE_CITY_POKECENTER_1F 12 4 up
until idle
+1 press x
+1 release x
until app start-menu
+1 tap entry:2
+1 tap flip
+1 tap sign
+2 assert app trainer-card
`;

test('the card: a pointer drag on the signature pad draws pen strokes, B cancels', async () => {
  test.setTimeout(120_000);
  const project = test.info().project.name;
  const driver = pageDriver(page, SHOTS, `${project}-card-pointer`);
  const result = await runReplay(driver, TO_SIGNING, { registries, name: 'card-pointer', resolve: (file) => ({ name: file, text: read(file) }), repeat: false });
  expect(result.error).toBeUndefined();
  const view = () => page.evaluate(() => window.openSinnohGame!.snapshot().app as { app: string; signature: string | null; signing: { cancel: boolean } | null } | null);
  const pad = page.locator('.signature-pad');
  // Slow frames under a full parallel run draw the board late (the DOM catches up on the next drawn frame).
  await expect(pad).toBeVisible({ timeout: 30_000 });
  expect((await view())!.signature).toBeNull();
  const box = (await pad.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(box.x + box.width * (0.1 + i * 0.1), box.y + box.height * (i % 2 ? 0.8 : 0.2), { steps: 3 });
    await driver.advance(1);
  }
  await page.mouse.up();
  await driver.advance(3);
  expect(await view()).toMatchObject({ app: 'trainer-card', signing: { cancel: true } });
  expect((await view())!.signature).not.toBeNull();
  await expect.poll(() => art().then((a) => a.signature), { timeout: 30_000 }).toBeGreaterThan(0);
  await page.screenshot({ path: `${SHOTS}/${project}-card-pointer.png` });
  await driver.press('b');
  await driver.advance(1);
  await driver.release('b');
  await driver.advance(2);
  expect((await view())!.signing).toBeNull();
  expect(await page.evaluate(() => window.openSinnohGame!.snapshot().state.signature)).toBeNull();
  expect(errors).toEqual([]);
});

test('each bag pocket highlight stays centred on its icon', async () => {
  test.setTimeout(120_000);
  const driver = pageDriver(page, SHOTS, 'bag-pocket-alignment');
  const result = await runReplay(driver, `party 0 platinum:SPECIES_TURTWIG 20
warp platinum:MAP_HEADER_ROUTE_201 115 853 right
until idle
+1 press x
+1 release x
until app start-menu
+1 tap entry:1
until app bag
`, { registries, repeat: false });
  expect(result.error).toBeUndefined();
  // The warp's field scene loads first (its frames are the slowest: textures and shaders on the first draws).
  await page.waitForFunction(() => window.openSinnohApp?.sceneLoading() === false, undefined, { timeout: 120_000 });
  for (let pocket = 0; pocket < 8; pocket++) {
    await page.evaluate(p => { window.openSinnohGame!.tap(`pocket:${p}`); window.openSinnohGame!.advance(1); }, pocket);
    // The tick has run; the DOM shows it on the next rendered frame, which draws the field under the bag too. Under
    // load a frame can take seconds (software WebGL on the big viewports), past the default 5 s: allow what the
    // replay beats allow. The tab and the highlight are drawn in one build, so once the tab shows the pocket both are
    // placed.
    await expect(page.locator('.pocket-tab.on')).toHaveAttribute('data-tap', `pocket:${pocket}`, { timeout: 30_000 });
    const delta = await page.evaluate(() => {
      const icon = document.querySelector('.pocket-tab.on canvas')!.getBoundingClientRect();
      const hl = document.querySelector('.pocket-highlight')!.getBoundingClientRect();
      return { x: Math.abs((icon.left + icon.right - hl.left - hl.right) / 2), y: Math.abs((icon.top + icon.bottom - hl.top - hl.bottom) / 2) };
    });
    expect(delta.x, `pocket ${pocket}: horizontal centre`).toBeLessThanOrEqual(0.5);
    expect(delta.y, `pocket ${pocket}: vertical centre`).toBeLessThanOrEqual(0.5);
  }
});
