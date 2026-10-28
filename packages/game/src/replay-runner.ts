/**
 * Replay runner over a driver: headless (a Game in Node) or the browser bridge (`window.openSinnohGame`).
 * Ticks are counted from reset. The replay runs twice from the same seed and both runs must end in the
 * same snapshot (determinism). Then, when saving is allowed, save → reset → load must give the same
 * state byte for byte. Grammar: core `replay.ts`.
 */
import { jsonEqual, MAX_MOVES, PARTY_SIZE, parseReplay, readStatePath, resolveStateArg, withClock, type Button, type Id, type Replay, type ReplayAction, type ReplayBattleChoice, type ReplayLine, type ReplaySetup, type UntilCondition } from '@opensinnoh/core';
import { DEV_EVENTS, giveItem, grantDevEvent, markCaught, MONEY_MAX, setupPokemon, type GameSnapshot, type GameState, type Registries, type WildBattleMode, type EvolutionMode, type DevEvent, type MapEntry } from '@opensinnoh/contracts';
import type { Game } from './game.ts';
import { canonicalState } from './save.ts';
import { saveFromJson, saveToJson } from './storage.ts';
import { advanceMessage, advanceText, battleAuto, battleCatch, grind, runUntil, type UntilTarget } from './until.ts';
import { allowTestGiftCodes } from '@opensinnoh/services';

type MaybePromise<T> = T | Promise<T>;

/** Subset of contracts `OpenSinnohBridge`, plus `until`, `advanceText` and optional browser-only actions. */
export interface ReplayDriver {
  reset(seed: number): MaybePromise<void>;
  advance(ticks: number): MaybePromise<void>;
  press(button: Button): MaybePromise<void>;
  release(button: Button): MaybePromise<void>;
  touch(x: number, y: number): MaybePromise<void>;
  untouch(): MaybePromise<void>;
  /** `tap <id>` on the open menu app (next tick). */
  tap(id: string): MaybePromise<void>;
  snapshot(): MaybePromise<GameSnapshot>;
  save(): MaybePromise<string>;
  /** A loaded save, or with `arrival` a map change into the saved position (the `warp` setup). */
  load(json: string, entry?: MapEntry): MaybePromise<void>;
  /** The save `clear_game` wrote before the reset (game `resetSave`), or null. */
  resetSave(): MaybePromise<string | null>;
  /** `until …` (see `runUntil`): the ticks advanced, or null when the condition still fails after `max`. */
  until(until: UntilCondition, max: number): MaybePromise<number | null>;
  /** `advance text` (see `advanceText`), or with `close` `advance message` (`advanceMessage`): the ticks advanced, or null after `max`. */
  advanceText(max: number, close?: boolean): MaybePromise<number | null>;
  /** `field move <slot> <move>` (game `useFieldMove`). */
  fieldMove(slot: number, move: Id): MaybePromise<void>;
  /** The `date`/`time` lines (game `setClock`: freezes the clock; a reset restores the game's clock option). */
  setClock(date?: string, time?: string): MaybePromise<void>;
  /** `battle …` (game `battleChoose`). */
  battleChoose(choice: ReplayBattleChoice): MaybePromise<void>;
  /** `battle auto [max]` (game `battleAuto`): the ticks advanced, or null when it failed. */
  battleAuto(max: number, move?: number): MaybePromise<number | null>;
  /** `grind <slot> <level> <dir> <dir> [max]` (game `grind`): the ticks advanced, or null when it failed. */
  grind(slot: number, level: number, dirs: [Button, Button], max: number): MaybePromise<number | null>;
  /** `wild flee|battle|auto` (game `wildBattles`). */
  setWildBattles(mode: WildBattleMode): MaybePromise<void>;
  /** `evolve manual|auto|cancel` (game `evolutions`). */
  setEvolutions(mode: EvolutionMode): MaybePromise<void>;
  /** Replay `open mystery-gift` (game `openMysteryGift`). */
  openMysteryGift(): MaybePromise<void>;
  /** `battle catch <ball> [max]` (game `battleCatch`): the ticks advanced, or null when it failed. */
  battleCatch(ball: Id, max: number): MaybePromise<number | null>;
  /** Returns the written file path. Headless drivers leave these out (the line is reported as skipped). */
  screenshot?(name: string): Promise<string>;
  viewport?(width: number, height: number): Promise<void>;
}

export interface ReplayResult {
  ok: boolean;
  ticks: number;
  assertions: number;
  screenshots: string[];
  /** Lines the driver cannot run (e.g. screenshots headless). */
  skipped: string[];
  /** Setup lines that were applied (`<replay>:<line> <text>`): what the result did not play. */
  setup: string[];
  /** The replay was run twice from the same seed and both runs ended in the same snapshot. */
  determinism: 'identical' | 'not-run';
  roundTrip: 'identical' | 'not-run' | { skipped: string };
  error?: string;
}

/** Text of the replay a `from` line names, resolved against the replay that names it (undefined: the main one). */
export type ReplayResolver = (file: string, base: string | undefined) => { name: string; text: string };

export interface ReplayOptions {
  /** For flag/var defaults (the state stores only values that differ from `initial`). */
  registries: Registries;
  seed?: number;
  /** Run the replay a second time and require the same final snapshot (default true). */
  repeat?: boolean;
  /** The main replay's name (base for `from`, and messages). */
  name?: string;
  /** Needed for `from` lines. */
  resolve?: ReplayResolver;
  /**
   * Called before each timed line of the main replay (not chained ones) once its tick is reached
   * (`tick` counts from reset). Returning false skips the line. For specs that add their own checks.
   */
  beforeLine?(line: ReplayLine, tick: number): MaybePromise<boolean | void>;
  /**
   * Also take the screenshot lines of the chained (`from`) replays whose name matches (the browser spec
   * checks key beats that live in `parts/`). Default: only the main replay's.
   */
  chainedScreenshots?: RegExp;
}

/** The loops of `until.ts` over a Game. */
export function untilTarget(game: Game): UntilTarget {
  return {
    tick: () => game.tick(),
    canSave: () => game.canSave(),
    view: () => game.scripts.view(),
    state: () => game.state,
    battles: () => game.battles,
    mapPopup: () => game.mapPopup(),
    radar: () => game.world.radarPatches(),
    battle: () => game.battle?.view() ?? null,
    inBattle: () => game.inBattle(),
    app: () => game.app()?.app ?? null,
    blackOutWaiting: () => game.blackOutScreen()?.waiting === true,
    press: (b) => game.press(b),
    release: (b) => game.release(b),
    battleChoose: (c) => game.battleChoose(c),
    wildBattles: () => game.wildBattles,
    registries: () => game.registries,
    evolutions: () => game.evolutions,
    appView: () => game.app(),
    tap: (id) => game.tap(id),
  };
}

export function gameDriver(game: Game): ReplayDriver {
  return {
    reset: (seed) => game.reset(seed),
    advance: (n) => game.advance(n),
    press: (b) => game.press(b),
    release: (b) => game.release(b),
    touch: (x, y) => game.touch(x, y),
    untouch: () => game.untouch(),
    tap: (id) => game.tap(id),
    snapshot: () => game.snapshot(),
    save: () => saveToJson(game.save()),
    load: (json, entry) => game.load(saveFromJson(json), entry),
    resetSave: () => {
      const save = game.resetSave();
      return save ? saveToJson(save) : null;
    },
    until: (until, max) => runUntil(untilTarget(game), until, max),
    advanceText: (max, close) => (close ? advanceMessage : advanceText)(untilTarget(game), max),
    fieldMove: (slot, move) => game.useFieldMove(slot, move),
    setClock: (date, time) => game.setClock(date, time),
    battleChoose: (choice) => game.battleChoose(choice),
    battleAuto: (max, move) => battleAuto(untilTarget(game), max, move),
    grind: (slot, level, dirs, max) => grind(untilTarget(game), slot, level, dirs, max),
    battleCatch: (ball, max) => battleCatch(untilTarget(game), ball, max),
    setWildBattles: (mode) => {
      game.wildBattles = mode;
    },
    setEvolutions: (mode) => {
      game.evolutions = mode;
    },
    openMysteryGift: () => game.openMysteryGift(),
  };
}

/** The message box's text: the script's, else the open menu app's (0.30.0: Mystery Gift's messages). */
function messageText(snap: GameSnapshot): string | null {
  if (snap.view.message) return snap.view.message.text;
  const app = snap.app as { message?: { text: string } | null } | null;
  return app?.message?.text ?? null;
}

/** A result for a replay that did not get to run (`error` says why). */
export function failedReplay(error: string): ReplayResult {
  return { ok: false, ticks: 0, assertions: 0, screenshots: [], skipped: [], setup: [], determinism: 'not-run', roundTrip: 'not-run', error };
}

export async function runReplay(driver: ReplayDriver, text: string, options: ReplayOptions): Promise<ReplayResult> {
  const result = failedReplay('');
  delete result.error;
  const seed = options.seed ?? 1;
  try {
    const replay = parseReplay(text);
    const first = await play(driver, replay, seed, options, result);
    if (options.repeat !== false) {
      const second = await play(driver, replay, seed, options, null);
      const a = JSON.stringify(first);
      const b = JSON.stringify(second);
      if (a !== b) throw new Error(`replay is not deterministic: a second run from the same seed ended differently:\n${firstDifference(a, b)}`);
      result.determinism = 'identical';
    }
    result.roundTrip = await roundTrip(driver, seed);
    result.ok = true;
  } catch (e) {
    result.error = (e as Error).message;
  }
  return result;
}

interface Run {
  driver: ReplayDriver;
  options: ReplayOptions;
  /** Collects ticks, assertions, screenshots and skipped lines; null on the repeat run. */
  result: ReplayResult | null;
  /** Ticks since reset. */
  ticks: number;
  /** Replays entered through `from` (cycle check). */
  chain: string[];
  seed: number;
}

/** One run from reset; returns the final snapshot. */
async function play(driver: ReplayDriver, replay: Replay, seed: number, options: ReplayOptions, result: ReplayResult | null): Promise<GameSnapshot> {
  await driver.reset(seed);
  await playReplay({ driver, options, result, ticks: 0, chain: options.name ? [options.name] : [], seed }, replay, options.name, true);
  return driver.snapshot();
}

async function playReplay(run: Run, replay: Replay, name: string | undefined, main: boolean): Promise<void> {
  const label = name ?? 'replay';
  if (replay.from) {
    if (!run.options.resolve) throw new Error(`${label} line ${replay.from.line}: "from" needs a replay resolver`);
    const sub = run.options.resolve(replay.from.file, name);
    if (run.chain.includes(sub.name)) throw new Error(`${label} line ${replay.from.line}: "from" cycle through ${sub.name}`);
    run.chain.push(sub.name);
    let parsed: Replay;
    try {
      parsed = parseReplay(sub.text);
    } catch (e) {
      throw new Error(`${sub.name}: ${(e as Error).message}`, { cause: e });
    }
    await playReplay(run, parsed, sub.name, false);
  }
  if (replay.setup.length) await applySetup(run, replay, label);
  const { driver, result } = run;
  /** Ticks since the start of this replay. */
  let cursor = 0;
  const advance = async (n: number) => {
    if (n > 0) await driver.advance(n);
    cursor += n;
    run.ticks += n;
    if (result) result.ticks = run.ticks;
  };
  for (const line of replay.lines) {
    await advance(('tick' in line.at ? line.at.tick : cursor + line.at.after) - cursor);
    if (main && run.options.beforeLine && (await run.options.beforeLine(line, run.ticks)) === false) continue;
    const where = `${main ? 'Replay' : label} line ${line.line} (tick ${run.ticks})${result ? '' : ', repeat run'}`;
    const a = line.action;
    switch (a.type) {
      case 'press':
      case 'release':
        await driver[a.type](a.button);
        break;
      case 'touch':
        await driver.touch(a.x, a.y);
        break;
      case 'untouch':
        await driver.untouch();
        break;
      case 'tap':
        await driver.tap(a.id);
        break;
      case 'field-move':
        try {
          await driver.fieldMove(a.slot, a.move);
        } catch (e) {
          throw new Error(`${where}: field move ${a.slot} ${a.move}: ${(e as Error).message}`, { cause: e });
        }
        break;
      case 'battle':
        try {
          await driver.battleChoose(a.choice);
        } catch (e) {
          throw new Error(`${where}: battle ${a.choice.kind}: ${(e as Error).message}`, { cause: e });
        }
        break;
      case 'wild':
        await driver.setWildBattles(a.mode);
        break;
      case 'evolve':
        await driver.setEvolutions(a.mode);
        break;
      case 'battle-auto': {
        const n = await driver.battleAuto(a.max, a.move);
        if (n === null) throw new Error(`${where}: battle auto: the battle did not end in ${a.max} ticks${await stateHint(driver)}`);
        cursor += n;
        run.ticks += n;
        if (result) result.ticks = run.ticks;
        break;
      }
      case 'grind': {
        const n = await driver.grind(a.slot, a.level, a.dirs, a.max);
        if (n === null) throw new Error(`${where}: grind: party[${a.slot}] did not reach level ${a.level} in ${a.max} ticks${await stateHint(driver)}`);
        cursor += n;
        run.ticks += n;
        if (result) result.ticks = run.ticks;
        break;
      }
      case 'battle-catch': {
        const n = await driver.battleCatch(a.ball, a.max);
        if (n === null) throw new Error(`${where}: battle catch: the battle did not end in ${a.max} ticks, or another prompt came up${await stateHint(driver)}`);
        cursor += n;
        run.ticks += n;
        if (result) result.ticks = run.ticks;
        break;
      }
      case 'clock':
        await driver.setClock(a.date, a.time);
        break;
      case 'open':
        await driver.openMysteryGift();
        break;
      case 'reload': {
        let saved: string;
        try {
          saved = await driver.save();
        } catch (e) {
          throw new Error(`${where}: reload: ${(e as Error).message}`, { cause: e });
        }
        await driver.load(saved);
        const a = JSON.stringify((JSON.parse(saved) as { state: GameState }).state);
        const b = JSON.stringify(canonicalState((await driver.snapshot()).state));
        if (a !== b) throw new Error(`${where}: reload changed the state:\n${firstDifference(a, b)}`);
        break;
      }
      case 'reset': {
        if (!(await driver.snapshot()).reset) throw new Error(`${where}: reset: the game has not reset (no clear_game's credits ended)`);
        const saved = await driver.resetSave();
        if (saved === null) throw new Error(`${where}: reset: the clear wrote no save`);
        await driver.load(saved);
        break;
      }
      case 'until':
      case 'advance-text': {
        let until = a.type === 'until' ? a.until : null;
        if (a.type === 'until' && a.read && until?.kind === 'position') {
          // The coordinates the player reads off the screen when the step runs (`{path}` arguments).
          const state = (await driver.snapshot()).state;
          try {
            until = { ...until, ...(a.read.x && { x: resolveStateArg(a.read.x, state) }), ...(a.read.z && { z: resolveStateArg(a.read.z, state) }) };
          } catch (e) {
            throw new Error(`${where}: ${(e as Error).message}`, { cause: e });
          }
        }
        const n = until ? await driver.until(until, a.max) : await driver.advanceText(a.max, a.type === 'advance-text' && a.close);
        if (n === null) {
          const what = until ? `until ${untilText(until)}` : a.type === 'advance-text' && a.close ? 'advance message' : 'advance text';
          throw new Error(`${where}: ${what}: still ${until && until.kind !== 'idle' ? 'not there' : 'busy'} after ${a.max} ticks${await stateHint(driver)}`);
        }
        cursor += n;
        run.ticks += n;
        if (result) result.ticks = run.ticks;
        break;
      }
      case 'screenshot':
        // A chained replay runs for its state; its screenshots belong to its own run, unless asked for.
        if (!result || (!main && !(name && run.options.chainedScreenshots?.test(name)))) break;
        if (driver.screenshot) result.screenshots.push(await driver.screenshot(a.name));
        else result.skipped.push(`line ${line.line}: screenshot ${a.name}`);
        break;
      case 'viewport':
        if (driver.viewport) await driver.viewport(a.width, a.height);
        else if (result) result.skipped.push(`line ${line.line}: viewport ${a.width}x${a.height}`);
        break;
      case 'assert': {
        const failure = checkAssert(a, await driver.snapshot(), run.options.registries);
        if (failure) throw new Error(`${where}: ${failure}`);
        if (result) result.assertions++;
        break;
      }
    }
  }
}

/**
 * Setup lines edit the state between replays (or right after reset): snapshot → edit → load. Loading
 * re-enters the map like a loaded save, or with a `warp` line as a fresh arrival (the map's onTransition,
 * map-local flags and vars cleared, the map's weather), so a replay with setup lines starts with the map's fade-in.
 */
async function applySetup(run: Run, replay: Replay, label: string): Promise<void> {
  const snap = await run.driver.snapshot();
  if (snap.scriptRunning) throw new Error(`${label} line ${replay.setup[0]!.line}: setup lines need no running script (end the "from" replay idle)`);
  const state = snap.state;
  for (const { line, text, setup } of replay.setup) {
    const failure = setup.type === 'clock' ? undefined : applySetupLine(state, setup, run.options.registries);
    if (failure) throw new Error(`${label} line ${line}: ${failure}`);
    if (setup.type === 'clock') {
      // The saved clock moves with it (an idle replay's GameTime is the frozen clock), so the load
      // neither counts the change as time passed nor as a clock set back (no penalty).
      await run.driver.setClock(setup.date, setup.time);
      state.gameTime.now = withClock(state.gameTime.now, setup.date, setup.time);
    }
    if (run.result) run.result.setup.push(`${label}:${line} ${text}`);
  }
  // Cycling (set here or carried over from the `from` replay) needs a zone whose header allows the bike.
  if (state.playerState === 'cycle' && !run.options.registries.zones.get(state.player.zone)!.flags.bike) {
    const blame = [...replay.setup].reverse().find((s) => s.setup.type === 'player' || s.setup.type === 'warp') ?? replay.setup[0]!;
    throw new Error(`${label} line ${blame.line}: ${blame.setup.type === 'player' ? 'player cycle' : 'warp while cycling'}: ${state.player.zone} does not allow the bike`);
  }
  const warp = replay.setup.some((s) => s.setup.type === 'warp');
  await run.driver.load(JSON.stringify({ format: 'lantern-nds-save', version: 1, savedAt: '1970-01-01T00:00:00.000Z', state }), warp ? 'arrival' : 'load');
}

/**
 * Edits `state` in place; returns a failure message for unknown ids or a slot that leaves a gap. The
 * `date`/`time` lines set the driver's clock (and the saved clock with it; see `applySetup`).
 */
export function applySetupLine(state: GameState, s: Exclude<ReplaySetup, { type: 'clock' }>, registries: Registries): string | undefined {
  switch (s.type) {
    case 'flag': {
      const def = registries.flags.get(s.id);
      if (!def) return `unknown flag ${s.id}`;
      if (s.value === def.initial) delete state.flags[s.id];
      else state.flags[s.id] = s.value;
      return;
    }
    case 'var': {
      const def = registries.vars.get(s.id);
      if (!def) return `unknown var ${s.id}`;
      if (s.value === def.initial) delete state.vars[s.id];
      else state.vars[s.id] = s.value;
      return;
    }
    case 'item':
      if (!registries.items.has(s.id)) return `unknown item ${s.id}`;
      if (!giveItem(state, registries, s.id, s.count)) return `give item ${s.id} ${s.count}: does not fit the bag`;
      return;
    case 'badge':
      if (!state.badges.includes(s.id)) state.badges.push(s.id);
      return;
    case 'party':
      if (!registries.species.has(s.species)) return `unknown species ${s.species}`;
      if (s.slot > state.party.length || s.slot >= PARTY_SIZE) return `party slot ${s.slot}: the party has ${state.party.length} (slots fill in order, at most ${PARTY_SIZE})`;
      for (const m of s.moves) if (!registries.moves.has(m)) return `unknown move ${m}`;
      if (s.moves.length > MAX_MOVES) return `party slot ${s.slot}: ${s.moves.length} moves (at most ${MAX_MOVES})`;
      state.party[s.slot] = setupPokemon(state, registries, s.slot, s.species, s.level, s.moves);
      markCaught(state, registries, state.party[s.slot]!);
      return;
    case 'warp':
      if (!registries.zones.has(s.zone)) return `unknown zone ${s.zone}`;
      // The load is an arrival (applySetup): the zone's objects respawn from its events and the world sets the
      // map's weather. A follower does not come along.
      state.player = { ...state.player, zone: s.zone, x: s.x, z: s.z, y: 0, ...(s.facing ? { facing: s.facing } : {}) };
      state.objects = [];
      state.follower = null;
      state.partyFollower = null;
      return;
    case 'money':
      state.money = s.mode === 'set' ? s.amount : state.money + s.amount;
      if (state.money > MONEY_MAX) return `${s.mode} money ${s.amount}: more than ${MONEY_MAX}`;
      return;
    case 'state': {
      // Writes a value of an existing object: an absent key is an optional field (the load validates it against the
      // save schema, which refuses any other).
      const parent = readStatePath(state, s.path.slice(0, -1));
      const key = s.path.at(-1)!;
      if (parent === null || typeof parent !== 'object' || typeof key === 'object' || (readStatePath(state, s.path) === undefined && (Array.isArray(parent) || typeof key !== 'string'))) return `set state ${s.source}: no such value`;
      (parent as Record<string | number, unknown>)[key] = s.value;
      return;
    }
    case 'giftcodes':
      allowTestGiftCodes();
      return;
    case 'event':
      if (!Object.hasOwn(DEV_EVENTS, s.name)) return `unknown event ${s.name} (${Object.keys(DEV_EVENTS).join(', ')})`;
      grantDevEvent(state, registries, s.name as DevEvent);
      return;
    case 'player':
      // The bike check runs after all setup lines (a `warp` may follow).
      state.playerState = s.state;
      if (s.state === 'cycle') state.cyclingGear = s.gear;
      return;
  }
}

/**
 * save → reset → load, then the loaded state must equal the saved one byte for byte. The loaded state is
 * read from a snapshot, not a second save: loading re-enters the map, whose fade-in keeps the world busy.
 */
async function roundTrip(driver: ReplayDriver, seed: number): Promise<ReplayResult['roundTrip']> {
  let saved: string;
  try {
    saved = await driver.save();
  } catch (e) {
    const message = (e as Error).message;
    if (/cannot save/.test(message)) return { skipped: message };
    throw e;
  }
  await driver.reset(seed);
  // The reset restored the clock option; the replay's frozen clock (whole minutes) comes back with the
  // save, so the load sees no time passed and no clock set back.
  const now = (JSON.parse(saved) as { state: GameState }).state.gameTime.now;
  await driver.setClock(now.date, `${String(now.hour).padStart(2, '0')}:${String(now.minute).padStart(2, '0')}`);
  await driver.load(saved);
  const a = JSON.stringify((JSON.parse(saved) as { state: GameState }).state);
  const b = JSON.stringify(canonicalState((await driver.snapshot()).state));
  if (a !== b) throw new Error(`save round-trip changed the state:\n${firstDifference(a, b)}`);
  return 'identical';
}

function untilText(u: UntilCondition): string {
  if (u.kind === 'position') return `position ${u.x} ${u.z}`;
  if (u.kind === 'app') return `app ${u.app ?? 'none'}`;
  if (u.kind === 'state') return `state ${u.source} ${JSON.stringify(u.value)}`;
  if (u.kind === 'battle-end') return 'battle end';
  if (u.kind === 'wild') return `wild ${u.species}${u.walk ? ` ${u.walk.join(' ')}` : ''}`;
  return u.kind;
}

/** Where the game is when an `until` gives up (player, script, what is on screen). */
async function stateHint(driver: ReplayDriver): Promise<string> {
  const snap = await driver.snapshot();
  const p = snap.state.player;
  const v = snap.view;
  if (snap.battle) return ` (in battle: ${snap.battle.prompt ? `${snap.battle.prompt.kind} prompt` : `message ${JSON.stringify(snap.battle.message?.text.slice(0, 60) ?? '')}`})`;
  const screen = v.yesNo ? 'yes/no' : v.menu ? 'menu' : v.panel.kind === 'choice' ? 'choice' : v.message ? `message${v.message.waitingForInput ? ' (waiting)' : ''} ${JSON.stringify(v.message.text.slice(0, 60))}` : 'no message';
  return ` (player ${p.zone} ${p.x},${p.z} facing ${p.facing}; script ${snap.scriptRunning ? 'running' : 'idle'}; ${screen})`;
}

function firstDifference(a: string, b: string): string {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return `  before: …${a.slice(Math.max(0, i - 60), i + 60)}\n  after:  …${b.slice(Math.max(0, i - 60), i + 60)}`;
}

type Assert = Extract<ReplayAction, { type: 'assert' }>;

/**
 * An `assert text` slot value: a record id (`ns:NAME`) stands for that record's name in the game's language (a
 * species, item, move or ability) or a text record's words; anything else is the slot's text itself.
 */
function slotValue(value: string, registries: Registries): string {
  if (!/^[a-z0-9-]+:/.test(value)) return value;
  const id = value as Id;
  const named = registries.species.get(id) ?? registries.items.get(id) ?? registries.moves.get(id) ?? registries.abilities.get(id);
  if (named) return named.name;
  const text = registries.texts.get(id);
  if (!text) throw new Error(`assert text: no record ${id} for a slot`);
  return text.text;
}

/** Returns a failure message, or undefined when the assertion holds. */
export function checkAssert(a: Assert, snap: GameSnapshot, registries: Registries): string | undefined {
  const s = snap.state;
  const expect = (what: string, expected: unknown, actual: unknown) =>
    JSON.stringify(expected) === JSON.stringify(actual) ? undefined : `assert ${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
  switch (a.what) {
    case 'map':
      return expect('map', a.id, s.player.zone);
    case 'position':
      return expect('position', [a.zone, a.x, a.z], [s.player.zone, s.player.x, s.player.z]);
    case 'flag': {
      const def = registries.flags.get(a.id);
      if (!def) return `assert flag: unknown flag ${a.id}`;
      return expect(`flag ${a.id}`, a.value, s.flags[a.id] ?? def.initial);
    }
    case 'var': {
      const def = registries.vars.get(a.id);
      if (!def) return `assert var: unknown var ${a.id}`;
      return expect(`var ${a.id}`, a.value, s.vars[a.id] ?? def.initial);
    }
    case 'party':
      return expect(`party ${a.index}`, a.species, s.party[a.index]?.species ?? null);
    case 'message':
      return expect('message', a.open ? 'open' : 'closed', snap.view.message ? 'open' : 'closed');
    case 'text':
      return expect('text', a.text, messageText(snap));
    case 'text-id': {
      const rec = registries.texts.get(a.id);
      if (!rec) return `assert text: unknown text ${a.id}`;
      // Colour codes do not show in the text (0.30.0: the deliveryman's item names are coloured).
      const page = rec.text.split('{clear}')[a.page]?.replace(/\{color \d+\}/g, '');
      if (page === undefined) return `assert text ${a.id} ${a.page}: the text has no such page`;
      const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const source = page.split(/(\{var \d+\})/).map((part) => {
        const v = /^\{var (\d+)\}$/.exec(part);
        if (v) return a.vars[Number(v[1])] !== undefined ? escape(slotValue(a.vars[Number(v[1])]!, registries)) : '[^\\n]*';
        if (/\{[^}]*\}/.test(part)) throw new Error(`assert text ${a.id} ${a.page}: the page has a control code other than {var n}`);
        return escape(part);
      });
      const actual = messageText(snap);
      return actual !== null && new RegExp(`^${source.join('')}$`).test(actual) ? undefined : `assert text ${a.id} ${a.page}: expected that page, got ${JSON.stringify(actual)}`;
    }
    case 'facing': {
      if (a.target === 'player') return expect('facing player', a.facing, s.player.facing);
      const objects = s.objects.filter((o) => o.localId === a.target);
      if (objects.length !== 1) return `assert facing ${a.target}: ${objects.length} objects have that local id`;
      return expect(`facing ${a.target}`, a.facing, objects[0]!.facing);
    }
    case 'state': {
      // `battles…` reads the battle log, `mapPopup…` the popup and `app…` the open app's view next to the state; everything else reads GameState.
      const root = a.path[0] === 'battles' ? { battles: snap.battles } : a.path[0] === 'mapPopup' ? { mapPopup: snap.mapPopup } : a.path[0] === 'app' ? { app: snap.app } : s;
      const actual = readStatePath(root, a.path);
      const value = a.name ? slotValue(a.name, registries) : a.value;
      return jsonEqual(value, actual) ? undefined : `assert state ${a.source}: expected ${JSON.stringify(value)}, got ${actual === undefined ? 'nothing' : JSON.stringify(actual)}`;
    }
    case 'battle': {
      const entries = snap.battles.filter((b) => b.kind === a.kind && (a.match === null || (b.trainers.includes(a.match) || b.species.includes(a.match))));
      const what = `assert battle ${a.kind} ${a.match ?? '*'}`;
      if (a.match !== null && !entries.length) return `${what}: no such entry in the battle log`;
      const other = entries.find((b) => b.result !== a.result);
      if (other) return `${what}: expected every result ${JSON.stringify(a.result)}, got ${JSON.stringify(entries.map((b) => b.result))}`;
      const shape = a.topology && entries.find((b) => b.topology !== a.topology);
      return shape ? `${what}: expected every topology ${JSON.stringify(a.topology)}, got ${JSON.stringify(entries.map((b) => b.topology ?? 'none (stub)'))}` : undefined;
    }
    case 'battles':
      return expect(`battles ${a.kind}`, a.count, snap.battles.filter((b) => b.kind === a.kind).length);
    case 'app':
      return expect('app', a.app ?? 'none', snap.app?.app ?? 'none');
  }
}
