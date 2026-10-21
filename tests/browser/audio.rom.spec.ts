/**
 * Audio on the real ROM (OPENSINNOH_NDS_ROM; skipped without it): a key press unlocks the AudioContext,
 * entering Twinleaf Town plays its BGM through the AudioWorklet synth (the RMS after the synth is not
 * silence), and Route 201 plays its own; the worklet reports no errors.
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { seedRomImport } from './seed.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;

test.describe.configure({ mode: 'parallel' });
test.skip(!ROM, 'OPENSINNOH_NDS_ROM is not set');

let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }, info) => {
  test.setTimeout(180_000);
  const use = info.project.use;
  context = await browser.newContext({ baseURL: use.baseURL, viewport: use.viewport, hasTouch: use.hasTouch, isMobile: use.isMobile, deviceScaleFactor: use.deviceScaleFactor });
  page = await context.newPage();
  await seedRomImport(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
});

test.beforeEach(async () => {
  await page.evaluate(() => window.openSinnohGame!.reset(1));
});

test.afterAll(async () => {
  await context?.close();
});

/** Loads a save of the current game with the player moved to `zone` (x, z), as if the map had been entered. */
async function enter(zone: string, x: number, z: number): Promise<void> {
  await page.evaluate(
    ({ zone, x, z }) => {
      const g = window.openSinnohGame!;
      for (let i = 0; i < 300 && !window.openSinnohApp!.game.canSave(); i++) g.advance(1);
      const env = JSON.parse(g.save()) as { state: { player: object; objects: unknown[]; follower: unknown } };
      env.state.player = { zone, x, z, y: 0, facing: 'down' };
      env.state.objects = [];
      env.state.follower = null;
      g.load(JSON.stringify(env), 'arrival');
      g.advance(2);
    },
    { zone, x, z },
  );
}

/** The loudest RMS the analyser sees over about a second of output. */
async function loudness(): Promise<number> {
  return page.evaluate(async () => {
    const analyser = window.openSinnohApp!.audio.analyser;
    const buf = new Float32Array(analyser.fftSize);
    let best = 0;
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 40));
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      best = Math.max(best, Math.sqrt(sum / buf.length));
    }
    return best;
  });
}

test('Twinleaf Town and Route 201 play their BGM through the worklet', async () => {
  test.setTimeout(240_000);
  // A key press is the user gesture that resumes the context (iOS and autoplay policies).
  await page.keyboard.press('Shift');
  await page.waitForFunction(() => window.openSinnohApp!.audio.context.state === 'running', undefined, { timeout: 10_000 });
  // Play through the bedroom opening until the field is idle (A on messages, YES on questions).
  const idle = await page.evaluate(() => {
    const g = window.openSinnohGame!;
    let calm = 0;
    for (let i = 0; i < 6000 && calm < 60; i++) {
      const s = g.snapshot();
      calm = !s.scriptRunning && window.openSinnohApp!.game.canSave() ? calm + 1 : 0;
      if (s.view.message?.waitingForInput || s.view.yesNo) {
        g.press('a');
        g.advance(1);
        g.release('a');
      }
      g.advance(1);
    }
    return calm >= 60;
  });
  expect(idle).toBe(true);

  await enter('platinum:MAP_HEADER_TWINLEAF_TOWN', 116, 886);
  expect(await page.evaluate(() => window.openSinnohApp!.game.sound.currentBgm())).toBe('platinum:SEQ_TOWN01_D');
  await expect.poll(() => loudness(), { timeout: 20_000 }).toBeGreaterThan(0.01);
  // Status messages can lag the first audible worklet output. Require the same active-channel
  // condition once it has been reported, rather than reading the initial zero-channel status.
  let twinleaf = await page.evaluate(() => window.openSinnohApp!.audio.status());
  await expect.poll(async () => {
    twinleaf = await page.evaluate(() => window.openSinnohApp!.audio.status());
    return twinleaf.channels;
  }, { timeout: 20_000 }).toBeGreaterThan(0);
  expect(twinleaf.handles).toEqual(['field-bgm']);
  expect(twinleaf.channels).toBeGreaterThan(0);

  await enter('platinum:MAP_HEADER_ROUTE_201', 116, 853);
  expect(await page.evaluate(() => window.openSinnohApp!.game.sound.currentBgm())).toBe('platinum:SEQ_ROAD_A_D');
  await expect.poll(() => loudness(), { timeout: 20_000 }).toBeGreaterThan(0.01);

  // Muted in the options: the analyser (after the volume) hears nothing.
  await page.evaluate(() => window.openSinnohApp!.audio.setSettings({ volume: 80, muted: true }));
  // The gain change lands a few render quanta later; wait for it rather than sampling once.
  await expect.poll(() => loudness(), { timeout: 5_000 }).toBe(0);
  await page.evaluate(() => window.openSinnohApp!.audio.setSettings({ volume: 80, muted: false }));
  expect(await page.evaluate(() => window.openSinnohApp!.audio.errors)).toEqual([]);
});

test('native field and menu cues reach the shared audio output once on their simulation tick', async () => {
  await page.evaluate(async () => {
    const game = window.openSinnohApp!.game;
    const state = structuredClone(game.state);
    state.player = { zone: 'platinum:MAP_HEADER_JUBILIFE_CITY_POKECENTER_1F', x: 8, z: 6, y: 0, facing: 'up' };
    state.objects = [];
    state.follower = null;
    await window.openSinnohGame!.load(JSON.stringify({ format: 'lantern-nds-save', version: 1, savedAt: '2026-01-01T00:00:00.000Z', state }), 'arrival');
    window.openSinnohGame!.until({ kind: 'idle' }, 600);
  });
  expect(await page.evaluate(() => window.openSinnohApp!.game.canSave())).toBe(true);
  const heard = await page.evaluate(() => {
    const app = window.openSinnohApp!;
    const game = app.game;
    const bridge = window.openSinnohGame!;
    const output = game.sound.output!;
    const commands: { tick: number; source: number }[] = [];
    game.sound.output = { send(command) {
      if (command.op === 'start') commands.push({ tick: game.state.tick, source: game.registries.sequences.get(command.seq)!.sourceIndex! });
      output.send(command);
    } };
    const start = game.state.tick;
    const press = (b: 'x' | 'down' | 'b') => { bridge.press(b); bridge.advance(1); bridge.release(b); bridge.advance(1); };
    try {
      game.world.destroyObstacle(0);
      bridge.advance(1);
      press('x');
      press('down');
      press('b');
      return commands.map(({ tick, source }) => [tick - start, source]);
    } finally {
      game.sound.output = output;
    }
  });
  expect(heard).toEqual([[0, 1611], [1, 1533], [3, 1504], [5, 1500]]);
  expect(await page.evaluate(() => window.openSinnohApp!.audio.errors)).toEqual([]);
});
