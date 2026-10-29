/**
 * A headless battle soak (ROM-gated users: tests/integration/battle-soak-*.rom.test.ts and tools/battle-soak.ts): full
 * battles through the real controller and trainer AI, the frontier's parties from the facilities' own generation code,
 * and the player's side played by a seeded policy that answers every prompt the card and the d-pad can: the trainer
 * AI's own pick for the player's battler, any move slot (refused ones included, from the command prompt and from the
 * move list), switches, the party and bag sheets, items where the battle has a bag, CANCEL, RUN and forfeit. A thrown
 * error, or a battle that stops asking and never ends, is a finding; the facility and seed reproduce it.
 */
import { createPokemon, Prng, type Bag, type Id, type PackData, type Pokemon } from '@opensinnoh/core';
import { dexOf, newGameRecord, type Battle, type BattleChoice, type BattleSetup, type FrontierTables, type GameState, type InputFrame, type NewGame, type Registries } from '@opensinnoh/contracts';
import { CountingStubLog, loadGamePacks, newGameState } from '@opensinnoh/game';
import { BattleArcade, BattleCastle, BattleFactory, BattleHall, BattleTower, frontierPokemon, frontierTables, TOWER_MODE } from '@opensinnoh/services';
import { createBattle } from '../packages/battle/src/controller.ts';
import type { TrainerAi } from '../packages/battle/src/ai/choose.ts';
import type { AiBattleView, AiMemory } from '../packages/battle/src/ai/view.ts';

export const SOAK_FACILITIES = [
  'tower-single',
  'tower-double',
  'tower-multi',
  'factory-single',
  'factory-double',
  'factory-open',
  'hall-single',
  'hall-double',
  'castle-single',
  'castle-double',
  'arcade-single',
  'arcade-double',
  'late-game',
  'specials',
] as const;
export type SoakFacility = (typeof SOAK_FACILITIES)[number];

const IDLE: InputFrame = { held: [], pressed: [], touch: null };
/** The player's AI flags are drawn per battle from AI_FLAG_BASIC … AI_FLAG_HARRASSMENT (bits 0–10). */
const PLAYER_AI_FLAGS = 0x7ff;
const MAX_TICKS = 400_000;
const MAX_TURNS = 120;

/**
 * The player's side for `specials`: species, ability slot (the PID's low bit) and moves that reach rare paths, one
 * of each, against a Battle Tower trainer: Transform and one-move Pokémon (Struggle when the move is refused), Sketch,
 * Mimic and Copycat (what may be copied), Me First, Snatch, Doom Desire, Wonder Guard (the AI's switch for it),
 * trapping abilities and moves, Bide, Uproar, Rollout, recharge and two-turn moves, Perish Song and Destiny Bond.
 */
const SPECIALS: [species: string, slot: 0 | 1, moves: string[], item?: string][] = [
  ['DITTO', 0, ['TRANSFORM'], 'CHOICE_SCARF'],
  ['MAGIKARP', 0, ['SPLASH']],
  ['UNOWN', 0, ['HIDDEN_POWER'], 'CHOICE_SPECS'],
  ['SMEARGLE', 0, ['SKETCH', 'SPORE', 'BATON_PASS', 'SPIKES']],
  ['MR_MIME', 0, ['ME_FIRST', 'SNATCH', 'MIMIC', 'COPYCAT']],
  ['JIRACHI', 0, ['DOOM_DESIRE', 'WISH', 'PROTECT', 'IRON_HEAD']],
  ['SHEDINJA', 0, ['SHADOW_SNEAK', 'X_SCISSOR', 'WILL_O_WISP', 'PROTECT'], 'FOCUS_SASH'],
  ['WOBBUFFET', 0, ['COUNTER', 'MIRROR_COAT', 'ENCORE', 'DESTINY_BOND']],
  ['DUGTRIO', 0, ['EARTHQUAKE', 'SUCKER_PUNCH', 'STONE_EDGE', 'ROAR'], 'CHOICE_BAND'],
  ['MAGNEZONE', 0, ['THUNDERBOLT', 'FLASH_CANNON', 'MAGNET_RISE', 'EXPLOSION'], 'SHED_SHELL'],
  ['GENGAR', 0, ['MEAN_LOOK', 'PERISH_SONG', 'DESTINY_BOND', 'TAUNT']],
  ['SNORLAX', 1, ['BIDE', 'UPROAR', 'ROLLOUT', 'BELLY_DRUM']],
  ['SLAKING', 0, ['GIGA_IMPACT', 'HYPER_BEAM', 'FOCUS_PUNCH', 'ENCORE'], 'CHOICE_BAND'],
  ['TROPIUS', 0, ['SOLAR_BEAM', 'SUNNY_DAY', 'FLY', 'WHIRLWIND'], 'POWER_HERB'],
  ['TORKOAL', 0, ['OVERHEAT', 'YAWN', 'GRAVITY', 'TRICK_ROOM'], 'CHOICE_SPECS'],
  ['SABLEYE', 0, ['IMPRISON', 'DISABLE', 'TORMENT', 'SNATCH']],
  ['CHATOT', 0, ['METRONOME', 'CHATTER', 'NASTY_PLOT', 'SLEEP_TALK']],
  ['BLISSEY', 0, ['HEAL_BLOCK', 'FLING', 'NATURAL_GIFT', 'SOFTBOILED'], 'IRON_BALL'],
  ['ABSOL', 0, ['PURSUIT', 'SUCKER_PUNCH', 'FUTURE_SIGHT', 'PSYCH_UP']],
  ['CLEFABLE', 0, ['MIMIC', 'METRONOME', 'ASSIST', 'MINIMIZE']],
];

export interface SoakWorld {
  reg: Registries;
  record: NewGame;
  order: readonly { id: string; version: string }[];
  tables: FrontierTables;
  /** Frontier sets a player may enter (not set 0, not a banned species). */
  playerSets: number[];
  /** Late-game trainers: the Elite Four, the Champion, the League rival, the gym leaders and the Vs. Seeker rematches. */
  late: Id[];
}

export function soakWorld(pack: PackData): SoakWorld {
  const loaded = loadGamePacks([pack]);
  const reg = loaded.registries;
  const record = [...reg.newGame.values()][0]!;
  const tables = frontierTables(reg);
  const playerSets = tables.sets.map((_, i) => i).filter((i) => i > 0 && !tables.banlist.includes(tables.sets[i]!.species));
  const late = [...reg.trainers.values()].filter((t) => /ELITE_FOUR|CHAMPION|RIVAL_POKEMON_LEAGUE|LEADER_|_REMATCH/.test(t.id) && !/DUMMY/.test(t.id) && t.party.length).map((t) => t.id);
  return { reg, record, order: loaded.loaded.order, tables, playerSets, late };
}

/** A seeded u16 stream (the facilities' Rand16 shape). */
function rand16(seed: number): () => number {
  const p = new Prng(seed);
  return () => p.next() >>> 16;
}

export interface SoakCase {
  facility: SoakFacility;
  seed: number;
  setup: BattleSetup;
  party: Pokemon[];
  bag: Bag;
  /** What the case is, for the report: the trainers and both sides' species, moves and items. */
  label: string;
}

/** `count` distinct frontier sets for the player (no species or item twice, as the counters require), at `level`. */
function playerParty(w: SoakWorld, r: () => number, count: number, level: number, otId: number): Pokemon[] {
  const dex = dexOf(w.reg);
  const picked: number[] = [];
  while (picked.length < count) {
    const set = w.playerSets[r() % w.playerSets.length]!;
    const s = w.tables.sets[set]!;
    if (picked.some((p) => w.tables.sets[p]!.species === s.species || (s.item !== null && w.tables.sets[p]!.item === s.item))) continue;
    picked.push(set);
  }
  return picked.map((set) => frontierPokemon(dex, w.tables.sets, set, { otId, pid: ((r() << 16) | r()) >>> 0, ivs: r() % 32, item: w.tables.sets[set]!.item, otName: 'Soak', ball: newGameRecord(w.reg).pokeBall, level }));
}

function freshState(w: SoakWorld, seed: number, party: Pokemon[]): GameState {
  const s = newGameState(w.record, w.reg, w.order, seed);
  s.party = party;
  return s;
}

const trainerBattle = (frontier: BattleSetup['frontier'], topology?: BattleSetup['topology']): BattleSetup => ({ kind: 'trainer', trainers: [], wild: [], background: null, terrain: null, time: 'day', ...(topology ? { topology } : {}), frontier });

/** The bag for battles outside the frontier: medicine, PP, balls (the trainer blocks them) and battle items. */
function lateBag(): Bag {
  const slots = (o: Record<string, number>) => Object.entries(o).map(([n, count]) => ({ item: `platinum:ITEM_${n}` as Id, count }));
  return { medicine: slots({ FULL_RESTORE: 3, HYPER_POTION: 3, REVIVE: 2, FULL_HEAL: 2, ETHER: 2, ELIXIR: 1 }), balls: slots({ ULTRA_BALL: 2 }), battle: slots({ X_ATTACK: 2, X_SPEED: 1, GUARD_SPEC: 1, DIRE_HIT: 1 }) };
}

/** The battle for `facility` and `seed`, built the way the facility's script commands build it. */
export function soakCase(w: SoakWorld, facility: SoakFacility, seed: number): SoakCase {
  const r = rand16(seed * 7919 + SOAK_FACILITIES.indexOf(facility));
  const dex = dexOf(w.reg);
  const otId = ((r() << 16) | r()) >>> 0;
  let setup: BattleSetup;
  let party: Pokemon[];
  let bag: Bag = {};
  const double = facility.endsWith('-double');
  if (facility.startsWith('tower')) {
    const mode = facility === 'tower-single' ? TOWER_MODE.single : facility === 'tower-double' ? TOWER_MODE.double : TOWER_MODE.multi;
    const size = mode === TOWER_MODE.single ? 3 : mode === TOWER_MODE.double ? 4 : 2;
    // Open-level parties (the tower brings them to 50).
    const s = freshState(w, seed, playerParty(w, r, size, r() & 1 ? 50 : 100, otId));
    const t = BattleTower.init(s, w.reg, false, mode);
    // Any room (the trainers' range and IVs) and any opponent of the seven (Palmer at singles 21 and 49).
    Object.assign(t, { room: r() % 8 });
    t.setSelection(Array.from({ length: size }, (_, i) => i));
    t.seedChallenge();
    t.chooseTrainers();
    t.nextOpponent = 1 + (r() % 7);
    if (mode === TOWER_MODE.multi) {
      t.partnerParties();
      t.partner = r() % 5;
    }
    t.createOpponentParties();
    const frontier = t.battle();
    party = frontier.party;
    setup = trainerBattle(frontier, mode === TOWER_MODE.double ? 'double' : mode === TOWER_MODE.multi ? 'ai-partner' : undefined);
  } else if (facility.startsWith('factory')) {
    const s = freshState(w, seed, []);
    const f = BattleFactory.init(s, w.reg, r, 'RENTAL', false, double ? 1 : 0, facility === 'factory-open');
    f.round = r() % 8;
    f.battle = r() % 7;
    f.streak = f.round * 7 + f.battle;
    f.tradeCount = r() % 20;
    f.loadRound(false);
    const picks: number[] = [];
    while (picks.length < 3) {
      const i = r() % 6;
      if (!picks.includes(i)) picks.push(i);
    }
    f.setAppResult(picks);
    f.addRentals();
    const frontier = f.battleSetup();
    party = frontier.party;
    setup = trainerBattle(frontier, double ? 'double' : undefined);
  } else if (facility.startsWith('hall')) {
    const level = 30 + (r() % 71);
    let mons = playerParty(w, r, 1, level, otId);
    if (double) {
      // Doubles enters two of one species: the same set twice (a second PID).
      const set = w.tables.sets.findIndex((x) => x.species === mons[0]!.species);
      mons = [mons[0]!, frontierPokemon(dex, w.tables.sets, set, { otId, pid: ((r() << 16) | r()) >>> 0, ivs: r() % 32, item: null, otName: 'Soak', ball: newGameRecord(w.reg).pokeBall, level })];
    }
    const s = freshState(w, seed, mons);
    const h = BattleHall.init(s, w.reg, r, false, double ? 1 : 0, 0, double ? 1 : 0);
    h.ranks = h.ranks.map(() => r() % 10);
    h.battle = r() % 10;
    h.streak = r() % 200;
    h.round = Math.floor(h.streak / 10);
    h.capRanks();
    do h.setCell(r() % w.tables.hall.grid.length);
    while (h.selectedType === 'summary' || h.selectedType === 'platinum:TYPE_MYSTERY'); // the board's two unselectable cells
    h.setBaseLevel();
    h.setupNextOpponent();
    const frontier = h.battleSetup();
    party = frontier.party;
    setup = trainerBattle(frontier, double ? 'double' : undefined);
  } else if (facility.startsWith('castle')) {
    const s = freshState(w, seed, playerParty(w, r, 3, r() & 1 ? 50 : 100, otId));
    const c = BattleCastle.init(s, w.reg, r, false, double ? 1 : 0, [0, 1, 2]);
    c.round = r() % 8;
    c.battle = r() % 7;
    c.streak = c.round * 7 + c.battle;
    c.loadRound(false);
    c.setupOpponentsParty();
    // Rented items and berries (the castle takes the entered Pokémon's own).
    for (const m of c.players) if (r() % 3) m.heldItem = w.tables.sets[w.playerSets[r() % w.playerSets.length]!]!.item;
    const frontier = c.battleSetup();
    party = frontier.party;
    setup = trainerBattle(frontier, double ? 'double' : undefined);
  } else if (facility.startsWith('arcade')) {
    const s = freshState(w, seed, playerParty(w, r, 3, r() & 1 ? 50 : 100, otId));
    const a = BattleArcade.init(s, w.reg, r, false, double ? 1 : 0, [0, 1, 2]);
    a.round = r() % 8;
    a.battle = r() % 7;
    a.streak = a.round * 7 + a.battle;
    a.loadRound(false);
    a.setupOpponentsParty();
    a.beforeBoard();
    // Any board effect but the ones that end or skip the battle.
    let effect: number;
    do effect = r() % 28;
    while (effect === 26);
    a.setAppResult(effect, r() % 16, r());
    a.applyEffect();
    const frontier = a.battleSetup();
    party = frontier.party;
    setup = trainerBattle(frontier, double ? 'double' : undefined);
  } else if (facility === 'specials') {
    const ball = newGameRecord(w.reg).pokeBall;
    const picked: number[] = [];
    while (picked.length < 3 + (r() % 4)) {
      const i = r() % SPECIALS.length;
      if (!picked.includes(i)) picked.push(i);
    }
    const level = r() & 1 ? 50 : 100;
    party = picked.map((i) => {
      const [species, slot, moves, item] = SPECIALS[i]!;
      const pid = ((((r() << 16) | r()) >>> 0) & ~1) | slot;
      return createPokemon(dex, { species: `platinum:SPECIES_${species}` as Id, level, pid: pid >>> 0, ivs: 31, otId, otName: 'Soak', otGender: 'male', ball, heldItem: item ? (`platinum:ITEM_${item}` as Id) : null, moves: moves.map((m) => `platinum:MOVE_${m}` as Id) });
    });
    if (r() & 1) {
      // Against a late-game trainer, with a bag.
      const id = w.late[r() % w.late.length]!;
      bag = lateBag();
      setup = { kind: 'trainer', trainers: [id], wild: [], background: null, terrain: null, time: 'day', ...(w.reg.trainers.get(id)!.double ? { topology: 'double' as const } : {}) };
      return { facility, seed, setup, party, bag, label: describe(w, setup, party) };
    }
    // Against a Battle Tower trainer of any room, in singles or doubles.
    const double = r() & 1 && party.length >= 4;
    const s = freshState(w, seed, playerParty(w, r, double ? 4 : 3, 50, otId));
    const t = BattleTower.init(s, w.reg, false, double ? TOWER_MODE.double : TOWER_MODE.single);
    Object.assign(t, { room: r() % 8 });
    t.setSelection(Array.from({ length: double ? 4 : 3 }, (_, i) => i));
    t.seedChallenge();
    t.chooseTrainers();
    t.nextOpponent = 1 + (r() % 7);
    t.createOpponentParties();
    setup = trainerBattle({ ...t.battle(), party }, double ? 'double' : undefined);
  } else {
    const id = w.late[r() % w.late.length]!;
    const t = w.reg.trainers.get(id)!;
    const top = Math.max(...t.party.map((m) => m.level));
    party = playerParty(w, r, 6, Math.min(100, top + (r() % 12)), otId);
    bag = lateBag();
    setup = { kind: 'trainer', trainers: [id], wild: [], background: null, terrain: null, time: 'day', ...(t.double ? { topology: 'double' as const } : {}) };
  }
  return { facility, seed, setup, party, bag, label: describe(w, setup, party) };
}

function describe(w: SoakWorld, setup: BattleSetup, party: Pokemon[]): string {
  const name = (k: 'species' | 'moves' | 'items', id: Id | null) => (id ? (w.reg[k].get(id)?.name ?? id) : '-');
  const mons = (p: Pokemon[]) => p.map((m) => `${name('species', m.species)} L${m.level} @${name('items', m.heldItem)} [${m.moves.map((x) => name('moves', x)).join('/')}]`).join('; ');
  const foes = setup.frontier ? setup.frontier.trainers.map((t) => `${t.name}: ${mons(t.party)}`).join(' + ') : setup.trainers.join(', ');
  const partner = setup.frontier?.partner ? ` partner ${setup.frontier.partner.name}: ${mons(setup.frontier.partner.party)}` : '';
  return `${setup.topology ?? 'single'}${setup.frontier ? ` ${setup.frontier.facility} ai ${setup.frontier.ai ?? 'tower'}${setup.frontier.weather ? ` weather ${setup.frontier.weather}` : ''}` : ''} | player: ${mons(party)}${partner} | vs ${foes}`;
}

/** The controller's parts the policy reads (the AI's view for the player's own battler). */
interface Internals {
  ai: TrainerAi | null;
  aiView(): AiBattleView;
  memory: AiMemory;
  answer: BattleChoice | null;
  refused: unknown;
  sim: { log: string[] };
}

export interface SoakResult {
  outcome: string;
  turns: number;
  ticks: number;
  /** Choices the battle refused (as it should: a disabled move, a fainted Pokémon, an item with no effect). */
  refused: number;
  /** Battle log stubs (unported paths) seen, by key. */
  stubs: Record<string, number>;
  /** What happened, for coverage: the moves used, the weathers and field conditions, drags, item and ability events. */
  events: string[];
}

/** The sim log's moves, weathers, field conditions, drags and faints, as coverage keys. */
function events(log: string[]): string[] {
  const out = new Set<string>();
  for (const line of log) {
    const f = line.split('|');
    if (f[1] === 'move') out.add(`move:${f[3]}`);
    else if (f[1] === '-weather' && f[2] !== 'none') out.add(`weather:${f[2]}`);
    else if (f[1] === '-fieldstart') out.add(`fieldstart:${f[2]!.replace('move: ', '')}`);
    else if (f[1] === '-sidestart') out.add(`sidestart:${f[3]!.replace('move: ', '')}`);
    else if (f[1] === 'drag') out.add('drag');
    else if (f[1] === '-transform') out.add('transform');
    else if (f[1] === 'faint') out.add('faint');
  }
  return [...out];
}

/** What the battle may refuse from the policy: the card's and sheets' own refusals, not internal states. */
const REFUSALS = /can't be used now|can't be switched out|is already in battle|is already coming in|has no energy left|no Pokémon in party slot|won't do any good|won't have any effect|is not available in this battle|nothing to go back to|can't aim at battler|no .* in the bag|restores one move's PP|takes no move|there is no room/;

export class SoakFailure extends Error {
  constructor(
    readonly c: Pick<SoakCase, 'facility' | 'seed' | 'label'>,
    readonly cause: unknown,
    readonly ticks: number,
    readonly turn: number,
    readonly recent: string[],
    /** The sim log's last lines. */
    readonly log: string[],
  ) {
    super(`${c.facility} seed ${c.seed} (turn ${turn}, tick ${ticks}): ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

/** Plays `c` to its end with the seeded player policy. Throws SoakFailure on any error or a stalled battle. */
export function playSoak(w: SoakWorld, c: SoakCase): SoakResult {
  const r = rand16(c.seed * 104729 + 17);
  const pct = (n: number) => r() % 100 < n;
  const stubs: Record<string, number> = {};
  const log = new CountingStubLog((key: string) => (stubs[key] = (stubs[key] ?? 0) + 1));
  const b = createBattle(c.setup, {
    registries: w.reg,
    party: structuredClone(c.party),
    bag: structuredClone(c.bag),
    pc: { current: { box: 0, name: 'BOX 1' }, free: { box: 0, name: 'BOX 1' }, metBebe: false },
    met: { zone: null, date: null },
    player: { name: 'Soak', gender: 'male', trainerId: 1, rival: 'Barry' },
    money: 10000,
    badges: 8,
    caught: [],
    seed: (c.seed * 2654435761) >>> 0,
    textSpeed: 1,
    log,
    options: { scene: true, style: pct(50) ? 'shift' : 'set' },
  }) as Battle & Internals;
  const playerAi = ((r() << 16) | r()) & PLAYER_AI_FLAGS;
  const recent: string[] = [];
  let refused = 0;
  let ticks = 0;
  let idle = 0;
  /** Move slots refused for this battler this turn. */
  let refusedSlots = new Set<number>();
  let lastKey = '';
  const turn = () => (b as unknown as { turns: number }).turns;
  const tryChoose = (choice: BattleChoice): boolean => {
    recent.push(JSON.stringify(choice));
    if (recent.length > 30) recent.shift();
    try {
      b.choose(choice);
      return true;
    } catch (e) {
      if (!REFUSALS.test((e as Error).message)) throw e;
      refused++;
      if (choice.kind === 'move' && /can't be used now/.test((e as Error).message)) refusedSlots.add(choice.slot);
      return false;
    }
  };
  /** The trainer AI's whole choice for the player's battler (its memory left as it was: only the foes' AI keeps one). */
  const aiChoice = (actor: number): BattleChoice | null => {
    if (!b.ai) return null;
    const saved = structuredClone(b.memory);
    try {
      const d = b.ai.chooseAction(b.aiView(), { battler: actor, ai: playerAi }, { next: () => r() });
      if (d.action.kind === 'move') return { kind: 'move', slot: d.action.slot, ...(c.setup.topology && c.setup.topology !== 'single' ? { target: d.action.target } : {}) };
      if (d.action.kind === 'switch') return { kind: 'switch', slot: d.action.slot };
      return null;
    } finally {
      Object.assign(b.memory, saved);
    }
  };
  const doubles = c.setup.topology !== undefined && c.setup.topology !== 'single';
  const randomTarget = (aim: { targets: number[]; group: boolean } | undefined) => (aim && !aim.group && aim.targets.length ? { target: aim.targets[r() % aim.targets.length]! } : {});
  const answer = () => {
    const v = b.view();
    const p = v.prompt!;
    const key = `${turn()}:${'actor' in p ? p.actor : -1}`;
    if (key !== lastKey) refusedSlots = new Set();
    lastKey = key;
    switch (p.kind) {
      case 'command': {
        const roll = r() % 100;
        if (roll < 35) {
          const a = aiChoice(p.actor);
          if (a && tryChoose(a)) return;
        }
        if (roll < 55) {
          // The command prompt's move (replays): any slot, refused ones included.
          const slot = r() % p.moves.length;
          if (tryChoose({ kind: 'move', slot, ...(doubles ? randomTarget(p.moves[slot]!.aim) : {}) })) return;
        }
        if (roll < 62 && p.enabled[2]) return void (pct(50) ? tryChoose({ kind: 'switch', slot: r() % 6 }) : tryChoose({ kind: 'party' }));
        if (roll < 66 && p.enabled[1]) return void tryChoose({ kind: 'bag' });
        if (roll < 68 && p.enabled[3]) return void tryChoose({ kind: 'run' });
        if (roll < 70 && p.canRewind) return void tryChoose({ kind: 'cancel' });
        return void tryChoose({ kind: 'fight' });
      }
      case 'fight': {
        // The move list: a random slot (a refused one prints its message and the list comes back), else the first
        // not yet refused this turn.
        const open = p.moves.map((_, i) => i).filter((i) => !refusedSlots.has(i));
        if (!open.length) throw new Error(`soak: every move of battler ${p.actor} is refused and none is offered (no Struggle): ${p.moves.map((m) => `${m.name} ${m.pp}/${m.maxPp}`).join(', ')}`);
        const slot = pct(60) ? r() % p.moves.length : open[r() % open.length]!;
        const choice: BattleChoice = { kind: 'move', slot, ...(doubles && pct(50) ? randomTarget(p.moves[slot]!.aim) : {}) };
        recent.push(JSON.stringify(choice));
        if (recent.length > 30) recent.shift();
        b.choose(choice);
        if (b.refused) {
          refused++;
          refusedSlots.add(slot);
        }
        return;
      }
      case 'target': {
        if (pct(10)) return void tryChoose({ kind: 'cancel' });
        const aim = p.move.aim;
        return void tryChoose({ kind: 'move', slot: p.slot, ...(aim && !aim.group ? { target: aim.targets[r() % aim.targets.length]! } : {}) });
      }
      case 'party': {
        const app = b.app();
        if (!app || app.app !== 'party-select') return; // answered directly: the sheet closes on the step
        const slot = r() % app.party.length;
        const ok = !app.party[slot]!.isEgg && app.party[slot]!.hp > 0 && slot !== app.active && slot !== app.inBattle && slot !== app.selected;
        if (!p.forced && pct(25)) return b.appDone({ app: 'party-select', slot: null });
        if (ok || pct(20)) {
          recent.push(`party ${slot}`);
          try {
            b.appDone({ app: 'party-select', slot });
          } catch (e) {
            if (!REFUSALS.test((e as Error).message)) throw e;
            refused++;
          }
        }
        return;
      }
      case 'bag': {
        const app = b.app();
        if (!app || app.app !== 'bag-select') return;
        const items = Object.values(app.bag).flatMap((pk) => pk.filter((x) => x.count > 0).map((x) => x.item));
        if (!items.length || pct(20)) return b.appDone({ app: 'bag-select', item: null, target: null });
        const item = items[r() % items.length]!;
        const target = r() % app.party.length;
        const move = r() % 4;
        recent.push(`bag ${item} ${target} ${move}`);
        try {
          const one = /ETHER|LEPPA/.test(item);
          b.appDone({ app: 'bag-select', item, target, ...(one ? { move: move % app.party[target]!.moves.length } : {}) });
        } catch (e) {
          if (!REFUSALS.test((e as Error).message)) throw e;
          refused++;
          b.appDone({ app: 'bag-select', item: null, target: null });
        }
        return;
      }
      case 'forfeit':
        return void tryChoose({ kind: 'answer', yes: pct(3) });
      case 'learn-ask':
        return void tryChoose({ kind: 'answer', yes: pct(50) });
      case 'learn':
        return void tryChoose(pct(50) ? { kind: 'keep' } : { kind: 'forget', slot: r() % p.moves.length });
      case 'shift':
        return void tryChoose(pct(60) ? { kind: 'keep' } : pct(50) ? { kind: 'party' } : { kind: 'switch', slot: r() % 6 });
      case 'next':
        return void tryChoose({ kind: 'party' });
      case 'nickname':
        return void tryChoose({ kind: 'nickname', give: false });
      case 'naming':
      case 'pokedex':
        throw new Error(`soak: a ${p.kind} prompt in a trainer battle`);
    }
  };
  try {
    while (!b.done()) {
      if (++ticks > MAX_TICKS) throw new Error(`soak: the battle did not end in ${MAX_TICKS} ticks`);
      if (turn() > MAX_TURNS) return { outcome: 'turn-cap', turns: turn(), ticks, refused, stubs, events: events(b.sim.log) };
      const v = b.view();
      if (v.prompt && !b.answer) {
        idle = 0;
        answer();
      } else if (++idle > 20_000) throw new Error('soak: no prompt and no progress for 20000 ticks');
      b.step(IDLE);
    }
  } catch (e) {
    throw new SoakFailure(c, e, ticks, turn(), recent, b.sim.log.slice(-40));
  }
  return { outcome: b.done()!.outcome, turns: b.done()!.turns, ticks, refused, stubs, events: events(b.sim.log) };
}
