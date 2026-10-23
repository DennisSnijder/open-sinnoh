/**
 * The journal (decomp applications/journal_display/journal_controller.c, journal_printer.c; docs/research/villa-journal.md
 * §2.4), one DS frame per tick. It fades in (6 steps), then: Left, or B away from page 0, turns to the newer page; A or
 * Right to the older one, each only when that page has a date; B on page 0 or START fades out and closes. A turn is a
 * frame of setup (SEQ_SE_DP_MEKURU3), then nine wipe frames over `JournalTables.pageTurn`: to an older page the new page
 * comes in on top (steps 8 → 0), to a newer one the old page leaves from the top (steps 0 → 8). The printer's lines are
 * plain text (journal_printer.c), the pages' paper the page number's palette.
 */
import { JOURNAL_EVENT, journalTables, type JournalPage, type JournalPageView, type JournalTables, type JournalView } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { menuSe, type MenuContext } from './context.ts';
import type { Screen, Step } from './stack.ts';

const FADE_STEPS = 6;
const BLACK = 16;
/** Decomp ROW_HEIGHT and the events window's rows: location events from y 16, the Pokémon at 80, the trainer at 96. */
const ROW = 16;
const MON_Y = 16 * 4 + 16;
const TRAINER_Y = MON_Y + 16;
/** SEQ_SE_DP_MEKURU3: the page turn. */
const SE_PAGE = 1681;
/** The page-turn wipe's steps (Unk_ov81_021D33E8 rows). */
const WIPE_STEPS = 9;

/** TEXT_BANK_JOURNAL_ENTRIES message per location event type (journal_printer.c's printers), and the fixed ones. */
const EVENT_TEXT: Record<number, number> = {
  1: 9, 2: 10, 3: 11, 4: 12, 5: 13, 6: 14, 7: 15, 8: 16, 9: 17, 10: 18, 11: 19, 12: 20, 13: 21,
  16: 30, 17: 31, 18: 34, 19: 35, 20: 36, 21: 37, 22: 38, 23: 43, 24: 40, 25: 41, 26: 42, 27: 39, 28: 46, 29: 44, 30: 45, 32: 48, 33: 47,
  34: 32, 35: 33, 36: 25, 37: 26, 38: 27, 39: 28, 40: 29,
};
const TEXT = { startedFrom: 0, date: 1, sunday: 2, gotThrough: 22, departedFrom: 23, exitedFrom: 24, caught: 49, defeated: 53, trainer: [57, 58, 59, 60], rivalName: 61 } as const;
/** The field moves and travel events whose value is a map header (the line names its location). */
const BY_MAP = new Set<number>([13, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29]);

type Phase = { kind: 'fade-in'; n: number } | { kind: 'main' } | { kind: 'turn'; to: number; step: number } | { kind: 'fade-out'; n: number };

/** The page's lines (JournalPrinter_PrintEntry). */
export function printJournalPage(ctx: MenuContext, t: JournalTables, page: JournalPage, index: number): JournalPageView {
  const reg = ctx.registries;
  const bank = (b: Id, i: number) => {
    const id = reg.textBanks.get(b)?.messages[i];
    if (!id) throw new Error(`journal: text bank ${b} has no message ${i}`);
    return id;
  };
  const msg = (i: number, ...slots: string[]) => ctx.text.text(bank(t.banks.entries, i), ...slots);
  const location = (label: number) => ctx.text.text(bank(t.banks.locations, label));
  const zoneLabel = (zone: Id) => {
    const label = reg.zones.get(zone)?.mapPopup?.label;
    if (label === undefined) throw new Error(`journal: ${zone} has no map label`);
    return label;
  };
  const bySource = <T extends { sourceIndex?: number }>(m: ReadonlyMap<Id, T>, n: number, what: string): T => {
    for (const r of m.values()) if (r.sourceIndex === n) return r;
    throw new Error(`journal: no ${what} ${n}`);
  };
  const mapLabel = (header: number) => zoneLabel(bySource(reg.zones, header, 'map header').id as Id);
  const trainerName = (n: number) => bySource(reg.trainers, n, 'trainer').name;
  const rows: JournalPageView['rows'] = [{ y: 0, text: msg(TEXT.startedFrom, location(zoneLabel(page.zone))) }];
  page.events.forEach((e, i) => {
    const y = ROW + i * ROW;
    let text: string;
    if (e.type === JOURNAL_EVENT.leftCave) text = msg(t.caveDeparted.includes(e.value) ? TEXT.departedFrom : TEXT.gotThrough, location(e.value));
    else if (e.type === JOURNAL_EVENT.leftBuilding) text = msg(t.buildings.find((b) => b.label === e.value)?.exited ? TEXT.exitedFrom : TEXT.departedFrom, location(e.value));
    else if (e.type === JOURNAL_EVENT.gymTooTough) text = msg(EVENT_TEXT[e.type]!, ctx.text.text(bank(t.banks.gyms, e.value)));
    else if (e.type === JOURNAL_EVENT.gymLeader) text = msg(EVENT_TEXT[e.type]!, ctx.text.text(bank(t.banks.gyms, e.value)), trainerName(e.trainer));
    else if (e.type === JOURNAL_EVENT.eliteFour || e.type === JOURNAL_EVENT.champion) text = msg(EVENT_TEXT[e.type]!, trainerName(e.trainer));
    else if (e.type === JOURNAL_EVENT.item) text = msg(EVENT_TEXT[e.type]!, bySource(reg.items, e.value, 'item').name);
    else if (BY_MAP.has(e.type)) text = msg(EVENT_TEXT[e.type]!, location(mapLabel(e.value)));
    else {
      const m = EVENT_TEXT[e.type];
      if (m === undefined) throw new Error(`journal: no line for event type ${e.type}`);
      text = msg(m);
    }
    rows.push({ y, text });
  });
  if (page.mon) {
    const m = page.mon;
    const base = m.result === 'caught' ? TEXT.caught : TEXT.defeated;
    // Variant 0 and 1 are the first two lines; variant 2 by gender (male, female), a genderless one the first line.
    const which = m.variant < 2 ? m.variant : m.gender === 0 ? 2 : m.gender === 1 ? 3 : 0;
    const species = reg.species.get(m.species)?.name ?? '';
    rows.push({ y: MON_Y, text: msg(base + which, species, ctx.text.text(bank(t.banks.times, m.timeOfDay))) });
  }
  if (page.trainer) {
    const where = location(zoneLabel(page.trainer.zone));
    const tr = reg.trainers.get(page.trainer.trainer);
    if (!tr) throw new Error(`journal: unknown trainer ${page.trainer.trainer}`);
    const name = tr.class === t.rivalClass ? msg(TEXT.rivalName, '', ctx.state.names.rival) : tr.name;
    const length = [...where].length + [...name].length;
    const line = TEXT.trainer[length <= 14 ? 0 : length <= 16 ? 1 : length <= 19 ? 2 : 3]!;
    rows.push({ y: TRAINER_Y, text: msg(line, where, name) });
  }
  return {
    index,
    title: msg(TEXT.date, ctx.text.month(page.date.month - 1), String(page.date.day)),
    weekday: msg(TEXT.sunday + page.date.weekday),
    rows,
  };
}

export function journalScreen(ctx: MenuContext): Screen {
  const t = journalTables(ctx.registries);
  if (!t) throw new Error('journal: the pack has no journal (NewGame.journal)');
  const pages = ctx.state.journal;
  if (!pages.length) throw new Error('journal: no page to show (the journal opens a page when it is given)');
  const printed = new Map<number, JournalPageView>();
  const print = (i: number) => {
    let v = printed.get(i);
    if (!v) printed.set(i, (v = printJournalPage(ctx, t, pages[i]!, i)));
    return v;
  };
  let page = 0;
  let phase: Phase = { kind: 'fade-in', n: 0 };
  const exists = (i: number) => i >= 0 && i < pages.length;
  const turn = (to: number): Step => {
    if (!exists(to)) return;
    phase = { kind: 'turn', to, step: -1 };
    menuSe(ctx, SE_PAGE);
  };
  const close = (): Step => void (phase = { kind: 'fade-out', n: 0 });
  const act = (what: 'newer' | 'older' | 'back' | 'close'): Step => {
    if (phase.kind !== 'main') return;
    if (what === 'newer') return turn(page - 1);
    if (what === 'older') return turn(page + 1);
    if (what === 'close') return close();
    return page !== 0 ? turn(page - 1) : close();
  };
  return {
    view(): JournalView {
      const black = phase.kind === 'fade-in' ? Math.round((BLACK * (FADE_STEPS - phase.n)) / FADE_STEPS) : phase.kind === 'fade-out' ? Math.round((BLACK * phase.n) / FADE_STEPS) : 0;
      let shown = print(page);
      let top: JournalView['turn'] = null;
      if (phase.kind === 'turn' && phase.step >= 0) {
        // To an older page the new one wipes in on top (8 → 0); to a newer one the old leaves from the top (0 → 8).
        if (phase.to > page) top = { step: WIPE_STEPS - 1 - phase.step, page: print(phase.to) };
        else {
          shown = print(phase.to);
          top = { step: phase.step, page: print(page) };
        }
      }
      return { app: 'journal', gender: ctx.state.gender, page: shown, turn: top, newer: exists(page - 1), older: exists(page + 1), black };
    },
    tick(): Step {
      if (phase.kind === 'fade-in') {
        if (++phase.n >= FADE_STEPS) phase = { kind: 'main' };
      } else if (phase.kind === 'fade-out') {
        if (++phase.n >= FADE_STEPS) return { close: { app: 'journal' } };
      } else if (phase.kind === 'turn') {
        if (++phase.step >= WIPE_STEPS) {
          page = phase.to;
          phase = { kind: 'main' };
        }
      }
      return undefined;
    },
    input(i): Step {
      if ('tap' in i) return i.tap === 'prev' ? act('newer') : i.tap === 'next' ? act('older') : i.tap === 'back' ? act('back') : undefined;
      switch (i.button) {
        case 'left':
          return act('newer');
        case 'right':
        case 'a':
          return act('older');
        case 'b':
          return act('back');
        case 'start':
          return act('close');
        default:
          return undefined;
      }
    },
  };
}
