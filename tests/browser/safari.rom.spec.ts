/**
 * The Safari battle's screens on the real ROM (OPENSINNOH_NDS_ROM; skipped without it), on desktop and phone: a Safari
 * Game started at the Pastoria gate (headless, `parts/safari-enter.replay`), its save loaded into the app, and a Safari
 * battle against a Wooper. The command card shows BALL, BAIT, MUD and RUN on the ROM's buttons, fitting with nothing
 * overflowing; the scene draws the Safari healthbox and no player Pokémon; tapping BAIT throws bait and the battle goes
 * on (or the Wooper runs off); BALL throws a Safari Ball, one fewer left. No ROM image goldens.
 */
import { expect, test } from '@playwright/test';
import { CountingStubLog, createGame, gameDriver, runReplay, saveToJson } from '@opensinnoh/game';
import { createWorld } from '@opensinnoh/world';
import { createScriptRunner } from '@opensinnoh/vm';
import { createBattle } from '@opensinnoh/battle';
import type { BattleView } from '@opensinnoh/contracts';
import { romSlice } from '../rom.ts';
import { readReplay, resolveReplay } from '../rom-replays/sys-replays.ts';
import { seedRomImport } from './seed.ts';
import { battleSceneStats } from './canvas.ts';
import { CardStrings } from '../../packages/app/src/battle/strings.ts';

test.skip(!process.env.OPENSINNOH_NDS_ROM, 'OPENSINNOH_NDS_ROM is not set');

test('a Safari battle: the Safari healthbox and BALL / BAIT / MUD / RUN on the card', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop' && info.project.name !== 'phone', 'desktop and phone');
  test.setTimeout(600_000);
  const game = createGame({ packs: [romSlice().pack], createWorld, createScriptRunner, createBattle, seed: 1, log: new CountingStubLog(() => {}), now: () => '2009-03-22T12:00:00Z' });
  const setup = await runReplay(gameDriver(game), readReplay('parts/safari-enter.replay'), { name: 'parts/safari-enter.replay', registries: game.registries, resolve: resolveReplay, repeat: false });
  expect(setup.error).toBeUndefined();
  for (let i = 0; i < 600 && !game.canSave(); i++) game.tick();
  const save = saveToJson(game.save());

  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await seedRomImport(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true);
  await page.evaluate(() => window.openSinnohApp!.game.loadBattleEngine());
  await page.evaluate((json) => window.openSinnohGame!.load(json), save);
  const command = () =>
    page.evaluate(() => {
      const g = window.openSinnohGame!;
      let ticks = 0;
      const game = window.openSinnohApp!.game;
      // A tap's answer is taken on the next tick: the prompt shown is the old one until then.
      g.advance(1);
      for (; ticks < 3000 && game.inBattle() && g.battleView()?.prompt?.kind !== 'command'; ticks++) g.advance(1);
      return g.battleView();
    }) as Promise<BattleView | null>;
  await page.evaluate(() => window.openSinnohApp!.game.world.startBattle({ kind: 'safari', trainers: [], wild: [{ species: 'platinum:SPECIES_WOOPER', level: 27 }], safariBalls: 30 }));
  const view = await command();
  expect(view?.kind).toBe('safari');
  expect(view?.safari).toEqual({ balls: 30, healthbox: { visible: true, dx: 0 } });
  expect(view?.battlers.find((b) => b.side === 'player')?.visible).toBe(false);
  await page.waitForFunction(() => window.openSinnohApp?.sceneLoading() === false, undefined, { timeout: 120_000 });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

  const card = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.battle-card')!;
    const buttons = [...el.querySelectorAll<HTMLElement>('.bc-button')];
    return {
      hidden: el.hidden,
      labels: buttons.map((b) => b.querySelector('.sr-only')?.textContent ?? ''),
      art: buttons.filter((b) => !getComputedStyle(b).borderImageSource.startsWith('url(')).map((b) => b.className),
      overflow: [el, ...el.querySelectorAll<HTMLElement>('*')]
        .filter((e) => !e.classList.contains('sr-only') && getComputedStyle(e).display !== 'inline' && (e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1))
        .map((e) => e.className),
    };
  });
  expect(card.hidden).toBe(false);
  const words = new CardStrings(game.registries);
  expect(card.labels).toEqual([words.t('battleBall'), words.t('battleBait'), words.t('battleRun'), words.t('battleMud')]);
  expect(card.art).toEqual([]);
  expect(card.overflow).toEqual([]);
  const pixels = await battleSceneStats(page);
  expect(pixels.colours).toBeGreaterThan(32);
  await page.screenshot({ path: `test-artifacts/safari/${info.project.name}-command.png` });

  // BAIT by tap: the bait flies, then the battle asks again, or the Wooper ran off.
  await page.locator('.battle-card .bc-bag').click();
  const after = await command();
  if (after) {
    expect(after.safari!.balls).toBe(30);
    // BALL: one Safari Ball thrown.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.locator('.battle-card .bc-fight').click();
    const thrown = await page.evaluate(() => {
      const g = window.openSinnohGame!;
      for (let i = 0; i < 200 && g.battleView()?.safari?.balls === 30; i++) g.advance(1);
      return g.battleView()?.safari?.balls;
    });
    expect(thrown).toBe(29);
  }
  expect(errors).toEqual([]);
});

test('the binoculars draw a marsh Pokémon in the iris; the quick tram is drawn on its rail', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'desktop');
  test.setTimeout(600_000);
  const game = createGame({ packs: [romSlice().pack], createWorld, createScriptRunner, createBattle, seed: 1, log: new CountingStubLog(() => {}), now: () => '2009-03-22T12:00:00Z' });
  const setup = await runReplay(gameDriver(game), readReplay('parts/safari-enter.replay'), { name: 'parts/safari-enter.replay', registries: game.registries, resolve: resolveReplay, repeat: false });
  expect(setup.error).toBeUndefined();
  for (let i = 0; i < 600 && !game.canSave(); i++) game.tick();
  const marsh = saveToJson(game.save());
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await seedRomImport(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true);
  await page.evaluate((json) => window.openSinnohGame!.load(json), marsh);
  const frame = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  // The tram, called from areas 1 and 2 to area 6's station: drawn on its rail as it comes in.
  await page.evaluate(() => {
    const app = window.openSinnohApp!.game;
    app.state.mapFeatures = { kind: 'great-marsh', tram: 0 };
    window.openSinnohGame!.load(JSON.stringify({ format: 'lantern-nds-save', version: 1, savedAt: 'test', state: app.state }));
    app.world.moveGreatMarshTram(2, 'call');
    window.openSinnohGame!.advance(200);
  });
  await page.waitForFunction(() => window.openSinnohApp?.sceneLoading() === false, undefined, { timeout: 120_000 });
  await frame();
  const tram = await page.evaluate(() => window.openSinnohApp!.game.world.view().features?.models.find((m) => m.key === 'great-marsh-tram'));
  expect(tram?.position[0]).toBe(1056);
  await page.screenshot({ path: `test-artifacts/safari/${info.project.name}-tram.png` });
  // The binoculars: a view of the marsh with its Pokémon, the iris open.
  await page.evaluate(() => {
    window.openSinnohGame!.advance(100);
    window.openSinnohApp!.game.world.greatMarshLookout();
    window.openSinnohGame!.advance(25);
  });
  await page.waitForFunction(() => window.openSinnohApp?.sceneLoading() === false, undefined, { timeout: 120_000 });
  await frame();
  const look = await page.evaluate(() => window.openSinnohApp!.game.world.lookoutView());
  expect(look?.pokemon).not.toBeNull();
  expect(look?.iris).toBe(1);
  await page.screenshot({ path: `test-artifacts/safari/${info.project.name}-binoculars.png` });
  expect(errors).toEqual([]);
});
