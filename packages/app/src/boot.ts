/**
 * THE composition file: the only place the app wires the engine together.
 *   game     packages/game createGame with the world (packages/world), the VM (packages/vm), the menu apps
 *            (packages/menus) and the battle engine (packages/battle, loaded lazily)
 *   renderer packages/render mountFieldRenderer on the main canvas
 *   overlay  packages/text drawScriptOverlay with the newGame record's message font
 * The importer (packages/importer) is wired in importer.ts, so the import worker does not load the engine.
 * The rest of the app sees `Session`.
 */
import type { ClockTime, Id, PackData } from '@opensinnoh/core';
import type { AssetSource, FieldRenderer, Font, InputFrame, LoadedFont, MapEntry, NineSliceArt, OverlayFrames } from '@opensinnoh/contracts';
import { createGame, saveFromJson, saveToJson, type Game, type GameDevice, type NewGameOptions } from '@opensinnoh/game';
import { createApp, createPoketch } from '@opensinnoh/menus';
import { mountFieldRenderer } from '@opensinnoh/render';
import { drawScriptOverlay, loadFont } from '@opensinnoh/text';
import { drawBlackOut } from './black-out.ts';
import { createRadarDrawer } from './underground-radar.ts';
import { loadChunk } from './chunk.ts';
import { createFrontierDrawer } from './frontier-scene.ts';
import { bottomFrame, type DsFrame } from './panel.ts';
import { createLookoutDrawer, createPreviewDrawer } from './pokemon-preview.ts';
import { createFlyDrawer } from './fly-scene.ts';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';

/**
 * Warms the battle engine while the browser is idle (packages/battle `warmBattleEngine`): otherwise the session's
 * first battle builds its dex and compiles the sim in the ticks that start it and run its first turn (110 ms and
 * 21 ms at 4x CPU throttling, visible hitches). Normal play only; replays keep the cold path.
 */
export function warmBattleEngine(game: Game): void {
  const idle = globalThis.requestIdleCallback ?? ((f: () => void) => setTimeout(f, 1000));
  idle(() => void loadChunk(() => import('@opensinnoh/battle')).then((m) => m.warmBattleEngine(game.registries, game.log)));
}

export interface Session {
  /** The live game. Its world and state objects are replaced on reset and load. */
  readonly game: Game;
  readonly renderer: FieldRenderer;
  /** Characters the message font can draw (what names may use). */
  readonly messageChars: string;
  /** The message font (the in-game UI draws its labels with it). */
  readonly font: LoadedFont;
  /** One 30 Hz tick with the app's input frame. */
  tick(input: InputFrame): void;
  /**
   * Clears the overlay canvas and draws the message/yes-no boxes in `frame` (`bottomFrame` on the field, the scene's
   * frame while a frontier scene runs; its scale is device px per DS px, an integer).
   * `fieldScale`: device px per DS px of the field (Fly's cut-in stands over the player).
   */
  drawOverlay(ctx: CanvasRenderingContext2D, frame: DsFrame, fieldScale: number): void;
  /** SaveEnvelope JSON; throws while a script runs or the world is busy. */
  save(): string;
  /** Validates strictly; throws an Error whose message is shown to the player. */
  load(json: string, entry?: MapEntry): Promise<void>;
  /** New game; new names/gender, when given, are kept for later resets. */
  reset(seed: number, newGame?: NewGameOptions): Promise<void>;
  dispose(): void;
}

/** Decomp: the options' FRAME 1–20 pick the message box frame. */
const MESSAGE_BOX_FRAMES = 20;

/**
 * The field boxes' ROM window frames (the base pack's `ui2d/windows/*` nine-slice sheets): all 20 message
 * box frames and the standard field frame, decoded once. Null when the base pack has none (the fixture).
 */
async function loadFrames(game: Game, assets: AssetSource): Promise<{ message: NineSliceArt[]; window: NineSliceArt } | null> {
  const ns = [...game.registries.newGame.keys()][0]!.split(':')[0]!;
  const art = async (path: string): Promise<NineSliceArt | null> => {
    const sheet = game.registries.ui2d.get(`${ns}:ui2d/${path}` as Id);
    if (!sheet) return null;
    if (!sheet.nineSlice) throw new Error(`${sheet.id}: a window frame sheet without nineSlice`);
    const image = await createImageBitmap(await assets.get(sheet.atlas));
    return { image, width: image.width, height: image.height, slice: sheet.nineSlice };
  };
  const window = await art('windows/standard_field');
  if (!window) return null;
  const message = await Promise.all(Array.from({ length: MESSAGE_BOX_FRAMES }, (_, f) => art(`windows/message_box_${String(f).padStart(2, '0')}`)));
  if (message.some((m) => !m)) throw new Error('the base pack has the standard window frame but not all 20 message box frames');
  return { message: message as NineSliceArt[], window };
}

function messageFontRecord(game: Game): Font {
  const newGame = [...game.registries.newGame.values()][0]!;
  const record = game.registries.fonts.get(newGame.messageFont);
  if (!record) throw new Error(`newGame.messageFont ${newGame.messageFont} is not a font record`);
  return record;
}

/** The Unown font of `message_unown` (`NewGame.unownFont`), or undefined for packs without one. */
function unownFontRecord(game: Game): Font | undefined {
  const id = [...game.registries.newGame.values()][0]!.unownFont;
  if (!id) return undefined;
  const record = game.registries.fonts.get(id);
  if (!record) throw new Error(`newGame.unownFont ${id} is not a font record`);
  return record;
}

/**
 * `newGame` picks the names and gender for the first game from the message font's characters
 * (undefined: the newGame record's defaults).
 */
export async function createSession(
  packs: readonly PackData[],
  assets: AssetSource,
  canvas: HTMLCanvasElement,
  seed: number,
  newGame: ((messageChars: string) => NewGameOptions | undefined) | undefined,
  device: GameDevice,
  /** The game clock: the device's (app `deviceClock`), or undefined for the game's frozen one (replays). */
  clock: (() => ClockTime) | undefined,
): Promise<Session> {
  // The battle engine (packages/battle with @pkmn/sim) is a lazy chunk, loaded on the first battle.
  const battle = () => loadChunk(() => import('@opensinnoh/battle'));
  const game = createGame({ packs, createWorld, createScriptRunner, createApp, createPoketch, loadBattle: () => battle().then((m) => m.createBattle), loadContestAnimation: () => battle().then((m) => m.createContestMoveAnimation), seed, device, ...(clock ? { clock } : {}) });
  const fontRecord = messageFontRecord(game);
  const chosen = newGame?.(fontRecord.chars);
  if (chosen) game.reset(seed, chosen);
  const font = loadFont(fontRecord, await createImageBitmap(await assets.get(fontRecord.atlas)));
  const unownRecord = unownFontRecord(game);
  const unownFont = unownRecord ? loadFont(unownRecord, await createImageBitmap(await assets.get(unownRecord.atlas))) : undefined;
  const frameArt = await loadFrames(game, assets);
  /** The FRAME option (saved with the game) picks the message box frame. */
  const frames = (): OverlayFrames | undefined => (frameArt ? { message: frameArt.message[game.state.options.frame]!, window: frameArt.window } : undefined);
  const drawPreview = createPreviewDrawer(assets, () => game.registries);
  const drawFrontier = createFrontierDrawer(assets, () => game.registries);
  const drawLookout = createLookoutDrawer(assets, () => game.registries);
  const drawFly = createFlyDrawer(assets, () => game.registries);
  const drawRadar = createRadarDrawer(assets, () => game.registries);
  const mount = () => mountFieldRenderer(canvas, { world: game.world, registries: game.registries, state: game.state, assets, log: game.log });
  let renderer = await mount();
  let size: [number, number, number, number | undefined] | null = null;
  /** The renderer holds the world and state it was mounted with; both are replaced on reset and load. */
  const remount = async () => {
    const next = await mount();
    renderer.dispose();
    renderer = next;
    if (size) renderer.resize(...size);
  };

  /** Stable handle over the current renderer. */
  const current: FieldRenderer = {
    render: (alpha) => renderer.render(alpha),
    tileAt: (x, y) => renderer.tileAt?.(x, y) ?? null,
    screenOf: (x, z) => renderer.screenOf?.(x, z) ?? null,
    loading: () => renderer.loading(),
    resize(width, height, pixelRatio, scale) {
      size = [width, height, pixelRatio, scale];
      renderer.resize(width, height, pixelRatio, scale);
    },
    dispose: () => renderer.dispose(),
  };

  return {
    game,
    renderer: current,
    messageChars: fontRecord.chars,
    font,
    tick: (input) => game.step(input),
    drawOverlay(ctx, frame, fieldScale) {
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      drawFly(ctx, game.world.flyScene(), game.world.fadeState(), fieldScale);
      drawRadar(ctx, game.world.undergroundView(), font, fieldScale, game.state.tick, (x, z) => renderer.screenOf?.(x, z) ?? null);
      const view = game.scripts.view();
      const scale = frame.scale;
      drawFrontier(ctx, view.frontier, frame);
      // drawScriptOverlay draws in the bottom frame: moved onto `frame`.
      const bottom = bottomFrame(ctx.canvas, scale);
      ctx.save();
      ctx.translate(frame.x - bottom.x, frame.y - bottom.y);
      drawScriptOverlay(ctx, view, font, scale, frames(), unownFont);
      ctx.restore();
      drawPreview(ctx, view.pokemonPreview, scale);
      drawLookout(ctx, game.world.lookoutView(), scale);
      drawBlackOut(ctx, game.blackOutScreen(), font, scale);
    },
    save: () => saveToJson(game.save()),
    async load(json, entry) {
      game.load(saveFromJson(json), entry);
      await remount();
    },
    async reset(nextSeed, nextNewGame) {
      game.reset(nextSeed, nextNewGame);
      await remount();
    },
    dispose: () => renderer.dispose(),
  };
}
