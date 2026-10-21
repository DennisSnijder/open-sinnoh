/**
 * The bag (decomp bag.c, game-agnostic): pockets of item slots. Pockets come from the pack (contracts
 * `NewGame.pockets`); an item's pocket from its record. Adding fills the item's slot or the first free one
 * (sorted pockets re-sort by item order), removing drops an emptied slot.
 */
import type { Id } from './ids.ts';

export interface BagSlot {
  item: Id;
  count: number;
}

/** A bag pocket: `size` distinct items, `max` per item, `sorted` = kept in item order (berries, TMs/HMs). */
export interface BagPocket {
  name: string;
  size: number;
  max: number;
  sorted: boolean;
}

export type Bag = Record<string, BagSlot[]>;

export function emptyBag(pockets: readonly BagPocket[]): Bag {
  return Object.fromEntries(pockets.map((p) => [p.name, []]));
}

function slots(bag: Bag, pocket: BagPocket): BagSlot[] {
  const list = bag[pocket.name];
  if (!list) throw new Error(`bag has no pocket ${pocket.name}`);
  return list;
}

/** How many of `item` the bag holds (any pocket). */
export function bagCount(bag: Bag, item: Id): number {
  for (const list of Object.values(bag)) for (const s of list) if (s.item === item) return s.count;
  return 0;
}

/** Decomp Bag_CanFitItem: the item's slot can take `count` more, or a free slot can. */
export function canAddItem(bag: Bag, pocket: BagPocket, item: Id, count: number): boolean {
  const list = slots(bag, pocket);
  const slot = list.find((s) => s.item === item);
  if (slot) return slot.count + count <= pocket.max;
  return count <= pocket.max && list.length < pocket.size;
}

/** Decomp Bag_TryAddItem; `order` ranks items for sorted pockets (their native index). False = it does not fit (nothing changes). */
export function addItem(bag: Bag, pocket: BagPocket, item: Id, count: number, order: (item: Id) => number): boolean {
  if (!Number.isInteger(count) || count < 1) throw new Error(`addItem ${item}: count ${count}`);
  if (!canAddItem(bag, pocket, item, count)) return false;
  const list = slots(bag, pocket);
  const slot = list.find((s) => s.item === item);
  if (slot) slot.count += count;
  else list.push({ item, count });
  if (pocket.sorted) list.sort((a, b) => order(a.item) - order(b.item));
  return true;
}

/** Decomp Bag_TryRemoveItem: false when the bag holds fewer (nothing changes). */
export function removeItem(bag: Bag, item: Id, count: number): boolean {
  if (!Number.isInteger(count) || count < 1) throw new Error(`removeItem ${item}: count ${count}`);
  for (const list of Object.values(bag)) {
    const i = list.findIndex((s) => s.item === item);
    if (i < 0) continue;
    const slot = list[i]!;
    if (slot.count < count) return false;
    slot.count -= count;
    if (!slot.count) list.splice(i, 1);
    return true;
  }
  return false;
}
