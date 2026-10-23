import type { AppHost, GameState, Registries, StubLog } from '@opensinnoh/contracts';
import { EVOLUTION_STRINGS } from './evolution.ts';
import { STORAGE_MESSAGES } from './storage.ts';
import { MenuText } from './strings.ts';
import { SUMMARY_MESSAGES } from './summary.ts';
import { MOVE_REMINDER_MESSAGES } from './move-reminder.ts';
import { TRADE_MESSAGES } from './trade.ts';
import { POFFIN_TEXTS } from './poffin-cooking.ts';
import { CONTEST_APP_TEXTS } from './contest/contest.ts';
import { CONTEST_ROUND_TEXTS } from './contest/rounds.ts';

/** What every screen gets: the live state, the records, the game's services and the labels. */
export interface MenuContext {
  registries: Registries;
  state: GameState;
  log: StubLog;
  host: AppHost;
  text: MenuText;
  memory: MenuMemory;
}

/**
 * Cursors the DS keeps between openings of a menu (field system memory, not saved): the start menu entry
 * and the bag pocket (and the battle bag's, decomp BagCursor's battle part). Kept per game state object, so a reset or a load starts fresh.
 */
export interface MenuMemory {
  startEntry: string;
  bagPocket: number;
  battlePocket: number;
}

const memories = new WeakMap<GameState, MenuMemory>();
const texts = new WeakMap<Registries, MenuText>();

export function menuContext(deps: { registries: Registries; state: GameState; log: StubLog; host: AppHost }): MenuContext {
  let memory = memories.get(deps.state);
  if (!memory) memories.set(deps.state, (memory = { startEntry: 'bag', bagPocket: 0, battlePocket: 0 }));
  let text = texts.get(deps.registries);
  if (!text) texts.set(deps.registries, (text = new MenuText(deps.registries, [...SUMMARY_MESSAGES, ...STORAGE_MESSAGES, ...EVOLUTION_STRINGS, ...MOVE_REMINDER_MESSAGES, ...TRADE_MESSAGES, ...POFFIN_TEXTS, ...CONTEST_APP_TEXTS, ...CONTEST_ROUND_TEXTS])));
  return { ...deps, text, memory };
}

const soundIndexes = new WeakMap<Registries, Map<number, import('@opensinnoh/core').Id>>();
/** Accepted menu transitions address SDAT sequences, just like the VM. */
export function menuSe(ctx: Pick<MenuContext, 'registries' | 'log'> & { host: Pick<AppHost, 'sound'> }, source: number): void {
  let indexes = soundIndexes.get(ctx.registries);
  if (!indexes) soundIndexes.set(ctx.registries, indexes = new Map([...ctx.registries.sequences.values()].flatMap((s) => s.sourceIndex === undefined ? [] : [[s.sourceIndex, s.id] as const])));
  const seq = indexes.get(source);
  if (seq) ctx.host.sound?.playSe(seq);
  else ctx.log.stub('audio:sequence-missing', `no sequence with sourceIndex ${source} in the packs: not played`);
}

/** Play time (GameState.playTime) in the trainer card's H:MM format. */
export function playTime(ctx: MenuContext): string {
  const p = ctx.state.playTime;
  return ctx.text.t('cardTimeFormat', String(p.hours), String(p.minutes).padStart(2, '0'));
}
