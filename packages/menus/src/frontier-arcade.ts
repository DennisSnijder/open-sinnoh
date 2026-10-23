/**
 * The Battle Arcade's game board (contracts `ArcadeView`; decomp battle_arcade/main.c): the board's 16 panels get
 * their effects (by the round, the battle and the last battle's performance; services `arcadeBoard`), turn over, and
 * the cursor runs over them at the board's speed (or jumps at random) until STOP is touched or 30 seconds pass. A
 * stands in for the touch (the keyboard has no touch screen), as the intro's Poké Ball does. Its draws are the game's
 * RNG (decomp LCRNG_Next), in the decomp's order: the random number, the cursor's start, the board, the jumps.
 */
import { Prng } from '@opensinnoh/core';
import type { ArcadeRequest, ArcadeView } from '@opensinnoh/contracts';
import { ARCADE, arcadeAvailableEffects, arcadeBoard, arcadeTier, frontierTables } from '@opensinnoh/services';
import { menuSe, type MenuContext } from './context.ts';
import type { Screen, Step } from './stack.ts';

/** Decomp ANIM_ID_TILE_3, _2, _1 (the panels turning over), ANIM_ID_BUTTON_* (sub-screen sprites). */
const TILE = { three: 32, two: 33, one: 34 } as const;
const BUTTON = { up: 0, pressed: 1, inactive: 2 } as const;
/** Decomp SEQ_SE_DP_WIN_OPEN2 (a turn), SEQ_SE_DP_UG_020 (the effects shown), SEQ_SE_DP_BUTTON3 (a cursor step), SEQ_SE_DP_BUTTON9 (STOP), SEQ_SE_DP_PIRORIRO2 (the result). */
const SE = { turn: 1545, shown: 1572, step: 1509, stop: 1508, result: 1507 } as const;
/**
 * Decomp State_FadeInApp: its steps (one a tick, the board drawn at steps 2–4), then StartScreenFade(6 steps, 3 frames);
 * State_OperateRoulette: 1 tick, 10, then three turns of 24, the spin, 30 after the result; State_FadeOutApp: 6 × 1.
 */
const FADE_IN = { steps: 8, fade: 18 } as const;
const WAIT_START = 10;
const TURN = 24;
const AFTER_RESULT = 30;
const FADE_OUT = 6;
/** Decomp rouletteTimer: 30 seconds at 30 ticks. */
const TIMER = 30 * 30;

type Stage = 'fade-in' | 'start' | 'wait' | 'turn-3' | 'turn-2' | 'turn-1' | 'spin' | 'stopped' | 'result' | 'fade-out';

/** The Battle Arcade's game board (decomp BattleArcadeApp), single player. */
export function arcadeScreen(ctx: MenuContext, request: ArcadeRequest): Screen {
  const t = frontierTables(ctx.registries).arcade;
  const se = (n: number) => menuSe(ctx, n);
  /** Decomp LCRNG_Next on the game's stream (the VM's draws come from the same `state.rng`). */
  const rand = (): number => {
    const p = Prng.from(ctx.state.rng);
    const v = p.next() >>> 16;
    ctx.state.rng = p.save();
    return v;
  };
  // Decomp BattleArcadeApp_Init: the random number the effects use, then the cursor's start.
  const random = rand();
  const start = rand() % ARCADE.grid;
  let board: number[] = [];
  let stage: Stage = 'fade-in';
  let ticks = 0;
  let cursor = start;
  let cursorShown = false;
  let tiles: number | null = null;
  let button: 0 | 1 | 2 = BUTTON.inactive;
  let moveTimer = 0;
  let timer = TIMER;
  let effect: number | null = null;
  let roulette = false;

  const advance = (next: Stage) => {
    stage = next;
    ticks = 0;
  };

  const view = (): ArcadeView => ({
    app: 'arcade',
    board: roulette ? 'roulette' : 'initial',
    tiles: Array.from({ length: ARCADE.grid }, (_, i) => ({ anim: effect !== null ? effect : tiles === null ? TILE.three : tiles >= 0 ? tiles : board[i]!, visible: tiles !== null || effect !== null })),
    cursor: cursorShown ? cursor : null,
    button,
    player: request.party.map((m) => ({ species: m.species, form: m.form, item: m.heldItem !== null })),
    opponents: request.opponents.map((m) => ({ species: m.species, form: m.form, item: m.heldItem !== null })),
  });

  return {
    view,
    tick(f): Step {
      ticks++;
      switch (stage) {
        case 'fade-in':
          // Decomp substates 2–4: GetAvailableEffects, GetEffectCategoryCounts, AssignEffectsToGrid.
          if (ticks === 3) board = arcadeBoard(t, rand, arcadeAvailableEffects(t, request.round, request.streak), arcadeTier(t, request.performance));
          if (ticks >= FADE_IN.steps + FADE_IN.fade) advance('start');
          return;
        case 'start':
          cursor = start;
          advance('wait');
          return;
        case 'wait':
          if (ticks < WAIT_START) return;
          // Decomp substate 2: the panels' backs, the roulette's tilemap.
          tiles = TILE.three;
          roulette = true;
          se(SE.turn);
          advance('turn-3');
          return;
        case 'turn-3':
        case 'turn-2':
          if (ticks < TURN) return;
          tiles = stage === 'turn-3' ? TILE.two : TILE.one;
          se(SE.turn);
          advance(stage === 'turn-3' ? 'turn-2' : 'turn-1');
          return;
        case 'turn-1':
          if (ticks < TURN) return;
          // Decomp substate 5: the effects face up, the cursor and the STOP button live.
          tiles = -1;
          cursorShown = true;
          button = BUTTON.up;
          se(SE.shown);
          advance('spin');
          return;
        case 'spin': {
          // Decomp UpdateCursorPosition: a step every sCursorMoveFrames[speed] ticks (random under RANDOMIZE_CURSOR).
          if (++moveTimer >= t.cursorTicks[request.speed]!) {
            moveTimer = 0;
            cursor = request.randomCursor ? rand() % ARCADE.grid : (cursor + 1) % ARCADE.grid;
            se(SE.step);
          }
          if (timer > 0) timer--;
          const stop = f.tap === 'stop' || f.pressed.includes('a');
          if (stop) {
            button = BUTTON.pressed;
            se(SE.stop);
          }
          if (!stop && timer > 0) return;
          advance('stopped');
          return;
        }
        case 'stopped':
          // Decomp substate 7, SetSelectedEffect: every panel shows the result.
          effect = board[cursor]!;
          se(SE.result);
          advance('result');
          return;
        case 'result':
          if (ticks < AFTER_RESULT) return;
          advance('fade-out');
          return;
        case 'fade-out':
          if (ticks < FADE_OUT) return;
          return { close: { app: 'arcade', effect: effect!, cursor, random } };
      }
    },
    input(): Step {
      return;
    },
  };
}
