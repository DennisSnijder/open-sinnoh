/**
 * Following Pokémon in the app (docs/decisions.md; OPENSINNOH_NDS_ROM; desktop and phone). The headless
 * `sys-follower-walk` replay runs through `window.openSinnohGame`; then the follower is drawn: the renderer has
 * it live and on screen behind the player, and the frame around the player changes when it is recalled
 * (the lead faints). With OPENSINNOH_HGSS_ROM also set, the HeartGold/SoulSilver add-on is imported from the
 * ROM page's optional picker into IndexedDB and the same lead follows with its art.
 * Screenshots go to test-artifacts/followers (gitignored: ROM content, never commit).
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { Registries } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { loadGamePacks, runReplay } from '@opensinnoh/game';
import { mainCanvasStats, pageDriver, waitForScene } from '../../packages/cli/src/browser.ts';
import { romSlice } from '../rom.ts';
import { seedRomImport } from './seed.ts';
import { readReplay, resolveReplay } from '../rom-replays/sys-replays.ts';
import { appStrings, fixedPart } from './words.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;
const HGSS = process.env.OPENSINNOH_HGSS_ROM;
const SHOTS = 'test-artifacts/followers';

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
  await seedRomImport(page);
});

test.afterAll(async () => {
  await context?.close();
});

type Drawn = { key: string; sprite: string; kind: string; visible: boolean; onScreen: boolean; object: string | null; frame?: number };
const drawnFollower = () =>
  page.evaluate(() => {
    const actors = (globalThis as unknown as { openSinnohRenderStats?: { actors: Drawn[] } }).openSinnohRenderStats?.actors ?? [];
    // The party follower's local id is 0x100; HGSS sprite names contain set numbers, not species.
    return actors.filter((a) => a.kind === 'live' && a.key.startsWith('256:'));
  });

/** Observe the frame actually submitted to the sprite texture, across game ticks and rendered frames. */
async function followerFrames(): Promise<number[]> {
  const frames: number[] = [];
  for (let i = 0; i < 24; i++) {
    await page.evaluate(() => window.openSinnohGame!.advance(1));
    await waitForScene(page);
    const drawn = await drawnFollower();
    expect(drawn).toHaveLength(1);
    expect(drawn[0]!.frame).toBeDefined();
    frames.push(drawn[0]!.frame!);
  }
  return frames;
}

async function followerStyle(value: number): Promise<void> {
  await page.evaluate(() => {
    window.openSinnohGame!.press('x');
    window.openSinnohGame!.advance(1);
    window.openSinnohGame!.release('x');
    window.openSinnohGame!.advance(1);
  });
  await page.locator('[data-screen="start-menu"] [data-entry="options"]').click();
  await page.evaluate(() => window.openSinnohGame!.advance(2));
  // Wait for the window's opening animation before pressing a tab.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity));
  await page.locator('[data-screen="options"] [data-section="device"]').click();
  await page.evaluate(() => window.openSinnohGame!.advance(2));
  const row = page.locator('[data-setting="followerStyle"]');
  // The labels in the game's language (the label in its casing: compared without case).
  const words = (name: string) => registries.texts.get(`platinum:${name}` as Id)!.text;
  await expect(row.locator('.options-label')).toHaveText(new RegExp(`^${words('Lantern_Options_FollowerStyle')}$`, 'i'));
  await expect(row.locator('.options-value')).toHaveText([words('Lantern_Options_FollowerStill'), words('Lantern_Options_FollowerWalk')]);
  await row.locator('.options-value').nth(value).click();
  await page.evaluate(() => window.openSinnohGame!.advance(2));
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('lantern-nds:options')!).followerStyle)).toBe(value);
  // Close OPTIONS and the start menu, then let both sheets disappear.
  await page.evaluate(() => {
    window.openSinnohGame!.tap('close');
    window.openSinnohGame!.advance(2);
    window.openSinnohGame!.tap('back');
    window.openSinnohGame!.advance(2);
  });
  await expect(page.locator('[data-screen="options"]')).toBeHidden();
  await expect(page.locator('[data-screen="start-menu"]')).toBeHidden();
}

async function checkIdleStyle(): Promise<void> {
  const before = await page.evaluate(() => window.openSinnohGame!.snapshot().state.player);
  expect(new Set(await followerFrames()).size).toBe(1);
  await followerStyle(1);
  expect(new Set(await followerFrames()).size).toBeGreaterThan(1);
  await followerStyle(0);
  expect(new Set(await followerFrames()).size).toBe(1);
  expect(await page.evaluate(() => window.openSinnohGame!.snapshot().state.player)).toEqual(before);
}

/** The main canvas as 256 × (256 · aspect) luminance samples. */
async function centre(): Promise<number[]> {
  await waitForScene(page);
  return page.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        requestAnimationFrame(() => {
          const src = document.getElementById('main-canvas') as HTMLCanvasElement;
          const copy = document.createElement('canvas');
          copy.width = 256;
          copy.height = Math.round((256 * src.height) / src.width);
          const g = copy.getContext('2d')!;
          g.drawImage(src, 0, 0, copy.width, copy.height);
          const px = g.getImageData(0, 0, copy.width, copy.height).data;
          const out: number[] = [];
          for (let i = 0; i < px.length; i += 4) out.push(Math.round(0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!));
          resolve(out);
        });
      }),
  );
}

test('the lead follows: the walk replay in the app, drawn behind the player, gone when it faints', async () => {
  test.setTimeout(420_000);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
  const project = test.info().project.name;
  const result = await runReplay(pageDriver(page, SHOTS, `${project}-walk`), readReplay('sys-follower-walk.replay'), { registries, seed: 1, name: 'sys-follower-walk.replay', resolve: resolveReplay, repeat: false });
  expect(result.error).toBeUndefined();
  // The run ends with its save round trip's fade-in still to play: let it.
  await page.evaluate(() => window.openSinnohGame!.advance(12));
  await expect.poll(async () => (await drawnFollower()).filter((a) => a.visible && a.onScreen && a.object).length, { timeout: 30_000 }).toBe(1);
  await waitForScene(page);
  await page.screenshot({ path: `${SHOTS}/${project}-following.png` });
  expect((await mainCanvasStats(page)).colours).toBeGreaterThan(8);
  await checkIdleStyle();
  const before = await centre();
  // The lead faints: no one is left to follow, the follower is recalled.
  await page.evaluate(() => {
    window.openSinnohApp!.game.state.party[0]!.hp = 0;
    window.openSinnohGame!.advance(2);
  });
  await expect.poll(async () => (await drawnFollower()).length, { timeout: 30_000 }).toBe(0);
  const after = await centre();
  // The follower's tile changes (a 32 px sprite: tens of samples at this scale); nothing else moves.
  const changed = before.filter((v, i) => Math.abs(v - after[i]!) > 16).length;
  console.log(`follower beat ${project}: ${changed} samples changed`);
  expect(changed).toBeGreaterThan(10);
  expect(changed).toBeLessThan(before.length / 50);
  expect(errors).toEqual([]);
});

test('the optional HeartGold/SoulSilver add-on: picked in the first-run setup while Platinum imports, stored in IndexedDB, drawn', async () => {
  test.skip(!HGSS, 'OPENSINNOH_HGSS_ROM is not set');
  test.setTimeout(600_000);
  // A player who has not answered the add-on's question, choosing the ROM: the setup asks it during the import.
  await page.evaluate(() => localStorage.setItem('lantern-nds:setup', '["reports","textSpeed","visualStyle"]'));
  await page.goto('/?reimport');
  // The picker is hidden until IndexedDB initialization finishes and its change handlers are wired.
  await expect(page.locator('#picker')).toBeVisible();
  await expect(page.locator('#picker')).not.toContainText('HeartGold');
  const started = Date.now();
  await page.locator('#rom-input').setInputFiles(ROM!);
  await expect(page.locator('#importing')).toBeVisible();
  await expect(page.locator('#wizard .fr-choices')).toHaveAttribute('data-question', 'addon');
  // The stored game's language (main.ts, a re-import).
  const words = appStrings();
  await expect(page.locator('#wizard')).toContainText(words.ask.addon.entries[1]!.description);
  await page.locator('#addon-input').setInputFiles(HGSS!);
  await expect(page.locator('#wizard')).toContainText(words.title.allSet);
  await expect(page.locator('#addon-job')).toBeVisible();
  // Platinum, then the add-on; Start playing waits for both, then goes home: the game opens with the add-on.
  await expect(page.locator('#start-playing')).not.toHaveAttribute('aria-disabled', { timeout: 420_000 });
  await expect(page.locator('#addon-job')).toContainText(fixedPart((name) => words.rom.addonDone(name)));
  await page.locator('#start-playing').click();
  await page.waitForURL((url) => !url.search.includes('reimport'), { timeout: 60_000 });
  const meta = await page.evaluate(async () => {
    const store = (await new Function('u', 'return import(u)')('/__test/store.js')) as typeof import('../../packages/app/src/store.ts');
    const db = await store.openDb();
    const all = await store.listImports(db);
    db.close();
    return all.find((m) => m.addon);
  });
  expect(meta).toMatchObject({ addon: 'hgss-followers', files: 1151 });
  console.log(`add-on import: ${Date.now() - started} ms (wall, incl. reload), IndexedDB ${meta!.bytes} bytes in ${meta!.files} files`);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
  expect(await page.evaluate(() => window.openSinnohApp!.game.registries.followers.size)).toBe(28 + 566);
  const result = await runReplay(pageDriver(page, SHOTS, `${test.info().project.name}-hgss`), readReplay('sys-follower-walk.replay'), { registries, seed: 1, name: 'hgss', resolve: resolveReplay, repeat: false });
  expect(result.error).toBeUndefined();
  await page.evaluate(() => window.openSinnohGame!.advance(12));
  await expect
    .poll(async () => page.evaluate(() => ((globalThis as unknown as { openSinnohRenderStats?: { actors: Drawn[] } }).openSinnohRenderStats?.actors ?? []).filter((a) => a.kind === 'live' && a.sprite.startsWith('hgss-followers:') && a.visible && a.object).length), { timeout: 30_000 })
    .toBe(1);
  await waitForScene(page);
  await checkIdleStyle();
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-hgss.png` });
  expect(errors).toEqual([]);
});

/** Main-canvas luminance at `width` samples across. */
async function canvasLuma(width: number): Promise<number[]> {
  await waitForScene(page);
  return page.evaluate(
    (width) =>
      new Promise<number[]>((resolve) => {
        requestAnimationFrame(() => {
          const src = document.getElementById('main-canvas') as HTMLCanvasElement;
          const copy = document.createElement('canvas');
          copy.width = width;
          copy.height = Math.round((width * src.height) / src.width);
          const g = copy.getContext('2d')!;
          g.drawImage(src, 0, 0, copy.width, copy.height);
          const px = g.getImageData(0, 0, copy.width, copy.height).data;
          const out: number[] = [];
          for (let i = 0; i < px.length; i += 4) out.push(Math.round(0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!));
          resolve(out);
        });
      }),
    width,
  );
}

type Shown = { hero: boolean; pet: boolean };
async function show(s: Shown): Promise<void> {
  await page.evaluate((s) => {
    const world = window.openSinnohApp!.game.world as unknown as { hero: { visible: boolean }; pet: { actor: { visible: boolean } } };
    world.hero.visible = s.hero;
    world.pet.actor.visible = s.pet;
  }, s);
}

/** The player's drawn samples, and how many of them the follower covers (hiding one sprite at a time). */
async function overlap(): Promise<{ player: number; covered: number; follower: number }> {
  const both = await canvasLuma(512);
  await show({ hero: true, pet: false });
  const hero = await canvasLuma(512);
  await show({ hero: false, pet: false });
  const none = await canvasLuma(512);
  await show({ hero: false, pet: true });
  const pet = await canvasLuma(512);
  await show({ hero: true, pet: true });
  let player = 0, covered = 0, follower = 0;
  for (let i = 0; i < both.length; i++) {
    const isHero = Math.abs(hero[i]! - none[i]!) > 16;
    if (Math.abs(pet[i]! - none[i]!) > 16) follower++;
    if (!isHero) continue;
    player++;
    if (Math.abs(both[i]! - hero[i]!) > 16) covered++;
  }
  return { player, covered, follower };
}

test('a large follower (Origin Giratina): one tile behind, drawn as HGSS draws its 64×64 billboard', async () => {
  test.skip(!HGSS, 'OPENSINNOH_HGSS_ROM is not set');
  test.setTimeout(300_000);
  const replay = ['party 0 platinum:SPECIES_GIRATINA 70', 'set state repel 250', 'warp platinum:MAP_HEADER_TWINLEAF_TOWN 110 882 down', 'until idle'].join('\n');
  const result = await runReplay(pageDriver(page, SHOTS, `${test.info().project.name}-large`), replay, { registries, seed: 1, name: 'large', resolve: resolveReplay, repeat: false });
  expect(result.error).toBeUndefined();
  await page.evaluate(() => {
    window.openSinnohApp!.game.state.party[0]!.form = 1;
    window.openSinnohGame!.advance(2);
  });
  // The renderer's stats come with the next drawn frame.
  await expect.poll(async () => (await drawnFollower())[0]?.sprite ?? '', { timeout: 30_000 }).toMatch(/^hgss-followers:/);
  // The path: down 5, left 5, up 1 (a fence), right 5, down 4. After each leg the player stands still.
  for (const dir of ['down', 'left', 'up', 'right', 'down'] as const) {
    await page.evaluate((dir) => {
      window.openSinnohGame!.press(dir);
      window.openSinnohGame!.advance(40);
      window.openSinnohGame!.release(dir);
      window.openSinnohGame!.advance(30);
    }, dir);
    const at = await page.evaluate(() => {
      const { state } = window.openSinnohGame!.snapshot();
      const actors = window.openSinnohApp!.game.world.view().actors;
      const pet = actors.find((a) => a.localId === 0x100)!;
      return { player: state.player, follower: state.partyFollower!, dx: pet.cur[0] - actors[0]!.cur[0], dz: pet.cur[2] - actors[0]!.cur[2] };
    });
    const o = await overlap();
    console.log(`large follower after ${dir}: ${JSON.stringify(at)} ${JSON.stringify(o)}`);
    const { player: p, follower: f } = at;
    // Always one tile behind, never on the player's tile.
    expect(Math.abs(f.x - p.x) + Math.abs(f.z - p.z)).toBe(1);
    // HGSS FollowMonBillboard_AddFacingOffset for the 64×64 billboard: a unit behind facing up or down, 10 aside facing left or right.
    const offset = { up: [0, 1], down: [0, -1], left: [10, 0], right: [-10, 0] }[f.facing];
    expect([at.dx, at.dz]).toEqual([(f.x - p.x) * 16 + offset[0]!, (f.z - p.z) * 16 + offset[1]!]);
    expect(o.player).toBeGreaterThan(300);
    expect(o.follower).toBeGreaterThan(o.player);
    if (f.z < p.z || f.z === p.z) {
      // Behind the player on screen (north) or beside them: the player stays drawn whole.
      expect(o.covered).toBeLessThan(o.player * 0.05);
    } else {
      // South of the player (they walked up): nearer the camera, so drawn in front, as in HGSS.
      expect(o.covered).toBeGreaterThan(o.player * 0.3);
    }
  }
  expect(errors).toEqual([]);
});
