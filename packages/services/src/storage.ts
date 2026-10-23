/**
 * PC storage (decomp pc_boxes.c, applications/pc_boxes): withdraw, deposit, move Pokémon between boxes
 * and the party, held items, box names and wallpapers. Headless: the storage menu model calls these. The
 * party never has gaps (a Pokémon leaving it closes the gap, as Party_RemovePokemonBySlotIndex does).
 */
import { PARTY_SIZE, type Id, type Pokemon } from '@opensinnoh/core';
import { BOX_SIZE, DEFAULT_WALLPAPERS, EXTRA_WALLPAPERS, giveItem, type GameState, type Registries } from '@opensinnoh/contracts';
import { boxHeldItemChanged, setShayminForm, SHAYMIN_SKY, isSpecies, SPECIES } from './forms.ts';

/** Decomp BoxPokemon_SetShayminForm(…, SHAYMIN_FORM_LAND) on every store into a box. */
function storedInBox(registries: Registries, mon: Pokemon): void {
  if (mon.form === SHAYMIN_SKY && isSpecies(registries, mon, SPECIES.shaymin)) setShayminForm(registries, mon, 0);
}

export type MonPlace = { area: 'box'; box: number; slot: number } | { area: 'party'; slot: number };

/** Decomp PCBoxes name length (the naming screen's box limit). */
export const BOX_NAME_MAX = 8;

export function monAt(state: GameState, at: MonPlace): Pokemon | null {
  if (at.area === 'party') return state.party[at.slot] ?? null;
  const box = state.boxes[at.box];
  if (!box || at.slot < 0 || at.slot >= BOX_SIZE) throw new Error(`storage: no box slot ${at.box}/${at.slot}`);
  return box.slots[at.slot] ?? null;
}

/** Puts `mon` at `at`; into a box, a Sky Forme Shaymin turns back to Land (decomp PCBoxes_TryStoreBoxMonAt). */
function setAt(state: GameState, registries: Registries, at: MonPlace, mon: Pokemon | null): void {
  if (at.area === 'box') {
    if (mon) storedInBox(registries, mon);
    state.boxes[at.box]!.slots[at.slot] = mon;
    return;
  }
  if (mon) {
    if (at.slot < state.party.length) state.party[at.slot] = mon;
    else if (state.party.length < PARTY_SIZE) state.party.push(mon);
    else throw new Error('storage: the party is full');
  } else state.party.splice(at.slot, 1);
}

/** Pokémon in a box. */
export function boxCount(state: GameState, box: number): number {
  return state.boxes[box]!.slots.filter((m) => m).length;
}

/** Decomp PCBoxes_FirstEmptySlot in one box, or -1. */
export function firstFreeSlot(state: GameState, box: number): number {
  return state.boxes[box]!.slots.findIndex((m) => !m);
}

/** A Pokémon that can battle (not an egg, not fainted). */
const canBattle = (m: Pokemon) => !m.isEgg && m.hp > 0;

/**
 * Decomp BoxApp "That's your last Pokémon!": a party Pokémon may leave only if another party member can
 * still battle.
 */
export function isLastBattler(state: GameState, partySlot: number): boolean {
  return !state.party.some((m, i) => i !== partySlot && canBattle(m));
}

/** `mail` and `capsule`: a party Pokémon holding Mail or with a Ball Capsule cannot go into a box (BoxAppMan_IsPreviewedMonHoldingMailOrHasBallCapsule). */
export type StorageRefusal = 'party-full' | 'box-full' | 'last-mon' | 'mail' | 'capsule';

const holdsMail = (registries: Registries, mon: Pokemon) => !!mon.heldItem && registries.items.get(mon.heldItem)!.pocket === 'mail';
/** Decomp BoxAppMan_IsPreviewedMonHoldingMailOrHasBallCapsule: what keeps a party Pokémon out of the boxes. */
function boxRefusal(registries: Registries, mon: Pokemon): 'mail' | 'capsule' | null {
  if (holdsMail(registries, mon)) return 'mail';
  return mon.capsule ? 'capsule' : null;
}

/** WITHDRAW: the box Pokémon joins the end of the party. */
export function withdraw(state: GameState, box: number, slot: number): StorageRefusal | null {
  const mon = monAt(state, { area: 'box', box, slot });
  if (!mon) throw new Error(`storage: box ${box} slot ${slot} is empty`);
  if (state.party.length >= PARTY_SIZE) return 'party-full';
  state.boxes[box]!.slots[slot] = null;
  state.party.push(mon);
  return null;
}

/** Decomp STORE_MON_CHECK_CAN_STORE_MON (before the box is chosen): the last Pokémon able to battle, then Mail, then a Ball Capsule. */
export function depositRefusal(state: GameState, registries: Registries, partySlot: number): 'last-mon' | 'mail' | 'capsule' | null {
  const mon = state.party[partySlot];
  if (!mon) throw new Error(`storage: no Pokémon in party slot ${partySlot}`);
  if (isLastBattler(state, partySlot)) return 'last-mon';
  return boxRefusal(registries, mon);
}

/** DEPOSIT: the party Pokémon goes to the first free slot of `box` (a Sky Forme Shaymin as Land, decomp PCBoxes_TryStoreBoxMonInBox). */
export function deposit(state: GameState, registries: Registries, partySlot: number, box: number): StorageRefusal | null {
  const mon = state.party[partySlot];
  if (!mon) throw new Error(`storage: no Pokémon in party slot ${partySlot}`);
  const refusal = depositRefusal(state, registries, partySlot);
  if (refusal) return refusal;
  const free = firstFreeSlot(state, box);
  if (free < 0) return 'box-full';
  storedInBox(registries, mon);
  state.boxes[box]!.slots[free] = mon;
  state.party.splice(partySlot, 1);
  return null;
}

/**
 * MOVE (decomp box move mode): picks `from` up and puts it at `to`, swapping with what is there. A party
 * slot past the end means "the end of the party". Refused when the last Pokémon able to battle would
 * leave the party.
 */
export function moveMon(state: GameState, registries: Registries, from: MonPlace, to: MonPlace): StorageRefusal | null {
  const mon = monAt(state, from);
  if (!mon) throw new Error(`storage: nothing to move at ${JSON.stringify(from)}`);
  const other = to.area === 'party' && to.slot >= state.party.length ? null : monAt(state, to);
  if (from.area === 'party' && to.area === 'box') {
    const kept = boxRefusal(registries, mon);
    if (kept) return kept;
    // The party loses `mon` and gains `other` (if any).
    const stays = state.party.filter((m, i) => i !== from.slot);
    if (!(other && canBattle(other)) && !stays.some(canBattle)) return 'last-mon';
  }
  if (from.area === 'box' && to.area === 'party' && !other && state.party.length >= PARTY_SIZE) return 'party-full';
  if (from.area === 'box' && to.area === 'party' && other) {
    // The party Pokémon swapped out goes into the box.
    const kept = boxRefusal(registries, other);
    if (kept) return kept;
  }
  if (from.area === 'party' && to.area === 'party') {
    const target = Math.min(to.slot, state.party.length - 1);
    const a = state.party[from.slot]!;
    state.party[from.slot] = state.party[target]!;
    state.party[target] = a;
    return null;
  }
  if (from.area === 'party' && !other) {
    setAt(state, registries, to, mon);
    setAt(state, registries, from, null);
    return null;
  }
  setAt(state, registries, from, other);
  setAt(state, registries, to, mon);
  return null;
}

/**
 * Why RELEASE is refused (decomp BoxAppMan_CheckReleaseMonValid, in its order): an Egg, a Pokémon holding
 * Mail (decomp Item_IsMail: the mail pocket's items), the party's last Pokémon able to battle
 * (BoxAppMan_OnLastAliveMon), and one with a Ball Capsule.
 */
export type ReleaseRefusal = 'egg' | 'mail' | 'capsule' | 'last-mon';

export function releaseRefusal(state: GameState, registries: Registries, at: MonPlace): ReleaseRefusal | null {
  const mon = monAt(state, at);
  if (!mon) throw new Error(`storage: nothing to release at ${JSON.stringify(at)}`);
  if (mon.isEgg) return 'egg';
  if (holdsMail(registries, mon)) return 'mail';
  if (mon.capsule) return 'capsule';
  if (at.area === 'party' && canBattle(mon) && isLastBattler(state, at.slot)) return 'last-mon';
  return null;
}

/** Decomp sReleaseBlockingMoves: field moves the player must keep at least one Pokémon for. */
const RELEASE_BLOCKING_MOVES = ['MOVE_SURF', 'MOVE_ROCK_CLIMB', 'MOVE_WATERFALL'];
const knows = (m: Pokemon, move: string) => !m.isEgg && m.moves.some((id) => id.slice(id.indexOf(':') + 1) === move);

/**
 * Decomp BoxAppMan_CheckShouldMonReturn / CheckLastMonWithReleaseBlockingMove: a Pokémon the player tries to
 * release "comes back" when it is the only one (in every box and the party, itself included) that knows
 * Surf, Rock Climb or Waterfall. Eggs know no moves here.
 */
export function releaseReturns(state: GameState, at: MonPlace): boolean {
  const mon = monAt(state, at);
  if (!mon) throw new Error(`storage: nothing to release at ${JSON.stringify(at)}`);
  const all = [...state.boxes.flatMap((b) => b.slots), ...state.party].filter((m): m is Pokemon => m !== null);
  return RELEASE_BLOCKING_MOVES.some((move) => knows(mon, move) && all.filter((m) => knows(m, move)).length === 1);
}

/** RELEASE: the Pokémon leaves for good (a party slot closes up). Check `releaseRefusal` and `releaseReturns` first. */
export function releaseMon(state: GameState, at: MonPlace): void {
  if (!monAt(state, at)) throw new Error(`storage: nothing to release at ${JSON.stringify(at)}`);
  if (at.area === 'box') state.boxes[at.box]!.slots[at.slot] = null;
  else state.party.splice(at.slot, 1);
}

/** MARK: the box markings (decomp MON_DATA_MARKINGS), six bits: circle, triangle, square, heart, star, diamond. */
export function setMarkings(state: GameState, at: MonPlace, markings: number): void {
  const mon = monAt(state, at);
  if (!mon) throw new Error(`storage: nothing to mark at ${JSON.stringify(at)}`);
  if (!Number.isInteger(markings) || markings < 0 || markings > 0x3f) throw new Error(`storage: markings ${markings} are not six bits`);
  mon.markings = markings;
}

/** MOVE ITEMS: takes a Pokémon's held item into the hand (returns it), or null when it holds none; Arceus and Giratina follow (forms.ts). */
export function takeItemFrom(state: GameState, registries: Registries, at: MonPlace): Id | null {
  const mon = monAt(state, at);
  if (!mon) throw new Error(`storage: no Pokémon at ${JSON.stringify(at)}`);
  const held = mon.heldItem;
  mon.heldItem = null;
  boxHeldItemChanged(registries, mon);
  return held;
}

/** MOVE ITEMS: gives the item in hand to a Pokémon; returns the item it held (now in hand), or null; Arceus and Giratina follow (forms.ts). */
export function giveItemTo(state: GameState, registries: Registries, at: MonPlace, item: Id): Id | null {
  const mon = monAt(state, at);
  if (!mon || mon.isEgg) throw new Error(`storage: cannot give an item at ${JSON.stringify(at)}`);
  const held = mon.heldItem;
  mon.heldItem = item;
  boxHeldItemChanged(registries, mon);
  return held;
}

/** MOVE ITEMS: puts the item in hand into the bag; false when the bag has no room. */
export function stowItem(state: GameState, registries: Registries, item: Id): boolean {
  return giveItem(state, registries, item, 1);
}

/** The wallpapers a box can use: the 16 defaults and the unlocked extras (decomp PCBoxes_CheckHasUnlockedWallpaper). */
export function availableWallpapers(state: GameState): number[] {
  const extra = Array.from({ length: EXTRA_WALLPAPERS }, (_, i) => i).filter((i) => (state.wallpapersUnlocked >> i) & 1);
  return [...Array.from({ length: DEFAULT_WALLPAPERS }, (_, i) => i), ...extra.map((i) => DEFAULT_WALLPAPERS + i)];
}

export function setWallpaper(state: GameState, box: number, wallpaper: number): void {
  if (!availableWallpapers(state).includes(wallpaper)) throw new Error(`storage: wallpaper ${wallpaper} is not unlocked`);
  state.boxes[box]!.wallpaper = wallpaper;
}

/** Box names: 1–8 characters (decomp the naming screen's box kind). */
export function renameBox(state: GameState, box: number, name: string): void {
  const n = [...name].length;
  if (n < 1 || n > BOX_NAME_MAX) throw new Error(`storage: box name "${name}" must be 1–${BOX_NAME_MAX} characters`);
  state.boxes[box]!.name = name;
}
