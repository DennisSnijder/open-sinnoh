/**
 * Systems in the app on the real ROM (OPENSINNOH_NDS_ROM; desktop only):
 * every sys-* replay that is not pending runs through `window.openSinnohGame` with a pixel check at each
 * screenshot line (the parts' too), and the visual beats (weather, fog, the dark-map circle, the surf blob)
 * are compared against the same spot without the effect. Each system's key beat (KEY_BEATS: the obstacle
 * gone, the boulder moved, the view up the waterfall or down the ice, the bike higher mid-jump and on the
 * bridge, the elevator door and lights, the disguise, footprints, Flash) is checked by pixels against the
 * same frame without that thing in the view, or against the frame of an earlier beat. A BTA0 and a BTP0
 * prop loop are checked across ticks against their own held first frame. A pending visual check (tests/rom-replays/sys-replays.ts) is
 * skipped while its frames do not differ, and fails once they do, so it cannot stay pending silently.
 * Screenshots go to test-artifacts/sys (gitignored: ROM content, never commit).
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { GameSnapshot, GameState, Registries } from '@opensinnoh/contracts';
import { loadGamePacks, runReplay, type ReplayDriver } from '@opensinnoh/game';
import { mainCanvasStats, pageDriver } from '../../packages/cli/src/browser.ts';
import { romSlice } from '../rom.ts';
import { romContext, resetRomDevice } from './rom-context.ts';
import { fromChainAnchor } from './replay-anchor.ts';
import { NEEDS, SYS_REPLAYS, VISUAL_CHECKS, readReplay, resolveReplay, type VisualCheck } from '../rom-replays/sys-replays.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;
const SHOTS = 'test-artifacts/sys';

test.describe.configure({ mode: 'parallel' });
test.skip(!ROM, 'OPENSINNOH_NDS_ROM is not set');
test.skip(({ isMobile }) => isMobile, 'systems run on desktop');

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
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  // The import itself is platinum.rom.spec.ts's; here the browser starts with it. Replay mode skips the title.
  await resetRomDevice(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
});

test.beforeEach(async () => {
  errors.length = 0;
  beatFrames.clear();
  litShares.clear();
  checked.clear();
  await page.evaluate(() => window.openSinnohGame!.reset(1));
});

test.afterAll(async () => {
  await page?.close();
});

const snapshot = async (): Promise<GameSnapshot> => JSON.parse(await page.evaluate(() => JSON.stringify(window.openSinnohGame!.snapshot()))) as GameSnapshot;

test('import the ROM', async () => {
  test.setTimeout(420_000);
  expect(await page.evaluate(() => window.openSinnohGame!.ready)).toBe(true);
  expect(await page.locator('#picker').isVisible()).toBe(false);
});

for (const r of SYS_REPLAYS) {
  const waits = (r.pending ?? []).map((k) => `${NEEDS[k].area}: ${NEEDS[k].what}`);
  test(`${r.file} in the app, with a visible scene at each screenshot line`, async () => {
    test.skip(waits.length > 0, `pending: ${waits.join('; ')}`);
    test.setTimeout(900_000);
    const project = test.info().project.name;
    const base = pageDriver(page, SHOTS, `${project}-${r.file.replace('.replay', '')}`);
    const driver: ReplayDriver = {
      ...base,
      // The field replays' wild encounters flee without a battle (the wild-encounter stub, as in CP1–4); a reset restores battles.
      async reset(seed) {
        await base.reset(seed);
        await base.setWildBattles('flee');
      },
      async screenshot(name) {
        const path = await base.screenshot!(name);
        const stats = await mainCanvasStats(page);
        expect(stats.colours, `${name}: colours`).toBeGreaterThan(8);
        // The dark map before Flash: only the circle around the player is lit.
        if (name === 'dark') {
          expect(stats.litShare, `${name}: lit share`).toBeGreaterThan(0.01);
          expect(stats.litShare, `${name}: lit share`).toBeLessThan(0.3);
        } else if (!name.startsWith('hearthome-')) expect(stats.litShare, `${name}: lit share`).toBeGreaterThan(0.1);
        litShares.set(name, stats.litShare);
        const beat = KEY_BEATS[name];
        if (beat) {
          const detail = await beat();
          console.log(`key beat ${name}: ${detail}`);
          checked.add(name);
        }
        return path;
      },
    };
    const replay = r.file === 'sys-rock-smash.replay' ? await fromChainAnchor(driver, r.file) : { driver, text: readReplay(r.file) };
    const wild = r.wild && r.wild !== 'record' ? `\n+0 assert battles wild ${r.wild[0]}\n` : '';
    const result = await runReplay(replay.driver, replay.text + wild, { registries, seed: 1, name: r.file, resolve: resolveReplay, repeat: false, chainedScreenshots: /^parts\// });
    expect(result.error).toBeUndefined();
    for (const b of BEATS_OF[r.file] ?? []) expect(checked.has(b), `key beat ${b} ran`).toBe(true);
    expect(errors).toEqual([]);
  });
}

/** The same luminance samples, after a completed, fully loaded draw of the current view. */
async function frame(w = 128, h = 72): Promise<number[]> {
  return page.evaluate(async ([w, h]) => {
    const frames = () => (globalThis as unknown as { openSinnohRenderStats: { frames: number } }).openSinnohRenderStats.frames;
    let readyFrame: number | undefined;
    const deadline = performance.now() + 30_000;
    // Cached models may resolve after a draw. Observe readiness after one completed render,
    // then capture a later render: that draw includes the assets that just became ready.
    for (;;) {
      await new Promise(requestAnimationFrame);
      if (performance.now() >= deadline) throw new Error('no fully loaded field frame within 30 s');
      if (window.openSinnohApp!.sceneLoading()) readyFrame = undefined;
      else if (readyFrame === undefined) readyFrame = frames();
      else if (frames() !== readyFrame) break;
    }
    const src = document.getElementById('main-canvas') as HTMLCanvasElement;
    const copy = document.createElement('canvas');
    copy.width = w;
    copy.height = h;
    const g = copy.getContext('2d')!;
    g.drawImage(src, 0, 0, w, h);
    const px = g.getImageData(0, 0, w, h).data;
    const out: number[] = [];
    for (let i = 0; i < px.length; i += 4) out.push(Math.round(0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!));
    return out;
  }, [w, h] as const);
}

const meanDiff = (a: number[], b: number[]) => a.reduce((s, v, i) => s + Math.abs(v - b[i]!), 0) / a.length;
const contrast = (a: number[]) => {
  const m = a.reduce((s, v) => s + v, 0) / a.length;
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length);
};
const darkShare = (a: number[]) => a.filter((v) => v < 16).length / a.length;
/** The 24×24 samples around the screen centre (the player) of a 128×72 frame. */
const centre = (a: number[]) => a.filter((_, i) => Math.abs((i % 128) - 64) < 12 && Math.abs(Math.floor(i / 128) - 36) < 12);
/** The samples of a 128×72 frame within ±hw, ±hh of (cx, cy). */
const region = (cx: number, cy: number, hw: number, hh: number) => (a: number[]) => a.filter((_, i) => Math.abs((i % 128) - cx) < hw && Math.abs(Math.floor(i / 128) - cy) < hh);
const whole = (a: number[]) => a;

/** What a frame leaves out of the world's view (no tick passes): actors by local id, effects by id, doors, the elevator lights. */
interface Hide {
  actors?: number[];
  effects?: RegExp;
  doors?: boolean;
  elevatorLights?: boolean;
  /** The map feature's models and fog (`FieldView.features`). */
  features?: boolean;
  /** Only the feature's lights (Hearthome Gym's beams: `features.models[].light`). */
  featureLights?: boolean;
}

/** A frame with parts of the view left out (the world's view patched for one frame, as the surf-blob check does). */
async function frameWithout(hide: Hide, w = 128, h = 72): Promise<number[]> {
  await page.evaluate(
    ([actors, effects, doors, lights, features, beams]) => {
      type V = { actors: { localId: number; visible: boolean }[]; effects: { effect: string }[]; doors?: unknown; elevatorLights?: unknown; features?: { models: { light?: boolean }[] } };
      const world = window.openSinnohApp!.game.world as unknown as { view(): V };
      const view = world.view.bind(world);
      world.view = () => {
        const v = view();
        return {
          ...v,
          actors: v.actors.map((a) => (actors.includes(a.localId) ? { ...a, visible: false } : a)),
          effects: effects === null ? v.effects : v.effects.filter((e) => !new RegExp(effects).test(e.effect)),
          doors: doors ? undefined : v.doors,
          elevatorLights: lights ? undefined : v.elevatorLights,
          features: features ? undefined : beams && v.features ? { ...v.features, models: v.features.models.filter((m) => !m.light) } : v.features,
        };
      };
    },
    [hide.actors ?? [], hide.effects?.source ?? null, !!hide.doors, !!hide.elevatorLights, !!hide.features, !!hide.featureLights] as const,
  );
  const f = await frame(w, h);
  await page.evaluate(() => void delete (window.openSinnohApp!.game.world as unknown as { view?: unknown }).view);
  return f;
}

/** The render-time noise of a region: two frames of the same tick (mean difference). */
async function noiseOf(pick: (a: number[]) => number[]): Promise<number> {
  return meanDiff(pick(await frame()), pick(await frame()));
}

/** Samples whose luminance differs by more than `level` (a small sprite changes few samples, but by a lot). */
const changedCount = (a: number[], b: number[], level = 8) => a.filter((v, i) => Math.abs(v - b[i]!) > level).length;
/** The same-tick noise of a region, in changed samples. */
async function changedNoise(pick: (a: number[]) => number[], level = 8): Promise<number> {
  return changedCount(pick(await frame()), pick(await frame()), level);
}

const PLAYER = 255;
/** Frames (or measures) kept at earlier beats, by screenshot name. */
const beatFrames = new Map<string, { frame: number[]; without?: number[] }>();
const litShares = new Map<string, number>();
/** Key beats that ran (each replay's must: BEATS_OF). */
const checked = new Set<string>();

/**
 * `hide` is drawn: leaving it out of the view changes more samples of the region (of 128×72) than the
 * same-tick noise plus `margin`.
 */
async function expectDrawn(what: string, hide: Hide, pick: (a: number[]) => number[], margin = 8, level = 8): Promise<{ shown: number[]; without: number[]; count: number; detail: string }> {
  const shown = await frame();
  const without = await frameWithout(hide);
  const noise = await changedNoise(pick, level);
  const count = changedCount(pick(shown), pick(without), level);
  const detail = `${what}: ${count} samples changed (noise ${noise} + ${margin})`;
  expect(count, detail).toBeGreaterThan(noise + margin);
  return { shown, without, count, detail };
}

/**
 * An obstacle (local id) is drawn before; afterwards the frame looks like the before frame without it.
 * The player, who stands in front of it and covers most of it, is left out of these frames.
 */
const obstacleBefore = (name: string, localId: number) => async () => {
  const shown = await frameWithout({ actors: [PLAYER] });
  const without = await frameWithout({ actors: [PLAYER, localId] });
  const noise = await changedNoise(centre);
  const count = changedCount(centre(shown), centre(without));
  const detail = `obstacle ${localId} drawn: ${count} samples changed (noise ${noise} + 8)`;
  expect(count, detail).toBeGreaterThan(noise + 8);
  beatFrames.set(name, { frame: shown, without });
  return detail;
};
const obstacleGone = (before: string) => async () => {
  const b = beatFrames.get(before);
  if (!b?.without) throw new Error(`key beat ${before} did not run first`);
  const after = await frameWithout({ actors: [PLAYER] });
  const noise = await changedNoise(centre);
  const vsShown = changedCount(centre(after), centre(b.frame));
  const vsWithout = changedCount(centre(after), centre(b.without));
  const detail = `changed samples against the frame with it ${vsShown}, without it ${vsWithout} (noise ${noise})`;
  expect(vsShown, detail).toBeGreaterThan(noise + 8);
  expect(vsWithout, detail).toBeLessThan(vsShown / 2);
  return detail;
};
/** The view moved since `before` (the whole frame differs) and the player is drawn now. */
const movedFrom = (before: string, hide: Hide) => async () => {
  const b = beatFrames.get(before);
  if (!b) throw new Error(`key beat ${before} did not run first`);
  const { shown, detail } = await expectDrawn('player drawn', hide, centre);
  const noise = await noiseOf(whole);
  const moved = meanDiff(shown, b.frame);
  expect(moved, `view moved: ${moved.toFixed(2)} (noise ${noise.toFixed(2)} + 3)`).toBeGreaterThan(noise + 3);
  return `${detail}; view moved ${moved.toFixed(2)} (noise ${noise.toFixed(2)})`;
};
const keep = (name: string) => async () => {
  beatFrames.set(name, { frame: await frame() });
  return 'kept';
};

/** The top row (of 144) of what the player draws: where hiding the player changes a 256×144 frame. */
async function playerTop(): Promise<number> {
  const shown = await frame(256, 144);
  const without = await frameWithout({ actors: [PLAYER] }, 256, 144);
  const rows = shown.flatMap((v, i) => (Math.abs(v - without[i]!) > 24 && Math.abs((i % 256) - 128) < 40 ? [Math.floor(i / 256)] : []));
  if (!rows.length) throw new Error('the player draws nothing');
  return Math.min(...rows);
}

const STRENGTH = region(52, 36, 20, 12);

const KEY_BEATS: Record<string, () => Promise<string>> = {
  'cut-before': obstacleBefore('cut-before', 8),
  'cut-after': obstacleGone('cut-before'),
  'smash-before': obstacleBefore('smash-before', 5),
  'smash-after': obstacleGone('smash-before'),
  // The boulder (local id 3) one tile west of the player, then two: drawn at both, and its pixels moved.
  'strength-before': async () => {
    const { shown, detail } = await expectDrawn('boulder drawn', { actors: [3] }, STRENGTH);
    beatFrames.set('strength-before', { frame: shown });
    return detail;
  },
  'strength-after': async () => {
    const { shown, detail } = await expectDrawn('boulder drawn', { actors: [3] }, STRENGTH);
    const before = beatFrames.get('strength-before')!.frame;
    const noise = await changedNoise(STRENGTH);
    const moved = changedCount(STRENGTH(shown), STRENGTH(before));
    expect(moved, `boulder moved: ${moved} samples changed (noise ${noise} + 8)`).toBeGreaterThan(noise + 8);
    return `${detail}; moved: ${moved} samples changed`;
  },
  'waterfall-bottom': keep('waterfall-bottom'),
  'waterfall-top': movedFrom('waterfall-bottom', { actors: [PLAYER], effects: /SURF/ }),
  'ice-start': keep('ice-start'),
  'ice-stop': movedFrom('ice-start', { actors: [PLAYER] }),
  // Mid-jump off the ramp the player is drawn higher on screen than after landing.
  'bike-jump': async () => {
    const top = await playerTop();
    beatFrames.set('bike-jump', { frame: [top] });
    return `player top row ${top}`;
  },
  'bike-landed': async () => {
    const jump = beatFrames.get('bike-jump')!.frame[0]!;
    const top = await playerTop();
    expect(jump, `mid-jump top row ${jump} above the landed one ${top}`).toBeLessThan(top - 1);
    return `top row mid-jump ${jump}, landed ${top}`;
  },
  // On the bike bridge over open ground the player rides on the bridge layer: drawn, not under the deck.
  'bike-bridge': async () => (await expectDrawn('player on the bridge', { actors: [PLAYER] }, centre, 20)).detail,
  'elevator-door': async () => (await expectDrawn('door open (BTP0 pattern)', { doors: true }, region(64, 30, 16, 14))).detail,
  'elevator-ride': async () => (await expectDrawn('elevator lights (BTA0 scroll)', { elevatorLights: true }, whole)).detail,
  // Ninja Boy Davido (local id 4) is hidden under the rock disguise, then drawn once revealed.
  'disguise-hidden': async () => {
    const hidden = changedCount(centre(await frame()), centre(await frameWithout({ actors: [4] })));
    beatFrames.set('disguise-hidden', { frame: [hidden] });
    return `drawn under the rock: ${hidden} samples`;
  },
  'disguise-revealed': async () => {
    const hidden = beatFrames.get('disguise-hidden')!.frame[0]!;
    const { detail } = await expectDrawn('revealed', { actors: [4] }, centre, hidden + 8);
    return `${detail} (hidden: ${hidden})`;
  },
  // Faint grey marks on white snow under the heavy-snow fog: counted at a lower luminance step.
  footprints: async () => (await expectDrawn('snow tracks', { effects: /FOOTPRINT|TRACK/ }, centre, 4, 1)).detail,
  // Gyms: Eterna's clock hands (props the feature places), Veilstone's bags and tyre stacks (field
  // effects) before and after a kick that toppled a stack, Hearthome's fog (the feature's, darker than none).
  'eterna-clock': async () => (await expectDrawn('clock hands', { features: true }, whole)).detail,
  'veilstone-before': async () => {
    const { shown, detail } = await expectDrawn('bags and stacks', { effects: /VEILSTONE_GYM/ }, whole);
    beatFrames.set('veilstone-before', { frame: shown });
    return detail;
  },
  'veilstone-kicked': async () => {
    const { detail } = await expectDrawn('bags and stacks', { effects: /VEILSTONE_GYM/ }, whole);
    const effects = await page.evaluate(() => window.openSinnohApp!.game.world.view().effects.map((e) => e.effect));
    expect(effects.filter((e) => /VEILSTONE_GYM_TIRE_STACK$/.test(e)).length, 'one stack toppled').toBe(10);
    return detail;
  },
  'hearthome-dark': async () => {
    const fogged = await frame();
    const clear = await frameWithout({ features: true });
    const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    const noise = await noiseOf(whole);
    // The player's beam (facing north) lights the floor ahead: unfogged under the beam, brighter than without it.
    const ahead = region(64, 26, 8, 10);
    const unlit = ahead(await frameWithout({ featureLights: true }));
    const lit = ahead(fogged);
    const aheadNoise = await noiseOf(ahead);
    const detail = `mean luminance with the gym fog ${mean(fogged).toFixed(1)}, without ${mean(clear).toFixed(1)} (noise ${noise.toFixed(2)}); ahead of the player with the beam ${mean(lit).toFixed(1)}, without ${mean(unlit).toFixed(1)} (noise ${aheadNoise.toFixed(2)})`;
    expect(mean(clear) - mean(fogged), detail).toBeGreaterThan(noise + 3);
    expect(mean(lit) - mean(unlit), detail).toBeGreaterThan(aheadNoise + 3);
    return detail;
  },
  // Flash widens the lit circle: far more of the frame is lit than in the dark (0.048 vs 0.385 measured).
  flash: async () => {
    const dark = litShares.get('dark')!;
    const flash = litShares.get('flash')!;
    expect(flash, `lit share with Flash ${flash.toFixed(3)} vs dark ${dark.toFixed(3)}`).toBeGreaterThan(Math.max(dark * 3, dark + 0.2));
    return `lit share ${flash.toFixed(3)} vs dark ${dark.toFixed(3)}`;
  },
};

/** The key beats each replay must reach (a beat that did not run fails its replay). */
const BEATS_OF: Record<string, string[]> = {
  'sys-cut.replay': ['cut-before', 'cut-after'],
  'sys-rock-smash.replay': ['smash-before', 'smash-after'],
  'sys-strength.replay': ['strength-before', 'strength-after'],
  'sys-waterfall.replay': ['waterfall-bottom', 'waterfall-top'],
  'sys-ice.replay': ['ice-start', 'ice-stop'],
  'sys-bike.replay': ['bike-jump', 'bike-landed', 'bike-bridge'],
  'sys-elevator.replay': ['elevator-door', 'elevator-ride'],
  'sys-movement.replay': ['disguise-hidden', 'disguise-revealed'],
  'sys-mud-snow.replay': ['footprints'],
  'sys-flash.replay': ['flash'],
  'sys-gym-eterna.replay': ['eterna-clock'],
  'sys-gym-veilstone.replay': ['veilstone-before', 'veilstone-kicked'],
  'sys-gym-hearthome.replay': ['hearthome-dark'],
};

/**
 * Loads the spot (a map change: header weather, walking), lets the fade-in finish, then applies the edit
 * the way scripts do (FieldHost setWeather / setPlayerState), and grabs a frame.
 */
async function at(c: VisualCheck, edit: { weather?: string; playerState?: 'surf' | 'walk' }, name: string): Promise<{ frame: number[]; effects: string[]; fldeffStubs: number }> {
  const state: GameState = (await snapshot()).state;
  state.player = { ...state.player, zone: `platinum:MAP_HEADER_${c.zone}` as never, x: c.x, z: c.z, y: 0, facing: c.facing };
  state.objects = [];
  state.follower = null;
  state.playerState = 'walk';
  Object.assign(state.vars, c.story?.vars ?? {});
  Object.assign(state.flags, c.story?.flags ?? {});
  const fldeff0 = await page.evaluate(() => window.openSinnohApp!.game.log.counts.get('render:fldeff') ?? 0);
  await page.evaluate((json) => window.openSinnohGame!.load(json, 'arrival'), JSON.stringify({ format: 'lantern-nds-save', version: 1, savedAt: '1970-01-01T00:00:00.000Z', state }));
  await page.evaluate(() => window.openSinnohGame!.advance(40));
  await page.evaluate(
    ([weather, playerState]) => {
      const world = window.openSinnohApp!.game.world;
      if (weather) world.setWeather(`platinum:${weather}` as never);
      if (playerState) world.setPlayerState(playerState);
      // A weather change on the same map fades (the old one out, the next in: up to 2 × 254 ticks of fog, render/weather.ts).
      window.openSinnohGame!.advance(weather ? 600 : 40);
    },
    [edit.weather ?? null, edit.playerState ?? null] as const,
  );
  const f = await frame();
  await page.screenshot({ path: `${SHOTS}/desktop-visual-${c.name}-${name}.png` });
  const effects = await page.evaluate(() => window.openSinnohApp!.game.world.view().effects.map((e) => e.effect as string));
  const fldeff = await page.evaluate(() => window.openSinnohApp!.game.log.counts.get('render:fldeff') ?? 0);
  return { frame: f, effects, fldeffStubs: fldeff - fldeff0 };
}

for (const c of VISUAL_CHECKS) {
  test(`visual: ${c.name} (${c.zone} ${c.x},${c.z}) is drawn`, async () => {
    test.setTimeout(120_000);
    const on = await at(c, c.with, 'with');
    const off = await at(c, c.without, 'without');
    // Animated textures and props run on render time: the same state loaded again is the noise floor.
    const again = await at(c, c.without, 'without-again');
    const noise = meanDiff(off.frame, again.frame);
    const diff = meanDiff(on.frame, off.frame);
    const differs = diff > noise + 3;
    let drawn: boolean;
    let detail: string;
    if (c.measure === 'weather') {
      drawn = differs;
      detail = `mean difference ${diff.toFixed(2)} (noise ${noise.toFixed(2)} + 3)`;
    } else if (c.measure === 'fog') {
      drawn = differs && contrast(on.frame) < contrast(off.frame);
      detail = `mean difference ${diff.toFixed(2)} (noise ${noise.toFixed(2)} + 3), contrast ${contrast(on.frame).toFixed(1)} < ${contrast(off.frame).toFixed(1)}`;
    } else if (c.measure === 'darkness') {
      drawn = darkShare(on.frame) > darkShare(off.frame) + 0.2;
      detail = `dark share ${darkShare(on.frame).toFixed(2)} vs ${darkShare(off.frame).toFixed(2)} (+0.2)`;
    } else {
      const blob = on.effects.find((e) => /SURF/.test(e));
      // Water animates on render time, so compare the surfing frame with itself minus the blob in the
      // view (no tick passes): consecutive frames are the noise floor.
      await at(c, c.with, 'with-again');
      const a = await frame();
      const b = await frame();
      await page.evaluate(() => {
        const world = window.openSinnohApp!.game.world as unknown as { view(): { effects: { effect: string }[] } };
        const view = world.view.bind(world);
        world.view = () => ({ ...view(), effects: view().effects.filter((e) => !/SURF_BLOB/.test(e.effect)) });
      });
      const without = await frame();
      await page.evaluate(() => void delete (window.openSinnohApp!.game.world as unknown as { view?: unknown }).view);
      const near = meanDiff(centre(b), centre(without));
      const nearNoise = meanDiff(centre(a), centre(b));
      drawn = !!blob && on.fldeffStubs === 0 && near > nearNoise + 1;
      detail = `surf effect ${blob ?? 'none'}, render:fldeff stubs ${on.fldeffStubs}, difference near the player ${near.toFixed(2)} (noise ${nearNoise.toFixed(2)} + 1)`;
    }
    console.log(`visual ${c.name}: ${drawn ? 'drawn' : 'not drawn'}: ${detail}`);
    if (c.pending) {
      expect(drawn, `${c.name} is drawn now (${detail}): drop its pending (${c.pending})`).toBe(false);
      test.skip(true, `pending: ${c.pending} (${detail})`);
    }
    expect(drawn, detail).toBe(true);
    expect(errors).toEqual([]);
  });
}

/**
 * Prop loops (a browser pixel diff across ticks for one BTP0 prop and one BTA0 prop): the
 * Route 210 North waterfall (build model 305, a BTA0 UV scroll) and a Jubilife City sign (build model 12,
 * a BTP0 pattern whose frames last 2–4 ticks, so none is blended). Ticks are stepped one at a time; at each,
 * the frame is compared with the same tick drawn with the prop's texture animations held at their first
 * frame (`openSinnohRenderDebug.heldTextureAnimations`), and with the first tick. The noise floor is two
 * frames of the same frozen state.
 */
const PROP_LOOPS = [
  { name: 'BTA0 scroll: the Route 210 North waterfall', zone: 'ROUTE_210_NORTH', x: 504, z: 532, model: 'platinum:MODEL_BUILD_305', kind: 'scroll' },
  { name: 'BTP0 pattern: a Jubilife City sign', zone: 'JUBILIFE_CITY', x: 143, z: 753, model: 'platinum:MODEL_BUILD_12', kind: 'frames' },
] as const;

/** Samples of a 256×144 frame whose luminance differs by more than 8. */
const changed = (a: number[], b: number[]) => a.filter((v, i) => Math.abs(v - b[i]!) > 8).length;

for (const c of PROP_LOOPS) {
  test(`prop loop, ${c.name}: the frames differ across ticks beyond the frozen noise`, async () => {
    test.setTimeout(180_000);
    const anims = await page.evaluate((m) => {
      const reg = window.openSinnohApp!.game.registries;
      return (reg.models.get(m as never)?.animations ?? []).map((id) => reg.textureAnimations.get(id)!);
    }, c.model);
    expect(anims.length, `${c.model} has texture animations`).toBeGreaterThan(0);
    for (const a of anims) {
      expect(a.kind).toBe(c.kind);
      if (a.kind === 'frames') expect(Math.min(...a.frames.map((f) => f.ticks)), 'every pattern frame lasts 2 ticks or more').toBeGreaterThanOrEqual(2);
    }
    const ticks = Math.min(32, ...anims.map((a) => (a.kind === 'frames' ? a.frames.reduce((n, f) => n + f.ticks, 0) : a.frames)));
    const spot = { name: `loop-${c.model.split('_').pop()}`, zone: c.zone, x: c.x, z: c.z, facing: 'up', with: {}, without: {}, measure: 'weather' } as const;
    await at(spot as VisualCheck, { weather: 'OVERWORLD_WEATHER_CLEAR' }, 'loop');
    const ids = anims.map((a) => a.id as string);
    const noise = changed(await frame(256, 144), await frame(256, 144));
    const first = await frame(256, 144);
    const againstHeld: number[] = [];
    const againstFirst: number[] = [];
    // One page call per tick: advance, sample the next drawn frame, hold the animations, sample the next.
    // Two software-GL frames a tick; assets were checked above and only texture time changes here,
    // so the 31 waterfall ticks fit the timeout on a loaded machine.
    for (let k = 1; k < ticks; k++) {
      const { free, held } = await page.evaluate(
        (h) => {
          const debug = (globalThis as unknown as { openSinnohRenderDebug: { heldTextureAnimations: string[] } }).openSinnohRenderDebug;
          const sample = () =>
            new Promise<number[]>((resolve) =>
              requestAnimationFrame(() => {
                const g = Object.assign(document.createElement('canvas'), { width: 256, height: 144 }).getContext('2d')!;
                g.drawImage(document.getElementById('main-canvas') as HTMLCanvasElement, 0, 0, 256, 144);
                const px = g.getImageData(0, 0, 256, 144).data;
                const out: number[] = [];
                for (let i = 0; i < px.length; i += 4) out.push(Math.round(0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!));
                resolve(out);
              }),
            );
          window.openSinnohGame!.advance(1);
          return sample().then(async (free) => {
            debug.heldTextureAnimations = h;
            const held = await sample();
            debug.heldTextureAnimations = [];
            return { free, held };
          });
        },
        ids,
      );
      againstHeld.push(changed(free, held));
      againstFirst.push(changed(free, first));
    }
    await page.screenshot({ path: `${SHOTS}/desktop-${spot.name}.png` });
    const detail = `noise ${noise}; against the held first frame max ${Math.max(...againstHeld)}; against tick 0 max ${Math.max(...againstFirst)} (samples of 256×144)`;
    console.log(`prop loop ${c.model}: ${detail}`);
    expect(Math.max(...againstHeld), detail).toBeGreaterThan(noise + 20);
    expect(Math.max(...againstFirst), detail).toBeGreaterThan(noise + 20);
    expect(errors).toEqual([]);
  });
}
