/**
 * The Battle Frontier's own apps (contracts `FactoryView`, `HallBoardView`):
 * - the Battle Factory's rental app (decomp battle_factory/main.c): the Poké Balls ride in on the conveyor; RENT picks
 *   the player's three in order (SUMMARY, RENT or REMOVE, CANCEL on each; B takes the last back), the confirm panel
 *   asks YES/NO; in a trade, the player's ball to give (or CANCEL), then the trainer's to take (BACK, CANCEL), and
 *   YES/NO to accept;
 * - the Battle Hall's type board (decomp battle_hall/main.c): a 4 × 5 grid of types with their ranks, the entered
 *   Pokémon's summary cells and the Matron's `???`; a type below rank 10 is confirmed with YES/NO; at the singles 50th
 *   and 170th battles the Matron's message grays the board and only `???` can be picked.
 * Their messages are the ROM's (TEXT_BANK_BATTLE_FACTORY_APP, TEXT_BANK_BATTLE_HALL_SCENE).
 */
import type { Button, Pokemon } from '@opensinnoh/core';
import { isShiny, monGender } from '@opensinnoh/core';
import { dexOf, type FactoryMonView, type FactoryRequest, type FactoryView, type HallBoardRequest, type HallBoardView } from '@opensinnoh/contracts';
import { frontierTables, HALL } from '@opensinnoh/services';
import { menuSe, type MenuContext } from './context.ts';
import { monName } from './party.ts';
import { tapIndex, type Screen, type Step } from './stack.ts';
import { summaryScreen } from './summary.ts';

/** The messages the apps print (checked in the base pack at start). */
export const FRONTIER_APP_TEXTS = [
  'BattleFactoryApp_Text_ChoosePokemon',
  'BattleFactoryApp_Text_OkWithSelection',
  'BattleFactoryApp_Text_Yes',
  'BattleFactoryApp_Text_No',
  'BattleFactoryApp_Text_Summary',
  'BattleFactoryApp_Text_Rent',
  'BattleFactoryApp_Text_Cancel',
  'BattleFactoryApp_Text_Remove',
  'BattleFactoryApp_Text_ChooseExchange',
  'BattleFactoryApp_Text_CancelTrade',
  'BattleFactoryApp_Text_ChooseReceive',
  'BattleFactoryApp_Text_AcceptPokemon',
  'BattleFactoryApp_Text_Exchange',
  'BattleFactoryApp_Text_Back',
  'BattleHallScene_Text_ConfirmSelection',
  'BattleHallScene_Text_BattleHallMatron',
  'BattleHallScene_Text_HallMatronApproaching',
  'BattleHallScene_Text_Yes',
  'BattleHallScene_Text_No',
];

/** Decomp SE_CONFIRM (SEQ_SE_DP_SELECT), SEQ_SE_DP_DECIDE, SEQ_SE_DP_BOX03 (the Hall's refusal), SEQ_SE_DP_UG_020 (the Hall's YES). */
const SE = { confirm: 1500, decide: 1501, refuse: 1523, chosen: 1572 } as const;
/** Decomp sInitialSelectionPokeballPositions, sExchangeSelectPokeballPositions. */
const RENT_BALLS = [24, 64, 104, 144, 184, 224].map((x) => ({ x, y: 112 }));
const SWAP_BALLS = [64, 120, 176].map((x) => ({ x, y: 112 }));
/** Decomp sMonOptionsMenuCursorPositions / sYesNoMenuCursorPositions / the swap's CANCEL, BACK rows (x 212). */
const MENU_X = 212;
const MENU_Y = [144, 160, 176];
/** Decomp CreateMonSprite: the picked Pokémon at (120, 43); the confirm panel's at x 44, 128, 212. */
const MON_AT = { x: 120, y: 43 };
const CONFIRM_X = [44, 128, 212];
/** Decomp ConveyPokeballsOntoScreen: 8 px a DS frame, two DS frames a tick; the balls start a screen to the right. */
const CONVEY_STEP = 16;
const CONVEY_FROM = 256;
/** Decomp UpdateWheelPalette: a palette step every 4 DS frames. */
const WHEEL_TICKS = 2;

/** The rental app (decomp BattleFactoryApp, rent and exchange modes). */
export function factoryScreen(ctx: MenuContext, request: FactoryRequest): Screen {
  const t = ctx.text;
  const dex = dexOf(ctx.registries);
  const se = (n: number) => menuSe(ctx, n);
  const mon = (m: Pokemon): FactoryMonView => ({ species: m.species, form: m.form, gender: monGender(dex, m), shiny: isShiny(m.otId, m.pid), name: monName(ctx, m) });
  const rentals = request.rentals;
  const offers = request.mode === 'swap' ? request.offers : [];
  const count = request.mode === 'rent' ? request.count : 1;
  /** The balls' slide in (decomp State_FadeInApp's conveyor), then the panel. */
  let convey = CONVEY_FROM;
  let tick = 0;
  let stage: FactoryView['stage'] = 'pick';
  let cursor = 0;
  let menuCursor = 0;
  /** Rent: the rentals picked, in order (decomp selectedIndices). Swap: the player's slot to give. */
  const picks: number[] = [];
  let give: number | null = null;
  /** Swap: the cursor on the offers (decomp the receive select), its menu, and the accept question. */
  let receive = false;
  let question: 'confirm' | 'cancel-trade' | 'accept' | null = null;
  let message = '';

  const balls = () => (request.mode === 'rent' || !receive ? (request.mode === 'rent' ? RENT_BALLS : SWAP_BALLS) : SWAP_BALLS);
  const party = () => (receive ? offers : rentals);
  /** The swap's rows below the balls: CANCEL while choosing the one to give, BACK and CANCEL on the offers. */
  const rows = () => (request.mode === 'rent' ? 0 : receive ? 2 : 1);
  const stops = () => party().length + rows();

  const choose = () => {
    message = request.mode === 'rent' ? t.message('BattleFactoryApp_Text_ChoosePokemon', String(picks.length + 1)) : t.message(receive ? 'BattleFactoryApp_Text_ChooseReceive' : 'BattleFactoryApp_Text_ChooseExchange');
  };
  choose();

  const menuEntries = (): string[] => {
    if (question) return [t.message('BattleFactoryApp_Text_Yes'), t.message('BattleFactoryApp_Text_No')];
    if (request.mode === 'swap') return [t.message('BattleFactoryApp_Text_Summary'), t.message('BattleFactoryApp_Text_Exchange'), t.message('BattleFactoryApp_Text_Cancel')];
    return [t.message('BattleFactoryApp_Text_Summary'), t.message(picks.includes(cursor) ? 'BattleFactoryApp_Text_Remove' : 'BattleFactoryApp_Text_Rent'), t.message('BattleFactoryApp_Text_Cancel')];
  };

  const ask = (q: NonNullable<typeof question>, text: string): Step => {
    question = q;
    stage = 'confirm';
    menuCursor = q === 'confirm' || q === 'accept' ? 0 : 1;
    message = text;
    return;
  };
  const backToPick = (): Step => {
    question = null;
    stage = receive ? 'receive' : 'pick';
    choose();
    return;
  };

  /** A ball picked with A: its options (decomp OpenMonOptionsMenu). */
  const openMenu = (): Step => {
    se(SE.confirm);
    stage = 'menu';
    menuCursor = 0;
    return;
  };
  /** The option chosen (decomp State_SelectInitialParty case 2, State_SelectMonToExchange / Receive). */
  const option = (i: number): Step => {
    se(SE.confirm);
    if (i === 0) {
      stage = receive ? 'receive' : 'pick';
      return { push: summaryScreen(ctx, { party: () => party(), slot: cursor, mode: { kind: 'view' } }) };
    }
    if (i === 2) return backToPick();
    if (request.mode === 'rent') {
      const at = picks.indexOf(cursor);
      if (at >= 0) picks.splice(at, 1);
      else picks.push(cursor);
      if (picks.length === count) return ask('confirm', t.message('BattleFactoryApp_Text_OkWithSelection', String(count)));
      return backToPick();
    }
    if (!receive) {
      give = cursor;
      receive = true;
      cursor = 0;
      return backToPick();
    }
    return ask('accept', t.message('BattleFactoryApp_Text_AcceptPokemon'));
  };
  /** A YES/NO answer (decomp State_ConfirmPartySelection case 5, the trade's cancel and accept questions). */
  const answer = (yes: boolean): Step => {
    se(SE.confirm);
    const q = question;
    question = null;
    if (q === 'confirm') {
      if (yes) return { close: { app: 'factory', picks: [...picks] } };
      // Decomp: NO takes the last pick back.
      picks.pop();
      return backToPick();
    }
    if (q === 'cancel-trade') return yes ? { close: { app: 'factory', swap: null } } : backToPick();
    if (yes) return { close: { app: 'factory', swap: [give!, cursor] } };
    return backToPick();
  };

  const pickInput = (b: Button): Step => {
    const n = party().length;
    if (b === 'left' || b === 'right') {
      if (cursor >= n) return;
      cursor = (cursor + (b === 'left' ? n - 1 : 1)) % n;
      se(SE.confirm);
      return;
    }
    if (request.mode === 'swap' && (b === 'up' || b === 'down')) {
      // Decomp sExchangeSelectCursorPositions: the balls, then the rows at the bottom right.
      const s = stops();
      cursor = b === 'down' ? (cursor < n ? n : Math.min(s - 1, cursor + 1)) : cursor > n ? cursor - 1 : cursor === n ? 0 : cursor;
      se(SE.confirm);
      return;
    }
    if (b === 'a') {
      if (cursor < n) return openMenu();
      se(SE.confirm);
      // The swap's rows: CANCEL asks to cancel the trade; on the offers, BACK goes back to the player's balls.
      if (!receive || cursor === n + 1) return ask('cancel-trade', t.message('BattleFactoryApp_Text_CancelTrade'));
      receive = false;
      cursor = give ?? 0;
      give = null;
      return backToPick();
    }
    if (b === 'b') {
      if (request.mode === 'rent') {
        if (!picks.length) return;
        se(SE.confirm);
        picks.pop();
        choose();
        return;
      }
      se(SE.confirm);
      if (receive) {
        receive = false;
        cursor = give ?? 0;
        give = null;
        return backToPick();
      }
      return ask('cancel-trade', t.message('BattleFactoryApp_Text_CancelTrade'));
    }
    return;
  };

  const menuInput = (b: Button): Step => {
    const n = menuEntries().length;
    if (b === 'up' || b === 'down') {
      menuCursor = (menuCursor + (b === 'up' ? n - 1 : 1)) % n;
      se(SE.confirm);
      return;
    }
    if (b === 'a') return question ? answer(menuCursor === 0) : option(menuCursor);
    if (b === 'b') return question ? answer(false) : option(2);
    return;
  };

  const view = (): FactoryView => {
    const n = party().length;
    const at = balls();
    const onBall = cursor < n;
    const menuOpen = stage === 'menu' || stage === 'confirm';
    const shown: FactoryView['mons'] = [];
    if (request.mode === 'rent' && question === 'confirm') picks.forEach((p, i) => shown.push({ ...mon(rentals[p]!), x: CONFIRM_X[i]!, y: MON_AT.y }));
    else if (onBall) shown.push({ ...mon(party()[cursor]!), ...MON_AT });
    const names = request.mode === 'rent' ? [...picks.map((p) => monName(ctx, rentals[p]!)), ...(picks.length < count && onBall && !picks.includes(cursor) ? [monName(ctx, rentals[cursor]!)] : [])] : onBall ? [monName(ctx, party()[cursor]!)] : [];
    return {
      app: 'factory',
      mode: request.mode,
      stage: convey > 0 ? 'message' : stage,
      panel: question === 'confirm' ? 'summary' : 'selection',
      balls: at.slice(0, n).map((b, i) => ({ x: b.x + convey, y: b.y, picked: request.mode === 'rent' ? picks.includes(i) : !receive && give === i })),
      cursor: menuOpen ? { x: MENU_X, y: MENU_Y[menuCursor]!, menu: true } : onBall ? { x: at[cursor]!.x, y: at[cursor]!.y, menu: false } : { x: MENU_X, y: MENU_Y[cursor - n]!, menu: true },
      mons: convey > 0 ? [] : shown,
      names: convey > 0 ? [] : names,
      playerName: ctx.state.names.player,
      message: convey > 0 ? '' : message,
      menu: menuOpen ? { entries: menuEntries(), cursor: menuCursor } : request.mode === 'swap' && convey === 0 ? { entries: receive ? [t.message('BattleFactoryApp_Text_Back'), t.message('BattleFactoryApp_Text_Cancel')] : [t.message('BattleFactoryApp_Text_Cancel')], cursor: cursor - n } : null,
      conveyor: (CONVEY_FROM - convey) % 512,
      wheel: Math.floor(tick / WHEEL_TICKS) % 4,
    };
  };

  return {
    view,
    tick() {
      tick++;
      if (convey > 0) convey = Math.max(0, convey - CONVEY_STEP);
      return;
    },
    input(i): Step {
      if (convey > 0) return;
      if ('tap' in i) {
        const ball = tapIndex(i.tap, 'ball');
        if (ball !== null && (stage === 'pick' || stage === 'receive') && ball < party().length) {
          cursor = ball;
          return openMenu();
        }
        const entry = tapIndex(i.tap, 'entry');
        if (entry !== null) {
          if (stage === 'menu' || stage === 'confirm') {
            menuCursor = entry;
            return question ? answer(entry === 0) : option(entry);
          }
          if (request.mode === 'swap') {
            cursor = party().length + entry;
            return pickInput('a');
          }
        }
        if (i.tap === 'back') return stage === 'menu' || stage === 'confirm' ? menuInput('b') : pickInput('b');
        return;
      }
      return stage === 'menu' || stage === 'confirm' ? menuInput(i.button) : pickInput(i.button);
    },
  };
}

/** Decomp BattleHall_CursorPosToType's grid: 4 columns, 5 rows (GRID_WIDTH, GRID_HEIGHT). */
const GRID_W = 4;
const GRID_CELLS = 20;
/** The cells that are the Pokémon's summary (decomp BATTLE_HALL_MON_SUMMARY) and the Matron's `???`. */
const SUMMARY_CELLS = [17, 18];
const MATRON_CELL = 19;
/** Decomp SELECT_STATE_OPEN_YES_NO: 8 DS frames before the YES/NO. */
const YES_NO_DELAY = 4;

/** The Hall's type board (decomp BattleHallApp, single and double). */
export function hallBoardScreen(ctx: MenuContext, request: HallBoardRequest): Screen {
  const t = ctx.text;
  const dex = dexOf(ctx.registries);
  const se = (n: number) => menuSe(ctx, n);
  const grid = frontierTables(ctx.registries).hall.grid;
  const first = request.party[0];
  if (!first) throw new Error('hall board: no Pokémon entered');
  /** Decomp GetCursorPos: cells 17–19 read rank 17. */
  const rankOf = (cell: number) => request.ranks[Math.min(cell, 17)] ?? 0;
  let cursor = Math.min(request.cursor, GRID_CELLS - 1);
  let prev = cursor;
  let matron = false;
  /** The cell the player confirmed before the Matron came (decomp savedCursorPos: 0x75 none). */
  let saved: number | null = null;
  let selected: number | null = null;
  let delay = 0;
  let yesNo: { yes: string; no: string; cursor: number } | null = null;
  let message: string | null = null;
  /** The Matron's message pages (A or B turns them). */
  let pages: string[] | null = null;
  let page = 0;
  const comesMatron = () => request.challengeType === 0 && (request.streak === HALL.silver || request.streak === HALL.gold);
  const isSummary = (cell: number) => SUMMARY_CELLS.includes(cell);
  const typeName = (cell: number): string => {
    const type = grid[cell]!;
    if (type === 'summary') return '';
    return ctx.registries.types.get(type)?.name ?? '';
  };

  /** Decomp UpdateCursorPosition: wraps in rows and columns; the summary cells count as one. */
  const move = (b: Button) => {
    if (!isSummary(cursor)) prev = cursor;
    if (b === 'left') cursor = cursor % GRID_W === 0 ? cursor + GRID_W - 1 : isSummary(cursor) ? 16 : cursor - 1;
    else if (b === 'right') cursor = cursor % GRID_W === GRID_W - 1 ? cursor - (GRID_W - 1) : isSummary(cursor) ? 19 : cursor + 1;
    else if (b === 'up') {
      if (cursor < GRID_W) cursor += GRID_W * 4;
      else if (isSummary(cursor)) cursor = prev === 16 || prev === 13 || prev === 1 ? 13 : 14;
      else cursor -= GRID_W;
    } else if (b === 'down') {
      if (cursor >= GRID_W * 4) cursor -= GRID_W * 4;
      else if (isSummary(cursor)) cursor = prev === 16 || prev === 13 || prev === 1 ? 1 : 2;
      else cursor += GRID_W;
    }
    se(SE.confirm);
  };
  const confirmText = (cell: number) => (matron ? t.message('BattleHallScene_Text_BattleHallMatron') : t.message('BattleHallScene_Text_ConfirmSelection', typeName(cell), String(Math.min(HALL.maxRank, rankOf(cell) + 1))));

  /** Decomp SELECT_STATE_MAKE_PICK's A. */
  const pick = (): Step => {
    if (isSummary(cursor)) {
      se(SE.decide);
      return { push: summaryScreen(ctx, { party: () => request.party, slot: 0, mode: { kind: 'view' } }) };
    }
    if (matron ? cursor !== MATRON_CELL : rankOf(cursor) >= HALL.maxRank || cursor === MATRON_CELL) {
      se(SE.refuse);
      return;
    }
    se(SE.decide);
    selected = cursor;
    delay = YES_NO_DELAY;
    return;
  };
  const answer = (yes: boolean): Step => {
    yesNo = null;
    message = null;
    if (!yes) {
      selected = null;
      return;
    }
    // Decomp: YES with the Matron due prints her message and moves the cursor to `???`.
    if (comesMatron() && !matron) {
      saved = cursor;
      selected = null;
      pages = t.messagePages('BattleHallScene_Text_HallMatronApproaching');
      page = 0;
      return;
    }
    se(SE.chosen);
    return { close: { app: 'hall-board', cell: saved ?? cursor } };
  };

  const view = (): HallBoardView => ({
    app: 'hall-board',
    cells: Array.from({ length: GRID_CELLS }, (_, cell) => {
      const summary = isSummary(cell);
      const unselectable = matron ? cell < GRID_CELLS - 3 : cell === MATRON_CELL || (cell < 17 && rankOf(cell) >= HALL.maxRank);
      return {
        label: typeName(cell),
        rank: summary || cell === MATRON_CELL ? null : Math.min(HALL.maxRank, rankOf(cell) + 1),
        state: selected === cell ? ('selected' as const) : unselectable ? ('unselectable' as const) : ('normal' as const),
      };
    }),
    cursor,
    mon: { species: first.species, form: first.form, gender: monGender(dex, first), shiny: isShiny(first.otId, first.pid), name: monName(ctx, first) },
    message: pages ? pages[page]! : message,
    yesNo,
  });

  return {
    view,
    tick() {
      if (delay > 0 && --delay === 0) {
        message = confirmText(selected!);
        yesNo = { yes: t.message('BattleHallScene_Text_Yes'), no: t.message('BattleHallScene_Text_No'), cursor: 0 };
      }
      return;
    },
    input(i): Step {
      if (delay > 0) return;
      const button = 'button' in i ? i.button : null;
      if (pages) {
        if (button === 'a' || button === 'b' || ('tap' in i && i.tap === 'next')) {
          if (++page < pages.length) return;
          // Decomp SELECT_STATE_HIGHLIGHT_MATRON_CELL: the board grays, the cursor on `???`.
          pages = null;
          matron = true;
          cursor = MATRON_CELL;
        }
        return;
      }
      if (yesNo) {
        if ('tap' in i) {
          const e = tapIndex(i.tap, 'entry');
          return e === null ? undefined : (se(SE.confirm), answer(e === 0));
        }
        if (button === 'up' || button === 'down') {
          yesNo.cursor = 1 - yesNo.cursor;
          se(SE.confirm);
        } else if (button === 'a') return (se(SE.confirm), answer(yesNo.cursor === 0));
        else if (button === 'b') return (se(SE.confirm), answer(false));
        return;
      }
      if ('tap' in i) {
        const cell = tapIndex(i.tap, 'cell');
        if (cell === null || cell < 0 || cell >= GRID_CELLS) return;
        cursor = cell;
        return pick();
      }
      if (button === 'a') return pick();
      if (button === 'up' || button === 'down' || button === 'left' || button === 'right') move(button);
      return;
    },
  };
}
