/**
 * Super Contests, the rules (docs/research/contests.md; decomp src/contest.c, src/unk_02094EDC.c,
 * overlay017/ov17_0223F118.c and ov17_02250744.c, applications/party_menu/main.c): who may enter, the contest's RNG,
 * the theme, judges and rivals, the condition score, the final scoring and placement, and the rewards. Pure rules over
 * `GameState` and `ContestTables`; the VM and the contest app call them. Independent implementation.
 */
import { CONTEST_COMPETITION, CONTEST_ENTRANTS, CONTEST_TYPES, dexOf, markSeen, newGameRecord, seenFormOf, tvRibbon, type ContestEntrant, type ContestOpponent, type ContestRawScores, type ContestResult, type ContestSession, type ContestTables, type FashionCase, type GameState, type Registries } from '@opensinnoh/contracts';
import { createPokemon, MAX_FRIENDSHIP, type ConditionName, type Id, type Pokemon } from '@opensinnoh/core';
import { canFitAccessory } from './fashion.ts';
import { bySource } from './forms.ts';
import { addToGameRecord, incrementTrainerScore } from './score.ts';
import { systemFlag } from './dex.ts';

/** Decomp enum Ribbon: RIBBON_COOL (33) … RIBBON_TOUGH_MASTER (52), four ranks per type. */
export const CONTEST_RIBBON_FIRST = 33;
export const contestRibbon = (type: number, rank: number): number => CONTEST_RIBBON_FIRST + type * 4 + rank;
/** Decomp FLAG_CONTEST_MASTER_COOL (2408) … _TOUGH and FLAG_GAME_COMPLETED (generated/vars_flags.txt). */
const FLAG_CONTEST_MASTER = 2408;
const FLAG_GAME_COMPLETED = 2404;
/** Decomp RECORD_SUPER_CONTEST_PARTICIPATIONS, RECORD_OFFICIAL_CONTEST_WINS, RECORD_RIBBONS_WON; TRAINER_SCORE_EVENT_WIN_OFFICIAL_CONTEST. */
const RECORD = { participations: 90, wins: 92, ribbons: 94 } as const;
const SCORE_WIN_OFFICIAL_CONTEST = 13;
/** Decomp ITEM_RED_SCARF (260), then BLUE, PINK, GREEN, YELLOW: one per contest type in CONTEST_TYPE order. */
const FIRST_SCARF = 260;
/** Decomp sFriendshipChangeTable[FRIENDSHIP_EVENT_CONTEST_WIN] by tier (below 100, below 200, else). */
const CONTEST_WIN_FRIENDSHIP = [3, 2, 1] as const;
/** Decomp ITEM_LUXURY_BALL and HOLD_EFFECT_FRIENDSHIP_UP's item (ITEM_SOOTHE_BELL). */
const ITEM_LUXURY_BALL = 11;
const ITEM_SOOTHE_BELL = 218;

/**
 * Decomp Contest_CalcFirstTimeVictoryAccessoryReward: the prize per type and rank (ACCESSORY_RED_BARRETTE …
 * ACCESSORY_AWARD_PODIUM ids, generated/accessories.txt).
 */
const VICTORY_ACCESSORIES: readonly (readonly number[])[] = [
  [73, 78, 83, 88], // cool: red barrette, red balloons, top hat, gold pedestal
  [74, 79, 84, 89], // beauty: blue barrette, blue balloons, silk veil, glass stage
  [72, 77, 82, 87], // cute: pink barrette, pink balloon, lace headdress, flower stage
  [76, 81, 86, 91], // smart: green barrette, green balloons, professor hat, cube stage
  [75, 80, 85, 90], // tough: yellow barrette, yellow balloons, heroic headband, award podium
];
/** No prize (decomp 0xFFFF). */
export const NO_ACCESSORY = 0xffff;

/** Decomp sub_02095928: the condition score's hearts per rank (0–8). */
const CONDITION_HEARTS = [
  [10, 20, 30, 40, 50, 60, 70, 80],
  [90, 110, 130, 150, 170, 190, 210, 230],
  [170, 200, 230, 260, 290, 320, 350, 380],
  [320, 360, 400, 440, 480, 520, 560, 600],
] as const;
/** Decomp sub_0209598C: the dress-up score's hearts per rank (0–4). */
const DRESS_UP_HEARTS = [
  [3, 5, 8],
  [5, 10, 15],
  [7, 15, 23],
  [10, 20, 30],
] as const;

/** The contests' tables of the loaded packs; fails loudly without them. */
export function contestTables(registries: Registries): ContestTables {
  const t = [...registries.newGame.values()][0]?.contests;
  if (!t) throw new Error('contests: the packs have no contest tables (NewGame.contests)');
  return t;
}

/** The contest LCRNG (decomp LCRNG_Next, Contest_GetRNGNext): the next u16 of `session.rng`. */
export function contestRandom(session: Pick<ContestSession, 'rng'>): number {
  session.rng = (Math.imul(session.rng, 0x41c64e6d) + 0x6073) >>> 0;
  return session.rng >>> 16;
}

/** The ribbons of a contest type a Pokémon holds (decomp CountEarnedRibbonsForContestType). */
export const typeRibbons = (mon: Pokemon, type: number): number => [0, 1, 2, 3].filter((r) => mon.ribbons.includes(contestRibbon(type, r))).length;

/** Decomp CheckContestEligibility: not an Egg, not fainted, `rank` ribbons of the type at least, two moves at least. */
export function contestEligible(mon: Pokemon, rank: number, type: number): boolean {
  if (mon.isEgg || mon.hp === 0) return false;
  return typeRibbons(mon, type) >= rank && mon.moves.length >= 2;
}

/**
 * Decomp CalcMonContestFame: 1, plus one per ribbon of the type held from Normal up without a gap. The decomp reads a
 * fifth one past Master: the next type's Normal ribbon (Tough reads an unused bit, never set).
 */
export function contestFame(mon: Pokemon, type: number): number {
  let fame = 1;
  for (let i = 0; i <= 4; i++) {
    const k = type * 4 + i;
    if (k >= 20 || !mon.ribbons.includes(CONTEST_RIBBON_FIRST + k)) break;
    fame++;
  }
  return fame;
}

/** Decomp sub_02095A74: the visual theme. Master picks any of the 12; lower ranks from their pool. */
export function pickTheme(rank: number, rng: () => number): number {
  if (rank >= 3) return rng() % 12;
  const pool = [2, 3, 4, ...(rank >= 1 ? [0, 1, 5] : []), ...(rank >= 2 ? [6, 7, 8] : [])];
  return pool[rng() % pool.length]!;
}

/**
 * Decomp sub_020954F0: the rank's judges for the type, the two side judges in table order and one main-judge candidate
 * at random, which takes the middle seat.
 */
export function pickJudges(tables: ContestTables, rank: number, type: number, rng: () => number): number[] {
  const side: number[] = [];
  const main: number[] = [];
  tables.judges.forEach((j, i) => {
    if (j.rank !== rank || !j.roles[type]) return;
    (j.roles[type]! > 1 ? main : side).push(i);
  });
  if (side.length < 2 || main.length < 1) throw new Error(`contests: rank ${rank} type ${type} has ${side.length} side judges and ${main.length} main judges`);
  const judges = [side[0]!, side[1]!, main[rng() % main.length]!];
  return [judges[0]!, judges[2]!, judges[1]!];
}

/** Which opponents may enter (decomp sub_02094F04's filter). `postgame`: the game completed and the National Pokédex. */
export function opponentPool(tables: ContestTables, rank: number, type: number, competition: number, postgame: boolean): number[] {
  const practice = competition === CONTEST_COMPETITION.practiceVisual || competition === CONTEST_COMPETITION.practiceDance || competition === CONTEST_COMPETITION.practiceActing;
  const single = competition === CONTEST_COMPETITION.visual || competition === CONTEST_COMPETITION.dance || competition === CONTEST_COMPETITION.acting;
  return tables.opponents.flatMap((o, i) => {
    if (o.rank !== rank) return [];
    if (postgame ? o.pool === 1 : o.pool >= 2) return [];
    if (practice ? !o.practice : single ? !o.single : o.practice || o.single) return [];
    return o.types.includes(type) ? [i] : [];
  });
}

/**
 * Decomp sub_02094F04 for the three NPCs (contestant ids 1–3): each drawn from the pool and removed from it; a post-game
 * star (pool 3) is never drawn there, but when the pool has any, one of them (drawn first) takes a random NPC seat.
 */
export function pickOpponents(tables: ContestTables, pool: readonly number[], rng: () => number): number[] {
  const left = [...pool];
  const stars = left.filter((i) => tables.opponents[i]!.pool === 3);
  if (left.length < CONTEST_ENTRANTS - 1) throw new Error(`contests: ${left.length} opponents for 3 seats`);
  const star = stars.length ? stars[rng() % stars.length]! : null;
  const seats: number[] = [];
  while (seats.length < CONTEST_ENTRANTS - 1) {
    const k = rng() % left.length;
    if (tables.opponents[left[k]!]!.pool === 3) continue;
    seats.push(left[k]!);
    left.splice(k, 1);
  }
  if (star !== null) seats[rng() % (CONTEST_ENTRANTS - 1)] = star;
  return seats;
}

/** Decomp sub_02074128: a personality that gives the trainer's gender to a species of mixed gender (low byte only). */
function genderPid(genderRatio: number, gender: 'male' | 'female'): number {
  if (genderRatio === 0 || genderRatio === 254 || genderRatio === 255 || gender === 'female') return 0;
  return 25 * (Math.floor(genderRatio / 25) + 1);
}

/** Decomp sub_02095380: an opponent's Pokémon, level 10, random IVs (two draws, as Pokemon_InitWith), its moves, names and condition. */
export function opponentMon(registries: Registries, o: ContestOpponent, rng: () => number): Pokemon {
  const dex = dexOf(registries);
  const text = (id: Id) => {
    const t = registries.texts.get(id);
    if (!t) throw new Error(`contests: no text ${id}`);
    return t.text;
  };
  const otName = text(o.trainerName);
  const mon = createPokemon(dex, {
    species: o.species,
    level: 10,
    pid: genderPid(dex.species(o.species).genderRatio, o.gender),
    ivs: { hp: 0, attack: 0, defense: 0, speed: 0, spAttack: 0, spDefense: 0 },
    otId: 0x0f0f0f0f,
    otName,
    otGender: o.gender,
    ball: newGameRecord(registries).pokeBall,
    moves: o.moves,
    nickname: text(o.nickname),
  });
  const a = rng() & 0x7fff;
  const b = rng() & 0x7fff;
  mon.ivs = { hp: a & 31, attack: (a >> 5) & 31, defense: (a >> 10) & 31, speed: b & 31, spAttack: (b >> 5) & 31, spDefense: (b >> 10) & 31 };
  mon.condition = { ...o.condition };
  return mon;
}

export interface NewContestOptions {
  mode: 'official' | 'practice';
  rank: number;
  type: number;
  competition: number;
  partySlot: number;
  /** The contest LCRNG's seed (decomp Contest_SetLCRNGSeed). */
  seed: number;
}

/**
 * Decomp Contest_Init (offline): the player's Pokémon copied, the theme, the judges and the three rivals with their
 * Pokémon, in the decomp's order of draws.
 */
export function newContest(state: GameState, registries: Registries, o: NewContestOptions): ContestSession {
  const tables = contestTables(registries);
  const mon = state.party[o.partySlot];
  if (!mon) throw new Error(`new_contest: no party Pokémon in slot ${o.partySlot}`);
  const session: ContestSession = { mode: o.mode, rank: o.rank, type: o.type, competition: o.competition, partySlot: o.partySlot, theme: 0, rng: o.seed >>> 0, entrants: [], judges: [], scores: null, result: null, placement: null, dressUp: null };
  const rng = () => contestRandom(session);
  session.theme = pickTheme(o.rank, rng);
  session.judges = pickJudges(tables, o.rank, o.type, rng);
  const postgame = systemFlag(state, registries, FLAG_GAME_COMPLETED) && state.pokedex.national;
  const seats = pickOpponents(tables, opponentPool(tables, o.rank, o.type, o.competition, postgame), rng);
  const player: ContestEntrant = { opponent: null, trainerName: state.names.player, gender: state.gender, mon: structuredClone(mon), fame: contestFame(mon, o.type), gfx: tables.playerGfx[state.gender], aiLevel: 0 };
  const npcs = seats.map((i): ContestEntrant => {
    const op = tables.opponents[i]!;
    const m = opponentMon(registries, op, rng);
    return { opponent: i, trainerName: m.otName, gender: op.gender, mon: m, fame: op.fame, gfx: op.gfx, aiLevel: op.aiLevel };
  });
  session.entrants = [player, ...npcs];
  return session;
}

const SECONDARY: readonly [ConditionName, ConditionName][] = [
  ['tough', 'beauty'],
  ['cool', 'cute'],
  ['beauty', 'smart'],
  ['cute', 'tough'],
  ['smart', 'cool'],
];

/**
 * Decomp ov17_0223F374: the type's condition plus half of its two neighbours' and the sheen, then ×110 % with the type's
 * scarf held or ×105 % with a neighbour's (integer arithmetic).
 */
export function conditionPoints(registries: Registries, mon: Pokemon, type: number): number {
  const c = mon.condition;
  const [a, b] = SECONDARY[type]!;
  let points = c[CONTEST_TYPES[type]!] + Math.floor((c[a] + c[b] + c.sheen) / 2);
  const scarf = (t: number) => bySource(registries, 'items', FIRST_SCARF + t);
  const modifier = mon.heldItem === null ? 100 : mon.heldItem === scarf(type) ? 110 : mon.heldItem === scarf((type + 4) % 5) || mon.heldItem === scarf((type + 1) % 5) ? 105 : 100;
  points = Math.floor((points * modifier) / 100);
  return points;
}

/** Decomp sub_02095928: the condition score as hearts (0–8) for the rank. */
export function conditionHearts(points: number, rank: number): number {
  const t = CONDITION_HEARTS[rank]!;
  const n = t.findIndex((v) => points < v);
  return n < 0 ? t.length : n;
}

/** Decomp sub_0209598C: the dress-up score as hearts (0 for none, else 1–4) for the rank. */
export function dressUpHearts(points: number, rank: number): number {
  if (points === 0) return 0;
  const t = DRESS_UP_HEARTS[rank]!;
  const n = t.findIndex((v) => points <= v);
  return 1 + (n < 0 ? t.length : n);
}

/** The visual round's raw value per contestant (decomp ov17_02251930 case 0): condition hearts plus dress-up hearts. */
export function visualRaw(scores: ContestRawScores, rank: number): number[] {
  if (!scores.dressUp) throw new Error('contests: the visual round has not run');
  return scores.condition.map((c, i) => conditionHearts(c, rank) + dressUpHearts(scores.dressUp![i]!, rank));
}

/**
 * Decomp ov17_02251860: each round's weight (of 10000) by competition. The full contest weighs each 3333; a practice
 * or single competition weighs its one round 10000.
 */
export function roundWeights(competition: number): [number, number, number] {
  switch (competition) {
    case CONTEST_COMPETITION.full:
      return [3333, 3333, 3333];
    case CONTEST_COMPETITION.practiceVisual:
    case CONTEST_COMPETITION.visual:
      return [10000, 0, 0];
    case CONTEST_COMPETITION.practiceDance:
    case CONTEST_COMPETITION.dance:
      return [0, 10000, 0];
    case CONTEST_COMPETITION.practiceActing:
    case CONTEST_COMPETITION.acting:
      return [0, 0, 10000];
  }
  throw new Error(`contests: competition ${competition}`);
}

/**
 * Decomp ov17_02251A1C for a full contest: each round normalised to its weight against its leader (ov17_02251930:
 * the weight divided by the leader's raw value, times each raw value, rounded to hundredths), each as a percentage of
 * the round's leader and as a bar of up to 64 px (ov17_02251914), then placed by the bars' total, highest first, a tie
 * broken by a random draw per contestant (drawn in contestant order before the sort).
 */
export function finalResult(scores: ContestRawScores, rank: number, competition: number, rng: () => number): ContestResult {
  if (!scores.dance || !scores.acting) throw new Error('contests: final scoring needs all three rounds');
  const weights = roundWeights(competition);
  const raws = [visualRaw(scores, rank), scores.dance, scores.acting];
  const points = raws.map((raw, r) => {
    const top = Math.max(...raw);
    if (top <= 0) throw new Error(`contests: round ${r} has no points at all (the decomp divides by zero)`);
    const factor = Math.floor(weights[r]! / top);
    return raw.map((v) => Math.floor((v * factor + 50) / 100));
  });
  const bars = points.map((p, r) => {
    const top = Math.max(...p);
    const length = Math.floor((192 * weights[r]! + 5000) / 10000);
    return p.map((v) => Math.floor((length * Math.floor((100 * v) / top)) / 100));
  });
  const totals = [0, 1, 2, 3].map((i) => points[0]![i]! + points[1]![i]! + points[2]![i]!);
  const barTotals = [0, 1, 2, 3].map((i) => bars[0]![i]! + bars[1]![i]! + bars[2]![i]!);
  const order = [0, 1, 2, 3];
  const tie = order.map(() => rng());
  const value = [...barTotals];
  for (let i = 0; i < 3; i++) {
    for (let j = 3; j > i; j--) {
      if (value[j - 1]! < value[j]! || (value[j - 1] === value[j] && tie[j - 1]! < tie[j]!)) {
        [value[j - 1], value[j]] = [value[j]!, value[j - 1]!];
        [order[j - 1], order[j]] = [order[j]!, order[j - 1]!];
        [tie[j - 1], tie[j]] = [tie[j]!, tie[j - 1]!];
      }
    }
  }
  const placements = [0, 0, 0, 0];
  order.forEach((id, place) => (placements[id] = place));
  return { points, bars, totals, placements };
}

/** Decomp FieldTask_RunPracticeCompetition state 7: the player's place is the number of rivals with more points in the round. */
export function practicePlacement(scores: ContestRawScores, rank: number, competition: number): number {
  const raw =
    competition === CONTEST_COMPETITION.practiceVisual ? visualRaw(scores, rank)
    : competition === CONTEST_COMPETITION.practiceDance ? scores.dance
    : scores.acting;
  if (!raw) throw new Error(`contests: practice ${competition} has no points`);
  return raw.slice(1).filter((v) => raw[0]! < v).length;
}

/** Decomp Contest_GetWinningContestantEntryNum's contestant: the one placed first. */
export function winner(session: ContestSession): number {
  if (!session.result) throw new Error('contests: no result yet');
  return session.result.placements.indexOf(0);
}

/** Decomp Contest_CalcFirstTimeVictoryAccessoryReward: the prize for a win when the Fashion Case has room, else NO_ACCESSORY. */
export function victoryAccessory(session: ContestSession, fc: FashionCase): number {
  if (session.placement !== 0) return NO_ACCESSORY;
  const accessory = VICTORY_ACCESSORIES[session.type]![session.rank]!;
  return canFitAccessory(fc, accessory, 1) ? accessory : NO_ACCESSORY;
}

/** Decomp Pokemon_UpdateFriendship(FRIENDSHIP_EVENT_CONTEST_WIN) without the met-location bonus (the model keeps no egg location). */
function contestWinFriendship(registries: Registries, mon: Pokemon): void {
  if (mon.isEgg) return;
  const tier = mon.friendship >= 200 ? 2 : mon.friendship >= 100 ? 1 : 0;
  let change: number = CONTEST_WIN_FRIENDSHIP[tier]!;
  if (mon.ball === bySource(registries, 'items', ITEM_LUXURY_BALL)) change++;
  if (mon.heldItem !== null && mon.heldItem === bySource(registries, 'items', ITEM_SOOTHE_BELL)) change = Math.floor((change * 150) / 100);
  mon.friendship = Math.min(MAX_FRIENDSHIP, mon.friendship + change);
}

/**
 * Decomp Contest_EndContest for an official contest (practice ends with nothing): the Master flag on a first Master win,
 * the ribbon (RECORD_RIBBONS_WON when new), the participation and win records and the trainer score, the rivals seen in
 * the Pokédex, the winner photo and the friendship of a win, the ribbons record and the Contest Hall reporter's data (TV).
 */
export function endContest(state: GameState, registries: Registries, session: ContestSession): void {
  if (session.mode !== 'official') return;
  if (session.placement === null) throw new Error('end_contest: the contest has not run');
  const mon = state.party[session.partySlot];
  if (!mon) throw new Error(`end_contest: no party Pokémon in slot ${session.partySlot}`);
  const won = session.placement === 0;
  if (won && session.rank === 3) setFlagBySource(state, registries, FLAG_CONTEST_MASTER + session.type);
  let ribbonWon = false;
  if (won) {
    const ribbon = contestRibbon(session.type, session.rank);
    if (!mon.ribbons.includes(ribbon)) {
      ribbonWon = true;
      mon.ribbons = [...mon.ribbons, ribbon].sort((a, b) => a - b);
    }
    tvRibbon(state, mon, ribbon);
  }
  // TVBroadcast_SetContestHallShowInfo: the entrant and its placement for the Contest Hall reporter.
  state.tv.pending.contest = { species: mon.species, type: session.type, rank: session.rank, placement: session.placement + 1 };
  addToGameRecord(state, registries, RECORD.participations, 1);
  if (won) {
    addToGameRecord(state, registries, RECORD.wins, 1);
    incrementTrainerScore(state, registries, SCORE_WIN_OFFICIAL_CONTEST);
  }
  if (ribbonWon) addToGameRecord(state, registries, RECORD.ribbons, 1);
  for (const e of session.entrants.slice(1)) markSeen(state, e.mon.species, seenFormOf(registries, e.mon));
  if (won) {
    state.contestPhotos[session.type] = {
      mon: { species: mon.species, form: mon.form, pid: mon.pid, otId: mon.otId, nickname: mon.nickname },
      trainerName: state.names.player,
      rank: session.rank,
      dressUp: session.dressUp ?? { accessories: [], monPriority: 0, backdrop: 0 },
    };
    contestWinFriendship(registries, mon);
  }
}

function setFlagBySource(state: GameState, registries: Registries, sourceIndex: number): void {
  const flag = [...registries.flags.values()].find((f) => f.sourceIndex === sourceIndex);
  if (!flag) throw new Error(`no flag with sourceIndex ${sourceIndex}`);
  state.flags[flag.id] = true;
}
