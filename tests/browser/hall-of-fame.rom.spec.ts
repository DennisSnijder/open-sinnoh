/**
 * The Hall of Fame in the app (OPENSINNOH_NDS_ROM; desktop and phone): the Hall of Fame induction, the credits and the
 * OpenSinnoh card, as one composed screen. A constructed start in the Hall of Fame room (its frame script, the
 * machine, clear_game) plays through `window.openSinnohGame`; at each beat the scene's canvas has ROM art drawn,
 * its text is placed, and the scene is one whole-pixel screen inside the viewport (never the split DS layout).
 * Then the reset and CONTINUE upstairs in Twinleaf. Screenshots go to test-artifacts (ROM content, never commit).
 */
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { AppView } from '@opensinnoh/contracts';
import { CountingStubLog, createGame, runReplay } from '@opensinnoh/game';
import { OPENSINNOH_CARD } from '@opensinnoh/menus';
import { gameLanguage } from '@opensinnoh/services';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';
import { pageDriver } from '../../packages/cli/src/browser.ts';
import { romSlice } from '../rom.ts';
import { canvasStats } from './canvas.ts';
import { seedRomImport } from './seed.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;
const SHOTS = join(import.meta.dirname, '../../test-artifacts/hall-of-fame');

test.skip(!ROM, 'OPENSINNOH_NDS_ROM is not set');

const TEAM = [
  'SPECIES_GARCHOMP 100 MOVE_EARTHQUAKE MOVE_DRAGON_CLAW',
  'SPECIES_INFERNAPE 100 MOVE_FLARE_BLITZ MOVE_CLOSE_COMBAT',
  'SPECIES_LUCARIO 100 MOVE_AURA_SPHERE',
  'SPECIES_STARAPTOR 100 MOVE_BRAVE_BIRD',
  'SPECIES_GYARADOS 100 MOVE_WATERFALL',
  'SPECIES_MAMOSWINE 100 MOVE_EARTHQUAKE',
].map((m, i) => `party ${i} ${m.replace(/(SPECIES|MOVE)_/g, 'platinum:$1_')}`);

const REPLAY = [
  ...TEAM,
  'set var platinum:VAR_PLAYER_HOUSE_SPECIAL_PROGRAM_STATE 1',
  'set var platinum:VAR_PLAYER_HOUSE_STATE 7',
  'warp platinum:MAP_HEADER_POKEMON_LEAGUE_HALL_OF_FAME 8 15 up',
  'advance text 6000',
  '+0 assert app hall-of-fame',
  '+80 screenshot hof-member',
  '+1420 screenshot hof-group',
  '+0 press a',
  '+1 release a',
  'until app credits 600',
  '+600 screenshot credits-scroll',
  '+4400 screenshot credits-day',
  '+2600 screenshot credits-night',
  '+200 screenshot credits-stars',
  '+700 screenshot credits-final',
  '+1700 screenshot credits-card',
  'until app none 1000',
  '+0 reset',
  'until idle 600',
  '+0 assert position platinum:MAP_HEADER_TWINLEAF_TOWN_PLAYER_HOUSE_2F 4 6',
  '+0 assert state hallOfFame.total 1',
].join('\n');

/** The scene now: its canvas's colours and lit share, its text rows, and the stage's rect against the viewport. */
async function scene(page: Page) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const stats = await canvasStats(page, '.ds-scene-canvas');
  const layout = await page.evaluate(() => {
    const stage = document.querySelector('.ds-scene-stage')!.getBoundingClientRect();
    return {
      stage: { x: stage.x, y: stage.y, w: stage.width, h: stage.height },
      view: { w: innerWidth, h: innerHeight },
      stages: document.querySelectorAll('.ds-scene-stage').length,
      rows: document.querySelectorAll('.ds-scene-boxes .hof-line').length,
      card: document.querySelector('.credits-card')?.textContent ?? null,
      mark: document.querySelector('.credits-card .os-wordmark[aria-label="OpenSinnoh"]')?.getBoundingClientRect().width ?? 0,
    };
  });
  return { ...stats, ...layout };
}

/** Compare only our renders, keeping the game clock, text and Pokémon fixed. No reference-image fixtures. */
async function motionPixels(page: Page, ride: boolean) {
  return page.evaluate(async (isRide) => {
    const game = window.openSinnohApp!.game;
    const original = game.app.bind(game);
    const v = original()!;
    const canvas = document.querySelector<HTMLCanvasElement>('.ds-scene-canvas')!;
    const g = canvas.getContext('2d')!;
    const wait = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    await wait();
    const first = g.getImageData(0, 0, 256, 192).data;
    game.app = () => v.app === 'credits' ? { ...v, sceneFrame: v.sceneFrame + 11 } : v.app === 'hall-of-fame' && v.mode === 'record' ? { ...v, tick: v.tick + 30 } : v;
    await wait();
    const second = g.getImageData(0, 0, 256, 192).data;
    game.app = original;
    await wait();
    let changed = 0;
    let outside = 0;
    for (let y = 0; y < 192; y++) for (let x = 0; x < 256; x++) {
      const i = (y * 256 + x) * 4;
      if (Math.abs(first[i]! - second[i]!) + Math.abs(first[i + 1]! - second[i + 1]!) + Math.abs(first[i + 2]! - second[i + 2]!) < 8) continue;
      if (isRide) { if (x < 150) changed++; }
      else {
        const f = v.app === 'hall-of-fame' && v.mode === 'record' ? v.member?.frame : null;
        if (f && x >= f.x && x < f.x + 96 && y >= f.y && y < f.y + 128) changed++;
        else outside++;
      }
    }
    return { changed, outside };
  }, ride);
}

/** Pause the real room script at its final machine beat; compare the ROM texture frames and capped frame. */
async function machineBeat(page: Page) {
  await page.evaluate(() => {
    const bridge = window.openSinnohGame!;
    for (let i = 0; i < 6000; i++) {
      if (window.openSinnohApp!.game.world.view().healMachine?.frame !== undefined) return;
      if (i % 2 === 0) bridge.press('a'); else bridge.release('a');
      bridge.advance(1);
    }
    throw new Error('Hall of Fame machine never reached its final animation');
  });
  await page.waitForFunction(() => !window.openSinnohApp!.sceneLoading(), undefined, { timeout: 60_000 });
  const result = await page.evaluate(async () => {
    const world = window.openSinnohApp!.game.world;
    const original = world.view.bind(world);
    const canvas = document.querySelector<HTMLCanvasElement>('#main-canvas')!;
    const scratch = document.createElement('canvas');
    scratch.width = canvas.width; scratch.height = canvas.height;
    const g = scratch.getContext('2d')!;
    const read = async (frame: number) => {
      world.view = () => ({ ...original(), healMachine: { balls: 6, flash: true, frame } });
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      g.drawImage(canvas, 0, 0);
      return g.getImageData(0, 0, canvas.width, canvas.height).data;
    };
    const rest = await read(0);
    const flash = await read(8);
    world.view = original;
    (window as unknown as { hofRest: Uint8ClampedArray }).hofRest = rest;
    return flash.reduce((sum, v, i) => sum + (i % 4 === 3 ? 0 : Math.abs(v - rest[i]!)), 0);
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reduced = await page.evaluate(async () => {
    const world = window.openSinnohApp!.game.world;
    const original = world.view.bind(world);
    world.view = () => ({ ...original(), healMachine: { balls: 6, flash: true, frame: 8 } });
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const canvas = document.querySelector<HTMLCanvasElement>('#main-canvas')!;
    const scratch = document.createElement('canvas'); scratch.width = canvas.width; scratch.height = canvas.height;
    const g = scratch.getContext('2d')!; g.drawImage(canvas, 0, 0);
    const data = g.getImageData(0, 0, canvas.width, canvas.height).data;
    const local = window as unknown as { hofRest?: Uint8ClampedArray };
    const energy = data.reduce((sum, v, i) => sum + (i % 4 === 3 ? 0 : Math.abs(v - local.hofRest![i]!)), 0);
    delete local.hofRest;
    world.view = original;
    window.openSinnohGame!.release('a');
    return energy;
  });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  expect(result).toBeGreaterThan(1000);
  expect(reduced).toBeLessThan(result * 0.4);
  expect(reduced).toBeGreaterThan(0);
}

test('the induction, the credits and the OpenSinnoh card on one screen, then CONTINUE upstairs', async ({ page }, info) => {
  test.setTimeout(900_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await seedRomImport(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
  const driver = pageDriver(page, SHOTS, info.project.name);
  const registries = createGame({ packs: [romSlice().pack], createWorld, createScriptRunner, seed: 1, log: new CountingStubLog(() => {}) }).registries;
  const seen: string[] = [];
  const replay = `set state gender "${info.project.name === 'phone' ? 'female' : 'male'}"\n${REPLAY}`;
  const result = await runReplay(driver, replay, {
    registries,
    seed: 1,
    name: 'hall-of-fame',
    repeat: false,
    beforeLine: async (line) => {
      if (line.action.type === 'advance-text') {
        await machineBeat(page);
        await driver.screenshot!('hof-machine');
      }
      if (line.action.type !== 'screenshot') return;
      const name = line.action.name;
      const app = (await page.evaluate(() => window.openSinnohGame!.snapshot().app)) as AppView;
      // The ROM pictures load once per page: wait for the canvas to be drawn with them.
      await expect(page.locator('.ds-scene')).toHaveAttribute('aria-label', app.app === 'credits' ? 'Credits' : 'Hall of Fame', { timeout: 60_000 });
      const least = { 'hof-member': 12, 'hof-group': 30, 'credits-scroll': 4 }[name] ?? 0;
      if (least) await expect.poll(async () => {
        const art = await canvasStats(page, '.ds-scene-canvas');
        // The new beams have many colours by themselves; also wait for the panel behind them.
        return art.colours > least && art.lit > (name === 'hof-group' ? 0.3 : name === 'hof-member' ? 0.05 : 0);
      }, { timeout: 60_000 }).toBe(true);
      if (name.startsWith('credits-') && !['credits-final', 'credits-card'].includes(name)) await expect(page.locator('.ds-scene-canvas')).toHaveAttribute('data-ride-ready', 'true', { timeout: 60_000 });
      const s = await scene(page);
      // One whole-pixel screen, inside the viewport (phones: full width or height), never two DS screens.
      expect(s.stages, name).toBe(1);
      expect(s.stage.x, name).toBeGreaterThanOrEqual(-0.5);
      expect(s.stage.y, name).toBeGreaterThanOrEqual(-0.5);
      expect(s.stage.x + s.stage.w, name).toBeLessThanOrEqual(s.view.w + 0.5);
      expect(s.stage.y + s.stage.h, name).toBeLessThanOrEqual(s.view.h + 0.5);
      expect(Math.max(s.stage.w / s.view.w, s.stage.h / s.view.h), name).toBeGreaterThan(info.project.name === 'phone' ? 0.85 : 0.5);
      if (name === 'hof-member') {
        expect(app).toMatchObject({ app: 'hall-of-fame', mode: 'record' });
        // The ROM panel and the Pokémon's picture over black, and its first text row.
        expect(s.colours, name).toBeGreaterThan(12);
        expect(s.lit, name).toBeGreaterThan(0.05);
        expect(s.rows, name).toBeGreaterThan(0);
        const motion = await motionPixels(page, false);
        expect(motion.changed).toBeGreaterThan(100);
        expect(motion.outside).toBe(0);
      } else if (name === 'hof-group') {
        expect(app).toMatchObject({ app: 'hall-of-fame', mode: 'record', waiting: true });
        expect(s.colours, name).toBeGreaterThan(30);
        expect(s.lit, name).toBeGreaterThan(0.3);
        expect(s.rows, name).toBe(2);
      } else if (name === 'credits-scroll') {
        expect(app).toMatchObject({ app: 'credits', scene: 'morning' });
        expect(s.colours, name).toBeGreaterThan(4);
        expect(s.rows, name).toBeGreaterThan(0);
        expect((await motionPixels(page, true)).changed).toBeGreaterThan(100);
      } else if (name === 'credits-day' || name === 'credits-night' || name === 'credits-stars') {
        expect(app).toMatchObject({ app: 'credits', scene: name === 'credits-day' ? 'day' : 'night' });
        expect(s.colours).toBeGreaterThan(30);
        expect((await motionPixels(page, true)).changed).toBeGreaterThan(100);
      } else if (name === 'credits-final') {
        expect(app).toMatchObject({ app: 'credits', scene: 'final' });
        expect(s.rows, name).toBe(1);
      } else if (name === 'credits-card') {
        expect(app).toMatchObject({ app: 'credits', scene: 'card' });
        // The card's disclaimer in the game's language (its first line's last sentence).
        expect(s.card, name).toContain(OPENSINNOH_CARD[gameLanguage(registries)]!.lines[0]!.split('. ').at(-1)!);
        // The brand's wordmark, 174 DS px wide at the scene's scale.
        expect(s.mark / s.stage.w, name).toBeCloseTo(174 / 256, 2);
      }
      seen.push(name);
    },
  });
  expect(result.error, errors.join('\n')).toBeUndefined();
  expect(seen).toEqual(['hof-member', 'hof-group', 'credits-scroll', 'credits-day', 'credits-night', 'credits-stars', 'credits-final', 'credits-card']);
  expect(errors).toEqual([]);
});
