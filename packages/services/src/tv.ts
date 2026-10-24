/**
 * The TV broadcast (docs/research/tv.md; decomp overlay006/ov6_022465FC.c, tv_episode.c, tv_commercials.c, src/tv_segment.c,
 * scrcmd_tv_broadcast.c's interviews). What a TV shows when the player checks it: the programme the schedule airs this
 * quarter hour, its greeting, up to four segments chosen from the saved ones (and, for Sinnoh Now and the Variety Hour,
 * made up from the game's state), the farewell, and a commercial once the programme is over. The saved part and the
 * recorders are contracts `tv.ts`. Every draw is the game's main stream (`rng`: the decomp's MTRNG_Next and LCRNG_Next).
 *
 * A message is `{ bank, message, slots }`: a text bank by its decomp name, the message index in it, and the string
 * template's arguments by index, which the VM turns into text.
 */
import { dayOfWeek, dayPeriod, swarmDailyOf, swarmIndex, yearlyDayIndex, type Id } from '@opensinnoh/core';
import {
  ACCESSORIES,
  newGameRecord,
  poketchAppIndex,
  ROAMING_ROUTES,
  saveTvSegment,
  TV,
  TV_PROGRAM_TYPE,
  TV_SAVED_TYPES,
  tvSegmentId,
  type GameState,
  type Registries,
  type TvRecord,
  type TvSegmentData,
  type TvTables,
} from '@opensinnoh/contracts';

/** A string template argument: plain text, a text bank's entry, a number, or an Easy Chat word. */
export type TvSlot = { plain: string } | { bank: string; entry: number } | { number: number } | { word: number };
export interface TvMessage {
  bank: string;
  message: number;
  slots: Record<number, TvSlot>;
}

export interface TvContext {
  registries: Registries;
  state: GameState;
  /** The game's main stream, a u32 per draw. */
  rng: () => number;
}

/** Decomp TV_BROADCAST_STATUS_*. */
export const TV_STATUS = { finished: 0, finish: 1, begin: 2, continue: 3 } as const;
/** Decomp TV_PROGRAM_FRAMING_MESSAGE_*. */
export const TV_FRAMING = { greeting: 0, intro: 1, farewell: 2, farewellExtended: 3 } as const;

const BANKS = {
  programs: 'TEXT_BANK_TV_PROGRAMS',
  commercials: 'TEXT_BANK_TV_COMMERCIALS',
  reporter: 'TEXT_BANK_TV_REPORTER_INTERVIEWS',
  1: 'TEXT_BANK_TV_PROGRAMS_INTERVIEWS',
  2: 'TEXT_BANK_TV_PROGRAMS_TRAINER_SIGHTINGS',
  3: 'TEXT_BANK_TV_PROGRAMS_RECORDS',
  4: 'TEXT_BANK_TV_PROGRAMS_SINNOH_NOW',
  5: 'TEXT_BANK_TV_PROGRAMS_VARIETY_HOUR',
} as const;
/** Decomp TV_BROADCAST_MAX_UNFILTERED_PENDING_SEGMENTS, TV_BROADCAST_MAX_FILTERED_PENDING_SEGMENTS. */
const PENDING_MAX = 16;
const FILTERED_MAX = 11;
/** Decomp NATIONAL_DEX_COUNT. */
const NATIONAL_DEX = 493;

const nsOf = (r: Registries) => newGameRecord(r).id.split(':')[0]!;
const random = (c: TvContext, n: number) => (c.rng() >>> 0) % n;

function tables(r: Registries): TvTables {
  const t = newGameRecord(r).tv;
  if (!t) throw new Error('tv: the pack has no TV schedule (NewGame.tv)');
  return t;
}

function flag(c: TvContext, name: string): boolean {
  const id = `${nsOf(c.registries)}:${name}` as Id;
  const f = c.registries.flags.get(id);
  if (!f) throw new Error(`tv: the pack has no flag ${id}`);
  return c.state.flags[id] ?? f.initial;
}
/** SystemFlag_HandleFirstArrivalToZone(…, HANDLE_FLAG_CHECK, FIRST_ARRIVAL_<name>). */
const arrived = (c: TvContext, name: string) => flag(c, `FLAG_FIRST_ARRIVAL_${name}`);
const seen = (c: TvContext, species: Id) => c.state.pokedex.seen.includes(species);
const gameCompleted = (c: TvContext) => flag(c, 'FLAG_GAME_COMPLETED');

function bankMessages(c: TvContext, bank: string): readonly Id[] {
  const b = c.registries.textBanks.get(`${nsOf(c.registries)}:${bank}` as Id);
  if (!b) throw new Error(`tv: the pack has no ${bank}`);
  return b.messages;
}
/** A message's index in its bank by its decomp name. */
function msg(c: TvContext, bank: string, name: string): number {
  const i = bankMessages(c, bank).indexOf(`${nsOf(c.registries)}:${name}` as Id);
  if (i < 0) throw new Error(`tv: ${bank} has no ${name}`);
  return i;
}

const speciesName = (c: TvContext, species: Id): TvSlot => ({ plain: c.registries.species.get(species)!.name });
const itemName = (c: TvContext, item: Id): TvSlot => ({ plain: c.registries.items.get(item)!.name });
const player = (c: TvContext): TvSlot => ({ plain: c.state.names.player });
const location = (n: number): TvSlot => ({ bank: 'TEXT_BANK_LOCATION_NAMES', entry: n });
function speciesByNumber(c: TvContext): Map<number, Id> {
  return new Map([...c.registries.species.values()].flatMap((s) => (s.sourceIndex !== undefined ? [[s.sourceIndex, s.id] as const] : [])));
}
function sourceOf(c: TvContext, registry: 'zones' | 'items', id: Id): number {
  const n = c.registries[registry].get(id)?.sourceIndex;
  if (n === undefined) throw new Error(`tv: ${id} has no source index`);
  return n;
}
function zoneId(c: TvContext, header: string): Id {
  const id = `${nsOf(c.registries)}:MAP_HEADER_${header}` as Id;
  if (!c.registries.zones.has(id)) throw new Error(`tv: the pack has no zone ${id}`);
  return id;
}
/** MapHeader_GetMapLabelTextID. */
export function zoneLabel(registries: Registries, zone: Id): number {
  const label = registries.zones.get(zone)?.mapPopup?.label;
  if (label === undefined) throw new Error(`tv: ${zone} has no map label`);
  return label;
}

// ---------------------------------------------------------------- the schedule

/** TVBroadcast_GetScheduledProgramID: the programme of the saved clock's quarter hour and weekday (Monday first). */
export function tvProgram(registries: Registries, state: GameState): number {
  const { date, hour, minute } = state.gameTime.now;
  const day = (dayOfWeek(date) + 6) % 7;
  return tables(registries).schedule[((19 + hour) % 24) * 4 + Math.floor(minute / TV.slotMinutes)]![day]!;
}
/** TVBroadcast_GetProgramType. */
export function tvProgramType(registries: Registries, state: GameState): number {
  return tables(registries).programs[tvProgram(registries, state) - 1]!.type;
}

/** TVBroadcast_GetPendingBroadcastType. */
export function tvStatus(state: GameState): number {
  if (state.tv.finished) return TV_STATUS.finished;
  const played = state.tv.played.length;
  return played === 0 ? TV_STATUS.begin : played === TV.played ? TV_STATUS.finish : TV_STATUS.continue;
}

/**
 * TVBroadcast_GetProgramFramingMessage: the scheduled programme's greeting (by GetTimeOfDay: morning, day, else evening),
 * segment intro (the lead before any segment, else the next), farewell or early farewell; an index in TEXT_BANK_TV_PROGRAMS
 * (seven per programme, sProgramFramingMessages).
 */
export function tvFraming(registries: Registries, state: GameState, type: number): number {
  const base = (tvProgram(registries, state) - 1) * 7;
  switch (type) {
    case TV_FRAMING.greeting: {
      const period = dayPeriod(state.gameTime.now.hour);
      return base + (period === 'morning' ? 0 : period === 'day' ? 1 : 2);
    }
    case TV_FRAMING.intro:
      return base + (state.tv.played.length === 0 ? 3 : 4);
    case TV_FRAMING.farewell:
      return base + 5;
    case TV_FRAMING.farewellExtended:
      return base + 6;
    default:
      throw new Error(`tv: framing message ${type}`);
  }
}

/** FieldSystem_SetTVProgramFinished. */
export function tvFinish(state: GameState): void {
  state.tv.finished = true;
}

// ---------------------------------------------------------------- commercials

/** sTVCommercialMessageUnlockConditions by commercial (TVCommercial_Text_* order); the unlock conditions are below. */
const COMMERCIALS = [
  'always', 'always', 'always', 'always', 'always', 'JUBILIFE_CITY', 'FLOAROMA_TOWN', 'ETERNA_CITY', 'ETERNA_CITY', 'HEARTHOME_CITY',
  'HEARTHOME_CITY', 'HEARTHOME_CITY', 'HEARTHOME_CITY', 'HEARTHOME_CITY', 'HEARTHOME_CITY', 'badges', 'badges', 'OREBURGH_CITY', 'localDex',
  'completed', 'completed', 'localDex', 'HEARTHOME_CITY', 'HEARTHOME_CITY', 'pokedex', 'pokedex', 'never', 'never', 'completed', 'FIGHT_AREA',
  'FIGHT_AREA', 'FIGHT_AREA', 'FIGHT_AREA', 'OREBURGH_CITY', 'OREBURGH_CITY',
] as const;

/** TVBroadcast_GetProgramCommercialMessage: one of the unlocked commercials (TVCommercial_GetUnlockedMessages), drawn. */
export function tvCommercial(c: TvContext, localDex: boolean): number {
  const unlocked = (cond: (typeof COMMERCIALS)[number]) =>
    cond === 'always' ? true
    : cond === 'never' ? false
    : cond === 'badges' ? c.state.badges.length >= 5
    : cond === 'localDex' ? localDex
    : cond === 'pokedex' ? c.state.pokedex.obtained
    : cond === 'completed' ? gameCompleted(c)
    : arrived(c, cond);
  const open = COMMERCIALS.flatMap((cond, i) => (unlocked(cond) ? [i] : []));
  return open[random(c, open.length)]!;
}

// ---------------------------------------------------------------- choosing a segment

/** A saved type's list (sub_0202E4DC). */
const saved = (state: GameState, type: number) => state.tv[TV_SAVED_TYPES[type as 1 | 2 | 3]];

/** The episode a played number names: a saved slot (1–4) of a saved type, or a Sinnoh Now / Variety Hour segment id. */
function episodeOf(state: GameState, type: number, played: number): { id: number; record: TvRecord | null } {
  if (type === TV_PROGRAM_TYPE.sinnohNow || type === TV_PROGRAM_TYPE.varietyHour) return { id: played, record: null };
  const record = saved(state, type)[played - 1];
  if (!record) throw new Error(`tv: no saved segment in slot ${played} of type ${type}`);
  return { id: tvSegmentId(record.data).id, record };
}

/**
 * ov6_022468B0: the segments of the programme pending this pass (ov6_0224678C: the saved slots holding a listed segment,
 * played or not as `played` asks; Sinnoh Now and the Variety Hour list their own unplayed segments, on the local unplayed
 * pass only), less the ineligible ones and those played this slot, then one at random. The played ones are excluded only up
 * to the first ineligible entry, as TVBroadcast_ExcludePlayedSegments stops at the first emptied one.
 */
function pendingPass(c: TvContext, played: boolean, isEligible: (type: number, id: number, record: TvRecord | null) => boolean): number {
  const t = tables(c.registries);
  const program = t.programs[tvProgram(c.registries, c.state) - 1]!;
  const type = program.type;
  const pending: number[] = [];
  for (const id of program.segments) {
    if (type === TV_PROGRAM_TYPE.sinnohNow || type === TV_PROGRAM_TYPE.varietyHour) {
      if (!played && !c.state.tv.played.includes(id)) pending.push(id);
    } else {
      saved(c.state, type).forEach((r, i) => {
        if (r && tvSegmentId(r.data).id === id && (played ? r.plays > 0 : r.plays === 0)) pending.push(i + 1);
      });
    }
  }
  if (pending.length === 0) return 0;
  const list: number[] = pending.slice(0, PENDING_MAX);
  for (let i = 0; i < list.length; i++) {
    const e = episodeOf(c.state, type, list[i]!);
    if (!isEligible(type, e.id, e.record)) list[i] = 0;
  }
  for (let i = 0; i < list.length && list[i] !== 0; i++) if (c.state.tv.played.includes(list[i]!)) list[i] = 0;
  const squashed = list.slice(0, FILTERED_MAX).filter((x) => x !== 0);
  if (squashed.length === 0) return 0;
  return squashed.length === 1 ? squashed[0]! : squashed[random(c, squashed.length)]!;
}

/**
 * TVBroadcast_GetNextSegmentID: the Wi-Fi passes find nothing offline, so the unplayed saved segments first, then the played
 * ones; 0 when none is left.
 */
export function tvNextSegment(c: TvContext): number {
  const eligible = (type: number, id: number, record: TvRecord | null) => segmentEligible(c, type, id, record);
  return pendingPass(c, false, eligible) || pendingPass(c, true, eligible);
}

/**
 * TVBroadcast_LoadSegmentMessage: the segment is played (this slot, and its record once more, capped at 3), then its message.
 */
export function tvLoadSegment(c: TvContext, played: number): TvMessage {
  const type = tvProgramType(c.registries, c.state);
  if (c.state.tv.played.length >= TV.played) throw new Error('tv: four segments played this slot already');
  c.state.tv.played.push(played);
  const e = episodeOf(c.state, type, played);
  if (e.record && e.record.plays < TV.plays) e.record.plays++;
  const message = segmentMessage(c, type, e.id, e.record);
  if (!message) throw new Error(`tv: segment ${e.id} of type ${type} has no message`);
  return { bank: BANKS[type as 1 | 2 | 3 | 4 | 5], ...message };
}

// ---------------------------------------------------------------- eligibility (TVSegment_IsEligible)

const hasExplorerKit = (c: TvContext) => Object.values(c.state.bag).some((p) => p.some((s) => s.item === `${nsOf(c.registries)}:ITEM_EXPLORER_KIT` && s.count > 0));

/** TVSegment_IsEligible: a segment without a message never; one without a check always. */
function segmentEligible(c: TvContext, type: number, id: number, record: TvRecord | null): boolean {
  if (record) return savedEligible(c, record.data);
  if (type === TV_PROGRAM_TYPE.sinnohNow) {
    switch (id) {
      case 1: // TVSegment_IsEligible_DiscoveringGroups: a group is known (RecordMixedRNG); groups are not built.
        return false;
      case 2: // On-the-Spot Weather
      case 3: // Your Town's Best Three
      case 12: // Rich Boy Nature Corner
        return true;
      case 5:
        return c.state.encounters?.swarms === true;
      case 9:
        return arrived(c, 'OREBURGH_CITY');
      case 15:
        return c.state.roamers.slots.some((s) => s !== null);
      case 17:
        return c.state.dressUpPhotos.some((p) => p !== null);
      default: // the null and dummy entries (Matchup Channel, Pokémon Research Corner)
        return false;
    }
  }
  if (type === TV_PROGRAM_TYPE.varietyHour) {
    if (id === 2 || id === 5) return c.state.pokedex.obtained;
    if (id === 7) return c.state.badges.includes(`${nsOf(c.registries)}:BADGE_ID_COAL` as Id);
    return id >= 1 && id <= 8;
  }
  throw new Error(`tv: a type ${type} segment without its record`);
}

function savedEligible(c: TvContext, d: TvSegmentData): boolean {
  switch (d.kind) {
    case 'catch-success':
    case 'egg':
    case 'name-change':
    case 'safari':
    case 'storage':
    case 'seal-club':
    case 'size':
    case 'your-pokemon':
    case 'contest':
    case 'photo':
      return seen(c, d.species);
    case 'fishing':
      return d.species === null || seen(c, d.species);
    case 'ug-treasure':
    case 'traps':
      return hasExplorerKit(c);
    case 'villa-empty':
    case 'villa':
      return arrived(c, 'RESORT_AREA');
    case 'tower-streak':
      return seen(c, d.species) && arrived(c, 'FIGHT_AREA');
    case 'bp':
    case 'tower-corner':
    case 'frontier-single':
      return arrived(c, 'FIGHT_AREA');
    default:
      return true;
  }
}

// ---------------------------------------------------------------- messages (TVSegment_LoadMessage_*)

function segmentMessage(c: TvContext, type: number, id: number, record: TvRecord | null): Omit<TvMessage, 'bank'> | null {
  if (record) return savedMessage(c, record.data);
  if (type === TV_PROGRAM_TYPE.sinnohNow) return sinnohNowMessage(c, id);
  return varietyMessage(c, id);
}

const S = BANKS[2];
const I = BANKS[1];

function savedMessage(c: TvContext, d: TvSegmentData): Omit<TvMessage, 'bank'> {
  const m = (bank: string, name: string, slots: Record<number, TvSlot>) => ({ message: msg(c, bank, name), slots });
  const n = (number: number): TvSlot => ({ number });
  switch (d.kind) {
    case 'catch-success': {
      const slots: Record<number, TvSlot> = { 0: player(c), 1: speciesName(c, d.species), 2: itemName(c, d.ball), 3: n(d.balls) };
      if (d.nickname !== null) return m(S, 'TVProgramTrainerSightings_Text_CatchThatPokemonShow_Nicknamed', { ...slots, 4: { plain: d.nickname } });
      return m(S, 'TVProgramTrainerSightings_Text_CatchThatPokemonShow_NotNicknamed', slots);
    }
    case 'catch-failure':
      return m(S, d.fainted ? 'TVProgramTrainerSightings_Text_CatchThatPokemonShow_Fainted' : 'TVProgramTrainerSightings_Text_CatchThatPokemonShow_RanAway', { 0: player(c), 1: n(d.balls) });
    case 'fishing':
      if (d.species === null) return m(S, 'TVProgramTrainerSightings_Text_WhatsFishing_Failure', { 0: player(c) });
      return m(S, 'TVProgramTrainerSightings_Text_WhatsFishing_Success', { 0: player(c), 1: itemName(c, d.rod), 2: speciesName(c, d.species) });
    case 'hidden-item':
      return m(S, 'TVProgramTrainerSightings_Text_HiddenItemBreakingNews', { 0: location(d.location), 1: player(c), 2: itemName(c, d.item) });
    case 'shopping':
      return m(S, 'TVProgramTrainerSightings_Text_SinnohShoppingChampCorner', { 0: itemName(c, d.item), 1: n(d.amount), 2: player(c), 3: { bank: 'TEXT_BANK_ITEM_NAMES_PLURAL', entry: sourceOf(c, 'items', d.item) } });
    case 'egg':
      return m(S, 'TVProgramTrainerSightings_Text_HappyHappyEggClub', { 0: player(c), 1: location(d.location), 2: speciesName(c, d.species) });
    case 'name-change':
      return { message: msg(c, S, 'TVProgramTrainerSightings_Text_RateThatNameChange_MoreAttractive') + random(c, 5), slots: { 0: player(c), 1: speciesName(c, d.species), 2: { plain: d.nickname } } };
    case 'ug-treasure':
      return m(S, 'TVProgramTrainerSightings_Text_UndergroundTreasuresCorner', { 0: player(c), 1: { bank: 'TEXT_BANK_UNDERGROUND_ITEMS', entry: d.item }, 2: n(d.amount) });
    case 'safari':
      return m(S, 'TVProgramTrainerSightings_Text_SafariGameSpecialNewsBulletin', { 0: player(c), 1: speciesName(c, d.species), 2: n(d.caught) });
    case 'storage':
      return m(S, d.male ? 'TVProgramTrainerSightings_Text_PokemonStorageSpecialNewsBulletin_Male' : 'TVProgramTrainerSightings_Text_PokemonStorageSpecialNewsBulletin_Female', { 0: player(c), 1: speciesName(c, d.species) });
    case 'berries':
      return m(S, 'TVProgramTrainerSightings_Text_PlantingAndWateringShow', { 0: player(c), 1: itemName(c, d.berry), 2: n(d.amount) });
    case 'no-berries':
      return m(S, 'TVProgramTrainerSightings_Text_PlantingAndWateringShow_NoBerries', { 0: player(c), 1: itemName(c, d.berry) });
    case 'seal-club':
      return { message: msg(c, S, 'TVProgramTrainerSightings_Text_SealClubShow_CleverlyCalculated') + random(c, 3), slots: { 0: player(c), 1: { bank: 'TEXT_BANK_BALL_SEAL_NAMES', entry: d.seal }, 2: speciesName(c, d.species) } };
    case 'villa-empty':
      return m(S, 'TVProgramTrainerSightings_Text_HomeAndManor_NoFurniture', { 0: player(c) });
    case 'villa':
      return m(S, 'TVProgramTrainerSightings_Text_HomeAndManor', { 0: player(c), 1: { bank: 'TEXT_BANK_FURNITURE_NAMES', entry: d.furniture } });
    // Records: bare message numbers (sub_0206DBE8 …).
    case 'tower-streak':
      return { message: d.single ? 0 : 1, slots: { 0: player(c), 1: speciesName(c, d.species), 2: n(d.streak) } };
    case 'size': {
      const tenths = Math.floor((Math.floor((d.size * 1000) / 254) + 5) / 10);
      return { message: 2, slots: { 0: player(c), 1: speciesName(c, d.species), 2: n(Math.floor(tenths / 10)), 3: n(tenths % 10) } };
    }
    case 'slots':
      return { message: 3, slots: { 0: player(c), 1: n(d.spent), 2: n(d.before), 3: n(d.after) } };
    case 'ribbons':
      return { message: 4, slots: { 0: player(c), 1: d.nickname !== null ? { plain: d.nickname } : speciesName(c, d.species), 2: { bank: 'TEXT_BANK_RIBBON_NAMES', entry: d.ribbon }, 3: n(d.count) } };
    case 'traps':
      return { message: 7, slots: { 0: player(c), 1: { bank: 'TEXT_BANK_UNDERGROUND_TRAPS', entry: d.trap }, 2: n(Math.min(d.count, 999)) } };
    case 'bp':
      return { message: 9, slots: { 0: player(c), 1: n(d.total) } };
    // Interviews.
    case 'tower-corner':
      return m(I, d.win ? 'TVProgramInterviews_Text_BattleTowerCorner_Win' : 'TVProgramInterviews_Text_BattleTowerCorner_Lose', { 0: n(d.streak), 1: player(c), 2: { word: d.word } });
    case 'your-pokemon':
      if (d.nickname !== null) return m(I, 'TVProgramInterviews_Text_YourPokemonCorner_Nickname', { 0: player(c), 1: speciesName(c, d.species), 2: { plain: d.nickname }, 3: { word: d.word } });
      return m(I, 'TVProgramInterviews_Text_YourPokemonCorner_NoNickname', { 0: player(c), 1: speciesName(c, d.species), 3: { word: d.word } });
    case 'poketch':
      return m(I, 'TVProgramInterviews_Text_ThePoketchWatch', { 0: player(c), 1: { bank: 'TEXT_BANK_POKETCH_APP_NAMES', entry: d.app === null ? 0 : poketchAppIndex(d.app) }, 2: { word: d.word } });
    case 'contest':
      return m(I, d.placement === 1 ? 'TVProgramInterviews_Text_ContestHall_Win' : 'TVProgramInterviews_Text_ContestHall_Lose', {
        0: speciesName(c, d.species),
        1: { bank: 'TEXT_BANK_CONTEST_TEXT', entry: msg(c, 'TEXT_BANK_CONTEST_TEXT', CONTEST_TYPE_TEXT[d.type]!) },
        2: { bank: 'TEXT_BANK_CONTEST_TEXT', entry: msg(c, 'TEXT_BANK_CONTEST_TEXT', CONTEST_RANK_TEXT[d.rank]!) },
        3: n(d.placement),
        4: player(c),
        5: { word: d.word },
      });
    case 'photo':
      return m(I, 'TVProgramInterviews_Text_RightOnPhotoCorner', { 0: player(c), 1: speciesName(c, d.species), 2: { word: d.word } });
    case 'personality':
      return { message: msg(c, I, 'TVProgramInterviews_Text_StreetCornerPersonalityCheckup_NormalType') + d.type - 1, slots: { 0: player(c) } };
    case 'poffin': {
      const name = { 25: 'RichPoffin', 26: 'OverripePoffin', 27: 'FoulPoffin', 28: 'MildPoffin' }[d.poffin] ?? 'RegularPoffin';
      return m(I, `TVProgramInterviews_Text_ThreeCheersForPoffinCorner_${name}`, { 0: player(c), 1: { bank: 'TEXT_BANK_POFFIN_TYPES', entry: d.poffin }, 2: { word: d.word } });
    }
    case 'amity': {
      const slots: Record<number, TvSlot> = { 0: player(c), 1: speciesName(c, d.species), 2: { bank: 'TEXT_BANK_NATURE_NAMES', entry: d.nature }, 5: { word: d.word } };
      if (d.found && 'accessory' in d.found) return m(I, 'TVProgramInterviews_Text_AmitySquareWatch_FoundAccessory', { ...slots, 3: { bank: 'TEXT_BANK_CONTEST_ACCESSORY_NAMES', entry: d.found.accessory } });
      if (d.found) return m(I, 'TVProgramInterviews_Text_AmitySquareWatch_FoundItem', { ...slots, 3: itemName(c, d.found.item) });
      return m(I, 'TVProgramInterviews_Text_AmitySquareWatch', slots);
    }
    case 'frontier-single':
      return m(I, 'TVProgramInterviews_Text_BattleFrontierFrontlineNews_Single', { 0: player(c), 1: speciesName(c, d.species), 2: d.nickname !== null ? { plain: d.nickname } : speciesName(c, d.species), 3: { word: d.word } });
    case 'in-your-face':
      return m(I, `TVProgramInterviews_Text_InYourFaceInterview_Question${d.question}`, { 0: player(c), 1: { word: d.word } });
  }
}

/** Contest_GetContestTypeMessageID, Contest_GetRankMessageID (TEXT_BANK_CONTEST_TEXT). */
const CONTEST_TYPE_TEXT = ['Contest_Text_CoolContest', 'Contest_Text_BeautyContest', 'Contest_Text_CuteContest', 'Contest_Text_SmartContest', 'Contest_Text_ToughContest'];
const CONTEST_RANK_TEXT = ['Contest_Text_NormalRank', 'Contest_Text_GreatRank', 'Contest_Text_UltraRank', 'Contest_Text_MasterRank'];

/** sOnTheSpotWeatherLocations. */
const WEATHER_LOCATIONS = ['ROUTE_212_SOUTH', 'ROUTE_213', 'ROUTE_216', 'ACUITY_LAKEFRONT', 'SNOWPOINT_CITY'];
/** OVERWORLD_WEATHER_* → its On-the-Spot Weather message (after the four clear ones). */
const WEATHER_MESSAGES: Record<number, string> = {
  1: 'Cloudy',
  2: 'Raining',
  3: 'HeavyRain',
  5: 'Snowing',
  6: 'HeavySnow',
  7: 'Blizzard',
  4: 'Thunderstorm',
  11: 'Hailing',
};

/**
 * FieldSystem_GetWeather for another map: the header's weather, a yearly one for the saved date (January 2 under the clock
 * penalty); the weather's OVERWORLD_WEATHER_* value.
 */
function zoneWeather(c: TvContext, zone: Id): number {
  const w = c.registries.weathers.get(c.registries.zones.get(zone)!.weather)!;
  if (!w.yearly) return w.sourceIndex!;
  const day = c.state.gameTime.penaltyMinutes > 0 ? 1 : yearlyDayIndex(c.state.gameTime.now.date);
  return c.registries.weathers.get(w.yearly[day]!)!.sourceIndex!;
}

/** TVSegment_LoadMessage_YourTownsBestThree's towns: single headers and inclusive ranges of map headers. */
const TOWNS: { name: string; headers: string[]; ranges: [string, string][] }[] = [
  { name: 'TwinleafTown', headers: ['TWINLEAF_TOWN'], ranges: [['TWINLEAF_TOWN_RIVAL_HOUSE_1F', 'TWINLEAF_TOWN_SOUTHWEST_HOUSE']] },
  { name: 'SandgemTown', headers: ['SANDGEM_TOWN'], ranges: [['SANDGEM_TOWN_POKEMON_RESEARCH_LAB', 'SANDGEM_TOWN_HOUSE']] },
  { name: 'FloaromaTown', headers: ['FLOAROMA_TOWN', 'FLOAROMA_MEADOW_HOUSE'], ranges: [['FLOWER_SHOP', 'FLOAROMA_TOWN_MIDDLE_HOUSE']] },
  { name: 'SolaceonTown', headers: ['SOLACEON_TOWN'], ranges: [['POKEMON_DAY_CARE', 'SOLACEON_TOWN_EAST_HOUSE']] },
  { name: 'CelesticTown', headers: ['CELESTIC_TOWN'], ranges: [['CELESTIC_TOWN_NORTH_HOUSE', 'CELESTIC_TOWN_CAVE']] },
  { name: 'JubilifeCity', headers: ['JUBILIFE_CITY'], ranges: [['POKETCH_CO_1F', 'UNUSED_JUBILIFE_CITY_HOUSE_4']] },
  { name: 'CanalaveCity', headers: ['CANALAVE_CITY', 'CANALAVE_CITY_WEST_HOUSE'], ranges: [['CANALAVE_LIBRARY_1F', 'CANALAVE_CITY_SAILOR_ELDRITCH_HOUSE']] },
  { name: 'OreburghCity', headers: ['OREBURGH_CITY'], ranges: [['OREBURGH_CITY_NORTHWEST_HOUSE_1F', 'OREBURGH_CITY_SOUTH_HOUSE']] },
  { name: 'EternaCity', headers: ['ETERNA_CITY'], ranges: [['CYCLE_SHOP', 'UNUSED_ETERNA_CITY_HOUSE']] },
  { name: 'HearthomeCity', headers: ['HEARTHOME_CITY'], ranges: [['HEARTHOME_CITY_SOUTHEAST_HOUSE_1F', 'FOREIGN_BUILDING']] },
  { name: 'PastoriaCity', headers: ['PASTORIA_CITY'], ranges: [['PASTORIA_CITY_OBSERVATORY_GATE_1F', 'PASTORIA_CITY_NORTHEAST_HOUSE']] },
  { name: 'VeilstoneCity', headers: ['VEILSTONE_CITY'], ranges: [['GAME_CORNER', 'ROUTE_215_GATE_TO_VEILSTONE_CITY'], ['GALACTIC_HQ_1F', 'GALACTIC_HQ_B2F']] },
  { name: 'SunyshoreCity', headers: ['SUNYSHORE_CITY', 'VISTA_LIGHTHOUSE_ELEVATOR'], ranges: [['SUNYSHORE_MARKET', 'VISTA_LIGHTHOUSE']] },
  { name: 'SnowpointCity', headers: ['SNOWPOINT_CITY'], ranges: [['SNOWPOINT_CITY_WEST_HOUSE', 'SNOWPOINT_CITY_EAST_HOUSE']] },
];

/** sBerryLookoutPatchInfo, run-length: the arrival that lets a patch be shown, its map header, the patches in a row. */
const BERRY_LOOKOUT: [arrival: string, header: string, count: number][] = [
  ['FLOAROMA_TOWN', 'FLOAROMA_TOWN', 2], ['FLOAROMA_TOWN', 'ROUTE_205_SOUTH', 4], ['FLOAROMA_TOWN', 'ETERNA_FOREST_OUTSIDE', 4],
  ['CELESTIC_TOWN', 'FUEGO_IRONWORKS_OUTSIDE', 4], ['FLOAROMA_TOWN', 'ROUTE_205_NORTH', 4], ['OREBURGH_CITY', 'ROUTE_206', 4],
  ['OREBURGH_CITY', 'ROUTE_207', 4], ['OREBURGH_CITY', 'ROUTE_208', 4], ['HEARTHOME_CITY', 'ROUTE_209', 4], ['SOLACEON_TOWN', 'SOLACEON_TOWN', 4],
  ['SOLACEON_TOWN', 'ROUTE_210_SOUTH', 4], ['CELESTIC_TOWN', 'ROUTE_210_NORTH', 4], ['CELESTIC_TOWN', 'ROUTE_211_EAST', 4],
  ['HEARTHOME_CITY', 'ROUTE_212_NORTH', 4], ['PASTORIA_CITY', 'ROUTE_212_SOUTH', 4], ['PASTORIA_CITY', 'PASTORIA_CITY', 4],
  ['PASTORIA_CITY', 'ROUTE_213', 4], ['VEILSTONE_CITY', 'ROUTE_214', 4], ['VEILSTONE_CITY', 'ROUTE_215', 4], ['CELESTIC_TOWN', 'ROUTE_218', 4],
  ['CELESTIC_TOWN', 'ROUTE_221', 4], ['VEILSTONE_CITY', 'ROUTE_222', 4], ['OUTSIDE_VICTORY_ROAD', 'ROUTE_224', 4], ['FIGHT_AREA', 'FIGHT_AREA', 4],
  ['FIGHT_AREA', 'ROUTE_225', 4], ['SURVIVAL_AREA', 'ROUTE_226', 4], ['SURVIVAL_AREA', 'ROUTE_228', 4], ['SURVIVAL_AREA', 'ROUTE_229', 4],
  ['RESORT_AREA', 'RESORT_AREA', 4], ['SURVIVAL_AREA', 'ROUTE_230', 4],
];
const BERRY_STAGE_TEXT: Record<string, string> = { fruit: 'Fruit', blooming: 'Blooming', growing: 'Growing', sprouted: 'Sprouted' };
/** Decomp FLAVOR_* liked by a nature's raised stat (Pokemon_GetFlavorAffinityOf), and STAT_* order after HP. */
const FLAVOR_BY_STAT: Record<string, number> = { atk: 0, spa: 1, spe: 2, spd: 3, def: 4 };
const STAT_ORDER = ['atk', 'def', 'spe', 'spa', 'spd'];

function sinnohNowMessage(c: TvContext, id: number): Omit<TvMessage, 'bank'> | null {
  const B = BANKS[4];
  const m = (name: string, slots: Record<number, TvSlot> = {}) => ({ message: msg(c, B, `TVProgramSinnohNow_Text_${name}`), slots });
  switch (id) {
    case 2: {
      const zone = zoneId(c, WEATHER_LOCATIONS[random(c, WEATHER_LOCATIONS.length)]!);
      const slots = { 0: location(zoneLabel(c.registries, zone)) };
      const weather = zoneWeather(c, zone);
      if (weather === 0) return m(`OnTheSpotWeather_Clear${random(c, 4) + 1}`, slots);
      const name = WEATHER_MESSAGES[weather];
      // The DS asserts on another weather and shows the first clear message in release builds.
      return m(name ? `OnTheSpotWeather_${name}` : 'OnTheSpotWeather_Clear1', slots);
    }
    case 3: {
      const here = sourceOf(c, 'zones', c.state.player.zone);
      const at = (h: string) => sourceOf(c, 'zones', zoneId(c, h));
      const town = TOWNS.find((t) => t.headers.some((h) => at(h) === here) || t.ranges.some(([a, b]) => here >= at(a) && here <= at(b)));
      const rivals = { 0: player(c), 1: { plain: c.state.names.rival } };
      if (!town) return m('YourTownsBestThree_WhereWillWeGo', rivals);
      if (town.name === 'TwinleafTown') return m('YourTownsBestThree_TwinleafTown', rivals);
      if (town.name === 'SandgemTown') return m('YourTownsBestThree_SandgemTown', { 1: { bank: 'TEXT_BANK_COUNTERPART_NAMES', entry: c.state.gender === 'male' ? 1 : 0 } });
      return m(`YourTownsBestThree_${town.name}`);
    }
    case 5: {
      const special = newGameRecord(c.registries).specialEncounters;
      if (!special) throw new Error('tv: the pack has no swarm tables');
      const zone = special.swarms[swarmIndex(swarmDailyOf(c.state))]!;
      const table = c.registries.zones.get(zone)?.encounters;
      const species = table && c.registries.encounters.get(table)?.variants.swarm?.find((v) => v.slot === 0)?.species;
      if (!species) throw new Error(`tv: ${zone} has no swarm species`);
      return m('SwarmNewsFlash', { 0: location(zoneLabel(c.registries, zone)), 1: speciesName(c, species) });
    }
    case 9: {
      const patches = BERRY_LOOKOUT.flatMap(([a, h, n]) => Array.from({ length: n }, () => [a, h] as const)).map(([a, h], i) => ({ i, h, open: arrived(c, a) })).filter((p) => p.open);
      const p = patches[random(c, patches.length)]!;
      const stage = c.state.berryPatches[p.i]?.stage ?? 'none';
      return m(`BerryLookout_${BERRY_STAGE_TEXT[stage] ?? 'None'}`, { 0: location(zoneLabel(c.registries, zoneId(c, p.h))) });
    }
    case 12: {
      const personality = (c.rng() >>> 0) % 0xffff;
      const natures = [...c.registries.natures.values()].sort((a, b) => a.sourceIndex! - b.sourceIndex!);
      const nature = personality % 25;
      const up = natures[nature]!.up;
      const slots: Record<number, TvSlot> = { 0: { bank: 'TEXT_BANK_NATURE_NAMES', entry: nature } };
      if (!up || natures[nature]!.down === up) return m('RichBoyNatureCorner_NeutralNature', slots);
      if (personality % 2 === 0) return m('RichBoyNatureCorner_FlavorAffinity', { ...slots, 2: { bank: 'TEXT_BANK_FLAVOR_NAMES', entry: FLAVOR_BY_STAT[up]! } });
      return m('RichBoyNatureCorner_StatAffinity', { ...slots, 1: { bank: 'TEXT_BANK_POKEMON_STAT_NAMES', entry: 1 + STAT_ORDER.indexOf(up) } });
    }
    case 15: {
      const route = zoneId(c, ROAMING_ROUTES[random(c, ROAMING_ROUTES.length)]!.replace(/^MAP_HEADER_/, ''));
      const roamer = c.state.roamers.slots.find((s) => s !== null)!;
      return m('RoamerNewsFlash', { 0: { plain: c.registries.zones.get(route)!.name }, 1: speciesName(c, roamer.species) });
    }
    case 17: {
      const photos = c.state.dressUpPhotos.flatMap((p) => (p ? [p] : []));
      const photo = photos[photos.length > 1 ? random(c, photos.length) : 0]!;
      return m('PokemonPhotoRating', { 0: { plain: photo.trainerName }, 1: { word: photo.title ?? 0 } });
    }
    default:
      return null;
  }
}


/** The first seen species from a number (sub_0206F01C, sub_0206F160): counts up through the national dex, wrapping. */
function seenFrom(c: TvContext, start: number, wrapAt: number): Id | null {
  const byNumber = speciesByNumber(c);
  let n = start;
  for (let i = 1; i <= NATIONAL_DEX; i++) {
    const s = byNumber.get(n);
    if (s && seen(c, s)) return s;
    n++;
    if (n >= wrapAt) n = 1;
  }
  return null;
}

function varietyMessage(c: TvContext, id: number): Omit<TvMessage, 'bank'> | null {
  switch (id) {
    case 1: {
      const tier = gameCompleted(c) ? 8 : arrived(c, 'HEARTHOME_CITY') ? 5 : arrived(c, 'ETERNA_CITY') ? 4 : arrived(c, 'OREBURGH_MINE') ? 2 : 0;
      return { message: tier ? random(c, tier) : 0, slots: {} };
    }
    case 2: {
      const species = seenFrom(c, random(c, NATIONAL_DEX - 1) + 1, NATIONAL_DEX);
      if (!species) throw new Error('tv: the Variety Hour names a seen species with none seen');
      const slots: Record<number, TvSlot> = { 0: speciesName(c, species) };
      const v = random(c, 3);
      if (v === 0) return { message: 8, slots };
      if (v === 1) return { message: 9, slots: { ...slots, 1: { number: random(c, 34) + 25 } } };
      return { message: 10, slots };
    }
    case 3:
      return { message: 11 + random(c, 3), slots: {} };
    case 4:
      return { message: 14 + random(c, 3), slots: {} };
    case 5: {
      const lead = c.state.party.find((p) => !p.isEgg);
      if (!lead) throw new Error('tv: the Variety Hour needs a Pokémon that is not an Egg');
      const accessory = random(c, ACCESSORIES.count);
      const species = seenFrom(c, random(c, NATIONAL_DEX - 2) + 1, NATIONAL_DEX);
      // LCRNG_Next() % 467 − 2 + 1: a draw of 0 names no move on the DS; the bank's first entry stands in.
      const move = Math.max(0, random(c, 467) - 1);
      const slots: Record<number, TvSlot> = { 0: speciesName(c, lead.species), 1: { bank: 'TEXT_BANK_CONTEST_ACCESSORY_NAMES', entry: accessory }, 3: { bank: 'TEXT_BANK_MOVE_NAMES', entry: move } };
      if (species) slots[2] = speciesName(c, species);
      return { message: 17, slots };
    }
    case 6:
      return { message: 18, slots: {} };
    case 7:
      return { message: 19, slots: {} };
    case 8:
      return { message: 20 + random(c, 9), slots: {} };
    default:
      return null;
  }
}

// ---------------------------------------------------------------- interviews (scrcmd_tv_broadcast.c sInterviews)

/** sub_0202E6B0 for the interviews list: a new answer can be saved (no unplayed one of the segment; a free or worn-out slot). */
function interviewRoom(state: GameState, id: number): boolean {
  const list = state.tv.interviews;
  const ofId = list.filter((r): r is TvRecord => r !== null && tvSegmentId(r.data).id === id);
  if (ofId.some((r) => r.plays === 0)) return false;
  if (ofId.length) return ofId.some((r) => r.plays >= TV.plays);
  return list.some((r) => r === null || r.plays >= TV.plays);
}

/** TVInterview_IsEligible (ScrCmd_CheckTVInterviewEligible). */
export function tvInterviewEligible(c: TvContext, id: number): boolean {
  if (!interviewRoom(c.state, id)) return false;
  const p = c.state.tv.pending;
  switch (id) {
    case 2:
      return p.tower !== null;
    case 6:
      return c.state.poketch.enabled;
    case 7:
      return p.contest !== null;
    case 9:
      return c.state.dressUpPhotos[0] !== null;
    case 11:
      return p.poffin !== null;
    case 13:
      return p.amity !== null;
    case 14:
      return p.hall !== null;
    case 19: // The multi partner (sub_0206D088) is a link player's.
      return false;
    default:
      return true;
  }
}

/** Party_FindFirstHatchedMon. */
function firstHatched(state: GameState) {
  const mon = state.party.find((p) => !p.isEgg);
  if (!mon) throw new Error('tv: no Pokémon that is not an Egg');
  return mon;
}

/** TVInterview_LoadMessage: the reporter's question (TEXT_BANK_TV_REPORTER_INTERVIEWS) with its template. */
export function tvInterviewMessage(c: TvContext, id: number): TvMessage {
  const slots: Record<number, TvSlot> = {};
  const p = c.state.tv.pending;
  if (id === 4) slots[0] = speciesName(c, firstHatched(c.state).species);
  if (id === 6) slots[0] = { bank: 'TEXT_BANK_POKETCH_APP_NAMES', entry: c.state.poketch.current ? poketchAppIndex(c.state.poketch.current) : 0 };
  if (id === 13 && p.amity) slots[0] = speciesName(c, p.amity.species);
  if (id === 14 && p.hall) slots[0] = speciesName(c, p.hall.species);
  if (id < 1 || id > 19) throw new Error(`tv: interview ${id}`);
  return { bank: BANKS.reporter, message: id + 2, slots };
}

/**
 * TVInterview_SaveResponse (FieldSystem_SaveTVSegment_*): the answer with what it is about; the pending data it used is
 * cleared. The unused interviews save nothing.
 */
export function tvSaveInterview(c: TvContext, id: number, word: number): void {
  const p = c.state.tv.pending;
  const save = (data: TvSegmentData) => saveTvSegment(c.state, data);
  const nickname = (mon: { nickname?: string | null }) => mon.nickname ?? null;
  switch (id) {
    case 2:
      save({ kind: 'tower-corner', win: p.tower!.win, streak: p.tower!.streak, word });
      p.tower = null;
      break;
    case 4: {
      const mon = firstHatched(c.state);
      save({ kind: 'your-pokemon', species: mon.species, nickname: nickname(mon), word });
      break;
    }
    case 6:
      save({ kind: 'poketch', app: c.state.poketch.current, word });
      break;
    case 7:
      save({ kind: 'contest', ...p.contest!, word });
      p.contest = null;
      break;
    case 9:
      save({ kind: 'photo', species: c.state.dressUpPhotos[0]!.mon.species, word });
      break;
    case 10:
      save({ kind: 'personality', type: word });
      break;
    case 11:
      save({ kind: 'poffin', poffin: p.poffin!, word });
      p.poffin = null;
      break;
    case 13:
      save({ kind: 'amity', ...p.amity!, word });
      p.amity = null;
      break;
    case 14:
      save({ kind: 'frontier-single', species: p.hall!.species, nickname: p.hall!.nickname, word });
      p.hall = null;
      break;
    case 15:
    case 16:
    case 17:
    case 18:
      save({ kind: 'in-your-face', question: (id - 14) as 1 | 2 | 3 | 4, word });
      break;
    case 19:
      throw new Error('tv: the multi partner interview is link-only');
    default:
      break;
  }
}
