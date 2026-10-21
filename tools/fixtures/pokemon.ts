/**
 * The fixture pack's Pokémon data (original: invented species, moves, natures and curves; numbers made
 * up for tests). Contracts 0.9 registries: species, moves, abilities, types, natures, growthRates, items,
 * marts, trainers, plus the newGame bag pockets, box names and gift ball.
 */
import { trainerMonValues, type Stats } from '../../packages/core/src/index.ts';

const id = (s: string) => `fixture:${s}`;
/** Move and ability descriptions and the Pokédex entries (original). */
export const pokemonTexts: { id: string; text: string }[] = [];
const text = (key: string, value: string) => {
  pokemonTexts.push({ id: id(key), text: value });
  return id(key);
};
const stats = (hp: number, attack: number, defense: number, speed: number, spAttack: number, spDefense: number): Stats => ({ hp, attack, defense, speed, spAttack, spDefense });
const none = stats(0, 0, 0, 0, 0, 0);

/** A small original matchup chart (×10: 20 strong, 5 weak, 0 no effect), attacking type first. */
const CHART: Record<string, [string, 0 | 5 | 20][]> = {
  FIRE: [['FIRE', 5], ['WATER', 5], ['GRASS', 20], ['GROUND', 5]],
  WATER: [['FIRE', 20], ['WATER', 5], ['GRASS', 5], ['GROUND', 20]],
  GRASS: [['FIRE', 5], ['WATER', 20], ['GRASS', 5], ['FLYING', 5], ['GROUND', 20]],
  FLYING: [['GRASS', 20]],
  GROUND: [['FIRE', 20], ['GRASS', 5], ['FLYING', 0]],
};

export const types = ['NORMAL', 'FIRE', 'WATER', 'GRASS', 'FLYING', 'GROUND'].map((t, i) => ({
  id: id(`TYPE_${t}`),
  sourceIndex: i,
  name: t.charAt(0) + t.slice(1).toLowerCase(),
  matchups: (CHART[t] ?? []).map(([d, multiplier]) => ({ type: id(`TYPE_${d}`), multiplier, foresight: false })),
}));

export const abilities = [
  ['SPROUT', 'Sprout'],
  ['KINDLE', 'Kindle'],
  ['RIPPLE', 'Ripple'],
  ['TAILWIND_SENSE', 'Tailwind Sense'],
  ['BURROW', 'Burrow'],
  ['THICK_BARK', 'Thick Bark'],
].map(([n, name], i) => ({ id: id(`ABILITY_${n}`), sourceIndex: i + 1, name, description: text(`Text_AbilityDesc_${n}`, `${name}: a quiet knack\nof its own.`) }));

/** Five natures (a pack picks its own count): one neutral, four with a raised and a lowered stat. */
export const natures = [
  { name: 'Even', up: null, down: null },
  { name: 'Fierce', up: 'attack', down: 'spAttack' },
  { name: 'Sturdy', up: 'defense', down: 'speed' },
  { name: 'Swift', up: 'speed', down: 'defense' },
  { name: 'Clever', up: 'spAttack', down: 'attack' },
].map((n, i) => ({ id: id(`NATURE_${n.name.toUpperCase()}`), sourceIndex: i, ...n }));

/** Two curves: n³ and n³·4/5 (level 0 = 0). */
export const growthRates = [
  { id: id('GROWTH_STEADY'), sourceIndex: 0, exp: Array.from({ length: 101 }, (_, n) => n ** 3) },
  { id: id('GROWTH_QUICK'), sourceIndex: 1, exp: Array.from({ length: 101 }, (_, n) => Math.floor((4 * n ** 3) / 5)) },
];

const move = (sourceIndex: number, name: string, type: string, category: string, power: number, accuracy: number, pp: number, extra: Record<string, unknown> = {}) => ({
  id: id(`MOVE_${name.toUpperCase().replace(/ /g, '_')}`),
  sourceIndex,
  name,
  type: id(`TYPE_${type}`),
  category,
  power,
  accuracy,
  pp,
  priority: 0,
  effect: id('BATTLE_EFFECT_HIT'),
  effectChance: 0,
  target: 'SINGLE_TARGET',
  flags: category === 'physical' ? ['MAKES_CONTACT', 'CAN_PROTECT'] : ['CAN_PROTECT'],
  contest: { effect: 0, type: 0 },
  description: text(`Text_MoveDesc_${name.toUpperCase().replace(/ /g, '_')}`, `${name}: a ${category} move\nof the ${type.toLowerCase()} kind.`),
  ...extra,
});

export const moves = [
  move(1, 'Bop', 'NORMAL', 'physical', 40, 100, 35),
  move(2, 'Stare', 'NORMAL', 'status', 0, 100, 30, { effect: id('BATTLE_EFFECT_LOWER_DEFENSE') }),
  move(3, 'Leaf Tap', 'GRASS', 'physical', 40, 100, 25),
  move(4, 'Ember Flick', 'FIRE', 'special', 40, 100, 25),
  move(5, 'Drizzle Jet', 'WATER', 'special', 40, 100, 25),
  move(6, 'Gust Peck', 'FLYING', 'physical', 35, 100, 35),
  move(7, 'Dig Paw', 'GROUND', 'physical', 45, 95, 20),
  move(8, 'Quick Dash', 'NORMAL', 'physical', 40, 100, 30, { priority: 1 }),
  move(9, 'Bark Shield', 'GRASS', 'status', 0, 0, 20, { target: 'USER' }),
  move(10, 'Surf', 'WATER', 'special', 90, 100, 15, { target: 'ALL_ADJACENT' }),
  move(11, 'Waterfall', 'WATER', 'physical', 80, 100, 15),
  move(12, 'Rock Climb', 'NORMAL', 'physical', 90, 85, 20),
  move(13, 'Strength', 'NORMAL', 'physical', 80, 100, 15),
  // Doubles: a spread move on the foes only (decomp RANGE_ADJACENT_OPPONENTS).
  move(14, 'Rock Slide', 'NORMAL', 'physical', 75, 100, 10, { target: 'ADJACENT_OPPONENTS' }),
];

const learnset = (...pairs: [number, string][]) => pairs.map(([level, m]) => ({ level, move: id(`MOVE_${m}`) }));
const base = {
  catchRate: 45,
  baseExp: 60,
  heldItems: { common: null, rare: null },
  hatchCycles: 20,
  baseFriendship: 70,
  eggGroups: [id('EGG_GROUP_FIELD'), id('EGG_GROUP_FIELD')],
  safariFleeRate: 0,
  evolutions: [] as unknown[],
  eggMoves: [] as string[],
  tms: [] as string[],
};

/** A species' Pokédex texts (original): category, entry, height and weight lines. */
const pokedex = (n: number, category: string, entry: string, height: string, weight: string) => ({
  pokedex: { category: text(`Text_DexCategory_${n}`, category), entry: text(`Text_DexEntry_${n}`, entry), height: text(`Text_DexHeight_${n}`, height), weight: text(`Text_DexWeight_${n}`, weight) },
});

export const species = [
  {
    // Species 0: no number; its texts are the Pokédex's unknown entry (decomp SPECIES_NONE).
    ...base,
    id: id('SPECIES_NONE'),
    eggSpecies: id('SPECIES_NONE'),
    sourceIndex: 0,
    name: '-----',
    baseStats: stats(1, 1, 1, 1, 1, 1),
    types: [id('TYPE_NORMAL'), id('TYPE_NORMAL')],
    evYield: none,
    genderRatio: 255,
    growthRate: id('GROWTH_STEADY'),
    abilities: [null, null],
    learnset: [],
    ...pokedex(0, '????? kind', '', '? ft ?? in', '???.? lb'),
  },
  {
    ...base,
    id: id('SPECIES_MOSSLET'),
    eggSpecies: id('SPECIES_MOSSLET'),
    sourceIndex: 1,
    starterSlot: 0,
    name: 'Mosslet',
    ...pokedex(1, 'Moss kind', 'It naps in damp shade and\nwakes when the moss on its\nback needs sun.', '1 ft 8 in', '14.3 lb'),
    regionalDex: 1,
    baseStats: stats(45, 49, 49, 45, 65, 65),
    types: [id('TYPE_GRASS'), id('TYPE_GRASS')],
    evYield: { ...none, spAttack: 1 },
    genderRatio: 31,
    growthRate: id('GROWTH_STEADY'),
    abilities: [id('ABILITY_SPROUT'), null],
    learnset: learnset([1, 'BOP'], [3, 'STARE'], [7, 'LEAF_TAP'], [13, 'BARK_SHIELD'], [16, 'QUICK_DASH']),
    evolutions: [{ method: 'LEVEL', target: id('SPECIES_MOSSGROVE'), level: 16 }],
    eggMoves: [id('MOVE_DIG_PAW')],
    tms: [id('ITEM_LESSON_DIG')],
  },
  {
    ...base,
    id: id('SPECIES_EMBERKIT'),
    eggSpecies: id('SPECIES_EMBERKIT'),
    sourceIndex: 2,
    starterSlot: 1,
    name: 'Emberkit',
    ...pokedex(2, 'Spark kind', 'Its tail glows warmer when it\nis pleased. It sleeps curled\naround the flame.', '1 ft 10 in', '17.6 lb'),
    regionalDex: 3,
    baseStats: stats(39, 52, 43, 65, 60, 50),
    types: [id('TYPE_FIRE'), id('TYPE_FIRE')],
    evYield: { ...none, speed: 1 },
    genderRatio: 31,
    growthRate: id('GROWTH_STEADY'),
    abilities: [id('ABILITY_KINDLE'), null],
    learnset: learnset([1, 'BOP'], [1, 'STARE'], [7, 'EMBER_FLICK'], [9, 'QUICK_DASH']),
  },
  {
    ...base,
    id: id('SPECIES_DRIPLING'),
    eggSpecies: id('SPECIES_DRIPLING'),
    sourceIndex: 3,
    starterSlot: 2,
    name: 'Dripling',
    ...pokedex(3, 'Puddle kind', 'It hops between puddles and\nspits small jets at anything\nthat looks dry.', '1 ft 5 in', '12.1 lb'),
    regionalDex: 4,
    baseStats: stats(53, 51, 53, 40, 61, 56),
    types: [id('TYPE_WATER'), id('TYPE_WATER')],
    evYield: { ...none, spAttack: 1 },
    genderRatio: 31,
    growthRate: id('GROWTH_STEADY'),
    abilities: [id('ABILITY_RIPPLE'), null],
    learnset: learnset([1, 'BOP'], [4, 'STARE'], [8, 'DRIZZLE_JET']),
    tms: [id('ITEM_LESSON_DIG')],
  },
  {
    ...base,
    id: id('SPECIES_SKYLET'),
    eggSpecies: id('SPECIES_SKYLET'),
    sourceIndex: 4,
    name: 'Skylet',
    ...pokedex(4, 'Breeze kind', 'It rides the wind over open\nfields and calls in short,\nbright chirps.', '1 ft 0 in', '4.4 lb'),
    regionalDex: 5,
    baseStats: stats(40, 55, 30, 60, 30, 30),
    types: [id('TYPE_NORMAL'), id('TYPE_FLYING')],
    evYield: { ...none, speed: 1 },
    heldItems: { common: id('ITEM_TONIC'), rare: id('ITEM_STILL_STONE') },
    genderRatio: 127,
    growthRate: id('GROWTH_QUICK'),
    abilities: [id('ABILITY_TAILWIND_SENSE'), id('ABILITY_THICK_BARK')],
    learnset: learnset([1, 'GUST_PECK'], [1, 'STARE'], [5, 'QUICK_DASH']),
  },
  {
    ...base,
    id: id('SPECIES_BURROWBIT'),
    eggSpecies: id('SPECIES_BURROWBIT'),
    sourceIndex: 5,
    name: 'Burrowbit',
    ...pokedex(5, 'Tunnel kind', 'It digs long tunnels under\nmeadows and hoards round\npebbles in them.', '1 ft 4 in', '9.9 lb'),
    baseStats: stats(59, 45, 40, 31, 35, 40),
    types: [id('TYPE_NORMAL'), id('TYPE_GROUND')],
    evYield: { ...none, hp: 1 },
    genderRatio: 255,
    growthRate: id('GROWTH_QUICK'),
    abilities: [id('ABILITY_BURROW'), null],
    learnset: learnset([1, 'BOP'], [3, 'DIG_PAW'], [6, 'STARE'], [9, 'QUICK_DASH'], [12, 'BARK_SHIELD']),
    evolutions: [{ method: 'USE_ITEM', target: id('SPECIES_MOSSGROVE'), item: id('ITEM_GROVE_STONE') }],
    tms: [id('ITEM_LESSON_DIG')],
  },
  {
    ...base,
    id: id('SPECIES_MOSSGROVE'),
    eggSpecies: id('SPECIES_MOSSLET'),
    sourceIndex: 6,
    name: 'Mossgrove',
    ...pokedex(6, 'Grove kind', 'A small grove grows on its\nback. Birds rest there on\nlong journeys.', '3 ft 3 in', '61.7 lb'),
    regionalDex: 2,
    baseStats: stats(60, 62, 63, 60, 80, 80),
    types: [id('TYPE_GRASS'), id('TYPE_GROUND')],
    evYield: { ...none, spAttack: 1, spDefense: 1 },
    genderRatio: 31,
    growthRate: id('GROWTH_STEADY'),
    abilities: [id('ABILITY_SPROUT'), id('ABILITY_THICK_BARK')],
    learnset: learnset([1, 'BOP'], [1, 'STARE'], [7, 'LEAF_TAP'], [13, 'BARK_SHIELD'], [16, 'QUICK_DASH'], [20, 'DIG_PAW']),
    tms: [id('ITEM_LESSON_DIG')],
  },
  {
    // The egg "species" (decomp SPECIES_EGG): its name is what an egg is called; no number, no Pokédex entry.
    ...base,
    id: id('SPECIES_EGG'),
    eggSpecies: id('SPECIES_EGG'),
    sourceIndex: 494,
    name: 'Shell',
    baseStats: stats(10, 10, 10, 10, 10, 10),
    types: [id('TYPE_NORMAL'), id('TYPE_NORMAL')],
    evYield: none,
    genderRatio: 255,
    growthRate: id('GROWTH_STEADY'),
    eggGroups: [id('EGG_GROUP_UNDISCOVERED'), id('EGG_GROUP_UNDISCOVERED')],
    abilities: [null, null],
    learnset: [],
  },
];

/**
 * Pokédex entries (contracts 0.16.0): the texts above (`pokedex(...)`) become each species' `dex` with
 * original numbers (decimetres, hectograms, body shape), a size comparison and empty area lists (the
 * fixture has no area map). Species 0's texts are what a seen-only entry shows (`dexUnknown`).
 */
const DEX_NUMBERS: Record<string, [number, number, number]> = {
  SPECIES_MOSSLET: [5, 65, 0],
  SPECIES_EMBERKIT: [6, 80, 0],
  SPECIES_DRIPLING: [4, 55, 2],
  SPECIES_SKYLET: [3, 20, 5],
  SPECIES_BURROWBIT: [4, 45, 0],
  SPECIES_MOSSGROVE: [10, 280, 0],
};
const noArea = { fields: [], dungeons: [] };
const dexSize = (dm: number) => {
  const s = { trainerScale: 256, trainerY: 9, pokemonScale: Math.round((256 * 14) / dm), pokemonY: 20 };
  return { male: s, female: s };
};
type DexTexts = { category: string; entry: string; height: string; weight: string };
let unknown: DexTexts | null = null;
for (const s of species as ({ id: string; pokedex?: DexTexts } & Record<string, unknown>)[]) {
  if (s.id === 'fixture:SPECIES_EGG') continue;
  const texts = s.pokedex!;
  delete s.pokedex;
  const numbers = DEX_NUMBERS[s.id.replace('fixture:', '')];
  if (!numbers) {
    unknown = texts;
    continue;
  }
  const [dm, hg, shape] = numbers;
  s.dex = {
    category: texts.category,
    description: texts.entry,
    heightText: texts.height,
    weightText: texts.weight,
    height: dm,
    weight: hg,
    shape,
    footprint: null,
    size: dexSize(dm),
    area: { morning: noArea, day: noArea, night: noArea, special: noArea, specialNational: noArea },
  };
}
export const dexUnknown = { category: unknown!.category, height: unknown!.height, weight: unknown!.weight };

const ITEM_DESCRIPTIONS: Record<string, string> = {
  'Lamp Oil': 'Oil for a travel lantern.\nIt burns for a whole night.',
  Tonic: 'A bitter tonic that restores\n20 HP of one companion.',
  'Capture Orb': 'A glass orb that holds a\nwild companion.',
  'Town Guide': 'A folded guide to the town\nand its paths.',
  'Still Stone': 'A smooth stone that keeps a\ncompanion as it is.',
  'Lesson Dig': 'A lesson that teaches\nDig Paw.',
  'Bonus Orb': 'A white orb given away\nwith orders of ten.',
  'Share Charm': 'A charm that shares what\nthe holder could learn.',
  'Lucky Charm': 'A charm that helps its\nholder learn faster.',
  Repel: 'A spray that keeps weak wild\ncompanions away for 100 steps.',
  'Wake Drops': 'Drops that wake a sleeping\ncompanion.',
  'Trail Bike': 'A folding bike for the open\nroads. Register it to Select.',
  'Focus Drops': 'Drops that restore 10 PP of\none move.',
  'Calm Leaf': 'A cool leaf that draws the\npoison out of a companion.',
  'Spark Charm': 'A charm that sharpens a\ncompanion\'s Power in a bout.',
  'Smoke Puff': 'A puff of smoke to slip\naway from a wild bout.',
  'Grow Candy': 'A sweet that makes a\ncompanion one level older.',
  'Grove Stone': 'A mossy stone that makes\nsome companions change.',
  'Leaf Letter': 'A letter written on a broad\nleaf, for a companion to carry.',
};

/** Item name, plural and description texts (original), and each item's icon path. */
export const itemTexts: { id: string; text: string }[] = [];
export const itemIcons: { path: string; colour: [number, number, number] }[] = [];

const item = (sourceIndex: number, name: string, pocket: string, price: number, extra: Record<string, unknown> = {}) => {
  const key = name.toUpperCase().replace(/ /g, '_');
  itemTexts.push({ id: id(`Text_ItemPlural_${key}`), text: `${name}s` }, { id: id(`Text_ItemDesc_${key}`), text: ITEM_DESCRIPTIONS[name] ?? fail(name) });
  const path = `sprites/items/${key.toLowerCase()}.png`;
  itemIcons.push({ path, colour: [(sourceIndex * 97) % 200 + 40, (sourceIndex * 53) % 200 + 40, (sourceIndex * 31) % 200 + 40] });
  return {
  id: id(`ITEM_${key}`),
  sourceIndex,
  name,
  plural: id(`Text_ItemPlural_${key}`),
  description: id(`Text_ItemDesc_${key}`),
  icon: id(path),
  pocket,
  price,
  holdEffect: 'NONE',
  holdParam: 0,
  pluckEffect: 0,
  fling: { effect: 0, power: 0 },
  preventToss: false,
  canRegister: false,
  battlePocket: 0,
  fieldUse: 0,
  battleUse: 0,
  ...extra,
  };
};

function fail(name: string): never {
  throw new Error(`fixture item ${name}: no description`);
}

export const items = [
  item(1, 'Lamp Oil', 'items', 100),
  // battlePocket: decomp BATTLE_POCKET_MASK_* (1 balls, 2 battle items, 4 HP, 8 status); battleUse 1 ball, 2 healing, 3 escaping.
  item(2, 'Tonic', 'medicine', 300, { fieldUse: 1, battleUse: 2, battlePocket: 4, partyUse: { flags: ['hpRestore'], stages: {}, evs: {}, hp: 20, pp: 0, friendship: [0, 0, 0] } }),
  item(3, 'Capture Orb', 'balls', 200, { battleUse: 1, battlePocket: 1 }),
  item(4, 'Town Guide', 'key_items', 0, { preventToss: true, canRegister: true }),
  item(5, 'Still Stone', 'items', 200, { holdEffect: 'NO_EVOLVE' }),
  item(6, 'Lesson Dig', 'tmhms', 1000, { fieldUse: 6, tm: id('MOVE_DIG_PAW') }),
  item(7, 'Bonus Orb', 'balls', 200, { battleUse: 1, battlePocket: 1 }),
  item(8, 'Calm Leaf', 'medicine', 100, { fieldUse: 1, battleUse: 2, battlePocket: 8, partyUse: { flags: ['healPoison'], stages: {}, evs: {}, hp: 0, pp: 0, friendship: [0, 0, 0] } }),
  item(9, 'Spark Charm', 'battle_items', 350, { battlePocket: 2, partyUse: { flags: ['giveFriendshipLow', 'giveFriendshipMed'], stages: { attack: 1 }, evs: {}, hp: 0, pp: 0, friendship: [1, 1, 0] } }),
  item(10, 'Smoke Puff', 'battle_items', 1000, { battleUse: 3, battlePocket: 2 }),
  item(11, 'Share Charm', 'items', 3000, { holdEffect: 'EXP_SHARE' }),
  item(12, 'Lucky Charm', 'items', 200, { holdEffect: 'EXP_UP', holdParam: 50 }),
  // A repel (decomp ITEM_USE_FUNC_BAG_MESSAGE, its steps in the effect param) and a sleep cure.
  item(13, 'Repel', 'items', 350, { fieldUse: 19, holdParam: 100 }),
  item(14, 'Wake Drops', 'medicine', 100, { fieldUse: 1, battleUse: 2, battlePocket: 8, partyUse: { flags: ['healSleep'], stages: {}, evs: {}, hp: 0, pp: 0, friendship: [0, 0, 0] } }),
  // A level-up candy (the Rare Candy's flags) and an evolution stone (decomp ITEM_USE_FUNC_EVO_STONE).
  item(15, 'Grow Candy', 'medicine', 4800, { fieldUse: 1, partyUse: { flags: ['revive', 'levelUp', 'giveFriendshipLow', 'giveFriendshipMed', 'giveFriendshipHigh'], stages: {}, evs: {}, hp: 0, pp: 0, friendship: [5, 3, 2] } }),
  item(16, 'Grove Stone', 'items', 2100, { fieldUse: 20, partyUse: { flags: ['evolve'], stages: {}, evs: {}, hp: 0, pp: 0, friendship: [0, 0, 0] } }),
  // A bike (decomp ITEM_USE_FUNC_BICYCLE): registered to Y, it gets on and off.
  item(17, 'Trail Bike', 'key_items', 0, { preventToss: true, canRegister: true, fieldUse: 4 }),
  // Mail (the mail pocket): a Pokémon holding it cannot be released (decomp Item_IsMail).
  item(18, 'Leaf Letter', 'mail', 50),
  // One move's PP (decomp ITEM_ETHER: HP/PP pocket, the move picked in the party).
  item(19, 'Focus Drops', 'medicine', 1200, { fieldUse: 1, battleUse: 2, battlePocket: 4, partyUse: { flags: ['ppRestore'], stages: {}, evs: {}, hp: 0, pp: 10, friendship: [0, 0, 0] } }),
];

export const marts = [
  {
    id: id('MART_COMMON'),
    items: [
      { item: id('ITEM_CAPTURE_ORB'), minBadges: 0 },
      { item: id('ITEM_TONIC'), minBadges: 0 },
      { item: id('ITEM_LAMP_OIL'), minBadges: 1 },
    ],
  },
];

export const pockets = [
  { name: 'items', size: 20, max: 999, sorted: false },
  { name: 'medicine', size: 10, max: 999, sorted: false },
  { name: 'balls', size: 5, max: 999, sorted: false },
  { name: 'tmhms', size: 10, max: 99, sorted: true },
  { name: 'berries', size: 10, max: 999, sorted: true },
  { name: 'mail', size: 5, max: 999, sorted: false },
  { name: 'battle_items', size: 5, max: 999, sorted: false },
  { name: 'key_items', size: 10, max: 999, sorted: false },
];

/** Four PC boxes ("CRATE 1" …). */
export const boxNameTexts = [1, 2, 3, 4].map((n) => ({ id: id(`Text_Box${n}`), text: `CRATE ${n}` }));

interface FixtureTrainerMon {
  species: string;
  level: number;
  ivScale?: number;
  moves?: string[];
  item?: string;
}

/** A trainer's party with the DS PID derivation (core `trainerMonValues`; fixture class numbers are made up). */
export function trainerParty(trainer: number, trainerClass: number, female: boolean, mons: FixtureTrainerMon[]) {
  return mons.map((m) => {
    const ivScale = m.ivScale ?? 0;
    const sp = species.find((s) => s.id === id(m.species));
    if (!sp) throw new Error(`fixture trainer: unknown ${m.species}`);
    const { pid, otId, ivs } = trainerMonValues({ ivScale, level: m.level, species: sp.sourceIndex, trainer, trainerClass, female });
    return {
      species: id(m.species),
      level: m.level,
      ivs,
      pid,
      otId,
      ...(m.moves ? { moves: m.moves.map((x) => id(`MOVE_${x}`)) } : {}),
      ...(m.item ? { item: id(m.item) } : {}),
      ballSeal: 0,
    };
  });
}
