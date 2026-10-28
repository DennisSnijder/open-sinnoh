/**
 * `window.openSinnohGame` (contracts bridge.ts). Press/touch write into the same InputState as the
 * keyboard and panel, and `advance` runs the same tick function as the wall-clock loop.
 * `reset` and `load` remount the renderer, so they resolve once the new scene is mounted.
 * App additions: `until` and `advanceText` (the replay grammar's waits, run in the page) and the recorder.
 */
import type { Button, Id, UntilCondition } from '@opensinnoh/core';
import type { DeviceOptions, GameSnapshot, OpenSinnohBridge } from '@opensinnoh/contracts';
import { advanceMessage, advanceText, battleAuto, battleCatch, grind, runUntil, saveToJson, type UntilTarget } from '@opensinnoh/game';
import type { Session } from './boot.ts';
import type { InputState } from './input.ts';

export interface AppBridge extends OpenSinnohBridge {
  /** `until …` (game `runUntil`): the ticks advanced, or null after `max`. */
  until(until: UntilCondition, max: number): number | null;
  /** `advance text` (game `advanceText`), or with `close` `advance message` (game `advanceMessage`): the ticks advanced, or null after `max`. */
  advanceText(max: number, close?: boolean): number | null;
  /** `battle auto` (game `battleAuto`): the ticks advanced, or null when it failed. */
  battleAuto(max: number, move?: number): number | null;
  /** `grind` (game `grind`): the ticks advanced, or null when it failed. */
  grind(slot: number, level: number, dirs: [Button, Button], max: number): number | null;
  /** `battle catch <ball>` (game `battleCatch`): the ticks advanced, or null when it failed. */
  battleCatch(ball: Id, max: number): number | null;
  /**
   * A device option, as Options sets it (replays play with the contract defaults: specs of the OpenSinnoh additions
   * turn theirs on here).
   */
  setOption(key: keyof DeviceOptions, value: number): void;
  /** Resets to a new game (replay seed, default names) and records input from there. */
  startRecording?(): Promise<void>;
  /** The recording so far as `.replay` text, or null when not recording. */
  recording?(): string | null;
}

export function createBridge(deps: {
  input: InputState;
  session: () => Session;
  tick: () => void;
  reset: (seed?: number) => Promise<void>;
  recordingTools?: Pick<AppBridge, 'startRecording' | 'recording'>;
  setOption: AppBridge['setOption'];
}): AppBridge {
  const target: UntilTarget = {
    tick: deps.tick,
    canSave: () => deps.session().game.canSave(),
    view: () => deps.session().game.scripts.view(),
    state: () => deps.session().game.state,
    battles: () => deps.session().game.battles,
    mapPopup: () => deps.session().game.mapPopup(),
    radar: () => deps.session().game.world.radarPatches(),
    battle: () => deps.session().game.battle?.view() ?? null,
    inBattle: () => deps.session().game.inBattle(),
    app: () => deps.session().game.app()?.app ?? null,
    blackOutWaiting: () => deps.session().game.blackOutScreen()?.waiting === true,
    press: (b) => deps.input.set('bridge', b, true),
    release: (b) => deps.input.set('bridge', b, false),
    battleChoose: (c) => deps.session().game.battleChoose(c),
    wildBattles: () => deps.session().game.wildBattles,
    registries: () => deps.session().game.registries,
    evolutions: () => deps.session().game.evolutions,
    appView: () => deps.session().game.app(),
    tap: (id) => deps.input.tap(id),
  };
  return {
    ready: false,
    reset: (seed) => deps.reset(seed),
    advance(ticks: number) {
      if (!Number.isInteger(ticks) || ticks < 0) throw new Error(`advance: ticks must be a non-negative integer, got ${ticks}`);
      for (let i = 0; i < ticks; i++) deps.tick();
    },
    press: (button: Button) => deps.input.set('bridge', button, true),
    release: (button: Button) => deps.input.set('bridge', button, false),
    touch: (x, y) => deps.input.setTouch('bridge', { x, y }),
    untouch: () => deps.input.setTouch('bridge', null),
    tap: (id) => deps.input.tap(id),
    snapshot: (): GameSnapshot => deps.session().game.snapshot(),
    save: () => deps.session().save(),
    load: (json, entry) => deps.session().load(json, entry),
    resetSave: () => {
      const save = deps.session().game.resetSave();
      return save ? saveToJson(save) : null;
    },
    until: (until, max) => runUntil(target, until, max),
    advanceText: (max, close) => (close ? advanceMessage : advanceText)(target, max),
    battleAuto: (max, move) => battleAuto(target, max, move),
    grind: (slot, level, dirs, max) => grind(target, slot, level, dirs, max),
    battleCatch: (ball, max) => battleCatch(target, ball, max),
    useFieldMove: (slot, move, location) => deps.session().game.useFieldMove(slot, move, location),
    usableFieldMoves: () => deps.session().game.usableFieldMoves(),
    setClock: (date, time) => deps.session().game.setClock(date, time),
    battleView: () => deps.session().game.battle?.view() ?? null,
    battleChoose: (choice) => deps.session().game.battleChoose(choice),
    setWildBattles: (mode) => {
      deps.session().game.wildBattles = mode;
    },
    setEvolutions: (mode) => {
      deps.session().game.evolutions = mode;
    },
    openMysteryGift: () => deps.session().game.openMysteryGift(),
    setOption: deps.setOption,
    ...deps.recordingTools,
  };
}
