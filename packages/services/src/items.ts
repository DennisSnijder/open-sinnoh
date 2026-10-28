/**
 * Items in the field (decomp item_use_pokemon.c, item_use_functions.c, applications/bag/main.c,
 * party_menu/callbacks.c): what the bag's USE does with an item, the party-use effects on one Pokémon
 * (Pokemon_CheckItemEffects / Pokemon_ApplyItemEffects), Repel, TM/HM teaching and held items. Headless:
 * the bag and party menu models call these.
 */
import { evolutionTarget, MAX_FRIENDSHIP, MAX_LEVEL, MAX_MOVES, maxPp, recalc, STATS, type Id, type Pokemon, type StatName } from '@opensinnoh/core';
import { dexOf, giveItem, itemCount, ITEM_WHEEL_SIZE, takeItem, type GameState, type Item, type Registries } from '@opensinnoh/contracts';
import { heldItemChanged } from './forms.ts';

/** Decomp ITEM_USE_FUNC_* (item.h) values the field uses. */
export const FIELD_USE = { none: 0, healing: 1, townMap: 2, explorerKit: 3, journal: 5, bicycle: 4, poffinCase: 9, pokeRadar: 11, sprayduck: 12, mulch: 13, honey: 14, vsSeeker: 15, oldRod: 16, goodRod: 17, superRod: 18, escapeRope: 21, tmHm: 6, berry: 8, bagMessage: 19, evoStone: 20, azureFlute: 22, gracidea: 24 } as const;
/** Decomp HEAL_FULL_HP / HEAL_HALF_HP / HEAL_QUARTER_HP and HEAL_FULL_PP. */
const HEAL_FULL = 255;
const HEAL_HALF = 254;
const HEAL_QUARTER = 253;
const HEAL_FULL_PP = 127;
/** Decomp MAX_EV_VITAMIN, PP_UP_REQUIREMENT, MAX_PP_UP_BONUSES. */
const MAX_EV_VITAMIN = 100;
const MAX_EV_TOTAL = 510;
const PP_UP_REQUIREMENT = 5;
const MAX_PP_UPS = 3;
/** Decomp LOW_FRIENDSHIP_LIMIT / MED_FRIENDSHIP_LIMIT. */
const FRIENDSHIP_LOW = 100;
const FRIENDSHIP_MED = 200;
/** The repels by item name (decomp UseItemInBag checks ITEM_REPEL, ITEM_SUPER_REPEL, ITEM_MAX_REPEL); steps = the item's effect param. */
const REPELS = new Set(['ITEM_REPEL', 'ITEM_SUPER_REPEL', 'ITEM_MAX_REPEL']);

const localName = (id: Id) => id.slice(id.indexOf(':') + 1);

export function itemRecord(registries: Registries, id: Id): Item {
  const rec = registries.items.get(id);
  if (!rec) throw new Error(`items: unknown item ${id}`);
  return rec;
}

/**
 * What USE does with an item in the field bag (decomp sFieldUseFuncs by `fieldUse`):
 * - `party`: pick a party member (healing items, berries with a party use, the Rare Candy, evolution
 *   stones; PP items also pick a move);
 * - `tm`: teach its move (TM/HM);
 * - `repel`: start Repel steps;
 * - `coins`: the Coin Case's usage message in the bag (BagContext_FormatUsageMessage);
 * - `field`: the bag closes and the field runs the use (the Bicycle: UseBicycleFromMenu);
 * - `stub`: a use that is not implemented yet (logged by the caller);
 * - null: no USE entry (decomp ITEM_USE_FUNC_NONE).
 */
export function fieldUseOf(registries: Registries, id: Id): 'party' | 'tm' | 'repel' | 'coins' | 'fashion' | 'seals' | 'poffin-case' | 'field' | 'stub' | null {
  const rec = itemRecord(registries, id);
  switch (rec.fieldUse) {
    case FIELD_USE.none:
      return null;
    case FIELD_USE.healing:
    case FIELD_USE.berry:
      if (!rec.partyUse) return 'stub';
      return 'party';
    case FIELD_USE.tmHm:
      return 'tm';
    case FIELD_USE.evoStone:
      // Decomp ItemUse for evolution stones: the party in the evolution-item mode (ABLE! / UNABLE!).
      return 'party';
    case FIELD_USE.gracidea:
      // Decomp UseGracideaFromMenu: the party picks the Shaymin (PartyMenu ApplyItemEffectOnPokemon).
      return 'party';
    case FIELD_USE.townMap: // UseTownMapFromMenu: the Town Map to look at
    case FIELD_USE.journal: // UseJournalFromMenu: the journal
    case FIELD_USE.explorerKit: // UseExplorerKitFromMenu: FieldTask_MapChangeToUnderground
    case FIELD_USE.bicycle:
    case FIELD_USE.pokeRadar: // UsePokeRadarFromMenu: RefreshRadarChain
    case FIELD_USE.honey: // UseHoneyFromMenu: Sweet Scent's task without the cut-in
    case FIELD_USE.sprayduck: // UseSprayDuckFromMenu: BerryTree_UseSprayduck on the patch faced
    case FIELD_USE.mulch: // UseMulchFromMenu: BerryTree_UseMulch on the soil faced
    case FIELD_USE.vsSeeker: // Vs. Seeker (sItemUseFuncs)
    case FIELD_USE.oldRod: // Old Rod
    case FIELD_USE.goodRod: // Good Rod
    case FIELD_USE.superRod: // Super Rod
    case FIELD_USE.escapeRope: // Escape Rope
    case FIELD_USE.azureFlute: // Azure Flute (UseAzureFluteFromMenu: common script 39)
      return 'field';
    case FIELD_USE.poffinCase: // UsePoffinCaseFromMenu: the Poffin Case app (the bag's OPEN)
      return 'poffin-case';
    case FIELD_USE.bagMessage:
      if (localName(id) === 'ITEM_COIN_CASE') return 'coins';
      if (localName(id) === 'ITEM_FASHION_CASE') return 'fashion';
      if (localName(id) === 'ITEM_SEAL_CASE') return 'seals';
      return REPELS.has(localName(id)) ? 'repel' : 'stub';
    default:
      return 'stub';
  }
}

/** A PP item picks one move first (decomp PartyMenu_Text_RestoreWhichMove / BoostPPOfWhichMove). */
export function itemPicksMove(registries: Registries, id: Id): 'restore' | 'boost' | null {
  const flags = itemRecord(registries, id).partyUse?.flags ?? [];
  if (flags.includes('ppUp') || flags.includes('ppMax')) return 'boost';
  return flags.includes('ppRestore') ? 'restore' : null;
}

const has = (rec: Item, flag: string) => rec.partyUse?.flags.includes(flag) ?? false;
const EV_FLAGS: [StatName, string][] = [
  ['hp', 'giveHpEvs'],
  ['attack', 'giveAtkEvs'],
  ['defense', 'giveDefEvs'],
  ['speed', 'giveSpeedEvs'],
  ['spAttack', 'giveSpAtkEvs'],
  ['spDefense', 'giveSpDefEvs'],
];
const STATUS_FLAGS: [string, Pokemon['status'][]][] = [
  ['healSleep', ['sleep']],
  ['healPoison', ['poison', 'toxic']],
  ['healBurn', ['burn']],
  ['healFreeze', ['freeze']],
  ['healParalysis', ['paralysis']],
];

function missingPp(registries: Registries, mon: Pokemon, slot: number): boolean {
  const move = mon.moves[slot];
  if (!move) return false;
  return mon.pp[slot]! < maxPp(dexOf(registries).move(move).pp, mon.ppUps[slot]!);
}

function friendshipUp(rec: Item, friendship: number): boolean {
  if (friendship >= MAX_FRIENDSHIP) return false;
  const [low, med, high] = rec.partyUse!.friendship;
  if (friendship < FRIENDSHIP_LOW) return has(rec, 'giveFriendshipLow') && low > 0;
  if (friendship < FRIENDSHIP_MED) return has(rec, 'giveFriendshipMed') && med > 0;
  return has(rec, 'giveFriendshipHigh') && high > 0;
}

/** Decomp Pokemon_CheckItemEffects: would the item do anything to this Pokémon (and move slot)? Eggs: never. */
export function canUseItemOn(registries: Registries, mon: Pokemon, id: Id, moveSlot = 0): boolean {
  const rec = itemRecord(registries, id);
  if (!rec.partyUse || mon.isEgg) return false;
  for (const [flag, conditions] of STATUS_FLAGS) if (has(rec, flag) && conditions.includes(mon.status)) return true;
  if ((has(rec, 'revive') || has(rec, 'reviveAll')) && !has(rec, 'levelUp')) {
    if (mon.hp === 0) return true;
  } else if (has(rec, 'hpRestore') && mon.hp !== 0 && mon.hp < mon.stats.hp) return true;
  if (has(rec, 'levelUp') && mon.level < MAX_LEVEL) return true;
  if (has(rec, 'evolve') && evolutionTarget(dexOf(registries), mon, { kind: 'item', item: id })) return true;
  if ((has(rec, 'ppUp') || has(rec, 'ppMax')) && mon.moves[moveSlot] && mon.ppUps[moveSlot]! < MAX_PP_UPS && dexOf(registries).move(mon.moves[moveSlot]).pp >= PP_UP_REQUIREMENT) return true;
  if (has(rec, 'ppRestore') && missingPp(registries, mon, moveSlot)) return true;
  if (has(rec, 'ppRestoreAll') && mon.moves.some((_, i) => missingPp(registries, mon, i))) return true;
  const sum = STATS.reduce((n, s) => n + mon.evs[s], 0);
  for (const [stat, flag] of EV_FLAGS) {
    if (!has(rec, flag) || (stat === 'hp' && localName(mon.species) === 'SPECIES_SHEDINJA')) continue;
    const change = rec.partyUse.evs[stat] ?? 0;
    if (change > 0 && mon.evs[stat] < MAX_EV_VITAMIN && sum < MAX_EV_TOTAL) return true;
    if (change < 0 && (mon.evs[stat] > 0 || friendshipUp(rec, mon.friendship))) return true;
  }
  return false;
}

function restoreHp(mon: Pokemon, amount: number): void {
  const max = mon.stats.hp;
  const n = max === 1 ? 1 : amount === HEAL_FULL ? max : amount === HEAL_HALF ? Math.floor(max / 2) : amount === HEAL_QUARTER ? Math.floor(max / 4) : amount;
  mon.hp = Math.min(max, mon.hp + n);
}

function restorePp(registries: Registries, mon: Pokemon, slot: number, amount: number): boolean {
  if (!missingPp(registries, mon, slot)) return false;
  const max = maxPp(dexOf(registries).move(mon.moves[slot]!).pp, mon.ppUps[slot]!);
  mon.pp[slot] = amount === HEAL_FULL_PP || amount === HEAL_FULL ? max : Math.min(max, mon.pp[slot]! + amount);
  return true;
}

function raisePpUps(registries: Registries, mon: Pokemon, slot: number, amount: number): boolean {
  const move = mon.moves[slot];
  if (!move || mon.ppUps[slot]! >= MAX_PP_UPS) return false;
  const base = dexOf(registries).move(move).pp;
  if (base < PP_UP_REQUIREMENT) return false;
  const before = maxPp(base, mon.ppUps[slot]!);
  mon.ppUps[slot] = Math.min(MAX_PP_UPS, mon.ppUps[slot]! + amount);
  mon.pp[slot] = mon.pp[slot]! + maxPp(base, mon.ppUps[slot]!) - before;
  return true;
}

/** Decomp CalculateEVUpdate: null = unchanged. */
function evUpdate(current: number, others: number, change: number): number | null {
  if ((current === 0 && change < 0) || (current >= MAX_EV_VITAMIN && change > 0) || (current + others >= MAX_EV_TOTAL && change > 0)) return null;
  let next = Math.max(0, Math.min(MAX_EV_VITAMIN, current + change));
  if (next + others > MAX_EV_TOTAL) next = MAX_EV_TOTAL - others;
  return next;
}

/**
 * Decomp Pokemon_ApplyItemEffects for the field: status cures, HP and revives, a level (the Rare Candy:
 * the next level's exp, stats recalculated; a fainted Pokémon gets the max HP it gained), PP (one move or
 * all), PP Ups, EVs (stats recalculated), then friendship by bracket (Soothe Bell ×1.5 rounded down, +1 in
 * a Luxury Ball, +1 at its met location). Returns whether anything changed. An evolution item changes
 * nothing here (the party menu starts the evolution scene).
 */
export function applyItemTo(registries: Registries, mon: Pokemon, id: Id, moveSlot: number, zone: Id): boolean {
  const rec = itemRecord(registries, id);
  if (!rec.partyUse) throw new Error(`items: ${id} has no party use`);
  const use = rec.partyUse;
  let applied = false;
  let found = false;
  const cured = STATUS_FLAGS.filter(([flag, conditions]) => has(rec, flag) && conditions.includes(mon.status));
  if (STATUS_FLAGS.some(([flag]) => has(rec, flag))) found = true;
  if (cured.length) {
    mon.status = 'none';
    applied = true;
  }
  if (has(rec, 'hpRestore') || has(rec, 'revive') || has(rec, 'reviveAll')) {
    const revive = has(rec, 'revive') || has(rec, 'reviveAll');
    // CheckItemEffects gates it: a revive lifts only a fainted Pokémon, a potion only a conscious one.
    if (mon.hp < mon.stats.hp && (revive ? mon.hp === 0 : mon.hp > 0)) {
      restoreHp(mon, use.hp);
      applied = true;
    }
    found = true;
  }
  if (has(rec, 'levelUp')) {
    if (mon.level < MAX_LEVEL) {
      const dex = dexOf(registries);
      const before = { hp: mon.hp, max: mon.stats.hp };
      mon.exp = dex.expTable(dex.form(mon.species, mon.form).growthRate)[mon.level + 1]!;
      recalc(dex, mon);
      if (before.hp === 0) mon.hp = Math.min(mon.stats.hp, mon.stats.hp - before.max);
      applied = true;
    }
    found = true;
  }
  if (has(rec, 'evolve')) found = true;
  if (has(rec, 'ppUp')) {
    if (raisePpUps(registries, mon, moveSlot, 1)) applied = true;
    found = true;
  } else if (has(rec, 'ppMax')) {
    if (raisePpUps(registries, mon, moveSlot, MAX_PP_UPS)) applied = true;
    found = true;
  }
  if (has(rec, 'ppRestore')) {
    if (restorePp(registries, mon, moveSlot, use.pp)) applied = true;
    found = true;
  } else if (has(rec, 'ppRestoreAll')) {
    for (let i = 0; i < mon.moves.length; i++) if (restorePp(registries, mon, i, use.pp)) applied = true;
    found = true;
  }
  for (const [stat, flag] of EV_FLAGS) {
    if (!has(rec, flag) || (stat === 'hp' && localName(mon.species) === 'SPECIES_SHEDINJA')) continue;
    const change = use.evs[stat] ?? 0;
    const others = STATS.reduce((n, s) => (s === stat ? n : n + mon.evs[s]), 0);
    const next = evUpdate(mon.evs[stat], others, change);
    if (next !== null) {
      mon.evs[stat] = next;
      recalcKeepingHp(registries, mon);
      applied = true;
    }
    if (change > 0) found = true;
  }
  if (!applied && found) return false;
  const f = mon.friendship;
  const bracket = f < FRIENDSHIP_LOW ? 0 : f < FRIENDSHIP_MED ? 1 : 2;
  const flag = ['giveFriendshipLow', 'giveFriendshipMed', 'giveFriendshipHigh'][bracket]!;
  if (has(rec, flag)) {
    let change = use.friendship[bracket]!;
    if (!(f === MAX_FRIENDSHIP && change > 0) && !(f === 0 && change < 0)) {
      if (change > 0) {
        if (dexOf(registries).holdEffect(mon.heldItem).holdEffect === 'FRIENDSHIP_UP') change = Math.floor((change * 3) / 2);
        if (localName(mon.ball) === 'ITEM_LUXURY_BALL') change++;
        if (mon.met.zone === zone) change++;
      }
      mon.friendship = Math.max(0, Math.min(MAX_FRIENDSHIP, f + change));
    }
  }
  return applied;
}

/** Stats follow the EVs (decomp Pokemon_CalcLevelAndStats), the current HP keeps its distance to the max. */
function recalcKeepingHp(registries: Registries, mon: Pokemon): void {
  const dex = dexOf(registries);
  const data = dex.form(mon.species, mon.form);
  const before = mon.stats.hp;
  const nature = dex.nature(mon.pid);
  const base = data.baseStats;
  const core = (s: StatName) => Math.floor(((2 * base[s] + mon.ivs[s] + Math.floor(mon.evs[s] / 4)) * mon.level) / 100);
  for (const s of STATS) {
    if (s === 'hp') {
      mon.stats.hp = base.hp === 1 ? 1 : core('hp') + mon.level + 10;
      continue;
    }
    let v = core(s) + 5;
    if (nature.up === s) v = Math.floor((v * 110) / 100);
    else if (nature.down === s) v = Math.floor((v * 90) / 100);
    mon.stats[s] = v;
  }
  if (mon.hp > 0) mon.hp = Math.max(1, mon.hp + mon.stats.hp - before);
}

/**
 * The party menu's message after an item worked (decomp BufferUsedItemMessage / PartyMenuCB_UseItem_RestoreHP):
 * the message key and its slots. `before` is the Pokémon's HP before the item.
 */
export type ItemUsedMessage =
  | { key: 'hpRestored'; amount: number }
  | { key: 'regainedHealth' | 'becameHealthy' | 'curedPoison' | 'wokeUp' | 'burnHealed' | 'thawedOut' | 'curedParalysis' | 'ppRestored' }
  | { key: 'ppIncreased'; move: Id }
  | { key: 'statRose'; stat: StatName }
  | { key: 'noEffect' };

/** Decomp NormalizeItemEffect + the HP callback: which message follows using `id` (HP was `before`). */
export function itemUsedMessage(registries: Registries, mon: Pokemon, id: Id, moveSlot: number, before: number): ItemUsedMessage {
  const rec = itemRecord(registries, id);
  const statusFlags = STATUS_FLAGS.filter(([flag]) => has(rec, flag)).map(([flag]) => flag);
  const allStatus = statusFlags.length === STATUS_FLAGS.length;
  // RESTORE_HP: an HP item without cures, or the Full Restore (every cure and HP).
  if (has(rec, 'hpRestore') && (!statusFlags.length || allStatus)) {
    if (before === 0) return { key: 'regainedHealth' };
    return mon.hp === before ? { key: 'becameHealthy' } : { key: 'hpRestored', amount: mon.hp - before };
  }
  if (allStatus) return { key: 'becameHealthy' };
  if (statusFlags.length === 1) {
    const by: Record<string, ItemUsedMessage['key']> = { healSleep: 'wokeUp', healPoison: 'curedPoison', healBurn: 'burnHealed', healFreeze: 'thawedOut', healParalysis: 'curedParalysis' };
    return { key: by[statusFlags[0]!] } as ItemUsedMessage;
  }
  for (const [stat, flag] of EV_FLAGS) if (has(rec, flag) && (rec.partyUse!.evs[stat] ?? 0) > 0) return { key: 'statRose', stat };
  if (has(rec, 'ppUp') || has(rec, 'ppMax')) return { key: 'ppIncreased', move: mon.moves[moveSlot]! };
  if (has(rec, 'ppRestore') || has(rec, 'ppRestoreAll')) return { key: 'ppRestored' };
  return { key: 'noEffect' };
}

/** Uses a party item from the bag on a member: applies it and takes one from the bag. False = no effect (nothing changes). */
export function useItemOnMon(state: GameState, registries: Registries, slot: number, id: Id, moveSlot: number): { ok: false } | { ok: true; message: ItemUsedMessage } {
  const mon = state.party[slot];
  if (!mon) throw new Error(`items: no Pokémon in party slot ${slot}`);
  if (itemCount(state, id) < 1) throw new Error(`items: the bag has no ${id}`);
  if (!canUseItemOn(registries, mon, id, moveSlot)) return { ok: false };
  const before = mon.hp;
  if (!applyItemTo(registries, mon, id, moveSlot, state.player.zone)) return { ok: false };
  takeItem(state, id, 1);
  return { ok: true, message: itemUsedMessage(registries, mon, id, moveSlot, before) };
}

/** Decomp TryUseRepel: refused while steps remain; else the item's effect param in steps and one item taken. */
export function useRepel(state: GameState, registries: Registries, id: Id): boolean {
  if (state.repel > 0) return false;
  const rec = itemRecord(registries, id);
  if (!takeItem(state, id, 1)) throw new Error(`items: the bag has no ${id}`);
  state.repel = rec.holdParam;
  // OpenSinnoh: the repeat-Repel prompt offers this kind again when it wears off.
  state.repelItem = id;
  return true;
}

/**
 * Decomp HM check (Item_IsHMMove / IsHM): an HM item is not used up and its move cannot be forgotten. A pack's own
 * HM is a move-teaching item that cannot be tossed, as the ROM's HMs (and only they) are.
 */
export function isHmItem(registries: Registries, id: Id): boolean {
  if (/(^|:)ITEM_HM\d+$/.test(id)) return true;
  const rec = itemRecord(registries, id);
  return rec.tm !== undefined && rec.preventToss;
}

/** Whether a move is taught by an HM (decomp Item_IsHMMove: HMs' moves are not forgotten in the field). */
export function isHmMove(registries: Registries, move: Id): boolean {
  for (const rec of registries.items.values()) if (rec.tm === move && isHmItem(registries, rec.id)) return true;
  return false;
}

/** Decomp party menu TEACH mode notes: LEARNED, ABLE!, UNABLE!. */
export function tmCompatibility(registries: Registries, mon: Pokemon, id: Id): 'learned' | 'able' | 'unable' {
  const move = itemRecord(registries, id).tm;
  if (!move) throw new Error(`items: ${id} teaches no move`);
  if (mon.isEgg) return 'unable';
  if (mon.moves.includes(move)) return 'learned';
  return dexOf(registries).form(mon.species, mon.form).tms.includes(id) ? 'able' : 'unable';
}

/**
 * Teaches a TM/HM's move: into a free slot (`replace` null) or over move slot `replace`, with full PP and
 * no PP Ups (decomp Pokemon_ResetMoveSlot). A TM is used up, an HM is not.
 */
export function teachTm(state: GameState, registries: Registries, slot: number, id: Id, replace: number | null): void {
  const mon = state.party[slot];
  const move = itemRecord(registries, id).tm;
  if (!mon || !move) throw new Error(`items: teach ${id} to party slot ${slot}`);
  if (tmCompatibility(registries, mon, id) !== 'able') throw new Error(`items: ${mon.species} cannot learn ${move} from ${id}`);
  const dex = dexOf(registries);
  const at = replace ?? mon.moves.length;
  if (at >= MAX_MOVES || at > mon.moves.length) throw new Error(`items: move slot ${at} (knows ${mon.moves.length})`);
  mon.moves[at] = move;
  mon.pp[at] = dex.move(move).pp;
  mon.ppUps[at] = 0;
  if (!isHmItem(registries, id) && !takeItem(state, id, 1)) throw new Error(`items: the bag has no ${id}`);
}

/**
 * GIVE (decomp party menu / bag give): the item moves from the bag to the Pokémon; one it held goes back
 * to the bag (the swap). Returns what it held and whether the Griseous Orb changed Giratina's form (forms.ts
 * `heldItemChanged`), or 'bag-full' when the swapped item does not fit (nothing changes).
 */
export function giveHeldItem(state: GameState, registries: Registries, slot: number, id: Id): { previous: Id | null; formChanged: boolean } | 'bag-full' {
  const mon = state.party[slot];
  if (!mon || mon.isEgg) throw new Error(`items: give ${id} to party slot ${slot}`);
  const previous = mon.heldItem;
  if (!takeItem(state, id, 1)) throw new Error(`items: the bag has no ${id}`);
  if (previous && !giveItem(state, registries, previous, 1)) {
    giveItem(state, registries, id, 1);
    return 'bag-full';
  }
  mon.heldItem = id;
  return { previous, formChanged: heldItemChanged(state, registries, mon, previous ? 'swap' : 'give') };
}

/** TAKE: the held item goes to the bag (and the forms follow); null when it holds nothing, 'bag-full' when it does not fit. */
export function takeHeldItem(state: GameState, registries: Registries, mon: Pokemon): { item: Id; formChanged: boolean } | null | 'bag-full' {
  const held = mon.heldItem;
  if (!held) return null;
  if (!giveItem(state, registries, held, 1)) return 'bag-full';
  mon.heldItem = null;
  return { item: held, formChanged: heldItemChanged(state, registries, mon, 'take') };
}

/** TOSS (decomp TrashSelectedItem): at most what the bag holds. */
export function tossItem(state: GameState, id: Id, count: number): void {
  if (!takeItem(state, id, count)) throw new Error(`items: toss ${count} ${id}: the bag holds ${itemCount(state, id)}`);
}

/** REGISTER / DESELECT (decomp Bag_SetRegisteredItem): one item on Select. */
export function toggleRegistered(state: GameState, registries: Registries, id: Id, wheel = false): void {
  if (!itemRecord(registries, id).canRegister) throw new Error(`items: ${id} cannot be registered`);
  if (wheel) return toggleWheel(state, id);
  state.registeredItem = state.registeredItem === id ? null : id;
}

/** Whether REGISTER shows DESELECT: the registered item (the DS), or a wheel item while the wheel is on (OpenSinnoh). */
export function isRegistered(state: GameState, id: Id, wheel = false): boolean {
  return wheel ? (state.registeredWheel ?? []).includes(id) : state.registeredItem === id;
}

/**
 * The item wheel's REGISTER (OpenSinnoh option `itemWheel`): an item joins the wheel (the oldest leaves a full one) and
 * becomes the one Y uses, as the DS's REGISTER; DESELECT takes it off, and Y keeps the wheel's newest item.
 */
function toggleWheel(state: GameState, id: Id): void {
  const wheel = (state.registeredWheel ?? []).filter((i) => i !== id);
  if (wheel.length === (state.registeredWheel ?? []).length) {
    wheel.push(id);
    if (wheel.length > ITEM_WHEEL_SIZE) wheel.shift();
    state.registeredItem = id;
  } else if (state.registeredItem === id) state.registeredItem = wheel.at(-1) ?? null;
  state.registeredWheel = wheel;
}
