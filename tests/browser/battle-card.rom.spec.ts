/**
 * The battle command card's layout on the real ROM (OPENSINNOH_NDS_ROM; skipped without it): a wild battle
 * on Route 202 with a Chimchar that knows Scratch, Leer and Ember (one empty slot). At phone, phone
 * landscapes (three sizes), small desktop at dpr 2, 1080p and 1440p, every panel (commands, the moves, the forget-a-move
 * list, YES/NO) fits: each button's text inside the button, the move buttons one size, the card part of the
 * battle's composition, nothing overflowing or scrolling, every button drawn with the ROM's touch-screen
 * art, and the text no smaller than the scene's on a phone and two CSS px per font px on desktops.
 * Screenshots go to OPENSINNOH_CARD_SHOTS (ROM content, never commit).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type CDPSession, type Page } from '@playwright/test';
import type { ReplayLine } from '@opensinnoh/core';
import type { BattlePrompt, BattleView, Registries } from '@opensinnoh/contracts';
import { loadGamePacks, runReplay } from '@opensinnoh/game';
import { romSlice } from '../rom.ts';
import { romContext, resetRomDevice } from './rom-context.ts';
import { pageDriver, waitForScene } from '../../packages/cli/src/browser.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;
const SHOTS = process.env.OPENSINNOH_CARD_SHOTS;

test.describe.configure({ mode: 'parallel' });
test.skip(!ROM, 'OPENSINNOH_NDS_ROM is not set');

let registries: Registries;
let context: BrowserContext;
let page: Page;
let cdp: CDPSession;
const errors: string[] = [];

test.beforeAll(async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'the spec sets its own viewports');
  test.setTimeout(420_000);
  const { pack } = romSlice();
  registries = loadGamePacks([pack]).registries;
  context = await romContext(browser, { ...info.project.use, viewport: { width: 1280, height: 720 } });
  page = await context.newPage();
  cdp = await context.newCDPSession(page);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await resetRomDevice(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
});

test.beforeEach(() => { errors.length = 0; });

test.afterAll(async () => {
  await page?.close();
});

const REPLAY = `party 0 platinum:SPECIES_CHIMCHAR 10 platinum:MOVE_SCRATCH platinum:MOVE_LEER platinum:MOVE_EMBER
set state party[0].pp[0] 29
set state party[0].pp[1] 30
set state party[0].pp[2] 6
set var platinum:VAR_ROUTE_202_STATE 1
warp platinum:MAP_HEADER_ROUTE_202 178 827 up
until idle
${'+0 press up\n+30 release up\n+0 press down\n+30 release down\n'.repeat(8)}until battle 900
+0 screenshot card
`;

const VIEWPORTS = [
  { width: 375, height: 812, dpr: 3, mobile: true },
  { width: 844, height: 390, dpr: 3, mobile: true },
  { width: 667, height: 375, dpr: 2, mobile: true },
  { width: 932, height: 430, dpr: 3, mobile: true },
  { width: 1000, height: 750, dpr: 2, mobile: false },
  { width: 1920, height: 1080, dpr: 1, mobile: false },
  { width: 2560, height: 1440, dpr: 1, mobile: false },
  { width: 1790, height: 1400, dpr: 1, mobile: false },
] as const;

const battleView = () => page.evaluate(() => window.openSinnohGame!.battleView()) as Promise<BattleView | null>;

/** Shows `prompt` on the card in place of the battle's own (the card draws from the view; nothing is answered). */
async function showPrompt(prompt: BattlePrompt | null): Promise<void> {
  await page.evaluate((p) => {
    const battle = window.openSinnohApp!.game.battle as unknown as { view(): BattleView; __view?: () => BattleView };
    battle.__view ??= battle.view.bind(battle);
    const view = battle.__view;
    battle.view = p ? () => ({ ...view(), prompt: p }) : view;
  }, prompt);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The card's geometry: its rect, the scene's, each button with its text boxes, and any overflow. */
function measure(page: Page) {
  return page.evaluate(() => {
    const box = (e: Element): Box => {
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const card = document.querySelector<HTMLElement>('.battle-card')!;
    const overflow = [card, ...card.querySelectorAll<HTMLElement>('*')]
      .filter((e) => !e.classList.contains('sr-only') && (e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1) && getComputedStyle(e).display !== 'inline')
      .map((e) => `${e.className} ${e.scrollWidth}x${e.scrollHeight} in ${e.clientWidth}x${e.clientHeight}`);
    return {
      card: box(card),
      scene: window.openSinnohApp!.battleScene(),
      overflow,
      dpr: devicePixelRatio,
      dot: parseFloat(card.style.getPropertyValue('--dot')),
      art: [...card.querySelectorAll<HTMLElement>('.bc-button')].filter((b) => !getComputedStyle(b).borderImageSource.startsWith('url(')).map((b) => b.className),
      pp: [...card.querySelectorAll<HTMLElement>('.bc-pp')].map((e) => e.dataset.pp),
      page: { scrollW: document.scrollingElement!.scrollWidth, scrollH: document.scrollingElement!.scrollHeight, w: innerWidth, h: innerHeight },
      buttons: [...card.querySelectorAll<HTMLElement>('.bc-button')].map((b) => ({
        cls: b.className,
        rect: box(b),
        texts: [...b.querySelectorAll('canvas')].map(box),
      })),
    };
  });
}

type Measured = Awaited<ReturnType<typeof measure>>;
/** Overlap by more than half a CSS px (layout rounds fractional positions to 1/64 px). */
const overlaps = (a: Box, b: Box) => a.x + 0.5 < b.x + b.width && b.x + 0.5 < a.x + a.width && a.y + 0.5 < b.y + b.height && b.y + 0.5 < a.y + a.height;
const inside = (a: Box, b: Box) => a.x >= b.x - 0.5 && a.y >= b.y - 0.5 && a.x + a.width <= b.x + b.width + 0.5 && a.y + a.height <= b.y + b.height + 0.5;

/**
 * Everything fits: no overflow or scrolling, each button and its text inside the card, and the card inside
 * the view: in landscape a band clear of both healthboxes; on a phone in portrait under the scene.
 */
function checkFits(m: Measured, label: string): void {
  expect.soft(m.overflow, `${label}: overflow`).toEqual([]);
  expect.soft(m.page.scrollW, `${label}: no sideways scroll`).toBeLessThanOrEqual(m.page.w);
  expect.soft(m.page.scrollH, `${label}: no page scroll`).toBeLessThanOrEqual(m.page.h);
  expect.soft(m.art, `${label}: buttons without ROM art`).toEqual([]);
  const s = m.scene.rect;
  const view = { x: 0, y: 0, width: m.page.w, height: m.page.h };
  const cardBottom = m.card.y + m.card.height;
  if (m.page.h > m.page.w) {
    // Portrait: the card under the scene, the two resting on the view's bottom; text as big as the scene's.
    expect.soft(inside(m.card, view), `${label}: card ${JSON.stringify(m.card)} in the view`).toBe(true);
    expect.soft(m.card.y, `${label}: the card under the scene`).toBeGreaterThanOrEqual(s.y + s.height - 0.5);
    expect.soft(m.page.h - cardBottom, `${label}: the composition rests on the view's bottom`).toBeLessThan(2);
    expect.soft(m.dot, `${label}: text scale`).toBeGreaterThanOrEqual(m.scene.scale / m.dpr - 1e-6);
  } else {
    // Landscape (a window or a scene filling the view): the card is a band under the player's healthbox, in the
    // view, and covers no healthbox (the DS keeps them on the main screen while the commands show).
    expect.soft(inside(m.card, view), `${label}: card ${JSON.stringify(m.card)} in the view`).toBe(true);
    expect.soft(m.scene.healthboxes.length, `${label}: both healthboxes drawn`).toBe(2);
    for (const h of m.scene.healthboxes) expect.soft(overlaps(h.rect, m.card), `${label}: the card ${JSON.stringify(m.card)} covers healthbox ${h.battler} ${JSON.stringify(h.rect)}`).toBe(false);
    if (m.scene.windowed) expect.soft(Math.abs(m.card.width - s.width), `${label}: the card spans the window`).toBeLessThan(1);
    else expect.soft(m.page.h - cardBottom, `${label}: the composition rests on the view's bottom`).toBeLessThan(2);
    // Text at least two thirds of the scene's scale (4 device px per font px on a ×6 scene at DPR 3, 2 on a ×3 one).
    if (m.scene.windowed) expect.soft(m.dot, `${label}: text scale`).toBeGreaterThanOrEqual(2);
    else expect.soft(m.dot * m.dpr, `${label}: text scale`).toBeGreaterThanOrEqual((m.scene.scale * 2) / 3 - 1e-6);
  }
  for (const b of m.buttons) {
    expect.soft(inside(b.rect, m.card), `${label}: ${b.cls} inside the card`).toBe(true);
    for (const t of b.texts) expect.soft(inside(t, b.rect), `${label}: ${b.cls} text ${JSON.stringify(t)} in ${JSON.stringify(b.rect)}`).toBe(true);
  }
}

test('the card fits every viewport: commands, moves, forget-a-move, YES/NO', async () => {
  test.setTimeout(400_000);
  const driver = pageDriver(page, SHOTS ?? 'test-artifacts/battle-card', 'card');
  const result = await runReplay(driver, REPLAY, {
    registries,
    name: 'battle-card.replay',
    seed: 1,
    repeat: false,
    async beforeLine(line: ReplayLine) {
      if (line.action.type !== 'screenshot') return;
      await page.evaluate(() => {
        const g = window.openSinnohGame!;
        for (let i = 0; i < 2000 && g.battleView()?.prompt?.kind !== 'command'; i++) g.advance(1);
      });
      const command = (await battleView())!.prompt as Extract<BattlePrompt, { kind: 'command' }>;
      expect(command.moves.map((m) => m.name)).toHaveLength(3);
      const prompts: [string, BattlePrompt][] = [
        ['command', command],
        ['fight', { kind: 'fight', cursor: 1, moves: command.moves, actor: 0 }],
        ['learn', { kind: 'learn', cursor: 4, move: command.moves[2]!, moves: [...command.moves, command.moves[0]!] }],
        ['next', { kind: 'next', cursor: 0 }],
        ['learn-ask', { kind: 'learn-ask', cursor: 0, ask: 'forget' }],
      ];
      for (const vp of VIEWPORTS) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: vp.dpr, mobile: vp.mobile });
        for (const [name, prompt] of prompts) {
          await showPrompt(prompt);
          await waitForScene(page);
          const label = `${vp.width}x${vp.height}@${vp.dpr} ${name}`;
          const m = await measure(page);
          expect(m.dpr, `${label}: device pixel ratio`).toBe(vp.dpr);
          // Through the CDP session: Playwright's own screenshot would apply its own pixel ratio first.
          if (SHOTS) {
            mkdirSync(SHOTS, { recursive: true });
            const shot = (await cdp.send('Page.captureScreenshot', { format: 'png' })) as { data: string };
            writeFileSync(join(SHOTS, `${vp.width}x${vp.height}-${name}.png`), Buffer.from(shot.data, 'base64'));
          }
          if (name === 'fight' || name === 'learn') {
            const moves = m.buttons.filter((b) => b.cls.includes('bc-move'));
            expect.soft(moves.length, `${label}: four move buttons`).toBe(name === 'fight' ? 4 : 5);
            const sizes = new Set(moves.slice(0, 4).map((b) => `${Math.round(b.rect.width)}x${Math.round(b.rect.height)}`));
            expect.soft([...sizes], `${label}: one button size`).toHaveLength(1);
            // The empty fourth slot is a blank button; Ember's 6/25 PP is a quarter or less (orange).
            if (name === 'fight') expect.soft(moves[3]!.cls, `${label}: the empty slot`).toContain('is-empty');
            expect.soft(m.pp.slice(0, 3), `${label}: PP colours`).toEqual(['normal', 'normal', 'orange']);
          }
          checkFits(m, label);
        }
      }
      await cdp.send('Emulation.clearDeviceMetricsOverride');
      await page.setViewportSize({ width: 1280, height: 720 });
      await showPrompt(null);
      return false;
    },
  });
  expect(result.error).toBeUndefined();
  expect(errors).toEqual([]);
});

test('pointer Fight restores the last move and keyboard arrows keep controlling the same grid', async () => {
  test.setTimeout(300_000);
  const result = await runReplay(pageDriver(page, 'test-artifacts/battle-card', 'pointer'), REPLAY, {
    registries, seed: 1, repeat: false,
    beforeLine: (line) => line.action.type !== 'screenshot',
  });
  expect(result.error).toBeUndefined();
  await page.evaluate(() => {
    const bridge = window.openSinnohGame!;
    for (let tick = 0; tick < 5000 && bridge.battleView()?.prompt?.kind !== 'command'; tick++) bridge.advance(1);
    bridge.battleChoose({ kind: 'move', slot: 1 }); // Leer leaves the foe alive for another command.
    bridge.advance(1);
    for (let tick = 0; tick < 5000 && bridge.battleView()?.prompt?.kind !== 'command'; tick++) bridge.advance(1);
  });
  expect((await battleView())?.prompt?.kind).toBe('command');
  await page.locator('.bc-fight').click();
  await expect(page.locator('.battle-card')).toHaveAttribute('data-kind', 'fight');
  expect((await battleView())?.prompt).toMatchObject({ kind: 'fight', cursor: 1 });
  await expect(page.locator('.bc-move').nth(1)).toHaveClass(/is-cursor/);
  await page.keyboard.press('ArrowLeft');
  await page.evaluate(() => window.openSinnohGame!.advance(1));
  await expect(page.locator('.bc-move').nth(0)).toHaveClass(/is-cursor/);
  await page.keyboard.press('ArrowDown');
  await page.evaluate(() => window.openSinnohGame!.advance(1));
  await expect(page.locator('.bc-move').nth(2)).toHaveClass(/is-cursor/);
  expect((await battleView())?.prompt).toMatchObject({ kind: 'fight', cursor: 2 });
  expect(errors).toEqual([]);
});
