/**
 * The Pokétch (contracts 0.21.0; docs/research/poketch.md). The saved part is `GameState.poketch`
 * (decomp `Poketch`); the device itself is a headless model (packages/menus `createPoketch`) that the
 * game steps on every field tick, as the DS runs the Pokétch next to the field. It is not modal: its
 * input is the panel touch (the DS bottom screen) while no script runs. The app draws its `PoketchView`
 * and nothing else, so a replay runs the same headless and in the browser.
 */
import type { Id, Pokemon } from '@opensinnoh/core';
import type { AudioHost } from './audio.ts';
import type { Registries, StubLog } from './runtime.ts';
import type { GameState, PoketchState } from './state.ts';

/** Decomp enum PoketchAppID order (generated/poketch_apps.txt); ids are `<ns>:POKETCH_APPID_<NAME>`. */
export const POKETCH_APPS = [
  'DIGITALWATCH', 'CALCULATOR', 'MEMOPAD', 'PEDOMETER', 'PARTYSTATUS', 'FRIENDSHIPCHECKER', 'DOWSINGMACHINE', 'BERRYSEARCHER',
  'DAYCARECHECKER', 'POKEMONHISTORY', 'COUNTER', 'ANALOGWATCH', 'MARKINGMAP', 'LINKSEARCHER', 'COINTOSS', 'MOVETESTER', 'CALENDAR',
  'DOTART', 'ROULETTE', 'TRAINERCOUNTER', 'KITCHENTIMER', 'COLORCHANGER', 'MATCHUPCHECKER', 'STOPWATCH', 'ALARMCLOCK',
] as const;
export type PoketchAppName = (typeof POKETCH_APPS)[number];

/** Decomp POKETCH_PEDOMETER_MAX: the step count wraps to 0 past it. */
export const POKETCH_PEDOMETER_MAX = 99999;
/** Decomp POKETCH_POKEMONHISTORY_MAX. */
export const POKETCH_HISTORY_MAX = 12;
/** Decomp POKETCH_SCREEN_COLOR_MAX. */
export const POKETCH_COLORS = 8;
/** Decomp sDefaultMapMarkers (poketch.c): the six markers in a row under the map. */
export const POKETCH_DEFAULT_MARKERS: readonly { x: number; y: number }[] = [104, 120, 136, 152, 168, 184].map((x) => ({ x, y: 152 }));
/** The DS bottom screen and the Pokétch's LCD inside it (decomp POKETCH_SCREEN_MIN/MAX_X/Y). */
export const POKETCH_SCREEN = { width: 256, height: 192, lcd: { x: 16, y: 16, width: 192, height: 160 } } as const;

/** `<ns>:POKETCH_APPID_<NAME>` → its index in `POKETCH_APPS`; throws on anything else. */
export function poketchAppIndex(id: Id): number {
  const local = id.slice(id.indexOf(':') + 1);
  const i = (POKETCH_APPS as readonly string[]).indexOf(local.replace(/^POKETCH_APPID_/, ''));
  if (!local.startsWith('POKETCH_APPID_') || i < 0) throw new Error(`unknown Pokétch app id ${id}`);
  return i;
}

export const poketchAppName = (id: Id): PoketchAppName => POKETCH_APPS[poketchAppIndex(id)]!;
export const poketchAppId = (ns: string, name: PoketchAppName): Id => `${ns}:POKETCH_APPID_${name}` as Id;

/** A new game's Pokétch (decomp Poketch_Init, minus the Digital Watch it registers: `enable_poketch` and the scripts add apps). */
export function newPoketchState(): PoketchState {
  return { enabled: false, apps: [], current: null, color: 0, steps: 0, alarm: { on: false, hour: 0, minute: 0 }, calendar: { month: 1, marks: 0 }, markers: POKETCH_DEFAULT_MARKERS.map((m) => ({ ...m })), dotArt: null, history: [] };
}

/** Decomp Poketch_RegisterApp: true when the app was new. The first app becomes the current one. */
export function registerPoketchApp(p: PoketchState, app: Id): boolean {
  poketchAppIndex(app);
  if (p.apps.includes(app)) return false;
  p.apps.push(app);
  p.current ??= app;
  return true;
}

/**
 * Decomp Poketch_IncrementAppID / DecrementAppID: the next (or previous) registered app in app id order,
 * wrapping; the current app when it is the only one.
 */
export function nextPoketchApp(p: PoketchState, dir: 1 | -1): Id | null {
  if (p.current === null) return null;
  const ns = p.current.slice(0, p.current.indexOf(':'));
  const at = poketchAppIndex(p.current);
  for (let k = 1; k <= POKETCH_APPS.length; k++) {
    const id = poketchAppId(ns, POKETCH_APPS[(at + dir * k + POKETCH_APPS.length * 2) % POKETCH_APPS.length]!);
    if (p.apps.includes(id)) return id;
  }
  return p.current;
}

/**
 * One step of the player (decomp Field_ProcessStep → POKETCH_EVENT_PEDOMETER, sent only while the
 * Pokétch runs: enabled and not hidden; Poketch_SetStepCount only once the Pedometer is registered).
 */
export function countPoketchStep(state: GameState, registries: Registries): void {
  const p = state.poketch;
  if (!poketchRuns(state, registries) || !p.apps.some((a) => a.endsWith(':POKETCH_APPID_PEDOMETER'))) return;
  p.steps = p.steps >= POKETCH_PEDOMETER_MAX ? 0 : p.steps + 1;
}

/** Decomp Poketch_PokemonHistoryEnqueue (SaveData_UpdateCatchRecords, catches, hatches, evolutions): eggs are not recorded. */
export function addPoketchHistory(state: GameState, mon: Pokemon): void {
  if (mon.isEgg) return;
  const h = state.poketch.history;
  if (h.length >= POKETCH_HISTORY_MAX) h.shift();
  h.push({ species: mon.species, form: mon.form });
}

/** The flag `hide_poketch` sets (decomp FLAG_POKETCH_HIDDEN: binoculars, the Great Marsh lookout). */
export const POKETCH_HIDDEN_FLAG = 'FLAG_POKETCH_HIDDEN';

/** FLAG_POKETCH_HIDDEN of the base pack (a pack without the flag never hides the Pokétch). */
export function poketchHidden(state: GameState, registries: Registries): boolean {
  const ns = [...registries.newGame.keys()][0]!.split(':')[0]!;
  const id = `${ns}:${POKETCH_HIDDEN_FLAG}` as Id;
  return state.flags[id] ?? registries.flags.get(id)?.initial ?? false;
}

/** The Pokétch runs (decomp ov5_021EA728: enabled and not hidden; otherwise the bottom screen is blank) and has an app. */
export const poketchRuns = (state: GameState, registries: Registries): boolean => state.poketch.enabled && state.poketch.current !== null && !poketchHidden(state, registries);

// ---------- the model ----------

/** A rectangle in Pokétch screen px (the 256×192 DS bottom screen). */
export interface PoketchRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A sprite on the Pokétch (an OBJ): a cell of a `ui2d` sheet of the base pack (`poketch/<name>`), or
 * an animation of it (NANR sequence `seq`, `t` ticks since it started, at 30 Hz). `x`, `y` is where the
 * cell's origin lies, in screen px.
 */
export interface PoketchSprite {
  sheet: string;
  cell?: number;
  /** `t` counts Pokétch ticks; the NANR's durations are 60 Hz frames and advance by 2 a tick (decomp poketch_animation.c). */
  anim?: { seq: number; t: number };
  x: number;
  y: number;
  /** Flips the cell's image in its box (the decomp toggles each OAM's flip bit; these cells are one OAM). */
  hFlip?: boolean;
  vFlip?: boolean;
  /** Affine OBJs: degrees clockwise and scale, about the sprite position. */
  angle?: number;
  scale?: number;
  /** Drawn with the theme palette's colours 1↔4 and 8↔15 swapped (the app counter, OBJ palette 15). */
  invert?: boolean;
}

/** A rect copied from a one-cell `ui2d` sheet (a BG screen) to the screen: the decomp's tilemap edits. */
export interface PoketchBlit {
  sheet: string;
  from: PoketchRect;
  x: number;
  y: number;
  hFlip?: boolean;
  vFlip?: boolean;
}

/**
 * What the Pokétch shows. Layers, bottom first: `bg` (one-cell sheets drawn at 0, 0), `blits`, `bitmap`,
 * `icons`, `sprites` (later on top), `text`. All art is imported in the green palette; the app recolours it
 * to `color` (the theme's second palette with `backlight`).
 */
export interface PoketchView {
  app: Id;
  color: number;
  backlight: boolean;
  /** An LCD palette index filling the LCD under everything (apps without a BG screen); null = the backdrop, colour 0. */
  fill: number | null;
  bg: string[];
  blits: PoketchBlit[];
  /** A pixel layer (memo pad, dot artist, roulette): one hex digit per pixel, an LCD palette index (0 = clear). */
  bitmap: { x: number; y: number; width: number; height: number; scale: number; data: string } | null;
  /**
   * Pokémon icons drawn in the LCD palette (decomp PoketchTask_LoadPokemonIconLuminancePalette: each colour's
   * luma picks theme colour 1, 8, 15 or 4), centred on x, y, `scale` 1.5 or 2; `frame` 0 or 1;
   * `silhouette`: every pixel theme colour 15 (party status: fainted or with a status condition).
   */
  icons: { species: Id; form: number; egg: boolean; x: number; y: number; frame: number; scale: number; hFlip?: boolean; silhouette?: boolean }[];
  /** Later sprites are drawn over earlier ones. */
  sprites: PoketchSprite[];
  /** Text in the system font, ink colour 1 with shadow 8 (decomp TEXT_COLOR(1, 8, 4)); `x` is the left or the centre. */
  text: { text: string; x: number; y: number; align?: 'left' | 'center' }[];
  /** BG and OBJ mosaic size (berry searcher, day-care checker refresh), 0 = off. */
  mosaic: number;
  /** The screen between apps (decomp TASK_CONCEAL/REVEAL_SCREEN): LCD rows covered from the top and bottom, 0–80. */
  cover: number;
  /** The side buttons (decomp poketch_graphics button tilemaps). */
  buttons: { up: 'idle' | 'half' | 'pressed'; down: 'idle' | 'half' | 'pressed' };
  /** The app number shown while skipping apps (decomp TASK_LOAD_APP_COUNTER), or null. */
  counter: number | null;
  /** Where a pointer (keyboard or gamepad) can tap, in screen px; empty = anywhere on the LCD (drawing apps). */
  targets: PoketchRect[];
  /** What the app shows, as data (tests, accessibility). */
  info: Record<string, string | number | boolean | null | (string | number | null)[]>;
}

/** What the game gives the Pokétch each tick. */
export interface PoketchTick {
  /** The panel touch (DS bottom-screen px) while no script runs and no panel choice is up; else null. */
  touch: { x: number; y: number } | null;
  /** A script or field task runs: the Pokétch ignores touches (decomp PoketechSystem_IsRunningTask). */
  busy: boolean;
  /** The player moved this tick (decomp POKETCH_EVENT_PLAYER_MOVED). */
  moved: boolean;
}

export interface PoketchModel {
  step(tick: PoketchTick): void;
  view(): PoketchView;
}

export interface PoketchDeps {
  registries: Registries;
  state: GameState;
  log: StubLog;
  /** The game's main PRNG (the decomp's MTRNG_Next): the coin toss, roulette and friendship checker roll on it. */
  rng(): number;
  /** The game clock (watches, calendar, alarm). */
  clock(): import('@opensinnoh/core').ClockTime;
  /** Sound effects and cries; absent headless without sound. */
  sound?: AudioHost;
  /** 0.31.0. The live Poké Radar chain (`World.radarChain`; the Trainer Counter). Absent: none runs. */
  radarChain?(): { species: import('@opensinnoh/core').Id; count: number } | null;
}

export type CreatePoketch = (deps: PoketchDeps) => PoketchModel;
