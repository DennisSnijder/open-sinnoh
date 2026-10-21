/**
 * Mart rules (decomp scrcmd_shop.c, overlay007/shop_menu.c; selling: applications/bag/main.c). Headless:
 * the mart menu model (packages/menus) calls these, and so may scripts and tests. Money is clamped as
 * TrainerInfo_TakeMoney / GiveMoney do.
 */
import type { Id } from '@opensinnoh/core';
import { canGiveItem, giveItem, itemCount, MONEY_MAX, newGameRecord, takeItem, type GameState, type Item, type Mart, type Registries } from '@opensinnoh/contracts';

/** At most this many of one item per purchase or sale (decomp shop_menu.c, bag/main.c: capped at 99). */
export const MAX_TRANSACTION = 99;
/** Buying this many of `NewGame.pokeBall` at once adds one `premierBall` (decomp Shop_FinishPurchase). */
export const PREMIER_BALL_MIN = 10;
/** Decomp SystemVars_IncrementDepartmentStoreBuyCount: the counter stops here. */
export const PURCHASE_COUNT_MAX = 10000;

function item(registries: Registries, id: Id): Item {
  const rec = registries.items.get(id);
  if (!rec) throw new Error(`mart: unknown item ${id}`);
  return rec;
}

/** The items a mart shows for a badge count, in stock order (decomp ScrCmd_PokeMartCommon; specialty marts list 0). */
export function martStock(mart: Mart, badges: number): Id[] {
  return mart.items.filter((e) => e.minBadges <= badges).map((e) => e.item);
}

/** How many the player can buy at once: what the money pays for, at most 99 (decomp Shop_SelectBuyMenu). 0 = not enough money. */
export function maxBuy(state: GameState, registries: Registries, id: Id): number {
  const price = item(registries, id).price;
  if (price === 0) throw new Error(`mart: ${id} has no price`);
  return Math.min(MAX_TRANSACTION, Math.floor(state.money / price));
}

export type BuyResult = { ok: true; premierBall: boolean } | { ok: false; reason: 'money' | 'room' };

/**
 * Buys `count` (decomp Shop_ShowPurchaseMessage → Shop_ConfirmItemPurchase → Shop_FinishPurchase): refused
 * when the money does not cover it or the bag has no room; else the items go into the bag, the money is
 * taken, the purchase counter (Veilstone) counts one, and 10+ Poké Balls add a Premier Ball when it fits.
 */
export function buy(state: GameState, registries: Registries, id: Id, count: number, countVar: Id | null): BuyResult {
  if (!Number.isInteger(count) || count < 1 || count > MAX_TRANSACTION) throw new Error(`mart: buy count ${count}`);
  const total = item(registries, id).price * count;
  if (total > state.money) return { ok: false, reason: 'money' };
  if (!canGiveItem(state, registries, id, count)) return { ok: false, reason: 'room' };
  giveItem(state, registries, id, count);
  state.money = Math.max(0, state.money - total);
  if (countVar) {
    const def = registries.vars.get(countVar);
    if (!def) throw new Error(`mart: unknown purchase counter ${countVar}`);
    const next = Math.min(PURCHASE_COUNT_MAX, (state.vars[countVar] ?? def.initial) + 1);
    if (next === def.initial) delete state.vars[countVar];
    else state.vars[countVar] = next;
  }
  const game = newGameRecord(registries);
  const premierBall = !!game.premierBall && id === game.pokeBall && count >= PREMIER_BALL_MIN && giveItem(state, registries, game.premierBall, 1);
  return { ok: true, premierBall };
}

/** Whether the mart buys it: not a key item kind (decomp ITEM_PARAM_PREVENT_TOSS) and priced. */
export function canSell(registries: Registries, id: Id): boolean {
  const rec = item(registries, id);
  return !rec.preventToss && rec.price !== 0;
}

/** What the mart pays for one: half the price (decomp `soldItemPrice >>= 1`). */
export function sellPrice(registries: Registries, id: Id): number {
  return item(registries, id).price >> 1;
}

/** How many the player can sell at once: the bag's count, at most 99 (decomp ShowSaleCountValueWindow). */
export function maxSell(state: GameState, id: Id): number {
  return Math.min(MAX_TRANSACTION, itemCount(state, id));
}

/** Sells `count` (decomp ResolveSale): the items leave the bag and half their price is paid, up to the money cap. */
export function sell(state: GameState, registries: Registries, id: Id, count: number): void {
  if (!canSell(registries, id)) throw new Error(`mart: ${id} cannot be sold`);
  const price = sellPrice(registries, id);
  if (!Number.isInteger(count) || count < 1 || count > maxSell(state, id)) throw new Error(`mart: sell count ${count} of ${id} (have ${itemCount(state, id)})`);
  takeItem(state, id, count);
  state.money = Math.min(MONEY_MAX, state.money + price * count);
}
