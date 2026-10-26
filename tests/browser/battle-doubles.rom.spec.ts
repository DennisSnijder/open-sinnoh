/**
 * The doubles scene and card on the real ROM (OPENSINNOH_NDS_ROM; skipped without it; the desktop project, the
 * spec sets its own viewports). From the doubles replays (setup lines, no story chain):
 * - `m5-double-twins` (type 3): at 375×812, 844×390, 1000×750 @2 and 1920×1080, the four battlers are drawn at their
 *   doubles spots and the four healthboxes inside the scene and the view (pixel checks: each drawn, then hidden, the
 *   canvas compared), the command card clear of the boxes in window mode, the target screen (single and group) fits
 *   with nothing overflowing and no page scroll; then the target screen by tap and by keys, CANCEL on the second
 *   battler's card going back to the first.
 * - `m5-double-vs2` (type 19): both enemy trainers drawn at their spots in the intro.
 * - `m5-cheryl-wild-double` (74, then 75): the partner's back picture beside the player's in the wild intro; four
 *   trainers in the tag intro.
 * Screenshots go to OPENSINNOH_DOUBLES_SHOTS (ROM content, never commit).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type CDPSession, type Page } from '@playwright/test';
import type { ReplayLine } from '@opensinnoh/core';
import type { BattleMoveView, BattlePrompt, BattleView, Registries } from '@opensinnoh/contracts';
import { loadGamePacks, runReplay } from '@opensinnoh/game';
import { romSlice } from '../rom.ts';
import { romContext, resetRomDevice } from './rom-context.ts';
import { pageDriver, waitForScene } from '../../packages/cli/src/browser.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;
const SHOTS = process.env.OPENSINNOH_DOUBLES_SHOTS;
const dir = join(import.meta.dirname, '../rom-replays');
const read = (file: string) => readFileSync(join(dir, file), 'utf8');

test.describe.configure({ mode: 'serial' });
test.skip(!ROM, 'OPENSINNOH_NDS_ROM is not set');

let registries: Registries;
let context: BrowserContext;
let page: Page;
let cdp: CDPSession;
const errors: string[] = [];

test.beforeAll(async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'the spec sets its own viewports');
  test.setTimeout(420_000);
  registries = loadGamePacks([romSlice().pack]).registries;
  // The worker's seeded context (rom-context.ts): the import is copied into the browser once per worker, not per file.
  context = await romContext(browser, info.project.use);
  page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 720 });
  cdp = await context.newCDPSession(page);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await resetRomDevice(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
});

test.afterAll(async () => {
  await page?.close();
});

const VIEWPORTS = [
  { width: 375, height: 812, dpr: 3, mobile: true },
  { width: 844, height: 390, dpr: 3, mobile: true },
  { width: 1000, height: 750, dpr: 2, mobile: false },
  { width: 1920, height: 1080, dpr: 1, mobile: false },
] as const;

/** Decomp spots (healthbox.c, gBattlerEncounterX/gEncounterCoords): battler centres and trainer spots by topology. */
const BATTLER_AT = [
  [40, 112],
  [216, 50],
  [80, 120],
  [176, 42],
] as const;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const battleView = () => page.evaluate(() => window.openSinnohGame!.battleView()) as Promise<BattleView | null>;
const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/** Waits until the battle canvas has the new view's width in device px and keeps its size for 3 frames. */
async function settle(width: number): Promise<void> {
  // Polled from here: waitForFunction takes the predicate's promise as its truthy answer and would not wait.
  await expect.poll(() => page.evaluate(
    (w) =>
      new Promise<boolean>((resolve) => {
        const c = document.getElementById('battle-canvas') as HTMLCanvasElement;
        const size = `${c.width}x${c.height}`;
        let n = 0;
        const step = () => {
          // The scene's reported scale agrees with the canvas's device pixels (the page's pixel ratio has caught up).
          const s = window.openSinnohApp!.battleScene();
          const dpr = c.width / c.getBoundingClientRect().width;
          if (`${c.width}x${c.height}` !== size || c.width !== w || Math.abs(s.rect.width * dpr - s.scale * 256) > 1 || Math.abs(devicePixelRatio - dpr) > 1e-6) return resolve(false);
          if (++n >= 3) return resolve(true);
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    width,
    // Three agreeing frames in a row; a loaded machine with software GL draws a frame every second or two.
  ), { timeout: 90_000 }).toBe(true);
}

/** Ticks until the battle waits on a prompt matching `ok` (or fails). */
async function untilPrompt(ok: (p: BattlePrompt) => boolean, max = 3000): Promise<BattlePrompt> {
  for (let i = 0; i < max; i++) {
    const p = (await battleView())?.prompt;
    if (p && ok(p)) return p;
    await page.evaluate(() => window.openSinnohGame!.advance(1));
  }
  throw new Error(`no such prompt after ${max} ticks: ${JSON.stringify((await battleView())?.prompt)}`);
}

/** One button for a tick, then released for a tick (the battle's own cursor). */
async function press(button: 'a' | 'b' | 'up' | 'down' | 'left' | 'right'): Promise<void> {
  await page.evaluate((b) => {
    const g = window.openSinnohGame!;
    g.press(b);
    g.advance(1);
    g.release(b);
    g.advance(1);
  }, button);
}

/** A change to the drawn view (the battle itself is untouched): a battler, a healthbox or a trainer not shown, or a prompt. */
type Patch = { battler?: number; healthbox?: number; trainer?: 'trainer' | 'partnerTrainer' | 'enemyTrainer' | 'enemyTrainer2'; prompt?: BattlePrompt | null };

/** Draws the view with `patch` (null: as the battle has it). */
async function patchView(patch: Patch | null): Promise<void> {
  await page.evaluate((p) => {
    const battle = window.openSinnohApp!.game.battle as unknown as { view(): BattleView; __view?: () => BattleView };
    battle.__view ??= battle.view.bind(battle);
    const view = battle.__view;
    battle.view = !p
      ? view
      : () => {
          const v = structuredClone(view());
          if (p.battler !== undefined) v.battlers.find((b) => b.battler === p.battler)!.visible = false;
          if (p.healthbox !== undefined) v.battlers.find((b) => b.battler === p.healthbox)!.healthbox.visible = false;
          if (p.trainer) (v as unknown as Record<string, unknown>)[p.trainer] = null;
          if (p.prompt !== undefined) v.prompt = p.prompt;
          return v;
        };
  }, patch);
  await frames();
}

/** The scene's place (page px, device px per DS px, window or not). */
function grab(): Promise<{ scene: { rect: Box; scale: number; windowed: boolean } }> {
  return page.evaluate(() => ({ scene: window.openSinnohApp!.battleScene() }));
}

/** Keeps the battle canvas's pixels in the page (`window.__grab`), or compares them with the kept ones. */
function canvasDiff(keep: boolean, region: Box | null = null): Promise<{ count: number; inside: number; box: [number, number, number, number]; w: number; canvas: Box; scene: { rect: Box; scale: number } }> {
  return page.evaluate(([keep, region]) => {
    const c = document.getElementById('battle-canvas') as HTMLCanvasElement;
    const r = c.getBoundingClientRect();
    const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const w = window as unknown as { __grab?: Uint8ClampedArray };
    const scene = window.openSinnohApp!.battleScene();
    const out = { count: 0, inside: 0, box: [Infinity, Infinity, -Infinity, -Infinity] as [number, number, number, number], w: c.width, canvas: { x: r.x, y: r.y, width: r.width, height: r.height }, scene };
    if (keep) {
      w.__grab = data;
      return out;
    }
    // The region in device px (DS px from the scene's origin).
    const dpr = c.width / r.width;
    const k = scene.scale;
    const [ox, oy] = [(scene.rect.x - r.x) * dpr, (scene.rect.y - r.y) * dpr];
    const a = w.__grab!;
    if (a.length !== data.length) throw new Error("the battle canvas changed size between the two grabs");
    for (let i = 0; i < a.length; i += 4) {
      if (Math.abs(a[i]! - data[i]!) + Math.abs(a[i + 1]! - data[i + 1]!) + Math.abs(a[i + 2]! - data[i + 2]!) < 24) continue;
      out.count++;
      if (region) {
        const dx = ((i / 4) % c.width - ox) / k;
        const dy = (Math.floor(i / 4 / c.width) - oy) / k;
        if (dx >= region.x && dx < region.x + region.width && dy >= region.y && dy < region.y + region.height) out.inside++;
      }
      const x = (i / 4) % c.width;
      const y = Math.floor(i / 4 / c.width);
      const b = out.box;
      out.box = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x + 1), Math.max(b[3], y + 1)];
    }
    return out;
  }, [keep, region] as const);
}

/**
 * What `patch` takes away from the drawn scene: the changed pixels (DS px², and the share inside `region`, DS px) and
 * their bounds in DS px and in page px.
 */
async function drawnBy(patch: Patch, region: Box | null = null): Promise<{ count: number; share: number; ds: Box; page: Box }> {
  // On a loaded machine a frame can land between the two grabs: a region that misses is measured again.
  for (let attempt = 0; ; attempt++) {
    const d = await drawnOnce(patch, region);
    if (!region || d.share > 0.9 || attempt === 2) return d;
    await frames();
  }
}

async function drawnOnce(patch: Patch, region: Box | null): Promise<{ count: number; share: number; ds: Box; page: Box }> {
  await patchView(null);
  await canvasDiff(true);
  await patchView(patch);
  const d = await canvasDiff(false, region);
  await patchView(null);
  const dpr = d.w / d.canvas.width;
  const ox = (d.scene.rect.x - d.canvas.x) * dpr;
  const oy = (d.scene.rect.y - d.canvas.y) * dpr;
  const [x0, y0, x1, y1] = d.box;
  const k = d.scene.scale;
  const ds = { x: (x0 - ox) / k, y: (y0 - oy) / k, width: (x1 - x0) / k, height: (y1 - y0) / k };
  const pageBox = { x: d.canvas.x + x0 / dpr, y: d.canvas.y + y0 / dpr, width: (x1 - x0) / dpr, height: (y1 - y0) / dpr };
  return { count: d.count / (k * k), share: d.count ? d.inside / d.count : 0, ds, page: pageBox };
}

const inside = (a: Box, b: Box) => a.x >= b.x - 0.5 && a.y >= b.y - 0.5 && a.x + a.width <= b.x + b.width + 0.5 && a.y + a.height <= b.y + b.height + 0.5;
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** The card's geometry and anything in it (or the page) that overflows. */
function measureCard() {
  return page.evaluate(() => {
    const box = (e: Element) => {
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const card = document.querySelector<HTMLElement>('.battle-card')!;
    const overflow = [card, ...card.querySelectorAll<HTMLElement>('*')]
      .filter((e) => !e.classList.contains('sr-only') && (e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1) && getComputedStyle(e).display !== 'inline')
      .map((e) => `${e.className} ${e.scrollWidth}x${e.scrollHeight} in ${e.clientWidth}x${e.clientHeight}`);
    return {
      hidden: card.hidden,
      card: box(card),
      overflow,
      page: { scrollW: document.scrollingElement!.scrollWidth, scrollH: document.scrollingElement!.scrollHeight, w: innerWidth, h: innerHeight },
      art: [...card.querySelectorAll<HTMLElement>('.bc-button')].filter((b) => !getComputedStyle(b).borderImageSource.startsWith('url(')).map((b) => b.className),
      buttons: [...card.querySelectorAll<HTMLElement>('.bc-button')].map((b) => ({ cls: b.className, disabled: (b as HTMLButtonElement).disabled, rect: box(b), texts: [...b.querySelectorAll('canvas')].map(box) })),
    };
  });
}

async function shot(name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  const s = (await cdp.send('Page.captureScreenshot', { format: 'png' })) as { data: string };
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(s.data, 'base64'));
}

/** Plays `replay` until its first `screenshot` line, then runs `at` there (the rest of the replay is skipped). */
async function playTo(replay: string, at: () => Promise<void>, file = 'battle-doubles'): Promise<void> {
  const driver = pageDriver(page, SHOTS ?? 'test-artifacts/battle-doubles', file);
  let ran = false;
  const result = await runReplay(driver, replay, {
    registries,
    name: `${file}.replay`,
    seed: 1,
    repeat: false,
    async beforeLine(line: ReplayLine) {
      if (line.action.type !== 'screenshot') return;
      if (!ran) await at();
      ran = true;
      return false;
    },
  });
  expect(result.error).toBeUndefined();
  expect(ran).toBe(true);
}

/** The replay's setup and walk up to its battle's first command, then a screenshot beat (`playTo` stops there). */
const toBattle = (file: string, before: RegExp) => {
  const lines = read(file).split('\n');
  const end = lines.findIndex((l) => before.test(l));
  return `${lines.slice(0, end).join('\n')}\nuntil battle 3000\n+0 screenshot doubles\n`;
};

/**
 * The replay up to its `n`th battle (0-based), before the `advance text` that would play through the sight event and
 * the battle's intro, then a screenshot beat; `toIntro` then talks through the event until the battle starts.
 */
const beforeBattle = (file: string, n: number) => {
  const lines = read(file).split('\n');
  const auto = lines.flatMap((l, i) => (/^battle auto/.test(l) ? [i] : []))[n]!;
  // Back over the releases to the line that waits the battle in (`advance text` or `until battle`), which goes too.
  let end = auto;
  while (/^\+0 release/.test(lines[end - 1]!)) end--;
  if (/^(advance text|until battle)/.test(lines[end - 1]!)) end--;
  return `${lines.slice(0, end).join('\n')}\n+0 screenshot intro\n`;
};

/** A on the field's messages (every 8 ticks) until a battle starts. */
async function toIntro(): Promise<void> {
  for (let i = 0; i < 4000 && !(await battleView()); i++) {
    await page.evaluate((tap) => {
      const g = window.openSinnohGame!;
      if (tap) g.press('a');
      g.advance(1);
      g.release('a');
    }, i % 8 === 0);
  }
  expect(await battleView(), 'the battle started').not.toBeNull();
}

test('the twins (type 3): four battlers and boxes at every size, the target screen, CANCEL', async () => {
  test.setTimeout(600_000);
  await playTo(toBattle('m5-double-twins.replay', /^battle auto/), async () => {
    const command = (await untilPrompt((p) => p.kind === 'command')) as Extract<BattlePrompt, { kind: 'command' }>;
    expect(command.actor).toBe(0);
    const single = command.moves.findIndex((m) => m.aim && !m.aim.group && m.aim.targets.includes(1));
    expect(single, 'a move the player aims').toBeGreaterThanOrEqual(0);
    const move = command.moves[single]!;
    const group: BattleMoveView = { ...move, aim: { targets: [3, 1], group: true } };
    const v0 = (await battleView())!;
    expect(v0.topology).toBe('double');
    for (const vp of VIEWPORTS) {
      const label = `${vp.width}x${vp.height}@${vp.dpr}`;
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: vp.dpr, mobile: vp.mobile });
      await settle(vp.width * vp.dpr);
      await waitForScene(page);
      const view = { x: 0, y: 0, width: vp.width, height: vp.height };
      // Each battler drawn at its doubles spot.
      for (const b of [0, 1, 2, 3]) {
        // The sprite's 80 × 80 cell around its spot (the face's y offset moves it up to 16 px).
        const [x, y] = BATTLER_AT[b]!;
        const d = await drawnBy({ battler: b }, { x: x - 40, y: y - 56, width: 80, height: 96 });
        expect.soft(d.count, `${label}: battler ${b} drawn`).toBeGreaterThan(150);
        expect.soft(d.share, `${label}: battler ${b} drawn at its spot (changes in ${JSON.stringify(d.ds)}, page ${JSON.stringify(d.page)}, scene ${JSON.stringify((await grab()).scene)})`).toBeGreaterThan(0.9);
      }
      // Each healthbox drawn inside the scene and the view, the command card clear of all four.
      const m = await measureCard();
      const scene = (await grab()).scene;
      const visible = { x: Math.max(0, scene.rect.x), y: Math.max(0, scene.rect.y), width: Math.min(vp.width, scene.rect.x + scene.rect.width) - Math.max(0, scene.rect.x), height: Math.min(vp.height, scene.rect.y + scene.rect.height) - Math.max(0, scene.rect.y) };
      for (const b of [0, 1, 2, 3]) {
        const d = await drawnBy({ healthbox: b });
        expect.soft(d.count, `${label}: healthbox ${b} drawn`).toBeGreaterThan(400);
        // Sideways the DS lets the tails of enemy 2's and player 2's boxes run past the screen's edges (healthbox.c
        // offsets 58 and 198): 8 DS px are allowed there.
        const tail = 8 * (scene.rect.width / 256);
        const room = { ...visible, x: visible.x - tail, width: visible.width + 2 * tail };
        expect.soft(inside(d.page, room), `${label}: healthbox ${b} ${JSON.stringify(d.page)} in the scene's visible part ${JSON.stringify(visible)}`).toBe(true);
        expect.soft(inside(d.page, view), `${label}: healthbox ${b} in the view`).toBe(true);
        expect.soft(overlaps(d.page, m.card), `${label}: the card ${JSON.stringify(m.card)} covers healthbox ${b} ${JSON.stringify(d.page)}`).toBe(false);
      }
      await shot(`${label}-command`);
      // The command card and the target screens fit: nothing overflows, no page scroll, the ROM's art, text inside.
      for (const [name, prompt] of [
        ['command', command],
        ['target', { kind: 'target', cursor: 3, slot: single, move, actor: 0 }],
        ['group', { kind: 'target', cursor: 3, slot: single, move: group, actor: 0 }],
      ] as [string, BattlePrompt][]) {
        await patchView({ prompt });
        await waitForScene(page);
        const c = await measureCard();
        expect.soft(c.hidden, `${label} ${name}: card shown`).toBe(false);
        expect.soft(c.overflow, `${label} ${name}: overflow`).toEqual([]);
        expect.soft(c.page.scrollW, `${label} ${name}: no sideways scroll`).toBeLessThanOrEqual(c.page.w);
        expect.soft(c.page.scrollH, `${label} ${name}: no page scroll`).toBeLessThanOrEqual(c.page.h);
        expect.soft(c.art, `${label} ${name}: buttons without ROM art`).toEqual([]);
        expect.soft(inside(c.card, view), `${label} ${name}: card ${JSON.stringify(c.card)} in the view`).toBe(true);
        for (const b of c.buttons) {
          expect.soft(inside(b.rect, c.card), `${label} ${name}: ${b.cls} inside the card`).toBe(true);
          for (const t of b.texts) expect.soft(inside(t, b.rect), `${label} ${name}: ${b.cls} text inside`).toBe(true);
        }
        if (name !== 'command') {
          const targets = c.buttons.filter((b) => b.cls.includes('bc-target'));
          expect.soft(targets.map((b) => b.cls.match(/bc-t(\d)/)![1]), `${label} ${name}: the grid`).toEqual(['3', '1', '0', '2']);
          expect.soft(targets.map((b) => b.disabled), `${label} ${name}: who can be aimed at`).toEqual(name === 'group' ? [false, false, true, true] : [false, false, true, false]);
          expect.soft(targets.filter((b) => b.cls.includes('is-cursor')).length, `${label} ${name}: the cursor`).toBe(name === 'group' ? 2 : 1);
          await shot(`${label}-${name}`);
        }
      }
      await patchView(null);
    }
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    await page.setViewportSize({ width: 1280, height: 720 });
    await waitForScene(page);

    // By tap: FIGHT, the move, enemy 1 on the target screen; battler 2's card shows CANCEL (RUN's place), which goes back.
    await page.click('.bc-fight');
    await frames();
    await page.locator('.bc-move').nth(single).click();
    await frames();
    expect(await page.locator('.bc-targets .bc-target').count()).toBe(4);
    await page.click('.bc-t1');
    const second = await untilPrompt((p) => p.kind === 'command' && p.actor === 2);
    expect(second).toMatchObject({ canRewind: true });
    await frames();
    await expect(page.locator('.bc-rewind')).toBeEnabled();
    await page.click('.bc-rewind');
    await untilPrompt((p) => p.kind === 'command' && p.actor === 0);

    // By keys: A (FIGHT), the move, A: the target screen on enemy 2 (the cursor's first stop); right: enemy 1; A.
    await press('a');
    for (let i = 0; i < single; i++) await press(i % 2 ? 'down' : 'right');
    await press('a');
    expect((await battleView())!.prompt).toMatchObject({ kind: 'target', cursor: 3, slot: single });
    await frames();
    expect(await page.locator('.bc-t3.is-cursor').count()).toBe(1);
    await press('right');
    expect((await battleView())!.prompt).toMatchObject({ kind: 'target', cursor: 1 });
    await press('a');
    await untilPrompt((p) => p.kind === 'command' && p.actor === 2);
    // B on battler 2's card: CANCEL.
    await press('b');
    await untilPrompt((p) => p.kind === 'command' && p.actor === 0);
  });
  expect(errors).toEqual([]);
});

/** Ticks through the intro until `ready` holds for the view, then runs `at`. */
async function inIntro(ready: (v: BattleView) => boolean, at: (v: BattleView) => Promise<void>): Promise<void> {
  const seen: string[] = [];
  for (let i = 0; i < 600; i++) {
    const v = await battleView();
    if (v && !v.transition && v.fade === 0 && ready(v)) {
      await waitForScene(page);
      return at(v);
    }
    seen.push(JSON.stringify(v && { fade: v.fade, t: !!v.transition, trainer: v.trainer, partner: v.partnerTrainer, e: v.enemyTrainer, e2: v.enemyTrainer2 }));
    await page.evaluate(() => window.openSinnohGame!.advance(1));
  }
  throw new Error(`the intro never showed what the test waits for: ${[...new Set(seen)].slice(0, 80).join('\n')}`);
}

test('two enemy trainers (type 19) stand at their battlers\' spots in the intro', async () => {
  test.setTimeout(300_000);
  await playTo(beforeBattle('m5-double-vs2.replay', 0), async () => {
    await toIntro();
    await inIntro(
      (v) => v.enemyTrainer?.dx === 0 && v.enemyTrainer2?.dx === 0,
      async () => {
        for (const [trainer, x, y] of [
          ['enemyTrainer', 216, 50],
          ['enemyTrainer2', 176, 42],
        ] as const) {
          const d = await drawnBy({ trainer }, { x: x - 48, y: y - 80, width: 96, height: 128 });
          expect.soft(d.count, `${trainer} drawn`).toBeGreaterThan(300);
          expect.soft(d.share, `${trainer} at its spot (changes in ${JSON.stringify(d.ds)})`).toBeGreaterThan(0.9);
        }
        await shot('vs2-intro');
      },
    );
  });
  expect(errors).toEqual([]);
});

test('the walking partner (74, then 75): its back picture beside the player\'s, then four trainers', async () => {
  test.setTimeout(300_000);
  // The wild double: the player and Cheryl at players 1 and 2.
  await playTo(beforeBattle('m5-cheryl-wild-double.replay', 0), async () => {
    await toIntro();
    await inIntro(
      (v) => v.trainer?.dx === 0 && v.partnerTrainer?.dx === 0,
      async (v) => {
        expect(v.topology).toBe('ai-partner');
        for (const [trainer, x, y] of [
          ['trainer', 40, 112],
          ['partnerTrainer', 80, 120],
        ] as const) {
          const d = await drawnBy({ trainer }, { x: x - 48, y: y - 80, width: 96, height: 128 });
          expect.soft(d.count, `${trainer} drawn`).toBeGreaterThan(300);
          expect.soft(d.share, `${trainer} at its spot (changes in ${JSON.stringify(d.ds)})`).toBeGreaterThan(0.9);
        }
        await shot('cheryl-wild-intro');
      },
    );
  });
  // The tag battle after it (the wild one played by the replay's `battle auto`): four trainers at once.
  await playTo(beforeBattle('m5-cheryl-wild-double.replay', 1), async () => {
    await toIntro();
    expect((await battleView())!.kind).toBe('trainer');
    await inIntro(
      (v) => v.trainer?.dx === 0 && v.partnerTrainer?.dx === 0 && v.enemyTrainer?.dx === 0 && v.enemyTrainer2?.dx === 0,
      async () => {
        for (const trainer of ['trainer', 'partnerTrainer', 'enemyTrainer', 'enemyTrainer2'] as const) expect.soft((await drawnBy({ trainer })).count, `${trainer} drawn`).toBeGreaterThan(300);
        await shot('cheryl-tag-intro');
      },
    );
  }, 'battle-doubles-tag');
  expect(errors).toEqual([]);
});
