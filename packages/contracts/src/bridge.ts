/**
 * Test/automation bridge on `window.openSinnohGame` (contracts v0.2). Used by `opensinnoh test` and
 * Playwright replays. In replay mode the wall-clock loop is off and only `advance` moves time.
 */
import type { Button, Id } from '@opensinnoh/core';
import type { BattleChoice, BattleOutcome, BattleTopology, BattleView } from './battle.ts';

/** How wild encounters go (replay `wild …`): no battle (`flee`), a battle, or a battle the replay's waits fight (`auto`). */
export type WildBattleMode = 'flee' | 'battle' | 'auto';
/** 0.21.1. How the replay's waits treat the evolution scene (replay `evolve …`): not at all, play it, or stop it with B. */
export type EvolutionMode = 'manual' | 'auto' | 'cancel';
import type { AppView } from './apps.ts';
import type { MapEntry } from './runtime.ts';
import type { ScriptView } from './field.ts';
import type { GameState } from './state.ts';

/**
 * Battles that happened, real or stubbed (double trainer battles are still logged stubs). `trainer` covers
 * trainer singles and the first battle; `scripted` the catching tutorial and stubs.
 * `tick` is when the battle ended. Kept next to the state, never saved.
 */
export interface BattleLogEntry {
  tick: number;
  /** 0.34.0 `frontier`: a Battle Frontier battle (its `trainers` are empty; the frontier trainers are the frontier's). */
  kind: 'trainer' | 'wild' | 'scripted' | 'frontier';
  trainers: Id[];
  species: Id[];
  result: BattleOutcome;
  /** Turns played; absent for stubbed battles. */
  turns?: number;
  /** 0.25.0. The battle's topology; absent for stubbed battles. */
  topology?: BattleTopology;
}

export interface GameSnapshot {
  battles: BattleLogEntry[];
  /** The running battle, or null in the field. */
  battle: BattleView | null;
  tick: number;
  state: GameState;
  scriptRunning: boolean;
  view: ScriptView;
  fade: { color: 'black' | 'white'; alpha: number } | null;
  /** The open menu app's view (0.11.0), or null. */
  app: AppView | null;
  /** The map-name popup on the field, or null. */
  mapPopup: MapPopupView | null;
  /** 0.23.0. The blackout screen, or null. */
  blackOut: BlackOutView | null;
  /**
   * 0.27.19. The game reset after `clear_game`'s credits (decomp OS_ResetSystem): it no longer ticks; the
   * title's CONTINUE loads the save the clear wrote (`OpenSinnohBridge.resetSave`).
   */
  reset: boolean;
}

/**
 * 0.23.0. The blackout screen (decomp FieldTask_BlackOutFromBattle, sub_02052914): the screen black, and
 * TEXT_BANK_BLACK_OUT_SCENE's "{player} scurried to a Pokémon Center…" (or "…back home…") centred in white,
 * faded in and out by `alpha` (0–1); `waiting`: A or B goes on. The warp has happened behind it.
 */
export interface BlackOutView {
  text: string;
  alpha: number;
  waiting: boolean;
}

/**
 * The map-name popup (decomp overlay 5 map_name_popup.c), timed by the game at 30 Hz: the signboard at the
 * top-left of the field, scrolled up by `offset` DS px (38 = hidden, 0 = fully shown). Not saved.
 */
export interface MapPopupView {
  name: string;
  /** The signboard (`Zone.mapPopup.window`, a `ui2d` sheet). */
  window: Id;
  offset: number;
  phase: 'in' | 'hold' | 'out';
}

export interface OpenSinnohBridge {
  ready: boolean;
  reset(seed?: number): Promise<void>;
  advance(ticks: number): void;
  press(button: Button): void;
  release(button: Button): void;
  touch(x: number, y: number): void;
  untouch(): void;
  /** Taps an element of the open menu app on the next tick (`InputFrame.tap`, 0.11.0). */
  tap(id: string): void;
  snapshot(): GameSnapshot;
  save(): string;
  /** Loads a save; `arrival` (0.28.4) enters its map as a fresh arrival (the replay `warp` setup), not as a loaded save. */
  load(json: string, entry?: MapEntry): void;
  /** 0.27.19. The save `clear_game` wrote before its credits (what CONTINUE loads after the reset), or null. */
  resetSave(): string | null;
  /**
   * Uses a field move from the party menu (game `useFieldMove`; decomp FieldMoves_SetUsableMoves +
   * `FIELD_MOVES` scripts). Throws when the move is not usable now. 0.29.0: Fly takes the Town Map location index.
   */
  useFieldMove(slot: number, move: Id, location?: number): void;
  /** The field moves the party could use now (what the party menu would offer). */
  usableFieldMoves(): { slot: number; move: Id }[];
  /**
   * Freezes the game clock at a date (`yyyy-mm-dd`) and/or time (`hh:mm`, seconds 0); the other part
   * stays as the clock reads now (0.17.0; replaces `setDate`). A reset restores the game's clock option.
   */
  setClock(date?: string, time?: string): void;
  /** The running battle's view, or null in the field. */
  battleView(): BattleView | null;
  /** Answers the running battle's prompt (`Battle.choose`); throws when none waits. */
  battleChoose(choice: BattleChoice): void;
  /**
   * Replay `wild flee|battle|auto`: wild encounters flee without a battle (the original stub), battle, or battle and
   * are fought by the replay's waits with the `battle auto` policy (0.14.0). A reset restores `battle`.
   */
  setWildBattles(mode: WildBattleMode): void;
  /** 0.21.1. Replay `evolve manual|auto|cancel` (game `evolutions`); a reset restores `manual`. */
  setEvolutions(mode: EvolutionMode): void;
  /** 0.30.0. Replay `open mystery-gift`: Mystery Gift over the idle field (game `openMysteryGift`). */
  openMysteryGift(): void;
}
