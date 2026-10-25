/**
 * Move animations in the app on the real ROM (OPENSINNOH_NDS_ROM; skipped without it): proof moves, each in a wild
 * battle on Route 202 from a Piplup that knows the move. While the animation plays, its particles (or cells, sprite
 * copies, battler changes, BG2) are drawn where the decomp puts them (the defender, the attacker, a fixed spot): the
 * scene with them differs from the same frame without them, most of all around that place. The last nine moves are
 * among them: Surf's wave, Muddy Water's wave layer, Night Shade's shadow, Transform's mosaic, Role Play's copy beside
 * the attacker, and the BG2 pictures of Acid Armor (the attacker), Sketch, Spite and Extrasensory (the defender).
 * A Ball Capsule's seals at the player's send-out are drawn around the player's Pokémon (docs/research/seals.md §6),
 * and so is a shiny lead's sparkle (common animation `shiny`).
 * With OPENSINNOH_ANIM_SHOTS set, frame strips of each animation go there (ROM content, never commit).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { ReplayLine } from '@opensinnoh/core';
import type { BattleView, Registries } from '@opensinnoh/contracts';
import { loadGamePacks, runReplay } from '@opensinnoh/game';
import { romSlice } from '../rom.ts';
import { romContext, resetRomDevice } from './rom-context.ts';
import { pageDriver, waitForScene } from '../../packages/cli/src/browser.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;
const SHOTS = process.env.OPENSINNOH_ANIM_SHOTS;

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
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await resetRomDevice(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
});

// Each replay resets its game; workers share only their own imported pack.
test.beforeEach(() => { errors.length = 0; });

test.afterAll(async () => {
  await page?.close();
});

/**
 * A wild battle on Route 202 (as m2-switch) with Piplup L10 knowing `move` in slot 1; the animation is captured at
 * `screenshot anim`. `opts.wild`: walk until that species appears (a move a Bidoof is immune to); `opts.late`: Growl
 * first, the move on the second turn (a move that fails before the foe has moved); `opts.auto`: the slot the rest of
 * the battle fights with (Transform leaves the foe's moves).
 */
const replay = (move: string, opts: { wild?: string; late?: boolean; auto?: number } = {}) => `party 0 platinum:SPECIES_PIPLUP 10
set state party[0].moves[0] "platinum:${move}"
set state party[0].pp[0] 10
set state party[0].moves[1] "platinum:MOVE_GROWL"
set state party[0].pp[1] 10
set var platinum:VAR_ROUTE_202_STATE 1
warp platinum:MAP_HEADER_ROUTE_202 178 827 up
until idle
${opts.wild ? `until wild platinum:${opts.wild} up down 30000\n` : '+0 press up\n+30 release up\n+0 press down\n+30 release down\n'.repeat(8)}until battle 900
${opts.late ? '+0 battle move 2\nuntil battle 3000\n' : ''}+0 battle move 1
+0 screenshot anim
battle auto ${opts.auto ? `move ${opts.auto} ` : ''}9000
`;

const battleView = () => page.evaluate(() => window.openSinnohGame!.battleView()) as Promise<BattleView | null>;

/**
 * The scene pixels (device px of the scene's rect) and the same frame drawn without the animation's
 * effect layer: the count of changed pixels and their centre in DS px.
 */
async function animationDiff(kind: Kind | 'send-out'): Promise<{ changed: number; x: number; y: number }> {
  return page.evaluate(async (kind) => {
    const app = window.openSinnohApp!;
    const grab = () => {
      const info = app.battleScene();
      const src = document.getElementById('battle-canvas') as HTMLCanvasElement;
      const box = src.getBoundingClientRect();
      const dpr = src.width / box.width;
      const x = Math.round((info.rect.x - box.x) * dpr);
      const y = Math.round((info.rect.y - box.y) * dpr);
      const w = Math.round(info.rect.width * dpr);
      const h = Math.round(info.rect.height * dpr);
      return { px: src.getContext('2d')!.getImageData(x, y, w, h).data, w, k: info.scale };
    };
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await frame();
    const a = grab();
    const battle = app.game.battle as unknown as { view(): BattleView; __view?: () => BattleView };
    battle.__view = battle.view.bind(battle);
    const view = battle.__view;
    battle.view = () => {
      const v = view();
      if (kind === 'send-out') return { ...v, sendOut: [] };
      if (!v.anim) return v;
      if (kind === 'bg') {
        const anim = { ...v.anim, bg: { ...v.anim.bg } };
        delete anim.bgMon;
        delete anim.bg.custom;
        return { ...v, anim };
      }
      if (kind === 'particles') return { ...v, anim: { ...v.anim, particles: [] } };
      if (kind === 'sprites') return { ...v, anim: { ...v.anim, sprites: v.anim.sprites.filter((s) => s.kind !== 'cell') } };
      if (kind === 'copies') return { ...v, anim: { ...v.anim, sprites: v.anim.sprites.filter((s) => s.kind !== 'pokemon') } };
      return { ...v, anim: { ...v.anim, battlers: [] } };
    };
    await frame();
    const b = grab();
    battle.view = battle.__view;
    let changed = 0;
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < a.px.length; i += 4) {
      if (Math.abs(a.px[i]! - b.px[i]!) + Math.abs(a.px[i + 1]! - b.px[i + 1]!) + Math.abs(a.px[i + 2]! - b.px[i + 2]!) < 24) continue;
      changed++;
      sx += (i / 4) % a.w;
      sy += Math.floor(i / 4 / a.w);
    }
    return { changed: changed / (a.k * a.k), x: changed ? sx / changed / a.k : 0, y: changed ? sy / changed / a.k : 0 };
  }, kind);
}

/** Appends the scene as drawn (DS size) to a strip of frames, 8 a row. */
async function stripFrame(strip: { frames: number }): Promise<void> {
  await page.evaluate((n) => {
    const app = window.openSinnohApp!;
    const info = app.battleScene();
    const src = document.getElementById('battle-canvas') as HTMLCanvasElement;
    const box = src.getBoundingClientRect();
    const dpr = src.width / box.width;
    const w = window as unknown as { __strip?: HTMLCanvasElement };
    const cols = 8;
    if (n === 0) {
      w.__strip = document.createElement('canvas');
      w.__strip.width = 256 * cols;
      w.__strip.height = 192 * 8;
    }
    const g = w.__strip!.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    g.drawImage(src, (info.rect.x - box.x) * dpr, (info.rect.y - box.y) * dpr, info.rect.width * dpr, info.rect.height * dpr, (n % cols) * 256, Math.floor(n / cols) * 192, 256, 192);
  }, strip.frames);
  strip.frames++;
}

async function saveStrip(name: string): Promise<void> {
  const url = await page.evaluate(() => (window as unknown as { __strip: HTMLCanvasElement }).__strip.toDataURL('image/png'));
  mkdirSync(SHOTS!, { recursive: true });
  writeFileSync(join(SHOTS!, `${test.info().project.name}-${name}.png`), Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
}

/**
 * What a proof compares: the frame against the same frame without the animation's particles, its OAM cells (`sprites`),
 * its copies of the battlers' sprites (`copies`), its changes to the battlers (`battlers`) or BG2 (`bg`: a battler's
 * picture loaded into it, or a wave).
 */
type Kind = 'particles' | 'sprites' | 'copies' | 'battlers' | 'bg';

/**
 * DS px centres of the battlers' sprites (scene.ts POS, decomp battle_display.c) and how near the effect must be;
 * `centre` is a fixed screen spot (BattleAnimSpriteFunc_Taunt puts its hand at TAUNT_SPRITE_HAND_0_POS_X/Y, 128, 80,
 * whichever side the defender is on), `screen` the screen's middle (a wave over the whole layer), `wave` Surf's wave
 * sprite (SURF_PLAYER_SIDE_X/Y, 76, 120, before its ground anchoring lifts it) and `beside` Role Play's copy
 * (ROLE_PLAY_ATTACKER_X_OFFSET: 32 px toward the attacker's side of the player's Pokémon).
 */
const AT = {
  player: { x: 64, y: 112 },
  enemy: { x: 192, y: 48 },
  centre: { x: 128, y: 80 },
  screen: { x: 128, y: 96 },
  wave: { x: 76, y: 104 },
  beside: { x: 32, y: 112 },
};

const PROOF: { move: string; near: keyof typeof AT; min: number; kind?: Exclude<Kind, 'particles'>; opts?: Parameters<typeof replay>[1] }[] = [
  { move: 'MOVE_TACKLE', near: 'enemy', min: 40 },
  { move: 'MOVE_EMBER', near: 'enemy', min: 60 },
  { move: 'MOVE_WATER_GUN', near: 'enemy', min: 60 },
  { move: 'MOVE_THUNDER_SHOCK', near: 'enemy', min: 60 },
  { move: 'MOVE_GROWL', near: 'player', min: 40 },
  { move: 'MOVE_STRING_SHOT', near: 'enemy', min: 40, kind: 'sprites' },
  { move: 'MOVE_METAL_CLAW', near: 'enemy', min: 40, kind: 'sprites' },
  { move: 'MOVE_TAUNT', near: 'centre', min: 40, kind: 'sprites' },
  { move: 'MOVE_FAKE_OUT', near: 'enemy', min: 40, kind: 'sprites' },
  { move: 'MOVE_DIG', near: 'player', min: 40, kind: 'battlers' },
  { move: 'MOVE_CAMOUFLAGE', near: 'player', min: 40, kind: 'battlers' },
  { move: 'MOVE_SURF', near: 'wave', min: 40, kind: 'sprites' },
  { move: 'MOVE_MUDDY_WATER', near: 'screen', min: 400, kind: 'bg' },
  { move: 'MOVE_NIGHT_SHADE', near: 'player', min: 40, kind: 'copies', opts: { wild: 'SPECIES_SHINX' } },
  { move: 'MOVE_TRANSFORM', near: 'player', min: 40, kind: 'copies', opts: { auto: 1 } },
  { move: 'MOVE_ROLE_PLAY', near: 'beside', min: 40, kind: 'copies' },
  { move: 'MOVE_ACID_ARMOR', near: 'player', min: 40, kind: 'bg' },
  { move: 'MOVE_SKETCH', near: 'enemy', min: 40, kind: 'bg', opts: { late: true } },
  { move: 'MOVE_SPITE', near: 'enemy', min: 40, kind: 'bg', opts: { late: true } },
  { move: 'MOVE_EXTRASENSORY', near: 'enemy', min: 40, kind: 'bg' },
];

const NEAR = { player: 'attacker', enemy: 'defender', centre: 'screen centre', screen: 'whole screen', wave: "attacker's wave", beside: "attacker's side" } as const;

for (const proof of PROOF) {
  test(`${proof.move}: the ROM animation plays, its ${proof.kind ?? 'particles'} drawn at the ${NEAR[proof.near]}`, async () => {
    test.setTimeout(300_000);
    const project = test.info().project.name;
    let best = { changed: 0, x: 0, y: 0 };
    let ticks = 0;
    const strip = { frames: 0 };
    const driver = pageDriver(page, SHOTS ?? 'test-artifacts/battle-anim', `${project}-${proof.move}`);
    const result = await runReplay(driver, replay(proof.move, proof.opts), {
      registries,
      name: `${proof.move}.replay`,
      seed: 1,
      repeat: false,
      async beforeLine(line: ReplayLine) {
        if (line.action.type !== 'screenshot') return;
        // Step until the animation starts, then through it: the frame with the most particles is checked.
        await page.evaluate(() => {
          const g = window.openSinnohGame!;
          for (let i = 0; i < 600 && !g.battleView()?.anim; i++) g.advance(1);
        });
        await waitForScene(page);
        for (let i = 0; i < 600; i++) {
          const v = await battleView();
          if (!v?.anim) break;
          ticks++;
          if (SHOTS && strip.frames < 64) {
            await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
            await stripFrame(strip);
          }
          // Every third frame with visible effects is enough to find the busiest one.
          const visible =
            proof.kind === 'sprites'
              ? v.anim.sprites.some((s) => s.kind === 'cell')
              : proof.kind === 'copies'
                ? v.anim.sprites.some((s) => s.kind === 'pokemon')
                : proof.kind === 'bg'
                  ? !!(v.anim.bgMon || v.anim.bg.custom)
                  : proof.kind === 'battlers' || v.anim.particles.length > 0;
          if (visible && ticks % (proof.kind ? 8 : 3) === 0) {
            // The effect's atlas loads when first drawn: wait for it, or a slow load leaves every sample bare.
            await waitForScene(page);
            const d = await animationDiff(proof.kind ?? 'particles');
            if (d.changed > best.changed) best = d;
          }
          await page.evaluate(() => window.openSinnohGame!.advance(1));
        }
        if (SHOTS) await saveStrip(proof.move.toLowerCase());
      },
    });
    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(ticks, 'the animation ran').toBeGreaterThan(10);
    expect(best.changed, `${proof.kind ?? 'particles'} are drawn`).toBeGreaterThan(proof.min);
    const at = AT[proof.near];
    expect(Math.hypot(best.x - at.x, best.y - at.y), `the effect is around the ${proof.near} (centre ${best.x.toFixed(0)}, ${best.y.toFixed(0)})`).toBeLessThan(56);
    expect(await page.evaluate((move) => window.openSinnohApp!.game.log.report().filter((s) => s.key === `anim:platinum:${move}`), proof.move)).toEqual([]);
    expect(errors).toEqual([]);
  });
}

/** The capsule set on the lead: seals around the circle's centre (190, 70) and one alphabet seal. */
const CAPSULE = { id: 1, seals: [[1, 190, 70], [7, 160, 50], [13, 220, 50], [19, 160, 95], [25, 220, 95], [31, 190, 22], [37, 190, 118], [50, 140, 70]].map(([seal, x, y]) => ({ seal, x, y })) };

test("a Ball Capsule's seals play at the player's send-out, around the Pokémon", async () => {
  test.setTimeout(300_000);
  const project = test.info().project.name;
  let best = { changed: 0, x: 0, y: 0 };
  let ticks = 0;
  const strip = { frames: 0 };
  let done = false;
  const driver = pageDriver(page, SHOTS ?? 'test-artifacts/battle-anim', `${project}-capsule`);
  const capsuleReplay = replay('MOVE_TACKLE').replace('set var', `set state party[0].capsule ${JSON.stringify(CAPSULE)}\nset var`).replace('+0 battle move 1\n+0 screenshot anim\n', '');
  const result = await runReplay(driver, capsuleReplay, {
    registries,
    name: 'capsule-send-out.replay',
    seed: 1,
    repeat: false,
    async beforeLine() {
      // Once the battle has started (it starts during a walking line, its intro outlasts the line): step to the
      // player's send-out, then through its seals.
      if (done) return;
      const started = await page.evaluate(() => {
        const g = window.openSinnohGame!;
        if (!g.battleView()) return false;
        for (let i = 0; i < 900 && !g.battleView()?.battlers.some((b) => b.side === 'player' && b.visible); i++) g.advance(1);
        return true;
      });
      if (!started) return;
      done = true;
      await waitForScene(page);
      for (let i = 0; i < 200; i++) {
        const v = await battleView();
        if (v?.prompt) break;
        if (v?.sendOut?.length) {
          ticks++;
          if (SHOTS && strip.frames < 64) {
            await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
            await stripFrame(strip);
          }
          if (ticks % 3 === 0) {
            await waitForScene(page);
            const d = await animationDiff('send-out');
            if (d.changed > best.changed) {
              best = d;
              await page.screenshot({ path: `test-artifacts/battle-anim/${project}-capsule-send-out.png` });
            }
          }
        }
        await page.evaluate(() => window.openSinnohGame!.advance(1));
      }
      if (SHOTS) await saveStrip('capsule-send-out');
    },
  });
  expect(result.error).toBeUndefined();
  expect(result.ok).toBe(true);
  // Seven seals start within 20 frames of the ball opening and the alphabet seal after 8; the send-out waits for them.
  expect(ticks, 'the seals played').toBeGreaterThan(20);
  expect(best.changed, 'the seals are drawn').toBeGreaterThan(200);
  // Around the player's Pokémon: the effect's anchor is (64, 112) less (10, 16), the seals centred 30 px above it.
  expect(Math.hypot(best.x - 54, best.y - 66), `the seals are around the player's Pokémon (centre ${best.x.toFixed(0)}, ${best.y.toFixed(0)})`).toBeLessThan(48);
  expect(errors).toEqual([]);
});

test("a shiny lead sparkles at the player's send-out (common animation shiny), around the Pokémon", async () => {
  test.setTimeout(300_000);
  let best = { changed: 0, x: 0, y: 0 };
  let ticks = 0;
  let done = false;
  const driver = pageDriver(page, SHOTS ?? 'test-artifacts/battle-anim', `${test.info().project.name}-shiny`);
  // otId 1 and PID 1: shiny (core isShiny).
  const shinyReplay = replay('MOVE_TACKLE').replace('set var', 'set state party[0].otId 1\nset state party[0].pid 1\nset var').replace('+0 battle move 1\n+0 screenshot anim\n', '');
  const result = await runReplay(driver, shinyReplay, {
    registries,
    name: 'shiny-send-out.replay',
    seed: 1,
    repeat: false,
    async beforeLine() {
      // As the capsule test: once the battle has started, step to the player's send-out, then through the sparkle.
      if (done) return;
      const started = await page.evaluate(() => {
        const g = window.openSinnohGame!;
        if (!g.battleView()) return false;
        for (let i = 0; i < 900 && !g.battleView()?.battlers.some((b) => b.side === 'player' && b.visible); i++) g.advance(1);
        return true;
      });
      if (!started) return;
      done = true;
      await waitForScene(page);
      for (let i = 0; i < 300; i++) {
        const v = await battleView();
        if (v?.prompt) break;
        if (v?.anim?.particles.length) {
          ticks++;
          if (ticks % 3 === 0) {
            await waitForScene(page);
            const d = await animationDiff('particles');
            if (d.changed > best.changed) best = d;
          }
        }
        await page.evaluate(() => window.openSinnohGame!.advance(1));
      }
    },
  });
  expect(result.error).toBeUndefined();
  expect(result.ok).toBe(true);
  expect(ticks, 'the sparkle played').toBeGreaterThan(20);
  expect(best.changed, 'the sparkles are drawn').toBeGreaterThan(20);
  expect(Math.hypot(best.x - AT.player.x, best.y - AT.player.y), `the sparkles are around the player's Pokémon (centre ${best.x.toFixed(0)}, ${best.y.toFixed(0)})`).toBeLessThan(56);
  expect(await page.evaluate(() => window.openSinnohApp!.game.log.report().filter((s) => s.key === 'anim:shiny'))).toEqual([]);
  expect(errors).toEqual([]);
});
