/**
 * The Frontier's record viewer (decomp applications/frontier/records/main.c and windows.c), one DS frame per tick: the
 * facility's record lines from the saved Frontier state, a 6-step fade in at 3 frames a step, then A or B (or a tap)
 * fades it out over 6 frames and it closes. Each line sits in its window (tiles) at the offset and alignment the decomp
 * prints it with; numbers are 4 digits padded with spaces (SetStringTemplateNumber).
 */
import { FRONTIER_CHALLENGE, FRONTIER_FACILITY, newGameRecord, type FrontierRecordsRequest, type FrontierRecordsView, type GameState } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { factoryIndex } from '@opensinnoh/services';
import { plainText } from './strings.ts';
import type { MenuContext } from './context.ts';
import type { Screen, Step } from './stack.ts';

const BLACK = 16;
/** StartScreenFade(…, 6, 3) in and (…, 6, 1) out. */
const FADE_IN = { steps: 6, frames: 3 };
const FADE_OUT = { steps: 6, frames: 1 };
const TILE = 8;
/** BattleFrontierRecords_Text_* (res/text/battle_frontier_records.json), by name. */
const T = (name: string) => `BattleFrontierRecords_Text_${name}`;
/** Decomp WifiBattleTowerRecord's "streak in progress" bit per tower mode (GetBattleTowerLatestStreakEntryID: 8 + mode). */
const TOWER_ACTIVE_BIT = 8;
const LINK_MULTI = 3;

type Line = FrontierRecordsView['lines'][number];

/** The record lines of a facility (decomp DisplayRecords), from the saved state. */
export function frontierRecordLines(ctx: MenuContext, request: FrontierRecordsRequest): Line[] {
  const { challengeType: type, facility } = request;
  const text = (name: string, ...slots: string[]) => {
    const rec = ctx.registries.texts.get(ctx.text.id(T(name)));
    if (!rec) throw new Error(`frontier records: no text ${T(name)}`);
    return plainText(rec.text, slots);
  };
  const num = (n: number) => String(n).padStart(4, ' ');
  const lines: Line[] = [];
  /** PrintMessage in the window at tiles (wx, wy), the text at x px inside it. */
  const at = (wx: number, wy: number, value: string, x = 0, align: Line['align'] = 'left') => lines.push({ text: value, x: wx * TILE + x, y: wy * TILE, align });
  const header = (facilityName: string) => {
    at(2, 2, text(facilityName), 8);
    at(2, 2, text(type === FRONTIER_CHALLENGE.single ? 'SingleRecord' : type === FRONTIER_CHALLENGE.double ? 'DoubleRecord' : 'MultiRecord'), 216, 'right');
  };
  const prevOrCurrent = (active: boolean | undefined) => text(active ? 'Current' : 'Prev');
  const f = ctx.state.frontier;
  switch (facility) {
    case FRONTIER_FACILITY.factory:
    case FRONTIER_FACILITY.factoryOpen: {
      header('BattleFactory');
      const block = (open: boolean, y: number) => {
        const i = factoryIndex(open, type);
        const s = f?.factory?.streaks[i] ?? { record: 0, latest: 0, recordTrades: 0, latestTrades: 0 };
        at(2, y, text(open ? 'OpenLevel' : 'Level50'));
        if (!open) at(2, y, text('RentalTrade'), 224, 'right');
        at(2, y + 3, prevOrCurrent(f?.factory?.active[i]));
        at(2, y + 3, text('WinStreak', num(s.latest)), 112, 'centre');
        at(2, y + 3, text('Number', num(s.latestTrades)), 224, 'right');
        at(2, y + 5, text('Record'));
        at(2, y + 5, text('WinStreak', num(s.record)), 112, 'centre');
        at(2, y + 5, text('Number', num(s.recordTrades)), 224, 'right');
      };
      block(false, 7);
      block(true, 15);
      break;
    }
    case FRONTIER_FACILITY.hall: {
      header('BattleHall');
      const species = request.species;
      if (!species) throw new Error('frontier records: the Hall record needs a species');
      const name = ctx.registries.species.get(species)?.name;
      if (name === undefined) throw new Error(`frontier records: unknown species ${species}`);
      const hall = f?.hall;
      at(2, 7, text('MonsRecord', name));
      // Decomp DisplayBattleHallRecord: always PREV; the latest streak only for the species it was set with.
      at(2, 10, text('Prev'));
      at(2, 10, text('WinStreak', num(hall?.streaks[type]?.species === species ? hall.streaks[type]!.latest : 0)), 112, 'centre');
      at(2, 13, text('Record'));
      at(2, 13, text('WinStreak', num(hall?.records[type]?.[species] ?? 0)), 112, 'centre');
      break;
    }
    case FRONTIER_FACILITY.castle: {
      header('BattleCastle');
      const s = f?.castle?.streaks[type] ?? { record: 0, latest: 0, cp: 0, recordCp: 0, spentCp: 0 };
      at(18, 7, text('CastlePoints'), 96, 'right');
      at(2, 10, prevOrCurrent(f?.castle?.active[type]));
      at(2, 10, text('WinStreakTemplate', num(s.latest)), 112, 'centre');
      at(2, 10, text('CP', num(s.cp)), 224, 'right');
      at(2, 13, text('Record'));
      at(2, 13, text('WinStreakTemplate', num(s.record)), 112, 'centre');
      at(2, 13, text('CP', num(s.recordCp)), 224, 'right');
      break;
    }
    case FRONTIER_FACILITY.arcade: {
      header('BattleArcade');
      const s = f?.arcade?.streaks[type] ?? { record: 0, latest: 0 };
      at(2, 8, prevOrCurrent(f?.arcade?.active[type]));
      at(2, 8, text('GamesCleared', num(s.latest)), 112, 'centre');
      at(2, 11, text('Record'));
      at(2, 11, text('GamesCleared', num(s.record)), 112, 'centre');
      break;
    }
    case FRONTIER_FACILITY.tower: {
      const streak = (mode: number) => f?.towerStreaks[mode] ?? { record: 0, latest: 0 };
      if (type === FRONTIER_CHALLENGE.single || type === FRONTIER_CHALLENGE.double) {
        header('BattleTower');
        at(2, 7, prevOrCurrent(towerActive(ctx.state, type)));
        at(2, 7, text('WinStreak', num(streak(type).latest)), 112, 'centre');
        at(2, 10, text('Record'));
        at(2, 10, text('WinStreak', num(streak(type).record)), 112, 'centre');
      } else {
        header('BattleTower');
        const block = (mode: number, title: string, y: number) => {
          at(2, y, text(title));
          at(2, y + 3, prevOrCurrent(towerActive(ctx.state, mode)));
          at(2, y + 3, text('WinStreak', num(streak(mode).latest)), 112, 'centre');
          at(2, y + 5, text('Record'));
          at(2, y + 5, text('WinStreak', num(streak(mode).record)), 112, 'centre');
        };
        block(type, 'MultiWithTrainer', 7);
        block(LINK_MULTI, 'MultiWithFriend', 15);
      }
      break;
    }
    default:
      throw new Error(`frontier records: facility ${facility}`);
  }
  return lines;
}

const towerActive = (state: GameState, mode: number) => (((state.frontier?.towerFlags ?? 0) >> (TOWER_ACTIVE_BIT + mode)) & 1) === 1;

export function frontierRecordsScreen(ctx: MenuContext, request: FrontierRecordsRequest): Screen {
  const lines = frontierRecordLines(ctx, request);
  const bg: Id | null = newGameRecord(ctx.registries).frontier?.recordsArt ?? null;
  let phase: 'fade-in' | 'view' | 'fade-out' = 'fade-in';
  let n = 0;
  const fadeTicks = (f: typeof FADE_IN) => f.steps * f.frames;
  const leave = (): Step => {
    if (phase !== 'view') return;
    phase = 'fade-out';
    n = 0;
  };
  return {
    view: (): FrontierRecordsView => ({
      app: 'frontier-records',
      bg,
      lines,
      black:
        phase === 'fade-in'
          ? Math.round((BLACK * (FADE_IN.steps - Math.floor(n / FADE_IN.frames))) / FADE_IN.steps)
          : phase === 'fade-out'
            ? Math.round((BLACK * Math.floor(n / FADE_OUT.frames)) / FADE_OUT.steps)
            : 0,
    }),
    tick(): Step {
      n++;
      if (phase === 'fade-in' && n >= fadeTicks(FADE_IN)) [phase, n] = ['view', 0];
      else if (phase === 'fade-out' && n >= fadeTicks(FADE_OUT)) return { close: { app: 'frontier-records' } };
      return undefined;
    },
    input(i): Step {
      if ('tap' in i) return i.tap === 'back' ? leave() : undefined;
      return i.button === 'a' || i.button === 'b' ? leave() : undefined;
    },
  };
}
