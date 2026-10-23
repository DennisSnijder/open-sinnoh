/**
 * The journal (docs/research/villa-journal.md §2; decomp include/journal.h, src/journal.c, field_map_change_flags.c,
 * encounter.c, field_map_change.c FieldTask_LoadSavedGameMap). Ten pages, page 0 today's; each page a date and the map
 * it started on, up to four location events, one Pokémon line and one trainer line. Entries are made only while the
 * journal is owned (FLAG_JOURNAL_ACQUIRED: the decomp's field journal pointer is null before); the page rolls only at a
 * load (or `give_journal`), never at midnight while playing. The online events are link-only and not kept.
 *
 * These are shared state edits (as `state-edits.ts`): the world, the VM and the game call them at the decomp's hooks.
 */
import { dayOfWeek, type ClockTime, type Id } from '@opensinnoh/core';
import type { GameState } from './state.ts';
import type { Zone } from './records.ts';
import type { Registries } from './runtime.ts';

/** Decomp MAX_JOURNAL_ENTRIES and MAX_JOURNAL_LOCATION_EVENTS. */
export const JOURNAL_PAGES = 10;
export const JOURNAL_LOCATION_EVENTS = 4;

/** Decomp LOCATION_EVENT_* (generated/journal_location_events.txt). */
export const JOURNAL_EVENT = {
  none: 0,
  restedAtHome: 1,
  leftLab: 2,
  pcBox: 3,
  shopped: 4,
  lotsOfShopping: 5,
  soldALittle: 6,
  soldALot: 7,
  businessAtMart: 8,
  gymTooTough: 9,
  gymLeader: 10,
  eliteFour: 11,
  champion: 12,
  arrived: 13,
  leftCave: 14,
  leftBuilding: 15,
  gameCorner: 16,
  safari: 17,
  item: 18,
  cut: 19,
  fly: 20,
  surf: 21,
  strength: 22,
  defog: 23,
  rockSmash: 24,
  waterfall: 25,
  rockClimb: 26,
  flash: 27,
  teleport: 28,
  dig: 29,
  sweetScent: 30,
  unused: 31,
  milkDrink: 32,
  softboiled: 33,
  dugUnderground: 34,
  secretBase: 35,
  battleTower: 36,
  battleFactory: 37,
  battleCastle: 38,
  battleHall: 39,
  battleArcade: 40,
} as const;

/** The DS date of a page title (decomp JournalEntryTitle / RTCDate: year 0–99, month 1–12, weekday 0 = Sunday). */
export interface JournalDate {
  year: number;
  month: number;
  day: number;
  weekday: number;
}

/**
 * A location event (decomp LOCATION_EVENT(locationID, trainerID, eventType)): `type` a JOURNAL_EVENT, `value` its
 * 16-bit field (a map header for arrivals and field moves, a map label text for caves and buildings, a gym index, an
 * item), `trainer` the 10-bit trainer id of gym leaders, the Elite Four and the Champion (else 0).
 */
export interface JournalEvent {
  type: number;
  value: number;
  trainer: number;
}

/**
 * The Pokémon line (decomp JournalEntryMon): caught or defeated, the string variant 0–2 from the play time, the battle's
 * time of day (TIMEOFDAY_*), the gender (GENDER_MALE 0, FEMALE 1, NONE 2).
 */
export interface JournalMon {
  result: 'caught' | 'defeated';
  variant: number;
  timeOfDay: number;
  gender: number;
  species: Id;
}

/** One page (decomp JournalEntry, without the online events). */
export interface JournalPage {
  date: JournalDate;
  /** The title's map header: the map the day started on. */
  zone: Id;
  events: JournalEvent[];
  mon: JournalMon | null;
  /** The last standard trainer beaten (decomp JournalEntryTrainer) and the map of the battle. */
  trainer: { trainer: Id; zone: Id } | null;
}

/**
 * `NewGame.journal` (0.37.0). `flag` FLAG_JOURNAL_ACQUIRED; `gyms` decomp sGymsInfo by gym index (the leader, the gym's
 * map, its badge); `buildings` sMapsInfo (a map label text and whether "Exited from" is used instead of "Departed
 * from"); `caveDeparted` the labels whose left-cave line reads "Departed from" (Valley Windworks, Snowpoint Temple,
 * Fuego Ironworks); `eliteFour` and `champion` the trainers JournalEntry_TrainerType names; `home` and `lab`
 * (MAP_HEADER_TWINLEAF_TOWN_PLAYER_HOUSE_1F, MAP_HEADER_SANDGEM_TOWN_POKEMON_RESEARCH_LAB); `rivalClass` TRAINER_CLASS_RIVAL;
 * `banks` the text banks the screen prints from; `pageTurn` Unk_ov81_021D33E8 (9 steps × 32 source tile columns, 0xFF
 * blank); `art` the page sheets by gender (`ui2d`, ten cells: the paper in palette 0–9).
 */
export interface JournalTables {
  flag: Id;
  gyms: { trainer: Id; zone: Id; badge: Id }[];
  buildings: { label: number; exited: boolean }[];
  caveDeparted: number[];
  eliteFour: Id[];
  champion: Id[];
  home: Id;
  lab: Id;
  rivalClass: Id;
  banks: { entries: Id; months: Id; gyms: Id; locations: Id; times: Id };
  pageTurn: number[][];
  art?: { male: Id; female: Id };
  /** Shop_Exit's marts without entries: the Veilstone Store's map label and the Eterna Herb Shop, the Celestic NW house. */
  martExcluded: { label: number; zones: Id[] };
}

/** The journal tables, or null when the pack has no journal. */
export function journalTables(reg: Registries): JournalTables | null {
  for (const ng of reg.newGame.values()) return ng.journal ?? null;
  return null;
}

/** The DS date of a clock reading (GetCurrentDate: two-digit year, weekday). */
export function journalDate(clock: ClockTime): JournalDate {
  const [y, m, d] = clock.date.split('-').map(Number) as [number, number, number];
  return { year: y % 100, month: m, day: d, weekday: dayOfWeek(clock.date) };
}

const sameDate = (a: JournalDate, b: JournalDate) => a.year === b.year && a.month === b.month && a.day === b.day && a.weekday === b.weekday;

/** Decomp DayNumberForDate: the day of the year (1-based), leap years by the two-digit year. */
export function dayOfYear(d: Pick<JournalDate, 'year' | 'month' | 'day'>): number {
  const starts = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const leap = (d.year % 4 === 0 && d.year % 100 !== 0) || d.year % 400 === 0;
  return d.day + starts[d.month - 1]! + (d.month >= 3 && leap ? 1 : 0);
}

/** Whether entries are made: the journal is owned (decomp fieldSystem->journalEntry is set). */
export function journalOwned(reg: Registries, state: GameState): boolean {
  const t = journalTables(reg);
  if (!t) return false;
  return state.flags[t.flag] ?? reg.flags.get(t.flag)?.initial ?? false;
}

/** Today's page while the journal is owned (decomp fieldSystem->journalEntry), or null. */
export function journalPage(reg: Registries, state: GameState): JournalPage | null {
  if (!journalOwned(reg, state)) return null;
  const page = state.journal[0];
  if (!page) throw new Error('journal: owned, but no page was opened (give_journal or a load opens one)');
  return page;
}

/**
 * Decomp Journal_GetSavedPage then the title (sub_02053494 / JournalEntry_SaveTitle): when page 0 is of another day the
 * pages shift down (the tenth drops) and a new page 0 starts; the title keeps an existing same-day one.
 */
export function openJournalPage(state: GameState, today: JournalDate, zone: Id): void {
  const first = state.journal[0];
  if (first && sameDate(first.date, today)) return;
  state.journal.unshift({ date: { ...today }, zone, events: [], mon: null, trainer: null });
  state.journal.length = Math.min(state.journal.length, JOURNAL_PAGES);
}

/** Decomp Journal_CheckOpenOnContinue: the newest page is two or more days old (by day of year, with the new-year rule). */
export function journalOpensOnContinue(state: GameState, today: JournalDate): boolean {
  const page = state.journal[0];
  // A page without a date reads as year 0, January 0 on the DS (title all zero).
  const d = page?.date ?? { year: 0, month: 1, day: 0, weekday: 0 };
  const diff = dayOfYear(today) - dayOfYear(d);
  if ((today.month === 12 && today.day === 31 && d.month === 1 && d.day === 1) || (today.month === 1 && today.day === 1 && d.month === 12 && d.day === 31)) {
    return Math.abs(today.year - d.year) >= 2;
  }
  if (diff <= -2 || diff >= 2) return true;
  return today.year !== d.year;
}

const MISC = new Set<number>([1, 2, 3, 4, 5, 6, 7, 8, 16, 17, 34, 35, 36, 37, 38, 39, 40]);
const BY_VALUE = new Set<number>([13, 14, 15, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 32, 33]);

/** Decomp JournalEntry_GetEmptyLocationEvent: the first free slot, or all shift up and the last is freed. */
function slot(events: JournalEvent[], e: JournalEvent): void {
  if (events.length >= JOURNAL_LOCATION_EVENTS) events.shift();
  events.push(e);
}

/**
 * Decomp JournalEntry_SaveLocationEvent: misc events are skipped after one of the same type; travel, item and field-move
 * events after one of the same type and value; a gym event first drops a "too tough" of the same gym, an Elite Four
 * win any earlier Elite Four win; a Champion win always goes in. Other types are not saved.
 */
export function addJournalEvent(page: JournalPage, e: JournalEvent): void {
  const events = page.events;
  const last = events[events.length - 1];
  if (MISC.has(e.type)) {
    if (last?.type === e.type) return;
    slot(events, { type: e.type, value: 0, trainer: 0 });
  } else if (BY_VALUE.has(e.type)) {
    if (last?.type === e.type && last.value === e.value) return;
    slot(events, { type: e.type, value: e.value, trainer: 0 });
  } else if (e.type === JOURNAL_EVENT.gymTooTough || e.type === JOURNAL_EVENT.gymLeader) {
    const i = events.findIndex((x) => x.type === JOURNAL_EVENT.gymTooTough && x.value === e.value);
    if (i >= 0) events.splice(i, 1);
    slot(events, { ...e, trainer: e.trainer & 0x3ff });
  } else if (e.type === JOURNAL_EVENT.eliteFour) {
    const i = events.findIndex((x) => x.type === JOURNAL_EVENT.eliteFour);
    if (i >= 0) events.splice(i, 1);
    slot(events, { ...e, trainer: e.trainer & 0x3ff });
  } else if (e.type === JOURNAL_EVENT.champion) slot(events, { ...e, trainer: e.trainer & 0x3ff });
}

/** A location event on today's page, while the journal is owned. */
export function journalEvent(reg: Registries, state: GameState, type: number, value = 0, trainer = 0): void {
  const page = journalPage(reg, state);
  if (page) addJournalEvent(page, { type, value, trainer });
}

const outdoors = (z: Zone) => z.mapType === 'town' || z.mapType === 'city' || z.mapType === 'route' || z.mapType === 'outdoors';
/** MapHeader_IsBuilding: MAP_TYPE_INDOORS or MAP_TYPE_POKECENTER (imported as 'other'; no Pokémon Center makes an entry). */
const building = (z: Zone) => z.mapType === 'indoors';

/**
 * A warp's journal entry (decomp FieldSystem_InitFlagsWarp → CreateFlyLocationJournalEvent, else
 * CreateMapTransitionJournalEvent). Call before the destination's fly location unlocks. `arrival` is whether the
 * destination's fly location is still locked (the zone's first-arrival flag clear): an arrival event, and no
 * transition event.
 */
export function journalWarp(reg: Registries, state: GameState, from: Zone, to: Zone, arrival: boolean): void {
  const page = journalPage(reg, state);
  const t = journalTables(reg);
  if (!page || !t) return;
  if (arrival) return addJournalEvent(page, { type: JOURNAL_EVENT.arrived, value: to.sourceIndex ?? 0, trainer: 0 });
  if (from.id === to.id) return;
  const label = from.mapPopup?.label;
  if (from.mapType === 'cave') {
    if (outdoors(to) && label !== undefined) addJournalEvent(page, { type: JOURNAL_EVENT.leftCave, value: label, trainer: 0 });
  } else if (building(from)) {
    if (!outdoors(to)) return;
    if (from.id === t.home) addJournalEvent(page, { type: JOURNAL_EVENT.restedAtHome, value: 0, trainer: 0 });
    else if (from.id === t.lab) addJournalEvent(page, { type: JOURNAL_EVENT.leftLab, value: 0, trainer: 0 });
    else if (label !== undefined && t.buildings.some((b) => b.label === label)) addJournalEvent(page, { type: JOURNAL_EVENT.leftBuilding, value: label, trainer: 0 });
  } else if (outdoors(from) && building(to)) {
    // JournalEntry_GetGymTooTough: the first gym of this map; none when its badge is owned.
    const gym = t.gyms.findIndex((g) => g.zone === to.id);
    if (gym >= 0 && !state.badges.includes(t.gyms[gym]!.badge)) addJournalEvent(page, { type: JOURNAL_EVENT.gymTooTough, value: gym, trainer: 0 });
  }
}

/** A zone connection's entry (FieldSystem_InitFlagsOnMapChange → CreateFlyLocationJournalEvent only). */
export function journalZoneConnection(reg: Registries, state: GameState, to: Zone, arrival: boolean): void {
  const page = journalPage(reg, state);
  if (page && arrival) addJournalEvent(page, { type: JOURNAL_EVENT.arrived, value: to.sourceIndex ?? 0, trainer: 0 });
}

/**
 * Decomp JournalEntry_CreateAndSaveEventTrainer, on a won trainer or tag battle: a gym leader of sGymsInfo, an Elite
 * Four member or the Champion is a location event; anyone else the trainer line (the battle's map).
 */
export function journalTrainer(reg: Registries, state: GameState, trainer: Id, zone: Id): void {
  const page = journalPage(reg, state);
  const t = journalTables(reg);
  if (!page || !t) return;
  const n = reg.trainers.get(trainer)?.sourceIndex;
  if (n === undefined) throw new Error(`journal: trainer ${trainer} has no source index`);
  const gym = t.gyms.findIndex((g) => g.trainer === trainer);
  if (gym >= 0) addJournalEvent(page, { type: JOURNAL_EVENT.gymLeader, value: gym, trainer: n });
  else if (t.eliteFour.includes(trainer)) addJournalEvent(page, { type: JOURNAL_EVENT.eliteFour, value: 0, trainer: n });
  else if (t.champion.includes(trainer)) addJournalEvent(page, { type: JOURNAL_EVENT.champion, value: 0, trainer: n });
  else page.trainer = { trainer, zone };
}

/**
 * Decomp JournalEntry_CreateEventMonCaught / _MonDefeated: the string variant from the play time's minutes / 10
 * (caught: 0, 2, 4 → 0; 1, 3 → 1; 5 → 2; defeated: 1, 3, 5 → 0; 2, 4 → 1; 0 → 2).
 */
export function journalMon(reg: Registries, state: GameState, result: JournalMon['result'], species: Id, gender: number, timeOfDay: number): void {
  const page = journalPage(reg, state);
  if (!page) return;
  const tens = Math.floor(state.playTime.minutes / 10);
  const variant = result === 'caught' ? ([0, 2, 4].includes(tens) ? 0 : [1, 3].includes(tens) ? 1 : 2) : [1, 3, 5].includes(tens) ? 0 : [2, 4].includes(tens) ? 1 : 2;
  page.mon = { result, variant, timeOfDay, gender, species };
}

/**
 * Decomp Shop_Exit (MART_TYPE_NORMAL; not the Veilstone Store, the Eterna Herb Shop or the Celestic NW house): bought
 * and sold → business at the mart; else more than one bought → lots of shopping; more than one sold → sold a lot; one
 * bought → shopped; one sold → sold a little. `bought` and `sold` are the shop's counts (2 once a purchase or sale is of
 * more than one).
 */
export function journalMart(reg: Registries, state: GameState, bought: number, sold: number): void {
  const t = journalTables(reg);
  const zone = reg.zones.get(state.player.zone);
  if (!t || !zone || zone.mapPopup?.label === t.martExcluded.label || t.martExcluded.zones.includes(zone.id)) return;
  const type = bought && sold ? JOURNAL_EVENT.businessAtMart : bought > 1 ? JOURNAL_EVENT.lotsOfShopping : sold > 1 ? JOURNAL_EVENT.soldALot : bought ? JOURNAL_EVENT.shopped : sold ? JOURNAL_EVENT.soldALittle : 0;
  if (type) journalEvent(reg, state, type);
}
