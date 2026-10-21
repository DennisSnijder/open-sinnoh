import type { Ability, GrowthRate, Item, ItemPartyUse, Mart, Move, Nature, PokemonType, Species, Trainer, TrainerMon } from '@opensinnoh/contracts';
import { asId, trainerMonValues, type BagPocket, type Evolution, type Id, type SpeciesForm, type SpeciesStats, type StatName } from '@opensinnoh/core';
import { NitroFs, readNarc, Reader } from '@opensinnoh/nds';
import { readTrainerHeader, readTrainerMessages, readTrainerParty } from './formats/data.ts';
import {
  PERSONAL_STATS,
  readCommonMart,
  readEggMoves,
  readEvolutions,
  readGrowthTable,
  readItem,
  readItemList,
  readLearnset,
  readMove,
  readNatureAffinities,
  readPersonal,
  readU16s,
  type RawPersonal,
} from './formats/pokemon.ts';
import type { Names } from './names.ts';
import { TUTOR_MASK_SIZE, TUTOR_MOVE_SIZE, tutorMovesOf } from './side-systems.ts';

/**
 * The Pokémon data of the base pack: types, abilities, natures, growth rates, moves, items, species
 * (personal data, forms, learnsets, TMs, egg moves, evolutions, regional dex), trainers with their parties
 * (PIDs derived as the DS does) and marts. Decomp names as ids; every reference resolves or the import fails.
 */

export interface PokemonDataTables {
  /** arm9 sTMHMMoves (item.c): move per TM/HM. */
  tmMoves: Uint8Array;
  /** ov5 sEggMoves (daycare.c). */
  eggMoves: Uint8Array;
  /** arm9 sTrainerClassGender (trainer_data.c). */
  trainerClassGenders: Uint8Array;
  /** ov16 sTrainerClassPrizeMul (battle_script.c): u8 per class. */
  trainerClassPrizes: Uint8Array;
  /** ov16 sTypeMatchupMultipliers (battle_lib.c): [attacking, defending, ×10] rows, 0xFE separator, 0xFF end. */
  typeChart: Uint8Array;
  /** arm9 sNatureStatAffinities (pokemon.c). */
  natureAffinities: Uint8Array;
  /** arm9 PokeMartCommonItems (scrcmd_shop.c). */
  martCommon: Uint8Array;
  /** arm9 PokeMartSpecialties: pointers to SHOP_ITEM_END-terminated item lists. */
  martSpecialties: Uint8Array;
  /** ov5 sTeachableMoves (scrcmd_move_tutor.c) and sSpeciesLearnsetsByTutor (a mask per personal member − 1). */
  tutorMoves: Uint8Array;
  tutorMasks: Uint8Array;
}

export interface PokemonDataContext {
  fs: NitroFs;
  names: Names;
  tables: PokemonDataTables;
  bankIndex: (bank: string) => number;
  bankText: (bank: number, msg: number) => string;
  unknown: (kind: string, what: string) => void;
}

/** Decomp bag.h pocket sizes and bag.c maximum counts, by `POCKET_*` (Pocket_Sort: berries and TMs/HMs stay sorted). */
const POCKETS: Record<string, { size: number; max: number; sorted: boolean }> = {
  POCKET_ITEMS: { size: 165, max: 999, sorted: false },
  POCKET_MEDICINE: { size: 40, max: 999, sorted: false },
  POCKET_BALLS: { size: 15, max: 999, sorted: false },
  POCKET_TMHMS: { size: 100, max: 99, sorted: true },
  POCKET_BERRIES: { size: 64, max: 999, sorted: true },
  POCKET_MAIL: { size: 12, max: 999, sorted: false },
  POCKET_BATTLE_ITEMS: { size: 30, max: 999, sorted: false },
  POCKET_KEY_ITEMS: { size: 50, max: 999, sorted: false },
};
export const pocketName = (constant: string) => constant.replace(/^POCKET_/, '').toLowerCase();

/** Decomp ScrCmd_PokeMartCommon: badge count → the "required badges" level the common items are filtered by. */
const MART_LEVEL_MIN_BADGES = [0, 0, 1, 3, 5, 7, 8];
/** Decomp gender values (generated/genders.txt). */
const GENDERS: Trainer['gender'][] = ['male', 'female', 'none'];
/** decomp ITEM_POKE_BALL. */
const POKE_BALL = 'ITEM_POKE_BALL';
const PREMIER_BALL = 'ITEM_PREMIER_BALL';
/** Box name texts: PokemonStorageSystem_Text_Box1 + box (decomp PCBoxes_Init), MAX_PC_BOXES boxes. */
const BOX_COUNT = 18;

/** Evolution parameter kinds by `EVO_*` (decomp Pokemon_GetEvolutionTargetSpecies). */
const EVO_PARAM: Record<string, 'level' | 'item' | 'move' | 'species' | 'beauty' | 'none'> = {
  LEVEL_HAPPINESS: 'none',
  LEVEL_HAPPINESS_DAY: 'none',
  LEVEL_HAPPINESS_NIGHT: 'none',
  LEVEL: 'level',
  TRADE: 'none',
  TRADE_WITH_HELD_ITEM: 'item',
  USE_ITEM: 'item',
  LEVEL_ATK_GT_DEF: 'level',
  LEVEL_ATK_EQ_DEF: 'level',
  LEVEL_ATK_LT_DEF: 'level',
  LEVEL_PID_LOW: 'level',
  LEVEL_PID_HIGH: 'level',
  LEVEL_NINJASK: 'level',
  LEVEL_SHEDINJA: 'level',
  LEVEL_BEAUTY: 'beauty',
  USE_ITEM_MALE: 'item',
  USE_ITEM_FEMALE: 'item',
  LEVEL_WITH_HELD_ITEM_DAY: 'item',
  LEVEL_WITH_HELD_ITEM_NIGHT: 'item',
  LEVEL_KNOW_MOVE: 'move',
  LEVEL_SPECIES_IN_PARTY: 'species',
  LEVEL_MALE: 'level',
  LEVEL_FEMALE: 'level',
  LEVEL_MAGNETIC_FIELD: 'none',
  LEVEL_MOSS_ROCK: 'none',
  LEVEL_ICE_ROCK: 'none',
};
/** Nature table stat order (decomp STAT_ATTACK..STAT_SPECIAL_DEFENSE). */
const NATURE_STATS: StatName[] = ['attack', 'defense', 'speed', 'spAttack', 'spDefense'];
const CATEGORIES: Move['category'][] = ['physical', 'special', 'status'];
const EV_FIELDS: StatName[] = ['hp', 'attack', 'defense', 'speed', 'spAttack', 'spDefense'];

export interface PokemonData {
  species: Species[];
  moves: Move[];
  abilities: Ability[];
  types: PokemonType[];
  natures: Nature[];
  growthRates: GrowthRate[];
  items: Omit<Item, 'icon'>[];
  marts: Mart[];
  trainers: Trainer[];
  pockets: BagPocket[];
  boxNames: Id[];
  pokeBall: Id;
  premierBall: Id;
}

const withTutorMoves = (moves: Id[]) => (moves.length ? { tutorMoves: moves } : {});

export function importPokemonData(ctx: PokemonDataContext): PokemonData {
  const { fs, names, tables, bankIndex, bankText, unknown } = ctx;
  const file = names.file;
  const fail = (what: string): never => {
    throw new Error(what);
  };
  const named = (list: (string | null)[], i: number, kind: string): Id => {
    const n = list[i];
    if (!n) fail(`${kind} ${i} has no decomp name`);
    return asId(`platinum:${n}`);
  };
  const typeId = (i: number) => named(file.types, i, 'type');
  const moveId = (i: number) => named(file.moves, i, 'move');
  const itemId = (i: number) => named(file.items, i, 'item');
  const speciesId = (i: number) => named(file.species, i, 'species');
  const abilityId = (i: number): Id | null => (i ? named(file.abilities, i, 'ability') : null);
  const optItem = (i: number): Id | null => (i ? itemId(i) : null);
  const nameOf = (bank: string) => {
    const b = bankIndex(bank);
    return (i: number) => bankText(b, i);
  };

  // --- types, abilities, natures, growth rates ---
  const typeName = nameOf('TEXT_BANK_POKEMON_TYPE_NAMES');
  // The type chart grouped by attacking type, in table order (rows after the 0xFE separator are the Foresight ones).
  const matchups = new Map<number, PokemonType['matchups']>();
  let foresight = false;
  for (let o = 0; tables.typeChart[o] !== 0xff; o += 3) {
    const [attacking, defending, multiplier] = [tables.typeChart[o]!, tables.typeChart[o + 1]!, tables.typeChart[o + 2]!];
    if (attacking === 0xfe) {
      foresight = true;
      continue;
    }
    if (multiplier !== 0 && multiplier !== 5 && multiplier !== 20) fail(`type chart row ${o / 3}: multiplier ${multiplier}`);
    if (!matchups.has(attacking)) matchups.set(attacking, []);
    matchups.get(attacking)!.push({ type: typeId(defending), multiplier: multiplier as 0 | 5 | 20, foresight });
  }
  const types: PokemonType[] = file.types.flatMap((n, i) => (n ? [{ id: typeId(i), sourceIndex: i, name: typeName(i), matchups: matchups.get(i) ?? [] }] : []));
  const abilityName = nameOf('TEXT_BANK_ABILITY_NAMES');
  const abilityDescriptions = bankIndex('TEXT_BANK_ABILITY_DESCRIPTIONS');
  const abilities: Ability[] = file.abilities.flatMap((n, i) =>
    n && i ? [{ id: named(file.abilities, i, 'ability'), sourceIndex: i, name: abilityName(i), description: names.text(abilityDescriptions, i) }] : [],
  );
  const natureName = nameOf('TEXT_BANK_NATURE_NAMES');
  const affinities = readNatureAffinities(tables.natureAffinities, file.natures.length);
  const natures: Nature[] = affinities.map((a, i) => {
    const up = a.findIndex((v) => v > 0);
    const down = a.findIndex((v) => v < 0);
    if (a.some((v) => v < -1 || v > 1) || a.filter((v) => v).length > 2) fail(`nature ${i}: affinities ${a.join(',')}`);
    return { id: named(file.natures, i, 'nature'), sourceIndex: i, name: natureName(i), up: up < 0 ? null : NATURE_STATS[up]!, down: down < 0 ? null : NATURE_STATS[down]! };
  });
  const growth = readNarc(fs.file('/poketool/personal/pl_growtbl.narc'));
  if (growth.length !== file.expRates.length) fail(`pl_growtbl has ${growth.length} members, names.json lists ${file.expRates.length} exp rates`);
  const growthRates: GrowthRate[] = growth.map((m, i) => ({ id: named(file.expRates, i, 'exp rate'), sourceIndex: i, exp: readGrowthTable(m) }));

  // --- moves (MOVE_NONE has no record; members past the named moves are unused) ---
  const waza = readNarc(fs.file('/poketool/waza/pl_waza_tbl.narc'));
  if (waza.length < file.moves.length) fail(`pl_waza_tbl has ${waza.length} members, names.json lists ${file.moves.length} moves`);
  if (waza.length > file.moves.length) unknown('move-data', `pl_waza_tbl members ${file.moves.length}..${waza.length - 1} have no move name (not imported)`);
  const moveName = nameOf('TEXT_BANK_MOVE_NAMES');
  const moveDescriptions = bankIndex('TEXT_BANK_MOVE_DESCRIPTIONS');
  const rangeName = (v: number) => {
    const i = v === 0 ? 0 : Math.log2(v) + 1;
    if (!Number.isInteger(i) || !file.moveRanges[i]) fail(`move range 0x${v.toString(16)}`);
    return file.moveRanges[i]!.replace(/^RANGE_/, '');
  };
  const moves: Move[] = [];
  for (let i = 1; i < file.moves.length; i++) {
    const m = readMove(waza[i]!);
    const category = CATEGORIES[m.class] ?? fail(`move ${i}: class ${m.class}`);
    const flags = file.moveFlags.flatMap((n, b) => ((m.flags >> b) & 1 ? [n.replace(/^MOVE_FLAG_/, '')] : []));
    if (m.flags >> file.moveFlags.length) fail(`move ${i}: flags 0x${m.flags.toString(16)}`);
    moves.push({
      id: moveId(i),
      sourceIndex: i,
      name: moveName(i),
      type: typeId(m.type),
      category,
      power: m.power,
      accuracy: m.accuracy,
      pp: m.pp,
      priority: m.priority,
      effect: names.battleEffect(m.effect),
      effectChance: m.effectChance,
      target: rangeName(m.range),
      flags,
      contest: m.contest,
      description: names.text(moveDescriptions, i),
    });
  }

  // --- TM/HM items, then items (items without data share member 0, as the game does) ---
  const tmItems = file.items.flatMap((n, i) => (n && /^ITEM_(TM|HM)\d+$/.test(n) ? [i] : []));
  const tmMoves = readU16s(tables.tmMoves);
  if (tmItems.length !== tmMoves.length) fail(`${tmItems.length} TM/HM items, the TM table has ${tmMoves.length} moves`);
  const tmOfItem = new Map(tmItems.map((item, k) => [item, moveId(tmMoves[k]!)]));
  const itemName = nameOf('TEXT_BANK_ITEM_NAMES');
  const pluralBank = bankIndex('TEXT_BANK_ITEM_NAMES_PLURAL');
  const descriptionBank = bankIndex('TEXT_BANK_ITEM_DESCRIPTIONS');
  const itemData = readNarc(fs.file('/itemtool/itemdata/pl_item_data.narc'));
  let dataIndex = 0;
  const items: Omit<Item, 'icon'>[] = [];
  file.items.forEach((name, i) => {
    if (!name || name.startsWith('ITEM_UNUSED_')) return;
    const data = itemData[dataIndex++] ?? fail(`pl_item_data has no member for item ${i}`);
    const raw = readItem(data);
    const pocket = file.pockets[raw.pocket] ?? fail(`item ${i}: pocket ${raw.pocket}`);
    const hold = file.holdEffects[raw.holdEffect] ?? fail(`item ${i}: hold effect ${raw.holdEffect}`);
    let partyUse: ItemPartyUse | undefined;
    if (raw.partyUse) {
      const evs: ItemPartyUse['evs'] = {};
      raw.partyUse.evs.forEach((v, k) => {
        if (v) evs[EV_FIELDS[k]!] = v;
      });
      partyUse = { flags: raw.partyUse.flags, stages: raw.partyUse.stages, evs, hp: raw.partyUse.hp, pp: raw.partyUse.pp, friendship: raw.partyUse.friendship };
    }
    const tm = tmOfItem.get(i);
    items.push({
      id: names.item(i),
      sourceIndex: i,
      name: itemName(i),
      plural: names.text(pluralBank, i),
      description: names.text(descriptionBank, i),
      pocket: pocketName(pocket),
      price: raw.price,
      holdEffect: hold.replace(/^HOLD_EFFECT_/, ''),
      holdParam: raw.holdParam,
      pluckEffect: raw.pluckEffect,
      fling: { effect: raw.flingEffect, power: raw.flingPower },
      ...(raw.naturalGiftPower ? { naturalGift: { power: raw.naturalGiftPower, type: typeId(raw.naturalGiftType) } } : {}),
      preventToss: raw.preventToss,
      canRegister: raw.canRegister,
      battlePocket: raw.battlePocket,
      fieldUse: raw.fieldUse,
      battleUse: raw.battleUse,
      ...(partyUse ? { partyUse } : {}),
      ...(tm ? { tm } : {}),
    });
  });
  if (dataIndex !== itemData.length) fail(`pl_item_data has ${itemData.length} members, items use ${dataIndex}`);
  const tmItemIds = tmItems.map(itemId);

  // --- species: personal data, learnsets, evolutions, egg moves, forms, regional dex ---
  const personal = readNarc(fs.file('/poketool/personal/pl_personal.narc'));
  const learnsets = readNarc(fs.file('/poketool/personal/wotbl.narc'));
  const evolutions = readNarc(fs.file('/poketool/personal/evo.narc'));
  const speciesCount = file.species.length;
  const memberCount = speciesCount + file.dataForms.length;
  for (const [what, n] of [['pl_personal', personal.length], ['wotbl', learnsets.length], ['evo', evolutions.length]] as const) {
    if (n !== memberCount) fail(`${what} has ${n} members, expected ${speciesCount} species + ${file.dataForms.length} forms`);
  }
  const eggMoves = readEggMoves(tables.eggMoves);
  const tutorMoveIds = Array.from({ length: tables.tutorMoves.length / TUTOR_MOVE_SIZE }, (_, i) => moveId(new Reader(tables.tutorMoves).u16(i * TUTOR_MOVE_SIZE)));
  if (tables.tutorMasks.length !== (493 + file.dataForms.length) * TUTOR_MASK_SIZE) fail(`tutor masks: ${tables.tutorMasks.length} bytes for 493 species and ${file.dataForms.length} forms`);
  const [zukan] = readNarc(fs.file('/poketool/pl_pokezukan.narc'));
  const regional = readU16s(zukan ?? fail('pl_pokezukan: empty NARC'));
  // Decomp Pokemon_GetBaseSpeciesFromPersonalData: pms.narc is a plain u16 array (not a NARC), the egg species per species.
  const babies = readU16s(fs.file('/poketool/personal/pms.narc'));
  if (babies.length < speciesCount) fail(`pms.narc has ${babies.length} entries, expected ${speciesCount} species`);
  const stats = (raw: RawPersonal, member: number): SpeciesStats => ({
    baseStats: Object.fromEntries(PERSONAL_STATS.map((s, k) => [s, raw.baseStats[k]!])) as SpeciesStats['baseStats'],
    types: [typeId(raw.types[0]), typeId(raw.types[1])],
    catchRate: raw.catchRate,
    baseExp: raw.baseExp,
    evYield: Object.fromEntries(PERSONAL_STATS.map((s, k) => [s, raw.evYield[k]!])) as SpeciesStats['evYield'],
    heldItems: { common: optItem(raw.heldItems[0]), rare: optItem(raw.heldItems[1]) },
    genderRatio: raw.genderRatio,
    hatchCycles: raw.hatchCycles,
    baseFriendship: raw.baseFriendship,
    growthRate: named(file.expRates, raw.expRate, 'exp rate'),
    eggGroups: [names.eggGroup(raw.eggGroups[0]), names.eggGroup(raw.eggGroups[1])],
    abilities: [abilityId(raw.abilities[0]), abilityId(raw.abilities[1])],
    safariFleeRate: raw.safariFleeRate,
    learnset: readLearnset(learnsets[member]!).map((e) => ({ level: e.level, move: moveId(e.move) })),
    tms: raw.tms.map((k) => tmItemIds[k]!),
    ...withTutorMoves(tutorMovesOf(tables.tutorMasks, tutorMoveIds, member, member >= speciesCount ? member - speciesCount : null)),
  });
  const forms = new Map<string, SpeciesForm[]>();
  file.dataForms.forEach((f, k) => {
    const member = speciesCount + k;
    const list = forms.get(f.species) ?? [];
    list.push({ form: f.form, name: f.name, ...stats(readPersonal(personal[member]!, tmItems.length), member) });
    forms.set(f.species, list);
  });
  const STARTERS = ['SPECIES_TURTWIG', 'SPECIES_CHIMCHAR', 'SPECIES_PIPLUP'];
  const speciesName = nameOf('TEXT_BANK_SPECIES_NAME');
  const species: Species[] = file.species.map((name, i) => {
    const evo: Evolution[] = readEvolutions(evolutions[i]!).map((e) => {
      const method = (file.evolutionMethods[e.method] ?? fail(`species ${i}: evolution method ${e.method}`)).replace(/^EVO_/, '');
      const kind = EVO_PARAM[method] ?? fail(`species ${i}: evolution method ${method} has no parameter kind`);
      const out: Evolution = { method, target: speciesId(e.target) };
      if (kind === 'level') out.level = e.param;
      else if (kind === 'item') out.item = itemId(e.param);
      else if (kind === 'move') out.move = moveId(e.param);
      else if (kind === 'species') out.species = speciesId(e.param);
      else if (kind === 'beauty') out.beauty = e.param;
      else if (e.param) unknown('evolution-param', `${name}: ${method} with parameter ${e.param}`);
      return out;
    });
    const dex = regional[i];
    const f = name ? forms.get(name) : undefined;
    return {
      id: names.species(i),
      sourceIndex: i,
      name: speciesName(i),
      ...(name && STARTERS.includes(name) ? { starterSlot: STARTERS.indexOf(name) } : {}),
      ...(dex ? { regionalDex: dex } : {}),
      ...stats(readPersonal(personal[i]!, tmItems.length), i),
      evolutions: evo,
      eggMoves: (eggMoves.get(i) ?? []).map(moveId),
      eggSpecies: speciesId(babies[i]!),
      ...(f ? { forms: f } : {}),
    };
  });
  for (const s of eggMoves.keys()) if (s >= speciesCount) fail(`egg moves for species ${s}`);
  for (const f of file.dataForms) if (!file.species.includes(f.species)) fail(`data form of unknown ${f.species}`);

  // --- trainers (parties with the DS PID derivation) ---
  const genders = [...tables.trainerClassGenders];
  if (genders.length !== file.trainerClasses.length) fail(`${genders.length} trainer class genders, ${file.trainerClasses.length} classes`);
  const trainerBank = bankIndex('TEXT_BANK_NPC_TRAINER_NAMES');
  const classNameBank = bankIndex('TEXT_BANK_TRAINER_CLASS_NAMES');
  const prizes = [...tables.trainerClassPrizes];
  if (prizes.length !== file.trainerClasses.length) fail(`${prizes.length} trainer class prizes, ${file.trainerClasses.length} classes`);
  const trainerMessageBank = bankIndex('TEXT_BANK_NPC_TRAINER_MESSAGES');
  const trData = readNarc(fs.file('/poketool/trainer/trdata.narc'));
  const trPoke = readNarc(fs.file('/poketool/trainer/trpoke.narc'));
  const trtbl = readNarc(fs.file('/poketool/trmsg/trtbl.narc'))[0] ?? fail('trtbl: empty NARC');
  const trtblofs = readNarc(fs.file('/poketool/trmsg/trtblofs.narc'))[0] ?? fail('trtblofs: empty NARC');
  const messageKind = (n: string) => n.replace(/^TRMSG_/, '').toLowerCase().replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
  const trainers: Trainer[] = trData.map((m, i) => {
    const header = readTrainerHeader(m);
    const raw = readTrainerParty(trPoke[i] ?? fail(`trpoke has no member ${i}`), header);
    if (header.battleType & ~BATTLE_TYPE_DOUBLES) unknown('trainer-battle-type', `${names.trainer(i)}: battle type 0x${header.battleType.toString(16)}`);
    if (!file.trainerClasses[header.trainerClass]) unknown('trainer-class', `${names.trainer(i)}: class ${header.trainerClass}`);
    const gender = GENDERS[genders[header.trainerClass] ?? -1] ?? fail(`trainer class ${header.trainerClass}: gender ${genders[header.trainerClass]}`);
    const messages: Record<string, Id> = {};
    for (const [type, msg] of readTrainerMessages(trtbl, trtblofs, i)) {
      const kind = names.trainerMessageNames.get(type) ?? fail(`trainer ${i}: unknown message type ${type}`);
      bankText(trainerMessageBank, msg);
      messages[messageKind(kind)] = names.text(trainerMessageBank, msg);
    }
    const party: TrainerMon[] = raw.map((p) => {
      const { pid, otId, ivs } = trainerMonValues({ ivScale: p.ivScale, level: p.level, species: p.species, trainer: i, trainerClass: header.trainerClass, female: gender === 'female' });
      // Empty slots (0) are dropped; one before a move would leave a gap on the DS (none expected).
      const moves = p.moves?.filter((mv) => mv);
      if (p.moves?.some((mv, k) => !mv && p.moves!.slice(k).some((x) => x))) unknown('trainer-move-gap', `${names.trainer(i)}: moves ${p.moves.join(',')}`);
      return {
        species: speciesId(p.species),
        ...(p.form ? { form: p.form } : {}),
        level: p.level,
        ivs,
        pid,
        otId,
        ...(moves ? { moves: moves.map(moveId) } : {}),
        ...(p.item ? { item: itemId(p.item) } : {}),
        ballSeal: p.ballSeal,
      };
    });
    return {
      id: names.trainer(i),
      sourceIndex: i,
      name: bankText(trainerBank, i),
      class: names.trainerClass(header.trainerClass),
      gender,
      double: (header.battleType & BATTLE_TYPE_DOUBLES) !== 0,
      party,
      items: header.items.filter((x) => x).map(itemId),
      ai: header.aiMask,
      classPrize: prizes[header.trainerClass]!,
      className: names.text(classNameBank, header.trainerClass),
      messages,
    };
  });

  // --- marts ---
  const marts: Mart[] = [
    {
      id: asId('platinum:MART_COMMON'),
      items: readCommonMart(tables.martCommon).map((e) => ({ item: itemId(e.item), minBadges: MART_LEVEL_MIN_BADGES[e.level] ?? fail(`common mart: required badges ${e.level}`) })),
    },
  ];
  const arm9 = fs.arm9();
  const ptrs = new Reader(tables.martSpecialties);
  if (file.martSpecialties.length * 4 !== tables.martSpecialties.length) fail(`${file.martSpecialties.length} specialty marts, table of ${tables.martSpecialties.length} bytes`);
  file.martSpecialties.forEach((name, k) => {
    const at = ptrs.u32(k * 4) - fs.header.arm9RamAddress;
    marts.push({ id: asId(`platinum:${name}`), sourceIndex: k, items: readItemList(arm9, at).map((it) => ({ item: itemId(it), minBadges: 0 })) });
  });

  // --- new game data: bag pockets, box names, the gift ball ---
  const pockets = file.pockets.map((p) => ({ name: pocketName(p), ...(POCKETS[p] ?? fail(`no bag size for ${p}`)) }));
  const storage = bankIndex('TEXT_BANK_POKEMON_STORAGE_SYSTEM');
  const box1 = file.textBanks[storage]?.messages?.findIndex((m) => m === 'PokemonStorageSystem_Text_Box1') ?? -1;
  if (box1 < 0) fail('PokemonStorageSystem_Text_Box1 not in names.json');
  const boxNames = Array.from({ length: BOX_COUNT }, (_, b) => {
    bankText(storage, box1 + b);
    return names.text(storage, box1 + b);
  });
  const pokeBall = itemId(file.items.indexOf(POKE_BALL));
  const premierBall = itemId(file.items.indexOf(PREMIER_BALL));
  return { species, moves, abilities, types, natures, growthRates, items, marts, trainers, pockets, boxNames, pokeBall, premierBall };
}

/** decomp BATTLE_TYPE_DOUBLES. */
const BATTLE_TYPE_DOUBLES = 1 << 1;
